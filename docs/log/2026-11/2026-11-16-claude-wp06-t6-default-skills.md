---
date: 2026-11-16
branch: claude/wp06-t6-default-skills
title: Default skills per role, at hire, at commit and by backfill
areas: [agents, db, api, gateway, orchestrator, dugout, web, evals]
supersedes: []
---
## What changed
WP-06 T6 (TS-04; founder, Nov 16, 2026: D3, D4, D6 call 3). Every role now comes with the library skills whose `default_for` names it. They are marked "Came with the role" and can be removed. Before this, no agent was hired with a skill for its role.

- **Catalog** (`packages/agents/src/skill-library.ts`): `DEFAULT_SKILLS_VERSION` (the highest `defaultSince` among defaults, 1 today) and `defaultSkillKeysFor(templateKey, sinceVersion?, library?)`. `support_desk` and `churn_prevention` now have `default_for: chief_of_staff` (D4), so the Chief of Staff comes with 7 skills.
- **Migration 0143** (`agent_skills.added_by` is `template`, `founder` or `chief_of_staff`; null for a rated template skill and for rows from before 0143. `agents.default_skills_version` defaults to 0). RLS is unchanged and `agent_skills` stays service-written.
- **`attachDefaultSkills`** (`packages/db/src/skill-attach.ts`) writes the definitions in one statement (`repos.skills.upsertAddedDefinitions`), then the untested rows (`repos.skills.addTemplateDefaults`; a skill the agent already has keeps its row), then the agent's release. `hireFromTemplate` and `hireMany` call it, so Recruitment, commit and the plan's `hire_agent` all attach defaults.
- **`attachAddedSkills`** takes `addedBy` as a new last parameter. It defaults to `"founder"`, and the gateway's `assign_skill` passes `"chief_of_staff"`.
- **Backfill** (`backfillDefaultSkills` in packages/db; `apps/api/src/services/default-skills-backfill.ts`, run at boot after the persona backfill and shaped and logged like it). It handles one business per transaction and locks the agents first. It skips archived agents and adds only defaults newer than each agent's `default_skills_version`, then sets the version.
- **Views.** `agent.skills.added` returns `addedBy`. `team.agents.catalogue` returns `defaultSkills: { key, name, whenToUse }[]` for WP-10's "Comes with". `ChosenSkillList` gains `cameWithRole`, which shows a "Came with the role" chip, and the Training tab's skills panel passes it.
- **Tests.**
  - New, failing without the change: `default-skills.test.ts` (agents: the limits, D4, the suppression check), `team.test.ts` (hire and `hireMany`), `rls/default-skills-backfill.test.ts` (backfill once, never re-adding a removed default, a later release, tenancy) and `rls/skill-library-files.test.ts` (the 0143 columns).
  - Also: `idea-commit.test.ts` (every agent of a `b2b_saas` commit has exactly its defaults; every code role has `coding_discipline`), `agent-skills.test.ts` (hire, catalogue, remove then backfill), `plan.test.ts` (`hire_agent`), `platform-skills.test.ts` (`chief_of_staff`).
  - Updated: `agent-skills.spec.ts` (a "Came with the role" row on the Training tab), the SkillPicker story and its test.
- **Evals.** `evals/src/skills/default-skills.ts` has six roles.
  - Offline (`default-skills.test.ts`): each case hires the agent on PGlite and checks that it carries exactly its role's defaults, and that the task's request offers `read_skill` with the right index line and no bodies.
  - Live (`default-skills.eval.test.ts`, skipped without a key): the first action must be `read_skill` with that key in 5 of 6 cases.

## Decisions
### Customer replies: both skills are Chief of Staff defaults
D4 gives customer replies to the Chief of Staff for now, and T3 left both skills as suggestions only. With the index, a default costs one index line in every prompt and its body loads only when a task calls for it. Seven skills stay far under the limits of 40 skills and 8,000 characters (tested for every template). So `support_desk` and `churn_prevention` are both defaults for the Chief of Staff.

### cold_email stays a default for Lead generation
`cold_email` tells the agent to run the suppression check. Lead generation is a channel engine, and every channel engine holds `suppression.check` and `consent.check` (`CHANNEL_PLATFORM_TOOLS`). A test now fails if a default skill that mentions the suppression check lands on a role without that grant.

