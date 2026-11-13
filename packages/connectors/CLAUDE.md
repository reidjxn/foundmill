# packages/connectors (`@foundmill/connectors`)

Owns the connector contract, the registry, the grants resolver, channel availability, typed reads, and one folder per connector with a real and a mock implementation. Only apps/gateway runs a real connector against a vendor; ingest uses the webhook verifiers, and the api runs a few mocks in-process (ARCHITECTURE §13). Never call a vendor from anywhere else.

## Invariants
- **Every connector has a real and a mock implementation.** `registry.get(key)` returns `connector.mock` under `INTEGRATIONS_MODE=mock` (the default), and `INTEGRATIONS_MODE=mock` must run the golden path.
- **A mock result carries `simulated: true` and a notice.** A simulated result is never reported as an action (house rule 4). A live result carries neither field.
- Mocks are deterministic. A stateful mock keeps one world per business (`perBusiness` in `src/mock-utils.ts`) and reads and writes only `ctx.businessId`'s world. `simulate(eventName, params)` emits platform events for the dev Simulate panel and tests.
- Every tool declares `policyHints` (`spendsMoney`, `contactsThirdParty`, `irreversible`, `hardGate`, `requiresKitMode`): Cedar reads them, so anything outward or costly asks first (Needs you) in augmented and assisted mode.
- Third-party content comes back as untrusted (`untrusted: true`); a tool may add `facts(data, args)`, checked values built with `fact.*`, never free text.
- **Founder's own key** (`auth: { kind: "api_key" }`, founder 2026-11-12): no `platformKey`, no `PlatformSecrets`, throw `ConfigError` without `ctx.credential`, health check with the credential the gateway passes, never fall back to a Foundmill platform key, keep the key out of logs, errors and results. Not connected means the agent says "not connected". No vendor MCP servers, no Foundmill developer apps.
- Agents are granted only tools that exist: `resolveGrants` maps grants onto served tools; a grant nothing serves fails `apps/orchestrator/src/__tests__/grants-contract.test.ts`.
- Mock webhooks verify against secrets in `fixtures/`, so they mount in development and test only (`registry.mountableWebhooks`).
- Keys never live in fixtures, env files or logs.

## Read when needed
- docs/ARCHITECTURE.md §8 Connectors (lines 127–145: folder layout, mocks, platform mail, grants, channel availability, built-ins, founder's-own-key connectors, typed reads), §9 Gateway (146–167). Lines are very long: read a range or grep.
- docs/BUILD.md §13.1 Connector contract, §13.2 Catalog by phase, §13.3 Mock mode, §9.5 Tool gateway and policy engine.
- Decisions: `node scripts/decisions-index.mjs own key connector` or `node scripts/decisions-index.mjs webhook`, then read only the printed range.
- Skill: `new-connector` (copy the newest connector of the same auth kind).

## Commands
- `pnpm --filter @foundmill/connectors typecheck` | `lint` | `test`
- After a grant or tool change: `pnpm --filter @foundmill/orchestrator test grants-contract`; gateway behavior: `pnpm --filter @foundmill/gateway test`

## Key files
- `src/contract.ts`: the contract (`ToolResult`, `PolicyHints`, `ToolContext`)
- `src/registry.ts`: real or mock by mode, webhook mounts
- `src/connectors/<key>/`: `index.ts` (real), `mock.ts`, `tools.ts` (tools and policy hints), `webhooks.ts`, `fixtures/`, `<key>.test.ts`
- `src/grants.ts`: `resolveGrants`, `servedGrants`
- `src/channel-availability.ts`: `CHANNEL_ACTING_TOOLS`, `channelAvailability`
- `src/facts.ts`: typed reads of untrusted output
- `src/mock-utils.ts`: per-business mock worlds
