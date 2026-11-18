---
date: 2026-11-17
branch: claude/wp09-models-batch-2
title: WP-09 T5, refusals are handled once, and Opus and Sonnet calls fall back on the server
areas: [models, api, orchestrator]
supersedes: []
---
## What changed
- **packages/models.**
  - Every Opus and Sonnet request goes to the beta endpoint with `SERVER_FALLBACK_BETA`
    (`server-side-fallback-2026-07-01`) and `fallbacks: "default"`, alone or beside the fast-mode beta. Haiku carries
    neither: Haiku 5.5 has no server-side fallback.
  - The response's top-level `model` says who served it. A fallback model's usage is metered at its own card
    (`priceForServed`: Claude Opus 5 and Opus 4.8 at $5/$25, Sonnet 5 at $2/$10, Estimate). The usage event and the
    result carry `servedModel`. An id with no price here is metered at the requested model's card and flagged
    `unpriced`.
  - `complete()` throws `ModelOutputError("refusal")` on a refusal with or without a schema, unless the call sets
    `allowRefusal`.
- **apps/api.** `toTRPCError` maps a refusal through `modelRefusalAppError`: code `model_refused`, 422, "The model
  declined this request. Reword it and try again."
- **apps/orchestrator.** A training candidate's refusal scores that test 0, and the grader is not called.

## Decisions
1. **Only the returned message's usage is booked at the served model's price.** The per-attempt `usage.iterations`
   entries are not booked here: the skill's local reference names them, but not their field names, and the task says
   not to guess. A declined-before-output attempt's billing depends on its category.
2. **Sessions pass no SDK `fallbackModel`.** It is for overload, not refusals, and a model switch restarts the cache.
   Nothing in apps/orchestrator passes one: the `fallbackModelId` in session.ts is the price fallback of the cost
   meter.
3. **The fallback prices' cache figures follow the usual ratios** (a write at 1.25x input, a read at 0.1x input). The
   price page was not fetched in this session.
4. **A founder's own key falls back too (rebase onto WP-13 T11, Nov 18, 2026).** The gateway's own-key route
   (`apps/gateway/src/model-proxy.ts`) accepted only the fast-mode beta. Every Opus or Sonnet call on a founder's
   key now carries the fallback beta, so the route refused all of them with 400. It now accepts fast mode and the
   server-side fallback, alone or together, and forwards the list it was given. The fallback serves another Claude
   model on the same key, so nothing reaches outside the founder's own Anthropic account.

## Not done
- The live smoke of one ordinary Opus call with the beta on, inside D10: no live calls in this session. It is needed
  before merge, to prove the request is accepted.
- The five usage sinks do not copy `servedModel` into the ledger row's details yet; the event carries it.
