# ARCHITECTURE.md — build contracts

How the repo fits together and the contracts each package exposes to the others. `docs/BUILD.md` is the product spec; this file is what you code against. Read `docs/DECISIONS.md` for choices already made and `docs/DESIGN.md` for the look.

## 1. Layout and ownership

```
apps/web           Next.js 16 App Router. Shell + every surface. Talks to apps/api over tRPC and to apps/stream over WebSocket.
apps/api           Hono + tRPC. Auth context (Supabase JWT), membership checks, RLS-scoped queries, audit, events. Starts Temporal workflows.
apps/gateway       The only process that holds vendor secrets. Session tokens, Cedar policy, connectors (real or mock), metering, audit. Also serves MCP endpoints.
apps/orchestrator  Temporal worker: businessCycle, agentSession, approvalWait, channelEngine, trainingRun, holiday, playbook, incorporation, journeyBuild, importBusiness, schedules.
apps/composer      Inbox Composer + Refresh buffer + Journey commentary + chapter titles. HTTP service called by api and orchestrator.
apps/ingest        Webhook receivers (Stripe, SendGrid, GitHub, Shopify, ...) → verified → normalised platform events via the outbox.
apps/stream        WebSocket fan-out of Redis streams (ev:{businessId}, as:{sessionId}) to browser tabs.
apps/collab        Hocuspocus (Yjs) server for spec blocks.
apps/social        LIVE network, communities, leaderboards (Phase 4; skeleton only now).
packages/config    APP_NAME, feature flags, pricing tiers, limits. No dependencies.
packages/shared    Vocabulary types/enums (src/types.ts), errors, Result, money, ids, logger, crypto (envelope encryption), env parsing.
packages/dugout    Design system: tokens.css, fonts.css, dugout.css, every component, Storybook.
packages/db        Drizzle schema, SQL migrations, RLS, repos, seeds, PGlite test harness.
packages/events    Event catalogue (Zod), outbox writer, Redis relay, consumer helpers.
packages/models    Model routing (the only place model ids live), Anthropic client with mock mode, rate-limit buckets, cost metering.
packages/agents    Agent templates, prompt templates (§12), skill definitions, calibration, archetype seeds.
packages/policy    Cedar schema + policies + evaluator wrapper + tests.
packages/connectors Connector contract, registry, one folder per connector with real + mock.
packages/entity-linker Manifest builder, [[ent:id|Name]] parser/validator, Haiku sweep, render helpers.
packages/journey   Attribution, xC model, journey builder, synthetic journey data generator.
packages/widgets   Widget registry (key → component, default size, settings schema, data hook) shared by Home and department screens.
packages/modules   Built-in module screens (product, development, distribution, finance, team, legal) registered by module key + tab slug.
packages/sandbox   Sandbox interface; E2B, local Docker, and mock (replay) runners.
evals/             Golden tasks and rubrics per agent template and skill.
e2e/               Playwright suites.
```

Package names are `@foundmill/<dir>`. Every package exports TypeScript source directly:

```json
"exports": { ".": "./src/index.ts", "./*.css": "./src/*.css", "./*": "./src/*.ts" }
```

So `@foundmill/db/repos` resolves to `packages/db/src/repos.ts` (a file that re-exports `./repos/index`). Subpath modules are files, not directories.

## 2. Vocabulary (`packages/shared/src/types.ts`)

Every enum used by more than one package is defined once here as a `const` tuple with a matching Zod enum and TS type: game modes, business modes, plan tiers, archetypes, module keys, membership roles, inbox item types/states, agent statuses, model keys, channel keys and lines, task kinds/statuses, plan action types, conversion kinds, Customer Update levels (`matchday_level`), entity kinds, skill groups, integration statuses, visibility, event types. Import from `@foundmill/shared`. Do not redeclare these elsewhere.

Money is `{ amountMinor: number; currency: string }` (minor units, `bigint` in the DB, `number` in TS; values are below 2^53). Ids are UUID strings. Times are ISO strings on the wire and `Date` in TS.

## 3. Modes and environment

