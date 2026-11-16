---
date: 2026-11-16
branch: claude/wp10-t13-bundle-tokens
title: Today's bundle, dead code and a design-token scanner
areas: [web, widgets, modules, dugout, scripts, ci]
supersedes: []
---
## What changed
WP-10 T13 (docs/holistic-plan/WP-10-console-and-design.md; audit A2-15, A2-20, A2-22, A2-23).

1. **Today's bundle.** The status tiles Today shares with the status strip move to
   `packages/widgets/src/shared/today-tiles.ts` (`status-strip.tsx` re-exports them). `TodayScreen.tsx`, `home/lead.tsx`
   and three files Today reaches in `packages/modules/src/product` (`foundations.tsx`, `signoff.tsx`, `shared.tsx`)
   import deep paths (`@foundmill/widgets/data`, `/shared/routes`, `/shared/departments`, `/shared/errors`,
   `/shared/today-tiles`) instead of the barrel, whose last line registers every widget. `packages/widgets/package.json`
   gains `sideEffects`. Measured on `next build` (the client chunks the `/b/[bid]/today` client reference manifest
   lists, gzipped): **477 KB in 42 chunks before, 308 KB in 32 after**. Guard: `apps/web/lib/__tests__/today-bundle.test.ts`
   walks Today's static imports and fails on the barrel (checked: it fails with the modules files reverted).
2. **Dead code.** Deleted `apps/web/components/placeholders/HomePlaceholder.tsx`, `SurfacePlaceholder.tsx`,
   `apps/web/components/shell/ComingSoon.tsx` (imported by nothing).
3. **Storybook** opens with Builder view off (`.storybook/preview.ts`), so a reviewer sees what a founder sees.
4. **Scanner.** `scripts/design-tokens.mjs` (+ `.test.mjs`): fails on a hex color or an arbitrary Tailwind length in
   `.ts`/`.tsx` under apps/web and packages/{dugout,modules,widgets}/src outside tests, stories and fixtures. Per-file
   counts in `scripts/design-tokens.allow.json` (73 files, seeded today, with reasons for the kinds that stay: Monaco and
   xterm fallbacks, Google branding, sample and example brand colors, the viewport `themeColor`). A listed file may not
   grow; a shrunk count is printed as a note. `PhoneBar`'s `max-w-[85vw]` becomes the token `--phone-menu-max`. In CI
   next to the focus-ring check.

## Judgment calls
- **The `matchday` Continue state stays.** The package called it unreachable; the landing deck uses it
  (`apps/web/components/landing/cycle.ts`, DESIGN §9a's gold Continue). `screenTitle ?? "Home"` was already gone.
- **The bundle guard is a unit test, not a byte budget in `speed.spec.ts`.** The e2e stack runs `next dev`, whose
  bundles are unminified and not the ones a founder downloads; a budget there would measure the wrong thing. The import
  walk fails on the actual cause. The measured figures above are an Estimate of first-load size (they count every client
  chunk the route's manifest lists).
- `BusinessSwitcher.tsx` `#1b4fd8` and `IdeaCard.tsx` `#3a87ff`, two of the four "cheapest" fixes, were already gone on
  main. The scanner counts more than the audit's 15 files / 45 values because it also reads comments and `.ts` data
  files; the allowlist holds them all so the line holds from today.
- `optimizePackageImports` not added: the target was met without it.
