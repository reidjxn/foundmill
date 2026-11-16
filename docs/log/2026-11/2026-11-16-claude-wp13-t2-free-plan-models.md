---
date: 2026-11-16
branch: claude/brave-ptolemy-5nq5wq
title: WP-13 T2, the free plan's models (Haiku 5.5 on our key, GLM for sessions) and the gate that enforces them
areas: [models, config, shared, db, api, orchestrator, design-system, web]
supersedes: []
---
## What changed
- `MODELS.haiku` is `claude-haiku-5-5` (WP-09 T4's model move, taken into WP-13 with the plan-execution session told).
  - $0.10 / $0.50 per 1M tokens, cache reads $0.01.
  - It thinks by default, takes `effort` and refuses `temperature`.
  - Haiku 4.5 joins `LISTED_UNROUTED_MODELS`.
- A fourth key, `glm` (`glm-5.3-flash`, $0.15 / $0.50, cache reads $0.03), with `MODEL_PROVIDER` and the Z.ai endpoint in
  `MODEL_ENDPOINTS`. Only free agent sessions will use it (T4).
- `resolveModel(route, override, { freePlan: true })` runs every route on Haiku 5.5, locked ones included, with no warning
  and no credit saver. `resolveModel(route, "glm")` does the same on GLM for a free session.
- `enforceModelFunding(client, fundingOf)` (packages/models `free-plan.ts`):
  - a paid plan runs as routed;
  - the free plan runs on Haiku 5.5;
  - a business on its own key, and free web search (until T5), are refused before anything is spent (`ModelNotFundedError`).

  It is built on the existing gate (`ModelCallVerdict.freePlan`).
- packages/config: `tierIsPaid` and `modelFundingFor` (own key, then a paid plan, else the free plan; signed out is free).
- `MODEL_KEYS` gains `glm`; `CHOOSABLE_MODEL_KEYS` is what an agent can be set to (no GLM: founder D3). The api refuses
  `glm` on `agent.model.set`, `saveDraft` and `estimate`, and the model compare and plan actions offer only choosable keys.
- Migration 0123 widens the four `model_key` checks (agents, agent versions, agent sessions, usage ledger) to `glm`.
- `ZAI_API_KEY` and `ZAI_MONTHLY_CAP_CENTS` (60000) in env and `.env.example`; nothing reads them until T4 and T6.
- Labels for `glm` where a record of every key is required (design-system tables and mocks, web and modules dialogs,
  training names).

## Decisions
- Founder, Nov 16 about 3:30 PM UTC: Haiku 5.5 before sign-up and for platform tasks; GLM for agent sessions only if a
  session costs about $0.019 with caching. Z.ai caching was tested the same day: automatic on a 12k-token prompt (12,032
  cached), none on a 2k one.
- No Z.ai model client in the services: nothing outside sessions runs on GLM, so the first design's routed client,
  bearer auth option and schema-in-prompt path were removed before commit (nothing speculative).
- The migration is 0123: main holds 0118 and open branches hold up to 0122 (renumbered on Nov 16 when the pull request opened).
- `enforceModelFunding` refuses own-key calls rather than serving them on our key. T3 decides per service what an own-key
  business gets until T11 routes the api's calls through the gateway.
- Haiku 5.5's routes run at the API's default effort (`medium`) where the route sets none; lowering it is WP-09 T6's
  measured sweep, not this change.

## Not done
- No service uses `enforceModelFunding` yet (T3), so behavior changes only through Haiku 5.5 itself.
- Haiku 5.5's live evals (WP-09 T4's suites) run in T8.