- `APP_ENV`: `development | test | staging | production`.
- `INTEGRATIONS_MODE`: `mock | live`. The connector registry returns `connector.mock` in mock mode. Default mock.
- `MODEL_MODE`: `mock | live`. `packages/models` returns recorded/deterministic completions in mock mode. Default mock. Evals always force live.
- Env is parsed once per process with Zod in `packages/shared/src/env.ts` (`loadEnv()`); never read `process.env` directly elsewhere. The web bundle only sees `NEXT_PUBLIC_*`.
- Ports (dev): web 3000, api 4000, gateway 4001, composer 4002, stream 4003, collab 4004, ingest 4005, social 4006. Services read `PORT` first (Railway sets it) and fall back to their named port.

## 4. Database (`packages/db`)

- `createDb(url)` → Drizzle `Db` over postgres.js. `createServiceDb()` reads `DATABASE_URL`.
- `withRls(db, { userId, role?: "authenticated" }, fn)` runs `fn(tx)` inside a transaction after `set local role authenticated` and `set local request.jwt.claims = '{"sub": "<userId>", "role": "authenticated"}'`. `apps/api` uses this for every user-originated query so Postgres RLS enforces tenancy.
- Service code (orchestrator, composer, ingest, gateway) uses the service role **through repositories only**: `repos.<area>.<fn>(db, businessId, ...)` with `businessId` as the required first argument after `db`. The ESLint rule `fm/no-raw-db` forbids `db.select/insert/update/delete/execute` outside `packages/db/src/repos/**`, migrations, seeds, tests and the events outbox.
- Repos live in `packages/db/src/repos/<area>.ts` and are re-exported from `src/repos.ts` as `repos`. Areas mirror BUILD §7.2 groups: `businesses`, `memberships`, `founders`, `ideas`, `product`, `departments`, `screens`, `dashboards`, `agents`, `skills`, `training`, `tasks`, `playbooks`, `holidays`, `inbox`, `plans`, `channels`, `campaigns`, `journeys`, `entities`, `finance`, `capTable`, `usage`, `legal`, `integrations`, `credentials`, `policies`, `approvals`, `audit`, `events`, `social`.
- Audit log: `repos.audit.append(db, businessId, { actorKind, actorId, action, target, details })` computes the hash chain. No update/delete grants.
- Migrations: SQL in `packages/db/migrations/*.sql` + `meta/_journal.json` (drizzle-kit format). `pnpm db:migrate` applies them. Schema in `src/schema/*.ts` mirrors the SQL (the SQL is the source of truth for RLS).
- Tests: `src/__tests__/rls/*.test.ts` run on PGlite via `src/testing/pglite.ts` (`createTestDb()` applies all migrations, creates a stub `auth.uid()` reading `request.jwt.claims`, and exposes `asUser(userId)`); `pnpm --filter @foundmill/db test:rls`.
- Seeds: `pnpm db:seed` builds Northwind Skincare and Ledgerly (BUILD §17.2) deterministically (seeded PRNG) and grants owner membership to `SEED_OWNER_EMAILS` (creating Supabase auth users through the admin API when `SUPABASE_SERVICE_ROLE_KEY` is set; on PGlite/test, users are plain rows in a stub `auth.users`).

## 5. Events (`packages/events`)

- `catalogue.ts` declares every event type from BUILD §8.1 with a Zod payload schema: `declareEvent("payment.received", schema)`. `EventType` is derived from the catalogue. Unknown types fail at write time.
- `writeEvent(tx, { businessId, type, actor, entityIds, payload, occurredAt? })` inserts into `events` and `outbox` in the caller's transaction and returns the event id.
- `runOutboxRelay(db, redis, { batch, intervalMs })` publishes unpublished outbox rows to Redis Stream `ev:{businessId}` (XADD, fields `id`, `type`, `json`) and marks them published. Runs inside `apps/api` (one instance) for staging.
- `consume(redis, { businessId | "*" , group, consumer, handler })` wraps XREADGROUP with ack and dead-letter after 5 failures. Consumers (BUILD §8.1): composer, journey, source-watcher, metrics, health, playbooks.
- Agent session streams: `as:{sessionId}` with fields `kind` (tool_call, stdout, file_changed, test_result, phase_changed, progress, note) and `json`. `publishSessionEvent(redis, sessionId, event)`.

