Dependencies a build agent needed but could not add itself (`package — version — why — who`). The orchestrating session adds them between waves.

## Resolved 2026-10-06 (cloud session, `pnpm install` available again)

- `@electric-sql/pglite-pgvector` — 0.0.9 (peer `@electric-sql/pglite` 0.5.8) — added as a devDependency of `packages/db`; the PGlite RLS harness now loads the real pgvector extension (`hasVector: true`) instead of rewriting `vector(1024)` to `real[]`.
- `@founder-manager/events` — `workspace:*` — added as a dependency of `packages/sandbox`; the tsconfig `paths` entry and the vitest alias that stood in for it can be removed.

## Open

- `@founder-manager/entity-linker` — `workspace:*` — optional for `packages/dugout`: `EntityText` re-implements only the display-side parser over the shared `ENTITY_MARKUP_RE` and declares structurally identical node types, so nothing is blocked; add the dependency if dugout should import `RenderNode`/`toRenderTree` directly instead of mirroring the types — dugout data agent (2026-10-07)
- `@founder-manager/events` — `workspace:*` — optional for `packages/dugout`: the agents group declares `AgentSessionEvent` as a structural mirror of the events package's `SessionEvent` (orchestrator events are assignable unchanged); add the dependency if dugout should import the Zod schema instead of mirroring the type — dugout agents agent (2026-10-07)
