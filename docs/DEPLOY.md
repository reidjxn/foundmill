# DEPLOY.md — staging on Vercel + Railway + Supabase

What has to be configured outside the repository before foundmill.com runs the real app. Deployment is push-driven (docs/DECISIONS.md "Cloud-first build and deploy"): Vercel builds `apps/web` from `main`; every backend service builds from the root `Dockerfile` with the `APP` variable and starts with `pnpm --filter @foundmill/<app> start`. Nothing here contains a secret value; the values live in the Vercel and Railway dashboards.

## 1. Merge to `main`

Vercel's production branch is `main`. The cloud build lands on `main-emurwq`; merge it (or ask the session to push) once `pnpm typecheck && pnpm lint && pnpm test` and the Next build are green. Every commit must be authored as `Reid Jackson <40631036+reidjxn@users.noreply.github.com>` or Vercel blocks the deployment (DECISIONS.md "Commit identity").

## 2. Vercel (`apps/web`)

Project `foundmill` on the Hobby team `fm-2f083c2b` (`team_ekFhICxivRGPOQizeTB5lj0u`), root directory `apps/web`, domains foundmill.com and www.foundmill.com. DNS for foundmill.com is hosted at Spaceship (nameservers `launch1/launch2.spaceship.net`), not Vercel: the apex A records and the `www` CNAME already point at Vercel.

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

Project `founder-manager`, environment `production` (it is the staging environment; the name is Railway's default). One service per app, all connected to `reidjxn/foundmill` on `main`, root `Dockerfile`, service variable `APP` = `api` | `gateway` | `composer` | `stream` | `ingest` | `orchestrator` (`collab` and `social` are optional in staging). Railway's private network is IPv6; every service listens on `::` and reads `PORT` (ARCHITECTURE.md §17).

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

Before a service can be connected to the repository, Railway's GitHub app must be granted access to `reidjxn/foundmill` (Railway → Account settings → Integrations → GitHub → Configure); until then `serviceConnect` answers "User does not have access to the repo" and nothing builds. The three public subdomains need CNAME records at Spaceship (Railway reports `DNS_RECORD_STATUS_REQUIRES_UPDATE` until they exist):

| Host | CNAME target |
| --- | --- |
| `api` | `3zc87h09.up.railway.app` |
| `stream` | `1u5amaom.up.railway.app` |
| `ingest` | `3dl523vq.up.railway.app` |

Migrations run from the api at boot under an advisory lock; no manual `pnpm db:migrate` is needed. Without Temporal the api still answers every procedure (Continue runs one in-process cycle step and says so); without Redis the stream has no fan-out and the api logs one line and keeps serving.

## 4. Supabase

- Auth → URL configuration: site URL `https://foundmill.com`, redirect URLs `https://foundmill.com/auth/callback` and `https://www.foundmill.com/auth/callback`.
- Auth → Providers: Email with magic links enabled. Sign-in is magic link only.
- The database is the one `DATABASE_URL` points at; `vector` and `pg_trgm` extensions are created by migration 0001.

## 5. First sign-in

1. Open foundmill.com, request a magic link for the address in `SEED_OWNER_EMAILS`.
2. You land on Home of Northwind Skincare with two years of history; Ledgerly is the second business in the switcher (on holiday, Automated mode).
3. Settings → Keys to paste an Anthropic key (BYOK) when you want live agents; until then every agent runs in mock mode with deterministic output.

## 6. Staging status (2026-10-08, cloud session)

Checked against the Railway GraphQL API (team token), the Vercel and Supabase connectors, and the live site. ✅ done, ⬜ open and who can do it.

| Item | State |
| --- | --- |
| `main` carries the full build (`main-emurwq` merged, 0 commits apart) | ✅ |
| Railway services exist: api, gateway, composer, stream, ingest, orchestrator, temporal, temporal-ui, Redis, Postgres | ✅ (Redis, Postgres, temporal, temporal-ui deployed and healthy) |
| Shared variables on all six app services (APP, APP_ENV, INTEGRATIONS_MODE, MODEL_MODE, APP_URL, REDIS_URL, SUPABASE_URL, SESSION_TOKEN_SECRET, DEV_MASTER_KEY, LOG_LEVEL, DATA_REGION, TEMPORAL_*) | ✅ |
| api: `SEED_ON_BOOT=1`, `SEED_OWNER_EMAILS` | ✅ set 2026-10-08 |
| `TEMPORAL_TASK_QUEUE=foundmill` on api and orchestrator (was `founder-manager`) | ✅ set 2026-10-08 |
| `DATABASE_URL` on the app services | ⬜ **not visible through the API on any service**. Either it is a sealed variable (Railway hides those) or it was never set; the api's first boot log will say. If missing: Supabase → Project settings → Database → pooler connection string with `sslmode=require`, on api, gateway, composer, stream, ingest, orchestrator |
| `SUPABASE_SERVICE_ROLE_KEY` only on api | ⬜ it is on all six services; remove it from gateway, composer, stream, ingest and orchestrator (Railway dashboard, or allow the session's variable-delete call) |
| Railway services connected to `reidjxn/foundmill@main` | ⬜ blocked: Railway's GitHub app has no access to the repo (see §3). After granting it, the session can connect all six and the first deploys start |
| CNAMEs api/stream/ingest.foundmill.com → Railway | ⬜ at Spaceship, values in §3 |
| Vercel: project `foundmill` (team `fm-2f083c2b`) serves foundmill.com with `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY` baked in | ✅ (seen in the production bundle) |
| Vercel: `NEXT_PUBLIC_API_URL`, `NEXT_PUBLIC_STREAM_URL`, `NEXT_PUBLIC_INGEST_URL`, `NEXT_PUBLIC_APP_ENV=staging`, `NEXT_PUBLIC_INTEGRATIONS_MODE=mock` | ⬜ the live bundle falls back to `localhost:4000/4003/4005`, so these are unset. The Vercel connector in the cloud session is authorised for the `luminarvc` team only (403 on scope `fm-2f083c2b`); re-authorise it for team `fm-2f083c2b` (claude.ai → Customize → Connectors, then a new session) or set them in the Vercel dashboard, then redeploy |
| Supabase Auth URL configuration (site URL, the two `/auth/callback` redirect URLs) and Email provider with magic links | ⬜ no API for this in the Supabase connector; Dashboard → Authentication → URL Configuration / Providers. Email provider is on (public settings endpoint); redirect allow-list cannot be read from outside |
| First sign-in at foundmill.com | ⬜ the login page renders; a magic link cannot land on Home until the api is deployed and `NEXT_PUBLIC_API_URL` points at it |

## 7. Local stack without Postgres or Redis

```
pnpm install
SEED_TARGET=pglite pnpm db:seed                       # writes ./.pglite/dev and prints the DATABASE_URL to reuse
DATABASE_URL=pglite:./.pglite/dev APP_ENV=development DEV_AUTH_USER_ID=<printed owner id> pnpm --filter @foundmill/api dev
NEXT_PUBLIC_APP_ENV=development pnpm --filter @foundmill/web dev
```

PGlite allows one process per data directory, so only the api opens `./.pglite/dev`; the web talks to the api. The exact e2e stack is in `apps/web/e2e/README.md`.
