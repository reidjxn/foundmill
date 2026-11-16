---
date: 2026-11-16
branch: claude/landing-idea-card-studio
title: The Studio opens on the kept card, and a waitlisted visitor's Studio choice survives admission
areas: [web, api, db, landing]
supersedes: []
---
## What changed
The founder, Nov 16, 2026, on items 2 and 3 left open by claude/landing-idea-card: the Studio should open with the kept
card selected ("Yes ... Let's fix that now"), and a waitlisted visitor's Studio choice should be remembered across
admission ("Yes fix it now").
- `IdeationStudio` gains one optional prop, `focusIdeaId`: once the deck holds that card it wears the just-landed
  highlight (the existing `fresh` look and "Just in" tag), is scrolled into view and takes focus, once. Nothing else
  in the Studio changed; the session that owns it was told first.
- New route `/new/ideate/<ideaId>` (app/new/ideate/[ideaId]/page.tsx) passes it. Not a uuid: `/new/ideate`. No
  profile: `/onboarding?next=/new/ideate/<ideaId>`, which `onboardingNext` now takes beside commit and card.
- `keepCard` with the Studio choice goes to `/new/ideate/<ideaId>`, or to the three questions first for an account
  with no profile.
- Migration 0126: `waitlist_entries.card_then` (null or `studio`, a check). `waitlist.join` takes `then: "studio"` and
  stores it with the card it holds; a join with no card keeps it; a join holding another card replaces it. `ideaBox.
  preview` returns `then` for the waitlist's card (null for a browser's or a link's, whose choice is in the address).
- The not-invited and on-waitlist pages pass the choice from `/start`'s address to the join (`ApiErrorPage` →
  `WaitlistJoin` → `joinWaitlist`). `/start` sends the person to `/new/card/keep?then=studio` when the address or the
  waitlist says so (`keepCardPathFor`, a pure function in lib/auth/start-destination.ts).
- Tests: api "the Studio choice goes with the waitlist's card…" and the admission test now joins with the choice and
  reads it back on admission; db `migrations.test.ts`; web `start-destination` (`keepCardPathFor`) and `redirects`.
  Playwright `idea-box.spec.ts`: signed in, the Studio choice lands on `/new/ideate/<id>` with the card highlighted,
  in view and focused; a new account answers the three questions and lands there; on a phone the same path ends at the
  Studio's larger-window notice with "Email me a link".
- docs/IDEA_BOX.md.

## Decisions
### A column, not an account event
Both server-side ways to remember the choice need a migration: a new account-event type has to join the database's own
list (`fm_account_event_types`, 0108), and the funnel's account events are facts read only by the nightly numbers, not
routing state. A browser cookie needs none but does not survive a change of device, which admission often is. One
nullable column with a check is the smallest honest change. First numbered 0124; #240 (Sites) took 0124 and merged
first, so this is 0126, above main (0124) and every open branch (0125), with a newer journal `when`. Auto-merge was off
until then.
### "Selected" is the just-landed highlight, not Compare's selection
The Studio's selection is Compare's pick, whose bar reads "pick 1 more": the wrong frame for shaping one idea. The card
is ready to shape with its own actions (Edit, Ask, More like this); the page puts it in view and focus.
### A path, not a query
`/new/ideate/<ideaId>` passes `isContinuePath`, so on a phone the larger-window notice's "Email me a link" carries the
card to a computer. A query would be dropped there. It also fits `onboardingNext`'s existing commit|card pattern.
### The three questions are decided in the keep action
On a phone, `DesktopOnly` renders only the larger-window notice for `/new/ideate/<id>`, so the page's own redirect to
the three questions never runs on the client (found by the 390 px Playwright case). `keepCard` checks the profile
itself. The same fix went into claude/landing-idea-card, where it also restored `/new/ideate`'s plain `/onboarding`
gate that `onboarding.spec.ts` checks.

## Not done
- The waitlist's own half cannot run in Playwright: the stack's developer accounts have no confirmed address, and
  `waitlist.join` refuses them (the not-invited spec accepts either outcome for the same reason). The api test covers
  join → admission → preview; the web's routing is unit-tested; Playwright covers everything from the keep step on.
- On a phone the Studio still cannot open: the person gets the three questions, then the Studio's notice and its link.
