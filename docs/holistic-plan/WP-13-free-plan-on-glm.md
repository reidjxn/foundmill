# WP-13: The free plan: Haiku 5.5, and GLM-5.3 Flash for agent sessions

**Goal:** Everyone who has not paid for a plan runs on the cheapest models that hold quality: Haiku 5.5 on Foundmill's Anthropic key for everything before sign-up and every platform task, and GLM-5.3 Flash through Z.ai for agent sessions while a measured session costs at most $0.019. A paid plan, or the founder's own Anthropic key, reaches every model.

## Founder's answers of Nov 17, 2026 (relayed by the coordination session)

- **Privacy policy (T9, #260):** read; the founder confirmed Z.ai's terms cover the transfer clauses.
- **`ZAI_API_KEY`:** pasted on the orchestrator service in Railway. Both spend alerts (Z.ai and Anthropic) are set.
- **T8 live evals:** go-ahead for one run, $2 to $5 in total.
- **The 80% slow-down** to a quarter of the usual limits is confirmed. **How the $600 is counted** (list-price Estimates from the usage ledger, plus idea drafts and free searches, by UTC month) stands.
- **The message at the cap:** the founder's wording is "You've used all your included AI! It is back on Dec 1. To keep going now, connect your own Anthropic key." The coordination session is asking whether it fits the platform-wide cap, which a person can reach having used little of their own. T6's pull request waits for that answer.
- **Sign-up and the free plan (design note, no code yet):** sign-up will not open publicly with a free plan. Today's free plan stays while sign-up is invite-only, with the founder paying for test users' AI. When sign-up opens, the free plan becomes $5 a month with credits addable; a person can still use the idea box, their profile, the Ideation Studio, take charge and see their project, but subscribes before the first AI run (Continue). From then on "free plan" in this work package means "before paying". Code reads "the plan the person is on", never a hard-coded "free". WP-09 writes the record and the copy list.

## Revision of Nov 16, 2026, about 3:30 PM UTC (founder): read this first

The price comparison of OpenAI, Mistral, Anthropic and Z.ai (session `Free open source LLM for pre-purchase`) found that Haiku 5.5 ($0.10 / $0.50 per 1M tokens, cache reads $0.01) costs as little as GLM-5.3 Flash. Z.ai showed no cache reads on short prompts. The founder then decided:

- **Before sign-up and every platform task** run on **Haiku 5.5, on Foundmill's Anthropic key**, for every account not on a paid plan. That covers the idea box, Ideation, Inbox notes, desk replies, titles, readers, cycles and foundations.
  - It relaxes the earlier rule that Foundmill never pays Anthropic for a free account: a free account gets only Haiku 5.5 on our key.
- **Agent sessions** of a free account run on **GLM-5.3 Flash via Z.ai**, but only if caching works and a session costs about $0.019.
  - Caching was tested the same day and works automatically on long prompts: 12,032 of 12,044 tokens were read from cache on a repeat, with or without `cache_control`.
  - At Z.ai's prices that puts a typical session (300k input, 80% cached, 5k output) at about $0.019 (Estimate).
  - T4 measures a real session before T10. If it costs more, free sessions run on Haiku 5.5 instead (about $0.011, Estimate).
- A credit top-up still does not unlock the paid models; only a paid plan does.

What this changes below:
- **T2 is narrower.** There is no Z.ai model client in the services. `enforceModelFunding` wraps the client on Foundmill's Anthropic key, and runs a free account's calls on Haiku 5.5 (`ResolveOptions.freePlan`). It also refuses calls that belong on the founder's own key, and free web search (until T5).
- **WP-09 T4 is taken into T2.** `MODELS.haiku` is `claude-haiku-5-5`, with its price and capabilities: it thinks by default, takes `effort`, and refuses `temperature`. Its evals (linker, classifier, moderation, founder titles, the injection suites) move to T8.
- **T3 wraps every service's platform client with `enforceModelFunding`.** The Z.ai client is not used there.
- **T4 is the only place GLM runs**, and it carries the $0.019 gate.
- **D5 is moot:** the readers run on Haiku 5.5, and the injection suites must pass on it (T8).
- **T9:** the privacy policy names Z.ai for agent work only.
- **T6, answered by the founder the same day:** the $600 monthly cap covers all free-plan spend, Haiku 5.5 and GLM together.
- **Free-plan model choice, founder the same day:** on the free plan the founder chooses, per agent, between Haiku 5.5 and GLM-5.3 Flash. This replaces D3's "GLM is not chosen per agent".
  - Opus and Sonnet stay visible, slightly grayed, with the upgrade prompt.
  - The choice is the model the agent's work sessions run on. Platform tasks stay on Haiku 5.5.
  - A new free agent starts on the default above: GLM if a measured session costs at most $0.019, else Haiku 5.5.
  - An agent's stored Opus or Sonnet choice is kept for after an upgrade, and runs on the free default meanwhile.
  - T7 builds the picker and the server check on which keys each plan may choose. T4 runs the session on the chosen model.
  - Until both land, the api keeps refusing `glm` as an agent's model (`CHOOSABLE_MODEL_KEYS`).
  - **A paid plan chooses any model for any agent, GLM-5.3 Flash included** (founder, Nov 16, 2026, relayed by the session "Foundmill build status and blockers": "paid users can pick it too, paid users can pick any model we have for any of their agents"). T7's server check: free plan Haiku 5.5 or GLM; paid plan every key; own key every Claude model on that key, and GLM on Foundmill's Z.ai key up to the month's $5.00 of included credits, more only with credits the founder adds (founder, Nov 16, 2026, in this session).
- **Order (founder, same message, relayed):** Stripe and the Pro checkout are set up once GLM and model switching work; sign-up opens when everything works.

The sections below were written for the first design (GLM for everything). Where they disagree with this revision, this revision wins. Each task's own pull request records what it actually did.

**Why:** The founder's rule of Nov 16, 2026 (docs/log/2026-11/2026-11-16-claude-stage3-founder-decisions-2.md, reidjxn/foundmill#219), from the research in session `Free open source LLM for pre-purchase`:
- Before payment means the landing page and idea box, Ideation and every call before commit, and all agent work a free project does with its $5.00 of included credits.
- Anthropic models stay visible in the model picker, slightly grayed. Choosing one asks the founder to upgrade or to connect their own Anthropic key.
- A free founder may connect their own Anthropic key and use Anthropic models on it. Foundmill never pays Anthropic on their behalf.
- A credit top-up does not unlock Anthropic: only a paid plan does. A top-up on the free plan buys more GLM work.
- Calls go through Z.ai's own API. The platform's monthly spend on it is capped at $600. At the cap, free AI slows down and queues until the month resets. Paid projects and projects on their own key are unaffected.
- Until a paid plan can be bought (WP-09 T16, after this package), everyone without their own Anthropic key is on GLM.

Why GLM-5.3 Flash: MIT license, Arena about 1476 (third among open models on Nov 1, 2026), $0.15 per 1M tokens in and $0.50 out. For 20,000 users a month at about 15 calls each, about $435 a month (Estimate). Self-hosting Qwen3.8-27B costs more below about 90,000 users a month.

**Done when** (each is a check someone can run):
1. **Invariant test** `packages/models/src/__tests__/platform-anthropic-guard.test.ts` and `apps/api/src/__tests__/free-plan-provider.test.ts`. They drive every model call site named in T3 with a recording Anthropic client and a recording Z.ai client, for three accounts:
   - a free project with no own key: Z.ai only, and the Anthropic platform client is never called (the guard throws if it is);
   - a free project on its own key: Anthropic on the founder's key, booked `byok`;
   - a project on `pro`: Anthropic on the platform key.
   The signed-out idea box, an account with no project, and an account whose only paid project is someone else's get Z.ai.
2. A live agent session of a free project in `MODEL_MODE=live` runs on `glm-5.3-flash` end to end. It uses tools through the gateway, books its cost at GLM prices, and stops at its budget (T4).
3. A free founder's `search_web` uses Z.ai's Web Search API through the gateway and books its fee. A paid project's still uses Anthropic's server search (T5).
4. Once the month's platform GLM spend is past `ZAI_MONTHLY_CAP_CENTS` (60000), free calls are slowed and agent sessions wait, while paid and own-key projects run as before. Tested with a fake spend total (T6).
5. On a free project with no own key, the model dialog shows GLM-5.3 Flash as the model in use. The Anthropic models are slightly grayed out. Choosing one opens the prompt with "See plans" and "Connect your Anthropic key". Covered by a Storybook story and a Playwright spec (T7).
6. The evals named in T8 pass live on GLM-5.3 Flash. Where one does not, the task's fallback is in place and the shortfall is written in the log.
7. The privacy policy names Z.ai, its country and the transfer safeguard. The training sentence on line 107 is true for every provider it names (T9).
8. A free founder on their own Anthropic key gets Anthropic models, on their key, for every call the api and composer make for their project (T11).
9. `INTEGRATIONS_MODE=mock` and `MODEL_MODE=mock` still run the golden path.

**Scope, in:**
- a second model provider (Z.ai's Anthropic-compatible endpoint) and its capabilities, in packages/models;
- the GLM model key, id and price, and the migration that widens the model-key check constraints;
- choosing the provider by plan and funding, in one place;
- a server guard on Foundmill's Anthropic key;
- every call site in api, composer, gateway and orchestrator, including the signed-out idea box and the Agent SDK sessions;
- free web search;
- the platform's monthly cap and the slow-down;
- the model picker's grayed state and prompt;
- the evals on GLM;
- the privacy policy lines;
- the env and setup.

**Scope, out:**
- a plan checkout and Stripe (WP-09 T16, WP-00 S8: the founder will look at them again after this package);
- top-up amounts and copy (WP-09 T13, D4), except that no copy may say a top-up unlocks better models;
- per-account ceilings before commit (WP-09 T2: it builds on this package's migration);
- Haiku 5.5, refusals and fallbacks, batches, effort sweeps on Anthropic routes (WP-09 T4 to T8);
- how Billing looks (WP-10);
- a fifth provider;
- self-hosting.

**Depends on:**
- WP-09 T3 (`claude/wp09-t3-gateway-booking`), which changes `packages/models` `types.ts`, `client.ts`, `gate.ts`, `routing.ts` and `pricing.ts`, the gateway's reader clients and the web connector. T2 onward builds on it once it has merged.
- WP-05 T15 (`claude/wp05-t15-cap-floor`) is editing `apps/orchestrator/src/activities/session.ts`. Ask the plan-execution session before T4 touches it.

**Collides with:**
- WP-09 T2, T4, T5 and T8 and the D2 moves are held by the plan-execution session until this package's T2 merges.
- WP-11 on `apps/gateway/src/app.ts` (not touched here).
- WP-10 on `apps/web/components/settings/BillingTab.tsx` (not touched here).

**Setup it needs:**
- **Z1, Z.ai account (founder): done Nov 16.**
  - an API account at z.ai under Foundmill's company, paid by card;
  - an account-side spend limit or alert, if Z.ai offers one, as the backstop behind T6;
  - one key for production and one for evals.
- **Z2, the key on services (Desktop, after T2 merges):**
  - `ZAI_API_KEY` on api, composer, gateway and orchestrator;
  - `ZAI_BASE_URL` left at its default;
  - `ZAI_MONTHLY_CAP_CENTS` = 60000.

  The key is a secret: Railway variables only, never in the repo.
- **Z3, legal (founder):**
  - confirm in writing, through Z.ai's DPA or a support answer, that API inputs and outputs are not used for training, then sign or accept the DPA;
  - put Standard Contractual Clauses in place for transfers from the EU to Singapore.

  T9 waits on this, and T10 (switching it on) waits on T9.
- **Z4, an eval key in the cloud session (founder): done Nov 16.** Saved on the session environment for `api.z.ai`; the account holds a $50 balance.

## Rules for this package (on top of README.md)

- **Model ids and provider endpoints only in `packages/models/src/routing.ts`.** That covers `glm-5.3-flash` and `https://api.z.ai/api/anthropic`. `model-ids.test.ts` is widened to catch the GLM id elsewhere.
- **Callers never choose a provider.** The provider follows from who pays, through one function (T2). No call site passes "glm" or "anthropic".
- **A call that would use Foundmill's Anthropic key for an account not on a paid plan is refused before it is sent**, in every service. A test proves it at each call site. The UI is never the guard.
- **Simulated results are never reported as actions, on either provider.** House rules are prepended to every call, as today.
- **Measure before tuning.** GLM-5.3 Flash always thinks, and its thinking is billed as output. T1 records what the compatible endpoint accepts, and nothing assumes a feature T1 has not seen work.
- **Copy:** the model's name as people read it is "GLM-5.3 Flash". The prompt never says a free founder is missing something they need: it offers better models as an option (FOUNDMILL.md "Solo is complete" applies in spirit: the free plan is complete).
- **Recorded decisions this package builds on:**
  - 2026-10-05 "Model ids";
  - 2026-10-06 "packages/models: live client, metering and mock conventions";
  - 2026-10-12 "The ceiling on Foundmill's Anthropic key (SEC2)";
  - 2026-10-12 "Billing enforcement";
  - 2026-11-13 "Low credits move routine work to a lighter model instead of stopping" (#118);
  - 2026-11-13 "A founder's own AI plan" (#118);
  - Nov 16 founder decisions (#219).

  This package supersedes WP-09 T15 ("do not add a fourth model key").

## Design in one page

**The fourth key.** `MODELS.glm = "glm-5.3-flash"`. `MODEL_KEYS` becomes `["opus","sonnet","haiku","glm"]`. `MODEL_PROVIDER: Record<ModelKey, "anthropic" | "zai">` says which endpoint serves each key. `MODEL_CAPABILITIES.glm` starts as `{ effort: false, fastMode: false, structuredOutput: false, promptCache: false, temperature: false, vision: false }`, and each flag is turned on only where T1 saw it work on the compatible endpoint. `ALWAYS_THINKS.glm = true`.

**Who pays decides the provider.** One function in `packages/config`:

```ts
export type ModelFunding = "platform_anthropic" | "platform_glm" | "own_anthropic";
export function tierAllowsPlatformAnthropic(tier: TierKey): boolean; // a paid tier: TIERS[tier].priceMonthly !== null
export function modelFundingFor(input: { planTier: TierKey | null; modelBilling: "credits" | "byok" | null }): ModelFunding;
// byok → own_anthropic; a paid tier on credits → platform_anthropic; everything else (free, no business, signed out) → platform_glm
```

- **For a business:** `planTier` and `modelBilling` from the row every service already loads.
- **Before a project exists:** the person's `businessAllowance` (packages/db `tiers.ts`), which is the highest tier among the projects they **own**.
- **Signed out:** `platform_glm`.

`priceMonthly !== null` makes `pro` and `scale` paid even while their price is "TBD". `assertTierAvailable` already keeps them out of production, so nobody reaches them by accident. Dev and test can set them through `billing.changeTier`, which is what the invariant test uses.

**One routed client.** `createRoutedModelClient({ anthropic, zai, fundingOf })` in packages/models takes the platform Anthropic client, the Z.ai client and an async `fundingOf(attribution)` the service supplies. For each call it resolves funding:
- `platform_glm`: forces `modelOverride: "glm"` on every route, locked routes included, and sends it to the Z.ai client;
- `platform_anthropic`: sends it to the Anthropic client;
- `own_anthropic`: never reaches this client, because the orchestrator and gateway already build a client on the founder's key.

The Anthropic platform client is wrapped by `guardPlatformAnthropic(client, fundingOf)`. It throws `AppError("platform_anthropic_refused", 403)` when funding is not `platform_anthropic`, so a call site that skips the router still cannot spend. Each service passes the same `fundingOf`, cached per business for 30 seconds, as `createBusinessModelClient` does today.

**Agent sessions.** `resolveApiKey` gains a third answer, `{ source: "platform_glm", apiKey: ZAI_API_KEY, baseURL: ZAI_BASE_URL }`. For that source, `sdkEnvFor` sets:
- `ANTHROPIC_BASE_URL` to Z.ai;
- the key under the name T1 found the endpoint accepts (`ANTHROPIC_AUTH_TOKEN` per Z.ai's Claude Code guide, or `ANTHROPIC_API_KEY`);
- every model slot the SDK uses (`ANTHROPIC_DEFAULT_OPUS_MODEL`, `_SONNET_`, `_HAIKU_`, and the small fast model) to `MODELS.glm`, so no background call leaves for an Anthropic id.

The session is priced by Foundmill, from `usage` with `meter(usage, MODELS.glm)`, never from the SDK's `costUSD`. The budget is enforced by Foundmill's own stop on cumulative metered cost, because the SDK's `maxBudgetUsd` prices with Anthropic's table.

**Calls go direct, not through the gateway.** Model calls already reach Anthropic straight from api, composer and orchestrator (packages/models' client), not through apps/gateway. Z.ai is a second model provider on the same protocol and the same client, so it follows the same rule (D1). Web search is a tool, not a model call, so it goes through the gateway (T5).

## Tasks

### T1: Probe Z.ai's Anthropic-compatible endpoint and write down what works            [S] [ships alone; needs setup Z1 and Z4]
Why: Z.ai's docs don't list which Anthropic API features the compatible endpoint accepts. Every later task depends on it.
Files:
- create `packages/models/scripts/probe-zai.ts` (run by hand, never in CI);
- create `docs/log/2026-11/<date>-claude-wp13-t1-zai-probe.md`.

Interfaces, consumes: `LiveModelClient` with `baseURL`. Produces: the capability table that T2 writes into `MODEL_CAPABILITIES.glm`.

Steps:
1. For each feature, make one call to `glm-5.3-flash` and record what comes back: accepted, ignored, or refused with which error.
   - auth by `x-api-key` and by `Authorization: Bearer`;
   - a plain message, and a streamed one;
   - `output_config.format` (a JSON schema) and `output_config.effort` (`low`);
   - `cache_control` on a system block, and the `usage` fields that come back (cache reads?);
   - `tools` with a forced `tool_choice`, and a tool-use round trip;
   - an image block;
   - `temperature`, and `max_tokens` against thinking: does thinking count toward it?
   - the shape of a 429, a 401 and a 402 or out-of-balance error, and the rate-limit headers.

   verify: the log entry has the table and the exact error bodies, with no key in them.
2. Run the Claude Agent SDK once, outside the product, against the endpoint with the model slots set to `glm-5.3-flash`. Give it one tool call through a local MCP server and record which env names work. verify: the transcript shows only `glm-5.3-flash` in `message.model`.
3. Measure five typical Ideation calls: input, output and thinking tokens and seconds. verify: the measured cost per call replaces the $0.0015 Estimate in the log.

Tests and evals: none. The script spends about $0.10 (Estimate).
Done when: the log entry is merged with the table.

### T2: The GLM key, the provider seam and the guard            [M] [ships alone; after WP-09 T3 merges; after T1]
Why: the founder's rule.
Files:
- modify, packages/models: `src/routing.ts`, `src/pricing.ts`, `src/client.ts`, `src/gate.ts`, `src/types.ts`, `src/mock/index.ts`, `src/index.ts`, `src/model-ids.test.ts`, `src/routing.test.ts`, `src/pricing.test.ts`;
- create, packages/models: `src/routed.ts`, `src/__tests__/routed.test.ts`, `src/__tests__/platform-anthropic-guard.test.ts`;
- modify: `packages/shared/src/constants.ts` (`MODEL_KEYS`), `packages/shared/src/env.ts`, `.env.example`, `packages/config/src/pricing.ts`, `packages/config/src/index.ts`;
- create: `packages/db/migrations/<next>_glm_model_key.sql` and its `_journal.json` entry; modify the Drizzle enums that read `MODEL_KEYS`, if any need regenerating;
- the three-key files T15 listed: `apps/orchestrator/src/activities/session-credits.ts` (`MODEL_RANK`), `activities/training.ts` (`MODEL_NAMES`), `activities/holiday.ts`, `workflows/agentSession.ts`, `packages/agents/src/types.ts`, `prompts/agent-builder.ts`, `packages/policy/src/types.ts`, `packages/dugout/src/components/agents/SquadCells.tsx` (`MODEL_LABELS` and the filter), `packages/dugout/src/components/journey/fixtures.ts`, `packages/modules/src/finance/WageBillScreen.tsx`, `packages/db/src/seed/journey.ts`. Only the change each needs to compile and label the key.

Interfaces, consumes:
- `createModelClient`, `LiveModelClient({ baseURL })`, `gateModelClient`, `meter`;
- `TIERS`, `businessAllowance`.

Interfaces, produces:
```ts
// routing.ts
MODELS.glm; MODEL_PROVIDER; MODEL_ENDPOINTS: { zai: { baseURL: "https://api.z.ai/api/anthropic" } };
MODEL_CAPABILITIES.glm  // from T1's table
// pricing.ts
MODEL_PRICING[MODELS.glm] = { inputPerMTok: 0.15, outputPerMTok: 0.50, cacheReadPerMTok: 0.03, cacheWritePerMTok: 0.15 } // Z.ai list, Nov 16, 2026
// routed.ts
export type FundingOf = (a: UsageAttribution | undefined) => Promise<ModelFunding>;
export function createRoutedModelClient(o: { anthropic: ModelClient; zai: ModelClient; fundingOf: FundingOf }): ModelClient;
export function guardPlatformAnthropic(c: ModelClient, fundingOf: FundingOf): ModelClient;
// config
export function tierAllowsPlatformAnthropic(tier: TierKey): boolean;
export function modelFundingFor(i: { planTier: TierKey | null; modelBilling: "credits" | "byok" | null }): ModelFunding;
// env
ZAI_API_KEY?: string; ZAI_BASE_URL (default from MODEL_ENDPOINTS); ZAI_MONTHLY_CAP_CENTS (default 60000)
```
```sql
-- <next>_glm_model_key.sql: widen each check to ('opus','sonnet','haiku','glm')
alter table agents drop constraint <name>, add constraint <name> check (model_key in ('opus','sonnet','haiku','glm'));
-- same for agent_versions, agent_sessions (0004) and usage_ledger (0009, nullable); account_usage if WP-09 T2 merged first
```

Steps:
1. `modelFundingFor` and `tierAllowsPlatformAnthropic`, with a table test over every tier × billing × no business. verify: `pnpm --filter @foundmill/config test`.
2. The key, the id, the price and the capabilities. `resolveModel(route, "glm")` returns GLM on every route, the locked ones included: a lock means "this route's best model" and has no meaning on the free plan. The test pins that. verify: `routing.test.ts` and `pricing.test.ts`.
3. The client drops each Anthropic-only parameter the resolved model's capabilities lack:
   - effort, fast mode and its beta, and `temperature`;
   - `output_config.format`: it takes the existing "## Response format" system-block fallback;
   - `cache_control`.

   It reads usage, refusals and rate limits in the shapes T1 recorded. verify: `client.test.ts` cases with a fake fetch for a GLM resolution: the body has none of the dropped fields, and the result meters at the GLM price.
4. `createRoutedModelClient` and `guardPlatformAnthropic`. verify: `routed.test.ts`:
   - `platform_glm` sends every route to `zai` with `glm`;
   - `platform_anthropic` sends to `anthropic` with the route's model;
   - the guard throws `platform_anthropic_refused` before any fetch.
5. The migration and the enums. verify: `pnpm db:migrate` on PGlite, and an insert of `model_key = 'glm'` into each table succeeds.
6. Mock mode: a GLM resolution returns the route's fixture. verify: `pnpm --filter @foundmill/models test`; the golden path is unchanged (`pnpm test:e2e` golden-path spec).
7. `model-ids.test.ts` catches the GLM id and the Z.ai endpoint outside `routing.ts`. verify: the test fails on a planted string, then passes once it is removed.

Tests and evals: above. No eval: no prompt changes in this task.
Done when: merged. Nothing calls Z.ai yet, because no service builds the routed client until T3.

### T3: Api, composer, gateway readers and the idea box choose by who pays            [M] [ships alone; after T2]
Why: the founder's rule. The api runs every call on one platform client today, with no plan check (`apps/api/src/services/models.ts:91`).
Files:
- modify, api: `apps/api/src/services/models.ts`, `apps/api/src/context.ts`, `apps/api/src/services/idea-box.ts`;
- modify, composer: `apps/composer/src/index.ts`, `apps/composer/src/usage.ts`;
- modify, gateway: `apps/gateway/src/index.ts`, `apps/gateway/src/reader-models.ts`, `apps/gateway/src/builtins.ts`;
- modify, orchestrator: `apps/orchestrator/src/models.ts` (`createBusinessModelClient`, the per-business client used by cycles, foundations, training and the rest);
- create: `apps/api/src/__tests__/free-plan-provider.test.ts`, `apps/gateway/src/__tests__/free-plan-readers.test.ts`, `apps/orchestrator/src/__tests__/free-plan-models.test.ts`.

Interfaces, consumes: T2's exports; `checkPlatformCredits` (returns the business row: add `planTier` to its result); `businessAllowance`; `ctx.userId`.

Steps:
1. **Api.** `createApiModelClient` builds the routed client. `fundingOf(a)`:
   - `a.businessId`: that business's `planTier` and `modelBilling`;
   - else `a.userId`: `businessAllowance`;
   - else `platform_glm`.

   The pre-commit call sites pass `attribution.userId`: four in Ideation, Import, Ask, compare, `ideaLogoSet`, and `screenText` without a business. This overlaps WP-09 T2 step 2. Whichever lands second keeps the other's edits.

   A business on its own key is served on the platform key by the api today (`services/models.ts:101`, no own-key path; the api must not decrypt keys). In this task, `fundingOf` returns `platform_glm` for a free business on `byok` in the api and composer, so nothing reaches Foundmill's Anthropic key. T11 then moves those calls onto the founder's own key (D6).

   verify: `free-plan-provider.test.ts` drives every api call site named in WP-09 T2's list, plus `team-call.ts`, `task-graph.ts`, `goals.ts`, `product-research.ts`, `composer.ts`, `plans.ts`, `logo.ts`, `conversation.ts`, `page-quiz.ts`, `post-drafts.ts`, `routers/agent.ts`, `legal.ts` and `distribution.ts`, for the three accounts in Done-when item 1.
2. **The signed-out idea box** uses `platform_glm`. Its daily ceiling and reservation meter at the GLM price, so the same $20 a day buys more cards. verify: `idea-box.test.ts` passes, and its reservation uses `MODELS.glm`.
3. **Composer**: the same routed client, keyed by the business. verify: a composer test for a free business sees only `zai` calls.
4. **Gateway**:
   - the untrusted reader (`reader-models.ts`) and the quarantined reader (`builtins.ts`) use the routed client for free businesses;
   - own-key businesses keep their key in `builtins.ts`;
   - `reader-models.ts` gains the own-key path it lacks today, using the same `loadByokApiKey`.

   verify: `free-plan-readers.test.ts`.
5. **Orchestrator** `createBusinessModelClient`: a free business on credits gets the Z.ai client; own key and paid tiers are unchanged. verify: `free-plan-models.test.ts`.

Tests and evals: above. The injection suites for the readers run on GLM in T8 before T10 switches anything on.
Done when: Done-when item 1 passes. With `ZAI_API_KEY` unset in live mode, free calls are refused with "AI drafting is not available right now", not sent to Anthropic.

### T4: Free projects' agent sessions run on GLM            [M] [ships alone; after T2; ask the plan-execution session before editing `session.ts`]
Why: sessions are the larger part of a free project's spend. Today the SDK child always talks to Anthropic.
Files:
- modify, orchestrator: `apps/orchestrator/src/activities/session.ts` (`resolveApiKey`, `prepareSession`, `SessionUsage`, the budget stop), `activities/sdk-isolation.ts` (`sdkEnvFor`, `assertNoLongLivedCredentials`), `activities/session-credits.ts`;
- create: `apps/orchestrator/src/__tests__/session-glm.test.ts`.

Interfaces, consumes: T2's `MODELS.glm`, `MODEL_ENDPOINTS`, `meter`, `modelFundingFor`; `sdkEnvFor({ cwd, apiKey, sessionToken, sandboxEnv })`.

Interfaces, produces: `resolveApiKey(): Promise<{ apiKey: string; source: "byok" | "platform" | "platform_glm" | "none"; baseURL?: string }>`. `sdkEnvFor` takes `baseURL` and `modelSlots`.

Steps:
1. `resolveApiKey` returns `platform_glm` for a free business on credits, and `launch.modelId` is `MODELS.glm`. verify: `session-glm.test.ts`.
2. `sdkEnvFor` sets the base URL, the key name T1 found and every model slot to `MODELS.glm`. The credential check accepts that one key name only for this source. verify: a unit test of the env: no Anthropic id and no host env leak.
3. Cost: `SessionUsage` meters GLM usage with `meter` and ignores `costUSD` for it. Every heartbeat compares the metered total with the session budget and interrupts at it, the same path Stop uses. verify: a replayed run whose usage crosses the budget is interrupted, booked once, and ends `blocked` with reason `budget`.
4. The mid-session model switch (`setModel`) is refused for a `platform_glm` session. verify: a test.

Tests and evals: above, and T8's live session check.
Done when: Done-when item 2 passes in a live run with an eval key (T8).

### T5: Free web search through Z.ai's Web Search API            [M] [ships alone; after T2]
Why: `search_web` uses Anthropic's server tool on the platform key for every business (`packages/connectors/src/connectors/web/index.ts`). WP-00 S6 stays off in production until this lands.
Files:
- modify: `packages/connectors/src/connectors/web/index.ts` and its test, `apps/gateway/src/builtins.ts` (pass the funding);
- create: `packages/connectors/src/connectors/web/zai-search.ts` with real and mock implementations, and its test.

Interfaces, consumes: Z.ai `POST /api/paas/v4/web_search` (`search_query`, `count`, `search_recency_filter`). It returns title, link, summary, source and date, and is called only from the gateway. Produces: `searchWebFor(funding)`. A `platform_glm` business gets Z.ai search with the results returned as untrusted content, as today. `platform_anthropic` and `own_anthropic` keep Anthropic's search (WP-09 T3's `searchWeb`).
Steps:
1. Find the fee per search on Z.ai's pricing page and add it to `pricing.ts` as a dated row. verify: `pricing.test.ts`.
2. The connector, its mock and the funding switch. verify: a contract test (mock), and a gateway test showing a free business never reaches the Anthropic search.
3. The fee is booked through WP-09 T3's exact-cost path. verify: one `usage_ledger` row per search.

Tests and evals: above.
Done when: Done-when item 3 passes.

### T6: The $600 monthly cap, and slowing down at it            [M] [ships alone; after T3]
Why: the founder's cap. No sum of spend across businesses exists today: `repos.usage.*` is per business.
Files:
- create: `packages/db/src/repos/platform-spend.ts`, `apps/api/src/services/zai-cap.ts` (shared by orchestrator and gateway through packages/db), `apps/api/src/__tests__/zai-cap.test.ts`;
- modify: `apps/api/src/services/models.ts`, `apps/orchestrator/src/activities/session.ts` (the start check only), `apps/gateway/src/index.ts`.

Interfaces, consumes:
- `usage_ledger` rows with `model_key = 'glm'` and `billed_to = 'credits'` since the start of the UTC month;
- `idea_drafts.cost_micro` for the same month;
- WP-09 T2's `account_usage` once it exists.

Interfaces, produces:
```ts
platformSpend.glmMonthMicro(db, monthStart): Promise<number>  // cached 60 s per process
zaiCapState(spentMicro, capCents): "open" | "slow" | "held"
```
Steps:
1. The monthly sum and its cache. verify: a repo test over seeded rows.
2. The states:
   - **open** below 80% of the cap.
   - **slow** from 80% to 100%: every free account's model limits are scaled to a quarter (the `MODEL_LIMIT_SCALE` mechanism, per account), and free sessions start one at a time per project.
   - **held** at 100%: free interactive calls answer "Free AI is busy for the rest of the month. It is back on <Dec 1>. To keep going now, connect your own Anthropic key." Free sessions wait as `queued` until the month resets.

   Paid and own-key projects are never affected. verify: `zai-cap.test.ts` drives each state with a fake total.
3. `/health` reports the state, and an alert fires once at slow and once at held. verify: a test.

The 80% line and the quarter scale are Estimates (D2).
Done when: Done-when item 4 passes.

### T7: The model dialog shows GLM, and Anthropic models offer an upgrade            [M] [ships alone; after T2]
Why: the founder's rule.
Files:
- modify, api: `apps/api/src/routers/agent.ts` (`agent.model.compare`);
- modify, design system: `packages/dugout/src/components/agents/ModelPicker.tsx`, `packages/dugout/src/components/agents/types.ts` (`ModelOption`), `SquadCells.tsx` (the model chip shows the model in use);
- modify, web: `apps/web/components/agents/logic.ts`, `apps/web/components/agents/ModelChangeDialog.tsx`;
- modify, modules: `packages/modules/src/team/ModelChangeDialog.tsx`;
- create, design system: `packages/dugout/src/components/agents/BetterModelsPrompt.tsx` and its story;
- create, web: `apps/web/e2e/free-plan-models.spec.ts`.

Interfaces, consumes: `agent.model.compare` (`allowed`, `warning`, `predictedWageMinor`); `ModelOption.lockedReason`; the business's `planTier` and `modelBilling`.
Interfaces, produces:
- `agent.model.compare` returns `inUse: ModelKey` and, per option, `gate?: "upgrade_or_own_key"`. It also returns a GLM option, which is the only one allowed for `platform_glm`.
- `ModelOption.gated?: true` draws the option slightly grayed with the design-system muted token. It stays focusable and selectable; choosing it opens `BetterModelsPrompt` instead of selecting it.

Steps:
1. **The procedure.** For a `platform_glm` business the Anthropic options come back `gate: "upgrade_or_own_key"`, and `agent.model.set` refuses them with that code. The agent's stored choice is kept: it is what the agent runs on after an upgrade or with an own key (D3). verify: an api test.
2. **The picker and the prompt.**
   - Prompt title: "Better models come with a plan".
   - Body: "On the free plan your team runs on GLM-5.3 Flash. Claude models come with a paid plan, or you can connect your own Anthropic key and pay Anthropic directly."
   - Actions: "See plans" (Settings › Billing), "Connect your Anthropic key" (Settings › Keys), "Not now".

   Run the copy through `copy-editing` and `humanizer`, then through `node scripts/banned-terms.mjs` and `node scripts/us-english.mjs`. verify: the story renders the three states (`inUse` GLM, gated, own key connected), and the copy linters pass.
3. **The table and the dialog** show "GLM-5.3 Flash" as the model in use on the free plan, and the stored Anthropic choice as "after you upgrade". verify: `free-plan-models.spec.ts` (desktop, 1280 px): open an agent, choose Opus, see the prompt, follow "Connect your Anthropic key" to Settings › Keys.

Tests and evals: the story and the spec.
Done when: Done-when item 5 passes.

### T8: Evals on GLM-5.3 Flash            [M] [after T3 and T4; needs setup Z4 and D4]
Why: prompts were written and tuned against Claude. The founder's first look at a concept now runs on GLM.
Files:
- modify: `packages/agents` eval runner, to accept a `--funding platform_glm` flag that runs a suite through the routed client;
- create: `docs/log/2026-11/<date>-claude-wp13-t8-glm-evals.md`.

Steps:
1. Run, live on GLM:
   - the house-rules suite (the "simulated, not done" wording included);
   - `ideation.eval`, `foundations.eval`, `logo.eval`, `second-read.eval`;
   - the conversation and goal-proposal suites;
   - the quarantined reader's injection suites (must be 100%);
   - the moderation suite;
   - one live agent session on a golden task with a gateway tool.

   verify: each suite's score is in the log next to its Anthropic score.
2. **Where a suite fails:**
   - **Injection suites:** the reader routes step up to Z.ai's full GLM-5.3 for free projects (D5). That means adding the key `glmMax`, `MODELS.glmMax = "glm-5.3"`, its price row and the capability flags T1 measured, on the same migration pattern as T2. Re-run the suites. If they still fail, fix the reader prompt and re-run. They never fall back to Anthropic, and never to a reader with no model.
   - **Moderation:** a post is held for the founder.
   - **Others:** a prompt fix scoped to the GLM capability path, re-run, and a note in the log.

   verify: re-runs pass, or the fallback is in place and tested.
3. Rough cost of the whole run: under $5 (Estimate, at GLM prices).

Done when: Done-when item 6.

### T9: The privacy policy names Z.ai            [S] [needs setup Z3]
Files: modify `apps/web/content/legal/privacy.ts` and the legal page's test or snapshot.
Steps:
1. **Processors list:** add `{ term: "Z.ai", detail: "The AI models your agents run on when you have not paid for a plan. Singapore." }`, and change Anthropic's line to "on a paid plan or on your own key".
2. **Line 107's training sentence** names Z.ai only once Z3 has confirmed it in writing. If Z3 cannot, the sentence is rewritten to say what is true, and the founder approves the words.
3. **Transfers section:** add Singapore under Standard Contractual Clauses.

verify: the legal page spec passes at 390 px and 1280 px, and both copy linters pass.
Done when: merged after Z3.

### T10: Switch it on            [S] [after T3 to T9 and T11; needs setup Z2]
Steps:
1. Desktop sets Z2 on each service. verify: `/health` on each shows the Z.ai provider configured and the cap state `open`.
2. A test account on the free plan drafts ideas, commits and runs its first session. The ledger shows only `model_key = 'glm'` rows, and the Anthropic console shows no new usage from it. verify: recorded in the log.
3. Tell the plan-execution session, so WP-09 T2, T4, T5, T8 and WP-00 S6 can go ahead.

Done when: the log entry is merged.

### T11: The api and composer use a founder's own Anthropic key            [M] [ships alone; after T3; before T10]
Why: D6. A founder who connected their own key gets Anthropic models for every call, not only agent sessions. Today the api and composer run on Foundmill's key whatever the business's billing (`apps/api/src/services/models.ts:101`, `apps/composer/src/index.ts:78`). The api may not decrypt keys (BUILD §10.2); the gateway holds them (`loadByokApiKey`).
Files:
- create, gateway: `apps/gateway/src/model-proxy.ts`, `apps/gateway/src/__tests__/model-proxy.test.ts`;
- modify, gateway: `apps/gateway/src/index.ts`, to mount the route;
- create, api: `apps/api/src/services/gateway-models.ts` (a `ModelClient` that calls the route);
- modify, api: `apps/api/src/services/models.ts`;
- modify, composer: `apps/composer/src/index.ts`, `apps/composer/src/usage.ts`;
- create, api: `apps/api/src/__tests__/own-key-calls.test.ts`;
- modify: `docs/ARCHITECTURE.md`, the gateway section, to document the route.

Interfaces, consumes:
- `loadByokApiKey`;
- `createModelClient({ mode: "live", apiKey, billedTo: "byok" })`;
- the service-token check of `POST /v1/keys/validate` (`svc: api` and `svc: composer`);
- `ModelClient`'s `complete` and `stream` (and `streamStructured`, which is built on `stream`).

Interfaces, produces:
```ts
// gateway, service auth: svc api | composer
POST /v1/models/complete { businessId, request: CompletionRequest } -> CompletionResult
POST /v1/models/stream   { businessId, request: CompletionRequest } -> text/event-stream of the client's stream events
// both refuse (409 own_key_missing) unless the business's model_billing is byok and its key loads; never use a platform key
// api
createGatewayModelClient(gateway): ModelClient   // for own_anthropic calls; usage reaches the api's sink with billedTo "byok"
```
Steps:
1. **The gateway route.** The same body limits, per-business rate limit (`rl:<businessId>:own_key_models`) and audit pattern as `/v1/keys/validate`. The key is never logged or echoed, and the response carries the usage. verify: `model-proxy.test.ts`. A byok business is answered on its own key (a recording fetch shows the founder's key). A credits business is refused with no model call.
2. **The api's gateway client.** The routed client sends `own_anthropic` to it, and `fundingOf` returns `own_anthropic` for any business on `byok`, free or paid. verify: `own-key-calls.test.ts` drives every call site in this list for a free business on its own key and sees only gateway calls, booked `byok`, with no Z.ai call and no platform Anthropic call:
   - desk conversations;
   - team call turns and wrap-up;
   - the goal proposal, the plan compiler, the task graph, product research;
   - Legal's jurisdiction cards, Distribution's channel scores;
   - the logo, the page quiz, post drafts, and the agent builder (`routers/agent.ts`).
3. **Composer:** the Inbox notes, the founder titles, journey commentary and the chapter note go the same way. verify: a composer test.
4. **Streaming:** the desk reply and the card streams render token by token through the route, as they do now. verify: a stream test with a fake gateway; `client.stream.test.ts` patterns.
5. **A revoked or failing key** answers the existing "your key" refusal sentences, never a silent fallback to Foundmill's key or to GLM. verify: a test.

Tests and evals: above. No prompt changes.
Done when: a free founder on their own key sees Anthropic answers in every place listed, and the ledger shows them as `byok`.

## Decisions for the founder (answered Nov 16, 2026)

- **D1, answered yes.** Z.ai is called the way Anthropic is: straight from the services through packages/models, not through the gateway. Web search, a tool, goes through the gateway (T5).
- **D2, answered yes.**
  - From $480 (80% of the cap), free accounts get a quarter of their usual limits and sessions run one at a time per project.
  - At $600, free work waits until the month resets, and interactive calls say when it is back.
  - Paid and own-key projects are never slowed.
- **D3, answered yes.** A free project's agents keep their stored model choice. The table shows GLM-5.3 Flash as the model in use, and the stored choice applies after an upgrade or with an own key.
- **D4, answered.** The founder put $50 on the Z.ai account as the first budget. T1 and T8 stay well inside it (about $5, Estimate).
- **D5, revised by the founder: there is always AI.** If GLM-5.3 Flash fails the injection suites, free projects' readers (the quarantined reader and the untrusted reader) step up to Z.ai's full GLM-5.3 ($1.40 / $4.40 per 1M tokens, about half a cent a read, Estimate). The deterministic checks stay as the outer layer, as today. If GLM-5.3 also fails, the reader's prompt is fixed and re-tested before T10. A reader without a model is never the answer, and neither is Anthropic.
- **D6, answered: a founder's own key reaches every call.** A founder who connected their own Anthropic key gets Anthropic models on that key for every call the api and composer make for their project, not only agent sessions. That covers:
  - desk conversations;
  - team call turns and wrap-up;
  - the Inbox notes, task titles in plain words and journey commentary;
  - the Chief of Staff's goal proposal, the plan compiler, the task graph and product research;
  - Legal's jurisdiction cards and Distribution's channel scores;
  - the logo, the page quiz, post drafts, and building a new agent.

  The api may not decrypt keys, so these go through a new gateway route (T11).
- **Z3, answered.** Z.ai's terms (Additional Terms §3(b), and the API note in §IV.7) say "We will not use End User Content to develop or improve Services, unless you explicitly agree to such use." The copy read on Nov 16 shows that sentence in square brackets, so keep a dated copy or Z.ai support's written confirmation with the DPA. The founder confirmed that the terms should name providers in Singapore and the United States, with Standard Contractual Clauses for transfers from the EU.

## Risks

- **GLM-5.3 Flash cannot turn thinking off**, and the compatible endpoint may ignore effort. If output runs 2–3× the Estimate, the $435 becomes $900–1,300 at typical use and the cap decides sooner. T1 measures it; T6 holds the line.
- **Prompts tuned on Claude may read worse on GLM**, especially the founder's first concept cards. T8 measures it, and the founder can ask for a stronger route only through a paid plan.
- **The Agent SDK is Claude Code as a library.** Its behavior against a non-Anthropic endpoint can change with any release: pin the SDK version and keep T4's test on a recorded run.
- **The SDK's own budget and cost figures are Anthropic-priced.** T4 replaces them for GLM sessions; a missed path would let a session run unbounded. The interrupt is tested.
- **Z.ai rate limits are not published.** A busy hour may 429. The client's backoff applies, and T1 records the headers.
- **Z.ai content and training terms rest on its DPA, not a public guarantee** (Z3).
- **If Z.ai has an outage, free AI has no fallback**, by design: falling back to Anthropic would pay for free users.
- **A paid plan cannot be bought yet**, so in production every founder without their own Anthropic key is on GLM until WP-09 T16.

## Starting prompt

```
You are executing work package WP-13 "The free plan runs on GLM-5.3 Flash" for Foundmill. Read, in this order: FOUNDMILL.md; docs/holistic-plan/README.md; docs/holistic-plan/WP-13-free-plan-on-glm.md; docs/log/2026-11/2026-11-16-claude-stage3-founder-decisions-2.md; the CLAUDE.md files of packages/models, packages/config, apps/api, apps/gateway and apps/orchestrator.

Load the skills `claude-api` (for every Anthropic fact), `karpathy-guidelines`, `plan-change`, `test-driven-development` and `executing-plans`. Run `plan-change` before code: it finds overlapping branches and the next free migration number.

Work T1 to T9, then T11, then T10. T2 waits for WP-09 T3 to merge; T4 waits for a word from the plan-execution session (session_01CJRTqRyoumyGvVfGMuknRM) on session.ts. One task, one pull request on claude/wp13-t<n>. Write the failing test the task names, make it pass, run `verify-done`, and report each check with its result. Never push to main and never merge.

Stop and ask the founder where a task says "needs setup" or names a decision (D1 to D6). Live calls spend real money: state the expected cost first and stay inside D4.

After each task add one file under docs/log/ (skill `log-entry`) and tick the task here.
```
