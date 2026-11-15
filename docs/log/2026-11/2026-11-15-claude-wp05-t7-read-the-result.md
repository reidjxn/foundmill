---
date: 2026-11-15
branch: claude/wp05-t7-read-the-result
title: WP-05 T7, the founder can read the result of a finished task
areas: [api, web, dugout, modules, composer, models, agents, evals, db]
supersedes: []
---
## What changed
- `dev.tasks.get` carries `report: { id, title, bodyMd, sources, simulated, createdAt } | null`: the task's latest
  `task_reports` row, read in the caller's RLS transaction. A collaborator reads the task and gets `report: null`
  (T3's `is_member_not_collaborator` policy); another business's member reads nothing. Mentions in the body that do not
  validate against the records it names (the business's agents; CRM entities only with CRM read) are stripped with
  `stripInvalidMentions`. Test: `apps/api/src/__tests__/dev-task-report.test.ts`.
- Development › Plan: selecting a task that finished or stopped reads `dev.tasks.get` and, when there is a report,
  shows a "Result" panel under Dependencies ("Saved <relative date>"). New design-system component `TaskResult`
  (story and test): the title as text, a "Simulated: sample data, nothing real was read" chip above the body when
  simulated, the body through `Markdown` with `images={false}` and `webLinksOnly`, and the sources as links that open
  in a new tab (a source that is not http(s) is text).
- `Markdown` gains `webLinksOnly`: only http(s) addresses are links; a path, `mailto:` or `tel:` shows as its words.
- Composer prompt v8 to v9: a finished task's report is said in one or two sentences, in the founder's words, the note
  says the full result is on the task, and never counts its tool calls or steps. The mock Composer quotes the report's
  first safe sentence ("What it found: ... The full result is on the task."), never one with an address or an
  instruction-like word, and labels a figure from it "Estimate".
- Eval cases `composer.task_report_found.0-2` in `evals/src/task-report-notes.ts`: the finding is quoted, the full
  result is pointed to, a real report is not called simulated. Composer test in `narrate.test.ts`.
- Seed: Northwind's done "Reaction report synthesis Q3" has a saved report, read by the new case in
  `apps/web/e2e/team-development.spec.ts`.

## Decisions
- The spec says prompt version 6 to 7; the code was at 8 (T3 and T18 had bumped it), so this is 8 to 9. T3 already
  added most of the report rule; T7 adds only the "one or two sentences" and "full result is on the task" parts.
- The spec names `evals/src/composer.ts` for the eval; T3 put the report cases in `evals/src/task-report-notes.ts`, so
  the new variant sits beside them.
- The report body is validated against a manifest of the ids the body names, not `manifestFor`'s first 300 CRM
  entities: on Northwind the researcher's entity is past that cut and its valid mention was stripped.
- The Result panel is only read for tasks that are done, in review, merging, blocked, failed or stopped; a running or
  planned task has no result, so nothing is asked for.
- The report title is shown as plain text: it is never parsed as Markdown or mentions.
- The seeded report is not marked simulated (the demo's other findings are not either); the simulated notice is covered
  by the component test, the Plan test and the story.

## Not done
- No Result for a done task without a report (older tasks): the panel is left out instead of saying "none saved".
- The Inbox note does not link to the task's Result panel; it says the full result is on the task.
- Live run of `composer.task_report_found` (`pnpm evals`) was not run here: no key in this session.
