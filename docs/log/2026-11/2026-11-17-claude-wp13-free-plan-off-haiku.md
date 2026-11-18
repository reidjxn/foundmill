---
date: 2026-11-17
branch: claude/brave-ptolemy-5nq5wq
title: WP-13, the free plan's readers, agents and notes leave Haiku 5.5
areas: [models, orchestrator, shared]
supersedes: []
---
## What changed
- **`FREE_PLAN_HAIKU_ROUTES`** (`packages/models/src/routing.ts`): `resolveModel(..., { freePlan: true })` runs only these routes on Haiku 5.5:
  - ideation, the idea slate, the logo, founder titles, the goal proposal, the project page, journey commentary, moderation and web search.

  Every other route keeps its own model for an account not on a paid plan: the readers, every agent route, the conversations, the composer's notes, the planner and plan compiler, the team calls, the reviews, and the linker, classifier and categoriser. No warning and no credit saver apply.
- **`FREE_SESSION_MODEL`** gains `routed`, now the default: a free business's agent session runs on the agent's own model. `haiku` and `glm` can still be chosen, and an agent set to Haiku 5.5 or GLM keeps that choice.
- **Tests:** routing (every route, and the readers and agents named), the funding gate, and the composer's notes and commentary.

## Decisions
- **Why:** the T8 run of Nov 17 (`2026-11-17-claude-wp13-t8-free-plan-results`) found Haiku 5.5 short of the injection bar:
  - the injection suite blocked 9 of 18;
  - the typed-read suite blocked 3 of 5;
  - conversation injection blocked 2 of 7.

  The leaking step is the agent's plan downstream of the reader, which runs in sessions and in the api's and composer's agent routes. So the change covers those routes, not only the readers.
- **An allow-list, not a deny-list:** a route added later stays on its own model for a free account until someone adds it here with its eval passing.
- **Two of the allowed routes read untrusted content:**
  - moderation, a classifier with no tools, which passed;
  - web search, which returns titles and addresses only, then read through the reader.
- **Founder, Nov 18, 2026, 10:25 UTC** (relayed by the coordinating session):
  - yes to option 1 as widened here: readers, agents, conversations, notes and planners off Haiku 5.5 for free accounts, Foundmill paying the difference;
  - foundations and the foundations skeleton come off the list too (the staged drafting passed 0 of 5 on Haiku 5.5).

## Not done
- **Production:** `FREE_SESSION_MODEL` must be unset or `routed` on the orchestrator, or an explicit `haiku` keeps free sessions on Haiku 5.5.
- **Moving routes back to Haiku 5.5** takes prompt work scoped to it, plus each suite passing again.
