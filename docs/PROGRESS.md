# PROGRESS.md

Status legend: ☐ not started · ◐ in progress · ☑ done · ✗ blocked

## Phase 0 — Foundations (BUILD §16.1)

| # | Task | Status | Files | Tests | Open issues |
| --- | --- | --- | --- | --- | --- |
| 0.1 | Monorepo (pnpm, Turborepo, TS strict, ESLint incl. no-raw-db, Prettier, Vitest, Playwright, Storybook) | ☑ | root configs, `eslint.config.mjs`, package manifests | | |
| 0.2 | Bootstrap files (§4) | ☑ | `CLAUDE.md`, `.claude/**`, `.mcp.json`, `.env.example` | | MCP tokens are a HUMAN CHECKPOINT |
| 0.3 | Supabase + migrations for §7.1 helpers and core tables; RLS + cross-tenant tests | ☐ | `packages/db` | | |
| 0.4 | Dugout: tokens, fonts, shell components, Storybook | ☐ | `packages/dugout` | | |
| 0.5 | `packages/events` outbox + Redis relay; `apps/stream` skeleton | ☐ | | | |
| 0.6 | Temporal local + orchestrator hello workflow; gateway skeleton with Cedar + one mock connector | ☐ | | | |
| 0.7 | Envelope encryption utility (KMS + libsodium) | ☐ | `packages/shared/src/crypto` | | |
| 0.8 | Seed script with two demo businesses (§17.2) | ☐ | `packages/db/src/seed` | | |

**Gate 0:** ☐ shell renders seeded data at 1440 px · ☐ NeedsLargerWindow below 1280 px · ☐ cross-tenant tests pass · ☐ outbox → stream round trip test · ☐ gateway denies a hard-gate tool in a policy test · ☐ Storybook builds

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
