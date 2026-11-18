---
date: 2026-11-18
branch: claude/wp10-t8-skill-picker
title: The skills picker's look, and an agent's learned skills on Overview
areas: [dugout, modules, web]
supersedes: []
---
## What changed
WP-10 T8, after WP-06 T4 (#255) and T7 (#243) gave the picker its data: suggestions with reasons, a skill's text on
request, what it is better with.

- `packages/dugout/src/components/agents/SkillCard.tsx` (new, story with each state and "Library with 120 skills",
  test): one skill as a row in four states. Available and selected have a checkbox. Unavailable shows its reason in place
  of the description at full opacity (it was `opacity-60`). Added has Remove, named "Remove <skill>". Each row shows
  "Shows as …", the suggestion's reason, "Not tested yet" or "14 of 20" when given, what it is better with, an `effect`
  line when WP-06 passes one, and a Read toggle (`aria-pressed`). The shared type and helpers (`LibrarySkillOption`,
  `SkillNeeds`, `showsAsLabel`, the connector labels) moved here; `SkillPicker` re-exports them.
- `SkillLibraryList` is rebuilt on `SkillCard`:
  - single-select category chips with counts ("Suggested", "All", then each category);
  - a `role="status"` count line ("3 skills match “pricing”");
  - `VirtualList` above 50 rows;
  - optional `suggested`, `category`/`onCategoryChange`, `previewKey`/`onPreview`, `preview` and `previewEmpty` props;
    every existing prop still works.

  With suggestions it opens on "Suggested", without them on "All". With `preview` it draws two panes.
- `SkillReader` works as the right-hand pane: `onBack` is optional (no Back button and no focus jump without it), and it
  shows "Adds to <group> · <attribute>", the heading "What <agent> will do" and "It never changes tools, spend limits or
  approvals."
- `SkillLibraryDialog` (`packages/modules/src/team/skills.tsx`): two panes in the same `lg` dialog, Read toggling the
  pane, the new description, and "<name> has 8 skills. Remove one to add another." at the cap.
- `AddedSkillsPanel` moved from Training to Overview, under the Skills panel. Its title is "Skills <name> has learned";
  its action is "Add a skill"; a menu holds "Upload a skill file" and "Write your own" (a link to Training, where
  Custom skills stay). The toast is "<name> will use it from the next task. Not tested yet." The empty state is "Teach
  <name> a kind of work: release notes, a pricing page, a first email. Add a skill to see what it says."
- "Untested" (`ChosenSkillList`, the skill grid's note from `toSkillRows`) and `TrainingResults`' "No tests yet" read
  "Not tested yet", DESIGN §10's founder word.
- Tests:
  - `SkillCard.test.tsx` and new `SkillPicker.test.tsx` cases: a chip filters, Suggested is first when given, no
    Suggested group without it, the pane keeps the search, virtualization above 50, the reader's lines.
  - modules `skills.test.tsx`: choosing a row shows what the skill says.
  - `agent-profile.spec.ts`: from Overview, a library skill is added in at most three presses.
  - `agent-skills.spec.ts` follows the move and the pane.

## Decisions
- The preview pane shows WP-06's whole text (`SkillReader`), not T8's "first 12 lines": the founder asked on Nov 16,
  2026 that a person can read a skill's text in the product, and T7 built that. T8's three lines are added to it.
- Read is a toggle in the pane instead of a Back button: the list never leaves, so there is nothing to go back to.
- The visible button label is "Read" (the accessible name stays "Read the skill: <name>") so a row fits half the `lg`
  dialog.
- `SkillCard`'s "added" state is built and tested, but the Overview panel keeps `ChosenSkillList`: `agent.skills.added`
  returns no attribute or category, so a card there would need an api change T8 does not ask for.
- "Write your own" links to Training rather than opening a dialog: Custom skills (with their test review) stay on
  Training, as T8 says.

## Not done
- The Coach report's prose in `apps/orchestrator/src/activities/training.ts` still says "No tests yet for …"; it is agent
  output, outside T8's files.
- WP-06 passes no `effect` yet, so the line is not drawn anywhere today.
