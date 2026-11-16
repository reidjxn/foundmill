---
date: 2026-11-16
branch: claude/wp02-t11-cost-report
title: The founder's answers to the decisions of WP-04, WP-06 and WP-09
areas: [web, api, agents, models, orchestrator]
supersedes: []
---
## What changed
The founder answered most of the decisions listed at the end of WP-04, WP-06 and WP-09 on Nov 16, 2026, in the
execution session. They are recorded here because docs/DECISIONS.md is frozen. The work packages build to these answers.

## Decisions
WP-04, the first session:
- D1 What commit starts: **yes**. For a profile with no budget, commit starts no cycle and no finance or legal task.
  It drafts the page and the plan. The first round starts on the plan's approval, on Continue or with the first
  overnight shift.
- D2 The starting team: **shown**. Everyone is hired as today; three are shown until work brings in more.
- D3 **One plan note** replaces the two sign-off notes.
- D4 The spend line **starts at $0** for a profile with no budget, so every spend asks first.
- D5 The streak is **hidden on a project's first day** and appears from the second. The founder added: **make the
  streak less prominent on the page in general** (T7 carries this).
- D6 Replies to the day-3 and win-back letters go to **hey@foundmill.com**. Who signs them was not named; until it is,
  T16's letters are drafted for the founder to send by hand.

WP-06, skills:
- D1 The measuring run (T8, about $170 to $250 at list price, about half on the batch route, Estimates): **later, on the
  batch route**. T8 is built behind its switch; the run waits for the founder to confirm the key.
- D2 and D3 **Yes, both**. Measured ratings or "Not tested yet" replace the constant 10 and 12 on the real projects.
  Existing agents receive default skills after T6, marked "Came with the role" and removable.
- D4 Customer replies go to the **Chief of Staff for now**; no `customer_support` template yet.
- D5 **Keep the rule**: a change goes live only after a run, with T10's cheaper check. The founder added: an agent's
  attributes must always match what its training run observed. When its skills, connectors or other setup are edited,
  its attributes must follow, never keeping a rating the agent's current setup was not measured with.
- D6 (the Nov 15 planner's calls 1 to 3) was not answered. T2, T3, T4 and T6 wait for it.

WP-09, models and money:
- D1 **Keep $5.00 a month**; first session at most 30% of it, first week at most 70%; decide again from T14's entry.
- D2 Model moves route by route: **not yet answered**. The founder asked how a failing eval is kept from blocking a
  release or a system. The answer given in the session is that a move is a one-line routing change that ships only
  with a passing eval. A route whose eval fails stays on its current model. The live evals run on a schedule and never
  gate a pull request. The server fallback (T5) and a revert are the way back.
- D3 Ceilings before commit: **$2.00 a day and $5.00 in 30 days per account** (Estimates).
- D4 and D5 **Yes**. Top-ups of $5, $10, $25 and $50; the free plan's note names the top-up first wherever one can be
  bought. Before Stripe is live, offer nothing new, say so honestly, and do setup S8 first.
- D6 The free plan's first round: **one session at a time under a 75-cent cap** (Estimate) until the report sets it.
- D7 Overnight: **option B**, keep $0.15 and run every third night. This was not the recommended option C.
- D10 Live evals in this package may spend **$40 in total** (Estimate).
- D8 (Pro price), D9 (a fourth model key) and D11 (training checks default to the batch route on the free plan) were
  not answered. T15 and T16 wait for them; T9 and T10 keep today's default until D11 is answered.
