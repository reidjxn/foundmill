---
date: 2026-11-24
branch: claude/eager-dijkstra-s7boeo
title: The launch gate's six causes (WP-05 T21 to T26) - a missing connector, input or tool ends a task done with its report and one Needs you item
areas: [orchestrator, gateway, connectors, agents, api, evals, docs]
supersedes: []
---
## What changed
- Docs: WP-05 gains T21 to T26, one per cause of the Nov 24 test round, and the launch gate paragraph. `audits/e0-production-evidence.md` gains "Test round, Nov 24, 2026" with the evidence table. `docs/ARCHITECTURE.md` says how a task that is not code ends under the gate.
- T21 (cause 1): `search_web` with no platform search now says the deployment's search is off (`WEB_SEARCH_OFF`), not that a key is missing. The gateway logs its model client's mode and `webSearch: on|off` at boot, and logs an error when the client is mock outside development and test. The stale comment in `reader-models.ts` (free-plan search "refused") is corrected.
- T22 (cause 2): the T12 pre-flight stop is gone (Launch S28, #398, had narrowed it to research with no usable web). Every task starts. A task that is not code is told "do the task with the tools you have; do not stop for it". Its closing line asks the agent to finish, save its report, and put what only the founder can do under `## Needs you`.
- T23 (cause 3): `SECOND_READ_REVISION_TOOLS` keeps `save_report` and `read_report`. The new `completion-tools.test.ts` checks that 43 templates (the 5 background helpers take no tasks) × 8 task kinds hold their completion tools, after the revision's narrowing too.
- T24 (cause 4): the Planner's `PLANNER_ACCEPTANCE_RULE`. `buildPlannerRequest` carries `connected`, from both callers (`task-graph.ts`, `roadmap-plan.ts`).
- T25 (cause 5): `loadDispatchFacts` holds a task whose title or goal names the specification, the vision or the roadmap while the foundations are `drafting`.
- T26 (cause 6): the end of a non-code session is `finishWithHandOff`. With a report and `complete_task`, the task ends `done`. The things only the founder can do go to the founder through `activities/hand-off.ts` `handToFounder`: unmet lines, a `block_task` reason after the report, the report's `## Needs you` section, and connections that were refused. They arrive as one `decision` note per task, or as one shared "Connect <names> for the team" note when a connection was the only gap. A note whose subject is still waiting is never written twice.
- Evals: `researcher.unmet_line_is_not_done` becomes `researcher.unmet_line_goes_to_founder`. `channel_email_automation.not_connected_is_not_sent` now ends done with its draft, nothing sent, and one Needs you item. New cases cover causes 1 to 3 on a free-plan project with nothing connected: `researcher.free_plan_searches_and_reads`, `product_researcher.nothing_connected_still_finishes`, `product_lead.revision_saves_report`. Launch S28's four not-connected cases (`evals/src/sessions/agents.ts`) are changed to the gate as well. The harness gains `plan: "free"`, `revision`, `needsYou`, a clean Needs you list per case, and a rate-limit store per case (the web's 30 calls a minute are per business).

## Decisions
### Cause 1 is configuration, not the free plan
The free plan does search, on Haiku 5.5 (`FREE_PLAN_HAIKU_ROUTES`). The production gateway answered `web: ANTHROPIC_API_KEY is not configured` at 10:01 UTC on Nov 24, which happens only when its platform model client is not live. The key is set (e0, Nov 15), so the gateway's `MODEL_MODE` is not `live`. The same mock client is the quarantined reader, which explains the empty page reads. The fix is setting `MODEL_MODE=live` on the Railway gateway. This change does not make that change; it makes the problem visible and the message true.
### Done with a report, and the founder asked once
The gate needs a task that cannot finish to end without a `blocked` outcome. A report the agent saved is a result, so the task ends `done`. What only the founder can do becomes one Needs you item. A task with no report at all keeps T2's `no_result`. On a real project, a report built on simulated reads, or a session whose only outside answers were simulated, still ends `blocked` / `not_connected`. T1 refuses those answers, so this stays as a backstop, and nothing simulated is ever counted as done. The item is a `decision` with "Done" and "Not now" and free text, and it never blocks Continue.
### One item per task, one shared note for a connection
Test rounds showed five tasks missing the same GitHub connection. They share one "Connect GitHub for the team" note. A task that also left lines unmet gets its own note, which names the connection too, so the founder never gets two notes about the same thing.
### A block after the report is a hand-off
Agents that ran into a missing input (a sender name nobody set) used to call `block_task` after writing their draft. If the session saved its report, the block reason is handed to the founder and the task ends done. A block with no report stays a block. Waiting on another task is still a real dependency.
### Spec wait on `drafting` only
`pending` is not held, because a business whose foundations never start (a seed, an import) would wait for good. The test round's case was `drafting`. The match is on words ("spec", "specification", "vision", "roadmap") in the title or goal. That is simple, and it can hold a task that only mentions the roadmap; the hold lasts only for the few minutes of drafting.
### The Planner learns what is connected
An acceptance rule alone cannot stop "records in the CRM" if the Planner does not know whether a CRM is connected, so the request now lists the connected connectors. Whatever the Planner still gets wrong is handed over by T26.
### Free plan on opus and sonnet: by design today
`FREE_SESSION_MODEL` defaults to `routed` since WP-13 T8 (Nov 17), because Haiku 5.5 leaked planted instructions in the injection suites. A free session therefore runs the agent's own model. Reported, not changed.
### Live run of the new cases
This session has no Anthropic key, so the one live run of the new cases was not made here. The nightly outcome workflow runs them.
