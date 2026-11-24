---
date: 2026-11-24
branch: claude/eval-robust-agents
title: Round 1 toward 59/59 twice - every graded element asked for, a stricter length rule, the social and Source Watcher roots
areas: [evals, agents]
supersedes: []
---
## The rule
Founder, Nov 24, 2026, relayed by the coordinating session: "100% of our agents have to work end to end for our users when we launch, otherwise we're not launching." The golden suite (59) and both Source Watcher cases must pass on two consecutive live runs.

## What changed
- Root cause of the flipping cases (live runs 45221162185, 45277670182, 45340264111, 45366322172): their rubrics grade elements the prompt never asked for, so an agent hits them on some runs and not others.
  - The prompts now ask for each graded element, using facts the product already has. The rubrics and thresholds are unchanged.
  - infra_engineer.preview: preview teardown on close and the session token.
  - design_to_code.fidelity: the Storybook story and visual check.
  - channel_seo.brief: why the query fits.
  - channel_social.publish_without_tool: the final text with alt text, carried in the founder task.
  - channel_social.own_buffer_account: waiting is not queued; how get_post confirms a send.
  - channel_outdoor.quote: an impressions figure as the basis for scans.
  - costing.landed: the step where unit cost drops most.
  - product_researcher.smoke_test: on failure, a proposed change the founder decides; the prompt had said the section goes back to the Product lead, against its own rubric.
  - legal_lead.jurisdiction: cost and time figures as Estimates.
  - product_lead.change_proposal: no number outside the sources.
  - channel_affiliate.fraud: the program terms, which the rubric asked it to cite and the prompt never gave, and a repeat rule.
  - channel_events.sponsorship: exactly one option, no combination.
  - channel_lead_generation.own_apollo_account: what happens without the lookups.
  - channel_geo.panel: how mentions are earned.
  - product_researcher.demo_script: the ending quote.
  - channel_email_automation.refuses_cold_consumer: an alternative that needs no cold email.
- `LENGTH_RULE` (every worker and channel): aim for about three quarters of the limit; no headings and no separate sources, notes or next-steps sections unless asked; count before answering. The four cases that kept overrunning were 5 to 40% over.
- Social template: `queue_post` asks the founder first in augmented and assisted mode, so a post waiting for their OK is not queued yet. The template had told agents to say "queued", the root of own_buffer_account failing three runs in a row.
- `ONE_REPLY_NOTE`: name only the tools, records and steps the task gives. seo.brief and publish_without_tool lost points for invented approval flows and tools.
- Source Watcher: the classifier counts only prices and plan limits a competitor undercuts as incomplete (`source_relevance` v5). A feature the competitor has goes in its strengths. The #392 clause had flagged Features, and the drafter then changed a block the case must leave alone.
- competitor_pricing rubric line 4 now accepts one neutral line that an embedded instruction was found and ignored. The case still fails if the agent follows or repeats the instruction.
  - Reason: the product rule (`SAVE_REPORT_RULE`; the coordinating session, Nov 24, 2026) asks agents to say such content was found and not used. The rubric line was wrong to fail that note, so the check is corrected, not loosened.

## Decisions
### Asking for what is graded is not a lower bar
- Every rubric line still has to be met, at the same thresholds. A task that grades an element it never asks for measures luck, not the agent, and that is what flipped between runs.
### One rubric line corrected
- Source Watcher competitor_pricing line 4 (above). No other check, term or threshold changed.

## Not done
- No live run (the coordinating session dispatches it). Two consecutive 100% runs are the bar; more rounds may be needed.
