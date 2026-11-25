---
date: 2026-11-25
branch: claude/launch-checklist
title: A "Before it goes live" checklist in the first publish dialog, which never blocks
areas: [shared, dugout, modules, web]
supersedes: []
---
## What changed
The dialog where the founder approves the public page going live (Product › Public page, "Publish your public page?") now shows a short "Before it goes live" list, only for the first launch: never live and never taken down (`isFirstLaunch`).
Each item is "Ready" or "Not yet" with one plain sentence, computed from the page's own content by `launchChecklist` (packages/shared `launch-checklist.ts`).
The items: works on a phone, a way for visitors to act (the Follow form), ready to share (name, pitch and the generated preview image), found by search engines (`pageIsListed`), and, only when the Follow form collects email, clear about email (the consent sentence with unsubscribe).
The one action is "Turn on the Follow form", which changes the draft in place; publishing then sends that draft.
New Dugout component `LaunchChecklist` (firstrun group) with a story and a test. The approve button is unchanged: no item disables, delays or adds a step to it.
Tests: packages/shared `launch-checklist.test.ts`; dugout `LaunchChecklist.test.tsx`; modules `public-page-launch-checklist.test.tsx` (with every item forced to "Not yet", Publish is enabled and publishes in one press; not shown after the page has been public); the Playwright golden path `e2e/public-page.spec.ts` checks the list and an enabled Publish.

## Decisions
### The founder's rule (Nov 25, 2026)
Before a project's first public launch, show a checklist once, in the note where the founder approves the page going live. It lists what is ready and what is not. It never blocks: "It should definitely not block. Nothing can ever block! No blocking!!!" The founder can approve going live with every item unready, in one press, exactly as today.

### Which note
The public page's publish dialog, because every project's first public launch is its page at `/p/<slug>`. The site's "Your site is ready to look at" note in Needs you (`SITE_READY_NOTE`) is only on where SITES_DOMAIN is set and comes after the page; it carries no checklist yet.

### Only what the code can tell truthfully
Left out: booking (it needs a published page to go live, so it can never read ready here, and the screen cannot tell whether customers pick a time), taking payment (the public page has no price or payment link), terms and privacy beyond the Follow form's own consent line (no project terms exist to check), and the design check (it reviews the team's site code, not the public page).
"Works on a phone" is always ready because the page is one component built and tested from 390 px.

### Words
No item is about people. "Not yet" lines say what the Follow form or a longer About would do, never that the project is behind. The closing line says publishing works either way.

## Not done
The same list on the site-ready note in Needs you, and booking and payment items once the page can carry them.
