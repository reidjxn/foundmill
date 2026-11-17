---
date: 2026-11-17
branch: claude/wp04-t2-commit-name-go
title: The founder's own task and tomorrow's reason (WP-04 T9)
areas: [shared, api, dugout, modules, web, e2e, docs]
supersedes: []
---
## What changed
- `founderTaskOf` (packages/shared `founder-task.ts`, pure, in the barrel and at `@foundmill/shared/founder-task`): publish the page, send it to three people, approve the plan, ask five people, in that order; null once all are done. Each task has the plan's title and reason, one action and a `tomorrow` line.
- `pageAskText` (share-drafts.ts) holds T6's ask ("I'm starting {name}. {pitch} Would you use this?"). The public page's `pageAskDraft` and the founder task both use it, and `founderAskMessage` adds the via link after a blank line, as "Copy message" does.
- `today.get` gains `founderTask` (`founderTaskFor`, in the existing RLS transaction and the same `Promise.all`). It reads the page, `share.opened` rows, the plan rounds (`productSignoffs.latest`) and `page.followed` / `lead.replied` rows. It adds no table, no event, no model call and no web round trip, and is null for a sample business and a reader without Product read.
- `FounderTaskPanel` (dugout, with story and test): "Your one thing today", the task, its reason, one primary button (44 px, full width under `page-wide`), a polite status line, and the `tomorrow` line under a hairline. When a task was done today it reads "Done for today." and "Tomorrow: {next task}" with no button.
- Today (`todaySections`): `founder-task` comes right after `needs-you` in both orders, 12 columns. The button opens Product › Public page or the plan note (its Needs you row, else the Needs you tab). It shares the message through the device's sheet (phone) or copies it, and records `share.opened` (kind `page`, target `device` or `copy`).
- Tests: shared `founder-task.test.ts`; api `today.test.ts` (the order, a simulated or hand-written follow never counts, a milestone share is not a page share, a page taken down asks again, the overnight line, the walls); dugout `FounderTaskPanel.test.tsx`; web `today-view.test.ts` (right after Needs you in every order).
- e2e `today.spec.ts`: Northwind (a sample) has no panel; a fresh project shows the publish task right after Needs you at 1440 and 390, and after the publish "Done for today." and "Tomorrow: Send your page to three people". docs/DESIGN.md's Today note describes the panel. T9 is ticked.

- `product-research.spec.ts` presses "Show all" on Team › Agents before it looks for the Product research analyst. T4 narrowed the tab to the starting team in a project's first week, and this spec failed on the branch (it passes on main and passes again with the press).

## Decisions
### A share that was opened moves the task on, and is never an outcome
`share.opened` records a press (a network's window, a copy, the device's sheet), never a send, and the north star does not count it. The share task is done once a page share was opened: that is the only fact there is, and it is the founder's own press.
Only "ask five" waits for a real answer, `isRealOutcome` on `page.followed` or `lead.replied`, so a simulated follow, a mock reply or a hand-written row never finishes it.
### "Published" is the page live now (code over spec)
The spec names `project_pages.published_at`, which is kept after a take-down. A page taken down asks to be published again, so the fact is `published` (the live copy) being set. `published_at` decides only whether it was published today.
### The plan note is a pending plan round (code over spec)
No repo reads "the open plan note" by key, and T5's note carries the spec and roadmap rounds. `planNoteOpen` is a pending round tied to an Inbox note, from `productSignoffs.latest`, already used by the first week. While the plan is drafted or revised nothing waits on the founder, so the task skips to "ask five" and comes back when the note opens.
### The overnight shift is read from the business row
Commit's overnight shift is Autopilot on, daily cadence. `today.get` reads `autopilotEnabled`, `autopilotCadence === "daily"` and no `autopilotPausedReason` from the row it already holds. It does not call `autopilotStatus` (a workflow read on the service connection, for Development readers only), so a stopped or out-of-key workflow can still read as on until it records its pause.
### One a day from today's facts
`FounderTaskFacts` gains `overnight` and `doneToday`; `FounderTask` gains `doneToday` (the spec's interface had neither, and both are needed for its words). A task is done today when the page went live, a page share was opened or a plan round was approved today, in the project's calendar. The panel then names the next task with no button.
### "Ask five" has a reason of its own
The plan gives no reason line for it: "One real answer tells your team more than a week of guessing." Its action is "Copy the message"; the share task's is "Share my page", the publish task's "Check my page", the plan's "Read my plan".
### The page line stays beside the publish task
`PublicPageNote` still shows while nothing is live and the note is not open. `public-page.spec.ts` expects it, and T9 does not name it. On day one with the note answered, the panel and the line both point at the page.

## Not done
- `inbox.spec.ts`'s plan-note test fails when `import.spec.ts` runs before it on one database: the deck's first card is then the imported one, and its "Where should the team start with what you imported?" note keeps Needs you at 2. Main fails the same way in that order; CI's shard 4 runs inbox first. Not changed here.
- `features.liveMode` is not read by T9: nothing here differs between the two modes.
- The panel never sends anything: a share opens the device's sheet or copies, and whether the founder sent it is not known (`share.opened` says so).
- The public page's own "Copy message" button (T6) records no `share.opened`, so a copy made there does not move the task on; Today's button and the page's Share panel do. Recording it is a one-line change in packages/modules, left out because T9 does not name that screen.
- WP-08's outreach tasks extend `FounderTaskId` and `founderTaskOf`; nothing of them is built.
- `scripts/ci-affected.mjs` `TEST_READS` is unchanged: no test reads files outside its package.
