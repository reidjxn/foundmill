---
date: 2026-11-17
branch: claude/wp09-zero-credits
title: WP-09 T14, the money numbers are config, and the allowance waits for the data
areas: [config]
supersedes: []
---
## What changed
- New test `packages/config/src/__tests__/money-config.test.ts` (T14 step 1). It reads the sources and checks that
  every money number WP-09 added is exported once, from one config home, and declared nowhere else. The numbers are:
  - `FIRST_CYCLE_SESSION_CAP_MINOR`;
  - `TOP_UP_OPTIONS_MINOR`;
  - the entry plan (`ENTRY_PLAN`);
  - the packs (`CREDIT_PACKS_MINOR` and `CREDIT_PACK_CREDITS_MINOR`);
  - the two pre-commit ceilings (`PRECOMMIT_CEILING_DEFAULT_CENTS`, which the env schema uses as its defaults);
  - the overnight shift's ceiling (`OVERNIGHT_SHIFT.ownSpendCeilingMinor`);
  - the session floor (`MIN_SESSION_CAP_MINOR`, in apps/orchestrator's cycle contract).

## Decisions
1. **The test reads the files.** packages/config depends on no other package, so the test checks the declarations in
   the source text instead of importing shared or the orchestrator.
2. **The plan's and the packs' numbers are in the list too.** T16 added them after this task was written, and they are
   the same kind of number.

## Not done
- **Step 2, the allowance and Pro.** This decision entry is not written: it needs at least 30 projects and four weeks of
  T1's data, and there are not enough yet. `TIERS.pro.priceMonthly` and Pro's `includedCreditsMinor` stay "TBD" until
  the founder decides (D1, D8). The code already handles numbers there.
