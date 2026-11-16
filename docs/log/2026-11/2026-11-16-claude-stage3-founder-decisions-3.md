---
date: 2026-11-16
branch: claude/wp04-t8-note-budget
title: A top-up buys more GLM work; the free-tier cap and when checkout comes back
areas: [models, api, web]
supersedes: []
---
## What changed
Three more founder answers on Nov 16, 2026, which follow
docs/log/2026-11/2026-11-16-claude-stage3-founder-decisions-2.md (free users run on GLM-5.3 Flash). They are recorded
here because docs/DECISIONS.md is frozen.

## Decisions
- **A credit top-up on the free plan buys more GLM work only.** Only a paid plan unlocks Anthropic models on the
  platform key. WP-09 D4's top-up copy names no better models; the upgrade copy may.
- The platform GLM key has a monthly cap of **$600**. At the cap, free AI slows down and queues until the month resets.
  The session "Free open source LLM for pre-purchase" builds this as WP-13.
- Until a paid plan can be bought, everyone without their own Anthropic key is on GLM.
- **Pro checkout (WP-09 T16, setup S8) waits** until GLM is wired up and working, then is revisited.

## Not done
- WP-13 (the GLM implementation), on branch claude/brave-ptolemy-5nq5wq, in the other session.
