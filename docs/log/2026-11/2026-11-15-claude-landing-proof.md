---
date: 2026-11-15
branch: claude/landing-proof
title: Proof for the first-timer's page at four widths, axe, and a phone performance measurement
areas: [web, e2e, landing, accessibility, performance]
supersedes: []
---
## What changed
- `apps/web/e2e/first-timer-proof.spec.ts`: at 390, 768, 1280 and 1440 px the same sections, one h1, no sideways scroll, the field labeled and reached by Tab, the button on the first screen and 44 px tall, and axe (WCAG 2.2 A and AA) clean with every section scrolled into view.
- The same spec: at 768 px a card lands with the mock model, the example card steps aside and axe stays clean; the hero does not animate under reduced motion; with the people layer off nothing about finding people shows and nothing says it is coming.
- `axe-core` 4.13.0 joins the catalog and the web's dev dependencies, the same two lines `claude/blissful-fermat-q03yq1` adds, so the two branches agree.
- Screenshots at every width: `docs/holistic-plan/landing/shots/proof-<width>.png` and `proof-<width>-fold.png`.
- 29 Playwright tests pass against a production build (the proof spec, first-timer, idea-box and the tour).

## Decisions
### Performance measured with Chrome, not Lighthouse
Lighthouse is a download the session's brief ruled out. The same profile Lighthouse uses for mobile was set through Chrome's protocol (4x CPU, 150 ms round trips, 1.6 Mbps down, 750 kbps up, 390 px at 3x), three runs, medians.
- New `/` (local production build, gzip): LCP 1.07 s, CLS 0.004, interaction 72 ms, blocking after first paint 235 ms, JavaScript 422 KB.
- Today's `/` (foundmill.com, Vercel, brotli): LCP 1.28 s, CLS 0.069, interaction 472 ms, blocking 792 ms, JavaScript 731 KB.
- Every target met (LCP under 2.5 s, CLS under 0.1, interaction under 200 ms, JavaScript well under today's). The local server has no CDN, and Vercel's brotli is smaller than gzip, so production should do a little better.
### The proof is a file of its own
Stacked on #172 so the stack stays three deep; a separate spec file keeps it clear of #182's additions to `first-timer.spec.ts`.

## Not done
- Most of the remaining JavaScript is React and the root layout's app-wide providers (data client, tooltips, guidance), which every page loads; serving `/` without them is a change to `app/layout.tsx`, outside the landing files.
- The people block's "on" side is proven by `LandingPage.test.tsx`; the e2e web stack builds with the switch off, as production has it.
