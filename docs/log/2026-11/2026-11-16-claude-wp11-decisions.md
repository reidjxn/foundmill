---
date: 2026-11-16
branch: claude/wp11-decisions
title: Security and data items accepted for now (WP-11)
areas: [security, db, docs]
supersedes: []
---
## What changed
**WP-11 T19.** Every item WP-11 leaves open has a dated decision here, with what would reopen it. docs/SECURITY_REVIEW.md has a status table with one row per open id. docs/DEPLOY.md §3 says which service holds the vault key and which variables can leave which service (for WP-00 S16).
The plan asked for a DECISIONS entry; that file is frozen, so the decision is this log entry (`node scripts/decisions-index.mjs accepted WP-11` finds it).

## Decisions
### Accepted for now, with what reopens each
- **Extensions `pg_trgm` and `vector` stay in `public` (A8-20).** Moving them changes how the pinned-`search_path` functions (T4), `repos/social.ts`'s raw SQL and the PGlite harness resolve `%`, `similarity()` and the vector type, and there is no exposure while the Data API is off. Reopen: the Data API is ever turned on.
- **SEC-8, write policies wider than the api's roles.** Accepted while the Data API is off; T14 watches it. Reopen: `/health` shows `dataApi: "on"`.
- **SEC-17, no deny-list for session tokens.** The gateway re-reads business and agent state on every call, and a list keyed on the session's end would refuse the platform's own push and merge. Reopen: tokens leave the orchestrator's process.
- **SEC-19, per-business policies never loaded.** The table stays and no screen claims it. Reopen: a screen offers per-project policies.
- **SEC-11, Dropbox Sign's scheme.** Reopen: `dropbox_sign` enters any `LIVE_CONNECTORS`.
- **N2, the SendGrid half.** Reopen: a founder's own SendGrid is offered. Until then `sendgrid` stays out of ingest's list. The Stripe half is T20.
- **N3, Stripe Connect.** Reopen: Connect is wanted. WP-07's pay link runs on the founder's own restricted key and does not need it.
- **The wider secret split of A8-09** (session, service and link secrets, HKDF, 32 characters for the shared one). T12 closes the path that mattered, a service posing as the api. Reopen: a second service gains a route only it may call.
- **The vault on KMS, and moving the api's seal into the gateway (A8-10).** One project stores a key today. The seal sits inside the api's transaction and its AAD needs the row id, so the move is a design change, not hygiene. Reopen: ten stored keys, or the first paid plan.
- **Rotating the vault key: no tool.** Today it means a new key and every founder who stored one pasting it again. Reopen: as above.
- **PgBouncer in CI.** The one pooler-only bug so far (the session advisory lock) has its test, run by hand with `FM_TEST_POOLER_URL`. Reopen: a second pooler-only bug.
- **A general per-user limit on `/trpc/*` (SEC-13 remainder) and a second api replica.** T10's numbers decide. Reopen: T10's run.
- **`journey_daily_mv` rebuilt for every business (A8-17), and outbox rows never pruned (A8-25).** Fine at 3,500 events. Reopen: a refresh above 5 seconds, or `outbox` above one million rows.
- **The other five services do not check the schema they need, and no rollback procedure is written (EH-08 parts 2 and 3).** They deploy beside the api, so after a failed migration they run new code on the old schema until someone reads the failed deploy. Reopen: the first migration that fails in production, or a second api replica. `schemaReady` (T2) is the function to use.
- **The automatic sweep of projects with no members.** T16's path cannot create one, and its query finds any. Reopen: the query ever returns a row.
- **`/health` detail without sign-in, the `iss` claim, `GET /v1/connectors` without a token (A8-27, A7-22).** The detail is what WP-00's check reads; with JWKS the signature already binds the project; the gateway has no public address. Reopen: the gateway gets a public address.
- **`approvals.args` holds raw arguments (SEC-15).** A founder must read what they approve. The export held in memory (A8-29) and raw validation text reaching people (A8-28) are not security; A8-28 is WP-10's.
- **Collaborator P3s (#131, #132).** Defense in depth; no collaborator exists yet. Reopen: the first collaborator joins a project.
- **Leaked-password protection off.** No password sign-in is accepted (`passwordOnlyFromPayload`, now in `@foundmill/shared/auth-verifier`). Reopen: password sign-in is ever offered.
- **The demo roll stays hourly** (recorded decision); T9 measures it. Reopen: a roll above 60 seconds.
### SEC-18 is closed, not accepted
`grep -rn "disable trigger" packages/db/src/seed packages/db/src/seed.ts` finds nothing.

## Not done
- WP-00 S16 (deleting the variables) is the Desktop session's, with the list in DEPLOY §3.
