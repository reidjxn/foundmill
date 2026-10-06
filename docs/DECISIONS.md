# DECISIONS.md

Decisions this build has taken where `docs/BUILD.md` left room. Each entry: the decision, the option chosen, why. Newest at the bottom.

## 2026-10-05 — Toolchain versions (BUILD §3.1 "record exact versions")

Pinned in `pnpm-workspace.yaml` under `catalog:` (one version per dependency for the whole repo). Highlights:

| Layer | Version | Note |
| --- | --- | --- |
| Node / pnpm | 22.x / 12.9.1 | corepack-managed |
| TypeScript | 5.9.3 | TypeScript 7.0 (the native port) is published but tooling compatibility (Next, typescript-eslint, Storybook) is not yet uniform; stay on 5.9 |
| Next.js / React | 16.3.8 / 19.3.0 | App Router |
| Tailwind | 4.3.3 | CSS-first config; Dugout tokens mapped through `@theme` |
| TanStack Query / Table | 5.104 / 8.21.3 | react-table 9.x exists but its API is new; 8.x is the documented virtualised-table path |
| react-grid-layout | 2.3.0 | current major; check its README before use |
| Storybook | 10.6.1 | react-vite framework |
| Drizzle | 0.45.3 (+ drizzle-kit 0.31.11) | SQL migrations in `packages/db/migrations` |
| Hono / tRPC | 4.13 / 11.19 | `@hono/trpc-server` adapter |
| Temporal TS SDK | 1.24.0 | |
| Claude Agent SDK / Anthropic SDK | 0.3.291 / 0.131.0 | |
| Cedar | `@cedar-policy/cedar-wasm` 4.13.0 | |
| Vitest / Playwright | 5.0.3 / 1.63.0 | |
| ESLint | 9.39.5 flat config | custom `fm/no-raw-db` rule inline in `eslint.config.mjs`; the events outbox/relay/consumer files are allow-listed because they are the data layer for events |

## 2026-10-05 — Model ids (BUILD §10.1)

`packages/models/src/routing.ts` uses `claude-opus-5-5`, `claude-sonnet-5-5`, `claude-haiku-4-5-20251001`, as given in BUILD.md and matching Anthropic's current model list at the time of writing. Re-verify before Phase 1 live smoke.

## 2026-10-05 — No Docker on the build machine

Docker is not installed on the machine this was built on. Consequences:
- **RLS cross-tenant tests run on PGlite** (`@electric-sql/pglite`, real Postgres compiled to WASM, supports roles, RLS, `pg_trgm`, `pgvector`). The test harness creates a stub `auth` schema with `auth.uid()` reading `request.jwt.claims`, applies the SQL migrations, and switches roles per test. The same tests can run against a real Postgres when `RLS_TEST_DATABASE_URL` is set.
- **Supabase local** is not used; development and staging point at the hosted EU project.
- **Local sandbox runner**: the Docker runner is implemented behind the `packages/sandbox` interface but the mock sandbox (replays recorded sessions) is the default in development.

## 2026-10-05 — Migrations runner

Migrations are plain SQL files in `packages/db/migrations` (drizzle-kit journal format) applied by `pnpm db:migrate` (drizzle `migrate()` over `DATABASE_URL`). The Supabase CLI is used for project linking and type generation only, not for migrations, so the migration directory stays where BUILD §3.2 puts it.

## 2026-10-05 — Node services run with `tsx` in staging

`apps/api`, `apps/gateway`, `apps/composer`, `apps/ingest`, `apps/stream`, `apps/collab`, `apps/orchestrator` start with `tsx src/index.ts` (no bundling step). Simplest thing that runs TypeScript source across workspace packages; swap for a bundler when cold-start time matters.

## 2026-10-05 — Staging topology (substitutions for BUILD §3.1 "Hosting")

