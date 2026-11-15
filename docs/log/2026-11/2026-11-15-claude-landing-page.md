---
date: 2026-11-15
branch: claude/landing-page
pr: 172
title: The first-timer's page at /, and the earlier page at /tour
areas: [web, dugout, landing, e2e]
supersedes: []
---
## What changed
- `/` (`apps/web/components/landing/LandingPage.tsx`, a server component; `LandingHero` and `StartButton` run in the browser): one page for every width from 390 px.
- Every string is in `words.ts`; the switches (`SIGNUP_OPEN`, `LIVE_MODE`, `PLATFORM_MAIL_DOMAIN`) are read at build time in `app/page.tsx` through `flags.ts`; Find people renders only with the people layer on. Examples are real components in `ScreenFrame`s (`first-timer-examples.ts`).
- The idea box: a visible label, the filled button, all three assurances at every width, layout from the page's own width, new typed ideas, and the keep panel's false research lines replaced.
- `/tour` (`app/tour/page.tsx`, `TourPage.tsx`): the earlier page, never indexed, its false claims fixed; `/?example=` deep links render it; `/tour` joins `PUBLIC_PREFIXES`.
- `PersonPage` and `ProjectPage` take `titleLevel` (1 by default).
- Tests: `LandingPage.test.tsx`, `removed-claims.test.tsx`, `TourPage.test.tsx`, Playwright `first-timer.spec.ts`, `idea-box.spec.ts`, `landing.spec.ts` (now the tour). Checked on a production build: `/` and `/tour` static, one h1, no horizontal scroll, axe clean at 390, 768, 1280 and 1440 px.

## Decisions
### Examples title themselves at h3
`titleLevel` on PersonPage and ProjectPage, so `/` keeps one h1; hiding them from assistive technology would have hidden the example from the readers it is for.
### The example project page shows the mark as its founder sees it
`mark: "member"`: a visitor's mark starts dim and lights as it scrolls in, so a frozen example would show it below contrast.
### The idea box stacks its card over the keep panel at every width
Side by side, the card took the hero's 640 px column and squeezed the panel out.
### The tour's picker writes /tour or /?example=<id>
Only the `/?example=` deep link is served for another business.
### The footer keeps the earlier page's test ids
`legal.spec.ts` finds the landing footer's Terms and Privacy links by `landing-terms` and `landing-privacy`; the new footer keeps both (CI shard 3 caught their absence).
### /tour joins PUBLIC_PREFIXES
A one-line change outside the landing files, without which a stranger opening `/tour` is sent to sign-in.

## Not done
`CardKeptView` (WP-03) still says "checks every number against real sources".
