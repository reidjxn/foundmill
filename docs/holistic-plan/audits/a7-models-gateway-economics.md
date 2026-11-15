# A7. Model layer, gateway and policy, economics (credits, plans, billing)

Audit of `/Users/reidjackson/code/founder-manager` at `04a0a509` (main, 2026-11-15). Read-only. Every path is relative to the repo root; `file:line` was read in this pass. "Fact sheet" means the Claude API facts given with the task (Nov 2026). Where I could not verify something from code or docs I say "not verified". Production measurements quoted are the ones supplied with the task (319 real sessions, $119 total).

Contents: 1 How it works today · 2 Live vs off · 3 Findings · 4 Roadmap items · 5 Interfaces · 6 Tests and gaps · 7 Surprises · Appendix A routing table · Appendix B SQL · Appendix C three-model-key sites

---

## 1. How it works today

### 1.1 Routing (`packages/models/src/routing.ts`)

`MODELS` (routing.ts:21-25), quoted:

```ts
export const MODELS = {
  opus: "claude-opus-5-5",
  sonnet: "claude-sonnet-5-5",
  haiku: "claude-haiku-4-5-20251001",
} as const;
```

Header says "Verified against Anthropic's model list on 2026-10-05" (routing.ts:3). Capabilities: `MODEL_CAPABILITIES` (routing.ts:91-95) = opus `{effort:true, fastMode:true}`, sonnet `{effort:true, fastMode:false}`, haiku `{effort:false, fastMode:false}`. `ALWAYS_THINKS` (routing.ts:104) = opus true, sonnet true, haiku false. Budgets: `THINKING_MAX_TOKENS = 16_000`, `LOW_EFFORT_MAX_TOKENS = 8_000`, `PLAIN_MAX_TOKENS = 4_096` (routing.ts:111-113).

`ROUTES` (routing.ts:147-211), 30 routes. Columns: model, `lowCredits` target, effort, flags, `maxTokens`.

| Route | Model | lowCredits | Effort | Flags | maxTokens |
|---|---|---|---|---|---|
| inboxComposer | opus | keep | low | locked | 16,000 |
| planCompiler | opus | keep | low | locked | 16,000 |
| chiefOfStaff | opus | keep | (API default) | warnOnDowngrade | 16,000 |
| departmentLead | opus | sonnet | (default) | | 16,000 |
| leadRecommendation | opus | keep | low | | 16,000 |
| planner | opus | sonnet | low | | 16,000 |
| codeReview | opus | keep | (default) | | 16,000 |
| documentReview | opus | keep | (default) | | 16,000 |
| ideation | opus | keep | low | speed fast | 8,000 |
| ideationSlate | opus | keep | low | speed fast | 8,000 |
| logoDesigner | opus | sonnet | low | speed fast | 8,000 |
| foundations | opus | sonnet | low | speed fast | 8,000 |
| foundationsSkeleton | opus | sonnet | low | speed fast | 8,000 |
| skillGrader | opus | sonnet | (default) | | 16,000 |
| coach | opus | sonnet | (default) | | 16,000 |
| worker | sonnet | haiku | (default) | | 16,000 |
| journeyCommentary | sonnet | haiku | (default) | | 16,000 |
| nightlyBatch | sonnet | haiku | (default) | batch: true | 16,000 |
| linker | haiku | keep | n/a | | 4,096 |
| classifier | haiku | keep | n/a | | 4,096 |
| categoriser | haiku | keep | n/a | | 4,096 |
| quarantinedReader | haiku | keep | n/a | | 4,096 |
| moderation | haiku | keep | n/a | | 4,096 |
| founderTitle | haiku | keep | n/a | | 4,096 |
| conversation | sonnet | keep | low | | 8,000 |
| goalProposal | sonnet | keep | low | | 8,000 |
| projectPage | sonnet | keep | low | | 8,000 |
| teamCallTurn | sonnet | keep | low | | 8,000 |
| teamCallWrapUp | opus | keep | low | | 8,000 |
| designReview | opus | keep | low | vision | 8,000 |

"(default)" means no `effort` is sent, so the API default applies. The header (routing.ts:13) records those defaults as Opus `medium`, Sonnet `high`.

`resolveModel(route, override?, { lowCredits? })` (routing.ts:259-284): a locked route ignores the override with a warning; `warnOnDowngrade` warns; with `lowCredits` a routine route moves to its `lowCredits` model when that ranks lower than the chosen one (`RANK`, routing.ts:241); effort is dropped when the resolved model has none; `speed: "fast"` survives only on a `fastMode` model; `maxTokens` is raised to the thinking floor of the resolved model (`maxTokensFor`, routing.ts:290-293).

A second copy of the route → model table lives in `packages/agents/src/types.ts:74-105` (`ROUTE_DEFAULT_MODEL`), with a compile-time guard on the key set only (types.ts:69-71), not on the model values.

Agent templates name a route (`template.route`): 6 leads on `departmentLead`, 12 workers on `worker`, plus `chiefOfStaff`, `planner`, `codeReview` and the utilities (counted from `packages/agents/src/templates/**`). `routeOf(agent)` is `getTemplateByAgentType(agent.agentType)?.route ?? "worker"` (`packages/db/src/agent-model.ts:17`).

### 1.2 Prices (`packages/models/src/pricing.ts`)

Quoted (pricing.ts:35-39), USD per million tokens, `PRICING_AS_OF = "2026-10-05"` (pricing.ts:17):

```ts
[MODELS.opus]:   { displayName: "Claude Opus 5.5",   inputPerMTok: 4, outputPerMTok: 20, cacheWritePerMTok: 5,    cacheReadPerMTok: 0.2 },
[MODELS.sonnet]: { displayName: "Claude Sonnet 5.5", inputPerMTok: 2, outputPerMTok: 10, cacheWritePerMTok: 2.5,  cacheReadPerMTok: 0.2 },
[MODELS.haiku]:  { displayName: "Claude Haiku 4.5",  inputPerMTok: 1, outputPerMTok: 5,  cacheWritePerMTok: 1.25, cacheReadPerMTok: 0.1 },
```

`FAST_MODE_PRICING` (pricing.ts:46-48): Opus at 2x on every component (8 / 40 / 10 / 0.4), "cache components assumed 2x". `BATCH_DISCOUNT = 0.5` (pricing.ts:20). `meter(usage, modelId, { batch?, speed? })` (pricing.ts:93-120) does integer arithmetic in millionths of a cent and returns `costMinor` (fractional cents), `costMinorInt`, `costMicroMinor`, a breakdown and `label: "Estimate"`. One flat price per model: no prompt-size tiers.

### 1.3 The live client (`packages/models/src/client.ts`)

One class, `LiveModelClient` (client.ts:222), built by `createModelClient(opts)` (client.ts:171-189). `MODEL_MODE` defaults to mock (`packages/shared/src/env.ts:10`); `effectiveModelMode` drops to mock when live has no key (client.ts:163-169).

