# One image for every Node service (docs/DECISIONS.md "Node services run with tsx in staging").
# Railway passes the service variable APP as a build arg: api | gateway | orchestrator | composer | stream | ingest | collab | social.
FROM node:22-bookworm-slim AS base
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
RUN corepack enable && corepack prepare pnpm@12.9.1 --activate \
 && apt-get update && apt-get install -y --no-install-recommends ca-certificates git python3 make g++ && rm -rf /var/lib/apt/lists/*
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
CMD ["sh", "-c", "pnpm --filter @founder-manager/${APP} start"]
