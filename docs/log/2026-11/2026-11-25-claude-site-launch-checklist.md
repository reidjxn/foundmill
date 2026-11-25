---
date: 2026-11-25
branch: claude/site-launch-checklist
title: The "Before it goes live" list on the site's ready note, shown and never a blocker
areas: [shared, db, orchestrator, web]
supersedes: []
---
## What changed
The "Your site is ready to look at" note in Needs you now shows the same "Before it goes live" list as the public page's first publish dialog (PR #429), for a site that has never been published.
The orchestrator reads it from the release's own HTML when it writes the note (`siteLaunchChecklist`, packages/shared `launch-checklist.ts`) and stores it on the note's decision block as `launch_checklist` (new optional field of `ComposerDecision`).
The reading pane renders it through `SiteLaunchList` (apps/web components/inbox) with the Dugout `LaunchChecklist` from #429, with no action. The note's options, their order and `blocks_continue: false` are unchanged.
Tests: packages/shared `launch-checklist.test.ts` (site items, the stored form); apps/orchestrator `site-workspace.test.ts` (the starter's first preview carries the list, the options stay as they were); apps/web `site-launch-list.test.tsx` (every item Not yet, no control of its own; nothing for other notes).

## Decisions
### The founder's answer (Nov 25, 2026)
Asked whether the site-ready note should get the same checklist as the publish dialog, the founder answered: "Yes, but it should never be a blocker, it should just show the user."

### Only what a static site's HTML shows
Phone: the home page's viewport line. A way to act: a sign-up form (`/_fm/follow`) or a pay button (`/_fm/pay/`) on any page. Ready to share: an `og:image` on the home page. Search: a title and a description on the home page. Clear about email, only with a sign-up form: the platform's own consent page (apps/sites `followFormPage`) shows the sentence and an unticked box.
Left out: booking and payment needs (the release cannot tell whether customers pick a time or the project sells), terms and the design check (its result is not tied to a release).

### Computed once, when the note is written
The note is one round of looking at one version, so the list is the version that note points at. Writing it into the note keeps the reading pane free of a new query. Only before the first launch: no release has `publishedAt`.

### Show only
The site list has no action buttons: the team makes changes through a task, and a button there would read as a step before publishing.

## Not done
Playwright: Sites are off in the e2e stack (no SITES_DOMAIN), so no spec can reach the note; the component test covers it.
