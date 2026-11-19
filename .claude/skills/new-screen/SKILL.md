---
name: new-screen
description: Create a screen with the Dugout design system — route, widgets, saved table views, keyboard shortcuts, Storybook story and Playwright test — per docs/BUILD.md §6 and docs/DESIGN.md. Use for any new page in apps/web or packages/modules.
argument-hint: "<screen>"
---

# Add a screen

Delegate UI work to the `dugout-builder` sub-agent, then check its work against this list.

1. Read `docs/DESIGN.md` and `docs/BUILD.md` §6 (routes, modules vs departments). Never hard-code a department name.
2. Every element comes from `packages/dugout`; tokens only, no ad-hoc styling. Entity mentions render with `<EntityLink>`.
3. Size rule (FOUNDMILL.md "Never"): the dense console is 1280 px and wider and says so kindly below that; only the outer product (public pages, sign-in, home, profile, people, messages, Today, Needs you, `/a/<token>`, `/email/pause`) works from 390 px.
4. Copy: product vocabulary, no football words, US English and US dates, plain language. Label every non-real number "Forecast" or "Estimate".
5. A Storybook story for each new component; a Playwright spec in `apps/web/e2e/` for the screen.
6. Finish with `verify-done`.
