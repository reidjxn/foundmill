---
date: 2026-11-15
branch: claude/wp05-t13-lost-sessions
title: Lost sessions are closed and their tasks planned again (WP-05 T13)
areas: [orchestrator]
supersedes: []
---
## What changed
- `OrchestratorDeps.workflowRunning(workflowId)` answers true, false or null (unknown). The default is null;
  `createWorker` sets it from its connection through `workflowRunning` in `src/index.ts`
  (`describeWorkflowExecution`: running is status 1; gRPC NOT_FOUND is false; any other error is null).
- `closeLostSessions(deps, businessId)` in `src/activities/dispatch.ts`: an open session row older than 10 minutes
  (`LOST_SESSION_AFTER_MS`) whose `session:<id>` is known not to be running is ended with outcome `lost`, its task
  goes from `running` back to `ready`, and `session.reconciled` is audited, in one transaction. Returns the ids.
- `refreshAgentHealth` calls it first, so the hourly `agent-health-sweep` closes lost rows before it reads health.
  The schedule's description and the ARCHITECTURE §10 schedules row say so. No workflow change, no migration.
- Tests: four named cases from the spec plus "a task that moved on is closed without being planned again" in
  `dispatch.test.ts`, and the sweep path through `refreshAgentHealth` in `schedules.test.ts`.

## Decisions
- NOT_FOUND counts as not running: the main lost case is a row written by dispatch whose workflow never started.
- Temporal is not asked about rows younger than 10 minutes, and an unknown answer never closes anything.
- The row is re-read inside the transaction, so a workflow that ended its own row meanwhile is left as it ended.
- A task in any state other than `running` (review, paused, blocked) keeps its state; only the row is closed.
- Lost rows are closed while the team is stopped too: it is bookkeeping, and dispatch still refuses new work.
- `lost` is not counted as a failure by the retry backoff (`failureStreak` counts `failed` only): the platform lost
  the run, not the agent.
- Audit only, as the spec says; no new event. The founder's History and Logs tabs show the outcome as "Lost".
- The schedule's description changed, so its fingerprint changes and the schedule is updated once at the next boot.

## Not done
- No cap on a task lost again and again; each loss needs a new dispatch and a dead workflow, so it is left for now.
- Query 5 ("Measurement") is to be read an hour after the deploy.
