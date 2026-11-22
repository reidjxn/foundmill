# packages/connectors (`@foundmill/connectors`)

Owns the connector contract, the registry, the grants resolver, channel availability, typed reads, and one folder per connector with a real and a mock implementation. Only apps/gateway runs a real connector against a vendor; ingest uses the webhook verifiers, and the api runs a few mocks in-process (ARCHITECTURE §13). Never call a vendor from anywhere else.

## Invariants
- **Every connector has a real and a mock implementation.** `registry.get(key)` returns `connector.mock` under `INTEGRATIONS_MODE=mock` (the default), and `INTEGRATIONS_MODE=mock` must run the golden path.
- **A mock result carries `simulated: true` and a notice.** A simulated result is never reported as an action (house rule 4). A live result carries neither field.
- Mocks are deterministic. A stateful mock keeps one world per business (`perBusiness` in `src/mock-utils.ts`) and reads and writes only `ctx.businessId`'s world. `simulate(eventName, params)` emits platform events for the dev Simulate panel and tests.
- Every tool declares `policyHints` (`spendsMoney`, `contactsThirdParty`, `irreversible`, `hardGate`, `requiresKitMode`): Cedar reads them, so anything outward or costly asks first (Needs you) in augmented and assisted mode.
- Third-party content comes back as untrusted (`untrusted: true`); a tool may add `facts(data, args)`, checked values built with `fact.*`, never free text.
- **Founder's own key** (`auth: { kind: "api_key" }`, founder 2026-11-12): no `platformKey`, no `PlatformSecrets`, throw `ConfigError` without `ctx.credential`, health check with the credential the gateway passes, never fall back to a Foundmill platform key, keep the key out of logs, errors and results. Not connected means the agent says "not connected". No Foundmill developer apps.
- **Remote MCP servers** (founder, 2026-11-19; `src/remote-mcp/`): a vendor's own MCP server is a connector built by `createRemoteMcpConnector` from a `RemoteServer` list (`servers.ts`: tools, `policyHints`, the vendor's OAuth and terms in its header, a recorded mock). The gateway is the only MCP client. A tool on no list is reachable only through `call_unlisted_tool` (asks first); a name that would cross a hard gate is refused (`HARD_GATE_NAME`, `remoteHardGateCall`); the server's annotations are never read. OAuth is PKCE S256 with the resource indicator on Foundmill's pre-registered client per vendor; a server not confirmed live is `live: false` (mock-only, Settings hides it). A new server: add its `RemoteServer`, its keys in `catalogue.ts`, `grants.ts` (tools and capabilities) and `platform.ts`/`env.ts`.
- **Money only comes in** (FOUNDMILL.md "Never"; founder, Nov 17, 2026): no tool that refunds, pays out, transfers or cancels has a handler, on any connector. Such a tool exists only as a `hardGate` card the founder acts on at the vendor. For Stripe, where "Sign in with Stripe" gives the platform `read_write` on the founder's account, `stripe.test.ts` "money never goes out" fails if one gains a handler or loses its gate.
- **Stripe is the one vendor with a Foundmill developer app** (founder, Nov 17, 2026): Foundmill is a Stripe Connect platform, so a founder can sign in with Stripe (OAuth; the code exchange is the proof, Stripe's access token is dropped) or paste a restricted key. An account id alone is never accepted.
- Agents are granted only tools that exist: `resolveGrants` maps grants onto served tools; a grant nothing serves fails `apps/orchestrator/src/__tests__/grants-contract.test.ts`.
- Mock webhooks verify against secrets in `fixtures/`, so they mount in development and test only (`registry.mountableWebhooks`).
- **A payment from a provider's test mode is simulated** (WP-14 T9 security review, Nov 17, 2026): a webhook normaliser sets `simulated: true` on `payment.received` when the provider says no money moved (Stripe `livemode: false`, a Shopify order with `test: true`), so it is never a real outcome (`isRealOutcome`, the metrics queries) and never backs a "Verified" card. A new payment connector does the same with its provider's own flag.
- Keys never live in fixtures, env files or logs.
- **The tool catalog is data, not connectors** (founder, Nov 22, 2026; `src/tool-catalog.ts`): the options per tool category the scout starts from, each with regions, route, test mode, a price band (always an Estimate) and `checkedOn`. Booking lists only the product's own; never add a booking vendor. `src/tool-recommendation.ts` writes the founder's note: what the founder must do comes from the route alone, never from the agent's text. The platform tools are `raise_tool_need`, `read_tool_need` and `recommend_tool`.

## Read when needed
- docs/ARCHITECTURE.md §8 Connectors (folder layout, mocks, platform mail, grants, channel availability, built-ins, founder's-own-key connectors, typed reads), §9 Gateway. Lines are very long: grep for the section heading and read only that section, never the whole file.
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
