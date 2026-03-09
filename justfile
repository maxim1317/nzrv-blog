hostname := env("DEPLOY_HOST", "frrcode")
deploy:
    pnpm run build
    rsync -avz --delete dist/ {{hostname}}:deployments/blog/

