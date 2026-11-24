---
date: 2026-11-24
branch: claude/launch-s28-gate-round6
title: Launch gate run 45429423911 - the task id is in every prompt, a finished task does not wait on a moot approval, and triage routes defects to development
areas: [orchestrator, agents]
supersedes: []
---
## What changed
- Read pass 1 of run 45429423911: 53 of 55 sessions passed and 4 of 5 utility golden tasks passed. Pass 2 did not run.
- `product_lead.revision_saves_report`: the agent's notes named the cause. "The task ID wasn't included in the brief, and I have no tool that lists tasks." A second read's revision holds only the document tools, and no prompt stated the task's id.
- `session.ts`: the task prompt now carries "Task id: <id>" under its title, for every agent and every kind of task.
- `channel_lead_generation.apollo_connected`: Apollo's `search_organizations` asked first, by design (it spends the founder's Apollo credits). The agent went on without it, saved its report and called `complete_task`. The session then waited for a decision that would change nothing, until the gate's ten-minute deadline.
- `session.ts`: when a task that is not code is completed or blocked by its agent while a call still waits on the founder, the hold is closed as expired and the session ends. A code task keeps waiting, because its gated push or merge still matters.
- `triage.route` (golden) sent the checkout error to `product`, where the case expects `development`. The run before passed. The template only said to follow a routing table that the input did not include. `triage.ts` gains one rule: without a table entry, a defect in what is built routes to development, and product is for what to build and why.
- Tests in `session-live.test.ts`: the prompt carries the task id, and a completed research task with a pending approval ends at once with the hold expired.

## Decisions
### Expire the hold instead of waiting
The agent reported its result without the gated call. Approving it afterwards would spend the founder's credits on a lookup nobody reads, so the hold is closed rather than left for the founder. Code is excluded: a push or a merge waiting on the founder is the work itself.
### The id in the prompt, not one more tool
Giving the revision `list_tasks` would widen the narrowest grant there is. The id in the prompt helps every agent and widens nothing.

## Not done
- The two-pass rerun is for the coordinating session to dispatch.
