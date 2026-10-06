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
- **Viewers never write, anywhere.** That includes `audit_log` inserts and marking a journey viewed; both policies use `has_role(owner|admin|member)`. If a viewer's read-only activity ever needs auditing, the service writes it.
- **Business creation generates the id client-side.** `insert into businesses` as `authenticated` may not use `RETURNING` (the select policy needs a membership that does not exist yet); `apps/api` inserts the business with a generated id and the first owner membership in one `withRls` transaction.

## 2026-10-06 — packages/models: live client, metering and mock conventions (BUILD §10, ARCHITECTURE §6)

- **Structured output = GA `output_config.format` (JSON schema), not a forced tool call.** Verified against `@anthropic-ai/sdk` 0.131.0 types and platform.claude.com on 2026-10-05: the three routed models all support it, no beta header. The wire schema comes from the SDK's `zodOutputFormat` (it rewrites unsupported keywords such as `minLength` into descriptions); the returned text is still parsed and validated here with the caller's Zod schema so the **single automatic repair retry** can quote the exact issues back (`assistant: <bad json>`, `user: repair prompt`). Forced `tool_choice` is rejected by Opus/Sonnet 5.5, so it was never an option.
- **The SDK's own retries are off (`maxRetries: 0`); `packages/models` owns the policy.** 429 → `RateLimiter.reportRateLimited(scope)` with full-jitter exponential backoff (honours `retry-after`) applied to the caller's `scope` only (the agent session), as BUILD §10.3 requires; 5xx/529/connection → short backoff, up to `maxAttempts` (4); 4xx → `ModelRequestError` without retry. Buckets are keyed by a sha256 fingerprint of the API key and refreshed from `anthropic-ratelimit-{requests,input-tokens,output-tokens,tokens}-*` headers via `.withResponse()`, with linear replenishment between observations (Anthropic documents a continuously replenishing token bucket).
- **Sampling parameters only reach Haiku.** Opus 5.5 and Sonnet 5.5 return 400 for `temperature`/`top_p`/`top_k`; the client drops `temperature` for them (debug log) and passes it to Haiku 4.5. `thinking` is never set (the 5.5 models run adaptive thinking by default; Haiku has none); `effort` is passed through when a caller sets it, otherwise the API default applies (Opus 5.5 defaults to `medium`). Routes that need more depth should pass `effort` explicitly.
- **Prompt caching: one `cache_control: {type: "ephemeral"}` breakpoint on the last system block when `cacheSystem` is set.** Prefixes under the model minimum (512 tokens on the 5.5 models, 4096 on Haiku 4.5) silently do not cache; nothing breaks.
- **Prices are config in USD, arithmetic in integer micro-minor-units.** `MODEL_PRICING` holds list prices per million tokens as of 2026-10-05 (Opus 5.5 $4/$20, Sonnet 5.5 $2/$10, Haiku 4.5 $1/$5; cache write 1.25×, cache read $0.20/$0.20/$0.10). `meter()` returns `costMinor` (exact, fractional), `costMinorInt` (what one `usage_ledger` row stores) and `costMicroMinor` (sum these across rows, round once) — a 500-token Haiku call is 0.05 cents and would otherwise vanish. Everything is labelled `"Estimate"`; the founder's Anthropic invoice is the only real cost. Batch discount is applied only when a call really went through the Batches API, which `complete()` never does yet.
- **`complete({ schema })` returns `json: T` (typed overload) or throws** `ModelOutputError` (`invalid_output`, `refusal`, `max_tokens`); without a schema it returns `text` and the raw `stopReason`. Refusals and truncation are not repaired.
- **Mock conventions.** Fixtures are keyed by `stableHash({route, system, messages, schema})` so output is deterministic across machines. Generators read structured inputs as JSON embedded in the messages (fenced or bare), with tolerant keys (`named_queries` / `namedQueries`, nested under `inputs`/`context`); prose-only prompts still produce valid output. When a caller's schema differs from the generator's shape, a JSON-schema-driven synthesizer (over `z.toJSONSchema`) produces a valid value and the result is marked `repaired: true`. The composer mock only ever interpolates numbers taken from the inputs (metric values, event payloads, minor amounts rendered as major units); every template sentence is digit-free.
- **Route output schemas live in `@founder-manager/models` (`src/schemas.ts`)** — `ComposerOutput` (BUILD §11.3 verbatim, with "exactly one recommended" and "exhibit needs a named query" refinements), `PlanOutput` (§12.3), `IdeationOutput`, `CyclePlanOutput`, `TaskGraphOutput`, `CodeReviewOutput`, `SkillGradeOutput`, `CoachOutput`, `CommentaryOutput`, `LinkerOutput`, `ClassifierOutput`, `CategoriserOutput` (+ `CHART_OF_ACCOUNTS`, the standard chart for BUILD §11.8 "without a ledger"), `QuarantinedReaderOutput`, `ModerationOutput`. Shared enums are imported from `@founder-manager/shared`, never redeclared. `apps/composer`, the orchestrator and the finance module should import these rather than redefine them.
- **The plan compiler's rule engine is exported (`compilePlanRuleBased`) for live use too.** It is the mock for the `planCompiler` route and a deterministic pre-check: hard-gate phrases (BUILD §2.2) always compile to `request_human_action` and never to an automated action, so a live Opus plan can be validated against it before execution.

