---
date: 2026-11-19
branch: claude/confident-volta-rb2l3f
title: The opt-in gallery at /explore (launch plan, Session 10, part 2)
areas: [db, api, web, dugout, modules]
supersedes: []
---
## What changed
- Migration 0149: `project_pages.explore_listed` (default false), its own guard trigger (a client role may switch it on
  only as an owner or an admin; the page guard of 0077/0090 is untouched), and the view `public_explore_projects` (seven
  columns, the service connection's only), built on `public_project_pages` so what is public is decided in one place.
- API: `page.setExplore` (owner or admin, audited, refused for a sample business and for a project with no saved page),
  `page.get` carries `explore`, and `publicPage.explore` (anyone, newest 48, under the per-caller page-view limit).
- Web: `/explore` (public, indexable, from 390 px) drawn by the new design-system component `ExploreGallery`, with a
  story, a unit test and DESIGN §9f-2. Product › Public page gets the switch "Show in Explore" once the page is live.
- Tests: RLS and view tests (`project-pages.test.ts`), the API test, the screen and component tests, and
  `e2e/explore.spec.ts` (opt in, signed out at 390 and 1280 px with axe, opt out), which passed on the e2e stack.

## Decisions
- Opt-in is a column of its own, not a field of the page copy, so it never moves with "Publish changes", cannot be set
  by a member, and does not touch `ProjectPageContent` or the files #244 edits.
- Listing counts only while the page is live: taking the page down removes the project at once, and the choice comes back
  with the page. No logos in the cards (the logo is served per page as a data URL; initials mark instead).
- This is not #244's "listed" (the SEO rule about the length of "about"): that is search-engine listing, this is the
  founders' gallery. They do not depend on each other.

## Not done
- Waits on #244 and #303 merging, as the task said. Verified Customer Updates in the gallery: `customer_update_cards` and its public view are #303's (migration 0136 there).
  Once it merges, add a second list to `publicPage.explore` from `public_customer_update_cards`, with its own opt-in
  (a card is already shared by the founder's own press, so a card in the gallery needs that press plus this opt-in).
- Open Graph images (1200 × 630): `/p/<slug>`, `/m/<id>` and `/u/<handle>` already have them on main; the Customer Update
  one is #303's. Nothing to build for them until #244 and #303 land; check the brand's dark look then.
- "Share progress card" on Today (needs #303's card and its share control).
- The `/explore` address is not in the sitemap (the sitemap is Session 5's, and waits on #244's `publicPage.listed`).
- Cards show no paging: the newest 48 (`shortcut`, in the repo, add a cursor when more are listed).
- Migration number: 0145 (main took 0143 and 0144 while this waited). The view count in `migrations.test.ts` is now 9; #303 adds one.
