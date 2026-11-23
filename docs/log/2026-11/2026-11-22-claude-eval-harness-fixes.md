---
date: 2026-11-22
branch: claude/eval-harness-fixes
title: The eval harness measures the agents, not the harness (golden tasks and Source Watcher)
areas: [evals, agents]
supersedes: []
---
## What changed
- Read the live run 45028669051 (`evals-models-live.yml`): golden 41/59, Source Watcher 1/3. Every golden 0.00 was a failed deterministic check, which caps the score at 0 (BUILD §12.5); none was a parse error (a schema failure would have printed an `invalid_output` error, and none did). The log printed the output but never which check failed.
- `evals/src/__tests__/golden.eval.test.ts` now prints each failed check with its detail and each low grader line, and 2,000 characters of output instead of 800, so the next live run says why each case failed.
- `evals/src/harness.ts`: `ONE_REPLY_NOTE` follows every golden task (`goldenTaskPrompt`), for the agent and the grader alike. Golden tasks are one completion with no tool loop; the agents' instructions (read the code, cite the record, draft with the tool) made them spend the answer asking for tools and ids, and run over the word limits. The grader-agreement eval grades with the same prompt.
- `packages/agents/src/skills/checks.ts`: `contains_all` and `contains_none` take `in` (read only the JSON values under that key, at any depth), and `contains_none` takes `claims: true` (a term counts only where it is not negated just before it: "nothing is published" is not a claim). Both are opt-in, and without parsed JSON `in` reads the whole output, so no existing check reads less.
- `evals/src/golden/tasks.ts`: `chief_of_staff.cycle_plan` checks that tsk_4 is not in `tasks_to_start` (the prompt asks for it in `deferred`, so the old check failed a correct plan).
- `playbook_compile` lists the platform's event types (the check wants `lead.replied`, which the prompt never named; production validates the trigger against `EVENT_TYPES`).
- `docs_writer.howto` gets the verified facts and their record ids (its rules forbid documenting behavior it has not verified, and the task gave none).
- `demo_script`, `lead_generation.batch` and `geo.panel` get the record ids or positioning notes they asked for.
- `merge_queue` and both `channel_social` cases use `claims: true` for their "did not happen" phrases.
- Source Watcher: the grader now reads the source with its title and notes (`sourceForGrader`); it had read the text alone and called "Aalto Accounting", from the source's title, invented. The classifier is told `pricing` is at most 30 words (prompt `source_relevance` v3), and the stored pricing is cut at a word boundary with an ellipsis instead of mid-word ("two months o").

## Decisions
### No bar moved
- Thresholds, rubrics and the terms each check looks for are unchanged. The two check options only stop a check from failing a correct answer (a deferred task the prompt asked for; a denial of the forbidden claim); a claim of the forbidden phrase still fails.
### The note instead of mock tools
- Golden tasks grade one completion by design (the tasks.ts header); tool sessions are the outcome cases in `evals/src/sessions`, which already run with mock connectors. Giving the golden runner a tool loop would duplicate that harness, so the golden tasks carry the facts and tool results they need in the prompt, and the note says so.
### What a live re-run should show
- Most of the 14 golden 0.00 cases should get a real grader score; any still at 0 now names the check. Cases near the bar (idle_cycle 0.67, planner 0.74, costing 0.67, categoriser 0.72, publish_without_tool 0.68) were real grader scores and may stay below.
- Source Watcher's competitor_pricing failed because the classifier scored the pinned Pricing block under 0.7; that is the agent's judgment and this change does not touch it.

## Not done
- No live run (no key here; the coordinating session dispatches it). The causes of the 0.00 text cases (word count or a missing term) are inferred from the 800-character excerpts; the new log lines will confirm them.
