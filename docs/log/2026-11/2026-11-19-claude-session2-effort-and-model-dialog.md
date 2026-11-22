---
date: 2026-11-19
branch: claude/brave-carson-ov3mt4
title: Session 2 (models), effort written down for every route, sessions told their effort, and the model dialog by plan
areas: [models, orchestrator, api, dugout, web, modules]
supersedes: []
---
## What changed
- **WP-09 T6 step 1, effort for every route** (`packages/models/src/routing.ts`):
  - The nine routes with no `effort` now carry today's value, which is their model's API default: `medium` on `chiefOfStaff`, `departmentLead`, `codeReview`, `documentReview`, `skillGrader` and `coach` (Opus 5.5), `high` on `worker`, `journeyCommentary` and `nightlyBatch` (Sonnet 5.5).
  - `routing.test.ts` pins the table and asserts that only the six Haiku utility routes are without effort. `client.test.ts` and `client.stream.test.ts` assert `output_config.effort` on a `worker` and a `chiefOfStaff` request.
  - A new test in `packages/agents` checks that `ROUTE_DEFAULT_MODEL` equals the model of every route.
- **WP-09 T7 steps 1 and 2:**
  - `prepareSession` puts the route's effort on `SessionLaunch.effort`, and `sdk.query` passes `effort`. `session-live.test.ts` asserts it.
  - `tool-budget.test.ts` fails when a template's granted tool definitions pass 6,500 tokens (Estimate). Today's largest is `channel_geo` at 5,758, plus 10%, rounded up.
- **WP-13 T7, the model dialog:**
  - `agent.model.compare` returns `inUse` and, per option, `gate: "upgrade_or_own_key"`, plus a GLM-5.3 Flash option. `agent.model.set` refuses a gated model with the same code and keeps the stored choice (`apps/api/src/services/model-gate.ts`).
  - The dialogs in `apps/web` and `packages/modules`, and the Training › Model picker, gray Opus and Sonnet on the free plan and keep them selectable. Choosing one opens `BetterModelsPrompt` ("See plans", "Connect your Anthropic key", "Not now"). A stored Opus reads "After you upgrade" and the model in use reads "In use".
  - Tests: `agent-model-gate.test.ts`, `ModelPicker.test.tsx`, a story, and `e2e/free-plan-models.spec.ts`.

## Decisions
- **Free means `modelFundingFor` is `free_plan`.** An own Anthropic key (`byok`) and a paid plan are not gated. From the day sign-up opens (`PAID_ENTRY`), an owner's credit pack also unlocks Opus and Sonnet (WP-09 T16, `ownerBoughtPack`).
- **The dialog shows what the session runs on, not what the founder would wish.** `FREE_SESSION_MODEL` is `routed` by default since Nov 17, so a free agent stored on Opus runs on Opus on Foundmill's key, and the dialog says "In use: Opus". The rule is the orchestrator's `freeSessionModel`, copied into `modelGateFor`.
  If the founder wants a free team on GLM by default, that is the `FREE_SESSION_MODEL` switch, not this change.
- **GLM is set from the dialog only.** Plan steps and drafts still name Opus, Sonnet or Haiku (`CHOOSABLE_MODEL_KEYS` is unchanged). Setting GLM queues no retest, because a training run's calls go through the Anthropic client and GLM is served by Z.ai's endpoint for work sessions only (`changeAgentModels`).
- **A business on its own Anthropic key is not offered GLM.** The plan lets it have GLM on Foundmill's Z.ai key up to $5.00 of credits; that split is not built, so it is left out rather than half done.
- **The route effort follows the route when the credit saver moves it.** `worker` on Haiku 5.5 now sends `high` (Haiku's default is `medium`), as the planner already sends `low` on Sonnet. Only the credit saver and the free plan's Haiku routes (`journeyCommentary`) are affected, and they cost a little more thinking. If that shows in the cost report, lower those routes in the sweep.

## Checked, not redone
- WP-09 T5 (refusals and server fallback), T8 (batch client), T12 (overnight, founder D7 option B) and #314 (`FREE_PLAN_HAIKU_ROUTES`) are in the code with their tests green: `pnpm --filter @foundmill/models test` passes.
- WP-09 T4: the id, the price table and the long-prompt card are in and tested. **Not done, and left alone:** `effort: "low"` on the six Haiku routes (step 2, needs the live evals of step 5), the `costUSD` 0 pricing in `SessionUsage` for an Anthropic model (step 4: `pricedBySdk` still trusts the SDK's figure), and the live evals themselves.

## Not done
- **WP-09 T6 steps 2 to 5 (the sweep):** needs a live key and the founder's spend. No route changed level.
- **WP-09 T7 steps 3 to 6:** they need the cost report's production numbers (`maxTurns` by task kind, `taskBudget`), the founder's D2 (light task kinds on the saver's model) and a live check (`structuredContent`). Every session keeps `maxTurns` 60.
- **The squad table's model chip** still shows the stored model. Showing the model in use there needs the team list to carry it; the dialog does.
