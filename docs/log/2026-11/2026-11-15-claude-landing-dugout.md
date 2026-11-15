---
date: 2026-11-15
branch: claude/landing-dugout
pr: 157
title: The landing page's design-system tokens and components
areas: [dugout, design, landing]
supersedes: []
---
## What changed
- `packages/dugout/src/tokens.css`, new tokens only: the landing type scale (`--fs-landing-h1` to `--fs-landing-small`, body 16/26), `--landing-column`, `--landing-screen`, `--landing-section-y`, `--landing-field-h`, `--landing-gen-h`, and `--line-control` (a field's edge at 3 : 1 against the canvas).
- `packages/dugout/src/landing.css` (imported by dugout.css): `landing-page`, `landing-col`, `landing-measure`, `t-landing-*`, `landing-section`, `landing-split`, `landing-day`, `landing-field-edge`, `idea-gen-filled`, `screen-frame` and its chip.
- Server-safe components with stories: `ScreenFrame`, `LandingSection`, `DayList`, `AssuranceList`, `QuestionList`; Storybook `Landing/Idea button`.
- `landing.test.tsx` (10 tests) and the five files in `SERVER_SAFE_FILES`. Every new story at 390 and 1440 px: no horizontal scroll, axe clean.

## Decisions
### New tokens only
The landing scale and `--line-control` sit beside the console's tokens; nothing the console reads changes.
### The Example frame has no surface
A hairline and a chip, so a real card is never inside a card, and its rating cells lose their glow inside it; the console keeps both.
### IdeaCard's rating names get 24 px on the landing page only
WCAG 2.5.8, from landing.css, because the component is outside the landing session's files.

## Not done
`IdeaCard`'s rating-name buttons are still under 24 px in the console; the fix belongs in the component.
