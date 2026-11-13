# packages/models (`@foundmill/models`)

Owns model routing (the only place model ids live), the Anthropic client with its mock mode, rate-limit buckets, structured output and streaming, and cost metering. It does not build prompts (packages/agents) and calls no other vendor.

## Invariants
- **Model ids only in `src/routing.ts`.** Everywhere else (fixtures, stories, prompts, other packages) imports them or names a route. `src/model-ids.test.ts` fails on any other source file that spells one.
- Callers pick a route key (`ROUTES`), never a model: `resolveModel(routeKey, override?)` applies the lock and warn rules. Per-route `effort`, `speed` and `maxTokens` live in `ROUTES` next to the model.
- `MODEL_MODE=mock` (the default) returns deterministic responses from `src/mock/`, keyed by route and a stable hash of the input; unknown inputs fall back to a generic fixture per route. Evals always force live. Everything must work in mock mode.
- Mock completions are user-facing text: no football words, US English, the subtext rule (root CLAUDE.md); a mock never pretends a simulated action was done.
- Every call reaches `onUsage` once, with its `attribution` and `billedTo` (`credits` on the platform key, `byok` on a business's own key). Sinks book it through `bookUsage` (packages/db), never a literal.
- Services on the platform key wrap their client with `gateModelClient` and ask `assertPlatformCredits` before each call for a business (`credits_exhausted`, 402).
- Costs are US dollars and labeled estimates (`src/pricing.ts`); never present them as real.
- Env comes from `loadEnv()` (`packages/shared/src/env.ts`), never `process.env` directly.

## Read when needed
- docs/ARCHITECTURE.md §6 Models (lines 107–118). Lines are very long: read the range or grep.
- docs/BUILD.md §10.1 Routing, §10.2 Bring-your-own key, §10.3 Rate-limit-aware scheduling, §10.4 Cost controls.
- Decisions: `node scripts/decisions-index.mjs routing` or `node scripts/decisions-index.mjs effort`, then read only the printed range.

## Commands
- `pnpm --filter @foundmill/models typecheck` | `lint` | `test`
- Vocabulary in mock completions: `node scripts/banned-terms.mjs`, `node scripts/us-english.mjs`

## Key files
- `src/routing.ts`: `MODELS`, `ROUTES`, `resolveModel`
- `src/client.ts`: `createModelClient({ mode, apiKey, onUsage })`, `complete`, schema retry
- `src/mock/`: deterministic fixtures per route
- `src/structured-stream.ts`: `streamStructured` (element-by-element JSON streaming)
- `src/rate-limit.ts`: token buckets, 429 backoff
- `src/gate.ts`: `gateModelClient`
- `src/pricing.ts`: per-model prices, `meter(usage, modelId)`
