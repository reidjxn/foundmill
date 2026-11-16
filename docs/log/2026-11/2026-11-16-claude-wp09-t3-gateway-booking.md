---
date: 2026-11-16
branch: claude/wp09-t3-gateway-booking
title: The gateway's model calls ask first and book the exact cost
areas: [models, connectors, agents, db, gateway, orchestrator]
supersedes: []
---
## What changed
**WP-09 T3 (A7-03, A7-17).** It has to merge before `web` goes into `LIVE_CONNECTORS` in production (WP-00 S6).
- **One platform client in the gateway, gated.** `buildGateway` builds a single platform model client, booked by
  `gatewayUsageSink` and wrapped by `gatePlatformModels` (`reader-models.ts`). That file now holds the six lines of
  the composer's `creditsGate`, so a call for a business with no credits left is refused before its request leaves
  (`credits_exhausted`, 402). `readerUsageSink` and `createReaderModelClient` are deleted. The reader the pipeline
  runs, the `quarantine.read_untrusted` reader and web search all use this client.
- **The pipeline's reader runs on the key that pays.** `readerClientFor` (builtins.ts), which used to be the inner
  `clientFor` of `createQuarantinedReader`, now serves both readers. A business on its own Anthropic key reads on that
  key with no credits check, and the row is billed `byok`. Every other business goes through the gated platform client.
  `createUntrustedReader` accepts either a client or a per-business client function.
- **Exact cost.** `gatewayUsageSink` passes `costMicroMinor`, so a 6,000-token Haiku digest books 600,000
  micro-cents (0.6 of a cent), not 1 cent. Rows also carry `pricingAsOf`, and a search row carries `webSearchFeeMinor`.
- **Web search moved into the model client.** `LiveModelClient.searchWeb` sends the request the web connector used to
  build itself. Its content is unchanged: `web_search_20260209`, `max_uses: 1`, `max_tokens` 2,048, effort `low`. It
  now goes through `send()`, so the limiter, the retry policy and billing refusals apply. The gated and mock clients
  implement it too. The web connector calls the injected `LiveConnectorOptions.searchWeb` and no longer imports
  `@anthropic-ai/sdk`. A failed search becomes a 503 vendor error the agent can read, and a refusal keeps its own code.
- **New route `webSearch`:** Sonnet, `lowCredits: "keep"`, effort `low`, budget `LOW_EFFORT_MAX_TOKENS`. It is in
  `routing.ts`, `routing.test.ts`, `ROUTE_KEYS` and `ROUTE_DEFAULT_MODEL` (packages/agents), and has a mock route
  (`mock/webSearch.ts`) that returns example.com addresses titled "mock".
- **Search fee.** `pricing.ts` gains `WEB_SEARCH_USD_PER_SEARCH = 0.01`, `WEB_SEARCH_PRICING_AS_OF = "2026-11-16"`
  and `meterWebSearch(usage, modelId, searches)`. A search books one `tokens` row on the `webSearch` route: its
  tokens plus 1 cent for each search the response counts in `usage.server_tool_use.web_search_requests`.
- **`sessionTokens` counts the session's own rows only** (`details->>'source' = 'claude-agent-sdk'`). A reader or
  search row booked under the session id no longer shrinks what `finishSession` books at the end.
- The report's `notMeasured` drops "The gateway's reader and web search are not booked (A7-03)".

Tests, written first. All 11 new cases failed on main (`client.search.test.ts` 5, `untrusted-reader.test.ts` 3,
`web-fetch.test.ts` 2, `session-budget.test.ts` 1):
- models `client.search.test.ts`: the request shape; one usage event carrying tokens plus the fee; an error result
  carries no fee and throws; a gate refusal sends no request; the mock is deterministic.
- `pricing.test.ts`: `meterWebSearch`.
- gateway `untrusted-reader.test.ts`, through `buildGateway` with `MODEL_MODE=live` and an injected `modelFetch`:
  - at zero credits the reader sends no request and the content is withheld with `READER_UNAVAILABLE`;
  - the 6,000-token digest books exactly 600,000 micro-cents;
  - a business on its own key reads on that key with no credits left, and the row is billed `byok`.
- gateway `web-fetch.test.ts`, live `search_web`: one `tokens` row on `webSearch` with the tokens plus the fee; at
  zero credits it is refused (`credits_exhausted`) before any request.
- orchestrator `session-budget.test.ts`: a reader row under the session id leaves `unbookedTokens` unchanged.
- Updated: the connector's own `web.test.ts` (an injected search in place of a faked Anthropic endpoint),
  `mock.test.ts`, `billing.test.ts` (its SDK rows now carry `source`) and `cost-report.test.ts`.