Request construction, `plan(req)` (client.ts:334-363):
- model: `resolveModel(req.route, req.modelOverride, { lowCredits: req.lowCredits })` (client.ts:335).
- `max_tokens`: `req.maxTokens ?? opts.defaultMaxTokens ?? resolution.maxTokens` (client.ts:337-338). Limiter reservation: `req.reserveTokens ?? sized ?? ROUTE_RESERVE_TOKENS (4,096)`, clamped to `[1, maxTokens]` (client.ts:339).
- structured output: `structuredOutputFor(schema)` (client.ts:644-688). When the JSON schema has no open maps or untyped values it is sent as `output_config.format` (JSON schema only, without the SDK's `parse`, client.ts:662-667); otherwise a "## Response format" block is appended as the **last** system block (client.ts:342, 680-687).
- system: `buildSystem(blocks, cache)` (client.ts:709-713): one text block per string; with `cacheSystem` a single `cache_control: { type: "ephemeral" }` on the **last** block. No TTL option, no breakpoint on messages or tools, no second breakpoint.
- effort: `req.effort ?? resolution.effort`, sent as `output_config.effort` only when `MODEL_CAPABILITIES[modelKey].effort` (client.ts:349-355).
- `thinking`: never sent, on any model. `budget_tokens`: never sent.
- `temperature`: sent only when `resolution.modelKey === "haiku"` (client.ts:357-360). The only callers that pass one are the entity linker (`packages/entity-linker/src/sweep.ts:506`, `resolve.ts:304`, both `temperature: 0` on route `linker`).
- fast mode: `resolution.speed === "fast" && opts.fastMode` (client.ts:361); the call goes through `anthropic.beta.messages.create({ ...params, speed: "fast", betas: ["fast-mode-2026-02-01"] })` (client.ts:383-385) with its own limiter bucket (client.ts:366-368).
- no assistant prefill, no `tool_choice`, no tools at all (direct calls never use tools).
- API version: the SDK default (`@anthropic-ai/sdk` 0.131.0, `pnpm-workspace.yaml:127`); no `defaultHeaders`, no betas other than fast mode.

Calls:
- `complete()` (client.ts:246-309): non-streaming `messages.create(...).withResponse()`. At most three sends per request: the first, one repair (the validation issues quoted back, client.ts:298-307), one retry with `max_tokens` doubled up to `MAX_TOKENS_CEILING = 32_000` when a schema answer was cut at `max_tokens` (client.ts:286-297). Every send is metered and emitted (client.ts:265-270).
- `streamStructured()` (client.ts:316-331, `structured-stream.ts`): `messages.stream()`; elements of one array are validated and delivered as they complete; interrupted streams are metered from the partial usage (client.ts:466-473).
- timeouts and retries: `REQUEST_TIMEOUT_MS = 600_000`, SDK `maxRetries: 0`, `DEFAULT_MAX_ATTEMPTS = 4` (client.ts:84-86, 235-241). `handleAttemptError` (client.ts:492-530): billing refusal is final (`ModelBillingError`); fast mode falls back to standard on 429/400/403/404; 429 backs off the caller's `scope` only; 5xx and connection errors back off 0.5 s to 8 s with jitter; other 4xx throw `ModelRequestError`.
- refusal: with a schema, `stop_reason === "refusal"` throws `ModelOutputError(code "refusal")` carrying `stop_details` (client.ts:278-280; stream: structured-stream.ts:332-333). Without a schema the result is returned with `stopReason: "refusal"` and whatever text came (client.ts:276). No fallback model, no `server-side-fallback-2026-07-01` beta anywhere in the repo.
- abort: a call stopped after it was sent books the estimated prompt tokens, flagged `aborted` (client.ts:559-580).
- billing refusal: `billingRefusal(error)` (client.ts:748-756) recognises 400/402 "credit balance is too low", "reached your specified API usage limits" and 429 `enforced_spend_limit_reached`; platform-key refusals are recorded in process state for `/health` (`billing-state.ts`).
- key check: `validateKey()` (client.ts:533-552) sends `{ model: MODELS.haiku, max_tokens: 1, messages: [{ role: "user", content: "ping" }] }`.

Against the fact sheet, the direct client is compliant today on: no `budget_tokens`, no `thinking` parameter (so nothing is disabled on Sonnet or Opus), no `tool_choice`, no assistant prefill (the repair turn ends with a user message, client.ts:303-307), effort in `output_config.effort`, structured output in `output_config.format`, `temperature` kept off Opus and Sonnet. It is not ready for: Haiku 5.5 (A7-04), API version `2026-10-21` (which rejects `temperature` on every model, so the Haiku branch at client.ts:357-360 must go), refusal fallbacks (A7-13), batches (A7-12), a cache-hit check (A7-07).

Rate limiting (`rate-limit.ts`): one `RateLimiter` per client, buckets per key fingerprint for requests, input tokens, output tokens, refreshed from `anthropic-ratelimit-*` headers and interpolated linearly to the reset (rate-limit.ts:149-155). `acquire()` waits up to `maxWaitMs = 120_000` then throws `ModelRateLimitError` (rate-limit.ts:253-269). A 429 penalises one `scope` (rate-limit.ts:290-298). State is per process, not shared across replicas.

Metering: every send reaches `onUsage` once with `{ route, model, modelKey, mode, billedTo, usage, cost, scope, attribution, durationMs, occurredAt, requestId, attempt, streamed?, speed?, aborted? }` (types.ts:135-164; `emit`, client.ts:601-610). A sink that throws is logged and the event dropped.

Credits gate: `gateModelClient(inner, gate)` (`gate.ts:56`). The gate throws to refuse and may return `{ lowCredits: true }`, which the wrapper copies onto the request (gate.ts:28-30, 46-52).

Sinks and gates per service:

| Service | Client | Gate | Sink | Books `costMicroMinor` |
|---|---|---|---|---|
| api | `createApiModelClient` (`apps/api/src/services/models.ts:91-104`) | `apiCreditsGate` (models.ts:82-89) | `apiUsageSink` (models.ts:38-75) | yes |
| composer | `apps/composer/src/index.ts:80` | `creditsGate` (`apps/composer/src/usage.ts:19`) | usage.ts:39-47 | yes |
| orchestrator | `createBusinessModelClient` (`apps/orchestrator/src/models.ts:67-156`): platform key, or the business's own key for `model_billing = byok` | `assertCredits` (models.ts:112-123), platform route only | `usageSink` (`apps/orchestrator/src/deps.ts:64-88`) | yes |
| gateway, `quarantine` connector | `createQuarantinedReader` (`apps/gateway/src/builtins.ts:69-88`): own key for byok, else platform | **none** | `gatewayUsageSink` (builtins.ts:26-48) | **no** |
| gateway, pipeline reader | `createReaderModelClient` (`apps/gateway/src/reader-models.ts:34-36`): platform key always | **none** | `readerUsageSink` (reader-models.ts:10-32) | **no** |

Direct Anthropic calls outside `packages/models`: `web.search_web` (`packages/connectors/src/connectors/web/index.ts:107-126`, platform key, `resolveModel("worker").modelId`, server tool `web_search_20260209`, `max_uses: 1`, `output_config: { effort: "low" }`), and `anthropic.ask_panel` (`packages/connectors/src/connectors/anthropic/index.ts:66-72`, the business's own key only).

### 1.4 Agent SDK sessions (`apps/orchestrator/src/activities/session.ts`)

SDK: `@anthropic-ai/claude-agent-sdk` 0.3.291 (`pnpm-workspace.yaml:128`), imported only in `session.ts`.

Model choice is the same function as direct calls. `prepareSession` (session.ts:763-799): `route = template.route` (771); `lowCredits` is true only on the platform key, when the session's tools do not reach outside or spend and the module is not finance or legal, and `checkPlatformCredits(...).low` (775; `sessionKeepsModelOnLowCredits`, `session-credits.ts:31-33`); `model = resolveModel(route, agent.modelKey, { lowCredits })` (776). Each run re-checks the keep rule (`keptModelForRun`, session-credits.ts:48-53; session.ts:813-814). The id reaches the SDK at exactly one place, `model: launch.modelId` (session.ts:1742). A nudge can switch mid-session: `q.setModel(model.modelId)` (session.ts:1575-1591).

Key: `resolveApiKey` (session.ts:714-730): a byok business runs on its own key or is blocked (`credential`), never on the platform key; everyone else on `ANTHROPIC_API_KEY`.

Options passed to `sdk.query` (session.ts:1738-1781): `systemPrompt` (one string), `model`, `mcpServers` (one HTTP server per granted connector at `gateway/mcp/<key>`, session token in the headers, session.ts:1526), `tools` / `allowedTools` / `disallowedTools` from `sdkToolPolicyFor(task.kind, grants.mcpTools)` (`sdk-isolation.ts:114-123`: code tasks get Read, Glob, Grep, Edit, Write; every other kind gets `tools: []`), `maxTurns: launch.maxTurns` (`DEFAULT_MAX_TURNS = 60`, session.ts:74), `cwd`, `maxBudgetUsd` (the smaller of the session budget and the credits spendable at launch, session.ts:1752), `env` (`sdkEnvFor`, sdk-isolation.ts:75-100), `settingSources: []`, `strictMcpConfig: true`, `permissionMode: "dontAsk"`, a `PreToolUse` hook (pause gate and path guard), `abortController`, `persistSession: false`.

Not passed, although `sdk.d.ts` of 0.3.291 has them: `effort` (1913), `thinking` (1906), `taskBudget: { total }` (1940, sent as `output_config.task_budget` with the `task-budgets-2026-03-13` beta), `fallbackModel` (1684), `betas` (1716).

System prompt: `buildSystemPrompt` (`packages/agents/src/club-rules.ts:93-107`), in order: `## House rules` (the seven rules and the house style, `packages/agents/src/prompts/club-rules.ts:80-84`), `## What you do`, `## Your instructions` (role, goals, rules, playbook, tone, examples), `## Skills` (role skills first, then the founder's added skills, each in a `<skill>` block, club-rules.ts:63-68), `## Glossary`, `## Business brief` (the cycle brief, last). Added skills: up to 8 per agent and 60,000 characters in total (`packages/agents/src/skill-files.ts:27,29`), always inlined in full.

First user message (session.ts:1530): `# Task`, the goal, acceptance criteria, a code or no-file note, hand-back and checkout notes, a resume note.

Usage: `SessionUsage` (session.ts:254-294). `onResult(modelUsage)` takes the SDK's cumulative `modelUsage` and stores `tokensIn = inputTokens + cacheReadInputTokens + cacheCreationInputTokens`, `tokensOut`, `costMinor = costUSD * 100` (265-271). `onAssistant` prices an open turn with this repo's `meter()` (276-283). `agent_sessions` stores only `tokens_in`, `tokens_out`, `cost_minor` (`packages/db/src/schema/agents.ts:373-375`). The SDK result also carries `num_turns` and per-model cache counts (sdk.d.ts:5680, 5693); neither is stored.

Booking: on the platform key the session books as it runs, every finished turn and every 15 s (`SESSION_CREDIT_CHECK_MS`, session-credits.ts:56; `settleNow`, 119-147; mid-turn settle at session.ts:1701), rows `kind: "tokens"`, `details: { source: "claude-agent-sdk", label: "Estimate", partial: true }`, whole cents only. `finishSession` books the rest under idempotency key `session:<id>:tokens` (session.ts:937-940) after subtracting `repos.usage.sessionTokens` (`packages/db/src/repos/usage.ts:293-299`). Sandbox time: `session:<id>:sandbox` rows (session.ts:928-933) at `SANDBOX_MICRO_MINOR_PER_SECOND.e2b = 3_025` (`packages/config/src/pricing.ts:42`).

Budget: `sessionBudget` (`apps/orchestrator/src/activities/session-budget.ts:96-112`) = the smallest of the task budget (own, else `DEFAULT_TASK_RESERVE_MINOR = 2_000`, `apps/orchestrator/src/cycle-contract.ts:66`) less earlier sessions on the task, credits left (platform key), the agent's wage cap left, the monthly model budget left, and a cycle cap.

### 1.5 Gateway pipeline for one tool call (`apps/gateway/src/pipeline.ts`)

Entry points: `POST /v1/call` and `ALL /mcp/:connector`, both behind `requireSession` (`apps/gateway/src/app.ts:348-356`) and both calling `executeToolCall` (pipeline.ts:286-364). MCP `tools/list` shows only tools the token allows (`visibleTools`, `mcp.ts:25-27`).

1. **Authenticate.** `verifySessionToken` (`tokens.ts:126-132`): HS256 under `SESSION_TOKEN_SECRET`, issuer and audience `foundmill-gateway/session`, `exp` and `iat` required. Claims: `{ businessId, agentId, sessionId | null, allowedTools[] (max 500), kitMode, untrustedSeeded }` (tokens.ts:27-44). Minted at `POST /v1/session-tokens` (app.ts:287-327) by any service holding a service token: the business, the agent and the session row must exist, the session must be the agent's, and the state must allow work. `allowedTools` and `kitMode` are taken from the caller as given. The orchestrator asks for 4 hours (`SESSION_TOKEN_TTL_SECONDS`, session.ts:75).
2. **Service-only refusal.** `refuseServiceOnly` (pipeline.ts:278-280) for connectors agents never reach (`openai_images`).
3. **Grant / scope.** `toolAllowed(session.allowedTools, connector, tool)` (tokens.ts:75-79; pipeline.ts:297-303) → 403 deny, policy id `session-scope`, audited.
4. **Connector and tool.** `registry.get(key, modeFor(deps, key))` (pipeline.ts:305-314). Unknown connector or tool → 404 (`unknown_connector`, `unknown_tool`). `modeFor` (pipeline.ts:132-134): live when `INTEGRATIONS_MODE=live`, or the connector's mode key is in `LIVE_CONNECTORS`, or the connector is `platform` or `quarantine` (`ALWAYS_LIVE_CONNECTORS`, `packages/connectors/src/catalogue.ts:133`).
5. **Rate limit.** `checkRateLimit` per connector per business (pipeline.ts:316-329; `rate-limit.ts:259`, default 600 a minute) → 429 `rate_limited`.
6. **State, before Cedar.** `loadContext` (pipeline.ts:387-398): `stateDenial(business, agent)` and `checkByokKey` (`state.ts`): archived business, `agents_stopped_at` set (Stop all agents, revoked key, credits used up), released or paused agent, or a byok business whose key is gone for the `anthropic` and `quarantine` connectors → 403 with a stable policy id, audited.
7. **Policy input.** `buildPolicyInput` (pipeline.ts:456-524): tool hints from `connector.policyHints[tool.name] ?? {}` (458), every hint defaulting to false (465-469); `finance` and `contract` from gateway sets (pipeline.ts:238-246); `securitySettings` from the call's arguments (`security-settings.ts`); principal from the agent row (autonomy, spend cap tightened by a holiday ceiling, approval threshold lowered to the business cap); `amountMinor` = `policyAmountMinor` (450-454: never below the connector's own estimate; a spending tool the connector cannot price is treated as above the threshold); recipient checks only for `contactsThirdParty` tools (suppression list, first seen in untrusted content, unconfirmed followers, a missing seed fails closed, 495-506); `kitMode` from the token, never from the call (521).
8. **Evaluate.** `evaluate(input, engine)` (`packages/policy/src/evaluate.ts:93-141`). Cedar policies (`packages/policy/src/policies/*.cedar`):
   - `00-hard-gates`: forbid when `resource.hardGate` or `resource.securitySettings`, every mode.
   - `10-recipients`: forbid a third-party contact to a suppressed recipient or one first seen in untrusted content.
   - `20-finance`: forbid a finance tool that spends.
   - `30-kit-mode`: forbid a kit-mode tool outside a kit-mode session.
   - `40-spend-cap`: forbid a spend above `principal.spendCapMinor`.
   - `45-release`: `github:merge_pr` always asks.
   - `50-augmented`: ask for `contactsThirdParty`, `spendsMoney` or `irreversible`; allow the rest.
   - `60-assisted` (the default mode, `packages/db/src/schema/accounts.ts:196`): allow when the amount is within the threshold and the tool is neither `irreversible` nor `contract`; ask above the threshold, for irreversible, for contract.
   - `70-automated`: allow within the threshold, ask above.
   Deny beats ask beats allow. No matching permit → deny "No policy permits this call" (evaluate.ts:129-131). Any engine failure or policy error → deny (evaluate.ts:103-125).
9. **Deny** (pipeline.ts:575-601): audit, 403; a hard gate also queues a founder task.
10. **Ask** (pipeline.ts:351-361, 703-734): `repos.approvals.useGranted` matches an approval of this exact call (session or agent, connector, tool, args, amount, currency) and runs it once under it (`runUnderApproval`, 371-385; a call that did not run gives the approval back). Otherwise an `approvals` row, `approval.requested` and an Inbox decision item; the response carries `approvalId`.
11. **Allow** (pipeline.ts:736-930):
    - credential (739-753): a stored credential is decrypted in memory for this call (`loadCredential`, `credentials.ts:43`); GitHub uses a verified App installation (`appInstallationVerified`, 144-148); a `platformKey` connector runs on the platform's secret only when the business connected it (`platformKeyConnected`, 154-156). Live with nothing usable → 409 `integration_not_connected` (751-753). No path falls back to a platform key for an `api_key` connector.
    - `not_connected` in mock (757-759): a mock connector the business never connected is refused with 409 on staging and production for a person's own business (`mockResultsAllowed(appEnv, isDemo)`, `packages/shared/src/channel-availability.ts:18`).
    - guards after Cedar: GitHub push settings (785-791), the platform sending address (794-805), the Resend unsubscribe link (809-813), IndexNow page binding (764-769).
    - `connector.callTool(tool, args, ctx)` (815-825). A hard-gated tool is also refused inside the connector itself, returning a human-action descriptor (`packages/connectors/src/testing/contract-suite.ts:141-152` holds every connector to it).
    - `untrusted` wrapper (832-885): recipients in the content are recorded for the business; the agent gets `toAgentEnvelope` (`packages/connectors/src/quarantine.ts:245-248`: `{ untrusted: true, content, source, notice, facts? }`). First-party GitHub reads of the Code-tab repository pass raw; a foreign archive is withheld; a session whose tools can reach outside, spend or do something irreversible (`grantsOutboundTools`, `untrusted-reader.ts:84-95`) gets the quarantined reader's digest instead of the content; a reader failure withholds the content.
    - `simulated` (923): a mock call's result carries `simulated: true` and `notice: SIMULATED_NOTICE` (`types.ts:100-101`).
    - audit first (890-900), then `bookUsage` of a `kind: "tool"` row (902-915), which can only log on failure.
12. **Audit.** Every outcome writes `tool.call` through `appendAudit` (pipeline.ts:550-573) with the args hash and key names only.

Service routes that reach vendors without the pipeline, all behind a service token and almost all `svc: api` only (app.ts:141-345): integrations connect and health, keys validate, registry lookup, billing checkout, domains check, persona portraits, speech, push, turnstile, follow confirmation, notify email. `GET /v1/connectors` has no auth (app.ts:139).

### 1.6 Credits, plans and billing

Tiers (`packages/config/src/pricing.ts:18-22`), quoted:

```ts
export const TIERS = {
  free:  { priceMonthly: null,  modelBilling: "credits_or_byok", businesses: "unlimited", includedCreditBusinesses: 1,           maxConcurrentAgents: 4,  channels: "all", seats: "unlimited", includedCreditsMinor: 500 },
  pro:   { priceMonthly: "TBD", modelBilling: "credits_or_byok", businesses: "unlimited", includedCreditBusinesses: 3,           maxConcurrentAgents: 16, channels: "all", seats: "unlimited", includedCreditsMinor: "TBD" },
  scale: { priceMonthly: "TBD", modelBilling: "credits_or_byok", businesses: "unlimited", includedCreditBusinesses: "unlimited", maxConcurrentAgents: 64, channels: "all", seats: "unlimited", includedCreditsMinor: "TBD", prioritySupport: true },
} as const;
```

`includedCreditsMinor(tier)` (pricing.ts:54-57) returns the free tier's 500 for a tier whose size is "TBD". Credits are USD cents (`CREDITS_CURRENCY`, pricing.ts:34).

Tables (`packages/db/src/schema/finance.ts`): `usage_ledger` (141-175), `credit_balances` (179-195, one row per business and `YYYY-MM` period), `credit_lots` (203-217, a paid top-up, 12 months, `CREDIT_LOT_MONTHS`, `repos/usage.ts:103`), and `billing_checkouts` (`packages/db/src/schema/payments.ts:18`; repo `repos/checkouts.ts`).

The one write path is `bookUsage(db, businessId, input)` (`packages/db/src/billing.ts:158-180`), one transaction:
1. writes the ledger row (`repos.usage.recordOnce`, idempotent on `idempotency_key`), recording `details.funding`;
2. if `chargesCredits(entry)` (billing.ts:82-87: `billed_to = 'credits'`, kind not `tool`, currency USD, not funded by the founder's own plan), calls `chargeCreditsMicro` (`repos/usage.ts:445-485`): creates the period row with the included credits when missing (`includedCreditsFor`, billing.ts:143-150, one pool per founder: `includedCreditBusinesses` places a month), expires dead lots, adds the cost to a per-period carry and charges whole cents, takes included credit first and lots by expiry;
3. below the low line posts one Inbox note a month (`creditsLowNotice`, billing.ts:415-446);
4. on the charge that empties the balance: a business on credits is stopped (`stopBusinessAgents(reason: "credits_exhausted")`, an Inbox warning that blocks Continue, `pauseForCredits`, billing.ts:367-406); a byok business gets a note only (`noteForOwnKey`, billing.ts:467-488).

Ask first: `checkPlatformCredits` / `assertPlatformCredits` (billing.ts:286-330). Refuses when the business is stopped for credits this period or the balance is zero (`exhausted`), or, where calls are live, when only credits from a simulated payment are left (`mock_only`); throws `CreditsExhaustedError` (402, `packages/shared/src/errors.ts:23`). Returns `low` when the spendable amount is under `lowCreditsThresholdMinor(included)` = `max(100, 20 % of included)` (`packages/config/src/pricing.ts:71-82`): on the free plan, below $1.00.

Low credits (#118): the api, composer and orchestrator gates pass `lowCredits` to the client; routing moves routine routes down (table in 1.1). Sessions decide at `prepareSession` (1.4).

Zero credits, what the founder sees (free plan), `creditsWayBack` (billing.ts:350-360): Inbox warning "Credits used up: team paused", body "The free plan includes $5.00 of model use a month, and this month's is used up, so every agent is paused. Add your own Anthropic key in Settings → Keys to keep the team working (your key is billed by Anthropic, not by us) ... Or wait for next month's credits on <date>, then press Resume agents." Every platform-key call answers 402 with a sentence (billing.ts:323-328). What stops: every agent (paused), cycles, sessions, training, conversations at the desk, Refresh, planning, recommenders. A stored key or a settled top-up lifts the stop by itself (`resumeBusinessAgents`, `packages/db/src/controls.ts:60`).

Top-ups (`apps/api/src/routers/billing.ts:78-83`, `apps/api/src/services/payments.ts`): `billing.topUp({ amountMinor: 500..1_000_000 })`, offered amounts `[2500, 5000, 10000, 25000]` (payments.ts:23-26). Live means a Stripe Checkout session created by the gateway (`apps/gateway/src/billing.ts`, `POST /v1/billing/checkout-sessions`) and credits granted only by the platform Stripe webhook in apps/ingest through `settleCreditCheckout` (`packages/db/src/payments.ts:48`). Live only when `INTEGRATIONS_MODE=live` or `LIVE_CONNECTORS` names `stripe_billing` (`PLATFORM_BILLING_LIVE_KEY`, `packages/shared/src/env.ts:300`) on both the api and the gateway. Otherwise the checkout is simulated, allowed only where `ALLOW_MOCK_PAYMENTS` is on (default: development and test, env.ts:327-328), and its credits never pay for a live call.

Paid tiers: `billing.changeTier` (billing.ts:67-75) calls `assertTierAvailable` (payments.ts:82-85): a tier whose `priceMonthly` is not null is refused (412) outside development and test. There is no subscription checkout in the repo.

Bring your own key (`apps/api/src/routers/integrations.ts:216-221`, `apps/api/src/services/keys.ts`): `validate`, `setAnthropic`, `rotate`, `revoke` (admin). `storeAnthropicKey` (keys.ts:86-124) validates through the gateway when models are live (`POST /v1/keys/validate`, `apps/gateway/src/keys.ts:61-108`: the one-token call, then `models.list` for the routed models; 10 a minute and 100 a day per business), seals `{ kind: "api_key", secret }` with the vault under a row-bound AAD, sets `model_billing = byok` and resumes a team stopped for a revoked key or used-up credits. `revokeAnthropicKey` (keys.ts:126-167) revokes, moves back to credits, stops the team, posts a note. Only the gateway and the orchestrator decrypt (`loadByokApiKey`, `packages/db/src/byok.ts:40`).

Funding source (#118, 0104): `businesses.funding_source`; `agentWorkFunding` (billing.ts:107-110) returns `own_plan` only when `FLAGS.ownPlanFunding` is on and the provider is in `OWN_PLAN_PROVIDERS`; both are off / empty (`packages/config/src/flags.ts:10, 20`).

Allowances (`apps/api/src/services/model-limits.ts`): `modelLimited(name)` middleware (120-133) spends one hit of the procedure's rule and one of `SHARED_MODEL_LIMITS` (per person 60 a minute, 600 an hour, 3,000 a day; per business 1,200 an hour, 6,000 a day; 34-37), refunds when no model call started. Rules (39-76) include training 20 an hour per person and 60 a day per business, session starts 30 an hour and 200 a day, Continue 20 a minute and 120 an hour, commit 10 an hour and 30 a day. Ideation has its own: 20 drafts an hour, 60 a day per person (`apps/api/src/services/ideation.ts:41-45`). All are request counts; none is a dollar amount.

---

## 2. What is live vs off in production, and how I know

I did not query any deployment (hard rule). Sources: `docs/DEPLOY.md`, code defaults, and the production facts supplied with the task. Anything marked "documented" needs a look at the Railway variables before it is relied on.

| Thing | State | Evidence |
|---|---|---|
| Models | live on api, composer, orchestrator | DEPLOY.md §3 table ("`MODEL_MODE` live on api, composer and orchestrator once `ANTHROPIC_API_KEY` is set"); the supplied facts show real token spend on opus and sonnet routes |
| Gateway model mode | mock unless set | DEPLOY.md §3 "`mock` elsewhere". If so, the quarantined reader runs on the mock client in production and its digest is fixture text. Not verified |
| Integrations | mock, with `LIVE_CONNECTORS=github,domains` | DEPLOY.md:272 (dated 2026-10-15), THESIS_REVIEW 7.3. Later connectors (sendgrid, elevenlabs, onesignal, the founder's-own-key set) are documented as opt-in per service |
| Fast mode | off | `MODEL_FAST_MODE` defaults false (`env.ts:14`); DECISIONS 2736-2741 "Fast mode stays off" |
| Message Batches API | not implemented | no `messages.batches` call anywhere; `batch: true` exists only on `ROUTES.nightlyBatch`; `meter` is never called with `batch` |
| Own-plan funding | off | `FLAGS.ownPlanFunding = false`, `OWN_PLAN_PROVIDERS = []` |
| Top-ups | not purchasable (documented) | needs `stripe_billing` live on api and gateway plus `STRIPE_SECRET_KEY`; DEPLOY.md:73-75 lists it as "when credit top-ups take real payments"; THESIS_REVIEW 4.5 says it is not in the live connectors. With billing mock and `ALLOW_MOCK_PAYMENTS` unset on staging and production, `topUpAvailability` returns `available: false` (payments.ts:56-60) |
| Paid plans | not purchasable | `priceMonthly: "TBD"`; `assertTierAvailable` refuses outside development and test; no subscription checkout exists |
| Free allowance | $5.00 a month, one business per founder | `TIERS.free.includedCreditsMinor = 500`, `includedCreditBusinesses = 1` |
| Low-credits routing | live (code path, no flag) | billing.ts:304; routing.ts:259-284; session.ts:775 |
| Sign-up | invite-only (documented) | DEPLOY.md:148 "Production stays invite-only": `SIGNUP_ALLOWLIST` set, `SIGNUP_OPEN` unset |
| BYOK | live | $94 of the $119 real spend is one project on its own key (supplied fact) |
| Server-side refusal fallback, task budgets, effort on sessions | off (never sent) | grep: none of `server-side-fallback`, `taskBudget`, `fallbackModel`; `sdk.query` options at session.ts:1738-1781 |

---

## 3. Findings

Severity: P0 stop-ship, P1 fix before sign-up widens or the next price decision, P2 fix this quarter, P3 tidy. No P0 was found in this area. Dollar figures derived from list prices are Estimates.

### P1

#### A7-01 (P1) Two thirds of session spend buys a blocked task; nothing checks before the model starts

- Evidence. Supplied: 319 real sessions, 25 % done, 67 % blocked, 7 % failed; opus-route sessions average $0.41, sonnet $0.14. Code: `prepareSession` (session.ts:763-799) checks only the pause, the stop flag, grants and the model; the live run adds the key, the credits and the budget (session.ts:1426-1447). Whether the task can be done with the tools the agent holds is found out by the model, turn by turn: the agent blocks its own task (session.ts:915-921) or meets `integration_not_connected` at the gateway (pipeline.ts:751-759) after the whole context is built and cached. PROGRESS.md:1372 records two Planner sessions costing 287 cents that ended "no task-update tool".
- Impact. Cost per finished session is $0.41 / 0.25 = $1.64 on the opus route and $0.14 / 0.25 = $0.56 on sonnet. On the free plan's $5 that is 3 finished lead tasks or 9 finished worker tasks a month. This is the largest lever in the area: every other saving multiplies a number that is three-quarters waste.
- Fix.
  1. Record why. Migration `0108_session_outcome_detail.sql`: add to `agent_sessions` `blocked_reason text`, `num_turns integer`, `cache_read_tokens bigint not null default 0`, `cache_write_tokens bigint not null default 0`, `route text`. Fill them in `finishSession` (session.ts, where `result.blockedReason` is already known) and from the SDK result (`message.num_turns`, `modelUsage[*].cacheReadInputTokens`, session.ts:1822). Extend `SessionUsage` (session.ts:254-294) with `cacheRead`, `cacheWrite`, `turns`.
  2. Preflight without a model, in `prepareSession`: for each connector in `grants.servers`, ask the same question the gateway will (`modeFor` + integration row + `mockResultsAllowed`); expose it as a pure function in `packages/connectors` (for example `preflightGrants(grants, { integrations, appEnv, isDemo, liveConnectors }) → { usable: string[]; notConnected: string[] }`) and have the gateway's 409 branch call the same function. When a task's required capability (from `task.kind` and the template's `taskKinds`) has no usable tool, return a launch that finishes `blocked` with reason `not_connected` and no SDK process. Tests: `apps/orchestrator/src/__tests__/session.test.ts` (no model call, no token minted, task blocked with the connector's name).
  3. A cheap triage before a lead or planner session: one `classifier`-route call ("can this goal be met with these tool names? yes / no / what is missing"), a few hundred tokens. Eval: `pnpm evals` case set from the 213 blocked sessions' task goals and tool lists.
  4. First turn rule in the task prompt (session.ts:1530): "If a tool you need is missing or not connected, block the task in your first turn; do not explore." Pair with `maxTurns` 25 (A7-09).
  5. Report: Appendix B query 6 ranks blocked sessions by reason once step 1 ships; until then join `events` of type `task.blocked` by `session_id`.

#### A7-02 (P1) Model calls before a business exists are neither booked nor capped in dollars

- Evidence. `apiUsageSink` returns early without a business (`apps/api/src/services/models.ts:40-41`); the gate checks credits only with a business (models.ts:84). Ideation, Ask on a concept and a logo before commit carry `attribution: { kind }` only (`apps/api/src/services/ideation.ts:257, 285, 327, 393`; `conversation.ts:1130`). The only ceiling is a request count: 20 drafts an hour and 60 a day per person (ideation.ts:41-45), where one draft is a slate plus up to 12 card calls, each retried once (ideation.ts:34), all on Opus (`ROUTES.ideation`, `ideationSlate`).
- Impact. (a) THESIS 7.1 cannot be answered: the cost of a founder's first session up to Take charge is in no table. (b) Worst case per account per day is 60 x 25 = 1,500 Opus calls, all on the platform key, charged to nobody. Under open sign-up (`SIGNUP_DAILY_CEILING` default 200, env.ts:227) this is the largest unbounded exposure of the platform key. Today sign-up is invite-only (documented), so the exposure is latent.
- Fix.
  1. `UsageAttribution.userId?: string` (`packages/models/src/types.ts:40-47`); set it on every call the api makes for a signed-in person.
  2. Migration: table `user_usage_ledger (id uuid pk, user_id uuid not null, kind text not null, route text, model_key text, quantity bigint not null default 0, cost_micro_minor bigint not null default 0, occurred_at timestamptz not null default now(), details jsonb not null default '{}', idea_id uuid null)`, service-written, index `(user_id, occurred_at)`. No `business_id`, so no tenant RLS; grant to `service_role` only (same pattern as `public_page_grants`, 0081).
  3. `apiUsageSink`: when `businessId` is absent and `userId` present, insert there.
  4. A dollar allowance before commit: `LIMITS.preCommitDailyMinor = 100` and `LIMITS.preCommitLifetimeMinor = 300` (packages/config/src/limits.ts), checked in `apiCreditsGate` for calls without a business; refusal text in plain words ("You have drafted a lot today. Take charge of one idea to keep going, or come back tomorrow.").
  5. At `idea.commit`, copy the person's pre-commit rows for that idea into the business ledger as `details.preCommit = true`, `billed_to = 'credits'`, **not** charged (use `repos.usage.record`, not `bookUsage`), so first-session cost is one query (Appendix B query 3).
  6. Route cards to Sonnet (Appendix A) once the ideation eval holds.
  Tests: `apps/api/src/__tests__/credits-ceiling.test.ts` (a looped draft stops at the dollar line with nothing called), a new `user-usage.test.ts`.

#### A7-03 (P1 before `web` goes live, P2 today) Three gateway model paths skip the credits gate; two round costs to whole cents; web search bypasses `packages/models`

- Evidence.
  - `createReaderModelClient` (`apps/gateway/src/reader-models.ts:34-36`) and the client in `apps/gateway/src/index.ts:108` are plain `createModelClient` results: no `gateModelClient`, no `assertPlatformCredits`. `packages/models/CLAUDE.md` states the invariant "Services on the platform key wrap their client with `gateModelClient`".
  - Both sinks pass `costMinor: event.cost.costMinorInt` and no `costMicroMinor` (`builtins.ts:38`, `reader-models.ts:22`), so `recordOnce` books `costMinor * 1,000,000` (`repos/usage.ts:138`). A digest of 24,000 characters (`READER_MAX_CHARS`, untrusted-reader.ts:46) is about 6,000 input tokens: 0.6 cent on Haiku 4.5, booked as 1 cent or as 0. The other three services pass the exact cost.
  - The pipeline's reader always runs on the platform key (reader-models.ts:35), while the `quarantine` connector runs on the business's own key for a byok business (builtins.ts:69-80) and `state.ts:45-49` says the reader "runs on the club's own key too". A byok business's reads are charged to its platform credits and keep running at zero.
  - `web.search_web` builds its own `new Anthropic({ apiKey: secrets.anthropicApiKey })` (`packages/connectors/src/connectors/web/index.ts:107-126`): no limiter, no gate, no `tokens` row. Its only booking is the pipeline's `kind: "tool"` row, which `chargesCredits` excludes (billing.ts:83). Limits: 30 a minute, 1,000 a day per business (`web/tools.ts:97`).
- Impact. Today (documented: `web` mock, gateway models possibly mock) the spend is small or nil. The day `web` is added to `LIVE_CONNECTORS`, each business can run 1,000 Sonnet web searches a day on the platform key at no charge to its credits, with credits at zero, on the free plan.
- Fix.
  1. `apps/gateway/src/index.ts`: build one `creditsGate(db, live)` (copy `creditsGate`, `apps/composer/src/usage.ts:19`) and wrap both clients: `gateModelClient(createModelClient(...), creditsGate)`. In `createQuarantinedReader.clientFor` gate only the platform branch.
  2. Add `costMicroMinor: Math.max(0, event.cost.costMicroMinor)` to `gatewayUsageSink` and `readerUsageSink`; better, delete `readerUsageSink` and reuse `gatewayUsageSink`.
  3. Make the pipeline reader use `createQuarantinedReader`'s `clientFor(businessId)` so a byok business pays on its own key in both paths; fix the comment in `state.ts`.
  4. `search_web`: either (a) add `ModelClient.searchWeb({ query, limit, attribution, scope })` to `packages/models` (route `worker`, same limiter, same sink, same gate), inject it into the web connector through `LiveConnectorOptions` as the quarantined reader is injected, or (b) at minimum return the real token cost in `ToolResult.costMinor` and have the gateway book a second `kind: "tokens"`, `billed_to: "credits"` row for `web:search_web`. Prefer (a). Add `web` to the list of connectors that require `assertPlatformCredits` before the vendor call.
  Tests: `apps/gateway/src/__tests__/untrusted-reader.test.ts` (reader refused at zero credits → content withheld with `READER_UNAVAILABLE`), `builtins.test.ts` (micro cost booked), `web-fetch.test.ts` (search refused at zero credits; a tokens row written).

#### A7-04 (P1) The six Haiku routes, and every low-credits session, run on Haiku 4.5 at ten times the current Haiku price; the client cannot run Haiku 5.5 as written

- Stale against the fact sheet: `MODELS.haiku = "claude-haiku-4-5-20251001"` (routing.ts:24) at $1 / $5 (pricing.ts:38). Current: `claude-haiku-5-5` at $0.10 / $0.50 for prompts up to 100K tokens, $0.50 / $2.50 beyond. Opus and Sonnet ids and base prices match.
- What it saves. Ten times on input and output for `linker`, `classifier`, `categoriser`, `quarantinedReader`, `moderation`, `founderTitle`, and for the `lowCredits: "haiku"` targets (`worker`, `journeyCommentary`, `nightlyBatch`). A 6,000-in / 300-out reader digest goes from about 0.75 cent to about 0.08 cent. A worker session of 222k cumulative input and 3.7k output that costs $0.14 on Sonnet would cost roughly 1 to 2 cents on Haiku 5.5 (Estimate; assumes each request stays under 100K and the same cache ratio). Size the saving with Appendix B query 2 (`model_key = 'haiku'`); on today's volume it is small in dollars, and it is what makes the worker move in Appendix A possible.
- What breaks.
  1. `routing.test.ts:6` pins the exact `MODELS` object; `pricing.test.ts:27, 31, 56` assume $1 / $5; `client.test.ts:308-317` asserts that `temperature` reaches Haiku.
  2. `MODEL_CAPABILITIES.haiku.effort = false` (routing.ts:94) and `ALWAYS_THINKS.haiku = false` (routing.ts:104): Haiku 5.5 has effort and thinks by default at `medium`. With `ALWAYS_THINKS.haiku = true`, `maxTokensFor` raises every Haiku route from 4,096 to 16,000 (or 8,000 at `low`) (routing.ts:290-293); callers that pass their own small `maxTokens` (a classifier at a few hundred) would have thinking eat the budget and return `max_tokens` with no JSON, which costs a doubled retry (client.ts:286-297).
  3. `temperature` (client.ts:357-360) is sent exactly when the model key is `haiku`; Haiku 5.5 rejects non-default values, so `packages/entity-linker/src/sweep.ts:506` and `resolve.ts:304` (`temperature: 0`) would return 400 on every linker call.
  4. The client has no way to send `thinking` (no field on `CompleteRequest`, nothing in `plan()`), so thinking cannot be turned off on the Haiku routes where it buys nothing.
  5. `meter()` has one price per model (pricing.ts:93-120): no 100K step.
  6. `validateKey()` pings `MODELS.haiku` with `max_tokens: 1` (client.ts:535); `anthropic` connector `connect` calls `client.models.retrieve(MODELS.haiku)` (`packages/connectors/src/connectors/anthropic/index.ts:78`) and `validate_key` reports the routed models: a founder key must reach the new id.
  7. Sessions moved to Haiku by the credit saver are priced by the SDK's own table (`costUSD`, session.ts:270) and, for open turns, by `meter()` (session.ts:281-282): check that SDK 0.3.291 prices `claude-haiku-5-5` and its tier, or bump the SDK.
  8. `LISTED_UNROUTED_MODELS` (routing.ts:85-88) and the mock `list_models` should list Haiku 4.5 as not routed.
- Fix (one PR, `packages/models` first).
  1. routing.ts: `haiku: "claude-haiku-5-5"`; `MODEL_CAPABILITIES.haiku = { effort: true, fastMode: false }`; replace `ALWAYS_THINKS` with `THINKING: Record<ModelKey, "always" | "default_on" | "off">` = opus `always`, sonnet `always`, haiku `default_on`; add `thinking?: "off"` to `RouteDefinition` (allowed only on a `default_on` model; `resolveModel` drops it otherwise) and `effort: "low"` on the six Haiku routes; `maxTokensFor` returns the route budget when thinking is off.
  2. client.ts `plan()`: send `thinking: { type: "disabled" }` when the resolution says off; never send `temperature` (delete lines 357-360, keep the debug log); remove `temperature` from the two linker calls and from `CompleteRequest` docs.
  3. pricing.ts: `ModelPrice.longPrompt?: { overTokens: number; inputPerMTok; outputPerMTok; cacheWritePerMTok; cacheReadPerMTok }`; `meter` picks it when `inputTokens + cacheCreationInputTokens + cacheReadInputTokens > overTokens`. Haiku 5.5: base 0.10 / 0.50, long 0.50 / 2.50; take the cache prices from the price page (not in the fact sheet). `PRICING_AS_OF = "2026-11-15"`.
  4. `validateKey`: add `thinking: { type: "disabled" }` and `max_tokens: 16`.
  5. Tests: `routing.test.ts`, `pricing.test.ts` (tier boundary at 100,000 and 100,001), `client.test.ts` (no `temperature` in any request body; `thinking` disabled only on Haiku routes; Sonnet and Opus bodies unchanged), `packages/entity-linker` tests, `apps/gateway keys` tests. Evals: the quarantined-reader injection set, the typed-read set (`.github/workflows/evals-typed-reads.yml`), moderation and the linker, live, before merge.

#### A7-05 (P1) At zero credits a free founder has one exit, and it is "paste an Anthropic key"

- Evidence. Top-ups need `stripe_billing` live on the api and the gateway (payments.ts:34, 56-60; `apps/gateway/src/billing.ts`); DEPLOY.md:73-75 and THESIS_REVIEW 4.5 say it is not. With billing mock and simulated payments off, `billing.topUp` answers 412 "Top-ups are not available on this server yet" (payments.ts:47, 118-119). Paid tiers are refused (payments.ts:71-85). The free-plan Inbox note names only the key (billing.ts:351-355). The top-up minimum offered is $25 (`TOP_UP_OPTIONS_MINOR`, payments.ts:26), five months of the free allowance; the api accepts from $5 (`TOP_UP_MIN_MINOR`).
- Impact. THESIS 7.2 is open. The supplied facts say most free projects spend under $2 a month, so few reach this wall today; the ones that do are the active ones the north star counts.
- Fix. (1) Turn `stripe_billing` live per DEPLOY §5.5 after a test-mode run of checkout → webhook → `settleCreditCheckout` → resume; (2) offer `[500, 1000, 2500, 5000]`; (3) in `creditsWayBack` (billing.ts:350-360) name the top-up first for the free plan once `topUpAvailability(env).available`; pass availability into `bookUsage`'s note builder or read `platformBillingMode(env)` there; (4) decide Pro's price and included credits from Appendix B queries 4 and 5 (the code already handles a numeric `priceMonthly` and `includedCreditsMinor`), then build the subscription checkout (none exists). Tests: `apps/api/src/__tests__/billing-checkout.test.ts`, `packages/db/src/__tests__/payments.test.ts`, `credit-lots.test.ts`.

#### A7-06 (P1) One training run costs two and a half monthly free allowances, and pressing Train on the free plan ends in a paused team

- Evidence. `runSkillTests` (training.ts:181-287): for every skill of the agent, every test (12 to 30 per skill, `LIMITS.skillTestsPerSkill`, limits.ts:30; held-out included) makes one candidate call on the agent's route and model with the full system prompt (training.ts:235-244) and one grader call on `skillGrader` = Opus at the default effort with a 16,000-token budget (training.ts:84-95, 265). Nothing is batched, the grader prompt is not cached, and the candidate's cache breakpoint sits on a per-test block (A7-11). The api's own estimate is 4,000 in + 1,200 out for the candidate and 2,500 in + 400 out for the grader (`apps/api/src/routers/agent.ts:77-78`): 4.0 + 1.8 = 5.8 cents a test on Opus before thinking tokens. $12.78 / 5.8 cents is about 220 tests, for example 11 skills at 20 tests: one agent. The estimate ignores thinking, which Opus bills as output, so the true test count is lower.
- What stops it: `MODEL_LIMITS.training` counts requests (20 an hour per person, 60 a day per business, model-limits.ts:63); `agent.training.estimate` (agent.ts:250-260) shows a figure but `agent.training.run` (agent.ts:267) does not compare it with the balance. On the platform key each call passes the credits gate, so a free run spends the whole $5, the charge that empties the balance stops the team (billing.ts:176-178), the run ends canceled or failed with partial results (training.ts:15-18; the refused call is a non-retryable 402, `apps/orchestrator/src/models.ts:120`) and no rating changes.
- Fix, in order of saving (Estimates):
  1. Grader to Haiku 5.5 at `effort: "low"` with the rubric prompt cached, or Sonnet at `low` if the grader eval disagrees: the grader's 1.8 cents becomes about 0.05 cent. Deterministic checks are already authoritative (`scoreTest`, training.ts:46-50), so the grader only fills the rubric.
  2. Run training through the Message Batches API (A7-12): nobody waits on it (the UI shows 2 to 5 minutes, agent.ts:259), 50 % off both calls. Offer "Run tonight (half price)" as the default and "Run now" as the full-price option.
  3. Candidate at `effort: "low"` and the cache breakpoint on the stable block (A7-11).
  4. Test only what changed: diff the draft's instructions against the live version; a skill whose lines did not change keeps its rating. First pass 6 tests per changed skill (always including the held-out ones), the full set only before Promote.
  5. Refuse a run the balance cannot finish: in `agent.training.run`, compute the estimate and compare with `checkPlatformCredits(...).spendableMinor`; when it is larger, answer 402 with the two figures and the options (fewer skills, tonight at half price, own key).
  Projected for the same 220-test run: Opus candidate at low effort with cache about 2.2 cents, grader 0.05 cent, batch half: about $2.50; a Sonnet agent about $1.25; the 6-test first pass about $0.30 to $0.60. A free founder can then train one agent a month and keep working.
  Tests: `apps/orchestrator/src/__tests__/` training tests (grader route and effort, batch path, per-call booking unchanged), `apps/api` agent training tests (402 with both figures).

### P2

#### A7-07 (P2) The ledger cannot say whether caching works, how many turns a session took, or which route a session ran on

- Evidence. Session rows: `quantity = tokensIn + tokensOut` where `tokensIn` already includes cache reads and writes (session.ts:268, 282; session-credits.ts:121, 129), `details = { source: "claude-agent-sdk", label, partial? }`, no route, no model id, no split. Direct-call rows: `quantity = inputTokens + outputTokens`, which **excludes** cache tokens (`apps/api/src/services/models.ts:48`, `apps/orchestrator/src/deps.ts:76`, `apps/gateway/src/builtins.ts:36`), `details = { route, model, kind, attempt, ... }`, no cache counts. So `sum(quantity)` mixes two meanings, and `usage.cache_read_input_tokens` is dropped by every sink although `UsageEvent.usage` carries it (types.ts:98-103).
- What can be inferred today: the opus-route sessions' blended input price is ($0.41 - 7.2k x $20/M) / 388k = about $0.69 per million, between the cache-read price ($0.20) and the write price ($5), so the SDK's automatic caching is working and most of the 388k is cache reads. The 388k is the sum over every API request of the session, not one prompt.
- Fix. In every sink add `details.tokens = { input, output, cacheRead, cacheWrite }` (uncached input in `input`) and for sessions `details.route`, `details.model`, `details.turns`; keep `quantity` but define it once (`input + cacheRead + cacheWrite + output`) in `packages/db/src/repos/usage.ts` docs and make all sinks follow. Session rows: pass the SDK's per-model split through `SessionUsage`. Columns on `agent_sessions` per A7-01 step 1. Test: one sink test per service asserting the four counts.

#### A7-08 (P2) Price table drift

- Sonnet cache read: code $0.20 (pricing.ts:37), fact sheet $0.10. `meter()` overstates Sonnet cache reads two times; this affects direct Sonnet calls with `cacheSystem` (conversation, team call, project page) and open-turn estimates in sessions. Finished sessions use the SDK's `costUSD`.
- Opus cache read: code $0.20, which is 0.05x of input; the fact sheet's rule of thumb is about 0.1x ($0.40) and gives no Opus figure. Not verified: read the price page before changing it.
- No entry can express `claude-fable-5-2` ($8 / $40): `ModelKey` is a closed three-value enum (Appendix C). Not needed for routing today; needed the day a founder asks for the top tier on their own key.
- `FAST_MODE_PRICING` cache components are "assumed" (pricing.ts:42-44). Fast mode is off.
- Fix: update pricing.ts with A7-04; add a dated comment per figure with its source; `pricing.test.ts` asserts each figure so a change is deliberate.

#### A7-09 (P2) Sessions run at the API's default effort for 60 turns with no pacing

- Evidence. `sdk.query` options (session.ts:1738-1781) set no `effort`, so worker sessions on Sonnet run at `high` and lead sessions on Opus at `medium` (routing.ts:13). `maxTurns` is 60 for every task kind (session.ts:74). No `taskBudget`, no `fallbackModel`. Direct calls on the same routes at least honour `ROUTES[route].effort`; sessions ignore it (`launch` carries no effort).
- Impact. Output and thinking are 35 % of an opus-route session's cost (7.2k x $20/M = $0.144 of $0.41) and 26 % of a sonnet one.
- Fix. (1) Add `effort` to `SessionLaunch` (`apps/orchestrator/src/activities/types.ts`) from a new `ROUTES[route].sessionEffort` (routing.ts): `worker` medium, `departmentLead` medium, `planner` low, `chiefOfStaff` medium, `codeReview` high; pass `effort: launch.effort` to `sdk.query`. (2) `maxTurns` by task kind: code 40, everything else 25 (`TASK_KIND_MAX_TURNS` beside `DEFAULT_MAX_TURNS`). (3) `taskBudget: { total }` (alpha in SDK 0.3.291) derived from `maxBudgetUsd` at the model's blended price, so the model wraps up instead of being cut at `error_max_budget_usd`. (4) Record `num_turns` (A7-01). Tests: `session-live.test.ts` asserts the options object; evals for the session golden tasks at the new effort.

#### A7-10 (P2) The "## Skills" section inlines up to 60,000 characters into every system prompt

- Evidence. `renderSkills` (club-rules.ts:63-68) writes every added skill in full; limits are 8 skills and 60,000 characters per agent (skill-files.ts:27, 29); role skills (Design principles, `packages/agents/src/design-check.ts`) come first. The same prompt is built for sessions (session.ts:1449), conversations (`packages/agents/src/conversation.ts:845-852`) and every training test (training.ts:210).
- Impact. About 15,000 tokens at the limit. Per opus-route session: one cache write (15k x $5/M = 7.5 cents) plus a read on every later request (20 requests x 15k x $0.20/M = 6 cents): about 13 cents, a third of the average session. Per conversation reply on Sonnet: 3.75 cents to write, then reads only while replies come within the cache lifetime.
- Fix. Progressive disclosure: the section lists each skill's name and a one-line "use when" (120 characters, written at attach time and stored on `skill_definitions`), and the body is read through a platform tool (the platform connector already has skill tools, see `apps/gateway/src/__tests__/platform-skills.test.ts` and the `repository` option in `apps/gateway/src/builtins.ts`; check whether one can serve an added skill, else add `platform:read_skill({ name })` returning the instructions inside the same `<skill>` framing). Keep role skills inline only for the task kinds they apply to (Design principles only when `task.kind === "code"` and the task touches UI). Conversations and training keep the short list. Tests: `packages/agents` club-rules tests (section size bound), gateway `platform-skills.test.ts`, the skills injection eval.

#### A7-11 (P2) Cache breakpoints: one, always on the last system block, and fan-outs start before the cache exists

- Evidence. `buildSystem` (client.ts:709-713) marks only the last block.
  - Training puts the stable agent prompt first and a per-test block last (`## Training ... tested on "<skill>" ... Available mock tools: <list>`, training.ts:237). The cached prefix therefore ends with text that changes per skill and per mock-tool list: tests with a different list write a new entry at 1.25x and read nothing. The code comment (training.ts:240) says "written once, then read".
  - Fan-outs: training runs 4 tests at once (`CONCURRENCY = 4`, training.ts:220); Ideation starts cards while the slate streams, `IDEATION_CARD_CONCURRENCY` at a time (`apps/api/src/services/ideation.ts:271`); foundations sections run in parallel. A cache entry can be read only after the request that writes it has started answering, so the first wave of N calls pays N writes.
  - Slate and cards use different `output_config.format` schemas. If a changed format invalidates the prefix (Anthropic's structured-output documentation says it changes the injected system text; not verified here), the slate's write is never read by the cards.
  - Once-per-cycle calls with `cacheSystem: true` (cycle plan, `apps/orchestrator/src/activities/cycle.ts:370`) pay the 1.25x write and are rarely read inside five minutes.
  - No sink records `cache_read_input_tokens`, so none of this has ever been measured (A7-07).
- Where the cached prefix is invalidated today: (1) the per-test block in training; (2) a different schema between calls that share a system; (3) `q.setModel` mid-session (session.ts:1582); (4) any wait longer than the cache lifetime: an approval wait, a pause, a park; a resumed run starts a fresh SDK process with `persistSession: false` (session.ts:1779), so nothing carries over; (5) the business brief is inside the first system block of a conversation (conversation.ts:845-852), so a new cycle's brief rewrites it.
- Fix. (1) `CompleteRequest.cacheSystem?: boolean | number`: a number is the index of the last block to cache; training passes `0`. (2) A `warm` helper in `packages/models` for fan-outs: send the first call, wait for it to finish (or for the first stream event), then release the rest; use it in Ideation cards, foundations sections and training. (3) Put volatile sections last and outside the cached blocks: in `buildConversationRequest` send `[rules + instructions + skills + glossary]`, `[conversation rules]` cached, then the brief as a third uncached block. (4) After A7-07 ships, add a test-mode assertion and a weekly query: cache-read share per route (Appendix B query 7).

#### A7-12 (P2) The Message Batches API is declared and never used

- Evidence. `ROUTES.nightlyBatch.batch: true` (routing.ts:177), `RouteResolution.batch`, `BATCH_DISCOUNT`, `MeterOptions.batch` exist; no code calls `messages.batches`; the client never passes `batch` to `meter` (client.ts:267).
- Fix. `packages/models/src/batch.ts`: `submitBatch(client, requests: CompleteRequest[], { attribution }) → { batchId }`, `collectBatch(batchId) → CompleteResult[]` (validation and repair as in `complete`, metering with `{ batch: true }`, one `onUsage` per result with `details.batch = true`); a Temporal workflow in the orchestrator that submits, sleeps and polls; a table `model_batches (id, business_id, provider_batch_id, kind, status, submitted_at, ended_at, request_count, details)` with RLS and a cross-tenant test. Routes for it: Appendix A, last column. Mock mode returns the same results synchronously.

#### A7-13 (P2) Refusals have one handler in the product

- Evidence. With a schema a refusal throws `ModelOutputError("refusal")`; `isModelRefusal` is used only in `apps/api/src/services/conversation.ts`. Without a schema `complete()` returns the refusal as an ordinary result (client.ts:276): the training candidate's refusal is graded as an answer (training.ts:235-257). No request sends the `server-side-fallback-2026-07-01` beta with `fallbacks: "default"`, which the fact sheet recommends for Opus 5.5 and Sonnet 5.5. Sessions pass no `fallbackModel`. `pause_turn` and `model_context_window_exceeded` are in the `StopReason` type (types.ts:89-96) and handled nowhere.
- Fix. (1) In `plan()`, for Opus and Sonnet resolutions, send the fallback beta (a `SERVER_FALLBACK_BETA` constant beside `FAST_MODE_BETA`, routing.ts:98); keep it off for Haiku. Confirm the request shape against the reference before merge. (2) `complete()` without a schema throws on refusal as well; callers that want the text opt in with `allowRefusal: true`. (3) One mapper `founderMessageFor(err)` in `apps/api/src/services/model-errors.ts` (14 lines today) used by every model-backed procedure: refusal, billing, rate limit, credits. (4) Sessions: `fallbackModel` is the SDK's client-side fallback; decide per route and record the model that answered.

#### A7-14 (P2) Tool results carry a policy envelope the model does not need, possibly twice

- Evidence. The MCP bridge returns the whole gateway body as text and again as `structuredContent` (`apps/gateway/src/mcp.ts:57-61`). The body includes `reasons`, `policyIds`, `auditId`, two `costMinor` fields and, on every mock call, the 70-token `SIMULATED_NOTICE` (types.ts:100-101), plus the untrusted envelope's own notice. Every result stays in the context for all later turns. Whether the Claude Code CLI forwards both `content` and `structuredContent` to the model was not verified.
- Fix. For MCP only, return to the model `{ ok, data | error, simulated?, untrusted? }` and one short line for a simulated or untrusted result; keep the full envelope in the audit row and in `/v1/call`. Drop `structuredContent` or the text copy after checking which the CLI reads. Test: `apps/gateway/src/__tests__/mcp.test.ts`, `large-result.test.ts`.

#### A7-15 (P2) Session tokens: scope and kit mode are whatever the minting service says; the secret is shared (N4)

- Evidence. `POST /v1/session-tokens` accepts any `svc` (app.ts:148, 287) and copies `allowedTools` and `kitMode` from the request (app.ts:289-290, 320); it checks that the business, agent and session exist and may work, not that the tools are within the agent version's grants. `SESSION_TOKEN_SECRET` signs both token kinds (tokens.ts:4-9), so any service that holds it can sign a session token directly and skip the mint checks; per-call state checks and Cedar still apply. Tokens live 4 hours (session.ts:75) and are not bound to the session's end.
- Does a tool ever run without policy? Not through a session token: `/v1/call` and `/mcp/:connector` share `executeToolCall`; `POST /v1/github/archive` is a route-only read with its own checks (`archive.ts`, not read in depth). Hard gates hold twice: Cedar `hard-gate` and the connector's own refusal (contract-suite.ts:141-152). The service routes (notify email, push, speech, portraits, registry lookup, checkout, connect, key validation) reach vendors without Cedar by design and trust `svc`.
- SECURITY_REVIEW open items as of this commit: **N2** open (no per-business SendGrid inbound token, event-webhook key or Stripe endpoint secret; fixed only for the platform sending address), **N3** open (Stripe Connect needs an account-to-business resolver before it goes live), **N4** open (verified above). SECURITY_REVIEW.md:189-191.
- Fix. (1) Separate secrets: `SERVICE_TOKEN_SECRET_<SVC>` per caller, verified by `svc` (or asymmetric keys: each service signs with its own private key, the gateway holds the public keys), and a gateway-only secret for session tokens. (2) At mint, intersect `allowedTools` with `resolveGrants(parseGrants(version, template)).toolRefs` read by the gateway from `agent_versions`; allow `svc: api` plan-action tokens only for the single tool of the action. (3) Refuse a token whose session has `ended_at` set (one indexed read, cached 5 s in `SessionStateCache`). Tests: `tokens.test.ts`, `state.test.ts`, `policy-hardening.test.ts`.

#### A7-16 (P2) A tool with empty hints is "internal" and allowed in every mode

- Evidence. `connector.policyHints[tool.name] ?? {}` and `?? false` on each hint (pipeline.ts:458, 465-469). The contract suite requires a hints entry to exist and its keys to be known (contract-suite.ts:122-127), not that an outward tool is marked. In assisted mode (the default) a tool marked only `contactsThirdParty` or only `spendsMoney` under the threshold is allowed without asking (60-assisted.cedar:3-10); mail tools ask today because their authors also set `irreversible` (`gmail/tools.ts:44`, `platform_mail/tools.ts:56`, `sendgrid/tools.ts:76, 92`). `apps/gateway/CLAUDE.md` says "anything outward or costly asks first in augmented and assisted mode", which is true only by that convention.
- Fix. (1) Contract test: every tool with `contactsThirdParty` must also set `irreversible` or `requiresKitMode`; (2) or change 60-assisted to ask on `resource.contactsThirdParty` and add an explicit `routine` hint for the few that may run alone; (3) a test in `packages/policy` that a tool with `{}` hints whose name matches `^(send|post|publish|create_checkout|pay|delete|merge)` fails the suite. Record the choice in DECISIONS.

### P3

- **A7-17 (P3) `finishSession` under-books a session by what other services booked under its id.** `repos.usage.sessionTokens` sums every `tokens` row of the session (`repos/usage.ts:293-299`), including the gateway reader's rows (reader-models.ts:17, `sessionId` set) and design-review calls; `unbookedTokens` (session-credits.ts:151-154) subtracts that sum from the SDK's total. Fix: filter on `details->>'source' = 'claude-agent-sdk'` in `sessionTokens`. Test in `session-budget.test.ts`.
- **A7-18 (P3) A new `LiveModelClient`, and so a new `RateLimiter`, per quarantined read of a byok business** (builtins.ts:80): no shared buckets, no 429 memory. Cache clients by `keyFingerprint` as `apps/orchestrator/src/models.ts:73, 102-104` does.
- **A7-19 (P3) The limiter is per process.** Three services share the platform key, each with its own view of the buckets (rate-limit.ts:174-176). Fine at today's volume; before widening sign-up either move the buckets to Redis or give each service a share.
- **A7-20 (P3) Two route tables.** `ROUTE_DEFAULT_MODEL` (`packages/agents/src/types.ts:74-105`) repeats `ROUTES[*].model`; only the key sets are compared. Derive it: `Object.fromEntries(Object.entries(ROUTES).map(([k, v]) => [k, v.model]))`, or add a test.
- **A7-21 (P3) `WAGE_CAP_FOR_FAMILY` is commented "EUR cents"** (`packages/agents/src/templates/_shared.ts:42`) while wage caps are USD since 0024. Lead default 40,000 = $400 a month, assistant $600: far above any plan's credits, so the cap never binds on the platform key.
- **A7-22 (P3) `GET /v1/connectors` is unauthenticated** (app.ts:139) and lists every tool with its policy hints. Private network only (documented); require a service token anyway.
- **A7-23 (P3) `model-ids.test.ts:19`** matches only `claude-(opus|sonnet|haiku)-...`: an id of another family written outside routing.ts would not be caught, and one added to `MODELS` fails line 49.
- **A7-24 (P3) Partial session rows are whole cents** (session-credits.ts:120, 131): the remainder is settled at the end with the exact figure, so the total is right; the per-row figures are not.

---

## 4. Roadmap items, unit economics and ranked recommendations

### 4.1 Roadmap status

| Item | Status | Evidence / what is left |
|---|---|---|
| THESIS 7.1 prices and credits from measured cost | **partial** | Exact costs and routes are booked for direct calls; the credit saver (#118) is live. Open: pre-commit calls unbooked (A7-02), sessions carry no route, turns or cache split (A7-07), every first-run route is still Opus (`ideation`, `ideationSlate`, `foundations`, `foundationsSkeleton`, `logoDesigner`; only `projectPage` is Sonnet), Pro and Scale prices and credits are "TBD" |
| THESIS 7.2 working top-ups and paid plans | **partial** | Top-up path is complete in code (api → gateway Stripe Checkout → ingest webhook → `settleCreditCheckout`, 12-month lots #106) and off in production (documented). Paid plans: no subscription checkout exists (A7-05) |
| THESIS 7.3 more places | not in this area | |
| THESIS 7.4 load and moderation capacity measured | **open** | Model limiter is per process (A7-19); no recorded headroom per key; allowances are request counts |
| SEC2 ceiling on the platform key (DECISIONS 2141-2170) | **partial** | Done for api, composer, orchestrator, live sessions (`session-credits.ts`). Open: gateway reader and web search (A7-03), pre-commit calls (A7-02) |
| Allowances on model-backed procedures (DECISIONS 1803-1872) | done | `model-limits.ts`; request counts only |
| Billing enforcement, USD credits, founder pool (DECISIONS 1663-1739, 2760-2763) | done | `packages/db/src/billing.ts` |
| Low credits move routine work to a lighter model (#118, DECISIONS 4531-4537) | done | routing.ts `lowCredits`, session.ts:775 |
| Own AI plan funding (#118, DECISIONS 4538-4550) | scaffold, off | `FLAGS.ownPlanFunding = false` |
| Speed settings and fast mode (DECISIONS 2736-2741) | done, fast mode off | |
| Batches for nightly work (BUILD §10.4) | **open** | A7-12 |
| SEC-1 state re-check, SEC-4 amount, SEC-5 kit mode, SEC-6 reader | done | `state.ts`, `policyAmountMinor`, token `kitMode`, `untrusted-reader.ts` |
| N2, N3, N4 | **open** | A7-15 |
| Founder's-own-key connectors never fall back to a platform key | done | pipeline.ts:751-753; `platformKey` connectors run only when connected (746, 154-156) |
| Haiku 5.5 migration | **open** | A7-04 |

### 4.2 Every measured cost on record

| What | Figure | Source | Kind |
|---|---|---|---|
| Opus-route agent session | 388k input, 7.2k output, $0.41 | supplied, production SQL today | measured |
| Sonnet-route agent session | 222k input, 3.7k output, $0.14 | supplied | measured |
| Session outcomes | 319 sessions: 25 % done, 67 % blocked, 7 % failed | supplied | measured |
| Total real spend | about $119, $94 of it one project on its own key | supplied | measured |
| Free projects' monthly use | most under $2 of $5.00 | supplied | measured |
| One training run | $12.78 | supplied | measured |
| Inbox composer, live eval run of 15 notes | 26 to 29 cents a run (about 1.8 cents a note); four runs about $1.08 | PROGRESS.md:1272 | measured |
| Two Planner re-scoping sessions that ended blocked | 287 cents together | PROGRESS.md:1372 | measured |
| Typed-read injection eval run | 14 cents | DECISIONS.md:3942 | measured |
| Post draft call | 0.6 to 1.5 cents, up to 3 with the retry | PROGRESS.md:1950 | worked out, not measured |
| "Last cycle cost $0.52" | tooltip copy example | DECISIONS.md:3348, PROGRESS.md:1401 | example |
| Overnight shift | 1 cycle and $0.15 a night, about $4.50 a month | DECISIONS.md:3734 | a setting |
| Task reserve | 2,000 cents, never more than an equal share of the credits left | cycle-contract.ts:66, DECISIONS.md:1696 | a setting |

Not on record anywhere: cost of a founder's first session (ideation to Take charge), of the foundations, of one real cycle, per project-week, per agent family, cache hit rate. Appendix B gives the queries; three of them need A7-01, A7-02 and A7-07 first.

Derived from the supplied figures (Estimates):
- cost per finished session: $1.64 opus route, $0.56 sonnet route;
- blended input price inside sessions: about $0.69 per million on Opus, $0.46 on Sonnet, so most input tokens are cache reads;
- output and thinking: 35 % of an Opus session, 26 % of a Sonnet one.

### 4.3 Why a session shows 222k to 388k input tokens

The number is cumulative over every API request of the session and includes cache reads and writes (session.ts:268). Each tool call is one more request that re-sends the whole conversation. Twenty requests over a 15k to 20k context give 300k to 400k. What is in each request:

1. tool definitions: every tool the session token allows on every granted connector, with full JSON schemas (`visibleTools`, mcp.ts:25-27). The platform connector alone defines 27 tools (`packages/connectors/src/connectors/platform/tools.ts`, 22 KB of source), GitHub 12; code tasks add the five file tools;
2. the system prompt: house rules (under 1,000 tokens), what you do, instructions with playbook and examples, skills (up to 15k tokens, A7-10), glossary, the cycle brief;
3. the task message;
4. every earlier assistant turn, thinking included, and every tool result with its policy envelope and notices (A7-14); file reads and untrusted digests stay for the rest of the session.

The three largest reductions:
1. do not start sessions that will block (A7-01): removes up to two thirds of session spend;
2. route and effort (A7-09, Appendix A): lead sessions from Opus to Sonnet at `medium` halve the $0.41; routine worker sessions on Haiku 5.5 cost a tenth to a twentieth of the $0.14;
3. a smaller prefix and fewer turns: skills by reference (A7-10), tools by task kind, a slim tool result (A7-14), `maxTurns` 25 with a task budget (A7-09). Each cuts the first cache write (the single most expensive input event: 19k tokens x $5/M is about 10 cents on Opus) and every later read.

### 4.4 What THESIS 7.1 still needs

1. The data: A7-02 (pre-commit ledger), A7-07 (cache and turn detail), A7-01 step 1 (blocked reason).
2. One run of Appendix B queries 3 to 6 over at least 30 real projects, written to DECISIONS as the baseline.
3. The routing changes of Appendix A behind evals, then the same queries again.
4. A decision on the free allowance from those numbers. Working figures until then (Estimates from list prices and the supplied averages):
   - first session today: one Ideation draft (slate plus 12 Opus cards) about 40 cents, foundations about 30 to 50 cents, the public page 1 to 3 cents, a first cycle (plan about 5 cents, two Planner calls about 6 cents, three sessions $0.42 to $1.23): roughly $1.20 to $2.20, of which only the part after Take charge is charged;
   - a first week of one cycle a day at today's prices: $3.70 to $9.40, above the allowance; the supplied "under $2" means most projects do not get that far;
   - after A7-01, A7-04, A7-09 and Appendix A: a cycle about 35 cents (plan 5, planning 6, one Sonnet lead session 20, two Haiku 5.5 worker sessions 4), a first week about $2.50, a first session under $1 with cards and sections on Sonnet. $5.00 then covers a first outcome, a first week and a second week at one cycle a day, with about $1 left for conversations at about 1 cent a reply.
   So the allowance does not need to rise; the cost per finished task needs to fall. Keep $5.00, move the money to work that finishes.
5. Training priced so a free founder can use it: A7-06.

### 4.5 Recommendations ranked by saving, with risk

| # | Change | Saving (Estimate) | Risk | Findings |
|---|---|---|---|---|
| 1 | Preflight and triage before a session; first-turn block rule | up to 67 % of session spend | low: a false "blocked" is visible and cheap; keep an override | A7-01 |
| 2 | Lead sessions (`departmentLead`) on Sonnet at `medium`; Opus by nudge | about 50 % of opus-route session cost | medium: plan quality; run the lead golden tasks first | A7-09, App. A |
| 3 | Haiku 5.5 for the Haiku routes; routine non-code worker tasks on Haiku 5.5 | 90 % on Haiku routes; 90 %+ on moved worker sessions | medium: client changes (A7-04), injection evals must pass on the new model | A7-04 |
| 4 | Training: Haiku grader, batch, low effort, changed skills only, affordability check | $12.78 → about $0.30 to $2.50 a run | low to medium: grader agreement eval | A7-06 |
| 5 | Skills by reference; tools by task kind; slim tool results | 10 to 30 % of session input cost; larger for agents with many skills | low | A7-10, A7-14 |
| 6 | Effort on sessions; `maxTurns` 25 / 40; task budget | 10 to 25 % of session cost (output side) | low to medium: long code tasks need 40 | A7-09 |
| 7 | Cache fixes: breakpoint index, warm before fan-out, brief outside the cached block | 20 to 50 % of input cost on Ideation, foundations, training | low | A7-11 |
| 8 | Batches for nightly and background routes | 50 % on those routes | low: latency only | A7-12 |
| 9 | First-run routes: cards, sections, logos on Sonnet at `low` | about 50 % of first-session cost | medium: first impression; eval `concept_who_pays` and a blind read | App. A |
| 10 | Price table and ledger truth | none directly; makes 1 to 9 measurable | none | A7-07, A7-08 |
| 11 | Close the platform-key gaps before sign-up opens | bounds the worst case | none | A7-02, A7-03 |
| 12 | Live top-ups at $5 and $10; then Pro | revenue; removes the wall | payment operations | A7-05 |

---

## 5. Interfaces a planner must know

### 5.1 `@foundmill/models` (`packages/models/src/index.ts` exports)

```ts
// routing.ts
export const MODELS: { opus: "claude-opus-5-5"; sonnet: "claude-sonnet-5-5"; haiku: "claude-haiku-4-5-20251001" };
export type ModelKey = "opus" | "sonnet" | "haiku";           // also packages/shared constants.ts:235-236
export type ModelId = (typeof MODELS)[ModelKey];
export interface RouteDefinition { model: ModelKey; lowCredits: "keep" | ModelKey; locked?: boolean; warnOnDowngrade?: boolean;
  batch?: boolean; effort?: Effort; speed?: "fast"; maxTokens: number; vision?: boolean }
export const ROUTES: Record<RouteKey, RouteDefinition>;       // 30 keys
export function resolveModel(route: RouteKey, override?: ModelKey, options?: { lowCredits?: boolean }): RouteResolution;
export type RouteResolution = { route; modelKey; modelId; locked: boolean; warning?: string; batch: boolean;
  effort?: Effort; speed?: "fast"; maxTokens: number; lowCredits?: true };
export function lowCreditsModel(route: RouteKey): ModelKey | null;
export function maxTokensFor(routeBudget: number, modelKey: ModelKey, effort?: Effort): number;
export function routeAcceptsImages(route: RouteKey): boolean;
export const MODEL_CAPABILITIES: Record<ModelKey, { effort: boolean; fastMode: boolean }>;
export const ALWAYS_THINKS: Record<ModelKey, boolean>;
export const THINKING_MAX_TOKENS = 16_000, LOW_EFFORT_MAX_TOKENS = 8_000, PLAIN_MAX_TOKENS = 4_096;
export const FAST_MODE_BETA = "fast-mode-2026-02-01";

// pricing.ts
export interface ModelPrice { inputPerMTok; outputPerMTok; cacheWritePerMTok; cacheReadPerMTok; displayName }
export const MODEL_PRICING: Record<ModelId, ModelPrice>;
export function meter(usage: TokenUsage, modelId: ModelId, opts?: { batch?: boolean; speed?: "standard" | "fast" }): MeterResult;
export interface MeterResult { modelId; currency: "USD"; costMinor: number; costMinorInt: number; costMicroMinor: number;
  breakdown: { input; output; cacheWrite; cacheRead }; label: "Estimate"; pricingAsOf: string; batch: boolean; fast?: true }
export function sumMeters(results: readonly MeterResult[], modelId: ModelId): MeterResult;
export function estimateTokens(text: string): number;         // ceil(chars / 4)

// types.ts
export interface TokenUsage { inputTokens; outputTokens; cacheCreationInputTokens; cacheReadInputTokens }
export type Effort = "low" | "medium" | "high" | "xhigh" | "max";
export interface UsageAttribution { businessId?; agentId?; sessionId?; taskId?; inboxItemId?; kind? }
export interface CompleteRequest<T> { route: RouteKey; system?: string | readonly string[]; messages: readonly ChatMessage[];
  schema?: z.ZodType<T>; maxTokens?: number; temperature?: number; cacheSystem?: boolean; modelOverride?: ModelKey;
  lowCredits?: boolean; scope?: string; attribution?: UsageAttribution; effort?: Effort; signal?: AbortSignal; reserveTokens?: number }
export interface CompleteResult<T> { text; json?: T; usage: TokenUsage; model: ModelId; modelKey; route; stopReason: StopReason;
  cost: MeterResult; mode: "mock" | "live"; requestId?; durationMs; repaired: boolean; warning?; effort?; speed? }
export interface ModelClient { readonly mode; complete(req): Promise<CompleteResult>; streamStructured?(req): Promise<StreamStructuredResult> }
export interface UsageEvent { route; model; modelKey; mode; billedTo: "byok" | "credits"; usage; cost; scope?; attribution?;
  durationMs; occurredAt; requestId?; attempt: number; streamed?; speed?; aborted? }

// client.ts
export function createModelClient(opts?: { mode?: "mock" | "live"; apiKey?: string; billedTo?: "byok" | "credits"; onUsage?: UsageSink;
  logger?; rateLimiter?: RateLimiter; rateLimitKey?: string; fetch?; baseURL?; maxAttempts?: number; timeoutMs?: number;
  defaultMaxTokens?: number; fastMode?: boolean; mock?: MockModelClientOptions }): ModelClient;
export function effectiveModelMode(mode, apiKey, logger?): "mock" | "live";
export function validateApiKey(apiKey: string, opts?: { mode?; fetch?; baseURL? }): Promise<KeyValidation>;
export function billingRefusal(error: unknown): "credit_balance" | "spend_limit" | null;
export function keyFingerprint(apiKey: string): string;
export const MAX_TOKENS_CEILING = 32_000, ROUTE_RESERVE_TOKENS = 4_096, DEFAULT_MAX_ATTEMPTS = 4;   // REQUEST_TIMEOUT_MS = 600_000 (not exported from index)

// gate.ts
export type ModelCallGate = (call: { route: RouteKey; attribution?: UsageAttribution }) => Promise<void | { lowCredits?: boolean }>;
export function gateModelClient(inner: ModelClient, gate: ModelCallGate): ModelClient;

// errors.ts: ModelError(code) with ModelOutputError("invalid_output" | "refusal" | "max_tokens"), ModelRequestError(status, apiErrorType),
// ModelBillingError(reason, billedTo), ModelRateLimitError(scope, retryAfterMs), ModelUnavailableError, ModelAbortedError;
// isModelBillingError(err), isModelRefusal(err).
```

### 5.2 `@foundmill/policy`

```ts
export function evaluate(rawInput: EvaluateInputInput, engine?: PolicyEngine): EvaluateResult;   // never throws for a decision
type EvaluateInputInput = {
  principal: { id; department; type; modelKey: ModelKey; autonomy?: "inherit" | "augmented" | "assisted" | "automated";
               spendCapMinor?: number; approvalThresholdMinor?: number /* default LIMITS.approvalThresholdMinorDefault = 25000 */ };
  tool: { connector; name; spendsMoney?; contactsThirdParty?; requiresKitMode?; irreversible?; hardGate?; finance?; contract?; securitySettings? };
  business: { id; businessMode: "augmented" | "assisted" | "automated"; holidayActive?: boolean };
  context?: { amountMinor?; recipient?; recipientFirstSeenInUntrusted?; recipientCountry?; localTimeAtRecipient?; suppressed?; holidayActive?; kitMode? };
};
type EvaluateResult = { outcome: "allow" | "ask" | "deny"; reasons: string[]; policyIds: string[] };
export function agentPrincipal(agent: PrincipalAgent, scope: PrincipalScope, opts?: { department?: string }): AgentCtxInput;
export function agentAutonomy(agent, businessMode): { autonomy; spendCapMinor?; approvalThresholdMinor? };
export function effectiveBusinessMode(input: EvaluateInput): BusinessMode;   // holiday → automated unless the agent overrides
```

Policy ids: `hard-gate`, `hard-gate-security-settings`, `suppressed-recipient`, `untrusted-recipient`, `finance-never-spends`, `kit-mode-channel`, `spend-cap-exceeded`, `release-asks-founder`, `augmented-ask-external`, `augmented-ask-irreversible`, `augmented-allow-internal`, `assisted-allow-within-caps`, `assisted-ask-above-threshold`, `assisted-ask-irreversible`, `assisted-ask-contract`, `automated-allow-within-caps`, `automated-ask-above-threshold`. Gateway-side ids: `session-scope`, `agent-paused`, `agents-stopped`, `agent-archived`, `business-archived`, `key-revoked`, `github-push-settings`.

### 5.3 Gateway call contract (`apps/gateway/src/types.ts`)

```ts
// POST /v1/call            Authorization: Bearer <session JWT>
CallRequest = { connector: string; tool: string; args?: unknown;
                context?: { amountMinor?; currency?; recipient?; recipientCountry?; localTimeAtRecipient?; planActionId? } };
CallResponse =
  | { outcome: "allow"; result: { ok: boolean; data?; error?: ToolError; untrusted: boolean; costMinor: number; simulated?: true; notice?: string };
      costMinor; auditId; reasons; policyIds }                                        // 200
  | { outcome: "ask"; approvalId; reasons; policyIds; costMinor: 0; auditId }         // 200
  | { outcome: "deny"; reasons; policyIds; costMinor: 0; auditId; approvalId?; humanAction? }   // 403
  | { outcome: "rate_limited"; reasons; retryAfterSeconds; limit; scope: "minute" | "day" | "concurrent"; costMinor: 0 };  // 429
// errors: { error: { code, message, details? } }, e.g. 404 unknown_connector / unknown_tool, 409 integration_not_connected,
// 503 vault_unavailable / connector_unconfigured, 403 service_only_connector
// POST /v1/session-tokens  Authorization: Bearer <service JWT>
MintSessionTokenRequest = { businessId; agentId; sessionId: string | null; allowedTools?: string[]; kitMode?: boolean;
                            untrustedSeeded?: boolean; ttlSeconds?: number; untrusted?: { emails; urls; phones; all } };
// ALL /mcp/:connector      session JWT; tools/list = allowed tools; tools/call = executeToolCall
export async function executeToolCall(deps: GatewayDeps, session: SessionToken, req: CallRequestParsed): Promise<{ status: 200 | 403 | 429; body: CallResponse }>;
```

Tool refs: `connector:tool`, `connector:*`, `*` (tokens.ts:24). Connector hints: `spendsMoney`, `contactsThirdParty`, `requiresKitMode`, `irreversible`, `hardGate` (`packages/connectors/src/contract.ts`).

### 5.4 Credits and billing (`@foundmill/db`)

```ts
export async function bookUsage(db, businessId, input: RecordUsageInput & { funding?: UsageFunding }, options?): Promise<{ entry: UsageEntry; credits: CreditsOutcome | null; replayed?: boolean }>;
RecordUsageInput = { agentId?; sessionId?; kind: "tokens" | "sandbox" | "tool" | "training"; modelKey?: "opus" | "sonnet" | "haiku" | null;
  quantity?: number; unit?: string; costMinor?: number; costMicroMinor?: number; currency?: string; billedTo?: "byok" | "credits";
  occurredAt?; details?: object; idempotencyKey?: string | null };
export function chargesCredits(entry, ownPlan?): boolean;
export async function checkPlatformCredits(db, businessId, { live: boolean; now?; routedTo?; ownPlan? }): Promise<PlatformCreditsCheck>;
export async function assertPlatformCredits(db, businessId, options): Promise<PlatformCreditsCheck>;   // throws CreditsExhaustedError (402)
PlatformCreditsCheck = { ok; reason: "exhausted" | "mock_only" | null; period; balanceMinor; spendableMinor; low: boolean; modelBilling; fundedBy };
export async function platformCredits(db, business, period): Promise<{ currency: "USD"; balanceMinor; grantedMinor; spentMinor; includedMinor; mockMinor; exhausted }>;
export async function creditsState(db, business, period): Promise<PlatformCredits | null>;              // null on byok
export async function includedCreditsFor(db, business, period, { lock? }): Promise<number>;
export async function modelBudgetState(db, business, now?): Promise<{ period; budgetMinor; spentMinor; remainingMinor }>;
export async function settleCreditCheckout(db, input: SettleCheckoutInput): Promise<SettleCheckoutResult>;   // packages/db/src/payments.ts:48
export async function stopBusinessAgents(db, businessId, { reason: "kill_switch" | "key_revoked" | "credits_exhausted"; at? });
export async function resumeBusinessAgents(db, businessId, { reason? });
export async function loadByokApiKey(db, vault, businessId, connectorKey?): Promise<{ apiKey: string } | null>;   // byok.ts:40
// repos.usage: record, recordOnce, list, totals, daily, wages, agentSpend, sessionTokens, creditBalance, listCreditBalances,
//   grantCredits, addCreditLot, liveLotCredits, creditLots, expireCreditLots, ensurePeriodCredits, lockIncludedCredits,
//   includedCreditPlacesTaken, chargeCredits, chargeCreditsMicro, debitCredits
```

tRPC (`apps/api/src/routers/billing.ts`): `billing.plan` (query), `billing.changeTier({ tier })`, `billing.topUp({ amountMinor: 500..1_000_000, currency: "USD" })` → `{ checkout, checkoutUrl, mode, label }`, `billing.checkout.status({ checkoutId })`, `billing.checkout.completeMock({ checkoutId })`, `billing.usage({ period? })`. Keys (`apps/api/src/routers/integrations.ts:216-221`): `validate`, `setAnthropic`, `rotate` (each `{ apiKey }`), `revoke`. Training: `agent.training.estimate({ agentId, modelKey? })`, `agent.training.run({ agentId, versionId })`.

Tables and columns:
- `usage_ledger`: `id, business_id, agent_id, session_id, kind, model_key, quantity, unit, cost_minor, cost_micro_minor, currency, billed_to, occurred_at, details, idempotency_key, created_at, updated_at`. `details` keys in use: `route, model, mode, kind, service, taskId, inboxItemId, label, attempt, streamed, aborted` (direct calls); `source: "claude-agent-sdk", partial` (sessions); `connector, tool, mode, untrusted, auditId` (tool rows); `sandboxMode, sandboxMs` (sandbox rows); `trainingRunId, skillKey, costBookedPerCall` (training marker rows); `funding: { source, provider? }` (every non-tool row).
- `credit_balances`: `id, business_id, period (YYYY-MM), balance_minor, granted_minor, spent_minor, carry_micro_minor, currency`.
- `credit_lots`: `id, business_id, checkout_id, amount_minor, remaining_minor, currency, purchased_at, expires_at`.
- `billing_checkouts`: `id, business_id, kind, status, mode, amount_minor, currency, created_by, external_id, checkout_url, expires_at, paid_at, paid_event_id, granted_period, credit_balance_id, failure`.
- `agent_sessions`: `id, business_id, agent_id, version_id, task_id, workflow_id, model_key, started_at, ended_at, tokens_in, tokens_out, cost_minor, currency, outcome, recording_ref`.
- `training_runs`: `id, business_id, agent_id, from_version_id, to_version_id, status, cost_minor, currency, results, coach_summary_md, decision, started_at, ended_at`.
- `businesses` (relevant): `plan_tier, model_billing, funding_source, spend_cap_minor, model_budget_minor, created_by, agents_stopped_at, agents_stopped_reason, is_demo, business_mode`.
- CHECK constraints on `model_key in ('opus','sonnet','haiku')`: `packages/db/migrations/0004_agents_departments_tasks.sql:12, 43, 353` and `0009_finance.sql:136`.

### 5.5 Limits, flags, environment

- `TIERS`, `includedCreditsMinor(tier)`, `LOW_CREDITS_SHARE = 0.2`, `LOW_CREDITS_FLOOR_MINOR = 100`, `lowCreditsThresholdMinor`, `creditsAreLow`, `SANDBOX_MICRO_MINOR_PER_SECOND` (`packages/config/src/pricing.ts`).
- `LIMITS.approvalThresholdMinorDefault = 25000`, `agentCapMaxMinor`, `skillTestsPerSkill { min: 12, max: 30 }`, `signoffPlanRoadmapItems = 2`, `cyclePlanRoadmapItems = 2`, `trpcMaxBatchSize = 25`, `skillFileMaxBytes` (`packages/config/src/limits.ts`).
- `FLAGS.ownPlanFunding = false`, `OWN_PLAN_PROVIDERS = []`, `FLAGS.trainingGround = true` (`packages/config/src/flags.ts`).
- `TOP_UP_MIN_MINOR = 500`, `TOP_UP_MAX_MINOR = 1_000_000`, `TOP_UP_OPTIONS_MINOR = [2500, 5000, 10000, 25000]` (`apps/api/src/services/payments.ts`).
- `SHARED_MODEL_LIMITS`, `MODEL_LIMITS`, `modelLimited(name, { when? })` (`apps/api/src/services/model-limits.ts`); `IDEATION_LIMITS` (ideation.ts:41-45).
- Orchestrator: `DEFAULT_MAX_TURNS = 60`, `SESSION_TOKEN_TTL_SECONDS = 14,400`, `SESSION_CREDIT_CHECK_MS = 15_000`, `DEFAULT_TASK_RESERVE_MINOR = 2_000`, `LOW_CREDITS_KEPT_MODULES = ["finance", "legal"]`.
- Gateway: `READER_MAX_CHARS = 24_000`, `STATE_CACHE_TTL_MS = 5_000`, `DEFAULT_PER_MINUTE = 600`, `KEY_VALIDATION_LIMITS = { perMinute: 10, perDay: 100 }`, `WEB_RATE_LIMITS = { perMinute: 30, perDay: 1_000 }`.
- Environment (`packages/shared/src/env.ts`): `MODEL_MODE`, `INTEGRATIONS_MODE`, `LIVE_CONNECTORS`, `MODEL_FAST_MODE`, `ANTHROPIC_API_KEY`, `SESSION_TOKEN_SECRET`, `ALLOW_MOCK_PAYMENTS`, `SIGNUP_ALLOWLIST`, `SIGNUP_OPEN`, `SIGNUP_DAILY_CEILING`, `APPROVAL_WAIT_MINUTES`, `SESSION_PAUSE_HOLD_MINUTES`, `MODEL_LIMIT_SCALE`, `STRIPE_SECRET_KEY` (gateway only).

---

## 6. Tests and gaps

What exists (read by name and, where cited above, by content):
- `packages/models/src`: `routing.test.ts` (exact table), `pricing.test.ts`, `client.test.ts` (578 lines: request bodies, retries, repair, billing), `client.stream.test.ts`, `structured-stream.test.ts`, `stream-json.test.ts`, `rate-limit.test.ts`, `gate.test.ts`, `model-ids.test.ts` (no model id outside routing.ts), `images.test.ts`, `planParams.test.ts`, `mock/*.test.ts`.
- `packages/policy/src/__tests__`: `evaluate.test.ts`, `policies.test.ts`, `principal.test.ts`, `loop-stops.test.ts`, `team-can-do.test.ts`.
- `apps/gateway/src/__tests__`: `gateway.test.ts`, `policy-hardening.test.ts`, `state.test.ts`, `tokens.test.ts`, `mcp.test.ts`, `untrusted-reader.test.ts`, `recipients.test.ts`, `credentials.test.ts`, `rate-limit.test.ts`, `billing.test.ts`, `bookkeeping.test.ts`, `builtins.test.ts`, `byo-key-connectors*.test.ts`, `service-routes.test.ts`, `service-only.test.ts`, `approvals.test.ts`, `large-result.test.ts`, `live-integrations.test.ts`, `web-fetch.test.ts`.
- `packages/db/src/__tests__`: `billing.test.ts`, `credit-lots.test.ts`, `payments.test.ts`, `tiers.test.ts`.
- `apps/api/src/__tests__`: `billing-checkout.test.ts`, `billing-tiers.test.ts`, `billing-usage.test.ts`, `credits-ceiling.test.ts`, `keys.test.ts`, `auth-keys.test.ts`, `model-limits.test.ts`, `rate-limit.test.ts`.
- `apps/orchestrator/src/__tests__`: `session-live.test.ts`, `session.test.ts`, `session-budget.test.ts`, `low-credits.test.ts`, `business-models.test.ts`, `credits-events.test.ts`, `grants-contract.test.ts`.
- `packages/connectors/src/testing/contract-suite.ts`: hints exist for every tool, mock and live agree, hard-gated tools never execute.

Gaps:
1. No test or metric asserts a cache read ever happens: nothing reads `cacheReadInputTokens` outside `meter` and the mock (A7-07, A7-11).
2. No test that the gateway's model clients ask the credits gate, or that their sinks book the exact cost (A7-03).
3. No test that `web.search_web` is metered or refused at zero credits (A7-03).
4. No test of a pre-commit dollar ceiling (none exists) (A7-02).
5. No test that a training run larger than the balance is refused before it starts (A7-06).
6. No live-shape test of a Haiku 5.5 request; `client.test.ts:308-317` asserts that `temperature` reaches Haiku and must change with A7-04.
7. No contract test that an outward tool asks in assisted mode (A7-16).
8. No test that `allowedTools` at mint is within the agent's grants, or that a token of an ended session is refused (A7-15).
9. No test that `finishSession` ignores other services' rows (A7-17).
10. No eval that compares session outcomes by route and effort; the evals force live but record no cost per case in a table a planner can query.
11. No end-to-end test of the live top-up path against Stripe test mode (webhook → lot → resume); the unit tests cover each half.
12. `routing.test.ts` pins the table, so any routing change must edit the test in the same PR; `packages/agents` `ROUTE_DEFAULT_MODEL` has no value test (A7-20).

---

## 7. Surprises

1. Caching in sessions is already working (blended $0.69 per million input on Opus against a $4 list price), and nobody can see it: the ledger keeps one token number.
2. The "388k input tokens" is not a prompt size. It is the sum over about twenty requests, mostly cache reads.
3. A free founder who presses Train spends the month's credits and ends with a paused team and no result (A7-06).
4. The credit saver sends worker sessions to Haiku 4.5, which at $1 / $5 is only half the Sonnet price; on Haiku 5.5 the same move would cut 95 %.
5. Sonnet worker sessions run at `high` effort and Opus lead sessions at `medium`, because sessions never read the route's effort (A7-09).
6. The quarantined reader exists twice with different payers: the `quarantine` connector uses the business's own key, the pipeline's reader always the platform key, and neither asks the credits gate (A7-03).
7. Web search is a direct Anthropic call on the platform key from inside a connector, the one model call in the product that `packages/models` never sees (A7-03).
8. `ROUTES.nightlyBatch.batch` and `BATCH_DISCOUNT` have existed since the first build wave; no batch has ever been submitted (A7-12).
9. The route → model table exists twice (routing.ts and `packages/agents/src/types.ts`).
10. The free-plan "credits used up" note never mentions a top-up, by design, and the smallest offered top-up is five months of the free allowance (A7-05).
11. Wage-cap defaults ($400 a month for a lead) are two orders of magnitude above any credit balance, so on the platform key they never bind.
12. Hard gates are enforced twice (Cedar and inside each connector), which is stronger than the docs claim; the assisted-mode "outward asks first" rule is enforced only by a hint convention, which is weaker than the docs claim (A7-16).
13. Outside this area, seen while auditing: the working tree stopped being clean during this pass, and not through this audit (every write of mine went to the scratchpad). `git status` at the end shows `CLAUDE.md` modified (the rule that outside skills are vetted first is replaced by "used freely", dated 2026-11-15), `.claude/skills/vet-third-party-skill/SKILL.md` staged for deletion and about thirty new directories under `.claude/skills/`. None of the files cited in this report changed; a planner working from commit `04a0a509` should know the tree differs.

---

## Appendix A. Recommended routing table

"Batch" = eligible for the Message Batches API when the founder is not waiting. Every model move needs its eval green on a live key first; effort moves need the route's golden cases. H5.5 = `claude-haiku-5-5`.

| Route | Today | Recommend | Effort | Thinking | Batch | Why |
|---|---|---|---|---|---|---|
| inboxComposer | Opus low, locked | keep | low | | no | the founder's main read; 1.8 cents a note measured |
| planCompiler | Opus low, locked | keep | low | | no | files real work |
| chiefOfStaff | Opus default | keep Opus | medium, explicit | | no | plans the cycle; make the default visible |
| departmentLead | Opus default | **Sonnet** (Opus by nudge) | medium | | no | the $0.41 session; halves it |
| leadRecommendation | Opus low | keep | low | | no | founder waits, small volume |
| planner | Opus low | keep; sessions capped at 25 turns | low | | no | 287 cents for two blocked sessions on record |
| codeReview | Opus default | keep Opus | high, explicit | | no | what reaches main |
| documentReview | Opus default | **Sonnet** | medium | | **yes** | "nobody waits on it" (routing.ts:159-162) |
| ideationSlate | Opus low | keep | low | | no | one call that sets the set's quality |
| ideation (cards) | Opus low | **Sonnet** | low | | no | 12 calls a draft, pre-commit, unbooked |
| logoDesigner | Opus low | **Sonnet** | low | | no | SVG marks; blind visual check first |
| foundationsSkeleton | Opus low | keep | low | | no | the vision and section theses |
| foundations (sections) | Opus low | **Sonnet** | low | | no | written from the skeleton |
| skillGrader | Opus default | **H5.5** (Sonnet low if the grader eval disagrees) | low | on | **yes** | rubric scoring; deterministic checks already decide |
| coach | Opus default | **Sonnet** | medium | | **yes** | background |
| worker | Sonnet default (high) | Sonnet for code; **H5.5** for research, drafts, ops after eval | medium (Sonnet), high (H5.5) | on | no (sessions) | the $0.14 session |
| journeyCommentary | Sonnet default | **H5.5** | medium | on | **yes** | commentary on computed numbers |
| nightlyBatch | Sonnet, flag only | **H5.5**, or Sonnet for long items | medium | on | **yes** | by definition |
| linker | Haiku 4.5, temperature 0 | **H5.5**, no temperature | low | off | sweeps yes, inline no | |
| classifier | Haiku 4.5 | **H5.5** | low | off | no | |
| categoriser | Haiku 4.5 | **H5.5** | low | off | **yes** for backfills | |
| quarantinedReader | Haiku 4.5 | **H5.5** | low | on | no (inline) | injection evals must pass |
| moderation | Haiku 4.5 | **H5.5** | low | on | no | pre-publish |
| founderTitle | Haiku 4.5 | **H5.5** | low | off | **yes** for backfills | several titles per call today (routing.ts:183) |
| conversation | Sonnet low | keep | low | | no | measured 3.8 s, 13/15 |
| goalProposal | Sonnet low | keep | low | | no | |
| projectPage | Sonnet low | keep; post drafts written ahead | low | | post drafts **yes** | |
| teamCallTurn | Sonnet low | keep | low | | no | |
| teamCallWrapUp | Opus low | keep | low | | no | files work |
| designReview | Opus low, vision | keep; try Sonnet | low | | no | one call a code session |

`lowCredits` after the move: `departmentLead` → haiku, `worker` → haiku, `planner` → sonnet, `foundations` and `logoDesigner` → haiku, the rest unchanged. Also add `web.search_web` to a route of its own (`webSearch`: H5.5 or Sonnet at low) instead of borrowing `worker` (web/index.ts:111).

## Appendix B. SQL for a planner (Postgres, read-only)

`usd` is dollars: `cost_micro_minor` is millionths of a cent, so divide by 1e8. Rows before migration 0039 have a null `cost_micro_minor`. Adjust the "real project" filter to the one used for the supplied figures; `is_demo = false` is the code's own flag.

```sql
-- 0. shared expression
--   exact cost in dollars: coalesce(u.cost_micro_minor, u.cost_minor * 1000000) / 1e8

-- 1. Cost per route (direct model calls; session rows have no route yet, see query 2)
select u.details->>'route' as route, u.details->>'model' as model, u.billed_to,
       count(*) as calls, sum(u.quantity) as tokens,
       round(sum(coalesce(u.cost_micro_minor, u.cost_minor * 1000000)) / 1e8, 4) as usd,
       round(avg(coalesce(u.cost_micro_minor, u.cost_minor * 1000000)) / 1e6, 3) as cents_per_call
from usage_ledger u join businesses b on b.id = u.business_id
where u.kind = 'tokens' and u.currency = 'USD' and b.is_demo = false and u.details ? 'route'
group by 1, 2, 3 order by usd desc;

-- 2. Agent sessions by model and outcome (the supplied averages come from here)
select s.model_key, s.outcome, count(*) as sessions,
       round(avg(s.tokens_in)) as avg_tokens_in, round(avg(s.tokens_out)) as avg_tokens_out,
       round(avg(s.cost_minor) / 100.0, 3) as avg_usd, round(sum(s.cost_minor) / 100.0, 2) as usd
from agent_sessions s join businesses b on b.id = s.business_id
where b.is_demo = false and s.ended_at is not null
group by 1, 2 order by 1, 2;

-- 3. Cost of the first session after Take charge (first 24 hours of a business), by what it paid for
--    Pre-commit Ideation is not in the ledger until A7-02 ships.
select b.id, b.created_at,
       round(sum(coalesce(u.cost_micro_minor, u.cost_minor * 1000000)) / 1e8, 3) as usd_first_24h,
       round(sum(coalesce(u.cost_micro_minor, u.cost_minor * 1000000)) filter (where u.details->>'route' in ('foundations','foundationsSkeleton')) / 1e8, 3) as usd_foundations,
       round(sum(coalesce(u.cost_micro_minor, u.cost_minor * 1000000)) filter (where u.details->>'source' = 'claude-agent-sdk') / 1e8, 3) as usd_sessions,
       round(sum(coalesce(u.cost_micro_minor, u.cost_minor * 1000000)) filter (where u.details->>'route' in ('inboxComposer','conversation')) / 1e8, 3) as usd_notes_and_replies
from businesses b join usage_ledger u on u.business_id = b.id
where b.is_demo = false and u.currency = 'USD' and u.kind in ('tokens','sandbox')
  and u.occurred_at < b.created_at + interval '24 hours'
group by 1, 2 order by 2 desc;

-- 4. Cost per project-week, and who paid
select u.business_id, date_trunc('week', u.occurred_at) as week, u.billed_to,
       round(sum(coalesce(u.cost_micro_minor, u.cost_minor * 1000000)) / 1e8, 3) as usd,
       count(*) filter (where u.kind = 'tokens') as model_rows
from usage_ledger u join businesses b on b.id = u.business_id
where b.is_demo = false and u.currency = 'USD' and u.kind <> 'tool'
group by 1, 2, 3 order by 2 desc, usd desc;

-- 4b. Distribution of weekly cost over active project-weeks (for the allowance decision)
with w as (
  select u.business_id, date_trunc('week', u.occurred_at) as week,
         sum(coalesce(u.cost_micro_minor, u.cost_minor * 1000000)) / 1e8 as usd
  from usage_ledger u join businesses b on b.id = u.business_id
  where b.is_demo = false and u.currency = 'USD' and u.kind <> 'tool' group by 1, 2)
select count(*) as project_weeks, round(avg(usd)::numeric, 3) as mean,
       round(percentile_cont(0.5) within group (order by usd)::numeric, 3) as p50,
       round(percentile_cont(0.9) within group (order by usd)::numeric, 3) as p90,
       round(max(usd)::numeric, 3) as max from w;

-- 5. Cost per agent family (layer and agent type)
select a.layer, a.agent_type, a.model_key, count(distinct u.session_id) as sessions,
       round(sum(coalesce(u.cost_micro_minor, u.cost_minor * 1000000)) / 1e8, 3) as usd
from usage_ledger u join agents a on a.id = u.agent_id join businesses b on b.id = u.business_id
where b.is_demo = false and u.kind = 'tokens' and u.currency = 'USD'
group by 1, 2, 3 order by usd desc;

-- 6. Blocked sessions and what they cost (reason needs A7-01 step 1; until then read the task.blocked event)
select s.model_key, e.payload->>'reason' as reason, count(*) as sessions,
       round(sum(s.cost_minor) / 100.0, 2) as usd
from agent_sessions s
left join events e on e.business_id = s.business_id and e.idempotency_key = 'task.blocked:' || s.id::text
join businesses b on b.id = s.business_id
where b.is_demo = false and s.outcome = 'blocked'
group by 1, 2 order by usd desc;

-- 7. Cache-read share per route (works only after A7-07 adds details.tokens)
select u.details->>'route' as route,
       sum((u.details->'tokens'->>'cacheRead')::bigint) as cache_read,
       sum((u.details->'tokens'->>'cacheWrite')::bigint) as cache_write,
       sum((u.details->'tokens'->>'input')::bigint) as uncached_input,
       round(100.0 * sum((u.details->'tokens'->>'cacheRead')::bigint)
             / nullif(sum((u.details->'tokens'->>'cacheRead')::bigint + (u.details->'tokens'->>'cacheWrite')::bigint + (u.details->'tokens'->>'input')::bigint), 0), 1) as cache_read_pct
from usage_ledger u where u.kind = 'tokens' and u.details ? 'tokens' group by 1 order by 2 desc nulls last;

-- 8. Training runs
select t.status, count(*) as runs, round(avg(t.cost_minor) / 100.0, 2) as avg_usd, round(max(t.cost_minor) / 100.0, 2) as max_usd
from training_runs t join businesses b on b.id = t.business_id where b.is_demo = false group by 1;

-- 9. Credits: who hit the low line or zero this month
select c.business_id, c.period, c.granted_minor, c.spent_minor, c.balance_minor, b.plan_tier, b.model_billing, b.agents_stopped_reason
from credit_balances c join businesses b on b.id = c.business_id
where c.period = to_char(now() at time zone 'utc', 'YYYY-MM') and b.is_demo = false order by c.balance_minor asc;
```

Check the `task.blocked` payload key for the reason before relying on query 6 (`apps/orchestrator/src/activities/session.ts:1000, 1011` write it with idempotency key `task.blocked:<sessionId>`; the payload shape is declared in `packages/events`).

## Appendix C. Every place that assumes exactly three model keys

Adding a fourth key (for example `fable` for `claude-fable-5-2`) or renaming one touches all of these.

- Enum and type: `packages/shared/src/constants.ts:235-236` (`MODEL_KEYS`, `ModelKey`).
- Database CHECK constraints (new migration needed): `packages/db/migrations/0004_agents_departments_tasks.sql:12, 43, 353` (`agents`, `agent_versions`, `agent_sessions`), `0009_finance.sql:136` (`usage_ledger`).
- Drizzle columns: `packages/db/src/schema/agents.ts:30, 76, 370`; `packages/db/src/schema/finance.ts:149`. Zod: `packages/db/src/repos/usage.ts:39`; `apps/api/src/routers/agent.ts:250` (`z.enum(MODEL_KEYS)`).
- Routing: `packages/models/src/routing.ts:21-27` (`MODELS`), `91-95` (`MODEL_CAPABILITIES`), `104` (`ALWAYS_THINKS`), `241` (`RANK`).
- Pricing: `packages/models/src/pricing.ts:35-39`, `46-48`.
- Second route table: `packages/agents/src/types.ts:74-105`.
- Policy: `packages/policy/src/types.ts:28` (`modelKey: ModelKey`).
- Orchestrator: `apps/orchestrator/src/activities/session-credits.ts:35` (`MODEL_RANK`), `training.ts:42` (`MODEL_NAMES`), `training.ts:181` (literal union), `workflows/agentSession.ts:162` (default `"sonnet"`).
- Plan compiler vocabulary: `packages/models/src/planParams.ts:31` (`model_key: "opus | sonnet | haiku"`).
- UI: `packages/dugout/src/components/agents/SquadCells.tsx:123` (`MODEL_LABELS`), `138` (`ModelChip`); `ModelPicker.tsx:26`; `packages/dugout/src/components/agents/mock.ts:723-729`; `apps/web/components/agents/logic.ts:424-429` (`MODEL_DESCRIPTIONS`, `MODEL_RANK`); `apps/web/components/agents/LogsTab.tsx:105` (filter options); `apps/web/components/agents/ModelChangeDialog.tsx`, `TrainingTab.tsx`; `packages/modules/src/team/ModelChangeDialog.tsx:16-17`; `packages/modules/src/finance/WageBillScreen.tsx:151`.
- Seeds and fixtures: `packages/db/src/seed/journey.ts:54`; `packages/models/src/mock/index.ts` (keyed by route, resolves through `resolveModel`).
- Tests: `packages/models/src/routing.test.ts:5-37` (exact table), `pricing.test.ts:9-57`, `model-ids.test.ts:19` (regex `claude-(opus|sonnet|haiku)-`), and every test that names a key.
