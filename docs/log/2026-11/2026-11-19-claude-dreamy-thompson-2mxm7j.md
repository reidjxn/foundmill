---
date: 2026-11-19
branch: claude/dreamy-thompson-2mxm7j
title: The console by stage; Explain this page on every first landing; definitions for the first words; the ask before the evidence
areas: [web, api, dugout, shared, modules, docs]
supersedes: []
---
## What changed
Launch Session 6 (docs/holistic-plan/LAUNCH_EVALUATION.md), WP-10 T1 to T4 and T10, in one branch to keep CI to one run.

T1, tabs and sidebar by stage. `packages/shared/src/areas.ts` gains `StageFacts`, `TAB_REVEAL`, `TEAM_CALL_REVEAL` and
`tabRevealed`; `areaTabsByArea` drops a hidden tab before the promotion rule runs, and ignores the stage in Builder view.
`business.get` returns `stageFacts` (`stageFactsFor`, six reads in the existing parallel batch; a demo business reports
every stage reached and two people). `buildSidebarItems`, `areaNav`, `useAreaNav` and `BusinessShell` pass it through.
A fresh project lists Today, Needs you, Plan, Customers, Product, Team, Network, Settings, Sign out (nine), with at most
8 inline tabs and 6 behind "More detail". A hidden tab still opens by URL; search is unchanged.

T2, top bar by stage. `KitBar` and `AppShell` take `showRunway` and `showMode` (default true); `RunwayChip` takes
`dateOnly`. `topBarChips` in `BusinessShell` decides: runway words once a bank is connected or a payment has arrived, the
mode chip once a round of work finished or the mode left "augmented". Stop all agents is untouched. The mode chip stays
on vacation. Story "Week one".

T3, Explain this page. `packages/modules/src/explainers.ts` holds `EXPLAINERS` (every default tab, Needs you, Details,
Team call, Milestones, Contacts, and each Settings tab); the older per-screen constants are re-exported, not rewritten.
New copy for roadmap, specification, leads, campaigns, runway, compliance, environments and the surfaces above.
`DepartmentScreen` mounts the seven tab explainers that have no screen of their own (`HOST_MOUNTED`); the other screens
mount theirs. The phone title row now draws the button wherever a screen registered one (the `phoneExplain` prop is gone).

T4, definitions. Fifteen new ids in `terms.ts` (goal, round_of_work, note, needs_you, continue, public_page, follower,
project, cofounder, collaborator, spend_line, go_ahead, decision, builder_view, ai_usage), all plain tier. First
occurrences are wrapped in Needs you, Goal, the Inbox empty states, People, Preferences, Billing, the public page
explainer and the follower panel; the mode chip's tooltip carries the spend line (a chip is a button, so no Term inside).
`churn`, `integration` and `runway_horizon` had no caller and are removed. `terms-used.test.ts` fails on an unused id.

T10, the ask before the evidence. `DecisionLead` (story, test) renders above the note while guidance is on, the decision is
open and one option is recommended: "<Agent> suggests: ...", the filled recommended button, the others, "Not sure? Ask".
It calls the same `onChoose` as the sticky bar. The body follows under "Why". The deadline reads "If you do nothing by
Nov 20, <agent> waits." (`decisionDeadline` now takes the agent name and the person's date formatter).

## Decisions
### Host-mounted explainers
Seven tabs share one mount in `DepartmentScreen` instead of seven edits in screens with several return branches
(loading, error, empty). The list `HOST_MOUNTED` says which; the unit test holds that every default tab has copy.

### Six definitions with no screen
`conversion`, `pipeline`, `contacts`, `sku`, `product_lead` and `policy` also have no caller (the plan found three). They
stay: the palette's Help group and the Composer read every id. `terms-used.test.ts` lists them as debt and fails when one
is used or a new id has none.

### Streak strip
None of the fifteen ids names a word in `StreakStrip`, so it is unchanged. Open question 6 on the streak is the founder's.

### stageFacts for a new project
A fresh project reports all false except `people: 1`. The API test checks the shape, a refusal for another business's
member, and the true values on a fixture; the all-false case is the sidebar and shared tests (the harness has no bare business).

## Not done
- Settings › Integrations is Session 5b's: only its explainer copy is here, mounted by `SettingsScreen`.
- STATUS.md is Session 1's. Not merged.
- Playwright for `inbox.spec.ts` and `areas.spec.ts` ran as noted in the pull request; the full suite is CI's.
