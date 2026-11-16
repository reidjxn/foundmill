---
date: 2026-11-16
branch: claude/wp11-api-token-secret
title: An api-only service token secret, switched in three steps
areas: [gateway, api, shared]
supersedes: []
---
## What changed
**WP-11 T12 (N4, A8-09 first step, a11 C4, a11 S1).** Stacked on `claude/wp11-service-auth` (both edit the gateway's `app.ts`). The production switch is the founder's (F5).
- New optional variables `API_SERVICE_TOKEN_SECRET` (api and gateway, 32+ characters, or neither starts) and `API_SERVICE_TOKEN_LEGACY` (gateway, `1` while switching), in `packages/shared/src/env.ts` and `.env.example`.
- `verifyServiceTokenFor` (`apps/gateway/src/tokens.ts`) works by mode:
  - With no api secret, every service verifies under the shared one, as today.
  - With one, a token under the api secret must claim `svc: "api"`, and a shared-secret token may claim `api` only while the legacy flag is set. Every other service verifies under the shared secret as before.
- `requireService` uses it.
- The gateway's `/health` adds `apiServiceToken: "shared" | "legacy" | "own"`.
- The api signs with `API_SERVICE_TOKEN_SECRET` when it is set.
- docs/DEPLOY.md §3 has the three steps of F5 with their checks; docs/SECURITY_REVIEW.md N4 says what is in and what waits.
- Tests: `tokens.test.ts` (the table: signing secret × `svc` × mode) and `config.test.ts` (a 31-character secret refuses; the legacy flag is read).

## Decisions
### Recorded decision kept
2026-11-11 "SEC-14: the calls made" said the split needs the variable on both services at the same deploy. The legacy mode lets the code merge first, so the switch is three safe steps instead of one coordinated deploy.
### Only the api's path
The wider secret split of A8-09 (session, service and link secrets, HKDF) stays for T19's dated decision: this closes the path that mattered, a service posing as the api.

## Not done
- F5, the founder's.
- `packages/shared/src/env.ts` and `.env.example` are also changed on open branches of WP-13 and the network session. Whichever merges second resolves a one-line append.
