# apps/api (`@foundmill/api`)

Hono + tRPC: auth context (Supabase JWT), membership and section checks, RLS-scoped queries, audit, events, the outbox relay, and starting Temporal workflows. It calls no vendor (the gateway does) and receives no webhooks (apps/ingest does).

## Invariants
- Every user-originated query runs under RLS (`ctx.rls(fn)` / `withRls(db, { userId }, fn)`). The service connection is used only where a contract says so, and then states its own rules.
- **Every mutation:** Zod input, membership and permission (`businessProcedure`, `writeProcedure`, `sectionRead/Write`), `audit`, and `writeEvent` where relevant, inside its transaction.
- Business-scoped reads and writes get a cross-tenant test (business A's member gets nothing of B; see `cross-tenant-refs.test.ts`, `section-walls.test.ts`).
- Routers are named exactly as BUILD §8.3, in `src/routers/<area>.ts`, merged in `src/router.ts`; logic lives in `src/services/`.
- **No vendor calls** (SEC-14): anything that could reach a vendor goes through `src/services/gateway.ts`. Model ids never appear here: use routes from `@foundmill/models`.
- Every procedure that calls a model on the platform key, or a vendor per press, carries `modelLimited(<rule>)` (`src/services/model-limits.ts`).
- `DEV_AUTH_USER_ID` bypass only when `APP_ENV` is development or test. Env through `loadEnv()`.
- People are free on every plan: no limit on cofounders or collaborators. Solo is complete: nothing is gated on a second person, and no message treats a project with one person as unfinished.
- A mock connector's result is reported as simulated, never as done. Label every non-real number "Forecast" or "Estimate".
- Copy a person can read (error messages, sentences) is US English, plain words, no football terms.

## Read when needed
- docs/ARCHITECTURE.md §13 API (boot, context, the transaction gate, section walls, model usage, routers, JWT, and each feature's contract), §4 Database, §3 Modes and environment. Lines are very long: read a range or grep for the router name.
- docs/BUILD.md §8.3 tRPC routers, §11.9 Team module (section permissions), §10.5 Pricing and billing, and the §11 feature section you are changing.
- Decisions: `node scripts/decisions-index.mjs tRPC` or the feature's own words (`node scripts/decisions-index.mjs page publish`), then read only the printed range.

## Commands
- `pnpm --filter @foundmill/api typecheck` | `lint` | `test` (one suite: `pnpm --filter @foundmill/api test <name>`)
- A schema change: `pnpm test:rls`. A screen it feeds: its Playwright spec (`verify-done` skill).

## Key files
- `src/app.ts`: the Hono app, `/trpc/*`, `/health`
- `src/trpc.ts`: `protectedProcedure`, `businessProcedure`, `writeProcedure`, `sectionRead/Write`, `audit` and `emit`
- `src/context.ts`: `createApiDeps()`, per-request context
- `src/router.ts`: the merged `AppRouter`
- `src/routers/<area>.ts` and `src/services/<area>.ts`
- `src/services/gateway.ts`: the gateway client
- `src/services/relay.ts`: the outbox relay loop (business and account)
- `src/__tests__/harness.ts`: PGlite, businesses A and B, `caller(user)`
