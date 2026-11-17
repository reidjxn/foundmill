---
date: 2026-11-16
branch: claude/brave-ptolemy-5nq5wq
title: WP-13 T4, a free business's agent sessions run on Haiku 5.5 or GLM-5.3 Flash
areas: [orchestrator, shared]
supersedes: []
---
## What changed
- **`prepareSession`** reads who pays (`modelFundingFor`). A business not on a paid plan runs its session on `freeSessionModel`:
  - the agent's own choice when it is Haiku 5.5 or GLM-5.3 Flash (founder, Nov 16);
  - else the new `FREE_SESSION_MODEL` setting (default `haiku`);
  - GLM only with `ZAI_API_KEY` set.

  The launch says `freePlan`. The credit saver does not apply on the free plan.
- **A GLM session** runs on Foundmill's Z.ai key. `sdkEnvFor` takes an `endpoint`:
  - `ANTHROPIC_BASE_URL` is set to Z.ai, overriding the host's;
  - the key goes in `ANTHROPIC_AUTH_TOKEN` (bearer), never in `ANTHROPIC_API_KEY`;
  - every model slot the SDK reads is set to GLM;
  - a sandbox env may set none of these.
- **Cost and budget:**
  - The session's cost is metered at Foundmill's price for GLM, not the SDK's `costUSD`.
  - The SDK gets no `maxBudgetUsd` for a GLM session. The runner stops it at the same line from its own metered total, after every assistant message and on every tick (new ending `task_budget`, reported as the budget).
- **The month's free-plan cap (T6, #283) reaches sessions:** while it is held, a free session on the platform key does not start. It ends blocked on the budget, as when credits run out, so the task waits, and its summary is the founder's sentence ("Foundmill's included AI is used up for this month! …"). Added on Nov 17 after T6 merged.
- **A free session refuses "Upgrade to Opus"** mid-session, with a note that Claude models come with a paid plan or the founder's own key.

## Decisions
- **The Claude Agent SDK runs on Z.ai's compatible endpoint** (one live run, Nov 16): `glm-5.3-flash` in init and in every message, success, no errors.
  - The SDK priced it with `costBasis: "unknown"` at Opus-class rates: $0.00181 for 292 in and 14 out, against $0.00005 at GLM's price.
  - Hence Foundmill meters the cost and stops at the budget itself.
- **`FREE_SESSION_MODEL` stays `haiku`, and the founder decides the switch.** T8's live run (Nov 17, `2026-11-17-claude-wp13-t8-glm-session-cost`) measured GLM at $0.0068 a session on average, under the $0.019 condition. Haiku 5.5's Estimate from the same tokens is about $0.004 to $0.005. Only the orchestrator service reads the setting.
- **The slow band reaches sessions through the api only.** A founder's own start of a task (`dev.tasks.start`) spends the `session` allowance, which drops to a quarter from 80% (T6). Sessions the team starts on its own (cycles, Autopilot) are not slowed; the hold at 100% stops them all.
- **Tests that covered a paid plan's sessions** (the credit saver, Upgrade to Opus, launch facts) put their business on `pro`. The free-plan sessions have their own tests.

## Not done
- T7, letting a founder set an agent to GLM. Until then the api refuses `glm` as an agent's model, so the agent-choice branch is reached only through `FREE_SESSION_MODEL`.
