---
title: "Claude Code CLI: Hooks, Agents, and Cost Control Guide"
description: "Practical guide to using Claude Code effectively — managing costs with API keys and subscriptions, securing your workflow with hooks, and scaling with custom agents."
date: 2026-03-17
tags: ["ai", "claude", "claude-code", "cli", "developer-tools", "ai-coding-assistant"]
---


# Claude Code CLI: A Practical Guide to Hooks, Agents, and Cost Control

Claude Code is Anthropic's terminal-based AI coding assistant. Unlike the web-based Claude.ai, it runs directly in your shell, reads your project files, executes commands, and writes code — all from the command line. This post covers the practical side of using it effectively: managing costs, keeping it safe with hooks, and scaling with agents.

## Subscription vs. API Key: Choosing Your Access Model

There are two ways to use Claude Code:

**1. Personal subscription via [claude.ai](https://claude.ai)**

The Pro plan ($20/month) and Max plan ($100/month) give you access through your personal account. Usage is rate-limited with a session window — you get a quota that resets on a rolling basis. Hit the limit and you're locked out until the window resets. Good if you use Claude intermittently and prefer predictable billing.

**2. API key via [console.anthropic.com](https://console.anthropic.com)**

Pay-as-you-go pricing based on actual token usage. No session lockouts — you pay for exactly what you use. You can monitor costs in the **Usage** dashboard, filter by model, token type, and date range. Better if you need uninterrupted access or want fine-grained cost visibility.

**Rule of thumb:** if you're consistently spending more than $20/month on API tokens and can tolerate occasional rate limits, switch to a subscription. If you need continuous, unthrottled access, stick with the API key.

### Setting Up API Key Access

Export your key in your shell profile (`~/.zshrc`, `~/.bashrc`, etc.):

```bash
export ANTHROPIC_API_KEY="sk-ant-..."
```

Then configure Claude Code to use it by editing `~/.claude/settings.json`:

```json
{
  "apiKeyHelper": "echo $ANTHROPIC_API_KEY"
}
```

This bypasses the interactive login prompt and authenticates via your API key instead.

## Launching Claude Code and Giving It Context

Start Claude Code from your project root:

```bash
claude
```

It picks up project-specific instructions from a `CLAUDE.md` file in your repo if one exists.

### The Most Important Cost-Saving Habit: Provide Context

If you type a vague prompt like:

```
add the authentication guard to all our services
```

Claude Code will scan your **entire** project — frontend, backend, configs, everything — burning through tokens to figure out what's relevant. It might succeed, but the cost will be painful.

Instead, scope it down using the `@` syntax to reference specific files and folders:

```
@api/ @api-v2/ @src/guards/authorization.guard.ts add the authentication guard to all services
```

Now Claude Code knows exactly where to look. Less scanning, fewer tokens, faster results.

## Plan Mode vs. Execute Mode

By default, Claude Code runs in **execute mode** — it will read files, write code, and run commands immediately.

If you want to review the plan before anything happens, cycle into **plan mode** with `Shift+Tab` (which cycles through permission modes). In plan mode, Claude Code:

1. Analyzes the codebase
2. Proposes a set of changes
3. Asks for your approval before executing anything

This is especially useful when you're not 100% sure what you want, or when working with production code where a wrong move is costly.

## Hooks: Guardrails That Prevent Costly Mistakes

This is where things get interesting. Claude Code can run shell commands — which means it can also run **destructive** shell commands. Hooks let you intercept commands *before* they execute and block the ones you don't want.

Hooks are shell scripts that Claude Code runs before performing an action. If the script exits with a non-zero status, the action is blocked.

### Example: Blocking Dangerous Git Operations

```bash
#!/bin/bash
# block_git_remote.sh — prevent Claude from pushing, force-flagging, or fetching
# Hooks receive JSON via stdin with the tool input

INPUT=$(cat)
COMMAND=$(echo "$INPUT" | jq -r '.tool_input.command')

if echo "$COMMAND" | grep -q "git push"; then
  echo "BLOCKED: Claude Code is not allowed to git push"
  exit 1
fi

if echo "$COMMAND" | grep -q "\-\-force"; then
  echo "BLOCKED: Force flags are not allowed"
  exit 1
fi

if echo "$COMMAND" | grep -qE "git (fetch|pull)"; then
  echo "BLOCKED: Claude Code cannot fetch or pull"
  exit 1
fi

exit 0
```

When Claude Code tries to `git push`, the hook fires, blocks the command, and Claude Code reports the failure — your remote stays untouched.

### More Hook Ideas

Here are real-world hooks worth considering:

**Block direct dependency file edits** — force Claude to use package managers:

```bash
#!/bin/bash
# Only allow adding dependencies through poetry or pnpm, not by editing lock files directly
INPUT=$(cat)
FILE=$(echo "$INPUT" | jq -r '.tool_input.file_path')
if echo "$FILE" | grep -qE "(package-lock\.json|poetry\.lock|yarn\.lock)"; then
  echo "BLOCKED: Use 'pnpm add' or 'poetry add' to manage dependencies"
  exit 1
fi
```

**Enforce architectural boundaries** — e.g., database access only in the DAL:

```bash
#!/bin/bash
# Block direct MongoDB imports outside the data access layer
INPUT=$(cat)
FILE=$(echo "$INPUT" | jq -r '.tool_input.file_path')
CONTENT=$(echo "$INPUT" | jq -r '.tool_input.content // .tool_input.new_string // empty')
if echo "$CONTENT" | grep -qE "(MongoClient|import.*mongo)" && ! echo "$FILE" | grep -q "/dal/"; then
  echo "BLOCKED: Database access is only allowed in the /dal/ directory"
  exit 1
fi
```

**Prevent destructive database operations:**

```bash
#!/bin/bash
# Block drop commands in any MongoDB-related code
INPUT=$(cat)
COMMAND=$(echo "$INPUT" | jq -r '.tool_input.command')
if echo "$COMMAND" | grep -qiE "\.drop\(|dropDatabase|dropCollection"; then
  echo "BLOCKED: Drop operations are not allowed"
  exit 1
fi
```

**Enforce toolchain consistency:**

```bash
#!/bin/bash
# Block wrong package managers and system tools
INPUT=$(cat)
COMMAND=$(echo "$INPUT" | jq -r '.tool_input.command')
if echo "$COMMAND" | grep -qE "^(yarn|npm) "; then
  echo "BLOCKED: Use pnpm, not yarn or npm"
  exit 1
fi
if echo "$COMMAND" | grep -q "^brew "; then
  echo "BLOCKED: Use mise, not brew"
  exit 1
fi
```

**Verify virtual environment is active:**

```bash
#!/bin/bash
# Ensure Python venv is activated before running Python commands
INPUT=$(cat)
COMMAND=$(echo "$INPUT" | jq -r '.tool_input.command')
if echo "$COMMAND" | grep -qE "^python|^pip" && [ -z "$VIRTUAL_ENV" ]; then
  echo "BLOCKED: Activate the virtual environment first (source .venv/bin/activate)"
  exit 1
fi
```

**Enforce conventional commits:**

```bash
#!/bin/bash
# Validate commit messages follow conventional commit format
INPUT=$(cat)
COMMAND=$(echo "$INPUT" | jq -r '.tool_input.command')
if echo "$COMMAND" | grep -q "git commit"; then
  MSG=$(echo "$COMMAND" | grep -oP '(?<=-m ")[^"]*')
  if ! echo "$MSG" | grep -qE "^(feat|fix|docs|style|refactor|test|chore|ci|perf)(\(.+\))?: .+"; then
    echo "BLOCKED: Commit message must follow conventional commits (e.g., feat: add auth guard)"
    exit 1
  fi
fi
```

The best part? You can ask Claude Code itself to write these hooks for you. Nobody wants to write bash from scratch.

Hooks are configured in your `.claude/settings.json`:

```json
{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "Bash",
        "hooks": [
          {
            "type": "command",
            "command": "/path/to/block_git_remote.sh"
          }
        ]
      }
    ]
  }
}
```

## Managing the Context Window

Claude Code has a finite context window. As your conversation grows, it fills up — and once it's full, quality degrades. Three built-in commands help:

| Command | What It Does |
|---------|-------------|
| `/stats` | Shows current context window usage |
| `/clear` | Wipes the conversation and starts fresh |
| `/compact` | Summarizes the conversation into a condensed form, freeing up space while retaining key context |

Use `/compact` when your session is getting long but you want to keep working. Use `/clear` when you're switching to an unrelated task.

## Agents: Parallel Sub-Tasks Without Polluting Your Context

Even with `/compact`, a single context window has limits. Agents solve this by spinning up **independent Claude Code sub-processes**, each with their own context window.

Custom agents are defined as markdown files in `~/.claude/agents/`. Here's an example:

```markdown
---
name: expert-concept-explainer
description: Explains technical concepts clearly for experienced engineers
model: claude-sonnet-4-6
---

You are a technical concept explainer. Given a topic, provide a clear,
thorough explanation suitable for an experienced software engineer.
Focus on practical understanding over academic theory.
```

Use them in your prompt with the `@` syntax:

```
@expert-concept-explainer explain in detail what LLMs are and how they work
```

The key advantage: **agents run in parallel and don't consume your main context window.** You can fire off multiple agents simultaneously:

```
@expert-concept-explainer explain what LLMs are and how they work
@claude-knowledge-expert what are hooks in Claude Code
```

Both agents run concurrently. Their internal context usage — all the files they read, searches they perform, tokens they consume — stays contained in their own sub-process. Your main session stays clean.

This is particularly useful for:

- **Research tasks** while you keep coding in the main session
- **Answering complex questions** that would eat up your context
- **Running multiple independent investigations** in parallel

## Quick Reference

| Feature | Purpose |
|---------|---------|
| `@file` or `@folder/` | Scope context to reduce token usage |
| `Shift+Tab` | Cycle through permission modes (including plan mode) |
| Hooks | Block dangerous or unwanted operations |
| `/stats` | Check context window usage |
| `/compact` | Compress conversation to free context |
| `/clear` | Reset conversation entirely |
| `@agent-name` | Delegate to a parallel sub-agent |

## Key Takeaways

1. **Always provide context** — referencing specific files and folders saves tokens and improves output quality.
2. **Use hooks aggressively** — they're your safety net against destructive commands, architectural violations, and toolchain drift. Let Claude Code write them for you.
3. **Monitor your costs** — check the usage dashboard regularly and pick the access model (subscription vs. API) that fits your usage pattern.
4. **Manage your context window** — use `/compact` before it fills up, and delegate to agents when a single context isn't enough.
5. **Plan before you execute** — use plan mode for anything non-trivial or unfamiliar.

Claude Code is a powerful tool, but like any tool that can execute arbitrary commands in your terminal, it needs guardrails. Set up your hooks, scope your prompts, and it becomes a remarkably effective coding partner.
