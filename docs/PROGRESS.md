# PROGRESS.md

Status legend: ☐ not started · ◐ in progress · ☑ done · ✗ blocked

## Phase 0 — Foundations (BUILD §16.1)

| # | Task | Status | Files | Tests | Open issues |
| --- | --- | --- | --- | --- | --- |
| 0.1 | Monorepo (pnpm, Turborepo, TS strict, ESLint incl. no-raw-db, Prettier, Vitest, Playwright, Storybook) | ☑ | root configs, `eslint.config.mjs`, package manifests | | |
| 0.2 | Bootstrap files (§4) | ☑ | `CLAUDE.md`, `.claude/**`, `.mcp.json`, `.env.example` | | MCP tokens are a HUMAN CHECKPOINT |
| 0.3 | Supabase + migrations for §7.1 helpers and core tables; RLS + cross-tenant tests | ☑ | `packages/db/migrations/0001…0012`, `src/schema/*`, `src/client.ts`, `src/migrate.ts`, `src/testing/pglite.ts` | `pnpm --filter @founder-manager/db test` (migrations invariants + schema mirror; generated cross-tenant suite over 61 business-scoped tables; user-scoped/social; credentials + audit chain; helpers) | pgvector for PGlite not installed (see NEEDED_DEPS.md); repos/seeds are task 0.8 / later agent; `pnpm db:migrate` not yet run against staging |
| 0.4 | Dugout: tokens, fonts, shell components, Storybook | ◐ | `packages/dugout` — foundation stage done: `tokens.css`, `fonts.css`, `dugout.css` (Tailwind v4 `@theme inline`), `lib/` (cn, format, rating, colour/APCA, seed PRNG, reducedMotion), 33 foundation primitives in `src/components/foundation/*` with stories, Storybook 10 (`.storybook/`, Tokens + Welcome pages) | 57 vitest tests (cn, format, rating, APCA/kitOnPrimary, seed, crest + avatar determinism, Button, IconButton, StatusPill); `typecheck`, `lint`, `test`, `storybook:build` pass | Shell/data/journey/agents barrels are empty `export {}` for stage 2 |
| 0.5 | `packages/events` outbox + Redis relay; `apps/stream` skeleton | ◐ | `packages/events/src/{catalogue,keys,redis,consume,session-stream}.ts`, `src/outbox/{writer,relay}.ts`, `src/testing/{memory-redis,fake-db,fixtures}.ts` — **events package ☑** (37 event types with Zod payloads, `writeEvent`/`writeEvents`, `runOutboxRelay`, `consume` with retry + dead-letter + pending-claim, `publishSessionEvent`/`readSessionEvents`, in-memory Redis fake). `apps/stream` skeleton: other agent | `pnpm --filter @founder-manager/events test` — 57 tests incl. outbox → relay → consumer-group round trip (`src/__tests__/roundtrip.test.ts`) | Relay/consumer run only against `MemoryRedis` so far; smoke against real Redis + Postgres once `packages/db` migrations land (column names assumed from BUILD §7.2: `events(id, business_id, type, occurred_at, actor, entity_ids, payload, narrated)`, `outbox(event_id, published_at)`) |
| 0.6 | Temporal local + orchestrator hello workflow; gateway skeleton with Cedar + one mock connector | ☐ | | | |
| 0.7 | Envelope encryption utility (KMS + libsodium) | ☐ | `packages/shared/src/crypto` | | |
| 0.8 | Seed script with two demo businesses (§17.2) | ☐ | `packages/db/src/seed` | | `src/seed.ts` is a placeholder that prints "seed not implemented yet" |

**Gate 0:** ☐ shell renders seeded data at 1440 px · ☐ NeedsLargerWindow below 1280 px · ☑ cross-tenant tests pass (PGlite) · ☐ outbox → stream round trip test · ☐ gateway denies a hard-gate tool in a policy test · ☑ Storybook builds (foundation stage, 2026-10-05)

## Phase 1 — Core loop (BUILD §16.2)

