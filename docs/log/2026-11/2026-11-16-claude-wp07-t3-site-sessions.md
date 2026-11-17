---
date: 2026-11-16
branch: claude/wp07-t3-site-sessions
title: A site session starts from the newest release and ends in a release (WP-07 T3)
areas: [orchestrator, agents, db, api, events, shared]
supersedes: []
---
## The founder's change of Nov 16, 2026 (recorded here; docs/DECISIONS.md is frozen)
- "Proven" is no longer needed for WP-07 (their words on the bar of 5 published pages and 10 follows: "Yeah remove
  this need, we should just get it up", and "I want it on ASAP and theres no point building placeholders, I want it on
  and working"). Sites is switched on as soon as it is built and T10's proof passes; the coordinator wires
  foundmill.app (WP-00 S9). No placeholders: a piece not ready when the switch goes on is hidden, not stubbed.
- T6, T7, T8 and a hold on released addresses go to a second session ("WP-07 Sites: form, pay button, address hold").

## What changed
- `apps/orchestrator/src/activities/site-workspace.ts`: `isSiteProject` (Sites on, no repository, not a sample),
  `siteCheckout` (the newest preview release, else the starter, written into the workspace; the base is
  `foundmill-sites/site` at `r<number>` or `starter`), `applySiteChanges` (pure; a path conflicts when the task changed
  or removed it and the newest release differs there from the task's base), `buildSiteRelease` (the task's saved
  difference on the newest release, screened with `screenSiteFiles` on strictly UTF-8 text, saved `preview` or `held`,
  `site.release_created` and for a preview `deploy.succeeded`; idempotent on the session), `siteTaskNote`.
- `session.ts`, three places: a site task skips the repository checkout and starts from `siteCheckout` (its own
  earlier save on top); it runs no acceptance command and no design check (no sandbox is started); `finishSession`
  `done` builds the release: `done` with `landed: "site"`, or a conflict blocks the task `needs_update` naming the
  paths, so its next session starts from the newest release. The prompt carries `siteTaskNote` instead of the
  repository note. `merge.ts` offers no merge for `landed: "site"`.
- The starter (`packages/agents/src/starters`): one page and one stylesheet, the sign-up form block, system fonts;
  it passes screening.
- The note "Your site is ready to look at" (`SITE_READY_NOTE`, `repos.sites.writeReadyNote`): from the agent that made
  the first preview, and again only after a publish; "Publish it" publishes the newest version through `publishSite`
  (`decideSiteNote`), "Not yet" leaves it; the tab's Publish closes it.
- `task.completed.landed` gains `site`.

## Decisions
- **A held release still ends the task `done`**, as the package says; the Site tab names the rule and the next round
  of work fixes it. The orchestrator log records the flags.
- **A site task is a code task with the code policy** (no new SDK tool, no sandbox): WP-05's acceptance-line check
  (#253) applies to tasks that are not code, so a site task sends no per-line results.
- **The site's address** is the business's own slug made into one (`suggestPageSlug`), with a suffix when taken.

## Not done
- `session-live.test.ts` does not run a whole site session through the SDK runner; `site-workspace.test.ts` runs the
  checkout, the save against the base and the release on a real database (two dependent tasks, a conflict, a retry, a
  held release). T10's Playwright proof covers the whole path.
- The "Live product" line in Development and the first-week line for a site project (T5's deferred copy).
- T9 (the Planner's site destination and the offer-page first build) and T10.
