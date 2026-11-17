# apps/orchestrator (`@foundmill/orchestrator`)

The Temporal worker: business cycles, Autopilot and Automated mode, agent sessions, approval waits, channel engines, training, vacations, playbooks, incorporation, journeys, imports, foundations, the Source Watcher and the periodic schedules. It calls no vendor itself and serves no screens.

## Invariants
- Workflows (`src/workflows/*.ts`) are pure and bundled: `@temporalio/workflow`, local pure modules and `import type` only, never Node APIs. All I/O is in activities (`src/activities/*.ts`).
- A change to a workflow's behavior goes behind `patched("<id>")` so runs recorded before it still replay (the pattern in `businessCycle.ts`, `incorporation.ts`).
- Workflow ids are deterministic: `cycle:{businessId}:{n}`, `session:{sessionId}`, `engine:{channelId}`, `holiday:{holidayId}`, `autopilot:{businessId}`, `automated:{businessId}`, `foundations:{businessId}:{attempt}`. Signals compute the id, never search by time.
- `src/activities/dispatch.ts` is the only place a session opens; it refuses a stopped team, a paused or released agent, a task with an open session, a full concurrency allowance and an agent at its wage cap.
- Sessions are minted and configured only from `resolveGrants` (packages/connectors): agents get only tools that exist; `grants-contract.test.ts` fails on a grant nothing serves.
- Every tool call goes through the gateway (`src/gateway-client.ts`) with a session token; never call a vendor here.
- Model calls go through `createBusinessModelClient` (`src/models.ts`): a business on its own key runs on that key and is never run on the platform's credits.
- Only a channel that can really act runs (`channelAvailability`); a simulated result is never reported as done.
- Periodic jobs are entries of `SCHEDULES` in `src/schedules.ts` (idempotent at every boot), never ad-hoc timers.
- Database through `repos` only (`fm/no-raw-db`); events through the outbox; env through `loadEnv()`. Everything works with `INTEGRATIONS_MODE=mock` and `MODEL_MODE=mock` (mock sessions replay recordings in a `packages/sandbox` replay sandbox).

## Read when needed
- docs/ARCHITECTURE.md §10 Orchestrator (workers, each workflow, keys, signals, ids, dispatch guard, the schedules table, channel engines), §19 Foundations on the first open. Lines are very long: grep for the section heading and read only that section, never the whole file.
- docs/BUILD.md §9.3 Running an agent session, §9.4 Temporal workflows, §9.6 Business modes, §9.7 Memory and context, §10.2–10.4 keys, rate limits, cost controls.
- Decisions: `node scripts/decisions-index.mjs Temporal` (add words such as `autopilot`, `session`, `pause`), then read only the printed range.

## Commands
- `pnpm --filter @foundmill/orchestrator typecheck` | `lint` | `test`
- One suite: `pnpm --filter @foundmill/orchestrator test grants-contract`
- When `TEMPORAL_ADDRESS` is unreachable in development, start `temporal server start-dev`.

## Key files
- `src/index.ts`: the two workers (main queue and `-sessions`) and boot
- `src/workflows/index.ts`: the workflow bundle entry; `businessCycle.ts`, `agentSession.ts`, `signals.ts`
- `src/activities/session.ts`: `prepareSession`, `runAgentSession` (Claude Agent SDK or replay)
- `src/activities/dispatch.ts`: the dispatch guard
- `src/schedules.ts`: `SCHEDULES` and their registration
- `src/models.ts`: per-business model client (platform credits or the business's own key)
- `src/gateway-client.ts`, `src/composer-client.ts`: calls to the gateway and the composer
- `src/__tests__/harness.ts`, `src/__tests__/grants-contract.test.ts`
