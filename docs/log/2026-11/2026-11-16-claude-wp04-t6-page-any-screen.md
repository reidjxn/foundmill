---
date: 2026-11-16
branch: claude/wp04-t6-page-any-screen
title: Check, publish and share the page on any screen
areas: [web, modules]
supersedes: []
---
## What changed
WP-04 T6 (FR-03 item 3, A9-P0-2 items 3 and 4, s2 P0-2). Product › Public page is the first department tab that
works from 390 px; every other department tab keeps the 1280 px floor.

- apps/web `DesktopOnly.tsx`: one entry in `SMALL_SCREEN_PATTERNS`, `/^\/b\/<uuid>\/d\/[^/]+\/public-page\/?$/i`. The
  business shell already passes `phone={worksOnSmallScreens(pathname)}`, so the tab gets the shell's phone layout.
- apps/web `DepartmentScreen.tsx`: below 1280 px on a tab that works on small screens, no tab bar (every other tab
  would ask for a larger window), the tab's own name as the phone title ("Public page"), a "Back to Today" link
  above the screen, and no department tour (its callouts point at the tab bar).
- packages/modules `PublicPageScreen.tsx`: the grid stacks (`PageGrid stack`, through a new `stack` prop on the
  product `Screen`), so the preview sits under the form under `page-wide`; below 1280 px every button is `size="lg"`
  with `min-h-tap`, full width under `page-wide`. After a publish on a narrow screen the share panel (`SharePost`)
  opens in place with the ask: "I'm starting {project}. {pitch} Would you use this?" and the page's address with `via`
  (`pageAskDraft`), titled "Send your page to three people" with T7's line. The panel's own "Share…" uses
  `navigator.share` where the device has it, and every press still records `share.opened` with `kind: "page"`. On a
  desktop nothing opens; a new "Copy message" beside "Copy link" copies the same words with the link. While no draft
  row exists (`saved: false`), one line above the fields says the draft is from the founder's own words and the team's
  version replaces it.
- Tests: `desktop-only.test.tsx` (the pattern matches the tab under any department and no other tab),
  `public-page-phone.test.tsx` (the ask's words; stacking and tap sizes at 390; the panel after publish at 390, not
  after a held publish, not at 1440; Copy message; the starter line), and `apps/web/e2e/first-session.spec.ts` at
  390 x 844 and 1440 x 900. All failed on main; the e2e at 390 failed at the tab, on "This part is built for a bigger
  screen". `public-page.spec.ts`, `tap-to-post.spec.ts` and `phone-today.spec.ts` pass unchanged.

## Decisions
- **The spec and the code disagree on the path before Today.** `first-session.spec.ts` is meant to start at a kept card,
  through T1's three questions and T2's name-and-go Commit. Neither is on main (`FirstProfile` does not exist; Commit is
  the desktop form), so the spec starts the project through today's Commit at desktop width and covers Today to a live
  `/p/<slug>` at both sizes, checking `needs-larger-window` on every screen of that part. T1 and T2 extend it from the
  card and add the screen and input counts.
- **"Narrow" means the shell's phone layout (below 1280 px)**, read with `useViewportWidth`, for button size and the
  ask after publishing; full width and the one column follow the `page-wide` container query, as on Today.
- **The ask is its own draft, not a change to `pagePostDraft`.** "Share your page" keeps its post for the networks (the
  project's name and pitch, no "I"); the ask is for the few people the founder sends it to, in the founder's voice. It
  lives in the module (`pageAskDraft`), built on `pagePostDraft` for the link and picture, so packages/shared and the
  tap-to-post words are untouched.
- **Desktop "add the message to Copy"** is a separate "Copy message" button, on every width. "Copy link" still copies
  only the address, as its label says and the existing specs expect.
- **The way back to Today** is a link drawn by `DepartmentScreen` on the phone, not in AppShell or BusinessShell: another
  branch edits `AppShell` and `PhoneBar`, and T13 edits `BusinessShell`.
- The starter line keeps the plan's words, split into three sentences ("about a minute" is the plan's own estimate of
  the Product lead's draft).

## Not done
- No Storybook story of the screen at 390: module screens have no stories in this repo and no new component was added.
- The kept card, the three questions and Commit on the path (T1, T2), and the 6-screen, 2-input count of Done-when 1.
- `TodayScreen.tsx` needed no change: its "Check it and publish" already opens the tab.
- BusinessShell's comments still say only Today and Needs you get the phone layout; left for T13's branch to avoid a
  conflict.
