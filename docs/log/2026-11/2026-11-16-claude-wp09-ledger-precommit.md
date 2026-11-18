---
date: 2026-11-16
branch: claude/wp09-ledger-detail
title: The ledger keeps the cache figures, and calls before a project are booked and capped per account (WP-09 T1 steps 1–3 and 5, T2)
areas: [models, db, api, composer, gateway, orchestrator]
supersedes: []
---
## What changed
- `usageForLedger(usage)` in packages/models is the one definition of a ledger row's token figures: `quantity` counts
  input, output and both cache figures, and `details.tokens` keeps each. The api, composer, gateway and orchestrator
  sinks use it (the gateway's reader books through `gatewayUsageSink` since T3, so there are four sinks, not five).
- Migration 0138: `agent_sessions` gains `route`, `effort`, `num_turns`, `cache_read_tokens`, `cache_write_tokens`
  (`EndSessionInput` accepts them); new table `account_usage` (RLS on, no policy, service role select and insert only;
  `currency` and `updated_at` added for the structural invariants).
- The nine call sites a signed-in person reaches without a business pass `attribution.userId`. `apiUsageSink` books a
  live one to `account_usage` at its exact cost (mock books nothing); `apiCreditsGate` refuses the next one at
  `PRECOMMIT_DAILY_CEILING_CENTS` (200) over 24 hours or `PRECOMMIT_MONTHLY_CEILING_CENTS` (500) over 30 days
  (`precommit_ceiling`, 429), before the call is noted, so the request's allowance comes back. Defaults in
  `PRECOMMIT_CEILING_DEFAULT_CENTS` (packages/shared env.ts), founder's D3.
- The cost report gains `cacheShareByRoute` (Appendix B query 7), `firstWeekPerProject`, `rounds`, route, effort and
  turn percentiles on `sessionsByModelAndOutcome`, `preCommitPerProject` and `ideaBox`; the CLI prints "no data" for an
  empty block. `firstDayPerProject` now starts at `coalesce(committed_at, created_at)`, as the package asks.

## Decisions
- **T1 step 4 is not in this change.** It edits `apps/orchestrator/src/activities/session.ts`, which is reserved for
  other sessions today. Until it ships, the five session columns stay empty and the report says so in `notMeasured`.
- T1 and T2 share one migration and one pull request, since both change the same sink file and the report.
- `rounds` uses the cost `cycle.completed` already carries (`payload.cost`, USD cents), not a sum of ledger rows
  between events; `perAllowance` divides the free plan's `includedCreditsMinor` by the median.
- `account_usage.model_key` allows `glm` from the start (WP-13's request; its #250 adds the key to `MODEL_KEYS`).
- `ideaBox` is the one report query without the demo filter: an idea box card has no project.
- Security review (security-reviewer agent): no bypass found. Accepted and recorded: a failed `account_usage` write
  is logged and that call goes uncounted; separate requests fired together can each pass the same sum (bounded by the
  drafting allowances, as the package's Risks accept); deleting an account deletes its rows; a person who already has
  a project still drafts under these ceilings and reads the same sentence ("Take charge of one of your ideas").

## Not done
- T1 step 4 (session.ts) and step 6 (the production run, needs the founder).