## 6. Models (`packages/models`)

- `MODELS` and `ROUTES` exactly as BUILD §10.1 in `src/routing.ts`. `resolveModel(routeKey, override?)` applies lock/warn rules.
- `createModelClient({ mode, apiKey, onUsage })` → `client.complete({ route, system, messages, schema?, maxTokens?, cache? })`. With `schema` the result is parsed and validated (Zod) with one retry on invalid JSON. Mock mode: `src/mock/` returns deterministic responses keyed by route + a stable hash of the input, with handcrafted fixtures for composer, plan compiler, ideation, recommender, grader, coach, quarantined reader; unknown inputs fall back to a generic fixture per route.
- `RateLimiter` token buckets per key for requests/input/output tokens, refreshed from response headers; `429` → backoff with jitter for the affected session only.
- `meter(usage)` returns cost in minor units from `src/pricing.ts` (per model, per million tokens; prices are config, labelled estimates).

## 7. Policy (`packages/policy`)

- Cedar schema with entities `Agent`, `Tool`, `Business`, action `call`, and the context attributes from BUILD §9.5.
- `policies/*.cedar` with the hard-gate, suppression/untrusted-recipient, augmented-ask, assisted-caps and automated rules. `@outcome("ask")` annotations are read by the evaluator.
- `evaluate({ principal: AgentCtx, tool: ToolCtx, business: BusinessCtx, context })` → `{ outcome: "allow" | "ask" | "deny", reasons: string[], policyIds: string[] }`. Deny beats ask beats allow.
- Tests: every rule × every business mode, and "no Finance tool has a payment-initiation capability".

## 8. Connectors (`packages/connectors`)

- Contract exactly BUILD §13.1. `registry.get(key)` returns the real connector or `connector.mock` depending on `INTEGRATIONS_MODE`.
- Each connector folder: `index.ts` (real), `mock.ts`, `tools.ts` (tool definitions + policyHints), `webhooks.ts`, `fixtures/`, `*.test.ts` (contract tests against fixtures).
- Mock connectors are deterministic and can `simulate(eventName, params)` to emit platform events (used by the dev-only Simulate panel and by tests).

## 9. Gateway (`apps/gateway`)

HTTP (JSON), service-to-service auth with `SESSION_TOKEN_SECRET`-signed JWTs (`jose`):

- `POST /v1/session-tokens` (service auth) `{ businessId, agentId, sessionId, allowedTools, ttlSeconds, untrusted? }` → `{ token }`. `untrusted` (`{ emails, urls, phones, all }`) seeds the session's "first seen in untrusted content" register from the start: the orchestrator sends the recipients found in a code task's restored files. `LIVE_CONNECTORS` names connectors that run live while `INTEGRATIONS_MODE` is mock (GitHub first); an App connector (GitHub) runs live without a stored secret once the business's installation is connected **and verified**: status connected or degraded, and its installation id equal to the one the gateway recorded in `app_installations` (0015, written only by the gateway after checking with GitHub that the person connecting owns the account or administers the organisation). `commit_files` is further held to the repository chosen on Development › Code, while pushing is on, with `[skip ci]`.
- `POST /v1/integrations/connect` and `POST /v1/integrations/health` (service auth, App connectors only) `{ businessId, connector, input? }` → `{ mode, record }` / `{ health }`. App connectors' keys (the GitHub App's private key and OAuth client) live only in the gateway, so the api connects and health-checks GitHub through these; GitHub's connect verifies the installer with the OAuth code before it returns a connected record. Bodies are limited per route (16 MB `/v1/call`, 4 MB `/mcp`, 1 MB service routes).
- `POST /v1/call` (Bearer session token) `{ connector, tool, args, context? }` → `{ outcome, result?, approvalId?, costMinor, auditId }`. Pipeline: authenticate → load connector → Cedar → if `ask` create `approvals` row + `approval.requested` event and return `outcome: "ask"` → if `allow` inject credential (decrypted in memory) → call → meter → audit → return.
- `GET /v1/connectors` → catalogue with phase, auth kind, tools, policyHints.
- `ALL /mcp/:connector` streamable-HTTP MCP server exposing that connector's tools to the Claude Agent SDK; same pipeline.
- Rate limit per connector per business (Redis). All third-party content returned to agents is wrapped `{ untrusted: true, content }`.

