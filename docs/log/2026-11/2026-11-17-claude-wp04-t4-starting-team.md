---
date: 2026-11-17
branch: claude/wp04-t2-commit-name-go
title: The starting team, as shown (WP-04 T4)
areas: [shared, agents, api, dugout, web, modules, e2e, docs]
supersedes: []
---
## What changed
- Founder's decision 2 as confirmed: commit still hires everyone the archetype seed lists; a new project is shown three.
- `STARTING_TEAM_TEMPLATE_KEYS` (`chief_of_staff`, `product_lead`, `researcher`) and `startingTeam(agents)` → `{ starting, later }` live in `packages/shared/src/starting-team.ts`; `packages/agents/src/archetypes.ts` re-exports both. `archetypes.test.ts`: b2b_saas splits 3 and 24, and every key is hired by all seven seeds.
- Commit's default view says the team in one line above the credits (`starting-team-line`): "Your starting team: Chief of Staff, Product Lead and Researcher. {n} more join as the work needs them." (`startingTeamLine`, exported). Names only: no model or wage.
- Inside More options, the Day one panel lists the three starters through a new dugout component, `StartingTeamList` (firstrun group, test and story "Guidance/Starting team" at 390 and 1440 px, Builder view, nobody waiting). Everyone else waits behind a ghost "See everyone" (`aria-expanded`). Model chips show only in Builder view, as the wage line already did.
- `welcomeNote` input drops `agents` and `departments`. Its line "The team is hired: {n} agents in {m} departments." becomes "The team is hired."; the rest of the note is unchanged (T7 rewrites it). `idea-commit.test.ts` asserts no head count.
- Team › Agents (`SquadScreen`): while `today.get.firstWeek` is not null, the table shows the starting agents plus any agent with a current task (`firstWeekAgents`), with "Showing who is working this week" and a ghost "Show all {n}" above it.
  Test ids `squad-first-week` and `squad-show-all`. The panel's caption keeps the full counts; background helpers keep their line. Saved views (`SIMPLE_VIEW_ID`) are untouched. Two tests in `squad.test.tsx`.
- e2e: `commit.spec.ts` checks the line at 390 and 1440 and the three-then-everyone list; `first-days.spec.ts` opens Team › Agents after commit and finds at most 5 agent rows (specialists opened) before "Show all", and more than 5 behind it.
- docs/DESIGN.md: the Commit bullet names the line and "See everyone".

## Decisions
### The constant lives in packages/shared, re-exported from agents (code over spec)
The spec puts it in `archetypes.ts`. Neither apps/web nor packages/modules depends on `@foundmill/agents` (it carries every template and prompt), and both need the list. It is in `@foundmill/shared` and `archetypes.ts` re-exports it, so the spec's import still works and there is one list.
### The Commit line counts the agents a founder would later see
"{n} more" counts `later` after `visibleAgents`: background helpers never appear on a list, so they do not "join". For b2b_saas the agents test splits the full 27 as 3 and 24; the Commit line reads 19 more.
### The welcome note keeps "The team is hired."
The input loses the counts, so the sentence that used them loses them too; nothing else in the note changes (T7 owns its words).
### The Agents tab narrows with the tree it already draws
The first-week rows go through the same `teamTree`, so a starter whose lead is not shown falls under the Chief of Staff, as the tree already does for a missing lead. A reader without Today, or a read still loading, sees everyone.
Once "Show all" is pressed the view stays open until the page is left. The step reads `today.get` as the spec says; `business.firstWeek.get` would have been a lighter read.
### No WP-10 pull request edits SquadScreen
Checked the open pull requests on Nov 17, 2026 (#265 is WP-10's; it does not touch the file), so step 3 is done here. #234 edits `archetypes.ts` elsewhere in the file.

## Not done
- `features.liveMode` is not read by T4.
- The Agents tab's other views (Hierarchy, Health) still show everyone; the spec names only the default view.
