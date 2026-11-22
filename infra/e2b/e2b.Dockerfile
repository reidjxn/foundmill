# The E2B template Foundmill's acceptance sandboxes start from (docs/DEPLOY.md §5 "Real agent sessions").
#
# Why a template: E2B's `base` image ships Node 20 and no pnpm, and its default sandbox has too little memory to install
# this workspace; the first live cycle of the Foundmill business (Oct 25, 2026) saw "dependency install was killed" and
# "Node v20.9.0 while the project asks for 22.23.3". The orchestrator can install the project's Node and pnpm at run time
# from the npm registry, but every run pays for it; this image has them ready, plus a Chromium for Playwright specs.
#
# Build (once per change): the GitHub Actions workflow "E2B sandbox template" (.github/workflows/e2b-template.yml) runs
#   npx @e2b/cli@2.22.3 template create foundmill-sandbox --path infra/e2b --dockerfile e2b.Dockerfile --cpu-count 4 --memory-mb 4096
# with the repository secret E2B_API_KEY; the same command works from any machine with the key in its environment (E2B
# CLI 2.x builds on E2B's side). Then set `E2B_TEMPLATE=foundmill-sandbox` on the orchestrator (Railway) and redeploy.
# The cpu and memory flags are the sandbox's size; raise them if installs are still killed. Hobby plans cap sandboxes
# lower than Pro: see e2b.dev/pricing.
#
# Same base as the service image (Dockerfile at the repository root): the versions the repository pins.
FROM node:22.23.3-bookworm

ENV PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers

# pnpm as the repository pins it (package.json `packageManager`), installed globally with npm so it is the same binary
# for every user (corepack keeps its copy in the installing user's cache, which E2B's `user` cannot see); git for
# checkouts, build tools for native modules, and the system libraries Chromium needs. Chromium itself is installed by
# Playwright below so its version matches the `@playwright/test` the workspace pins (pnpm-workspace.yaml catalog).
RUN npm install -g pnpm@12.9.1 \
 && apt-get update && apt-get install -y --no-install-recommends ca-certificates git python3 make g++ curl \
 && npx --yes playwright@1.63.0 install --with-deps chromium \
 && rm -rf /var/lib/apt/lists/* /root/.npm

# E2B runs commands as `user`; the browser must be readable by it.
RUN chmod -R a+rX /opt/pw-browsers

WORKDIR /home/user

# CLI-Anything (LAUNCH_EVALUATION.md §2, FOUNDMILL.md "Agents run software through CLI-Anything"): open-source programs the
# team drives through typed gateway tools (packages/connectors cli_*). Pinned to one commit, never a moving branch; a
# later upgrade is a pull request that moves CLI_ANYTHING_COMMIT and the record in infra/e2b/README.md. Programs first
# (Inkscape, LibreOffice, FFmpeg, then GIMP), then each CLI-Hub package from that same commit. CLI-Hub has no FFmpeg
# package at this commit, so FFmpeg is the program alone and the gateway's own wrapper drives it.
ARG CLI_ANYTHING_COMMIT=34f519533bc175d2fe287ab8316b0dd99bb9cc43
RUN apt-get update && apt-get install -y --no-install-recommends python3-pip python3-venv inkscape libreoffice-writer libreoffice-calc libreoffice-impress ffmpeg gimp fonts-dejavu-core \
 && rm -rf /var/lib/apt/lists/* \
 && python3 -m venv /opt/cli-anything \
 && for p in inkscape libreoffice gimp; do /opt/cli-anything/bin/pip install --no-cache-dir "git+https://github.com/HKUDS/CLI-Anything.git@${CLI_ANYTHING_COMMIT}#subdirectory=${p}/agent-harness"; done \
 && for p in inkscape libreoffice gimp; do ln -s /opt/cli-anything/bin/cli-anything-$p /usr/local/bin/cli-anything-$p; done \
 && mkdir -p /home/user/work && chmod 777 /home/user/work
