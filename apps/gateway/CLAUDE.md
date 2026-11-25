# apps/gateway (`@foundmill/gateway`)

The only process that holds vendor secrets and the only place a vendor API is called: session tokens, Cedar policy, connectors (real or mock), metering, audit, and the MCP endpoints agents use. It owns no product screens and decides no product rules beyond policy.

## Invariants
- **External calls only through here.** Every other service (api, orchestrator, ingest, composer) asks the gateway; never add a vendor call elsewhere.
- `/v1/call` and `/mcp/:connector` share one pipeline (`src/pipeline.ts`): authenticate, check the token's scope, load the connector, rate limit, re-read business and agent state (stopped, released, paused, revoked key: deny before Cedar), Cedar, `ask` writes an `approvals` row and `approval.requested`, `allow` injects the credential (decrypted in memory), call, meter, audit.
- Policy reads each tool's `policyHints`; deny beats ask beats allow. Augmented mode asks for anything that contacts a third party, spends or cannot be undone; assisted mode asks for what cannot be undone, for contracts and above the spend threshold, and lets the rest run (BUILD §9.6, `60-assisted.cedar`); read-only lookups run. A tool with no `policyHints` entry is denied (`missing-policy-hints`); a tool whose hints are all false is read-only or on `INTERNAL_WRITE_TOOLS` (`packages/connectors/src/testing/contract-suite.ts`).
- A tool on `PAYMENT_RECORD_TOOLS` (a finalized invoice, a payment page) asks in every mode, and in automated mode and on vacation unless the business gave agents the inbound payment power (`businesses.payment_powers`, founder Nov 16, 2026). There is no outbound power: paying out, refunding and transferring are hard gates.
- **Remote MCP servers** (`notion_mcp`, `hubspot_mcp`, `shopify_mcp`, `lightbringer_mcp`, `sentry_mcp`, `lovable_mcp`, `mcp_custom`; packages/connectors `src/remote-mcp/`): the gateway is the only MCP client and an ordinary connector to this pipeline, so scope, state, Cedar, ask, meter, audit and the untrusted envelope apply unchanged. `call_unlisted_tool` asks first; a hard-gate name on it is denied at step 2c before anyone is asked. Tokens are sealed like any credential, refreshed (rotating refresh tokens, one refresh per credential in flight) and revoked on disconnect.
- **Founder-executed tools** (founder, 2026-11-22): `executeToolCall` refuses one for every session token with policy id `founder-executed`, whatever `allowedTools` says and in every business mode, and `mcp.ts` never lists it. The one executor is `POST /v1/founder-actions/execute` (`src/founder-action.ts`, `svc: api`): a single-use press token bound to the sha256 of the exact payload the founder saw, then the stored hash, the connection, a fresh read of what the note showed, one atomic claim, Cedar with `context.founderPress`, the call, audit `founder_action.executed`. No `approvals` row exists for it; vacation, automated mode, email one-click and Today never answer its note.
- Only `orchestrator` and `api` mint session tokens (`mintRefusal` in `app.ts`): nobody gets the bare `*`, and the api gets one named tool, no session, no offline tracking.
- **Untrusted envelope:** all third-party content returned to agents is wrapped `{ untrusted: true, content }`; recipients found in it are remembered as "first seen in untrusted content" (`src/recipients.ts`); an agent holding outbound tools reads it through the quarantined reader (`src/untrusted-reader.ts`).
- A mock call returns `result.simulated: true` and `result.notice` (`SIMULATED_NOTICE`, `src/types.ts`); a live call carries neither.
- **Founder's own key:** a connector on the founder's key runs on the founder's own vendor account, always. The key is sealed in the vault (`src/credentials.ts`), used only here, never logged, audited or echoed. No fallback to a Foundmill platform key: not connected is refused. A mock connector the business never connected is 409 `integration_not_connected` on staging and production for a person's own business.
- After a vendor call has run, nothing may turn it into a failure: the `tool.call` audit row is written first; errors go through `safeError()`, never with tool arguments.
- Service routes check `svc` (most are `svc: api` only). Database access through `repos` only (`fm/no-raw-db`). Env through `loadEnv()`.
- Never let agent code move money, sign, accept terms, file with the founder's identity, delete permanently or change security settings (hard gates, root FOUNDMILL.md).

## Read when needed
- docs/ARCHITECTURE.md §9 Gateway (every route and its order of checks), §8 Connectors, §7 Policy. Lines are very long: grep for the section heading and read only that section, never the whole file.
- docs/BUILD.md §9.5 Tool gateway and policy engine, §9.8 Prompt-injection defense, §10.2 Bring-your-own key, §2.2 Hard gates, §14 Security and compliance checklist.
- Decisions: `node scripts/decisions-index.mjs gateway untrusted` or `node scripts/decisions-index.mjs own key`, then read only the printed range. docs/SECURITY_REVIEW.md for SEC-n ids.

## Commands
- `pnpm --filter @foundmill/gateway typecheck` | `lint` | `test`
- Policy rules: `pnpm --filter @foundmill/policy test`; connector contract: `pnpm --filter @foundmill/connectors test`

## Key files
- `src/app.ts`: `createGatewayApp(deps)`, the HTTP surface (route list in its header)
- `src/pipeline.ts`: the tool-call pipeline
- `src/mcp.ts`: `ALL /mcp/:connector` streamable-HTTP MCP servers
- `src/tokens.ts`: service and session JWTs (`SESSION_TOKEN_SECRET`)
- `src/state.ts`: business and agent state re-check on every call
- `src/credentials.ts`: sealed per-business credentials
- `src/untrusted-reader.ts`, `src/recipients.ts`: quarantined reader, untrusted-recipient register
- `src/types.ts`: wire types, `SIMULATED_NOTICE`; `src/__tests__/harness.ts` for tests
