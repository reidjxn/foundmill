---
date: 2026-11-16
branch: claude/wp03-t7-stall-guard
title: The idea box stops a stalled stream on the page; the keep panel's words; Get the app in the footer
areas: [web, landing]
supersedes: []
---
## What changed
- WP-03 T7 step 2: `IdeaBox` starts a timer at `IDEA_BOX_DEADLINE_MS + 5_000` (35 seconds) when the draft's stream
  opens. If no card or refusal has arrived by then it aborts the request, shows `IDEA_BOX_ERRORS.failed` ("The card
  could not be finished. Try again.") under the field, and puts the field back with the visitor's words in it. The
  timer is cleared when the stream ends either way. Web test first: a stream that sends `started` and never ends; it
  failed on main (the box stayed "Shaping").
- WP-03 T1's two lines left for the landing session: `IDEA_BOX_WORDS.keepLead` is now "Sign in to keep this card.
  Foundmill lets new people in a few at a time. If your place is not open yet, we hold your card for 90 days."
  (through `APP_NAME`). `freeLine` already read as T1 specifies; the new words test pins both and checks that nothing
  in the keep panel says the team checks the card against real sources.
- WP-03 T9's landing reader (left by #197 for the landing session): the footer renders
  `<GetTheApp links={storeLinks} className="@page-wide:hidden" />`, shown under 640 px of the page's own width.
  `LandingPage` takes `storeLinks` as a prop, defaulting to `publicEnv().storeLinks`; while
  `NEXT_PUBLIC_STORE_LINKS` is unset it renders nothing. A test covers both, set and unset.

## Decisions
- The timer starts after the Turnstile token, when the request opens: the browser check has its own 15 second limit
  and its own line, so the 35 seconds measure the stream alone, as the spec's "Done when" does.
- The words go back by keeping them: `value` was never cleared while drafting, so the field returning to rest is the
  restore. No second copy of the words is kept.
- T1 step 6 (the 390 px invite-only case) is not added to `idea-box.spec.ts`: `apps/web/e2e/not-invited.spec.ts`
  from PR #194 covers every assertion it lists (the gate visible at 390 px, no `needs-larger-window`, controls at least
  44 px tall). A copy here would test the same page twice.
- No Playwright change for the stall: a stalled stream cannot be made on the shared mock stack without a new test
  hook in the api; the unit test with fake timers covers it.
- The store links reach `LandingPage` as a prop with the env as its default, like `switches`: the page is
  prerendered, so the value is read at build time either way, and the test needs no environment.
- "Under 640 px" uses the page's container width (`@page-wide:`, DESIGN §9a), not the window's, like the rest of
  the landing page.

## Not done
- `IDEA_BOX_ERRORS.limit` and `.resting` (T1's rows) shipped with PR #194, merged into this branch.
- T7 step 3 (up to 2 redraws) is the next branch, stacked on this one.
