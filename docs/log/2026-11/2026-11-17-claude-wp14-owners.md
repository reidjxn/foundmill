---
date: 2026-11-17
branch: claude/trusting-goldberg-28k3rx
title: WP-14, the six amending tasks are given to the sessions that hold what they amend
areas: [docs]
---
## What changed
docs/holistic-plan/STATUS.md names an owner for the six WP-14 tasks that amend other packages' tasks and had no builder:
T1, T3, T7, T12, T14 and T15. The coordinating session told each owner by message on Nov 17, 2026. No code changed.

## Decisions
- T1 (Resting), T14 (plans, prices, companies) and T3 (team budget on Billing) go to the WP-09 session. T1 amends its T13
  and T14 amends its T14 and T16; T3 edits the same Billing tab as T14, so one session avoids a conflict. Order: #251,
  then T1 as the next pull request (the session judged #251 too large to carry it: six tasks and three migrations already),
  then T14, then T3. Until T1 merges, main keeps the existing line for a session that stops when credits run out.
- T7 (one style for estimates) goes to the WP-10 session, which built T9 and T12 (#265).
- T12 (four measures) goes to a new session, "WP-14 T12: four measures": the session that built WP-02 T10 (#173) is gone,
  and the WP-04 lifecycle email session, asked first, takes new work only from its own owner. It builds the two measures
  that need nothing else now.
- T15 (waitlist in batches, three named invitations) goes to the landing idea-card session, which built the waitlist card.
  The network session is told and its #208 and #217 merge first; T15 does not edit their files before that.
- The WP-13 session is told that the own key is always offered and that T7's server check follows WP-14 T14.

## Not done
- T12's two later measures (projects that reach Resting, shares of a Customer Update) wait for T1 and T9.
- No task is started by this change; each owner sends a slot request before its one push.
