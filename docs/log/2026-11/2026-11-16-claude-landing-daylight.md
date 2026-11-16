---
date: 2026-11-16
branch: claude/landing-daylight
title: The landing page opens in daylight, shows the Ideation Studio and importing, and has five variants
areas: [web, dugout, shared, docs]
supersedes: ["The landing page: direction (DIRECTION.md sections 3 and 7)", "Dark only, one theme (for the top of the landing page only)"]
---
## What changed
- `/` is rebuilt (founder, Nov 16: the first build was "too dark", "boring", said "card", and never showed the Ideation Studio or importing). DESIGN.md §9a is rewritten to match.
- The page opens on a light canvas with a rated example standing in it as a dark screen, descends through one field of the brand's blue ("Three ways to start") into the product's night (the Ideation Studio with three example ideas, people, a first week, control and cost, questions) and closes on the blue.
- Light is two token scopes in `packages/dugout/src/landing.css`: `world-day` points the semantic tokens at new `--day-*` tokens (the only light literals, in tokens.css); `world-night` reads the night values back for a product screen shown in daylight. `tokens.test.ts` holds the day tokens' contrast.
- The rated result of the idea box is the visitor's "idea", never a "card", on the landing page, in the idea box, in the api's three refusal lines (`IDEA_BOX_ERRORS`) and in `IdeaCard`'s label. "You never enter a card" is now "you never enter payment details". A test fails if "card" returns to `/`.
- Five variants on the same sections: `first` (default, `/`), `no-idea`, `has-idea`, `running`, `builder` (`apps/web/lib/landing-variant.ts`, `VARIANT_WORDS` in words.ts). Each is prerendered at `/lp/<id>` and served under `/` by proxy.ts: the link's `?lp=`, else the `fm_lp` cookie (30 days), else `utm_source` through `CHANNEL_VARIANTS`.
- Tests: `LandingPage.test.tsx` (sections, ways, studio, the five variants), `lib/__tests__/landing-variant.test.ts` (the resolver and `decideRedirect`), the idea box and tour tests updated for the wording. Run locally: web landing, auth and variant suites, dugout tokens and landing suites, eslint, banned-terms, us-english, plain-language. Checked in a browser at 1440 and 375 px.

## Decisions
### The tour is offered three times, from 1280 px only
The founder asked for a clearer route to `/tour`. "Take the tour" is in the top bar, under the Studio's examples and in the footer. All three hide under 1280 px, where the tour is only its hero.

### Light at the top, dark below, once
The founder chose "light top, dark below" over a fully light page and over a vivid dark one. The page goes day, blue, night, and rises to the blue only for the close. The product's screens stay dark everywhere, so the hero's example reads as the product, lit.

### Scopes over a second theme
A theme switch would touch every component. Two scopes on the landing page re-point about twenty tokens and their aliases, so the idea box and buttons take the light with no change of their own. The night values are kept under `--night-*` names at `:root` (custom properties resolve where they are declared), so no color literal is duplicated.

### The Studio is shown with `IdeaCard`, not `ConceptCard`
`ConceptCard` is a client component with tooltips and menus that expect the console's providers. Three `IdeaCard`s show the same ratings, render on the server and add no script.

### A variant changes emphasis, never claims
Every variant line is one the default page could also say. The Studio and imports need a place, so the Ways section says so while sign-up is closed.

### No random split yet
Nothing reads an experiment today (no analytics on the site). The seam is built (`fm_lp`, `data-variant` on the page root, a prerendered route per arm); assigning the cookie at random belongs with the funnel events (s2 P0-5, P2-5).

### Only three channels map to a page
`github`, `hackernews` and `producthunt` go to `builder` (s2 §9.3 calls their readers technical). Every other channel gets the default until a campaign says otherwise.

## Not done
- Playwright was not run (no local stack): `landing.spec.ts`, `idea-box.spec.ts`, `first-timer.spec.ts` and `first-timer-proof.spec.ts` had their strings, section list and one selector updated by hand, so CI is their first run. The proof spec's axe pass has not seen the light zone.
- "Card" remains after sign-in: the keep step (`/new/card/keep`, "Keep this card"), the "Your card" titles, the account email "Your card for … is saved", and the console's "concept card".
- `docs/holistic-plan/landing/DIRECTION.md` sections 3, 4 and 7 describe the earlier page; its claims and switch tables (section 6) still hold. The home share image still draws the earlier dark look.
- `pnpm --filter @foundmill/web typecheck` fails on this laptop only on `packages/modules/src/product/roadmap/Board.ts` against `board.ts` (a case-insensitive disk); nothing in this change.