## 10. Orchestrator (`apps/orchestrator`)

- Temporal worker on task queue `TEMPORAL_TASK_QUEUE`. Workflows in `src/workflows/*.ts` (pure, bundled), activities in `src/activities/*.ts`.
- `businessCycle(businessId)`: load brief → Chief of Staff plan (models) → dispatch `agentSession` children per task within concurrency/budget/rate capacity → collect → composer narrate → write `cycle.completed` → stop at time box.
- `agentSession(agentId, taskId)`: mints a gateway session token, acquires a sandbox (`packages/sandbox`), runs the Claude Agent SDK (live) or the recorded replay (mock), streams to `as:{sessionId}`, writes `usage_ledger`, heartbeats, loop detection, pauses on `approval` signal. Code tasks start from the task's latest saved workspace (restored before the session token is minted, so its recipients are untrusted from the first call) and save it again when the session ends, without secret files, credential values or start-up files (`workspace_snapshots` / `workspace_blobs`, written by the orchestrator only; read on Development › Code; owners and admins may forget a task's code). Each save is then pushed to the task's branch `agent/<taskId>` on the business's chosen repository with the GitHub connector's `commit_files`, through the gateway with a token for that one tool; the result is recorded on the save.
- Signals: `decision`, `shout`, `pause`, `resume`, `stop`, `founderSubmit`, `wake`. Queries: `progress`.
- `apps/api` starts workflows through `@temporalio/client`; workflow ids are deterministic: `cycle:{businessId}:{n}`, `session:{sessionId}`, `engine:{channelId}`, `holiday:{holidayId}`.
- When `TEMPORAL_ADDRESS` is unreachable in development, `pnpm dev` prints how to start `temporal server start-dev`.

## 11. Composer (`apps/composer`)

- `POST /v1/narrate` `{ businessId, eventIds }` → writes one `inbox_items` row (schema BUILD §11.3, validated with Zod, links validated by entity-linker, one re-ask on invalid ids) and returns it.
- `POST /v1/refresh` `{ businessId }` → exactly one new item from the buffer (priority: un-narrated event → data-change insight → next-best decision); refills the 3-item buffer asynchronously; debounced 3 s per business; p95 < 400 ms warm.
- `POST /v1/commentary` `{ journeyId }` → commentary lines for a Customer Update. `POST /v1/chapter-title` for quarters.

## 12. Stream (`apps/stream`)

WebSocket at `/?token=<supabase access token | dev token>`. Client → server: `{ "t": "sub", "ch": "ev:<businessId>" | "as:<sessionId>" }`, `{ "t": "unsub", "ch": ... }`, `{ "t": "ping" }`. Server → client: `{ "ch": "...", "e": <event json> }`, `{ "t": "pong" }`. Membership is checked per subscription. Per-channel throttling to 4 messages/s for unfocused tiles is done client-side; the server coalesces bursts to 20/s per socket.

## 13. API (`apps/api`)

