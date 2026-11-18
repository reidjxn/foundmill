---
date: 2026-11-17
branch: claude/wp14-t12-four-measures
title: Four measures in the nightly numbers (WP-14 T12)
areas: [db, api, orchestrator, docs]
supersedes: []
---
## What changed
`platform_metric_days.facts` gains three blocks, with no migration (the column is jsonb): `first_session`, `resting` and `customer_updates`. `repos.metrics.snapshot` fills them from four new statements in `METRIC_QUERIES`, and `report:metrics` prints them (a row stored before this change prints without them).
- Minutes from commit to the first plan and to the first approval, for projects committed in the 14 days: median, 90th percentile and how many projects have one.
- The share of founders whose first press of Continue was not refused. `startCycle` (apps/api) now writes one audit row, `business.continue_refused` with `{ reason: "stopped" | "vacation" | "blocked" }`, before it refuses; the refusal itself is unchanged.
- Resting and what follows it, and shares for each Customer Update: written against events nothing emits yet, named once in `PENDING_SOURCES`. They read zero with a null share today.
- The operator's note: when the median time to the first plan is over 10 minutes, `first_session.note` holds the sentence, the report prints it, and the nightly activity logs `{ alert: "first_plan_slow" }` at error level.
Tests: `metrics.test.ts` in packages/db (the three blocks on the fixture, the pending sources before and after their events exist, the note at 10 and 10.1 minutes), `demo-isolation.test.ts` (the demo adds nothing), the api's `cycle.test.ts` (a refused press leaves one audit row), the orchestrator's `platform-metrics.test.ts` (the alert).

## Decisions
### The first plan is the first sign-off the team asks for
The plan note (WP-04 T5) is the first thing a founder is asked to approve, and each of its rounds is a `product_signoffs` row with `requested_at`. The measure is the earliest of them for the project. An Inbox item was not used: the note can be deleted, the sign-off row stays.

### The first approved outcome is the first approval by a person
The earlier of an approved sign-off (`decided_by_kind = 'user'`) and an approved `approvals` row (`by_kind = 'user'`). WP-14 T4 counts approved outcomes on Today in another session and had not pushed when this was written. If T4 defines an approved outcome differently, this statement should follow it: it is one sub-select in `first_session_times`.

### A refused press is recorded in the audit log, not as an event
A press that worked already leaves an audit row (`business.continue`, `cycle.run_start` or `business.resume_cycle`); a refused one left nothing, so the share could not be computed. One more audit action keeps both sides in one table and adds no event type.
A refused press before this change is not known, so a founder whose first press was refused earlier counts from the first press that worked. The share is honest only for founders who start after this merges.

### "New founders" are those whose first press fell in the 14 days
The first press is taken per person, over projects that person started (`businesses.created_by`), by the person themselves. A cofounder's press on someone else's project is not a first session.

### Resting is measured a week later, and "leave" means no visit in that week
A project that started resting 7 to 21 days before the window end has had a week to act. The first of credits added or a plan change in that week names what it did; with neither, a visit (`founder_visit_days`) reads as waiting for the reset and no visit as leaving. The share is of outside projects committed more than a week before.

### The pending event names are a proposal to T1, T14 and T9
`team.resting`, `credits.topped_up`, `plan.changed` and `customer_update.shared` (with `payload.conversionId`, the Customer Update's `customer.converted` conversion id) are not declared in `packages/events`: declaring them belongs to the tasks that write them. They are named in one constant so that the session that lands each fact either uses the name or changes it there.

### The operator's note is an error log with an alert key
There is no operator inbox. The existing way to reach the operator is an error log with `alert: "<key>"` (`model_billing`), so the note is `alert: "first_plan_slow"`, and the sentence is also stored in the day's facts and printed by `report:metrics`. Routing the alert to email or a phone is WP-00 S12.

## Not done
- No screen shows these numbers; they are read with `report:metrics` or from the table, as WP-02 T10's are.
- Shares are counted per `customer_update.shared` event; what counts as one share (an image export, a public page opened) is T9's to decide.
- Median time to the first plan is over all projects committed in 14 days, not per plan or per model.
