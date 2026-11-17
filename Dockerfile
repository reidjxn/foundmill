# One image for every Node service (docs/DECISIONS.md "Node services run with tsx in staging").
# Railway passes the service variable APP as a build arg: api | gateway | orchestrator | composer | stream | ingest | sites | collab.
# Pinned (#439): pnpm 12 needs corepack >= 0.34.7, which Node bundles from 22.23.3 (corepack 0.36.0); an older base
# layer installs a pnpm shim that cannot start ("Cannot find module …/bin/pnpm.cjs").
FROM node:22.23.3-bookworm-slim AS base
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
RUN corepack enable && corepack prepare pnpm@12.9.1 --activate \
 && apt-get update && apt-get install -y --no-install-recommends ca-certificates git python3 make g++ tini && rm -rf /var/lib/apt/lists/*
WORKDIR /app

FROM base AS deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
# pnpm applies patches/ while installing (pnpm-workspace.yaml `patchedDependencies`: postgres.js, docs/DECISIONS.md
# "Round trips per procedure"); without the folder the frozen install fails.
COPY patches ./patches
COPY apps ./apps
COPY packages ./packages
COPY evals ./evals
COPY e2e ./e2e
# infra/e2b is the acceptance sandbox's template (infra/e2b/README.md); the orchestrator's Railway pre-deploy command
# builds it from inside this image with the E2B key the service holds, so the key never leaves Railway.
COPY infra ./infra
RUN pnpm install --frozen-lockfile

FROM deps AS runtime
ARG APP=api
ENV APP=${APP}
ENV NODE_ENV=production
ENV APP_ENV=staging
EXPOSE 4000
# Shutdown (docs/DEPLOY.md §3 "Redeploys and shutdown"): Railway sends SIGTERM to PID 1 and SIGKILL `drainingSeconds`
# later (railway.toml). tini is PID 1: it forwards the signal and reaps orphans. `exec` replaces the shell, so the
# service's own node process is tini's only child and receives SIGTERM itself. Not `pnpm start` (`tsx src/index.ts`):
# corepack's pnpm shim dies on SIGTERM without passing it on, and sh as PID 1 ignored it, so services were SIGKILLed
# mid-request. `node --import tsx` runs the same TypeScript entry as the package's start script, in the same directory.
# A custom Start Command in the Railway dashboard replaces this ENTRYPOINT; leave it empty.
ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["sh", "-c", "cd apps/${APP} && exec node --import tsx src/index.ts"]