- Web: Vercel (as specified).
- Node services and the Temporal worker: **Railway** instead of Fly.io (the human's accounts are Vercel, Supabase, GitHub and Railway).
- Redis: **Railway Redis** instead of Upstash for staging; production can switch by changing `REDIS_URL`.
- Temporal: `temporalio/auto-setup` image on Railway with a Railway Postgres, instead of Temporal Cloud (which requires an account the human has not created). The orchestrator reaches it over Railway private networking.
- Envelope encryption: **libsodium with `DEV_MASTER_KEY`** in staging (no AWS KMS key exists yet). The KMS implementation is present behind the same interface and activates when `KMS_KEY_ID` is set.
- Database: Supabase project `foundermanager` (ref `sdruubitufjqibsjyxlc`, North EU / Stockholm), created by the human.

## 2026-10-05 — Hooks (BUILD §4.2)

`.claude/settings.json` wires `PostToolUse` (matcher `Edit|Write|MultiEdit`) to `.claude/hooks/post-edit.sh` and `Stop` to `.claude/hooks/stop.sh`, per the current Claude Code hooks reference (hook input arrives as JSON on stdin with `tool_input.file_path`). Both scripts are **gated by `FM_HOOKS=1`** so that the bulk-generation phase with many parallel agents is not slowed to a crawl by a typecheck after every edit. Set `FM_HOOKS=1` in your shell for day-to-day development.

## 2026-10-05 — MCP servers (BUILD §4.5)

`.mcp.json` declares Vercel (remote, OAuth), Supabase (remote, OAuth, scoped to the staging project), GitHub (remote, needs `GITHUB_MCP_PAT` in the environment — HUMAN CHECKPOINT) and Playwright (stdio). The Vercel plugin for Claude Code was installed at user scope by following https://vercel.com/get-started.md.

## 2026-10-05 — Fonts

Self-hosted through `@fontsource/barlow-semi-condensed`, `@fontsource/inter` and `@fontsource-variable/jetbrains-mono` (OFL licences), imported once in `packages/dugout/src/fonts.css`. No runtime font CDN.

## 2026-10-05 — Procedural crests and avatars

Crests and agent avatars are generated as SVG in `packages/dugout` from a seed and kit/department colours, so mock mode needs no image-generation connector. The Recraft/Ideogram connector (BUILD §13.2) can replace the crest later; the data model stores `crest_url` either way.

## 2026-10-05 — Development auth bypass

`DEV_AUTH_USER_ID` lets `apps/api` and `apps/stream` skip JWT verification **only when `APP_ENV` is `development` or `test`** (Playwright, local development without Supabase Auth). Any other value of `APP_ENV` ignores the variable.

## 2026-10-05 — Repository location: not on the Desktop

The repo first lived in `~/Desktop/founder-manager`. That folder is an iCloud Drive file-provider domain ("Desktop & Documents" sync) and the machine's disk was full, so macOS evicted freshly written files and every read (including `git add`) blocked on an iCloud download that never completed. The repo was recreated at `~/code/founder-manager`, which is not synced. Rule: never put this repo (or `node_modules`) inside an iCloud-synced folder.

## 2026-10-05 — Cedar policy ids and "ask" (packages/policy)

`@cedar-policy/cedar-wasm` 4.13.0 does not use `@id` annotations as policy ids when a policy set is parsed from text (ids come back as `policy0`, `policy1`, ...). The loader therefore splits each `.cedar` file with `policySetTextToParts`, reads `@id`, `@outcome` and `@reason` with `policyToJson`, and hands the authorizer a `Record<id, text>` so that `diagnostics.reason` reports our ids. `@outcome("ask")` is only legal on `permit` policies; a `forbid` with an outcome annotation fails to load. `@reason` is the sentence returned to the gateway and the Inbox.

## 2026-10-05 — Spend cap vs approval threshold (BUILD §9.6 "caps")

Two caps on the agent (copied from the business or a holiday budget ceiling by the gateway): `approvalThresholdMinor` is the ask line (equal to the threshold is allowed, above it asks in every mode), `spendCapMinor` is the founder's hard ceiling and is a `forbid` (deny) in every mode, so the Chief of Staff cannot approve past it on holiday; the founder raises the cap. An absent spend cap means no cap. The cap only applies to tools flagged `spendsMoney`.

## 2026-10-05 — Policy evaluation fails closed

Any Cedar evaluation error (a policy that could not be evaluated, or a request the engine rejects) returns `deny` with the error text in `reasons`, because a skipped `forbid` would be unsafe. All schema attributes a policy reads are `required`, and `packages/policy/src/types.ts` supplies defaults, so this path should never trigger in practice; it is tested with a stubbed engine.

## 2026-10-05 — Tool attributes beyond connector policyHints

`Tool.finance` (Finance-module tools; BUILD §11.8 read-only, AC-11.8.5) and `Tool.contract` (creates or amends a contract; assisted mode asks) are set by the gateway from the connector/module, not from `policyHints`. Per-agent autonomy (`inherit | augmented | assisted | automated`) replaces the business mode for the mode rules only; hard gates, suppression, untrusted recipients, finance, kit mode and the spend cap are mode-independent.

## 2026-10-05 — Dugout foundation (packages/dugout, stage 1)

- **Default Tailwind palette removed.** `dugout.css` sets `--color-*: initial` and maps every token through `@theme inline`, so `bg-red-500` does not exist and `bg-status-bad`, `text-rating-3`, `bg-dept-4/15` do. Breakpoints are reset to `desktop` (1280) and `wide` (1440) only. This is how "tokens only, no hex outside tokens.css" is enforced mechanically rather than by review.
- **Utility names.** Surfaces `bg-base/panel/panel-alt/ink`, text `text-primary/secondary/link`, hairline `border-subtle`, type scale `text-display-xl … text-mono` (size + line-height) with `t-*` composite classes carrying family/weight/tracking, sizes `h-control-sm/md`, `h-chip`, `h-row-compact/comfortable`, `w-sidebar`, `w-rail`, motion `ease-dugout`, `duration-micro/panel/view/ribbon`, surfaces `surface-panel`, `surface-overlay`, `shimmer`.
- **`kitOnPrimary` carries two colour literals** (`#FFFFFF`, `#0F1318`) because a JS function cannot read CSS at compute time; they mirror `--on-kit-light` / `--on-kit-dark` in `tokens.css`. The APCA implementation follows apca-w3 0.1.9 (0.0.98G-4g constants) and is unit-tested against its published reference pairs.
- **Crest monogram sits on a kit-primary disc.** DESIGN §8 splits or quarters the shield in both kit colours; letters straddling two fields cannot be guaranteed APCA ≥ 75, so the monogram is drawn on an inner disc of `kit-primary` with the computed on-primary colour. Four silhouettes × five divisions × optional stripes, all chosen by `createRng("crest:" + seed)`.
- **Avatars use no colour literals.** The department palette is four `color-mix()` expressions of `var(--dept-n)` towards white or `--bg-ink`, so a department recolour re-paints every portrait.
- **Status ring vocabulary.** `AgentStatus` → ring: healthy good, degraded/paused warn ("waiting"), failing/injured bad, idle hairline. `StatusPill` maps paused to neutral (a deliberate pause is not a warning on a pill) while the avatar ring shows amber (the agent is waiting).
- **Fonts: Inter 400 and 500 only** (body and body-strong). The scaffold's Inter 600 import was dropped; display weight is Barlow 600.
- **Storybook 10** uses `@storybook/react-vite` with addon-docs and addon-a11y (`test: "error"`, WCAG 2.2 AA rule set), MDX for the Welcome page, backgrounds mapped to the surface tokens, and a dark manager theme. Tailwind runs through `postcss.config.mjs` (`@tailwindcss/postcss`); `dugout.css` declares `@source "./components"`, `"./stories"`, `"../.storybook"` relative to itself so utilities used only inside Dugout are always emitted, whichever app compiles it.
- **Tests run on happy-dom** with `src/test/setup.ts` polyfilling `ResizeObserver` and `matchMedia` for Radix.

## 2026-10-05 — Events: `occurredAt` is a `Date` in TypeScript, ISO on the wire (packages/events)

`PlatformEvent.occurredAt` is a `Date` (docs/ARCHITECTURE.md §2) and `parseEvent` accepts either a `Date` or an ISO string, so the same type is used by writers, the relay and consumers; `serializeEvent`/`toWire` produce the ISO form for the Redis `json` field and HTTP. Payload fields that carry times (`startsAt`, `expiresAt`, `balanceAt`…) stay ISO strings because payloads are stored as `jsonb` and must round-trip through JSON unchanged.

## 2026-10-05 — Events: ids validated as GUIDs, not RFC-4122 UUIDs

Payload and envelope ids use `z.guid()` (8-4-4-4-12 hex) rather than `z.uuid()`, because the deterministic seeds (BUILD §17.2) and fixtures use ids whose version/variant nibbles are not v4. `@founder-manager/shared`'s `isUuid` is stricter; both accept everything `crypto.randomUUID()` produces.

## 2026-10-05 — Events: consumer semantics (packages/events `consume`)

- A new consumer group starts at `0` (oldest retained entry), not `$`: missing an event is worse than re-seeing one, and every consumer de-duplicates on `event.id` (the composer additionally checks `events.narrated`). Pass `startFrom: "$"` for consumers that only care about the future.
- Retries use the pending-entries list, not an in-process queue: a failed entry stays pending and is redelivered via `XPENDING`/`XCLAIM` after `retryDelayMs` (default 1 s); entries left by a crashed consumer are claimed after `claimIdleMs` (default 30 s). Delivery counts come from Redis, so `maxRetries` (default 5, per ARCHITECTURE §5) survives restarts.
- Dead letters go to `dlq:{group}` with the original fields plus `source_stream`, `source_id`, `deliveries`, `error`, `failed_at`; undecodable entries (bad JSON, unknown type, invalid payload) are dead-lettered immediately because a retry cannot fix them.
- Blocking `XREADGROUP` runs on `redis.duplicate()` so the relay's `XADD`s and acks on the shared connection are never stalled behind a `BLOCK`.
- Consumers for all businesses use `businessId: "*"` → `SCAN MATCH ev:* TYPE stream` every `discoverIntervalMs` (5 s), so businesses created after start-up are picked up without a restart.

## 2026-10-05 — Events: relay is at-least-once and never stalls on a bad row

`runOutboxRelay` selects unpublished rows with `for update of o skip locked` inside a transaction (when the db exposes `transaction`), `XADD`s them with `MAXLEN ~ 100000`, then marks `published_at`. A crash between the two republishes the batch (same `event.id`). A row that no longer validates against the catalogue is written to `dlq:outbox-relay` and marked published so one bad row cannot block every business's events; `onError` is called.

## 2026-10-05 — Events: tests run on an in-memory Redis fake

`MemoryRedis` (`@founder-manager/events` export, `src/testing/memory-redis.ts`) implements the stream subset (`XADD` incl. `MAXLEN`/`NOMKSTREAM`, `XRANGE`/`XREVRANGE`, `XGROUP`, blocking `XREADGROUP`/`XREAD`, `XACK`, `XPENDING` summary + extended, `XCLAIM` incl. `JUSTID`/`RETRYCOUNT`/`FORCE`, `SCAN … TYPE stream`) with an injectable clock, so idle-time behaviour is deterministic. ioredis's `Redis` is asserted assignable to the same `StreamRedis` interface at compile time. No Redis server is needed for any test in the repo that consumes events; a live smoke against Railway Redis belongs to Gate 0.

## 2026-10-05 — packages/db: schema, RLS and test harness choices (BUILD §7)

- **Tenancy helper applied in SQL.** `fm_tenant_table(tbl, write_roles, mode)` (0001) applies the §7.1 pattern verbatim (`T_select` for members, `T_write for all` for the write roles, grants to `authenticated` + `service_role`, nothing for `anon`, `updated_at` trigger). Two modes: `standard` (owner/admin/member write) and `read_only` (app roles only read; rows are produced by services through `service_role`). Tables written only by services: `agent_skills`, `agent_sessions`, `agent_metrics`, `composer_buffer`, `channel_metrics`, `visitors`, `touches`, `conversions`, `journeys` (members may only set `viewed_at`), `usage_ledger`, `credit_balances`. Admin-only (`owner`,`admin`) tables: `departments`, `department_members`, `holiday_periods`, `accounts`, `securities`, `cap_table_entries`, `legal_entities`, `incorporations`, `integrations`, `webhooks`, `policies`, plus `businesses` updates and `memberships` management.
- **`anon` has no table grants** (explicit `revoke all … from anon` on every table so Supabase's default privileges do not re-open them). Only `public_profiles`, `communities`, `leaderboards` and `leaderboard_entries` are readable anonymously; `apps/api` always runs as `authenticated` or `service_role`.
- **memberships bootstrap.** `memberships` is created in 0001 without its FK to `businesses` (added in 0002). A signed-in user may insert a business with `created_by = auth.uid()` and then exactly one `owner` row for themselves while the business has no members (`business_has_members()` is `security definer` so RLS cannot hide existing rows from the check). Everything else on memberships is owner/admin only; a member may delete their own row (leave).
- **Audit log hash chain lives in the database.** A `before insert` trigger (`audit_log_chain`) serialises per business with an advisory lock, assigns `seq`, sets `prev_hash` to the previous row's hash and computes `hash = sha256(prev|business|seq|actor|action|target|details|created_at)` with the built-in `sha256()` (no pgcrypto). Client-supplied hashes are overwritten, so every writer (api, gateway, orchestrator) produces one chain and `repos.audit.append` only needs to insert. `update`/`delete` are revoked from all app roles **and** blocked by a trigger, so even `service_role` (which bypasses RLS) cannot rewrite history; `audit_log_verify(bid)` returns the first broken `seq`.
- **`journey_daily` is a materialised view plus a security-barrier view.** Matviews cannot carry RLS, so the aggregate is `journey_daily_mv` (readable by `service_role` only) and `journey_daily` is `create view … with (security_barrier) as select * from journey_daily_mv where is_member(business_id)`. Refresh is `refresh_journey_daily()` (`security definer`, `refresh … concurrently`, executable by `service_role` only); the metrics consumer calls it after journey/conversion writes (debounced) and nightly.
- **`entities.search` is trigger-maintained**, not a generated column: `array_to_string` is only STABLE so Postgres refuses it in a generated expression. Weighted `simple` config: name (A), aliases (B), email/domain identifiers (C). Name similarity uses `pg_trgm` GIN indexes on `entities.display_name`, `businesses.name`, `agents.name`, `legal_entities.legal_name`, `communities.name`, `sources.title`.
- **No ANN index on `embedding` yet.** `vector(1024)` columns exist on `sources` and `entities`; the HNSW index is added in the migration that introduces the embedding pipeline (needs real data to pick parameters, and PGlite's pgvector is not installed on this machine).
- **pgvector on PGlite is optional.** `@electric-sql/pglite-pgvector` is not in the workspace (see `docs/NEEDED_DEPS.md`). The harness loads it when present; otherwise it rewrites `create extension vector` to a no-op and `vector(1024)` to `real[]` before applying migrations, and reports `hasVector: false`. Nothing else in the SQL differs between PGlite and Supabase.
- **Cross-file FKs are added by `alter table` in the later migration** (e.g. `change_proposals.inbox_item_id` → 0005, `visitors/touches/conversions.entity_id` → 0008, `conversions.source_event_id` → 0011, `accounts.integration_id` → 0011) so each migration group stays self-contained.
- **`outbox` carries `business_id`** (denormalised from `events`) so it can use the standard tenancy policy and per-business indexes.
- **`messages` have a `message_threads` parent** (`participant_ids uuid[]`); BUILD lists `thread_id` on messages without a thread table. Social policies are user-based (`auth.uid()` in participants / community membership), not business-based.
- **Drizzle schema has no `pgPolicy` declarations.** The SQL is the source of truth for RLS (ARCHITECTURE §4); `drizzle-kit generate` is only used to diff new tables. A test (`src/__tests__/migrations.test.ts`) asserts the Drizzle tables and columns equal the SQL tables and columns (names and nullability) so the mirror cannot drift silently.

## 2026-10-06 — Product name: Foundmill (closes BUILD §19 "Final product name")

The founder chose **Foundmill** and purchased `foundmill.com` (registrar: Spaceship). `APP_NAME` in `packages/config/src/brand.ts` is now "Foundmill" and `APP_DOMAIN`/`APP_ORIGIN` point at the apex. Per BUILD §19 the name still never appears in URLs, routes or table names. External identifiers renamed the same day: GitHub repo `reidjxn/foundmill`, Vercel project `foundmill` (domains foundmill.com, www.foundmill.com), Railway project `foundmill` with custom domains api/stream/ingest.foundmill.com. The internal package scope `@founder-manager/*` and the local folder are renamed to `@foundmill/*` / `~/code/foundmill` between build waves (not while agents are importing the old scope). `docs/BUILD.md` is the founder's original specification and keeps its working title.
