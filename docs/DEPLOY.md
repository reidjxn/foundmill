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
| `MODEL_MODE` | `live` on api, composer and orchestrator once `ANTHROPIC_API_KEY` is set on them (a service with `live` and no key logs one error and runs on the mock client, so the order does not matter); `mock` elsewhere |
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
| api | `COMPOSER_URL=http://composer.railway.internal:4002`, `GATEWAY_URL=http://gateway.railway.internal:4001`, `TEMPORAL_ADDRESS=temporal.railway.internal:7233`, `TEMPORAL_TASK_QUEUE=foundmill`, `SEED_ON_BOOT=1` and `SEED_OWNER_EMAILS=<the address you sign in with>` (comma-separated for several). On a database with neither demo business the api builds Northwind Skincare and Ledgerly in the background after it starts (owners through the Supabase admin API, so `SUPABASE_SERVICE_ROLE_KEY` must be set); once both exist it only adds missing owner memberships, so an address added later becomes an owner on the next boot. It never deletes: a half-built seed is logged and left for `pnpm db:seed`. `SEED_VOLUME_SCALE` (default 1, two years of history) shrinks the data. An owner without a founder profile gets the demo profile, so the first sign-in lands on Northwind's Home; edit it from the profile screen |
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

## 5. First sign-in and live agents

1. Open foundmill.com and sign in with a magic link. A new founder lands on the onboarding profile, then `/new` (Ideation Studio or Import), then Commit, which creates the business, its departments and its agent team. The exception is an address in the api's `SEED_OWNER_EMAILS` while `SEED_ON_BOOT=1`: the first boot on an empty database builds the demo businesses (Northwind Skincare, Ledgerly) with that address as owner, so signing in with it lands on Northwind's Home, and the founder can still start their own business from `/new`.
2. **Live models.** api, composer and orchestrator call Anthropic with the platform key `ANTHROPIC_API_KEY` from their Railway variables when `MODEL_MODE=live` (set on all three since 2026-10-08). Add the key as a project shared variable and reference it from those three services (`ANTHROPIC_API_KEY=${{shared.ANTHROPIC_API_KEY}}`); until it is there they run on the mock client and log one error at boot. Settings → Keys (`/b/<business id>/settings/keys`) stores a per-business key, which the orchestrator uses only when the business's model billing is `byok`; the api and composer always use the platform key. Model ids live in `packages/models/src/routing.ts` (Opus 5.5, Sonnet 5.5, Haiku 4.5; re-verified 2026-10-08).
3. **Real agent sessions.** With `INTEGRATIONS_MODE=mock` the orchestrator replays recorded sessions. Set `SANDBOX_MODE=e2b` and `E2B_API_KEY` on the orchestrator for real sandboxes while connectors stay in mock; `INTEGRATIONS_MODE=live` switches every connector to its vendor API and needs each vendor's key.

## 6. Staging status (2026-10-08, cloud session)

Checked against the Railway GraphQL API (team token), the Vercel and Supabase connectors, and the live site. ✅ done, ⬜ open and who can do it.

| Item | State |
| --- | --- |
| `main` carries the full build (`main-emurwq` merged, 0 commits apart) | ✅ |
| Railway services exist: api, gateway, composer, stream, ingest, orchestrator, temporal, temporal-ui, Redis, Postgres | ✅ (Redis, Postgres, temporal, temporal-ui deployed and healthy) |
| Shared variables on all six app services (APP, APP_ENV, INTEGRATIONS_MODE, MODEL_MODE, APP_URL, REDIS_URL, SUPABASE_URL, SESSION_TOKEN_SECRET, DEV_MASTER_KEY, LOG_LEVEL, DATA_REGION, TEMPORAL_*) | ✅ |
| api: `SEED_ON_BOOT=1`, `SEED_OWNER_EMAILS=reidjcksn@gmail.com` | ✅ 2026-10-08: seed-on-boot implemented (`apps/api/src/services/seed-on-boot.ts`); the owner is the address the founder signs in with |
| `TEMPORAL_TASK_QUEUE=foundmill` on api and orchestrator (was `founder-manager`) | ✅ set 2026-10-08 |
| `DATABASE_URL` on the app services | ✅ Supabase transaction pooler string as a shared variable on all six |
| `SUPABASE_SERVICE_ROLE_KEY` only on api | ✅ checked 2026-10-08: present on api, absent from gateway, composer, orchestrator, stream and ingest (there is no collab service in staging) |
| Railway services connected to `reidjxn/foundmill@main` | ✅ 2026-10-08, after the GitHub app was granted the repo; first builds succeed (Dockerfile + `APP` build arg work). all six app services deploy on every push to `main` and run (checked at 311cca1) |
| CNAMEs api/stream/ingest.foundmill.com → Railway | ✅ all three answer `/health` with 200 |
| Vercel: project `foundmill` (team `fm-2f083c2b`) serves foundmill.com with `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY` baked in | ✅ (seen in the production bundle) |
| Vercel: `NEXT_PUBLIC_API_URL`, `NEXT_PUBLIC_STREAM_URL`, `NEXT_PUBLIC_INGEST_URL`, `NEXT_PUBLIC_APP_ENV=staging`, `NEXT_PUBLIC_INTEGRATIONS_MODE=mock` | ✅ |
| Supabase Auth URL configuration (site URL, the two `/auth/callback` redirect URLs) and Email provider with magic links | ✅ set in the dashboard |
| First sign-in at foundmill.com | ✅ reidjcksn@gmail.com signs in; `/` serves the landing page when signed out |
| Demo businesses (Northwind Skincare, Ledgerly) owned by reidjcksn@gmail.com | ✅ built by SEED_ON_BOOT on 2026-10-08 (about 6 minutes on Supabase); Northwind is the newer, so a first sign-in opens it |
| `ANTHROPIC_API_KEY` on api, composer and orchestrator with `MODEL_MODE=live` | ✅ 2026-10-08: all three boot without the mock fallback; the key lists claude-opus-5-5, claude-sonnet-5-5 and claude-haiku-4-5-20251001 |
| Real agent sessions: `SANDBOX_MODE=e2b` and `E2B_API_KEY` on the orchestrator | ✅ 2026-10-08: key valid; one real round trip through `resolveSandboxProvider` (create, start, exec, egress refused, stop) in about 10 s. ⬜ code tasks: the agent edits files in the orchestrator's session workspace, which never reaches the sandbox, so their acceptance run (`pnpm test` in the sandbox) reports a failure until the workspace is synced into it |
| Live connectors: `INTEGRATIONS_MODE=live` plus each vendor key on the gateway | ⬜ every service runs `mock` |

## 7. Local stack without Postgres or Redis

```
pnpm install
SEED_TARGET=pglite pnpm db:seed                       # writes ./.pglite/dev and prints the DATABASE_URL to reuse
DATABASE_URL=pglite:./.pglite/dev APP_ENV=development DEV_AUTH_USER_ID=<printed owner id> pnpm --filter @foundmill/api dev
NEXT_PUBLIC_APP_ENV=development pnpm --filter @foundmill/web dev
```

PGlite allows one process per data directory, so only the api opens `./.pglite/dev`; the web talks to the api. The exact e2e stack is in `apps/web/e2e/README.md`.
