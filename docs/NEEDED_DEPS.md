Dependencies a build agent needed but could not add itself (`package — version — why — who`). The orchestrating session adds them between waves.

## Resolved 2026-10-06 (cloud session, `pnpm install` available again)

- `@electric-sql/pglite-pgvector` — 0.0.9 (peer `@electric-sql/pglite` 0.5.8) — added as a devDependency of `packages/db`; the PGlite RLS harness now loads the real pgvector extension (`hasVector: true`) instead of rewriting `vector(1024)` to `real[]`.
- `@foundmill/events` — `workspace:*` — added as a dependency of `packages/sandbox`; the tsconfig `paths` entry and the vitest alias that stood in for it can be removed.

## Resolved 2026-10-12

- `ioredis` — 6.0.0 (catalog) — added to `apps/ingest`: the webhook nonce store (`RedisNonceStore`, `SET NX PX`) used to import it dynamically, which pnpm's isolated layout could never resolve, so staging always kept nonces in memory. It is a static import now, connected before the first delivery.

## Open

- `@foundmill/entity-linker` — `workspace:*` — optional for `packages/dugout`: `EntityText` re-implements only the display-side parser over the shared `ENTITY_MARKUP_RE` and declares structurally identical node types, so nothing is blocked; add the dependency if dugout should import `RenderNode`/`toRenderTree` directly instead of mirroring the types — dugout data agent (2026-10-07)
- `@foundmill/events` — `workspace:*` — optional for `packages/dugout`: the agents group declares `AgentSessionEvent` as a structural mirror of the events package's `SessionEvent` (orchestrator events are assignable unchanged); add the dependency if dugout should import the Zod schema instead of mirroring the type — dugout agents agent (2026-10-07)
- `jose` (or `@foundmill/gateway` as a workspace dependency) — 6.x — `apps/orchestrator` mints gateway session tokens with a service JWT; neither package is resolvable from the app, so `src/gateway-client.ts` signs the HS256 token with node:crypto (same claims as `apps/gateway/src/tokens.ts`). Either dependency would let it reuse the gateway's client — orchestrator agent (2026-10-07)
- `@tiptap/react`, `@tiptap/starter-kit`, `@tiptap/extension-collaboration`, `@tiptap/extension-collaboration-caret`, `yjs`, `@hocuspocus/provider` — catalog — `packages/modules` Specification tab wants the Tiptap 3 + Yjs collaborative block editor; until added, the host supplies it through `ModuleEnvProvider({ SpecEditor })` (`src/env.tsx` contract) and the plain `PlainBlockEditor` fallback saves through `product.spec.editBlock` — modules/product agent (2026-10-07)
- `@foundmill/entity-linker` — `workspace:*` — devDependency for `packages/db`: `src/seed/__tests__/seed.test.ts` validates every seeded inbox item's `[[ent:id|Name]]` markup with `validateMarkup`; until added, the test imports `../../../../entity-linker/src/index` by relative path (works under vitest and tsc because the linker is pure and resolves its own dependencies) — db seeds agent (2026-10-07)
- `@electric-sql/pglite` and `@electric-sql/pglite-pgvector` — catalog / 0.0.9 — should move from `devDependencies` to `dependencies` of `packages/db`: `createDb("pglite:<dir>")` is now a production code path (src/pglite.ts imports both), and a deploy that prunes dev dependencies would lose the local driver. Needs a lockfile update, so left as a note — db integration agent (2026-10-07)
- `@electric-sql/pglite-socket` — 0.0.x (peer `@electric-sql/pglite` 0.5.8) — optional: PGlite allows one process per data directory (enforced by `foundmill.lock`), so a multi-service local stack without Postgres needs one process to serve the directory over the wire protocol while the others connect with `postgres://` URLs — db integration agent (2026-10-07)
- `@foundmill/sandbox` — `workspace:*` — optional for `apps/api`: `dev.sessions.replay` replays a mock session from the bundled `RECORDINGS` when Redis holds no `as:{sessionId}` stream; `src/services/replay.ts` imports the package with a variable specifier and answers `source: "none"` with a reason until it is linked, so nothing is blocked — api wave-3 agent (2026-10-07)