### The backfill lives in packages/db, not in repos.skills
The spec named `repos.skills.backfillDefaultSkills`. It needs `attachDefaultSkills`, which imports `repos`, so it sits in `skill-attach.ts` next to that function. Its two queries are `repos.agents.businessesBehindOnDefaults` and `lockBehindOnDefaults`, which keeps `fm/no-raw-db` satisfied.

The spec's per-call `sinceVersion` became a per-agent `defaultSkillsVersion` on each target, because one business's agents can be on different releases.

### No default_since field in the front matter yet
Every skill is `defaultSince: 1` (the generator sets it). The first later release that adds a default should add an optional `default_since` line to the generator. Until then, a new `default_for` on an existing skill only reaches new hires, never agents already on release 1. That keeps the safe side of "never re-add a removed default".

### Rows from before 0143 stay null
Rows from before 0143 keep a null `added_by`. Audit rows say who added each one, but nothing reads them for this, and only the founder or the Chief of Staff could have added them. The UI shows the mark only for `template`.

### Default rows are written like any added skill
A default's row is untested, displayed at the template's baseline, and shows "Untested". This matches what founder-added skills do today. D5's "Not tested yet" in place of a number belongs to T9, which waits for T8's measuring run (see Not done).

### Tests about founder-added skills
Where the existing api tests counted founder-added skills, they now filter out the role's defaults, and the three limit tests hire `channel_paid_ads` (a role with no defaults) so only the skills a test adds count. The TS-12 case now removes the Backend Engineer's default `systematic_debugging` and adds it back, so the `improves` exception is still exercised.

### Security review fixes
A security review of the change found nothing blocking. Fixed in the same change:
- A skill picked in the hire dialog that the role already comes with would have made the hire fail with a 409. `team.agents.hire` now attaches only the picked skills the role does not already have.
- Removals made before 0143 would have come back, since every older agent starts at release 0. The backfill now skips any skill an `agent.skills.remove` audit row took off that agent (`repos.audit.removedSkills`).
- The backfill also skips a default whose name the agent already carries, and any that would take the agent past 40 skills or its index past 8,000 characters.
- The backfill writes one `agent.skills.add_defaults` audit row (actor `system`) per agent it gave skills to.
- `attachDefaultSkills` refuses agents that are not the business's own, because the agent_skills foreign key does not know tenants.
- Each business's backfill transaction sets `lock_timeout` to 5 seconds.
- A trigger (`fm_agents_default_skills_version_guard`, like 0082's speech-accent guard) stops an app role from setting or changing `default_skills_version`.
- The fixtures for the migration-point tests now insert agents by named columns.

### The release number is per skill, not per role
`defaultSince` belongs to the skill. Two cases need care when a later release adds a role to an existing default's `default_for`:
- If it also raises `defaultSince`, roles already listed would be offered the skill again. The removal guard catches removals that left an audit row, but not every case.
- If it leaves `defaultSince` alone, that role's older agents never get the skill.

The later release should record its release per role (for example `role@2`) when it adds `default_since` to the generator. Nothing changes until then.

### Ratings on agents with a training run (founder, Nov 17, 2026)
Defaults can land on an agent with a promoted run or a run awaiting a decision (the seed's Frontend Engineer; one real run has awaited a decision since Oct 22). Its other ratings were measured without those skills.

The founder agreed (about 7:12 PM UTC, Nov 17) with the recommendation: the backfill leaves those ratings alone and does not hold those agents' default skills back. T9's "Not tested yet" handles them later.

### Model note
The defaults are plain Markdown instructions, and nothing depends on the model key (Haiku 5.5, GLM or a paid model).

## Not done
- Ratings on agents with a promoted run or a run awaiting a decision are left as they are (the founder's decision above); T9, after T8's measuring run, shows them as measured values or "Not tested yet".
- WP-10 renders the catalogue's `defaultSkills` ("Comes with") and owns the picker's final look. The welcome note saying the team arrives with skills is WP-04's.
- Live sessions still list added skills by name until #255's held `session.ts` lines land (WP-06 T4's follow-up). Conversation, training and the T1 builders already use the index.
- The live eval was not run (no key here). The Playwright suite runs in CI; the full local run is noted in the pull request.
- Done-when 7 (production SQL after the backfill) can only be checked after deploy: `select count(*) from agent_skills where added_by = 'template'` per real project.
