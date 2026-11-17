---
date: 2026-11-17
branch: claude/brave-ptolemy-5nq5wq
title: WP-13 T11, the api and the composer run on a founder's own Anthropic key
areas: [gateway, models, api, composer]
supersedes: []
---
## What changed
- **The gateway's `POST /v1/models/anthropic/:businessId/v1/messages`** (`model-proxy.ts`), for `svc: api` and `svc: composer`:
  - it checks the business is on `byok` with a key that loads, else 409 `own_key_missing` and no call;
  - it accepts only Foundmill's routed Claude models;
  - it puts the founder's key on the request and forwards it to Anthropic's Messages API, streaming the answer back.

  The key is never logged or echoed. Limited per business at 120 a minute and 5,000 a day.

  After a security review of this change, the route also:
  - checks its own tokens: a composer token must be signed with the new `COMPOSER_SERVICE_TOKEN_SECRET` (the shared secret is held by every service), an api token passes the api's rule, and either must name the business in the path (`businessId` claim);
  - refuses `mcp_servers`, `container`, server tools and any beta but fast mode, and forwards the body it parsed;
  - ends the call when the caller hangs up, or after 10 minutes;
  - answers a vault failure with 503, not "no key".
- **packages/models `own-key-route.ts`:**
  - `ownKeyViaGateway` gives one live client per business, whose Messages endpoint is that route, signed with a service token and carrying no key;
  - `routeOwnKeyCalls` sends a call there when its business is on its own key, and every other call, web search included, to the platform client;
  - a 401 or 403 reads as `OWN_KEY_REFUSED` and the 409 as `OWN_KEY_MISSING`, never a fallback to Foundmill's key or to GLM.
- **The api** (`createApiModelClient`, `context.ts`): in live mode an own-key business's calls take that route, booked `byok`, signed as the api's other gateway calls.
  - Every procedure calls `ctx.models`, so every call site in the work package's list takes it: desk, team calls, goal proposal, plan compiler, task graph, research, recommenders, logo, page quiz, post drafts and the agent builder.
  - `toTRPCError` maps the two sentences to PRECONDITION_FAILED.
- **The composer** (`composerModelClient`, `index.ts`): the same for the Inbox notes, founder titles, journey commentary and chapter notes. It signs `svc: composer` per business with its own `COMPOSER_SERVICE_TOKEN_SECRET` (HS256 with `node:crypto`, the claims the gateway checks), so no JWT dependency was added. Without that secret its own-key calls run as the plan says.
- **Tests:**
  - gateway `model-proxy.test.ts`: answered on the founder's key; credits, no key, wrong service and unrouted models refused with no call; the key in no log;
  - models `own-key-route.test.ts`: routing, `byok` booking, both refusal sentences, and a structured stream delivering cards one by one through the route;
  - api `own-key-calls.test.ts`: the real database ledger shows `byok`, and a refused key is PRECONDITION_FAILED;
  - composer `free-plan.test.ts`: the note through the route, other businesses on the platform, and the token's shape.

## Decisions
- **A narrow proxy of Anthropic's Messages endpoint, not the work package's `/v1/models/complete` and `/stream` with a request body.** A request carries a Zod schema, which cannot cross the network. With the proxy, the caller keeps its schema, repair retry, streaming and metering unchanged, and the gateway stays the only process holding the key.
- **No audit row per call.** The usage ledger records each one, and the key route keeps its own audit.
- **Web search stays on the platform key** for an own-key project, as WP-13 T5 decided.
- **Mock model mode is unchanged:** an own-key business there runs as its plan says, since no real key is used.

## Not done
- **Production:** a new secret, `COMPOSER_SERVICE_TOKEN_SECRET` (32+ characters, the same on the composer and the gateway), plus `GATEWAY_URL` on the composer. Until both are set, an own-key project's composer notes run on Foundmill's key as the plan says.
- **From the review, left open:**
  - Where the gateway is not configured, the api and the composer fall back to the plan's route instead of refusing in staging and production.
  - The composer's own HTTP routes are unauthenticated. That predates this change, but such a call now spends a founder's own key.
  - The 31 call sites that set `attribution.businessId` were spot-checked, not audited; a wrong one would now spend a founder's money.
- **The rest of T8** (the platform suites on Haiku 5.5) spends money on live evals, so it waits for a go.
