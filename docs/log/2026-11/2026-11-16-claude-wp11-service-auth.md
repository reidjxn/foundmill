---
date: 2026-11-16
branch: claude/wp11-service-auth
title: Who may mint a session token; a tool without hints is refused; one JWT verifier for the api and the stream
areas: [gateway, connectors, api, stream, shared]
supersedes: []
---
## What changed
**WP-11 T11 (A7-15, A7-16, SEC-17) and T13 (A8-12, A8-24), in one pull request.** Both are service auth; they touch different files.
- **The mint.** `mintRefusal` (apps/gateway `app.ts`) runs before the business is read. Only `orchestrator` and `api` mint (`MINTING_SERVICES`), nobody gets the bare `*`, and the api gets one named tool with no session, no wildcard and no offline tracking (its one path is `services/gateway.ts` `toolCall`). A refusal is 403 `forbidden_service` or `mint_scope_refused`. Tests: `mint-scope.test.ts`.
- **No hints entry, no call.** `executeToolCall` denies a tool its connector declares no `policyHints` entry for, with policy id `missing-policy-hints` and an audit row, next to the session-scope check.
- **The contract case.** `INTERNAL_WRITE_TOOLS` (`packages/connectors/src/testing/contract-suite.ts`): 18 tools that write but carry no outward hint, each with its reason. A tool whose hints are all false is either read-only or on that list, and a listed tool must not tell MCP clients it is read-only.
- **One verifier.** `apps/api/src/auth.ts` moved to `packages/shared/src/auth-verifier.ts` (subpath import only, so it stays out of the web bundle); the api re-exports it. apps/stream's module wraps it and keeps its shape (`StreamAuthError`, a raw token, `expiresAt`).
  New rules: no development bypass in a process with `NODE_ENV=production` whatever `APP_ENV` says; every token needs `exp`; `AuthUser.expiresAt`.
  The stream now refuses password-only sessions and passes `emailConfirmed` to `liveChannelAdmit`, which trusts a listed address only when the token confirms it (the api's `isAdmittedNow` rule). Both services log one warning at boot while the bypass is on.
- apps/gateway/CLAUDE.md says what the Cedar files do per mode, and the mint rule.

## Decisions
### No hint changed
The plan's contract case ("all-false hints declares `readOnlyHint: true`") passed for every tool on day one, because `toMcpDefinition` derives `readOnlyHint: true` whenever the hints are all false. So I read the 103 such tools.
 85 are reads. The other 18 write inside the founder's own accounts (a branch, a draft, a document, a Stripe customer) and go on the list. Ten of them told MCP clients they were read-only; they now declare `readOnlyHint: false`. Nothing in our code reads that annotation.
### stripe:create_invoice is the founder's call
It finalizes the invoice (Stripe then allows only a void) but sends nothing until `send_invoice`, which asks. Giving it `irreversible` would make agents ask before creating one in assisted and augmented mode. I left it hint-free and listed, and put the question in the pull request.
### The mint does not intersect with the agent's grants
It also does not refuse a session that has ended. The orchestrator's workspace push, merge and checkout mint for tools the agent does not hold, some after the session ended (WP-11 "Corrections to the audits" 4). The mint limits who asks, instead.
### Test clients mint as orchestrator
The gateway's test clients signed as `test-orchestrator`, `smoke`, `builtins` and `reader-test`; they now sign as `orchestrator`. The one test that minted `["*"]` to reach the unknown-connector 404s names the two connectors instead.
### Tests in their own file
The mint table is in `mint-scope.test.ts` rather than `service-routes.test.ts`: it needs an agent and a session, which the gateway harness gives and that file's setup does not.
### apps/collab
It shares `liveChannelAdmit` and passes no `emailConfirmed`, so it now admits a listed address only through a recorded admission. It is not deployed (WP-12 decides its future); its own verifier copy stays.

## Not done
- T12 (the api-only service token secret) touches `packages/shared/src/env.ts` and `.env.example`, which open branches of WP-13 and the network session also change; it waits for them.