- `evals/src/sessions/harness.ts`: the fixture web connector now searches through a `LiveModelClient` over the same
  fixture fetch (`platformSearchWeb`). It still runs the real request code, now from its new home. Without this
  change, four session cases in `sessions.test.ts` failed.

## Decisions
- **The search fee is confirmed, not an Estimate guess.** It was read from Anthropic's pricing page
  (platform.claude.com/docs/en/about-claude/pricing, "Web search tool") on Nov 16, 2026: $10 per 1,000 searches, plus
  tokens, and "a web search that fails with an error is not billed". The `claude-api` skill (cached Nov 3, 2026) says
  the same. Like every price in `pricing.ts`, the booked figure is still labeled Estimate. The fee follows the count
  the response reports, and it is zero when the result is an error object.
- **A business on its own key:** the reader runs on the founder's key, billed `byok`, with no credits check (it is
  their money; `bookUsage` never charges credits for a `byok` row). Web search stays on the platform key and is
  charged to credits for every business, own key or not, as SEC2 decided for platform-key calls and as the spec says.
  So a business on its own key at zero credits can still read but cannot search until it tops up.
  `BYOK_KEY_CONNECTORS` stays unchanged, and `state.ts` changes only in a comment saying so.
- **Live search needs a live platform client.** `platformSearchWeb` returns nothing when the platform client is mock
  (no `ANTHROPIC_API_KEY`). Live `search_web` then says the platform key is missing instead of returning mock results
  marked live, as it did before. The connector's health check reads the same condition.
- **The spec against the code.** (1) The spec says to copy `creditsGate` into `reader-models.ts`. It is there, plus a
  two-line `gatePlatformModels` that picks `live` from the client's own mode, so a test's injected client is gated the
  same way. (2) `buildGateway` gains `modelFetch` (tests only), because no other seam lets a test drive a business's
  own-key client. The spec did not name it. (3) `BuildDepsOptions.models` was documented as the reader's client but
  only fed the built-ins. The pipeline's reader built its own client. It is now the one client for both.
- **Quantity unchanged.** Gateway rows still book `input + output` tokens as `quantity`. T1's `usageForLedger` changes
  every sink at once.
- **pipeline.ts untouched** (PR #214 edits it). The reader swap happens entirely in `index.ts` and `builtins.ts`.

## Not done
- `web.search_web` still declares `costMinor: () => WEB_SEARCH_COST_MINOR` (2 cents, an Estimate), so the pipeline's
  `tool` row says 2 cents next to the exact `tokens` row. Tool rows never charge credits (`chargesCredits`), so nothing
  is charged twice. A report that adds `tool` and `tokens` rows would count a search twice. Dropping the constant
  belongs with T1's ledger work.
- No live eval was run (D10). Nothing a model does changed: same request, same model as the `worker` route before.
- `web` is not added to `LIVE_CONNECTORS` here. That is WP-00 S6, after this merges.
- **The free-tier rule (founder, Nov 16, 2026): users who have not paid run on GLM-5.3 Flash, and Foundmill never pays
  Anthropic for a free user.** Another session builds that routing, and none of it is here. Until it lands, `searchWeb`
  must not run for a free user's business on Foundmill's account. Today it is Anthropic's server search on the
  platform key, and it books the cost to credits. T3 adds the credits check, but nothing yet stops a free project
  from using its included credits on it. **WP-00 S6 (adding `web` to `LIVE_CONNECTORS` in production) waits on this
  rule as well as on T3.** The models changes (`types.ts`, `client.ts`, `routing.ts`, `pricing.ts`) were kept to what
  the spec needs (one optional method, one route, one constant and one meter function), so the GLM session can build
  on them.

## Security review
The security reviewer found no blocking issue: no own-key leak or fallback, and the credits gate fails closed. Four low
findings were fixed in this change:
- `search_web` no longer books a 2-cent tool row next to the exact model row, so Payroll and the day's spend count a
  search once (`WEB_SEARCH_COST_MINOR` is gone).
- The gateway's `creditsGate` refuses a call that names no business (`forbidden`, 403) instead of running it ungated.
- In mock mode a business on its own key reads on the ungated simulated client, as it reads on its own key ungated
  when live (`ungatedMock`).
- A gated client whose inner client cannot search has no `searchWeb`, so live `search_web` reports the missing platform
  key instead of failing with a plain error.
Left: the ledger row of a search keeps the token prices' `pricingAsOf`; the fee's own date is the constant
`WEB_SEARCH_PRICING_AS_OF` in pricing.ts.
