---
date: 2026-11-16
branch: claude/brave-ptolemy-5nq5wq
title: WP-13 T3, every service's model calls choose by who pays (Haiku 5.5 for the free plan)
areas: [db, api, composer, gateway, orchestrator, models]
supersedes: []
---
## What changed
- packages/db `modelFundingOf` and `cachedModelFundingOf` (30 s):
  - who pays for a call is read from its business's plan and billing, else the person's best owned plan (`businessAllowance`), else signed out (free);
  - `ownKeyServed` says whether the calling service can use a business's own key.
- `UsageAttribution.userId`. The pre-commit call sites pass it: Ideation's four calls, Import, Ask, compare and the logo before commit.
- Each service's platform client is wrapped with `enforceModelFunding`:
  - the api's process-wide client (`createApiModelClient`);
  - the composer's (`composerModelClient`, new);
  - the gateway's readers and search (`gatePlatformModels`);
  - the orchestrator's platform fallback inside `createBusinessModelClient`.
- The idea box reserves its daily ceiling at the free plan's model price (signed-out visitors are free).

## Decisions
- **An own-key business in the api and composer** runs as its plan says (a free one on Haiku 5.5 on our key) until T11 routes those calls to its own key through the gateway. The orchestrator and gateway readers already use the own key.
- **A free business's web search through the gateway** is refused ("Web search is not available on the free plan yet.") until T5. WP-00 S6 keeps search off in production meanwhile.
- **Tests that pinned a free business on a Claude model** now expect Haiku 5.5 (conversation, logo), or put the business on `pro` (the low-credits saver, live web search). The free-plan behavior has its own tests.
  - Haiku 5.5's sub-cent cost made a credits test read whole cents plus the carry.
  - The idea box tests count the cards a one-cent ceiling buys instead of assuming one.
- **Agent sessions are not changed here:** `session.ts` is held for the acceptance-check fix. A free business's sessions move in T4 (GLM, or Haiku 5.5 if a session costs more than $0.019).

## Not done
- T4, the sessions.
- T11, own keys for the api and composer.
- T5, free search.
- Pushed only after #250 merges (GitHub Actions is refusing jobs at the moment; CI rule).
