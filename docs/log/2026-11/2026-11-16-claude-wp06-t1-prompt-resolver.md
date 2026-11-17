---
date: 2026-11-16
branch: claude/wp06-t1-prompt-resolver
title: One resolver, so an agent's skills and live version follow it into every call (WP-06 T1)
areas: [db, agents, api, orchestrator, evals]
supersedes: []
---
## What changed
- `resolveAgentPrompt(db, businessId, target)` in `packages/db/src/agent-prompt.ts` (exported from `@foundmill/db`).
  The target is `{ agentId }`, `{ templateKey }` or `{ channelKey }`. It returns the business's live agent of that
  role (oldest, not archived): its live version's instructions unless the version still follows the template, the
  template's role skills, then the library and file skills the agent carries. With no such agent it returns the
  template and its role skills (`agentId: null`). An `agentId` from another business is not found (404). The version
  and skill rules are the session's (`followsTemplate`, `loadContext` in `apps/orchestrator/src/activities/session.ts`).
- `AgentPromptParts` and `agentPromptFields(agent, template)` in `packages/agents/src/club-rules.ts`. Each builder's
  input gains an optional `agent` and renders through `agentPromptFields`: `FoundationsInputs` (`foundationsSystem`,
  so the project page, the one-call draft and the staged skeleton, sections and roadmap calls), `PageQuizFacts`,
  `PostDraftFacts` and `PostDraftFactsInput`, `ChannelCreativeInput`, `ResearchPlanInputs`, and both Source Watcher
  requests. The team call's `chiefOfStaff` gains `skills`. Without `agent` every builder renders exactly what it did
  before (each test compares with `buildSystemPrompt` on the template).
- Callers pass the resolver's result: `repos.foundations.inputs` (Product lead), `draftTeamPost` (social channel),
  `draftPageQuiz` (Product lead), `runResearchPlanLocally` (Product Researcher), `planContextFor` for the plan compiler
  and both team call requests (Chief of Staff), the cycle plan's `draftPlan` (Chief of Staff), the channel engine's
  creative step (the channel) and the Source Watcher's two calls (Product lead, read once per run and only when a model
  is asked).
- Tests: `packages/db/src/__tests__/agent-prompt.test.ts` (edited version 2 plus a library skill, no agent, another
  business, version 1 by the system, an archived agent, the foundations inputs); one case per builder in the agents
  tests (`agent-parts.fixtures.ts`); ten `builder` cases in `evals/src/skills/cases.ts`, asserted in
  `evals/src/__tests__/skills.test.ts` with a check that every builder has one.

## Decisions
- The rule, recorded here because docs/DECISIONS.md is frozen: **an agent's skills and live version follow it into
  every call made in its name.** This is what the founder's WP-06 D5 addition asks of prompts (an agent's attributes
  and prompt follow its current setup).
- Callers resolve by role (`templateKey` or `channelKey`), the template each builder already used, not by the agent the
  call is attributed to. The attributed agent can be another role (the foundations author falls back to the Chief of
  Staff, the research plan's to the Researcher or the Product lead); resolving by it would swap the Product lead's
  instructions for another role's. With two agents of one role the oldest is used, so a channel owned by a newer agent
  of the same role renders the older one's setup. The `{ agentId }` target exists for later tasks.
- The description stays the template's, as in the session (`live.template.description`).
- Spec versus code: the spec names `apps/api/src/services/team-call.ts` as "where `chiefOfStaff` is filled"; nothing
  filled it, so the team call always used the template. It is filled now. The spec puts the plan compiler's change in
  `plans.ts`; `compilePlan` has no database handle, so `PlanContext` gains `chiefOfStaff` and `planContextFor`
  (`decide.ts`) resolves it. That adds three small reads to every plan context, including a one-click option's that
  never calls the model; kept for one code path.
- The resolver lives in `packages/db` and imports `agentsRepo` and `skillsRepo` directly (not `repos`), so
  `repos/foundations.ts` can call it without an import cycle. `followsTemplate` is duplicated there (two lines) rather
  than moved, because `session.ts` is being edited by another task.
- No template these builders use carries a role skill (only the code agents have Design principles), so a business
  whose agents nobody edited gets byte-identical prompts.
- The evals' `turnInputFor` and `wrapUpInputFor` are exported so the skills cases reuse the team call's inputs.

## Not done
- `session.ts`, `training.ts` and `apps/orchestrator/src/activities/plan.ts` are untouched (another task edits
  session.ts; PR #216 edits plan.ts). The platform calls with no project agent (`showcase-script.ts`, `ideation.ts`,
  `community-screen.ts`, `second-read.ts`) are excluded, as the spec says.
- The step 5 eval cases were written after the builders gained `agent`, so they confirm rather than drive the change;
  the builder unit tests in step 3 were seen failing first.
- Whether a skill improves the output is T8.
