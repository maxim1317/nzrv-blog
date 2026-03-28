---
title: "Claude Code CLI: Hooks, Agents, and Cost Control Guide"
description: "Practical guide to using Claude Code effectively — managing costs with API keys and subscriptions, securing your workflow with hooks, scaling with custom agents, and composing atomic AI operations."
date: 2026-03-17
tags: ["ai", "claude", "claude-code", "cli", "developer-tools", "ai-coding-assistant"]
---


# Claude Code CLI: A Practical Guide to Hooks, Agents, and Cost Control

Claude Code is Anthropic's terminal-based AI coding assistant. Unlike the web-based Claude.ai, it runs directly in your shell, reads your project files, executes commands, and writes code — all from the command line. This post covers the practical side of using it effectively: managing costs, keeping it safe with hooks, composing atomic AI operations, and scaling with agents.

## Subscription vs. API Key: Choosing Your Access Model

There are two ways to use Claude Code:

**1. Personal subscription via [claude.ai](https://claude.ai)**

The Pro plan ($20/month) and Max plan ($100/month) give you access through your personal account. Usage is rate-limited with a session window — you get a quota that resets on a rolling basis. Hit the limit and you're locked out until the window resets. The Max subscription token can also be used like an API key with generous limits, offering a middle ground between predictable billing and continuous access.

**2. API key via [console.anthropic.com](https://console.anthropic.com)**

Pay-as-you-go pricing based on actual token usage. No session lockouts — you pay for exactly what you use. You can monitor costs in the **Usage** dashboard, filter by model, token type, and date range. Better if you need uninterrupted access or want fine-grained cost visibility. Be aware that heavy Opus usage can easily reach $100+/day.

**Rule of thumb:** if you're consistently spending more than $20/month on API tokens and can tolerate occasional rate limits, switch to a subscription. If you need continuous, unthrottled access, stick with the API key.

### Understanding API Caching

The API caches frequently-read source files. Cache writes cost more than regular tokens, but cache reads are dramatically cheaper. If you're working on the same files repeatedly, caching can reduce your effective cost by 60–70%.

**Pricing reference (Sonnet 4):**

| Token Type | Cost per 1M tokens |
|-----------|-------------------|
| Input | $3.00 |
| Cache Write (5 min) | $3.75 |
| Cache Write (1 hour) | $6.00 |
| Cache Read | $0.30 |

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

Claude Code will scan your **entire** project — frontend, backend, configs, everything — burning through tokens to figure out what's relevant. It might succeed, but the cost will be painful. Token usage can jump from thousands to millions.

Instead, scope it down using the `@` syntax to reference specific files and folders:

```
@api/ @api-v2/ @src/guards/authorization.guard.ts add the authentication guard to all services
```

Now Claude Code knows exactly where to look. Less scanning, fewer tokens, faster results.

### Use Plan Mode Strategically

By default, Claude Code runs in **execute mode** — it will read files, write code, and run commands immediately.

If you want to review the plan before anything happens, cycle into **plan mode** with `Shift+Tab` (which cycles through permission modes). In plan mode, Claude Code:

1. Analyzes the codebase
2. Proposes a set of changes
3. Asks for your approval before executing anything

For small tasks, execute directly. For large tasks that would require scanning many files, let Claude plan first — the planning cost is offset by much more efficient execution. This is also useful when working with production code where a wrong move is costly.

## Hooks: Hard Guardrails for Your AI Agent

This is where things get interesting. Claude Code can run shell commands — which means it can also run **destructive** shell commands. Hooks let you intercept commands *before* they execute and block the ones you don't want.

Unlike prompt instructions ("please don't do X"), hooks are enforced at the system level — Claude cannot bypass them. When the hook script exits with a non-zero status, the action is blocked.

A key principle: **tell the LLM what to do, not what to avoid.** Negative instructions ("don't do X") tend to work poorly in prompts. Instead, use hooks to enforce hard boundaries and use prompts for positive guidance ("always use conventional commit format").

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

### Production Hook Examples

Here's a summary of hooks used in real production environments:

| Hook | Purpose |
|------|---------|
| Block `git push`, `git pull`, `git fetch` | Prevent unintended remote operations |
| Block `--force` flag | Prevent force-pushes and destructive operations |
| Block `pip install` | Enforce Poetry/pnpm as the only package managers |
| Block direct lockfile edits | Force use of `pnpm add` or `poetry add` |
| Block `drop_collection` / `drop_db` | Prevent accidental database destruction |
| Enforce data access layer | Only allow MongoDB imports from the DAL directory |
| Verify virtual environment | Ensure venv is activated before running Python |
| Enforce conventional commits | Validate commit message format |
| Completion notification | Play a sound and show a notification when Claude finishes a task |

### Hook Implementations

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

## Skills: Lazy-Loaded Specialized Knowledge

Skills in Claude Code are packaged bundles containing:

- A `skill.md` file with a description (always kept in memory for routing)
- A `references/` directory with supporting materials (loaded on demand)
- Optional scripts and executables

Claude keeps only the skill descriptions in its context window at all times. The full skill content is loaded via **lazy loading** only when Claude determines it's relevant. This is an important distinction from `CLAUDE.md`, which is always fully loaded.

You can create skills using Claude's built-in **Skill Creator**. For example, a time management skill might include references to productivity techniques (Pomodoro, Eisenhower Matrix, time-blocking) that Claude pulled from the web and compressed into its reference files.

### Hooks vs. Skills

This distinction matters:

- **Hooks** are **hard triggers** attached to events. Claude cannot choose to skip them. They execute automatically before/after tool use, regardless of Claude's intent.
- **Skills** are **soft resources** that Claude chooses to activate when it determines they're relevant. Claude can decide not to use a skill.

Think of hooks as laws and skills as reference books.

## Atomic AI Operations: Inspired by Fabric

The [Fabric](https://github.com/danielmiessler/fabric) project introduces a powerful concept: **atomic AI operations** that can be piped together like Unix commands.

The idea is to use `claude -p` (Claude's pipe mode) with reusable prompt templates called "patterns."

### AI-Powered Git Commits

```bash
#!/bin/bash
# ai_git.sh - Generate conventional commit messages from diffs
DIFF=$(git diff --cached)
PATTERN=$(cat ~/.patterns/create_git_commit_message_from_diff.md)
echo "$PATTERN\n\n$DIFF" | claude -p
```

The pattern file contains static instructions:

```markdown
Follow conventional commit format strictly.
Do not include any quotes, additional text, greetings, or commentary.
You will receive a git diff dump.
Create a commit message based on this diff.
Output ONLY the commit message, nothing else.
```

### Inline Code Generation

```bash
# cg - code generation alias
# Usage: cg "write a Python loop over 100 elements"
# Or pipe from a text editor selection:
echo "write a Python loop over 100 elements" | ai_codegen.sh
```

The beauty of this approach: these atomic operations compose. You can select text in your editor, pipe it through an AI code generator, and have the result replace your selection. No context switching, no chat interface needed.

Fabric's repository contains hundreds of curated patterns for different tasks — analyzing builds, summarizing content, extracting insights, and more. You can feed the pattern catalog to Claude and ask which ones are relevant to your workflow.

## Superpowers Plugin: Structured Workflows

The **Superpowers** plugin for Claude Code adds a structured multi-phase workflow:

1. **Brainstorming** — a dedicated skill for exploring ideas
2. **Planning** — creates a detailed plan from the brainstorm
3. **Execution** — either sequential (sub-agent driven) or parallel (multiple agents with checkpoints syncing between them)

Combined with **Opus at maximum effort**, this produces slower but significantly more reliable output. The tradeoff is real: it's noticeably slower, but the quality of the results is much higher.

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

The practical value isn't about fancy orchestration; it's about **context window management**. When you ask a question that requires scanning many files, doing it in the main session fills your context window with file contents you may never need again. Instead, delegate the research to a sub-agent:

- The sub-agent gets its own context window
- It does all the heavy reading and analysis
- Only the final answer comes back to your main session

In practice, a sub-agent might consume 26,000+ tokens doing its analysis, but only ~600 tokens are added to the main context window. For long coding sessions, this keeps your primary context clean and responsive.

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
| Hooks | Block dangerous or unwanted operations (hard enforcement) |
| Skills | Lazy-loaded specialized knowledge (soft activation) |
| `claude -p` | Pipe mode for atomic AI operations |
| `/stats` | Check context window usage |
| `/compact` | Compress conversation to free context |
| `/clear` | Reset conversation entirely |
| `@agent-name` | Delegate to a parallel sub-agent |

## Key Takeaways

1. **Always provide context** — referencing specific files and folders saves tokens and improves output quality.
2. **Use hooks aggressively** — they're your safety net against destructive commands, architectural violations, and toolchain drift. Tell the LLM what to do in prompts; use hooks to enforce what it must not do.
3. **Monitor your costs** — check the usage dashboard regularly, understand caching dynamics, and pick the access model (subscription vs. API) that fits your usage pattern.
4. **Manage your context window** — use `/compact` before it fills up, and delegate to agents when a single context isn't enough. Sub-agents keep your main session lean.
5. **Plan before you execute** — use plan mode for anything non-trivial or unfamiliar.
6. **Compose atomic operations** — use `claude -p` with reusable patterns to build Unix-style AI pipelines for repetitive tasks.
7. **Know the difference between hooks and skills** — hooks are laws (always enforced), skills are reference books (activated on demand).

Claude Code is a powerful tool, but like any tool that can execute arbitrary commands in your terminal, it needs guardrails. Set up your hooks, scope your prompts, and it becomes a remarkably effective coding partner.
