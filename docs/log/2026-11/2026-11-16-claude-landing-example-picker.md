---
date: 2026-11-16
branch: claude/landing-example-picker
title: The hero's example switches between Northwind Skincare, Sole Revival, Tutorlane and Glitchwick; Sole Revival has a logo
areas: [web, dugout, landing]
supersedes: []
---
## What changed
- `/`: the rated example beside the idea box is `ExampleIdeas` (apps/web/components/landing/ExampleIdeas.tsx), a radio group just under the Example line: Northwind Skincare (shown first), Sole Revival, Tutorlane, Glitchwick, each with its logo; the chosen one's real `IdeaCard` under it (founder, Nov 16).
- `EXAMPLE_IDEAS` (first-timer-examples.ts): the three businesses' pitch, stars and ratings copied from the tour's examples (so `/` does not load the tour's data), each rating with its own reason.
- Sole Revival's logo (`SOLE_REVIVAL_LOGO`, logos.ts): a cream sneaker on a gold sole with a sparkle, on its brand green, checked by `checkLogo`. The example project page in "A first week" wears it too.
- `IdeaCard` (packages/dugout) takes an optional `logo` (a checked data URL) in place of the initials tile; story `WithLogo`, a test.
- Tests: `ExampleIdeas.test.tsx` (order, Northwind first, click, arrow keys and Home/End with one tab stop, ten reasons each), `LandingPage.test.tsx`.
- Landing unit tests 173 and dugout IdeaCard tests pass; first-timer, proof and idea-box specs (21) pass on a production build; axe clean at 390 and 1440 px with Sole Revival chosen.

## Decisions
### A radio group, not tabs
One choice of four that swaps one card: a radio group with arrow keys and one tab stop, like the tour's example picker.
### The examples' data is copied, not imported
The tour's example modules are large and load on demand; the hero needs only a pitch, stars and ten ratings each.
