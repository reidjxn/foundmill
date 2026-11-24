---
date: 2026-11-24
branch: claude/eval-agent-rules
title: The golden failures left after #389 (run 45277670182) - a length rule for workers, two template rules, a check term, and Source Watcher ids
areas: [evals, agents]
supersedes: []
---
## What changed
- Read live run 45277670182 (after #389): golden 47/59 (up from 40/59 in run 45221162185), Source Watcher 1/3.
- `packages/agents` `_shared.ts`: `LENGTH_RULE` joins `WORKER_COMMON_RULES`, which channels inherit. When a task gives a length, the whole reply fits it, sources and notes included, with ids inline.
- `CODING_COMMON_RULES`: the 390 px rule applies "unless the task sets other widths". design_to_code planned a 390 px reflow the task had ruled out.
- Categorizer: the recorded rule is the reusable pattern, not the memo restated, and every transfer and financing row is flagged non-operating.
- `evals/src/golden/tasks.ts`: `channel_outdoor.quote` and `channel_events.sponsorship` check "recommend", so a Recommendation heading counts.
- Source Watcher: `finaliseRelevance` accepts a block id copied with its label (the prompt lists candidates as "<id> (Section, pinned)"). The live log now prints the classifier's block scores for a failing case.

## Decisions
### Before and after
| Case | 45221162185 | 45277670182 | Cause now | Fix here |
| --- | --- | --- | --- | --- |
| product_researcher.demo_script | 0.00 | 0.00 (808 words > 700) | length | LENGTH_RULE |
| channel_lead_generation.batch | 0.00 | 0.00 (335 > 320) | length | LENGTH_RULE |
| channel_email_automation.follower_update | 0.00 | 0.00 (389 > 220) | length | LENGTH_RULE |
| channel_geo.panel | 0.00 | 0.00 (434 > 380) | length | LENGTH_RULE |
| channel_social.own_buffer_account | pass | 0.00 (260 > 250) | length | LENGTH_RULE |
| channel_direct_mail.audience | 0.00 | 0.00 (368 > 330) | length | LENGTH_RULE |
| channel_outdoor.quote | pass | 0.00 (no "recommended") | check term | "recommend" |
| channel_events.sponsorship | 0.00 | 0.00 (no "recommended") | check term | "recommend" |
| design_to_code.fidelity | pass | 0.69 | template rule against the task | 390 px rule scoped |
| categoriser.transactions | 0.80 | 0.60 | agent: rules restate the memo | template rule |
| legal_lead.jurisdiction | 0.00 | 0.68 | agent: no figures given | none (agent) |
| channel_social.publish_without_tool | pass | 0.50 | agent: invented copy, no alt text | none (agent) |

Cases that passed after #389: refuses_cold_consumer, own_apollo_account, connected_assistants, pr.pitch, merge_queue, playbook_compile, idle_cycle, planner, change_proposal, smoke_test, affiliate.fraud. Cases that newly failed (own_buffer_account, outdoor.quote, design_to_code, publish_without_tool) passed before: run-to-run variation on cases near the bar.
### The agents' own quality
- legal_lead.jurisdiction: it labels everything unverified and gives no cost or time figures, where the rubric asks for plausible estimates. The house rule against invented facts pulls the other way; an Estimate-labeled figure is allowed, so this is the agent's choice.
- channel_social.publish_without_tool: the draft carries an invented claim ("no login needed") and a second corrected version.
- Source Watcher interview_features (0.72): the drafter put the second bank feed under Integrations, not Features. That is defensible, since a bank feed is an integration. The rubric is not changed.
- Source Watcher competitor_pricing (0.00): Pricing is still not flagged after the v4 line. The log now shows the classifier's scores, so the next run says whether it scored Pricing low or wrote an id the code dropped.
### No bar moved
- Thresholds and rubrics are unchanged. "recommend" still requires a recommendation; the length limits are unchanged, and the agents are now told to keep to them.

## Not done
- No live run. A length rule in the lead templates (no lead case fails on length now).
