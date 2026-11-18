---
date: 2026-11-17
branch: claude/wp14-t4-outcomes-today
title: WP-14 T4, Today leads with the week's real outcomes and shows no cost figure
areas: [web, api, shared, dugout, widgets, docs]
supersedes: ["Today's Health shows the week's spend, never added across currencies (2026-11-07)", "Since you were last here ends with team spend marked Estimate (2026-11-11)"]
---
## What changed
- **The headline.** `today.get` answers `outcomes` (`packages/shared/src/week-outcomes.ts`): the last 7 days' real outcomes as one count with what they were, "This week: 3 real outcomes" over "1 payment, your page went live, 1 email sent". Today draws it with the new `WeekOutcomes` (packages/dugout), above every section in both reading orders.
- **What counts** is the north star's rule and nothing else: `realOutcomes` over `REAL_OUTCOME_EVENT_TYPES` (the page published by a person, an email the vendor accepted, a confirmed follower, a reply, a payment from a webhook). A mock's result and the Simulate panel's never count. A sample business counts nothing: its seeded history is an example.
- **Walls.** Each kind is counted only for a reader of its section (`OUTCOME_SECTION`): a person walled from Finance does not have payments in their count.
- **A week with none** has no count line and no zero. It says what the team is working toward, first known wins: the active goal (as this reader may see it, `goalAsSeenBy`), else "your public page, live" while no page is live, else the work in hand or next. When none is known, nothing is drawn.
- **No cost figure on Today.** The week's spend tiles left Health (it is Cash, Runway, Customers this week), and "Team spend … (Estimate)" left Since you were last here. Details, Finance and Billing are unchanged.
- **The reads went with them.** `today.get`, `today.visit` and `today.sinceLastVisit` no longer answer `spend`, and `spendWeekTiles`, `SPEND_WORDS` and `WeekSpend` are deleted from packages/widgets (Today was their only user).
- **Tests:** shared `week-outcomes.test.ts`; api `today.test.ts` (the count, simulated and older events left out, the Finance wall, no cost key in the answer, the toward line); dugout `WeekOutcomes.test.tsx` and its story; web `since-last-visit.test.ts`.
- **Playwright:** `e2e/today.spec.ts` reads no count line on a new project, then "This week: 1 real outcome" once the founder publishes the page, and three Health tiles with no spend text on the sample business.
- docs/DESIGN.md §9 "Today" and docs/ARCHITECTURE.md's Today paragraph say the same.

## Decisions
### "real outcomes", not the brief's "approved outcomes"
The brief proposes "This week: 23 approved outcomes". The count is the north star's real outcomes, and three of the five kinds (a follower, a reply, a payment) are things other people did: a founder does not approve them. "Approved" would be untrue of those, so the line says "real outcomes" (WP-14's rule: fix a line that is untrue of the product and say so).

If the founder wants the count to be only what they approved (the page, and email they approved), that is a narrower count and a one-line change in `week-outcomes.ts`. T3 (Billing) should use the same word and the same count.

### "This week" is the last 7 days
Today's other week lines ("This week the team finished…", Customers this week) already mean the last 7 days. The headline uses the same window so the page agrees with itself.

### The headline is above the reading order, not part of it
WP-04 T7 orders Today's sections around one thing to do first. The headline is one or two lines and is drawn before that order on a phone and a computer alike, so `todaySections` and its tests are unchanged and Needs you still leads the sections.

### Spend is removed from Today's reads, not only hidden
"No cost figure on Today" could have been met by not drawing the tiles. The reads were removed too: two queries a visit for a number nobody reads is waste, and a field that is still answered tends to come back onto the screen.

### A sample business shows no count
Its seed writes payments shaped like real ones. Counting them would show an example's history as outcomes, so `weekOutcomesFor` answers none for `isDemo`, as the nightly north-star numbers leave sample businesses out.

## Not done
- Cost per outcome and the team budget line: WP-14 T3, on Billing, not this task.
- The "Working now" strip and effort counts: WP-14 T5, stacked on this branch.
- The headline is not in the morning email or the day's digest; the brief asks for it on Today only.
