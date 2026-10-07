Dependencies a build agent needed but could not add itself (`package — version — why — who`). The orchestrating session adds them between waves.

## Resolved 2026-10-06 (cloud session, `pnpm install` available again)

- `@electric-sql/pglite-pgvector` — 0.0.9 (peer `@electric-sql/pglite` 0.5.8) — added as a devDependency of `packages/db`; the PGlite RLS harness now loads the real pgvector extension (`hasVector: true`) instead of rewriting `vector(1024)` to `real[]`.
- `@foundmill/events` — `workspace:*` — added as a dependency of `packages/sandbox`; the tsconfig `paths` entry and the vitest alias that stood in for it can be removed.

## Open

- `@foundmill/entity-linker` — `workspace:*` — optional for `packages/dugout`: `EntityText` re-implements only the display-side parser over the shared `ENTITY_MARKUP_RE` and declares structurally identical node types, so nothing is blocked; add the dependency if dugout should import `RenderNode`/`toRenderTree` directly instead of mirroring the types — dugout data agent (2026-10-07)
- `@foundmill/events` — `workspace:*` — optional for `packages/dugout`: the agents group declares `AgentSessionEvent` as a structural mirror of the events package's `SessionEvent` (orchestrator events are assignable unchanged); add the dependency if dugout should import the Zod schema instead of mirroring the type — dugout agents agent (2026-10-07)
- `jose` (or `@foundmill/gateway` as a workspace dependency) — 6.x — `apps/orchestrator` mints gateway session tokens with a service JWT; neither package is resolvable from the app, so `src/gateway-client.ts` signs the HS256 token with node:crypto (same claims as `apps/gateway/src/tokens.ts`). Either dependency would let it reuse the gateway's client — orchestrator agent (2026-10-07)
- `ioredis` — 6.0.0 (catalog) — `apps/ingest` keeps webhook nonces in Redis in staging/production (`RedisNonceStore`, `SET NX PX`); the app imports it dynamically and falls back to the in-memory store when the module is absent, so nothing is blocked — ingest agent (2026-10-07)
- `@tiptap/react`, `@tiptap/starter-kit`, `@tiptap/extension-collaboration`, `@tiptap/extension-collaboration-caret`, `yjs`, `@hocuspocus/provider` — catalog — `packages/modules` Specification tab wants the Tiptap 3 + Yjs collaborative block editor; until added, the host supplies it through `ModuleEnvProvider({ SpecEditor })` (`src/env.tsx` contract) and the plain `PlainBlockEditor` fallback saves through `product.spec.editBlock` — modules/product agent (2026-10-07)
