---
date: 2026-11-17
branch: claude/modest-mccarthy-4w9z5r
title: One style for estimates, one legend (WP-14 T7)
areas: [dugout, modules, web, docs]
supersedes: ["DESIGN §10: non-real numbers carry Forecast or Estimate in a dashed chip next to them"]
---
## What changed
- `ProvenanceChip` (packages/dugout) takes the figure as its children and draws it in the estimate style (`est-fig`): the figure's own size and color, italic, a dashed underline. The word Estimate or Forecast is its tooltip on hover and focus and the end of its accessible name ("$1,200 Estimate"), and is copied with the figure.
- With no children it shows the word in the same style: for a chart, a whole panel or a sentence, where no one figure carries it. The dashed box is gone.
- `EstimateLegend` is the line "Numbers in this style are your team's estimates. Everything else is measured.", its first three words drawn in the style. `AppShell` renders it once under the content, on desktop and phone, shown only while the page holds an estimate (`est-legend-auto`).
- 30 call sites in dugout, modules and apps/web now pass the figure: metric tiles, department cards, agent tiles, the live run meter, the Autopilot chip, Runway, Channels, Recruitment, Training, the confirm-plan total and others.
- docs/DESIGN.md §8 "Estimate / Forecast" and §10 are rewritten; WP-10 T9 carries the amendment; packages/dugout/CLAUDE.md has the rule.
- Tests: `Chip.test.tsx` (the figure form, the word form, every form names its word, the legend), `AppShell.test.tsx` (one legend, outside the content), `a11y/stories.spec.ts` (every estimate in every story names its word), `e2e/money-legal-distribution.spec.ts` (Runway shows the style and the legend; a screen with no estimate shows none).
- Stories: Foundation/Chip "Forecast / Estimate" and "Estimate legend".

## Decisions
### The style is italic with a dashed underline, on the figure's own type
Dashed already means "not measured" (forecast lines, cones) and a defined word is dotted, so the underline stays dashed. At 1 px the two are too close to tell apart on their own, so the figure is also italic: a defined word stays upright. Color and size are left alone, so a hero figure stays a hero figure and nothing depends on color.

### The legend is drawn by the shell, outside the scrolling content
One line per screen is easiest to keep true when no screen has to remember it. The shell's copy sits under the content on a hairline and is hidden by CSS until the page holds an element marked `data-provenance="estimate"` or `"forecast"` (a dialog's estimate counts too). It is outside `main`, so no screen's own layout changes. It costs about 30 px of height on screens with an estimate.

### The word stays where no single figure carries it
A panel's Forecast label over a chart, "Results are an Estimate until…" in a sentence, a rating bar's row and the Journey ribbon's toolbar keep the word, in the same style. This is the task's "wherever a figure stands alone" read for the console; email, exports and Inbox prose were already words and are unchanged.

### The figure is still a button
It was a focusable button before (finding D3) so the keyboard can open its meaning. It keeps that, with `user-select: text` so the number can be selected and copied.

### A click on an estimated tile's figure still opens the tile
On a clickable metric tile the figure sits above the tile's own button, so hover and focus reach it. The figure is most of the tile, so `ProvenanceChip` takes an `onClick` and the tile passes its own: a click on the figure does what a click beside it does. Before, only the small chip was a separate target.

### Two fixed accessibility baseline entries are deleted
The Autopilot chip's small Estimate chip failed the target-size rule; the styled time does not. `a11y/baseline.json` loses those two entries (it may only shrink).

## Not done
- Screens other sessions are rewriting were not edited. They read correctly today (the word in the new style follows the figure), and each needs two things from its owner: pass the figure as `ProvenanceChip`'s children, and, where the screen is outside the console's shell, render `<EstimateLegend />` once.
  - Outside the shell, legend and figure form: the tour's `HowItWorks`, `LiveSessions`, `Journey` and `CycleDeck` (apps/web/components/landing, WP-14 T10); `CommitScreen` and the logo picker's cost line (WP-14 T11); the first-profile and ideation screens' live run meter gets the figure form from dugout but no legend (WP-14 T2).
  - Inside the shell, figure form only (the legend is already there): `BillingTab` (WP-14 T3), Today's Autopilot and digest lines come from dugout and are done.
- `BasicsTab` keeps the word after the value: the row is a link, and a button inside a link is the nesting the accessibility baseline already lists.
- A rating row's Estimate (SkillGrid, AttributeBars) keeps the word; WP-10 T9 moves it onto the figure.
- The landing page's honesty line "Every number we didn't measure says so." (WP-14 T10) is true with this merged.
