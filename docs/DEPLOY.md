# DEPLOY.md — staging on Vercel + Railway + Supabase

What has to be configured outside the repository before foundmill.com runs the real app. Deployment is push-driven (docs/DECISIONS.md "Cloud-first build and deploy"): Vercel builds `apps/web` from `main`; every backend service builds from the root `Dockerfile` with the `APP` variable and starts with `pnpm --filter @foundmill/<app> start`. Nothing here contains a secret value; the values live in the Vercel and Railway dashboards.

## 1. Merge to `main`

Vercel's production branch is `main`. The cloud build lands on `main-emurwq`; merge it (or ask the session to push) once `pnpm typecheck && pnpm lint && pnpm test` and the Next build are green. Every commit must be authored as `Reid Jackson <40631036+reidjxn@users.noreply.github.com>` or Vercel blocks the deployment (DECISIONS.md "Commit identity").

## 2. Vercel (`apps/web`)

Project `foundmill`, root directory `apps/web`, domains foundmill.com and www.foundmill.com.

| Variable | Value |
| --- | --- |
| `NEXT_PUBLIC_APP_ENV` | `staging` |
| `NEXT_PUBLIC_API_URL` | `https://api.foundmill.com` |
| `NEXT_PUBLIC_STREAM_URL` | `wss://stream.foundmill.com` |
| `NEXT_PUBLIC_INGEST_URL` | `https://ingest.foundmill.com` |
| `NEXT_PUBLIC_COLLAB_URL` | `wss://collab.foundmill.com` (optional; the Specification tab falls back to the local editor without it) |
| `NEXT_PUBLIC_SUPABASE_URL` | the Supabase project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | the Supabase anon key |
| `NEXT_PUBLIC_INTEGRATIONS_MODE` | `mock` until live keys exist |

Build command and output are Next defaults. `NODE_OPTIONS=--max-old-space-size=4096` if the build runs out of memory on the Hobby tier.

## 3. Railway (backend services)

One service per app, all connected to `reidjxn/foundmill` on `main`, root `Dockerfile`, service variable `APP` = `api` | `gateway` | `composer` | `stream` | `ingest` | `orchestrator` (`collab` and `social` are optional in staging). Railway's private network is IPv6; every service listens on `::` and reads `PORT` (ARCHITECTURE.md §17).

Shared by every service:

| Variable | Value |
| --- | --- |
| `APP_ENV` | `staging` |
| `INTEGRATIONS_MODE` | `mock` (switch per connector later) |
| `MODEL_MODE` | `mock` until a BYOK key is stored through Settings → Keys |
| `APP_URL` | `https://foundmill.com` |
| `DATABASE_URL` | the Supabase Postgres connection string (pooler, `sslmode=require`); already set |
| `REDIS_URL` | from the Railway Redis service |
| `SUPABASE_URL` | the Supabase project URL |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase service role key (api and collab only; never on the web) |
| `SUPABASE_JWT_SECRET` | optional; lets the api/stream verify HS256 tokens without JWKS |
| `SESSION_TOKEN_SECRET` | 32+ random bytes, identical on api, gateway and orchestrator |
| `DEV_MASTER_KEY` | output of `generateMasterKey()` from `@foundmill/shared` (base64, 32 bytes); identical on api and gateway. Set `KMS_KEY_ID` instead when an AWS KMS key exists |
| `LOG_LEVEL` | `info` |
| `DATA_REGION` | `eu` |

Per service:

| Service | Extra variables |
| --- | --- |
| api | `SEED_ON_BOOT=1` on the first boot only (creates Northwind Skincare and Ledgerly when absent), `SEED_OWNER_EMAILS=<your email>` so your Supabase user owns both demo businesses, `COMPOSER_URL=http://composer.railway.internal:4002`, `GATEWAY_URL=http://gateway.railway.internal:4001`, `TEMPORAL_ADDRESS=temporal.railway.internal:7233`, `TEMPORAL_TASK_QUEUE=foundmill` |
| gateway | none beyond shared |
| composer | none beyond shared |
| stream | none beyond shared (public domain stream.foundmill.com) |
| ingest | `STRIPE_WEBHOOK_SECRET`, `SENDGRID_WEBHOOK_PUBLIC_KEY`, `GITHUB_WEBHOOK_SECRET` when those webhooks go live (public domain ingest.foundmill.com) |
| orchestrator | `TEMPORAL_ADDRESS`, `TEMPORAL_NAMESPACE=default`, `TEMPORAL_TASK_QUEUE=foundmill`, `GATEWAY_URL`, `COMPOSER_URL` |

Migrations run from the api at boot under an advisory lock; no manual `pnpm db:migrate` is needed. Without Temporal the api still answers every procedure (Continue runs one in-process cycle step and says so); without Redis the stream has no fan-out and the api logs one line and keeps serving.

## 4. Supabase

- Auth → URL configuration: site URL `https://foundmill.com`, redirect URLs `https://foundmill.com/auth/callback` and `https://www.foundmill.com/auth/callback`.
- Auth → Providers: Email with magic links enabled. Sign-in is magic link only.
- The database is the one `DATABASE_URL` points at; `vector` and `pg_trgm` extensions are created by migration 0001.

## 5. First sign-in

1. Open foundmill.com, request a magic link for the address in `SEED_OWNER_EMAILS`.
2. You land on Home of Northwind Skincare with two years of history; Ledgerly is the second business in the switcher (on holiday, Automated mode).
3. Settings → Keys to paste an Anthropic key (BYOK) when you want live agents; until then every agent runs in mock mode with deterministic output.

## 6. Local stack without Postgres or Redis

```
pnpm install
SEED_TARGET=pglite pnpm db:seed                       # writes ./.pglite/dev and prints the DATABASE_URL to reuse
DATABASE_URL=pglite:./.pglite/dev APP_ENV=development DEV_AUTH_USER_ID=<printed owner id> pnpm --filter @foundmill/api dev
NEXT_PUBLIC_APP_ENV=development pnpm --filter @foundmill/web dev
```

PGlite allows one process per data directory, so only the api opens `./.pglite/dev`; the web talks to the api. The exact e2e stack is in `apps/web/e2e/README.md`.