| # | Task | Status | Files | Tests | Open issues |
| --- | --- | --- | --- | --- | --- |
| 1.1 | Founder profile; Ideation Studio; Compare; Commit; archetype seeds | ☐ | | | |
| 1.2 | Departments/modules model and screen_definitions renderer | ☐ | | | |
| 1.3 | Agent runtime: club rules, agent versions, Agent SDK session (mock + live), Chief of Staff businessCycle | ☐ | | | |
| 1.4 | Inbox: Composer, schema validation, entity-linker, DecisionBar, Plan compiler, policy check, execution, Refresh with buffer | ☐ | | | |
| 1.5 | CRM entities, profiles, universal search | ☐ | | | |
| 1.6 | Product: spec blocks + Yjs, roadmap, Source Watcher, change proposals, DiffView | ☐ | | | |
| 1.7 | Home v1: department cards, status strip, Inbox preview, Edit mode, presets | ☐ | | | |
| 1.8 | BYOK key storage + validation; model routing; usage ledger | ☐ | | | |

## Phase 2 — Build and sell (BUILD §16.3)

| # | Task | Status | Notes |
| --- | --- | --- | --- |
| 2.1–2.8 | See BUILD §16.3 | ☐ | |

## Staging deployment

| Item | Status | Notes |
| --- | --- | --- |
| GitHub repo `reidjxn/founder-manager` (private) | ☑ | created 2026-10-05 |
| Supabase project `foundermanager` (EU, Stockholm) | ☑ | created by the human; CLI linked |
| Railway project `founder-manager` | ☑ | created 2026-10-05; services pending |
| Vercel project | ☐ | |

## Build wave — packages

| Package | Status | Files | Tests | Open issues |
| --- | --- | --- | --- | --- |
| `packages/policy` (Cedar) | ☑ | `src/schema.ts`, `src/policies/*.cedar` (8 files, 15 policies), `src/policies/index.ts`, `src/cedar.ts`, `src/evaluate.ts`, `src/types.ts` | 151 Vitest tests: every rule × every mode, hard gates unliftable, suppression, untrusted recipient, caps boundary, AC-11.8.5, kit mode, fail-closed | Gate 0 "gateway denies a hard-gate tool in a policy test" is covered here; `apps/gateway` must call `evaluate()` and map `deny` on `hard-gate` to a founder task |
| `packages/models` (routing, Anthropic client, mock, rate limits, metering) | ☑ | `src/routing.ts` (MODELS/ROUTES verbatim BUILD §10.1 + `resolveModel`), `src/pricing.ts` (`MODEL_PRICING` config, `meter`, `sumMeters`, `estimateTokens`), `src/client.ts` (`createModelClient`, `LiveModelClient`, `validateApiKey`), `src/rate-limit.ts` (`RateLimiter`, header parsing, scoped backoff), `src/schemas.ts` (Zod output schemas: Composer §11.3, Plan §12.3, Ideation, CyclePlan, TaskGraph, CodeReview, SkillGrade, Coach, Commentary, Linker, Classifier, Categoriser + `CHART_OF_ACCOUNTS`, QuarantinedReader, Moderation), `src/mock/*` (`MockModelClient`, `listMockRoutes`, one handcrafted generator per route incl. rule-based `compilePlanRuleBased`, JSON-schema synthesizer fallback), `src/hash.ts`, `src/errors.ts`, `src/types.ts` | 89 Vitest tests: routing lock/warn rules; metering exactness + batch discount; rate-limit header parsing, replenishment, scoped 429 penalties, concurrency estimate; live client via injected fetch (structured output params, cache_control, repair retry, refusal/max_tokens, 429/5xx/4xx mapping, key validation); every mock route schema-valid (rich + prose-only inputs), determinism, synthesizer fallback; composer 60–180 words / manifest-only ids / one recommended / exhibit from named queries / no invented numbers; plan compiler AC-11.3.4 + AC-11.3.5 + gate families; quarantined reader injection resistance | `nightlyBatch` route completes synchronously (Message Batches API not wired; metered at standard price). Live path untested against the real API (no key in build phase). Prices are config as of 2026-10-05 — re-verify before Phase 1 live smoke. |

## Build log

- 2026-10-06 — Local building suspended (laptop disk full). Wave scripts now take the repo path from Workflow `args.root`; the build continues in a Claude Code cloud session per `docs/BUILD_RUNBOOK.md`. Next: re-run wave 1 there (agents complete what exists in their package), then wave 2, then integration/gates.
