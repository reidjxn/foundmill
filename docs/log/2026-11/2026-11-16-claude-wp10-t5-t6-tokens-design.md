---
date: 2026-11-16
branch: claude/wp10-t5-t6-tokens-design
title: Type, contrast and focus tokens; DESIGN.md amended for the thesis
areas: [dugout, api, web, docs]
supersedes: []
---
## What changed
WP-10 T5 and T6 (docs/holistic-plan/WP-10-console-and-design.md), one pull request as the package allows.

T5, tokens (`packages/dugout/src/tokens.css`, `controls.css`, `dugout.css`), each held by a new case in `tokens.test.ts`:
- Reading type 15/24/-0.006em → 16/26/0em.
- New `--line-control` (white 34 %) and `--line-control-hover` (42 %) on `field-well`, `check-box`, `radio-dot`,
  `switch-track`: at least 3 : 1 on the canvas and surfaces 1 to 3 (WCAG 1.4.11). Panels and buttons keep `line-strong`.
- `--status-bad` #f36066 → #f57a7f, `--status-info` #5e8eff → #7ba1ff: a pill's word reaches 4.5 : 1 on its own 12 %
  fill over surfaces 1 to 4 (sRGB blend, an Estimate of the browser's oklab mix). Their glows follow.
- `--rating-1` → `var(--status-bad)`. A pressed `chip-tone` draws its word in `text-1`.
- `--ring` 2 px at 80 % plus a 5 px halo at 18 %; `focus-ring` and `focus-within-ring` add
  `outline: 2px solid transparent; outline-offset: 2px`, so forced-colors mode draws them.
- New `@utility type-outer` (body 16/24, small 14/20, reading 17/28, label 14/20, action 15/20, title 16/22, chat
  16/24), put on `AppShell`'s phone root only.
- `ReassuranceLine` in `text-secondary`; `Field` renders the hint and the error together, and `aria-describedby` reads
  "<id>-hint <id>-error" (`Label.test.tsx` "an invalid field keeps its hint").
- `founder.profile.update`: a first profile save that leaves guidance on also sets `textSize: "comfortable"`. Existing
  accounts and later saves are unchanged; no migration (`founder-profile-guidance.test.ts`).
- `no-clip.spec.ts` gains a comfortable-text run at 1280 and 1440 (the helper now reads and restores any preference).

T6, `docs/DESIGN.md`: §1 replaced (founder decision 7, Nov 16, 2026, recorded in
docs/log/2026-11/2026-11-16-claude-wp12-founders-answers.md), with decision 3 noted as decided and not built; §2 non-text
contrast; §3 `line-control` and the ring; §4 reading 16/26, comfortable for new guided accounts, Outer type; §5 the lift
and one red; §6 the 8 px grid claim struck; §7 Continue's blocked state as the code has it since Nov 7; §8 by-stage
sidebar and top bar, Today's first-week pieces, `ReassuranceLine` in `text-2`, `RatingKey` and `SkillCard`; §9 the
rating rule; §10 two more engine → founder rows.

## Judgment calls
- Rules for pieces not built yet (T1 by-stage tabs, T2 top bar, T3 `EXPLAINERS`, T8 `SkillCard`, T9 `RatingKey` and
  the source line) are written in DESIGN.md as rules and each says "not yet in the code", so no line describes the
  product falsely. Decision 5 (a figure without Builder view) and 6 (streak days) are not written as decided.
- §8 Guidance: the package asked to replace `NextStep` with what WP-04 shipped on Today. WP-04 is still building, so
  the new line names what Today has now (`FirstWeekTimeline`, `GoalPanel`, `NeedsYouList`, `WeekPlan`,
  `StreakStrip`) and leaves the `NextStep` and checklist entries, which still render on Details.
- Not done from T6's file list: `docs/UX_AUDIT_AND_PLAN.md` "mark the three built items done" and `docs/GATES.md` "date
  the UX gates". Both would state a gate passed, and this change ran nothing that shows it.
- Not done from T5: step 6 (prune the story axe baseline). The baseline lives on the unmerged
  `claude/blissful-fermat-q03yq1` branch; main has no story axe run.
- The package says to record the §1 decision in docs/DECISIONS.md; that file is frozen (CLAUDE.md), so this entry is
  the record.
- The comfortable default overwrites a text size chosen before the first profile save only when that choice was
  `standard`, which cannot be told apart from the column default. Choosing it again in Preferences sticks.
