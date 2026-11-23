---
date: 2026-11-23
branch: claude/eval-golden-causes
title: The 19 golden failures of live run 45221162185, grouped by cause, and the fixes that do not lower a bar
areas: [evals, agents]
supersedes: []
---
## What changed
- Read live run 45221162185 (after #373): golden 40/59, Source Watcher 1/3. With #373 the log names each failed check, so every failure has a cause below.
- `evals/src/harness.ts`: the one-reply note says the task's length counts the whole reply, citations and notes included, and asks for ids inline. The grader is told the agent works for Ledgerly and that its system prompt holds the house rules and its role's instructions.
- `evals/src/golden/tasks.ts`: prompt facts the rubric needs (the 0-based approval step and that a playbook starts switched off; Development › Plan; the merge prompt asks whether it merges or asks for the founder's approval).
- `evals/src/golden/tasks.ts`, checks and rubric: `legal_lead.jurisdiction` checks "Swed" (Sweden or Swedish); `demo_script`'s "coming soon" check uses `claims`. The planner rubric no longer asks to flag the email step for approval, which #386 removed.
- `packages/agents` Source Watcher prompts: the classifier counts a block a competitor undercuts or outdoes as incomplete (`source_relevance` v4); the drafter adds what is new as its own sentence instead of rewriting one that is still true (`source_watcher` v3).

## Decisions
### The 19 golden failures by cause (before = run 45221162185)
| Case | Before | Cause | Fix here |
| --- | --- | --- | --- |
| channel_lead_generation.batch | 0.00 (354 words > 320) | length | note: the limit counts citations |
| channel_email_automation.follower_update | 0.00 (388 > 220) | length (sources and notes lists) | note |
| channel_email_automation.refuses_cold_consumer | 0.00 (174 > 170) | length | note |
| channel_geo.panel | 0.00 (430 > 380) | length | note |
| channel_lead_generation.own_apollo_account | 0.00 (262 > 250) | length | note |
| channel_geo.connected_assistants | 0.00 (287 > 280) | length | note |
| channel_direct_mail.audience | 0.00 (374 > 330) | length | note |
| channel_pr.pitch | 0.00 (342 > 260) | length | note |
| product_researcher.demo_script | 0.00 (832 > 700, "coming soon") | length; check read a denial as a claim | note; `claims` |
| legal_lead.jurisdiction | 0.00 (no "Sweden") | check: the answer said "Swedish" | "Swed" |
| integration_agent.merge_queue | 0.00 (no "approval") | prompt never asked about approval | prompt asks |
| channel_events.sponsorship | 0.00 (no "recommended") | agent: a conditional hybrid, not one option | none (agent) |
| chief_of_staff.playbook_compile | 0.62 | grader did not know Ledgerly; prompt gave no step indexing or default state | grader context; prompt facts |
| chief_of_staff.idle_cycle | 0.60 | prompt never named Development › Plan | prompt fact |
| categoriser.transactions | 0.80 < 0.8 | grader read the house rules as invented | grader context |
| planner.task_graph | 0.74 | rubric asked for an approval #386 removed | rubric follows #386 |
| product_lead.change_proposal | 0.74 | agent: invented numbers | none (agent) |
| product_researcher.smoke_test | 0.68 | agent: unlabeled figures, no founder named | none (agent) |
| channel_affiliate.fraud | 0.68 | agent: no terms cited, no prevention rule | none (agent) |

Source Watcher: `competitor_pricing` 0.00 (the classifier did not flag Pricing) and `interview_features` 0.55 (the drafter rewrote a true sentence and put the bank feed under Integrations). Both get a prompt line; the placement under Integrations is defensible and is left to the agent.
### No bar moved
- Thresholds are unchanged. The check terms keep their meaning: "Swed" still requires the Swedish option, and `claims` still fails a real claim. The planner rubric line follows the founder's rule (#386), not a lower bar.
### Length is the agents', not the harness's
- Nine cases fail on word count. House rule 3 has every claim cite a source id, and agents answer with a separate sources list and notes the limit does not leave room for. The note says the limit counts everything and asks for inline ids; if they still overrun, it is the agents' and the next step is a template rule, not a wider limit.
### What a live run should show (estimate)
- The nine length cases: some pass, the rest still fail on length. legal_lead, merge_queue, idle_cycle, playbook_compile, categoriser and planner should pass. The four agent-quality cases and events.sponsorship may stay below the bar. Source Watcher: competitor_pricing should flag Pricing; interview_features may pass.

## Not done
- No live run (no key here). Template changes for length and the four agent-quality cases.
