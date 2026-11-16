---
date: 2026-11-16
branch: claude/brave-ptolemy-5nq5wq
title: WP-13, the free plan runs on GLM-5.3 Flash (the plan)
areas: [docs]
supersedes: []
---
## What changed
Added docs/holistic-plan/WP-13-free-plan-on-glm.md, the work package for the founder's rule of Nov 16, 2026
(recorded in 2026-11-16-claude-stage3-founder-decisions-2.md, reidjxn/foundmill#219): everyone who has not paid for a
plan runs on GLM-5.3 Flash through Z.ai, Foundmill's Anthropic key is never used for them, and a paid plan or the
founder's own Anthropic key reaches Anthropic. No code changed.

## Decisions
- GLM-5.3 Flash over self-hosting Qwen3.8-27B: at 20,000 users a month, about $435 against $2,000 to $4,400 rented or
  $16,000 to $20,000 of hardware (Estimates, research of Nov 15 and 16).
- Split agreed with the plan-execution session: this package owns the GLM work end to end; WP-09 keeps the money side
  and holds T2, T4, T5, T8 and the D2 moves until WP-13 T2 merges. WP-09 T15 ("no fourth model key") is superseded.
- A credit top-up does not unlock Anthropic models; only a paid plan does (founder, Nov 16).
- Founder-confirmed: Z.ai's own API, a $600 monthly cap, slow down and queue at the cap.

## Not done
- The founder's decisions D1 to D6 in the package and the setup steps Z1 to Z4 are open.
- STATUS.md rows are added when the package is approved.
