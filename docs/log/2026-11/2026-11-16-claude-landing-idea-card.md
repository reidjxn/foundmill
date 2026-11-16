---
date: 2026-11-16
branch: claude/landing-idea-card
title: The landing page's idea card is wide, offers the Studio or building it now, and warns before a redraw
areas: [web, dugout, api, shared, landing]
supersedes: []
---
## What changed
The founder, Nov 16, 2026: after an idea is generated the page "looks bad" (a 360 px card, the rest empty); the card should be wider, the visitor should be able to open the idea in the Ideation Studio or proceed right away, and generate a new idea after a warning that the last one will be discarded.
- `IdeaCard` gains `wide`: no 360 px cap, and from a 576 px card the ratings sit in a column beside the pitch, the overall figure and the raise line. Story `Public/IdeaCard › Wide`.
- New design-system component `IdeaNextSteps` (`packages/dugout/src/components/public/`, test and story
  `Public/IdeaNextSteps`): "What next for <name>?", "Shape it in the Ideation Studio" (glass) and "Start building it
  now", each a link with one line under it, the page's own lead and small print, then "Try another idea" behind an
  inline warning ("<name> will be discarded. This device holds one idea at a time, and the new one takes its place."),
  with "Discard it and try another" and "Keep <name>". Focus moves into the warning; Escape or Keep puts it back on
  the button. At 0 redraws left it says so instead of the button.
- `IdeaBox`: the result is a `landing-result-grid` (new landing.css utility): card and choices side by side once the
  result is 880 px wide, stacked under that. `LandingHero` drops its two-column grid and the 640 px measure once a
  card has landed, so the result uses the whole 1120 px column. The landed words stay at the reading measure. While
  the field is open again after a confirmed redraw, "Back to <name>" returns to the held card.
- The two choices go through sign-in with the claim token (`keepHref(claim, "build" | "studio")`). "Start building it
  now" is the existing thread (`/start` → `/new/card/keep` → `/new/card/<id>` → three questions → Commit). "Shape it
  in the Ideation Studio" adds `then=studio`: `/start` passes it to `/new/card/keep`, whose `keepCard` (now bound with
  the intent) opens `/new/ideate` after the press; for an account with no profile yet it sends to
  `/onboarding?next=/new/ideate` itself (on a phone the Studio page shows only the larger-window notice, so its own
  redirect would never run). `onboardingNext` accepts `/new/ideate` exactly. `/new/ideate` opened directly with no
  profile still sends to plain `/onboarding` (the gate `onboarding.spec.ts` checks).
- Redraws left: the card event gains `redrawsLeft` (`packages/shared`). `RateLimitStore` gains `peek(entry)`, read-only (memory: the sliding window's peek; Redis: a ZCOUNT script, memory while Redis is down). `cardEvent` reads it for a new card, a redraw and `/idea-box/mine`.
- Copy: the lead under the choices is "Either way, you sign in first so the idea stays yours. Foundmill lets new
  people in a few at a time. If your place is not open yet, we keep your idea for 90 days, and you can shape it in the
  Ideation Studio as soon as you are in." The waitlist's saved line with a card now says the idea is kept and that as
  soon as they are off the waitlist they can shape it further in the Ideation Studio (both the no-email and the email
  line).
- Tests: api `rate-limit` (memory and Redis peek), `idea-box` (`redrawsLeft` 2 → 1 → 0; an admitted waitlister's kept
  card is in `idea.list`); web `IdeaBox` (both hrefs, the warning before a redraw, Keep and Back, none left),
  `redirects` (`onboardingNext("/new/ideate")`), `api-error-page` (the waitlist lines); dugout `IdeaNextSteps`.
  Playwright `idea-box.spec.ts`: at 1440 the card is over 560 px with the choices beside it; the Studio choice signs
  in, keeps and lands on `/new/ideate` with the card in the deck; the warning, Keep and confirm, and "2 more today"
  then "1 more today"; at 390 the choices stack at 44 px, the Studio note shows, the warning fits, no sideways scroll.
  docs/ux-audit 46 and 47 retaken. docs/IDEA_BOX.md updated.

## Decisions
### The Studio line is said because the code proves it
On admission `/start` offers the waitlist's card (`ideaBox.preview`, source `waitlist`), keeping it creates an
uncommitted idea in the person's deck, and `ideas.listForUser` (the Studio's `idea.list`) returns it. The api test
"someone not on the invite list joins the waitlist and keeps the card" now asserts the kept idea is in `idea.list`.
The waitlist does not carry the "Studio" intent across admission: the person keeps the card on `/new/card/keep` and
lands on its page, where "See more directions" opens the Studio.
### The intent rides the existing thread
WP-04 T1's thread (sign-in → `/start` → `/new/card/keep` → kept card) is reused, not rebuilt: one optional
`then=studio` parameter, the card still kept only by a press. The onboarding session was told of the five small edits
outside the landing files (start, keep page and action, ideate page, `redirects.ts`) before they were made. No file
under components/new or components/onboarding changed.
### Google sign-in moved off the box
With two choices that differ only by where the person lands, a third "Continue with Google" button would have needed its own intent. Both choices go to `/login`, which already offers Google when it is on. One fewer press is lost for Google users; worth checking against the funnel.
### Studio first
"Shape it in the Ideation Studio" is the glass (primary) choice and comes first, because the founder's stated point is the visitor who does not love the idea yet. "Start building it now" is the same size beside it.
### Redraws left are read, never guessed
The page used to offer the button on every card and let the third press read the `limit` line. A read-only `peek` on the limit store tells the page the real count without spending one; null (a store that cannot say) still shows the button and leaves the api to decide. The per-address and daily dollar limits still apply on top, so a count above 0 is a ceiling, not a promise.
### The warning is inline
A design-system panel in place of the button, not the Dialog: it reads the same at 390 px, keeps the card in view while the visitor decides, and needs no overlay. The destructive button is the `danger` variant, as for other destructive confirmations.
### `onboardingNext` widened by one exact path
T1's test listed `/new/ideate` among the paths the three questions must not go on to, as an example of "another app path". It is now allowed, exactly (no subpath, no query), so a card kept for the Studio keeps its thread through the three questions.

## Not done
- The Studio does not focus or highlight the kept card: it is first in the deck (newest first). Opening it selected would mean changing `IdeationStudio` (components/new, the onboarding session's area).
- The Studio is desktop-only: on a phone the choice says "The Ideation Studio opens on a computer.", and after sign-in the Studio page shows the usual larger-window notice.
- The intent is not kept for a waitlisted visitor across admission (see Decisions).
- Storybook was not built here (`pnpm storybook:build`); the stories typecheck and CI builds them.
