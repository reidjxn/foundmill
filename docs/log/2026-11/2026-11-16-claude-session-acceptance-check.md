---
date: 2026-11-16
branch: claude/session-acceptance-check
title: Acceptance lines on a task that is not code are checked against what the agent did
areas: [connectors, gateway, orchestrator, evals]
supersedes: []
---
## What changed
The founder (Nov 16, 2026): "Acceptance lines on non-code tasks are never checked against what the agent did."
Until now a task that is not code ended done once its agent called `complete_task`, unless every outside call was
simulated or not connected (WP-05 T2). Nothing ever read its acceptance lines.
- `complete_task` takes an optional `acceptance: [{ line, met, reportSection?, tool? }]`, one result per line,
  numbered from 1. For a met line, the result says where it shows: a heading of the saved report, or the tool call
  that did it. The shared rules live in `packages/connectors/src/connectors/platform/acceptance.ts`
  (`acceptanceLines`, `acceptanceRefusal`, `unmetAcceptanceLines`, `bareToolName`). No model grades anything.
- Gateway `completeTask` (and the in-memory mock host): a task with lines can be completed only from its own
  session. It needs a report this session saved with `save_report`, one result per line, and a place for each met
  line. A cited section must be a whole heading of that report. Anything else is refused `invalid_state` with a
  sentence the agent can act on. An accepted set never sets the task done: it stays open, and the session sets its
  status when it ends. The audit action is `platform.task.acceptance_reported`, with the results and `unmetLines`.
- Orchestrator: the recorder keeps the last accepted `complete_task`'s results (`acceptanceClaims`), whether this
  session saved a report (`savedOwnReport`), and for every tool how many calls went through and how many of those
  were real (`toolsUsed`). After T2's two checks, a task with lines ends `blocked` / `no_result` if no report was
  saved or any line does not hold. A line does not hold when it has no result, is marked not met, cites a tool this
  session never ran (platform and quarantine tools are never evidence, and a cited connector must be the one that
  ran), or, on a real project, rests on a tool whose every call was simulated or not connected, or on a section of a
  simulated report. Those last two are T2's rule applied to a single line. Reason: `acceptance not met: line 2`. The summary names each unmet
  line once: `Blocked: <agent> ended "<title>" with 1 of its 2 lines not met: “<line>”.`
- The task brief numbers a task's lines when it is not code and adds `ACCEPTANCE_BRIEF` (two sentences on how to
  report them).
- Tests: nine session cases in `session-live.test.ts`. Five of them fail with the check disabled; the other two
  are the done cases (the two cases added after the review were checked against the review's scenarios). Five gateway cases are in `builtins.test.ts`. The new eval case
  `researcher.unmet_line_is_not_done` has a scripted agent that claims a send it never made. The eval tests also
  show that the case's check fails when every line really holds.

## Decisions
- The brief goes in the session's task prompt, not in the house rules. That prompt is the brief every session gets,
  and the sentence shows only on tasks that have lines. The WP-06 T1 resolver does not build the session prompt yet
  (its log: session.ts was left untouched).
- Reused `blockedReason: "no_result"`, with a new reason string `ACCEPTANCE_UNMET_REASON`. A session that reported
  but did not meet its lines has no result that counts, so no new enum value and no consumer change was needed. The
  outcome is a blocked task with a plain summary, never a to-do or a Needs you item.
- "A report was saved" means `save_report` in this session. The summary that `complete_task` saves as a report
  (WP-05 T3) does not count for a task with lines: it has no sections to cite.
- A task without lines behaves exactly as before. So does a code task: its lines are checked by its tests.
- The gateway refuses a malformed set instead of ending the task, so the agent can fix it in the same turn. It does
  not judge tool claims, because only the session sees the full results. That is why it never sets a task with lines
  done, and why such a task is completed only from its own session: the orchestrator's verdict is the only one.
- A tool call counts as run only if it went through, was not denied or held, and its result has neither
  `integration_not_connected` nor `"ok": false`. It counts as real if it also has no `simulated: true`. This is read
  from the full result text, as T2 reads it. On a sample project, simulated calls count, as T2 allows there.
- Tool names are matched bare and lowercase (`mcp__web__fetch_page`, `web:fetch_page` and `fetch_page` are one).

## Security review
The `security-reviewer` agent's findings on the first draft, and what was done:
1. (High) Citing a platform tool (`save_report`) made a line met. `toolsUsed` now holds outside tools only, keyed
   by name and by `<connector>:<tool>`. A citation that names its connector must match the one that ran.
2. (High) `reportSection` was a substring check, so `"e"` matched any report. It must now be a whole Markdown
   heading. On a real project, a line shown only in a simulated report is not met.
3. (Medium-High) `complete_task` on another task with lines was judged by the gateway alone. Now refused: a task
   with lines is completed only from its own session.
4. (Medium) The gateway set the task done on an all-met claim until the session ended. It now leaves it open.
5. (Low) The audit row for a task with lines uses `platform.task.acceptance_reported`, not `platform.task.completed`.
6. (Low) The agent-written `reportSection` and `tool` strings sit on the audit row like `summary` does. No screen
   renders `details.acceptance`. The founder's summary quotes the task's own lines, not the agent's claims.
7. (Low) Tool use is read from the result text, as T2 reads it. Left as is: it can only fail safe.
8. (Low) A blocked reason with two lines of the same text showed the wrong line number. Lines are now carried by
   index.

## Not done
- A line shown in a report section is checked only to the point that the section is a heading of a real report.
  An agent can still write "sent" under a heading for something it never sent. Only a line that cites a tool is
  checked against the tool's real results.
- Archetype lines that may be hard to meet were left as they are, since no test shows one blocking every run.
  `packages/agents/src/archetypes.ts:150` "Runway warning thresholds configured" (no tool configures them).
  `:464` "At least 20 suppliers recorded as CRM entities" (needs `create_entity`, pull request #234) and "RFQ pack
  complete and identical for every supplier" (softened in #234).
