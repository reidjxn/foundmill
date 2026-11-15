---
date: 2026-11-15
branch: claude/wp05-t3-task-reports
title: Reports - the result of a task is saved, readable by the next agent and by the founder's note
areas: [db, connectors, gateway, orchestrator, agents, events]
supersedes: []
---
## What changed
WP-05 T3 (AR-02). The result of a task an agent finished lived only in its last message, so the next agent and
the founder's note never saw it.
- Migration 0110 `task_reports`: members read (as for `tasks`, so a collaborator too), only the services write.
  Schema mirror, `repos.taskReports` (`save`, `latestForTask`, `listForBusiness`), a row in the generated
  cross-tenant suite, and `task_reports` in `EXPORT_TABLES` (section development).
- Platform tools `save_report` (own task only, `not_yours` otherwise) and `read_report` (any task of the business,
  untrusted `document`, ref `report:<taskId>`, read only). Capabilities `reports.write` and `reports.read`, both in
  `PLATFORM_BASE_TOOLS`. The in-memory mock host serves both.
- The gateway sets `simulated` on a report when an allowed `tool.call` of the saving session ran in mock mode.
- `complete_task` saves its summary as a report, under the task's title, when the session saved none of its own.
- `get_task` (and `update_task`, which answers the same shape) carries `lastReport` (excerpt of 500 characters) and
  `lastBlock` (the task's newest `task.blocked`).
- `task.completed` gains `reportId` (default null). `finishSession` fills it with the report this session saved, and
  for a task that is not code the summary is the report's title, a blank line, then the first 1,700 characters.
- T2's `completedOwnTask` is also set by a `save_report` on the session's own task.
- One rule added to the researcher, the product researcher, the eight specialists and the channel engines:
  "Save your result with save_report before complete_task: findings, sources, and what you recommend. A result
  that is only in your last message is lost." It is in `SHARED_RULE_FRAGMENTS`, so it is not read as a trait.
- docs/ARCHITECTURE.md §4 (the table) and §8 (the built-in platform tools).

## Decisions
- The table has `updated_at` too: the spec left it out, but every table needs it (`migrations.test.ts`).
- An index on `task_id` alone besides `(business_id, task_id, created_at desc)`: every foreign key column needs an
  index whose first column it is (`migrations.test.ts`).
- A trigger refuses a report whose task is of another business, whoever writes, as 0106 does for post links. The
  spec did not ask for it; it is a few lines and closes the one cross-tenant path a service write could open.
- `session_id` and `agent_id` carry no foreign key, as the spec has them: a report outlives a released agent.
- `simulated` matches `{ sessionId, outcome: "allow", mode: "mock" }` from the session's start: a call that was
  refused or asked read nothing, so it does not mark the report.
- `complete_task` saves a report for every kind of task, code included, as the spec says. Whether the session saved
  its own is read from the newest report's `session_id`.
- `finishSession` uses the newest report only when this session saved it, so an earlier session's notes never
  stand for this one's result. A code task keeps the run's summary and gets the `reportId`.
- `lastBlock` is read from the newest 200 `task.blocked` events of the business and filtered by task, as
  `session.ts` already does: `repos.events.list` has no payload filter and adding one was not needed here.
- `save_report` does not require the task to be open: saving a result on a blocked task is still useful.
- `read_report` on a task with no report answers `not_found` ("has no report yet").
- T2's one extra turn ("Call complete_task ... or block_task ...") and `NO_RESULT_REASON` are unchanged.

## Not done
- The golden eval `researcher.report_saved` is T6, as the spec plans it.
- Showing reports on a screen (the founder reads them through the note's summary for now); the entity-mention
  check on report text moves to T7, where the text is first rendered.
- Step 5, the security review of the diff, is run by the execution session.
