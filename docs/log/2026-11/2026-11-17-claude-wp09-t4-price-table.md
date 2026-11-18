---
date: 2026-11-17
branch: claude/wp09-models-batch-2
title: WP-09 T4 remainder, the price table is true (Sonnet cache reads, Haiku's long-prompt card)
areas: [models]
supersedes: []
---
## What changed
- `packages/models/src/pricing.ts`, with prices as of `PRICING_AS_OF = "2026-11-15"`:
  - Sonnet 5.5 cache reads cost $0.10 per million tokens (they were $0.20).
  - Haiku 5.5 gains `longPrompt`, the card for a prompt over 100,000 tokens: $0.50 in, $2.50 out, $0.625 cache write,
    $0.05 cache read. The prompt counts input plus cache reads plus cache writes, and the whole call is priced at the
    long card. The batch discount still applies.
- `pricing.test.ts` asserts the whole table and the 100,000 and 100,001 token boundary.

## Decisions
1. **The prompt that crosses the line is input plus cache reads plus cache writes,** as the task says. Its own check
   against the price page, "confirm on the price page what counts", is not done here: this session has no browser
   access, so the claude-api reference is the source.
2. **Haiku's route effort is not in this change.** That part of T4 needs the live evals of step 5, and none were run.

## Not done
- T4 steps 2 (route effort), 4 (pricing `costUSD` 0 in `SessionUsage.onResult`, which is in the reserved session.ts)
  and 5 (live evals).
