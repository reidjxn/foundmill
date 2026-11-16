---
date: 2026-11-16
branch: claude/landing-followups
title: Defined attribute names are 24 px targets everywhere; the landing page's own override goes
areas: [dugout, accessibility, landing]
supersedes: []
---
## What changed
- `AttributeLabel` (packages/dugout `journey/concept/AttributeBar.tsx`): the defined attribute name (a `Term` button that stands alone in its row, on `IdeaCard`, concept cards and attribute bars) is at least 24 px tall (`min-h-target`, the existing 24 px token), so WCAG 2.5.8 holds in the console too.
- `landing.css` drops the landing-only override that lifted those buttons on `/` (2026-11-15).
- Test: `AttributeBar.test.tsx`. Dugout 1,315 tests pass; the landing's proof, first-timer and idea-box specs (21) pass against a production build with LIVE_MODE on, axe's target-size rule included.

## Decisions
### Fix the component, not each page
The term is a control in a row, not a word in a sentence, so the inline exception of 2.5.8 does not apply; the minimum belongs where the button is drawn.
### The card-kept line was already fixed
WP-03 changed `CARD_KEPT_WORDS.lede` to "It is saved in your deck. Your team starts from your words."; nothing in apps/web says "real sources" now.
### The root layout's JavaScript is measured, not changed
`/terms` loads 275 KB (gzip), almost all the root layout and React; `/` loads 420 KB. Serving `/` without the app-wide providers means a second root layout (moving every route into a route group) or lazy providers that delay every console page's hydration. Both touch every route while other sessions work in them, and `/` already meets its targets (LCP 1.07 s, interaction 72 ms on a mid-range phone). Left for the founder to decide.

## Not done
The root layout change above.
