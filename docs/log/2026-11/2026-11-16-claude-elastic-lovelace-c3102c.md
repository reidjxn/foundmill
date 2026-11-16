---
date: 2026-11-16
branch: claude/elastic-lovelace-c3102c
title: The roadmap board helpers no longer differ from the board component only in case
areas: [modules, product]
supersedes: []
---
## What changed
`packages/modules/src/product/roadmap/board.ts` (the pure helpers) is now `board-logic.ts`; `Board.tsx` (the component)
keeps its name. On a case-insensitive disk (macOS) the two names were one file to TypeScript, so
`pnpm --filter @foundmill/web typecheck` failed with TS1149 and TS2305 at `RoadmapScreen.tsx` lines 19 and 20, plus four
implicit-any errors on line 174 that followed. CI on Linux never saw it. Five import lines changed (`RoadmapScreen.tsx`,
`roadmap/Board.tsx`, `roadmap/Timeline.tsx`, `__tests__/helpers.test.ts`, `__tests__/date-format.test.tsx`). Every export
is unchanged and there is no behavior change.

## Decisions
### Rename the helpers file, not the component file
The component file matches its export (`Timeline.tsx` exports `Timeline`, `ItemDialog.tsx` exports `ItemDialog`), so
renaming `Board.tsx` to `RoadmapBoard.tsx` would have broken that. Logic files in `product/` are lowercase and kebab
(`roadmap-status.ts`, `prosemirror.ts`), so `board-logic.ts` fits. The file also holds the timeline scale; it keeps
`board-` because that is where the helpers started and the name only has to differ by more than case.

## Not done
- No other tracked path pair differs only in case (checked with `git ls-files`), but nothing stops a new one. The frozen history in `docs/PROGRESS.md` and `docs/WAVE2_REPORTS.md` still says
  `board.ts`; it is not edited.
