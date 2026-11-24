---
date: 2026-11-24
branch: claude/eval-round2
title: Round 2 toward 59/59 twice - the one-reply note's tool sentence made the grader fail agents for naming their own tools
areas: [evals, agents]
supersedes: []
---
## What changed
- Read live run 45375287134 (after #395): golden 45/59 (down from 49), Source Watcher 2/3.
  - competitor_pricing now passes.
  - The length cases came in under their limits except channel_geo.panel (383 words for 380).
- The cause of the drop is #395's sentence in `ONE_REPLY_NOTE`: "name only the tools, records and steps the task gives: no platform flows, approvals or tools it does not mention".
  - The grader reads the note as part of the task. In about ten cases it failed agents for naming the tools and steps their own templates require (save_report, request_human_action, an approval or Inbox decision, the quarantined reader).
  - Affected: frontend_engineer.component, planner.task_graph, channel_email_automation.sequence, channel_seo.brief, channel_geo.panel, channel_content.calendar, channel_paid_ads.kill_switch, channel_influencer.payout_check, channel_events.sponsorship, packaging_design.dieline and quality.aql.
  - The sentence is removed. The grader's context line now says that naming the agent's own tools and steps is expected, and that only facts, figures and records the task does not give count as invented.
- Source Watcher interview_features 0.40: the classifier flagged Integrations (0.7) as well as Features. The drafter put the second bank feed there and wrote the text-message ask as a note that customers asked for it.
  - The drafter prompt (`source_watcher` v5) now says a customer ask is proposed as a capability line ("Receipt chasing by text message.").
  - The rubric line now accepts the second bank feed in Features or Integrations, because the spec covers bank feeds in both blocks (matching under Features, the aggregator under Integrations). The text-message feature must still be a Features line.

## Decisions
### A check corrected, with its reason
- interview_features rubric line 2: asking for the bank feed in Features alone was wrong for a spec whose Integrations block already holds bank feeds. Every other part of the line is unchanged.
### Not changed
- The new failures that were not about the note had passed in earlier runs: backend_engineer.endpoint (empty artifacts), follower_update (a second call to action, a promise the notes do not make), print.kit, the cost line in packaging_design.dieline, paid_ads.kill_switch. They are left for this round's run to show whether they hold.

## Not done
- No live run.