- Hono app; `/trpc/*` via `@hono/trpc-server`; `/health`; `/webhooks/*` is **not** here (that is `apps/ingest`).
- On boot, before listening: run the drizzle migrator over `DATABASE_URL` under `pg_advisory_lock(7461)` (idempotent, safe with several replicas), then, if `SEED_ON_BOOT=1` and the demo businesses are absent, run the seed. Log and keep serving if the database is unreachable (health reports it).
- Context: `{ db, redis, temporal, userId, email, log }`. `protectedProcedure` requires a user; `businessProcedure` takes `{ businessId }` in input, asserts membership (and section permission where given) and provides `ctx.rls(fn)` = `withRls(db, { userId }, fn)`.
- Routers named exactly as BUILD §8.3 (`founder.profile.get`, `inbox.list`, …) in `src/routers/<area>.ts`, merged in `src/router.ts`; `export type AppRouter`. Every mutation: Zod input, membership + permission, `audit`, `writeEvent` where relevant.
- JWT verification: `jose` against `${SUPABASE_URL}/auth/v1/.well-known/jwks.json` (cached). `DEV_AUTH_USER_ID` bypass only when `APP_ENV` is development/test.
- Logos: `business.logo.{get,prepare,upload,generate,remove}` (owner/admin writes, audited) and `idea.logo.{prepare,generate}` before commit; `idea.commit` takes the chosen logo. Clients send a `data:` URL; `checkLogo` (`@foundmill/shared/logo`: raster magic bytes, size and dimensions, the strict SVG sanitiser) is the only gate, and `repos.logos.set` runs it again before writing `business_logos` (0017, service-written, read by members). `business.get` carries the logo's metadata only (`logo.sha256`); the image comes from `business.logo.get`, cached by that version. Renderers draw a logo only as `<img src>` of a value `isLogoDataUrl` accepts (the design system's `BusinessLogo`). Generation (`logoDesigner` route, Opus) is metered as an Estimate and limited per user and per business (`LIMITS.logoSets*`); upload checks are limited per user (`LIMITS.logoChecksPerUserPerHour`). Both limits are in process.

## 14. Web (`apps/web`)

- `app/layout.tsx` loads `@foundmill/dugout/fonts.css`, `tokens.css`, `dugout.css` and `app/globals.css` (`@import "tailwindcss"; @source "../../../packages/dugout/src"; @source "../../../packages/widgets/src"; @source "../../../packages/modules/src";`).
- Routes exactly BUILD §6.2. `app/b/[bid]/layout.tsx` renders `AppShell` with sidebar from `department.list`, brand colours from `business.get`, and the Continue state from `inbox.list` + the current cycle.
- `lib/trpc.ts` (`@trpc/tanstack-react-query` with superjson, `NEXT_PUBLIC_API_URL`, Bearer from Supabase session), `lib/supabase/client.ts` + `server.ts` (`@supabase/ssr`), `lib/stream.ts` (one WebSocket per tab, subscription multiplexer, focus-aware throttling), `lib/keys.ts` (keyboard map from BUILD §5.5 with `react-hotkeys-hook`).
- Department screens: `app/b/[bid]/d/[deptSlug]/[tabSlug]/page.tsx` loads the `screen_definition` and renders `WidgetGrid` with widgets from `@foundmill/widgets`; module full-screen widgets come from `@foundmill/modules` (`getModuleScreen(moduleKey, tabSlug)`).
- The LIVE pages (`/network`, `/communities[/id]`, `/leaderboards[/boardId]`, BUILD §6.2) are about the founder, not one business, so they live in the route group `app/(live)/`. Its layout loads the founder profile, picks the current business (`lib/auth/current-business.ts`: the `fm_last_business` cookie the business layout sets, else the newest business; none → `/new`) and renders the same `BusinessShell`, plus a `LiveViewerProvider` (who is signed in). They are signed-in only like every app route; a Personal current business gets a notice on the page, not an error.
- Below 1280 px the `b/[bid]` layout renders `NeedsLargerWindow` only (measured client-side, SSR renders the shell).
- `transpilePackages` in `next.config.ts` lists every `@foundmill/*` package.

## 15. Testing

- Unit: Vitest per package (`pnpm test`); DOM tests with happy-dom in `packages/dugout` and `apps/web`.
- RLS: PGlite harness (see §4).
- Policy: every rule × mode.
- E2E: `e2e/` Playwright against `pnpm dev` in mock mode with `DEV_AUTH_USER_ID` set to the seed owner; golden path spec names carry AC ids (e.g. `AC-11.3.3`).
- Evals: `evals/` Vitest with `MODEL_MODE=live`, skipped when no key.
- Vocabulary: `node scripts/banned-terms.mjs` (CI job `banned-terms`) fails on Football Manager / SI / SEGA anywhere in source and on football-only words (CLAUDE.md "Product vocabulary") in user-facing text: string literals, template literals and JSX text in apps/web, packages/dugout, packages/widgets, packages/modules, packages/agents/src/{prompts,templates}, apps/composer, plus the prose of docs/DESIGN.md and this file. Identifiers, enum keys, CSS tokens, import paths, class names and tests are not scanned; `--sweep docs/VOCAB_SWEEP.md` writes the hit list by package; a line marked `vocab-allow` is exempt (glossary entries only). Self-test: `node --test scripts/banned-terms.test.mjs`.
- CI e2e job (`.github/workflows/ci.yml`): seeds `pglite:./.pglite/e2e`, starts apps/api on :4000 and apps/web on :3000, runs `apps/web/e2e` and `e2e/` with `E2E_BASE_URL`; `continue-on-error: true` until the golden path is green. Chromium comes from `playwright install --with-deps chromium` on the runner; the build container's `/opt/pw-browsers/chromium` is used only when `FM_CHROMIUM` is set.

