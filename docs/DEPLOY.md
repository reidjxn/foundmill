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

Project `founder-manager`, environment `production` (it is the staging environment; the name is Railway's default). One service per app, all connected to `reidjxn/foundmill` on `main`, root `Dockerfile`, service variable `APP` = `api` | `gateway` | `composer` | `stream` | `ingest` | `orchestrator` (`collab` and `social` are optional in staging). Railway's private network is IPv6; every service listens on `::` and reads `PORT` (ARCHITECTURE.md §17). The `temporalio/auto-setup` service must have `TEMPORAL_ADDRESS=temporal.railway.internal:7233` (its own private domain), not `0.0.0.0:7233`: the server binds the container's IPv6 address, the setup script polls `TEMPORAL_ADDRESS` to register the `default` namespace, and with `0.0.0.0` it waits forever, so the orchestrator crashes with "Namespace default is not found" (fixed 2026-10-08).

Shared by every service:

| Variable | Value |
| --- | --- |
| `APP_ENV` | `staging` |
| `INTEGRATIONS_MODE` | `mock` (switch per connector later) |
| `MODEL_MODE` | `mock` until a BYOK key is stored through Settings → Keys |
| `APP_URL` | `https://foundmill.com` |
| `DATABASE_URL` | the Supabase Postgres connection string (Supabase → Connect → transaction pooler, port 6543, `?sslmode=require`). **Not set as of 2026-10-08**: the api boots and answers `/health` with `db:false`, composer/stream/ingest exit at start. Set it as a Railway shared variable and reference it from every app service, or paste it per service; it holds the database password, so only the founder can enter it |
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
| `DATABASE_URL` on the app services | ⬜ **confirmed missing** by the first boot (api `db:false`; composer, stream, ingest exit). Founder pastes the Supabase pooler string with `sslmode=require` (contains the DB password) on api, gateway, composer, stream, ingest, orchestrator, then redeploys |
| `SUPABASE_SERVICE_ROLE_KEY` only on api | ◐ removed from gateway, composer and stream in the dashboard (2026-10-08, local Chrome session); ingest and orchestrator still hold it. There is no collab service in staging |
| Railway services connected to `reidjxn/foundmill@main` | ✅ 2026-10-08, after the GitHub app was granted the repo; first builds succeed (Dockerfile + `APP` build arg work). api and gateway run; composer, stream, ingest wait on `DATABASE_URL`; orchestrator waited on the Temporal namespace (fixed, see §3) |
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
