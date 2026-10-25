# The E2B template Foundmill's acceptance sandboxes start from (docs/DEPLOY.md §5 "Real agent sessions").
#
# Why a template: E2B's `base` image ships Node 20 and no pnpm, and its default sandbox has too little memory to install
# this workspace; the first live cycle of the Foundmill business (Oct 25, 2026) saw "dependency install was killed" and
# "Node v20.9.0 while the project asks for 22.23.3". The orchestrator can install the project's Node and pnpm at run time
# from the npm registry, but every run pays for it; this image has them ready, plus a Chromium for Playwright specs.
#
# Build (once per change, from the repository root, signed in to E2B with `e2b auth login`; the CLI needs Docker):
#   npx e2b@latest template build --name foundmill-sandbox --cpu-count 4 --memory-mb 4096 --dockerfile infra/e2b/e2b.Dockerfile --path infra/e2b
# Then set `E2B_TEMPLATE=foundmill-sandbox` on the orchestrator (Railway) and redeploy. The cpu and memory flags are the
# sandbox's size; raise them if installs are still killed. Hobby plans cap sandboxes lower than Pro: see e2b.dev/pricing.
#
# Same base as the service image (Dockerfile at the repository root): the versions the repository pins.
FROM node:22.23.3-bookworm

ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
ENV PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers

# pnpm as the repository pins it (package.json `packageManager`), git for checkouts, build tools for native modules, and
# the system libraries Chromium needs. Chromium itself is installed by Playwright below so its version matches the
# `@playwright/test` the workspace pins (pnpm-workspace.yaml catalog).
RUN corepack enable && corepack prepare pnpm@12.9.1 --activate \
 && apt-get update && apt-get install -y --no-install-recommends ca-certificates git python3 make g++ curl \
 && npx --yes playwright@1.63.0 install --with-deps chromium \
 && rm -rf /var/lib/apt/lists/* /root/.npm

# E2B runs commands as `user`; the browser and pnpm must be readable by it.
RUN chmod -R a+rX /opt/pw-browsers /pnpm

WORKDIR /home/user