## 16. Rules for parallel build agents

1. **Own your directory.** Edit only the package/app you were assigned plus `docs/PROGRESS.md` (your rows) and `docs/DECISIONS.md` (append only). Never touch root files, `pnpm-workspace.yaml`, `pnpm-lock.yaml`, or another package.
2. **No installs, no new dependencies.** Everything you need is already installed (see the catalog in `pnpm-workspace.yaml`). If something essential is missing, append a line to `docs/NEEDED_DEPS.md` (`package — version — why — who`) and write the smallest local substitute so your package still typechecks.
3. **Check your work**: `pnpm --filter @foundmill/<name> typecheck`, `lint`, `test`. Fix every error in your package before you finish.
4. **No long-running servers on fixed ports** during the build phase (other agents share the machine). If you must boot something, use an ephemeral `PORT=0`/random port and stop it.
5. **Fetch current docs** before using an SDK (Temporal, Claude Agent SDK, Anthropic, Drizzle RLS, Tailwind v4, Storybook 10, react-grid-layout 2, TanStack Table 8, visx, PixiJS 8, xterm 6, Tiptap 3). Versions in the catalog are the truth.
6. **Mock first.** Everything must work with `INTEGRATIONS_MODE=mock` and `MODEL_MODE=mock`. Live paths are implemented but never required for tests.
7. **Design discipline.** UI follows `docs/DESIGN.md`. Tokens only, design-system components (`packages/dugout`) only, Lucide only, desktop only.
8. **Do not commit.** The orchestrating session commits between waves.
9. **Report** at the end: what exists, what is stubbed, commands that pass, and anything another package must know (exported names changed, contracts added).

## 17. Staging deployment notes (Railway + Vercel)

- Every backend service is built from the root `Dockerfile` (one image, `APP` build arg selects the package) and started with `pnpm --filter @foundmill/<app> start`.
- Railway's private network is IPv6-only: HTTP and WebSocket servers must listen on host `::` (not `127.0.0.1`, and prefer `::` over `0.0.0.0`). Read the port from `PORT` first (see §3).
- Internal URLs between services use `http://<service>.railway.internal:<port>` (e.g. `GATEWAY_URL=http://gateway.railway.internal:4001`, `TEMPORAL_ADDRESS=temporal.railway.internal:7233`, `REDIS_URL` from the Railway Redis service).
- Public URLs exist only for `api` (tRPC), `stream` (WebSocket), `ingest` (webhooks) and the Vercel-hosted `web`.
- `web` on Vercel has root directory `apps/web`; it reads `NEXT_PUBLIC_API_URL`, `NEXT_PUBLIC_STREAM_URL`, `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`.

## 18. Widget and module data contract

`packages/widgets` and `packages/modules` never import the tRPC client or the Next.js router. They read data through `WidgetDataSource` (packages/widgets/src/data.tsx): `useWidgetQuery(path, input)` for tRPC queries by dotted path (e.g. `"inbox.list"`), `mutate(path, input)`, `navigate(href)`, `subscribe(channel, handler)`, `businessId`, `glossary`. `apps/web` wraps every business page in `<WidgetDataProvider source={…}>` with an implementation backed by its tRPC client, router and stream client. Widgets register with `registerWidget({ key, title, defaultSize, settingsSchema, Component })`; module screens register with `registerModule({ key, screens })` and are looked up by `getModuleScreen(moduleKey, tabSlug)`. Screen definitions (`screen_definitions.layout`) reference widgets by key and module screens as `module:<moduleKey>/<tabSlug>`.
