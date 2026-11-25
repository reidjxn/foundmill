---
date: 2026-11-25
branch: claude/build-choice-report
title: The build choice's information notes are reports, so the welcome note stays; the page comes first
areas: [db, api, agents, evals, e2e]
supersedes: []
---
## What changed
- The Chief of Staff's "Your idea needs no app built" note, written with the plan for an idea with no software to build, is now a `report`, not an `update`. This covers `repos.foundations.apply` and `dev.seedBuildChoice`.
- The note after "Build it with Lovable" (the link, or why Lovable was not used) is now a `report` too (`apps/api/src/services/build-choice.ts`).
- Regression tests:
  - `inbox-first-week.test.ts`: a Chief of Staff report leaves the agent's current update open.
  - `apps/api build-choice.test.ts`: the outcome note is a report, and the note-writer's earlier update stays unread.
- Comments in the golden-path, foundations and Inbox specs now say report.
- The golden path's ideas are pinned through "Use my idea as written" (coordinator, Nov 25, 2026). The business that goes through the plan commits a software idea (a homework tracker), so its build note is always a decision. `commitFreshBusiness` commits a no-software idea (handmade candles).
  - The software business checks that the decision and the welcome note (or the note of the day) are both in the Inbox, then that Needs you counts 3, and 2 after the plan is approved.
  - The no-software business checks that the report and the welcome note are both there.
- The no-software note says what is built first (founder, Nov 25, 2026: "needs no app built" must never read as "nothing gets built").
  - It now opens: "The team builds your project's page at its free Foundmill address, with your price and a button to pay or book; it goes live when you publish it."
  - Then it says there is no separate app to build beyond that page, and why, in the founder's own words.
  - Its subject is now "No separate app needed: your page covers it".
- The rubric never recommends Lovable for what the project's page covers:
  - The `page` rule now also covers price lists, booking, appointments and taking payments.
  - "booking app" left Lovable's marketplace rule.
  - When the page covers the idea, only Lovable signals for an app of its own (web app, accounts, dashboard, records) can outweigh it.
  - New golden cases: "A landing page for my candle shop" and "An app where my yoga students book classes and pay online" both come out as ours.

## Decisions
### A report, not an update
`inbox.createItem` keeps one current update per agent (`supersedeUpdates`, Nov 7, 2026). The build choice's update therefore archived the Chief of Staff's welcome note on day one, and main went red at `golden-path.spec.ts:240` (#436). Whether it failed depended on the sample idea.
A Chief of Staff report is delivered as it is (`noteVerdict`), supersedes nothing and needs no answer. So the welcome note and the note of the day stay, and the Needs you counts do not change.

### "Goes live when you publish it"
The founder's wording was that the page "is live". On day one the page is drafted, and it goes live when the founder publishes it from "Your project's page is ready". So the note says it goes live then, rather than claiming it already is.

## Not done
- Nothing else changes during the launch freeze.
