---
date: 2026-11-15
branch: claude/wp02-t1-expired-approvals
title: An approval that expires says so
areas: [orchestrator, api, db, events]
supersedes: []
---
## What changed
Every live path that sets an approval's outcome to "expired" now writes one `approval.resolved` with outcome
"expired" (actor and resolvedBy `{ kind: "system", id: "expiry" }`) and closes the approval's Inbox note:
`expireApproval` (the approval wait timing out), the channel engine's full stop (a channel off the board or one that
cannot act), and taking a channel off the board from a plan (orchestrator and api) or from Distribution.
`repos.campaigns.endForChannel` returns `{ ended, expiredApprovals }`; `repos.channels.setEnabled` and `archive`
return the channel with `expiredApprovals`; `recordExpiredApprovals(db, businessId, approvals, at)` in
`@foundmill/events` writes the events and closes the notes. Test: `apps/orchestrator/src/__tests__/approval-expiry.test.ts`.

## Decisions
### No backfill
Approvals that expired before this change have no event; their history is read from `approvals.outcome`, as WP-02
T10 does.
### The helper lives in @foundmill/events
Both the api and the orchestrator write events with `buildEvent` and `repos.events.write`; packages/db cannot import
the event catalogue, so the one helper both call sits beside the writer.
### expireBefore is left alone
`repos.approvals.expireBefore` has no caller left outside its own test (the plan named session and vacation ends,
which no longer call it), so it is not changed here.
### The expired rows stay server-side
The Distribution toggle's response carries the channel only.

## Not done
Expired launch approvals written before this change keep their notes as they are. An api-level test of the
Distribution toggle's event (the repo and helper path is tested in the orchestrator).
