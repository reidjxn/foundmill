# apps/gateway (`@foundmill/gateway`)

The only process that holds vendor secrets and the only place a vendor API is called: session tokens, Cedar policy, connectors (real or mock), metering, audit, and the MCP endpoints agents use. It owns no product screens and decides no product rules beyond policy.

## Invariants
- **External calls only through here.** Every other service (api, orchestrator, ingest, composer) asks the gateway; never add a vendor call elsewhere.
- `/v1/call` and `/mcp/:connector` share one pipeline (`src/pipeline.ts`): authenticate, check the token's scope, load the connector, rate limit, re-read business and agent state (stopped, released, paused, revoked key: deny before Cedar), Cedar, `ask` writes an `approvals` row and `approval.requested`, `allow` injects the credential (decrypted in memory), call, meter, audit.
- Policy reads each tool's `policyHints`; deny beats ask beats allow. Anything outward or costly asks first in augmented and assisted mode; read-only lookups run.
- **Untrusted envelope:** all third-party content returned to agents is wrapped `{ untrusted: true, content }`; recipients found in it are remembered as "first seen in untrusted content" (`src/recipients.ts`); an agent holding outbound tools reads it through the quarantined reader (`src/untrusted-reader.ts`).
- A mock call returns `result.simulated: true` and `result.notice` (`SIMULATED_NOTICE`, `src/types.ts`); a live call carries neither.
- **Founder's own key:** a connector on the founder's key runs on the founder's own vendor account, always. The key is sealed in the vault (`src/credentials.ts`), used only here, never logged, audited or echoed. No fallback to a Foundmill platform key: not connected is refused. A mock connector the business never connected is 409 `integration_not_connected` on staging and production for a person's own business.
- After a vendor call has run, nothing may turn it into a failure: the `tool.call` audit row is written first; errors go through `safeError()`, never with tool arguments.
- Service routes check `svc` (most are `svc: api` only). Database access through `repos` only (`fm/no-raw-db`). Env through `loadEnv()`.
- Never let agent code move money, sign, accept terms, file with the founder's identity, delete permanently or change security settings (hard gates, root CLAUDE.md).

## Read when needed
- docs/ARCHITECTURE.md §9 Gateway (lines 146–167: every route and its order of checks), §8 Connectors (127–145), §7 Policy (119–126). Lines are very long: read a range or grep.
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
