---
date: 2026-11-17
branch: claude/wp09-credit-markup
title: Credits are charged at cost plus 30% on the platform's keys (founder, Nov 17)
areas: [config, db, orchestrator]
supersedes: []
---
## What changed
- `packages/config`:
  - `CREDIT_MARKUP = 0.3`;
  - `chargedMinor(trueCost)`, what a call charges against credits;
  - `costCoveredMinor(credits)`, how much true cost the credits left pay for.
- `bookUsage` (packages/db) charges credits at cost plus the markup. The usage ledger row keeps the true cost.
- Where credits left become a spend limit measured at cost, they are converted with `costCoveredMinor`, so a session
  cannot spend past what its credits cover. The three places:
  - the Agent SDK's `maxBudgetUsd` (session-credits.ts);
  - a session's bound (session-budget.ts);
  - Autopilot's credits ceiling (`loadAutopilotFacts`).
- The cost report's `byRoute` shows `usd` (true cost) and `usdCharged` (what the platform-key calls charged against
  credits).
- Tests:
  - billing-markup.test.ts covers 1.3x on credits, the ledger keeping true cost, and no charge on an own key.
  - cost-report.test.ts covers the charged column.
  - The suites about the charge's own mechanics (billing.test.ts, repos/orchestration.test.ts) book with
    `markup: 0`, since their amounts are stated at cost.

## Decisions
1. **The founder's decisions of Nov 17, 2026, about 17:50 UTC, relayed by the coordinator:**
   - The markup is cost plus 30% from day one, on every plan and pack, including the invited testers and the included
     monthly budgets.
   - A founder's own key is not marked up: the vendor bills them.
   - Packs expire after 12 months, as main has it (`CREDIT_LOT_MONTHS = 12`).
2. **True cost stays true.** The free plan's $600 platform cap (`freePlanSpendRepo`, WP-13) and the cost report sum
   `usage_ledger.cost_micro_minor`, which keeps the true cost, so both still measure what the calls cost. Only the credit
   charge is marked up.
3. **`bookUsage` takes a `markup` option** only for tests of the charge's mechanics. Production callers never pass it.
4. **The overnight shift's ceiling, the first-round cap and the day's spend ceilings stay at cost.** They cap what work
   costs, not what it charges. A founder's credits now cover about 1/1.3 of their face value in true cost; figures of
   what credits buy stay labeled Estimate.

## Not done
- The WP-14 money session uses `chargedMinor` for T1's reserve and T3's "about N outcomes" (told on Nov 17).
