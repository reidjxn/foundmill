---
date: 2026-11-24
branch: claude/eval-sweep
title: One sweep across the 60 golden cases for the reasons cases have flipped, instead of a round per flip
areas: [evals, agents]
supersedes: []
---
## What changed
- The coordinating session asked for one sweep instead of waiting for each flip (Nov 24, 2026). Every case was read against the five reasons cases flipped in rounds 1 to 8:
  - a forbidden term in a correct denial;
  - a denial the `claims` reading missed;
  - a required term a correct reply phrases differently;
  - a rubric line grading what the prompt never asks for or supplies;
  - a tight word limit.
- `packages/agents` `skills/checks.ts` (`claims`):
  - A comma inside a short list keeps a denial's clause going: "nothing was looked up, emailed or added". Only a comma followed by one or two words and "or" or "and" counts. "No problem, the lead was emailed today." is still a claim.
  - until, unless, only once, only when, rather than, instead of and avoid now count as not claiming: "tokens rather than hex values", "avoid questions like Would you pay".
  - Tests cover both, including the claims that must still fail.
- Forbidden phrases that a correct reply names while denying them now use `noClaim`:
  - "legal advice:", in "Not legal advice:";
  - "I sent" and "email sent", in "No email sent";
  - "Would you pay";
  - "paste the key";
  - "here is the link".
- `sk_live` stays strict, as credentials, hosts and tool names do.
- Required terms with the same meaning in another form (`any`):
  - "isn't connected" for "not connected";
  - "cross tenant" for "cross-tenant";
  - "lead generation" for "lead_generation";
  - "businessId", the diff's own field name, for "business_id".
- Prompts now ask for, or supply, what their rubric grades:
  - interview_plan: CRM records with a lawful basis, under 600 words;
  - dm_triage: lawful basis;
  - print.kit: what was not done, in one sentence;
  - geo.connected_assistants: each share labeled approximate;
  - qa.test_plan: a cross-tenant test;
  - email.sequence: the 0.3% spam-rate pause;
  - lead_generation.batch and direct_mail: no verification tool;
  - paid_ads.kill_switch: no ad platform tool, and the 48-hour rule;
  - plan_compile: minor units;
  - costing.landed: one shipment per volume, and £38 excludes VAT;
  - content.calendar: AI-produced audio or video is labeled;
  - smoke_test: distribution has not started;
  - broadcast: the lift plan labeled Estimate;
  - sourcing: a backup.
- `evals/src/__tests__/golden.eval.test.ts`: a live run now prints every case's score.
  - Cases within 0.1 of their threshold are listed with their rubric lines below 1, as the next flips.
  - A failed case shows 6,000 characters of output instead of 2,000.
- Rounds 6 to 8 printed scores only for failures, so near-threshold cases from those runs cannot be listed. Round 9 will list them.

## Decisions
### What was left alone
- No threshold, forbidden term or word-count bound changed.
- direct_mail's 300-word limit for eight parts stays: since #404, the one length rewrite has kept it within the limit.
- categoriser.transactions is in its own pull request (#416).
### Agent faults stay product fixes
- No case in the sweep showed an agent doing the wrong thing that a check let through. Each finding was a check or a prompt that could fail a correct reply.

## Not done
- No live run.