## 2026-10-06 — Cloud-first build and deploy

Local building is suspended (the founder's laptop has no free disk). The build continues in a Claude Code cloud session (see `docs/BUILD_RUNBOOK.md`). Deployment is push-driven: the Vercel project is connected to `reidjxn/foundmill` (production branch `main`, root `apps/web`), and Railway services deploy from the same repository once connected in the Railway dashboard (one shared root `Dockerfile`, `APP` variable per service). Database migrations run from `apps/api` at boot under a Postgres advisory lock (idempotent; drizzle migrator over `DATABASE_URL`), so no machine with a database password is needed to migrate staging; `pnpm db:migrate` remains for manual runs. Seeds run once via `railway run -s api -- pnpm db:seed` or an `SEED_ON_BOOT=1` flag honoured only when the demo businesses are absent.

## 2026-10-06 — GitHub Actions is the verification machine

With local building suspended and no Claude cloud environment on the account yet, `.github/workflows/ci.yml` runs the whole-repo checks on every push to `main` and every pull request: banned-terms scan, `turbo run typecheck lint` and `turbo run test` (all packages except `e2e`) in one job, and the Dugout Storybook build in a second. Everything runs with `INTEGRATIONS_MODE=mock` and `MODEL_MODE=mock`, no secrets. The e2e Playwright suite is excluded until the golden path (BUILD §17) exists and has a seeded environment to run against; add it as a third job then. Read a failing run with `gh run view <id> --log-failed`.

## 2026-10-06 — Contract suite: the replay check verifies one delivery twice

`describeConnectorContract`'s "rejects a replayed delivery" case used to call `valid()` twice and expect the second request to fail. Mocks keep one `ReplayGuard` per connector for the whole test file, so the earlier "verifies a correctly signed delivery" case had already consumed the only delivery `valid()` could build and the first verify failed. The suite now verifies the *same* Request twice (the webhook helpers clone the body before reading), and `ContractWebhookCase.valid()` is documented as having to produce a distinct delivery per call when `replay` is set (Dropbox Sign increments the callback `event_time`).

## 2026-10-06 — Policy hot-path test budgets per evaluation

`@cedar-policy/cedar-wasm` has no persistent policy-set handle, so every `isAuthorized` call re-parses the policy set: about 1 ms per evaluation on a laptop and 10-20 ms on a shared GitHub Actions runner (measured 16.8 ms). The test asserts a per-evaluation budget (3 ms locally, 60 ms when `CI` is set, over 1,000 or 100 evaluations) instead of "1,000 evaluations under two seconds". The gateway should treat a policy evaluation as a 1-20 ms call: evaluate once per tool call, never in a tight loop, and consider caching `(principal, tool, context)` → outcome for identical repeated calls within a session.

## 2026-10-06 — Mock sandbox recordings are TypeScript, not JSON

Recordings for the mock sandbox (`packages/sandbox/src/mock/recordings/index.ts`) are typed TypeScript objects built with small helpers and validated with `parseRecording` at module load, rather than JSON files: events are typed as `SessionEventDraft` from `@founder-manager/events`, so a recording that drifts from the session event schema fails `tsc`, and the progress values are computed from the BUILD §11.6 formula instead of being typed by hand. The bundled set covers every outcome the Training Ground has to render (done, blocked with an approval hold and a hard gate, failed with loop detection).
