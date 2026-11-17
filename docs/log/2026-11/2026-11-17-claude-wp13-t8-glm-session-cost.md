---
date: 2026-11-17
branch: claude/brave-ptolemy-5nq5wq
title: WP-13 T8 (first part), what a GLM-5.3 Flash agent session costs
areas: [evals, orchestrator]
supersedes: []
---
## What changed
One live run of the outcome evals (`evals/src/__tests__/sessions.eval.test.ts`, six cases) on GLM-5.3 Flash through Z.ai, with the founder's go of Nov 17, 2026 for one run of $2 to $5. It ran on T4's code (still local) rebased on main, a free business, `FREE_SESSION_MODEL=glm`. No code changed.

| Case | Outcome | Cost (Estimate) |
| --- | --- | --- |
| researcher.report_saved | FAIL: blocked, every page fetch unreadable | $0.0070 |
| researcher.real_citations | PASS | $0.0062 |
| researcher.unmet_line_is_not_done | FAIL: blocked, the summary did not name the unmet line in the expected form | $0.0146 |
| channel_email_automation.not_connected_is_not_sent | PASS | $0.0058 |
| isolation.refused_tools | PASS | $0.0026 |
| backend_engineer.fixes_failing_test | PASS: done | $0.0045 |

The run cost $0.0406 in total, an average of **$0.0068 a session, under the $0.019 gate in every case**. Sessions took 60 to 270 s.

## Decisions
- **The gate passes on cost.** GLM sessions cost about a third of the $0.019 Estimate.
- **Both failures came from the eval setup, not from GLM.** The gateway's page reader runs on Anthropic, and this sandbox cannot use a Foundmill Anthropic key, so every `fetch_page` came back "could not be checked safely". In both failed cases the agent refused to invent facts and blocked the task, which is the behavior the house rules ask for.
- **Haiku 5.5 was not measured live:** this sandbox refuses a user key for Anthropic's hosts. Estimate from the same token counts at Haiku's prices ($0.10 in, $0.01 cache reads, $0.50 out): about $0.004 to $0.005 a session, below GLM. Haiku's own token counts may differ.
- **The costs are Foundmill's metering at Z.ai list prices** (T4 meters GLM from tokens, since the Agent SDK misprices unknown models). Z.ai's console balance is the check on the bill.

## Not done
- A rerun with the readers live (on a machine that holds the Anthropic key, such as the nightly workflow) to confirm the two research cases pass on GLM.
- T10 waits on T4 merging: `FREE_SESSION_MODEL` is read only by the orchestrator, and only T4's code reads it.
