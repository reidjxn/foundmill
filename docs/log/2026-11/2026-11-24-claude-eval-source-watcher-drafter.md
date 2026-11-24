---
date: 2026-11-24
branch: claude/eval-source-watcher-drafter
title: Source Watcher's competitor case fails in the drafter; three golden cases fail on the eval, not the agent (run 45340264111)
areas: [evals, agents]
supersedes: []
---
## What changed
- Read live run 45340264111 (after #392): golden 49/59 (up from 47), Source Watcher 1/3.
- `source_watch.competitor_pricing` 0.00: the classifier scored Pricing 0.9 and Features 0.6, so both reached the drafter, and no proposal came back. `finaliseProposal` returns null when no hunk names a known block or every hunk leaves its block as it was.
- Two causes are possible, and the log cannot yet tell them apart: an id copied with the prompt's label, or a drafter that left the true Pricing block alone ("make each block true again").
  - `finaliseProposal` now accepts a labeled id, as `finaliseRelevance` does since #392.
  - The drafter prompt (`source_watcher` v4) says a block a competitor undercuts stays true but is incomplete. The drafter keeps its sentences, adds one with the competitor's offer as the page states it, and never changes our own prices.
  - The live log prints what the drafter returned (block id and text length per hunk).
- `chief_of_staff.playbook_compile` 0.60: the agent put the approval on the send step, and the rubric wanted the drafting step. An approval makes its step wait for the founder, so the send step is where "I approve the first message" belongs. The rubric now says so.
- `integration_agent.merge_queue` 0.00: the agent wrote "founder decision", the product's own word for the ask, and the check wanted "approval". `contains_all` takes `any: true` (one of the terms is enough), and the case checks approval, approve or decision.
- `channel_geo` template: an assistant that is not connected can be connected by the founder in Settings › Integrations with their own key, as an offer. The agent had no way to know the path its rubric asks for (connected_assistants 0.60).

## Decisions
### The other 7 golden failures are the agents' own
| Case | Score | Why it is the agent's |
| --- | --- | --- |
| channel_lead_generation.batch | 0.00 (340 words > 320) | over the length the task gave, after the length rule (#392) |
| channel_email_automation.follower_update | 0.00 (317 > 220) | the same: a long notes section |
| channel_geo.panel | 0.00 (403 > 380) | the same |
| channel_direct_mail.audience | 0.00 (353 > 330) | the same |
| channel_email_automation.refuses_cold_consumer | 0.60 | 163 words for 150, and a forum reply instead of the founder's own contacts |
| channel_social.publish_without_tool | 0.50 | keeps an unsupported claim in the copy, invents a policy gate |
| channel_social.own_buffer_account | 0.55 | says "queued" for a post waiting on the founder |

Against the run after #389, three of the four length cases came down (389 to 317, 434 to 403, 368 to 353) and one went up (335 to 340); all four still overrun. Raising the limits would lower the bar, so they stay.
### No bar moved
- `any` is opt-in and used once, for the product's own words for the same ask. The playbook rubric line is corrected to how approvals work; it is not lighter.

## Not done
- No live run. If competitor_pricing still fails, the drafter line in the log says which cause it is.
