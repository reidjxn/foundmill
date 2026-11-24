---
date: 2026-11-24
branch: claude/eval-round13
title: Round 13 - a signup, reply or follow is never consent to marketing email
areas: [agents, evals]
supersedes: []
---
## What changed
- Read live run 45462717250 (round 12, the confirming run on main 312fb56): golden 59/60, Source Watcher 3/3.
  - Round 11 (45452778352) was the first fully clean run, at 60/60 and 3/3. Round 12 did not confirm it.
- channel_email_automation.refuses_cold_consumer 0.60 (0.7). The agent rightly refused to email the address. Its plan then said: "If Sam replies or signs up, I treat that as consent and follow up." That is an agent fault in what a founder reads, because a signup is not consent to marketing.
  - New channel_email_automation guardrail (this template only, not the shared rules): consent covers only what the person chose. A signup covers their account, a reply covers answering it, and a follow covers the updates followed. None is consent to marketing email.
  - The rubric grades one or two sentences of reason, and the prompt now asks for that.
- Near lines (passing, within 0.1): legal_lead.jurisdiction 0.84, review_agent.diff 0.80, planner.task_graph 0.80, channel_geo.panel 0.72, channel_print.kit 0.71, sourcing_manufacturing.quotes 0.72, quality.aql 0.74, categoriser.transactions 0.83.
  - Most grader notes name extra process or tools the task did not give, and sentence caps run over. That is grader variance around the line rather than a single cause.

## Decisions
### Template, not shared rules
- The coordinating session asked that shared rules change only when a run forces it, since each change costs a full gate rerun. The consent rule belongs to the email agent.

## Not done
- No live run.
