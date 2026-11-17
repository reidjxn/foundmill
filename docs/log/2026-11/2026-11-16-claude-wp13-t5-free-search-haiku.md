---
date: 2026-11-16
branch: claude/brave-ptolemy-5nq5wq
title: WP-13 T5, live web search on every plan (free plan on Haiku 5.5)
areas: [models, gateway]
supersedes: []
---
## What changed
- **`enforceModelFunding`** no longer refuses a free account's web search. It marks it `freePlan` like any other call, and the gate now passes that verdict to `searchWeb`.
- **`LiveModelClient.searchWeb`** resolves the `webSearch` route with `freePlan`, so a free account's search runs on Haiku 5.5.
  - The search is called directly (`allowed_callers: ["direct"]`) on Haiku: one search whose results are listed needs no code execution to filter them.
  - It is booked at Haiku's tokens plus the per-search fee ($10 per 1,000 searches).
- **The mock search** is priced the same way.
- **Tests:**
  - free, paid and own-key callers at the models gate;
  - the live request on Haiku with direct calls;
  - the gateway's live `web.search_web` for a free business and for a free business on its own key (search is a platform tool on Foundmill's key, charged to credits).

## Decisions
- **Founder, Nov 16, 2026:** live web search must work on every plan at launch, and the home page line saying agents cannot check facts on the live web is removed (#262).
  - This replaces the work package's T5 design (Z.ai's search API): Haiku 5.5 is on Anthropic's supported-models list for the web search tool (platform.claude.com web search tool page, read Nov 16), and the free plan already runs on Haiku 5.5.
- **What the agent's session runs on does not matter here.** A GLM-only choice still searches on Haiku 5.5 through the gateway.
- **A project on its own key** searches on the platform's key as before (WP-09 T3, SEC2), on the model its plan gives.
- **Estimates:**
  - A free search: about 3,000 tokens in and 120 out on Haiku 5.5 ($0.0004) plus the $0.01 fee, about $0.0104.
  - A paid search on Sonnet 5.5: about $0.017.
  - A first research session with 3 to 8 searches: $0.03 to $0.08 on the free plan.

## Not done
- The platform-wide $600 cap is T6. Until then a search is held only by the project's credits (the existing gate refuses at zero credits) and by the per-business rate limits.
- Production: WP-00 S6 appends `web` to `LIVE_CONNECTORS` on gateway, api and orchestrator, with `MODEL_MODE=live` on the gateway. Founder's go; nothing changed here.
