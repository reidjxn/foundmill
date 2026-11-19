---
date: 2026-11-16
branch: claude/wp09-zero-credits
title: "Zero credits: what stopped, what still works, and a way on that works on this server (WP-09 T13 steps 1–5)"
areas: [db, api, composer, gateway, orchestrator, web, config, shared]
supersedes: []
---
## What changed
- `topUpsOnSale(env)` (packages/shared): the platform's billing is live, or simulated payments are allowed.
- `waysToContinue({ topUps, nextCreditsOn, ownKey })` (packages/db billing.ts) builds the one sentence of ways on:
  - credits, named first and only where `topUps` is true;
  - the founder's own Anthropic key, unless the business already runs on one;
  - the date next month's credits arrive.
- That sentence is used in:
  - the 402 refusal (`assertPlatformCredits`, all three branches);
  - the zero-credits Inbox note and the own-key note;
  - the resume refusal (`resumeBlocker`);
  - Settings › Billing at zero (`billing.plan` → `atZero`).

  `CreditsCheckOptions.topUps` and `bookUsage(…, { topUps })` default to false.
- The api, composer, gateway and orchestrator pass `topUps: topUpsOnSale(env)` to their gates and sinks.
- The note also says what stopped (`CREDITS_ZERO_STOPPED`) and what still works with no model call
  (`CREDITS_ZERO_STILL_WORKS`): reading, editing and publishing the page by hand, and answering a note with one of its
  options. `credits-ceiling.test.ts` runs each of these at zero credits, and checks that a conversation send gets 402.
- A session's zero-credits summary is `creditsUsedUpSummary(topUps)`. `budgetSummary("credits")` now reuses it instead
  of holding a second copy of the text.
- `TOP_UP_OPTIONS_MINOR` moves to packages/config: $5, $10, $25 and $50 (founder D4). The Billing tab's default
  amount is $10.

## Decisions
- **session.ts is reserved**, so its two uses of `CREDITS_USED_UP_SUMMARY` keep the constant. The constant is now
  `creditsUsedUpSummary(false)`: it names the own key and next month's credits, never a top-up, until session.ts can
  pass the flag.
- The copy names no model. On the free plan, credits buy more of the same work (founder, Nov 16), so the top-up copy
  never says it unlocks anything.
- Sentences outside the package's list still name a top-up on every server:
  - the Autopilot "paused for credits" detail (packages/shared autopilot.ts);
  - the agents-stopped email (notify-words.ts);
  - two web helpers (`credits-notice.ts`, `agents-stopped.ts`).
  They are not refusals, and none of them has the server's env at hand. They are listed for a follow-up.
- Commit's own `creditsUsedUp` (a second project that starts with nothing included) keeps the default, so it names no
  top-up.

## Not done
- Step 6 waits for setup S8 (Stripe). Until then the mock checkout passes, as before.
- No Playwright case for the zero state: no seeded business is at zero. The api test reads the same `atZero` lines
  that the tab shows.
