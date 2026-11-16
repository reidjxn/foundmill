---
date: 2026-11-16
branch: claude/wp06-t12-honesty-copy
title: Recruitment and Training stop saying an agent drafts or proposes what fixed code produces
areas: [modules, web]
supersedes: []
---
## What changed
WP-06 T12 (TS-08). The Recruitment builder matches the founder's words to the closest template, and the Training
Focus edits come from fixed code (`apps/web/components/agents/logic.ts`). No agent drafts or proposes either, so the
copy now says what really happens.

- `packages/modules/src/team/RecruitmentScreen.tsx`: explainer `purpose` "Hire new agents: describe the work to find
  the closest role, or pick one from the catalog."; `action` "... press Find the closest role; ..."; panel title
  "Agent builder" → "Find a role"; button "Draft this agent" → "Find the closest role" (its test id `draft-agent`
  stays).
- `apps/web/components/agents/TrainingTab.tsx` (the two strings only): the Focus line "Each comes with suggested
  instruction edits, with the expected gain."; the heading "Coach proposals" → "Suggested edits" (the Coach `Term`
  is gone from that heading; the test id `coach-proposals` stays).
- `packages/modules/src/team/skills.tsx`, left open by T7: the library dialog's description and the hire dialog's
  Skills step said a skill shows "untested until a training run scores it". Library and file skills carry no tests,
  so a training run reports them as "No tests yet" and never scores them. Both now say the agent reads a skill when a
  task calls for it, in T7's words, and keep the line that a skill never changes tools, autonomy or spend caps.
- Tests: `recruitment.test.tsx` pins "Find the closest role" and no "draft" on the button;
  `team-development.spec.ts` checks the button and that the Recruitment screen no longer says "Draft this agent" or
  "Agent builder"; `agent-profile.spec.ts` opens Training › Focus and checks "Suggested edits" and no Coach wording.

## Decisions
- **The spec's strings matched the code** (lines 99, 100, 253, 274; TrainingTab 322, 328), so they went in as written.
- **The skills dialog lines are in scope.** T7 left the dialog's description for T12. It claims a training run scores
  the skill, which fixed code never does for a library or file skill, so it got the same fix as T7's toast. The hire
  dialog's Skills step (same file, Recruitment) said the same thing and got the same sentence.
- **Untouched on purpose:** the empty state "Choose a focus skill to see proposals." names no one; code comments
  (`TrainingTab.tsx:4`, `logic.ts:352`, `agent-builder.ts`) and the API doc comment at `apps/api/src/routers/agent.ts:482`
  are not user-facing. TrainingTab gets WP-13 model-name edits next, so the change there stays at the two strings.

## Not done
- A model-backed agent builder and a wired Coach stay under Not now (WP-06); the copy can change again if they ship.
- No eval and no story: no agent behavior or component changed.
