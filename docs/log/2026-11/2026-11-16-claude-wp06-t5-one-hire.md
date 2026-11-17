---
date: 2026-11-16
branch: claude/wp06-t5-one-hire
title: One hire implementation
areas: [db, api, orchestrator]
supersedes: []
---
## What changed
WP-06 T5 (TS-14). Hiring an agent from a template now has one implementation, `packages/db/src/hire.ts`
(`hireFromTemplate`, `hireMany`, `HireOptions`, `HiredAgent`, `PlannedHire`, exported from `@foundmill/db`). The code
moved from `apps/api/src/services/squad.ts` with its signatures unchanged; `squad.ts` keeps `shownToolGrants` (it needs
`@foundmill/connectors`, which packages/db does not depend on) and re-exports the five names, so `commit.ts` and the
team router are untouched. The two functions now share the template-to-row mapping and the baseline skill rows instead
of writing them out twice.

The plan's `hire_agent` action (`apps/orchestrator/src/activities/plan.ts`) dropped its own copy and its
`skillGroupFor` regex. It now does what Recruitment's `team.agents.hire` does, in one transaction: `hireFromTemplate`,
the department's lead (when live) as line manager, a `department_members` row, and an audit row `team.agents.hire` with
`actorKind: "agent"` (the action's agent, else the Chief of Staff) and `details: { templateKey, departmentId,
planActionId }`. The plan executor's own `plan.action.hire_agent` audit row is still written after it, as before.
`grep -rn "repos.agents.create(" apps` finds no hire outside `hire.ts`.

Tests: `packages/db/src/__tests__/repos/team.test.ts` (the rows `hireFromTemplate` writes; `hireMany` writes the same
rows, with a line manager chosen inside the batch) and `apps/orchestrator/src/__tests__/plan.test.ts` (`hire_agent` into
a department: membership, the lead as line manager, wage cap in USD, the same `agent_skills` rows as Recruitment, the
agent-attributed audit row). Both failed before the change.

## Decisions
Where the two copies differed, the shared (Recruitment and commit) behavior was kept, which is also the stricter or the
correct one in each case. What a plan's hire writes changes in these ways:
- **Wage cap currency.** The plan wrote the business's currency (or the action's `currency`) next to the template's
  wage cap, which is a US-dollar amount: a GBP project got "£" on a dollar cap. A wage cap caps metered model cost, so
  it is in US dollars (0024, 0025); the plan's hire now leaves the currency to that default like the others.
- **First version's author.** The plan did not pass `createdByKind`, so version 1 was recorded as `"user"`; it is now
  `"system"` like every other template hire.
- **Negotiation and schedule.** The plan left them empty; they now come from the template.
- **Avatar seed.** The plan seeded the avatar with a fresh random id (which was not even the agent's id); it now uses
  `${businessId}:${templateKey}` like Recruitment and commit. Two hires of the same template therefore share an avatar
  seed on every path, as they already did in Recruitment; the persona key still differs per agent.
- **Skill group.** The plan derived it from a regex over the key, the shared code from the skill definition. They
  agree on all 663 template skill slots today (checked with a one-off script), so no stored row changes.
- **Archived department.** The plan's hire is now refused for an archived department, with Recruitment's reason; an
  unknown or another business's department fails the action as before.
- **Name.** The plan's 80-character cut of a planned name is kept (`team.agents.hire` refuses longer names at input).
- Spec versus code: the spec named `plan.ts:511-521`; the copy was at 514-524. Nothing else disagreed.

## Not done
- Default skills at hire (T6) are not attached yet; this change only gives them one place to go.
- The demo seeds keep their own `hireFromTemplate` in `packages/db/src/seed/squad.ts`: it writes through the seed
  context for deterministic ids and is not an `apps` hire, so it was left as it is.
