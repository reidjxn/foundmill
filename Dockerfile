# One image for every Node service (docs/DECISIONS.md "Node services run with tsx in staging").
# Railway passes the service variable APP as a build arg: api | gateway | orchestrator | composer | stream | ingest | collab | social.
FROM node:22-bookworm-slim AS base
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
RUN corepack enable && corepack prepare pnpm@12.9.1 --activate \
 && apt-get update && apt-get install -y --no-install-recommends ca-certificates git python3 make g++ tini && rm -rf /var/lib/apt/lists/*
WORKDIR /app

FROM base AS deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
COPY apps ./apps
COPY packages ./packages
COPY evals ./evals
COPY e2e ./e2e
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
