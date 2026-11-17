---
date: 2026-11-17
branch: claude/wp14-t3-team-budget
title: Billing leads with the team budget in outcomes, an Estimate, with the dollar balance beneath (WP-14 T3)
areas: [shared, api, web, docs]
supersedes: []
---
## What changed
WP-14 T3. Stacked on WP-14 T1 (`claude/wp14-t1-resting`) and T14 (#300); all three change `BillingTab.tsx`.

- `packages/shared/src/team-budget.ts`: `teamBudgetEstimate({ balanceMinor, spentMinor, outcomes })` gives the cost of
  an outcome so far this month and how many more the balance is enough for, or null with no outcome or nothing spent.
- `billing.plan.teamBudget`: this month's real outcomes (`realOutcomes`, the north star's rule, the same one Today's
  headline uses) against `credits.spentMinor`, labeled Estimate. Null for a sample business and for a business on its
  own key.
- Settings › Billing opens with "This month's team budget: enough for about N more outcomes at your current pace",
  marked as an Estimate, the dollar balance beneath in smaller type, then the cost of an outcome as an Estimate.
  With no pace to read it shows "This month's team budget" and the dollar balance alone: no N.
- `terms.ts` has `team_budget`. Credits stay US dollars in the ledger; nothing in the ledger changed.

Tests: `packages/shared/src/team-budget.test.ts`, `apps/api/src/__tests__/billing-team-budget.test.ts`,
`apps/web` `settings-logic.test.ts` and `e2e/billing.spec.ts`.

## Decisions
### It does not need #251
The task says T3 waits for #251 (WP-09 T1 and T2). The figure needs only the month's credits spent and the outcome
events, both on main, so nothing here reads #251's new columns and this branch is not stacked on it. It still waits
behind #251 in merge order, because it is stacked on T14.

### "Outcomes", by the north star's rule, not "approved outcomes"
The brief says "approved outcomes". Today's headline (WP-14 T4, #291) counts real outcomes: the page live, an email
sent, a follower, a reply, a payment. Billing uses the same count and says "outcomes", with one line that says what an
outcome is, so the two screens cannot disagree.

### The cost is what the budget paid, not every metered cost
Cost per outcome is the month's credits spent divided by the month's outcomes. A business on its own key gets no
figure: its agents' work is not paid from the budget, so the division would flatter it.

### "N more"
The line counts outcomes still to come from what is left, so it says "about N more outcomes". Under one it says
"less than one more outcome at your current pace".

### The Playwright spec covers the line and the no-N case; the N case is an API and a unit test
The e2e stack's projects are samples or have spent nothing real, so no project there has a pace to read. The count
with real outcome records is asserted in `billing-team-budget.test.ts`, and the sentence in `settings-logic.test.ts`.

### Rebase onto main, Nov 19, 2026
Session 3 of the launch plan rebased this onto T1. Credits are charged at cost plus the 30% markup (Nov 17, 2026), so the
budget line is in credits: "spent" is what the budget paid, markup included, and the cost per outcome and the "enough
for about N" figure follow it (the api test books 120 cents of cost and reads 156 spent, 39 an outcome, 8 more).
`billing.plan` is one read longer (the month's outcomes), so its round-trip ceiling in `round-trips.test.ts` is 5.

## Not done
- Cost per outcome by kind of outcome, or by department: not asked for.
- Nothing shows on Today (the brief: never there).
