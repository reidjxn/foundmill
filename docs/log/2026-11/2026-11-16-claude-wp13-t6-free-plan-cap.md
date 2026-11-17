---
date: 2026-11-16
branch: claude/brave-ptolemy-5nq5wq
title: WP-13 T6, the free plan's $600 monthly cap
areas: [db, models, api, composer, gateway, orchestrator]
supersedes: []
---
## What changed
- **`packages/db` `free-plan-cap.ts`:** the month's free-plan spend and its state.
  - Spend: credits-billed `usage_ledger` rows of free-plan businesses since the first of the UTC month, plus `idea_drafts.cost_micro` (everything before sign-up and commit). The query lives in `repos/free-plan-spend.ts`.
  - States: `open` below 80% of the cap, `slow` from 80%, `held` at 100%. Cached for 60 s per process.
  - The held message (founder, Nov 17, 2026): "Foundmill's included AI is used up for this month! It is back on Dec 1. To keep going now, connect your own Anthropic key."
- **`enforceModelFunding(client, fundingOf, { freeCap })`:** a free call at the cap is refused with `ModelNotFundedError` (reason `free_cap`) before anything is spent. A paid plan and a founder's own key are never held.
- **Wired into every platform client:** the api, the composer, the gateway's reader models and search, and the orchestrator's per-business client.
- **The api:**
  - `toTRPCError` maps `free_cap` to TOO_MANY_REQUESTS with the held message, and `own_key_route` to PRECONDITION_FAILED.
  - `modelLimited` gives a free request a quarter of its usual allowances in the slow band (`freePlanSlowCheck`). A scaled window never drops below 1.
- **Env:** `ZAI_MONTHLY_CAP_CENTS` is renamed `FREE_PLAN_MONTHLY_CAP_CENTS` (default 60000): the cap covers Haiku 5.5 and GLM together. Nothing read the old name.
- **Tests:** db (spend, states, cache), models (held, slow, paid and own key at the cap), api (the held refusal and the slow allowance).

## Decisions
- **Founder, Nov 16, 2026:** the cap covers all free-plan spend, Haiku 5.5, GLM and search together. At 80% free use slows to a quarter of its limits; at 100% it holds until the month turns. Never Anthropic for free work beyond Haiku 5.5, and never no model at all (D5): a founder can always connect their own key.
- **Founder, Nov 17, 2026: two sentences, never mixed up.** The platform cap's sentence is built here. A person whose own credits ran out reads "You've used all your included AI! It is back on Dec 1. To keep going now, connect your own Anthropic key." That one is WP-09 T13's screen, and is never shown to a person with credits left.
- **The $600 counts list-price Estimates from the usage ledger,** plus idea drafts and free searches, by UTC calendar month (not contradicted by the founder, Nov 17).
- **Spend is read from the ledger, not from the vendors' bills.** It is an Estimate at list prices, the same figure the credits are charged at, so the cap and the credits agree.
- **An unreadable spend slows nobody.** The slow band is a courtesy; the hold at 100% still reads the ledger on each call (through the 60 s cache).

## Not done
- Agent sessions that wait while the cap is held, and slow down in the slow band: with T4 (session.ts), after WP-07 T3 merges.
- `account_usage` (WP-09 T2) joins the sum when it lands.
- `/health` does not report the cap's state yet.
