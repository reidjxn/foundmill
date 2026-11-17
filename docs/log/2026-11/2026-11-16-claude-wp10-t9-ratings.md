---
date: 2026-11-16
branch: claude/wp10-t9-ratings
title: Ratings a first-timer can read
areas: [dugout, web, modules, shared, docs]
supersedes: []
---
## What changed
WP-10 T9, with founder decision 5 (Nov 16, 2026, relayed by the plan-execution session): with Builder view off a
rating shows its figure too, "14 of 20 · Good".

- `packages/dugout/src/lib/rating-words.ts`: `RATING_SHOWS_FIGURE_WITHOUT_BUILDER = true`, `ratingText` ("14 of 20 ·
  Good" or "Good"), `RatingSource` and `ratingSourceLine` ("Starting estimate. Not tested yet." / "From practice tests
  on Nov 14." / "From 12 tasks of real work."; the date through the person's formatter). Tested in
  `rating-words.test.ts`.
- `RatingKey` (new, server-safe, story and test): the four ramp swatches each beside "1–5 Poor" and so on.
- `SkillGrid`: the figure and the band word with Builder view off; accessible names and titles through `ratingText`; a
  row on its starting estimate carries the Estimate chip in both views and its hover reads "Starting estimate 10";
  `legend` draws the source line of the row set and `RatingKey` above the columns. `SKILL_GRID_FOOTER` rewritten.
  `SkillGrid.test.tsx`.
- `toSkillRows` sets `source` (`skillSource`): real work once the skill has live tasks, practice tests once a promoted
  run scored it (that run's day), else the starting estimate. Tested in `logic.test.ts`. The agent's Overview turns
  `legend` on.
- Team › Agents footer: "Rating is the average of the agent's skills, from 1 to 20. New agents start on an estimate."
  and `RatingKey`. The `potential` definition no longer says an agent near its ceiling is "better replaced than trained".
- DESIGN.md §8 and §9 no longer mark these as not built.
- `agent-profile.spec.ts`: the Skills panel says what its ratings are from, shows the figure out of 20 and carries one
  rating key.

## Decisions
- The source line and the key are drawn by `SkillGrid` behind a `legend` prop rather than in `OverviewTab`'s panel
  header: one place for both, and the landing page's grids (which do not pass it) are unchanged.
- A skill with neither a tested nor a proven rating keeps its "Untested" chip and gets no source line of its own; WP-10
  T8 renames that chip "Not tested yet".
- `RatingSource`'s `tested.on` is an ISO date, formatted where it is drawn, so the person's date format applies.

## Not done
- T8 (the skills picker and panel): `packages/modules/src/team/skills.tsx` is still in open pull request #255.
- Playwright ran locally only for the specs named in the pull request; CI runs the rest.
