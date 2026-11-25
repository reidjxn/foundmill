# WP-09: Models and money

**Goal:** Each route runs on the cheapest model and effort that holds its quality, the free allowance reaches a first real outcome and a first week of work, a founder at zero credits always has a working way to continue, and no model call a person can trigger is unbooked or uncapped.

**Why:** A7-01 (the measuring half), A7-02 to A7-14, A7-17, A7-20, A7-23 in `audits/a7-models-gateway-economics.md`; TS-03 in `audits/a3b-templates-skills-team.md`; AR-06, AR-14 and §1.4 in `audits/a3a-agent-runtime.md`; FR-04, FR-11 in `audits/a1-first-run.md`; the measured spend in `audits/e0-production-evidence.md`.

**Done when** (each is a check someone can run):
1. `pnpm --filter @foundmill/db report:cost` prints, from the ledger, the median and 90th-percentile cost of a new project's first session (drafting before commit plus the first 24 hours after it) and of its first week. On projects committed after T4, T7 and T11 are live, the medians are at most $1.50 (30% of the $5.00 allowance) and $3.50 (70%). Both are targets the founder confirms (D1).
2. A test drives every model call a person can trigger without a business (nine call sites, T2) and finds each one booked and refused past a dollar ceiling per account; the gateway's reader and `search_web` are refused at zero credits and book their exact cost (T3).
3. `MODELS.haiku` is `claude-haiku-5-5` and the suites named in T4 pass live.
4. A training check of up to three skills costs at most $1.00 on the half-price batch path, which is the default; run now stays available at about twice that (D10 and D11, founder, Nov 25, 2026). Measured Nov 24, 2026 (run 45428368258, 36 tests): $0.75 in a batch, $1.53 run now. Both prices are on screen before it runs, and a run the balance cannot finish is refused with both figures (T9, T10).
5. At zero credits the Inbox note and every refusal sentence say what stopped, what still works and at least one way to continue that works on that server; a test covers the server with top-ups on and with top-ups off (T13).
6. The routing table below matches `packages/models/src/routing.ts` (`routing.test.ts` pins it).

**Scope, in:** model ids, the price table, effort, refusals and fallbacks, caching, batches, what a session is told about effort and budget, `usage_ledger` and `agent_sessions` detail and the blocks they add to the cost report, booking and ceilings for pre-commit calls and the gateway's model calls, the first-cycle budget, the overnight numbers, the price of training, the zero-credit texts, top-up amounts, allowance and plan prices as config.
**Scope, out:** funnel events and the nightly north-star job (WP-02); retries, reconcilers, A7-01's preflight and triage, any change to `workflows/businessCycle.ts` (WP-05); a `blocked_reason` column (not needed: WP-02's report reads the `task.blocked` event); the skill index, `read_skill`, the "## Skills" section, scoped training runs and their migration (WP-06); which tasks commit creates and the team size (WP-04); Stripe account setup (WP-00); N2, N3, N4 (WP-11); how the Billing and Training screens look (WP-10); A7-15, A7-16 and A7-22 (tokens and policy: WP-11). Not planned until measured: A7-11's warm-up before a fan-out and the brief outside the cached block (only when the report's `cacheShareByRoute` shows a route under 50%, Estimate), and the P3 items A7-18, A7-19, A7-21, A7-24.
**Depends on:** WP-02 T11, which creates the cost report (`report:cost`) that T1 step 5 and T2 extend. WP-05 for session outcome evals (T7 steps 4 and 5) and for T15 there, the workflow half of AR-06 (T12). WP-06 T10 for the scoped run (T10 here) and WP-06's skill index (T7 step 7). WP-04 T3 for which tasks commit creates (T11). WP-00 S8 for Stripe (T13 step 6). Others wait on this package: WP-06 T10 on T9's affordability check, WP-06 T8 on T8's batch client, WP-00 S5 and WP-03 on T2's ceiling, WP-00 S6 on T3.
**Collides with:** WP-05 on `apps/orchestrator/src/activities/session.ts` and `activities/types.ts` (it edits `session.ts` in a chain of tasks: rebase on its latest before each step of T1, T4 and T7); WP-02 on `packages/db/src/repos/cost-report.ts`; WP-06 on `apps/orchestrator/src/activities/training.ts`, `workflows/trainingRun.ts`, `apps/api/src/routers/agent.ts`; WP-04 on `apps/api/src/services/commit.ts`; WP-11 on `apps/gateway/src/app.ts` and `tokens.ts` (this package touches `index.ts`, `builtins.ts`, `reader-models.ts`, `mcp.ts` only); WP-10 on `apps/web/components/settings/BillingTab.tsx` and `apps/web/components/agents/TrainingTab.tsx`. Every routing change edits `packages/models/src/routing.test.ts` in the same pull request.
**Setup it needs** (WP-00 ids): S8 Payments (`STRIPE_SECRET_KEY` on the gateway, the billing webhook secret on ingest, `LIVE_CONNECTORS` naming `stripe_billing` on api, gateway and ingest) before T13 step 6; S6 Real web research must not be switched on before T3 merges; S5 Open the door must not be switched on before T2 merges; S13 Spending backstops is the last line behind T2 and T3. A live Anthropic key with access to `claude-haiku-5-5` in the cloud session for the eval steps, and the founder's spending limit for them (D10).

## Rules for this package (on top of README.md)

- Model ids live only in `packages/models/src/routing.ts`, the fallback ids of T5 included. Ids appear in this file so you can check them, never to be pasted elsewhere.
- The `claude-api` skill is the reference for every API fact (ids, prices, effort, thinking, caching, batches, refusals, fallbacks). Where this file and the skill differ, the skill wins; say so in the pull request.
- Measure, change one thing, measure again. One lever per pull request, read against T1's report or the named eval, kept or reverted. Never keep or revert on a one-case swing.
- A live eval spends real money. State the expected spend in the pull request and stay inside D10.
- Every number marked Estimate is a guess. Replace it with the measured figure in the same pull request that measures it.
- Migrations: the next free number when the branch is cut (0108 at `04a0a509`); renumber on rebase; add the `_journal.json` entry.
- Recorded decisions this package builds on and does not re-decide: 2026-10-05 "Model ids"; 2026-10-06 "packages/models: live client, metering and mock conventions"; 2026-10-09 "Generation streams; first drafts run at low effort; fast mode is opt-in" (model choice is the founder's call); 2026-10-12 "The ceiling on Foundmill's Anthropic key (SEC2)"; 2026-10-12 "Billing enforcement"; 2026-10-12 "Paying for credits"; 2026-10-12 "Allowances on every model-backed procedure"; 2026-10-16 "Speed over the default model settings for what the founder waits on"; 2026-10-16 "No business limit for now; the included credits stay one pool"; 2026-11-11 "The thesis" answer 4 (open sign-up waits for per-account spend ceilings); 2026-11-12 "Retention, part 2" (the overnight numbers); 2026-11-13 "Low credits move routine work to a lighter model instead of stopping" (#118); 2026-11-13 "A founder's own AI plan" (#118). Find them with `node scripts/decisions-index.mjs <words>`.

## Measured baseline (audits/e0, Nov 15, 2026)

| What | Figure |
| --- | --- |
| Real agent sessions | 319: 81 done (25%), 215 blocked (67%), 23 failed (7%) |
| Session on the Opus route | 142 sessions, $58.25, average 388k input and 7.2k output tokens, $0.41 |
| Session on the Sonnet route | 176 sessions, $24.67, average 222k input and 3.7k output tokens, $0.14 |
| All real spend | about $119; one project on its own key is $93.85; the other twelve $0.57 to $7.36 each |
| One training run | $12.78 against a $5.00 monthly allowance |
| Not measured anywhere | first-session cost, first-week cost, cache-read share, turns per session, the effort sessions run at |

The token averages are sums over every request of a session and are mostly cache reads (`audits/a7-models-gateway-economics.md` §4.3): they are not a prompt size. WP-02 T11 and T1 step 6 paste the report's production output below this line.

## Recommended routing table

Check "Key today" and "Effort today" against `ROUTES` in `packages/models/src/routing.ts` before you start; a mismatch means the code moved, and the code wins. Gate: `none` changes no behavior; `eval` needs the named suite green on a live key; `sweep` follows T6's rule; `D2` also needs the founder, because the 2026-10-09 and 2026-10-16 decisions leave model choice to the founder. "(unset)" after a value means no `effort` is sent today and that value is the API default (`medium` on Opus 5.5, `high` on Sonnet 5.5); T6 step 1 writes it down.

| Route | Key today | Key proposed | Effort today → proposed | Batch | Gate | Why |
| --- | --- | --- | --- | --- | --- | --- |
| inboxComposer | opus, locked | opus | low → low | no | none | The founder's main read (2026-10-16) |
| planCompiler | opus, locked | opus | low → low | no | none | Files real work (2026-10-16) |
| chiefOfStaff | opus | opus | medium (unset) → medium | no | none (T6) | Same request, made visible |
| departmentLead | opus | sonnet | medium (unset) → medium | no | D2 + WP-05's outcome eval | The $0.41 session. Try Opus at `low` first: one model, one cache |
| leadRecommendation | opus | opus | low → low | no | none | Founder waits; small volume |
| planner | opus | opus | low → low | no | none | 2026-10-16 |
| codeReview | opus | opus | medium (unset) → medium | no | none (T6) | What reaches main. The audit's `high` has no evidence behind it |
| documentReview | opus | sonnet | medium (unset) → medium | later | D2 + `second-read.eval` | Nobody waits on it |
| ideationSlate | opus | opus | low → low | no | none | One call sets the set's quality |
| ideation | opus | sonnet | low → low | no | D2 + `ideation.eval` | Up to 12 calls a draft, before commit |
| logoDesigner | opus | sonnet | low → low | no | D2 + `logo.eval` and a blind look | SVG marks |
| foundationsSkeleton | opus | opus | low → low | no | none | The vision and section theses |
| foundations | opus | sonnet | low → low | no | D2 + `foundations.eval` | Sections written from the skeleton |
| skillGrader | opus | haiku | medium (unset) → low | yes (T10) | eval (T9 grader agreement) | Rubric scoring; deterministic checks already decide. Sonnet at `low` if agreement fails |
| coach | opus | sonnet | medium (unset) → medium | later | D2 + an eval written first (none exists) | Background |
| worker | sonnet | sonnet | high (unset) → medium | no | sweep | The $0.14 session. Routine task kinds on the lighter model: T7 step 5 |
| journeyCommentary | sonnet | haiku | high (unset) → medium | later | D2 + an eval written first (none exists) | Commentary on computed numbers |
| nightlyBatch | sonnet | sonnet | high (unset) → high | flag only | none (T6) | No caller in the code (grep). Leave it; build nothing on it |
| linker | haiku | haiku | none → low | no | eval (T4) | New id `claude-haiku-5-5`; no `temperature` |
| classifier | haiku | haiku | none → low | no | eval (T4) | |
| categoriser | haiku | haiku | none → low | no | eval (T4) | |
| quarantinedReader | haiku | haiku | none → low | no | eval (T4): injection suites at 100% | A refusal withholds the content, as any reader failure does |
| moderation | haiku | haiku | none → low | no | eval (T4) | A refusal holds the post (`apps/api/src/services/live.ts`) |
| founderTitle | haiku | haiku | none → low | no | eval (T4) | |
| conversation | sonnet | sonnet | low → low | no | none | Measured 3.8 s, 13 of 15 (2026-10-16) |
| goalProposal | sonnet | sonnet | low → low | no | none | |
| projectPage | sonnet | sonnet | low → low | no | none | |
| teamCallTurn | sonnet | sonnet | low → low | no | none | |
| teamCallWrapUp | opus | opus | low → low | no | none | Files work |
| designReview | opus | opus | low → low | no | none | 2026-11-13 (#114) |
| webSearch (new, T3) | borrows `worker` | sonnet | low → low | no | none | The reference lists `web_search_20260209` for Fable, Opus and Sonnet models, not Haiku 5.5 |

`lowCredits` changes only with a key move: `departmentLead`, `foundations` and `logoDesigner` go to `"haiku"` if they become Sonnet; a route that becomes Haiku sets `"keep"`. "Batch: later" means eligible, not built: after T4 those routes cost too little to justify a workflow; add one when T1's report shows a route above $5 a month (Estimate).

## Tasks

### T1: The ledger says what happened, and the cost report can read it            [M] [ships alone; step 5 after WP-02 T11] (steps 1–3 and 5 done Nov 16; step 4 waits for session.ts, step 6 for the founder)
Why: A7-07, AR-14, FR-04 (fix 1), A7-01 step 1 (the measuring columns only), A7-09 (which effort sessions run at is unknown).
Files: create `packages/db/migrations/<next>_session_usage_detail.sql`. Modify `packages/db/migrations/meta/_journal.json`, `packages/db/src/schema/agents.ts`, `packages/db/src/repos/agents.ts` (`EndSessionInput`), `packages/models/src/pricing.ts`, `pricing.test.ts`, `apps/api/src/services/models.ts`, `apps/orchestrator/src/deps.ts`, `apps/gateway/src/builtins.ts`, `apps/gateway/src/reader-models.ts`, `apps/composer/src/usage.ts`, `apps/orchestrator/src/activities/session.ts`, `activities/session-credits.ts`, `activities/types.ts`, and WP-02 T11's `packages/db/src/repos/cost-report.ts` with its test `packages/db/src/__tests__/cost-report.test.ts`. Do not write a second report: if WP-02 T11 has not merged, ship steps 1 to 4 and wait.
Interfaces, consumes: `UsageEvent.usage: TokenUsage` (`packages/models/src/types.ts`); `SessionUsage.onResult(modelUsage: Record<string, SdkModelUsage>)` and the `result` handler (`session.ts`, `recorder.usage.onResult(message.modelUsage)`); the SDK's `num_turns` on a result and `effort` on the `system`/`init` message (`sdk.d.ts` of `@anthropic-ai/claude-agent-sdk` 0.3.291); `repos.agents.endSession(db, businessId, sessionId, input: EndSessionInput)` (`packages/db/src/repos/agents.ts:811`); WP-02 T11's `repos.costReport.run(db, { from?, to? }): Promise<CostReport>` with blocks `byRoute`, `sessionsByModelAndOutcome`, `firstDayPerProject`, `projectWeeks`, `byAgentFamily`, `blockedSessions`, `trainingRuns`, `creditsThisMonth`, `notMeasured`, and its CLI `pnpm --filter @foundmill/db report:cost [-- --from --to] [--json] [--print-sql]`.
Interfaces, produces:
```ts
// packages/models/src/pricing.ts: the one definition of a ledger row's token figures
export function usageForLedger(usage: TokenUsage): { quantity: number; tokens: { input: number; output: number; cacheRead: number; cacheWrite: number } };  // quantity = input + cacheRead + cacheWrite + output
// agent_sessions: route text, effort text, num_turns integer, cache_read_tokens bigint not null default 0, cache_write_tokens bigint not null default 0
// SessionLaunch gains route: RouteKey; SessionResult gains numTurns, cacheReadTokens, cacheWriteTokens, effort (all optional)
// CostReport gains: cacheShareByRoute (Appendix B query 7), firstWeekPerProject (median, p90), rounds ({ medianMinor, perAllowance }), and route, effort, median and p90 turns on sessionsByModelAndOutcome
```
Steps:
1. Test `usageForLedger({ inputTokens: 10, outputTokens: 5, cacheCreationInputTokens: 3, cacheReadInputTokens: 2 })` equals `{ quantity: 20, tokens: { input: 10, output: 5, cacheRead: 2, cacheWrite: 3 } }`, then write it. verify: `pnpm --filter @foundmill/models test pricing`.
2. Each of the five sinks books `quantity` and `details.tokens` from `usageForLedger` (the composer keeps its `details.usage`). verify: one new assertion in each sink's existing test: a call with 2 cache-read tokens books `details.tokens.cacheRead === 2`.
3. Migration and schema mirror for the five `agent_sessions` columns. verify: `pnpm --filter @foundmill/db test migrations`, `pnpm test:rls`.
4. `SessionUsage` also keeps cache-read and cache-write totals per result and the turn count; the init message's `effort` is kept when present; `prepareSession` puts `route` on the launch; `finishSession` passes all five to `endSession`; session ledger rows add `details.route` and `details.model`. verify: `session-live.test.ts`: a fake result with `num_turns: 7` and cache counts ends a session row carrying them.
5. Extend the report with the four additions above. `firstWeekPerProject` is `firstDayPerProject` over seven days, both from `coalesce(committed_at, created_at)`. `rounds` is the median cost of one round of work (a project's ledger rows between its `cycle.started` and `cycle.completed` events; read the payloads in `packages/events/src/catalogue.ts` first and use a cost they already carry) and how many such rounds the allowance pays for: WP-03's landing page quotes that number. verify: `cost-report.test.ts` on fixtures with known rows gives the exact medians and shares; an empty range prints "no data", never NaN.
6. Needs the founder: run the report on production (`--print-sql`, read-only) and paste the output into `docs/DECISIONS.md` and under "Measured baseline" above. verify: the entry holds every block and its date range.
Tests and evals: as in the steps. No eval: nothing a model does changes.
Done when: the baseline is in `docs/DECISIONS.md` and every later task quotes it.

### [x] T2: Calls before a business exists are booked and capped per account            [M] [ships alone]
Why: A7-02, FR-11; thesis answer 4 makes this a condition of open sign-up.
Files: create `packages/db/migrations/<next>_account_usage.sql`, `packages/db/src/schema/account-usage.ts` (or beside `idea_drafts` in its schema file), `packages/db/src/repos/account-usage.ts`, `packages/db/src/__tests__/rls/account-usage.test.ts`, `apps/api/src/__tests__/precommit-ceiling.test.ts`. Modify `packages/models/src/types.ts` (`UsageAttribution.userId?: string`), `apps/api/src/services/models.ts`, `packages/shared/src/env.ts`, `.env.example`, `packages/db/src/repos/cost-report.ts` (WP-02 T11's), and the call sites: `apps/api/src/services/ideation.ts` (four: the single concept, the cards, the slate, the founder's own card), `services/import-concept.ts`, `services/conversation.ts` (`replyAboutConcept`), `routers/idea.ts` (`compare`), `routers/logo.ts` (`ideaLogoSet`), `services/live.ts` (`screenText` for a post made without a business).
Interfaces, consumes: `apiUsageSink(db, log)` returns early at `if (!a?.businessId) return;`; `apiCreditsGate(db, live): ModelCallGate`; `IDEA_BOX_DAILY_CEILING_CENTS` in `env.ts` as the pattern; migration `0086_idea_drafts.sql` as the pattern for a table only the service role may touch.
Interfaces, produces:
```sql
create table account_usage (id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users(id) on delete cascade,
  kind text not null, route text not null, model_key text check (model_key in ('opus','sonnet','haiku')), quantity bigint not null default 0,
  cost_micro_minor bigint not null default 0 check (cost_micro_minor >= 0), occurred_at timestamptz not null default now(), details jsonb not null default '{}', created_at timestamptz not null default now());
create index account_usage_user_id_occurred_at_idx on account_usage (user_id, occurred_at);
-- RLS on, no policy; revoke all from public, anon, authenticated, service_role; grant select, insert to service_role
```
```ts
export const accountUsageRepo = { record(db, input: { userId: string; kind: string; route: string; modelKey: ModelKey; quantity: number; costMicroMinor: number; occurredAt: Date; details: object }): Promise<void>; spentMicro(db, userId: string, since: Date): Promise<number> };
// env: PRECOMMIT_DAILY_CEILING_CENTS (default 200), PRECOMMIT_MONTHLY_CEILING_CENTS (default 500): Estimates, D3
```
Steps:
1. Table, repo and the RLS test (an authenticated person can neither read nor write a row, their own included). No `business_id`, so it joins neither `TENANT_TABLES` nor `EXPORT_TABLES`. verify: `pnpm test:rls`.
2. The nine call sites pass `attribution.userId`. verify: `precommit-ceiling.test.ts` drives each procedure with a recording model client and asserts `userId` on every call that has no `businessId`.
3. `apiUsageSink`: with no business, a `userId` and `event.mode === "live"`, write `account_usage`. verify: a live-mode fake books one row per call with the exact `costMicroMinor`; mock mode books none.
4. `apiCreditsGate`: for a live call with a `userId` and no business, sum the last 24 hours and the last 30 days; at or over a ceiling throw `AppError("precommit_ceiling", ..., 429)` before any call. Sentences: "That is all the drafting for today. Take charge of one of your ideas to keep going, or come back tomorrow." and "You have used this month's free drafting. Take charge of one of your ideas to keep going." Parallel calls of one draft read the same sum, so one draft of overshoot is accepted (as SEC2 accepts one turn). Throw before `noteModelCall()`, so the request's allowance hit is given back. verify: a loop of drafts stops at the line with no model call made.
5. The report gains `preCommitPerProject`: per project, the `account_usage` of `businesses.created_by` between that person's previous commit and this one (median and p90), and the line about calls before a project exists leaves `notMeasured`. verify: `cost-report.test.ts`.
6. Signed-out calls: the idea box already reserves against `IDEA_BOX_DAILY_CEILING_CENTS` and stores `idea_drafts.cost_micro`; add its daily total to the report as `ideaBox` and change nothing else. verify: `idea-box.test.ts` still passes.
Tests and evals: above. No eval.
Done when: Done-when item 2, the signed-in half.

### [x] T3: The gateway's model calls ask first and book the exact cost            [M] [ships alone]
Why: A7-03, A7-17. Must merge before `web` is added to `LIVE_CONNECTORS`.
Files: modify `apps/gateway/src/index.ts`, `reader-models.ts`, `builtins.ts`, `untrusted-reader.ts`, `state.ts` (comment only), `packages/connectors/src/connectors/web/index.ts`, `packages/connectors/src/platform.ts` (`LiveConnectorOptions`), `packages/models/src/types.ts`, `client.ts`, `gate.ts`, `mock/index.ts`, `routing.ts`, `routing.test.ts`, `packages/agents/src/types.ts` (`ROUTE_KEYS`, `ROUTE_DEFAULT_MODEL`), `packages/db/src/repos/usage.ts` (`sessionTokens`). Tests: `apps/gateway/src/__tests__/untrusted-reader.test.ts`, `builtins.test.ts`, `web-fetch.test.ts`, `apps/orchestrator/src/__tests__/session-budget.test.ts`.
Interfaces, consumes: `gateModelClient(inner, gate)`; `creditsGate(db, live)` in `apps/composer/src/usage.ts:16-23` (copy its six lines into `reader-models.ts`; do not refactor the other services); `createQuarantinedReader(deps)` and its inner `clientFor(businessId)`; `gatewayUsageSink(db, log)`; `repos.usage.sessionTokens(db, businessId, sessionId)`; `search_web` in `web/index.ts`, which builds `new Anthropic(...)` itself.
Interfaces, produces:
```ts
// packages/models/src/types.ts
export interface WebSearchRequest { query: string; limit: number; scope?: string; attribution?: UsageAttribution; signal?: AbortSignal }
export interface WebSearchResult { results: { url: string; title: string; pageAge: string | null }[]; usage: TokenUsage; cost: MeterResult; mode: ModelMode }
// ModelClient gains searchWeb?(req: WebSearchRequest): Promise<WebSearchResult>  (live, mock and gated clients implement it)
// routing.ts: webSearch: { model: "sonnet", lowCredits: "keep", effort: "low", maxTokens: LOW_EFFORT_MAX_TOKENS }  (the search request keeps its own max_tokens of 2,048, as today)
// LiveConnectorOptions gains searchWeb?: (input: { businessId: string; agentId?: string; sessionId?: string; query: string; limit: number }) => Promise<WebSearchResult["results"]>
```
Steps:
1. Tests first: a reader call for a business at zero credits is refused and the content is withheld with `READER_UNAVAILABLE`; a 6,000-token digest books its fractional cost in `costMicroMinor`, not 0 or 1 cent; a business on its own key pays for the pipeline's reader on that key. verify: they fail on `main`.
2. Wrap both gateway clients with the gate (platform branch only for a business on its own key); delete `readerUsageSink` and use `gatewayUsageSink`, which now passes `costMicroMinor`; the pipeline's reader uses `clientFor`. verify: step 1 passes.
3. Move the search request from `web/index.ts` into `LiveModelClient.searchWeb`, unchanged in content (server tool `web_search_20260209`, `max_uses: 1`, `output_config: { effort: "low" }`), sent through the client's own `send()` so the limiter, the retry policy, metering and `onUsage` apply; the web connector calls the injected `searchWeb`. Search stays on the platform key and is charged to credits for every business, as SEC2 decided for platform-key calls. Book the tokens; add the server tool's per-search fee as a constant in `pricing.ts` taken from the price page, with its date. verify: `web-fetch.test.ts`: a search at zero credits is refused before any request; a search books one `tokens` row with `details.route === "webSearch"`.
4. `sessionTokens` sums only rows with `details->>'source' = 'claude-agent-sdk'`, so rows other services book under a session id no longer shrink the session's own final booking. verify: `session-budget.test.ts`: a reader row under the session id leaves `unbookedTokens` unchanged. Then remove the reader and web search line from the report's `notMeasured`.
Tests and evals: above; the injection suites are untouched here (the model does not change until T4).
Done when: Done-when item 2, the gateway half.

### T4: Haiku routes on `claude-haiku-5-5`, and a price table that is true            [M] [ships alone]
Why: A7-04, A7-08. Supersedes the id in DECISIONS 2026-10-05 "Model ids": record a new entry.
Files: modify `packages/models/src/routing.ts`, `pricing.ts`, `client.ts`, `types.ts`, `routing.test.ts`, `pricing.test.ts`, `client.test.ts`, `mock/index.ts`, `packages/entity-linker/src/sweep.ts`, `resolve.ts`, `types.ts`, `apps/orchestrator/src/activities/session.ts` (`SessionUsage.onResult`), `docs/DECISIONS.md`.
Interfaces, consumes: `MODELS`, `MODEL_CAPABILITIES`, `ALWAYS_THINKS`, `maxTokensFor(routeBudget, modelKey, effort?)`, `LISTED_UNROUTED_MODELS`, `meter(usage, modelId, opts)`, `plan(req)` in `client.ts` (the `temperature` branch); `validateKey()` and the `anthropic` connector's `models.retrieve(MODELS.haiku)` follow the constant, so a founder's own key is checked against the new id with no change.
Interfaces, produces:
```ts
export interface ModelPrice { /* existing */ longPrompt?: { overTokens: number; inputPerMTok: number; outputPerMTok: number; cacheWritePerMTok: number; cacheReadPerMTok: number } }
export const HAIKU_MAX_TOKENS_FLOOR = 2_048;   // Estimate. A caller's own small cap (200 in the linker, 600 in moderation) is raised to this on the haiku key: thinking counts toward max_tokens
```
Price table to assert in `pricing.test.ts` (USD per million tokens; `PRICING_AS_OF = "2026-11-15"`):

| Key | Id | Input | Output | Cache write (5 min) | Cache read | Prompt over 100,000 tokens |
| --- | --- | --- | --- | --- | --- | --- |
| opus | `claude-opus-5-5` | 4 | 20 | 5 | 0.20 | same |
| sonnet | `claude-sonnet-5-5` | 2 | 10 | 2.5 | 0.10 (was 0.20) | same |
| haiku | `claude-haiku-5-5` | 0.10 | 0.50 | 0.125 | 0.01 | 0.50 / 2.50 / 0.625 / 0.05 |

Steps:
1. Tests first: `MODELS.haiku` is the new id; the six Haiku routes carry `effort: "low"`; no request body on any route contains `temperature` (replace `client.test.ts` "keeps it for Haiku"); a Haiku request with `maxTokens: 200` is sent with `max_tokens: 2048`; `meter` at 100,000 prompt tokens uses the base card and at 100,001 the long card, where the prompt is input plus cache-read plus cache-write tokens (confirm on the price page what counts); Sonnet cache reads meter at $0.10. verify: they fail on `main`.
2. `routing.ts`: the id; `MODEL_CAPABILITIES.haiku.effort = true`; `ALWAYS_THINKS.haiku = true` (thinking is on by default; effort is the control); `effort: "low"` on `linker`, `classifier`, `categoriser`, `quarantinedReader`, `moderation`, `founderTitle`; Haiku 4.5 moves into `LISTED_UNROUTED_MODELS`. Send no `thinking` parameter: the reference says to lower effort instead of disabling it. verify: `pnpm --filter @foundmill/models test routing`.
3. `client.ts`: delete the `temperature` branch and the field's use (API version `2026-10-21` rejects it on every model); apply the floor; `types.ts` and the two linker calls drop `temperature`. `pricing.ts`: the table and `longPrompt`. verify: step 1 passes; `pnpm --filter @foundmill/entity-linker test`; `grep -rn temperature packages/models/src packages/entity-linker/src` finds tests and comments only.
4. `SessionUsage.onResult`: when the SDK reports `costUSD` 0 for a model with tokens, price that entry with `meter()` (a session the credit saver moves to Haiku must not be free because the SDK's own table is older). verify: unit test in `session-live.test.ts`.
5. Live evals, before merge: `MODEL_MODE=live pnpm --filter @foundmill/evals exec vitest run src/__tests__/moderation.eval.test.ts src/__tests__/injection.eval.test.ts src/__tests__/typed-reads.eval.test.ts src/__tests__/source-watcher.eval.test.ts src/__tests__/golden.eval.test.ts`. Gate: typed reads at 100%, the others at their thresholds (`TEMPLATE_PASS_THRESHOLDS`: 0.8 for the utilities). Record output tokens and cost per case for the six routes beside the run on `main`. If `low` fails a suite, try `medium` before anything else. verify: the gates hold and both cost tables are in the pull request.
6. Only if step 5 shows output tokens per call above three times the old figure (Estimate) on `linker`, `classifier`, `categoriser` or `founderTitle`: add `thinking?: "off"` to `RouteDefinition` for those four (sent as `thinking: { type: "disabled" }`, accepted on Haiku 5.5 at `high` effort or below, never sent on Opus or Sonnet 5.5) and re-run step 5. verify: the suites pass again and output tokens per call fall.
Tests and evals: above. The same text is about 30% more tokens on the new model, so expect about a sevenfold saving, not tenfold (Estimate).
Done when: Done-when item 3; the eval figures are in the pull request.

### T5: Refusals are handled once, and Opus and Sonnet calls fall back on the server            [M] [ships alone]
Why: A7-13.
Files: modify `packages/models/src/routing.ts`, `pricing.ts`, `client.ts`, `structured-stream.ts`, `types.ts`, `errors.ts`, `client.test.ts`, `client.stream.test.ts`, `apps/api/src/services/model-errors.ts`, `apps/api/src/trpc.ts` (`toTRPCError`), `apps/orchestrator/src/activities/training.ts`, the five sinks (one detail).
Interfaces, consumes: `FAST_MODE_BETA` and the `anthropic.beta.messages.create({ ...params, betas })` call shape in `send()` and `openStream()`; `ModelOutputError(message, details, "refusal")`; `isModelRefusal(err)`; `modelBillingAppError(err)` as the pattern.
Interfaces, produces:
```ts
// routing.ts
export const SERVER_FALLBACK_BETA = "server-side-fallback-2026-07-01";
export const FALLBACK_SERVED_MODELS = { opus5: "claude-opus-5", opus48: "claude-opus-4-8", sonnet5: "claude-sonnet-5" } as const;   // what a fallback may be served by; never routed to
// pricing.ts
export function priceForServed(modelId: string): ModelPrice | undefined;   // MODEL_PRICING plus the three ids above ($5/$25, $5/$25, $2/$10; cache figures from the price page)
export interface MeterOptions { /* existing */ price?: ModelPrice }
// types.ts
CompleteRequest.allowRefusal?: boolean;  CompleteResult.servedModel?: string;  UsageEvent.servedModel?: string;
// apps/api/src/services/model-errors.ts
export function modelRefusalAppError(err: unknown): AppError;   // code "model_refused", 422, "The model declined this request. Reword it and try again."
```
Steps:
1. Tests first: an Opus or Sonnet request goes to the beta endpoint with `betas` containing `SERVER_FALLBACK_BETA` and body `fallbacks: "default"`, alone or beside the fast-mode beta; a Haiku request carries neither (Haiku 5.5 has no server-side fallback and a list returns 400); a response whose `model` is a fallback id is metered at that model's price and booked with `details.servedModel`; an unknown served id is metered at the requested model's price and flagged `details.unpriced`; `complete()` without a schema throws `ModelOutputError("refusal")` unless `allowRefusal` is set. verify: they fail on `main`.
2. Implement in `plan()`, `send()`, `openStream()`. Read the response shape (`usage.iterations`, the `fallback` content block) on the refusals-and-fallback page listed in the `claude-api` skill's `shared/live-sources.md` before writing; do not guess field names. Book at least the returned message's usage at the served model's price; when declined attempts carry their own usage, book them too. verify: step 1 passes; `pnpm --filter @foundmill/models test client`.
3. `toTRPCError` maps a refusal through `modelRefusalAppError`; the training candidate's refusal scores that test 0 and skips the grader call. verify: `agent-training.test.ts` and an orchestrator `activities.test.ts` case.
4. Sessions: do not pass the SDK's `fallbackModel` (it is for overload, not refusals, and a model switch restarts the cache); note it in the pull request. verify: `grep -rn fallbackModel apps/orchestrator/src` finds nothing.
Tests and evals: unit only; one live smoke of an ordinary Opus call with the beta on, inside D10, to prove the request is accepted.
Done when: every founder-facing refusal reads as the sentence above and no call returns a refusal as an answer.

### T6: Effort is written down for every route, then lowered where a sweep holds            [M] [step 1 ships alone; one pull request per later change]
Why: A7-09 (direct calls), Appendix A, A7-20.
Files: modify `packages/models/src/routing.ts`, `routing.test.ts`, `packages/agents/src/types.ts` (derive `ROUTE_DEFAULT_MODEL` from `ROUTES`, or add a value test), `evals/src/harness.ts`, `evals/package.json` (`"sweep": "MODEL_MODE=live tsx src/sweep.ts"`); create `evals/src/sweep.ts`, `evals/src/__tests__/sweep.test.ts`.
Interfaces, consumes: `HarnessOptions { client; businessName?; appName?; graderRoute? }`; `runGoldenTask(task, opts)`; `CompleteRequest.effort`, `CompleteRequest.modelOverride`; `evals/src/golden/tasks.ts` (57 tasks, most templates have one).
Interfaces, produces:
```ts
export interface HarnessOptions { /* existing */ effort?: Effort; candidateModel?: ModelKey }   // applied to the candidate call only
// evals/src/sweep.ts: pnpm --filter @foundmill/evals sweep -- --route worker --efforts low,medium,high [--models sonnet,haiku] --trials 3
// writes evals/sweeps/<date>-<route>.json and prints, per cell: cases, pass rate, mean score, cost per case, output tokens per case
```
Steps:
1. On the nine routes with no `effort`, write today's value (the first value in the table's effort column): no request changes meaning. verify: `routing.test.ts` pins the table; `client.test.ts` asserts `output_config.effort` on a `worker` and a `chiefOfStaff` request.
2. The harness passes `effort` and `candidateModel` to the candidate call; the judge stays fixed (`modelOverride: "opus"`, `effort: "medium"` on both grader calls in `harness.ts`) so moving the product's grader never moves the yardstick. verify: `sweep.test.ts` with a mock client asserts the request bodies.
3. `sweep.ts`: cells differ only in effort or model; every case runs at one cell before the next starts; three trials per cell. verify: `sweep.test.ts` (ordering, the table's arithmetic).
4. Run the `worker` sweep (about 40 of the 57 golden tasks are on that route). Rule: step down one level when the lower level's pass rate is within one case of the higher across three trials and its cost per case is at least 15% lower (Estimates); otherwise keep. verify: the table is in the pull request and `docs/DECISIONS.md`, and `routing.test.ts` pins any changed level.
5. Do not lower `departmentLead`, `chiefOfStaff`, `planner` or `codeReview` on this evidence: they have one to four golden cases each. They move only with WP-05's session outcome evals or with new cases (at least 20 real task goals for a route, Estimate). verify: the pull request changes no effort on those four routes.
Tests and evals: above. Expected spend of step 4: about 40 cases x 3 cells x 3 trials at 1 to 3 cents plus the judge, under $15 (Estimate).
Done when: `ROUTES` has no route without `effort`, and each change of level cites its sweep.

### T7: Sessions are told their effort and their limits            [M] [one pull request per step from 3 on]
Why: A7-09, A7-10, A7-14; §1.4 and AR-17 of `audits/a3a-agent-runtime.md`.
Files: modify `apps/orchestrator/src/activities/session.ts` (`prepareSession`, the `sdk.query` options, `DEFAULT_MAX_TURNS`), `activities/types.ts` (`SessionLaunch`), `apps/gateway/src/mcp.ts`; tests `session-live.test.ts`, `low-credits.test.ts`, `apps/gateway/src/__tests__/mcp.test.ts`; create `apps/orchestrator/src/__tests__/tool-budget.test.ts`.
Interfaces, consumes: `resolveModel(route, agent.modelKey, { lowCredits }): RouteResolution` (its `effort`); `SessionLaunch.maxTurns`; SDK options `effort?: EffortLevel`, `maxTurns?: number`, `taskBudget?: { total: number }` (alpha; sent as `output_config.task_budget` with beta `task-budgets-2026-03-13`; minimum 20,000); `sessionKeepsModelOnLowCredits({ module, toolRefs })`; `createMcpServer` returning both `content` and `structuredContent`.
Interfaces, produces: `SessionLaunch.effort?: Effort`; `TASK_KIND_MAX_TURNS: Partial<Record<TaskKind, number>>` beside `DEFAULT_MAX_TURNS`; `LIGHT_TASK_KINDS: readonly TaskKind[]` (step 5).
Steps:
1. `prepareSession` puts `model.effort` on the launch and `sdk.query` passes `effort: launch.effort`. With T6 step 1 merged this is the value the route already declares. verify: `session-live.test.ts` asserts the options object; after a week, T1's `agent_sessions.effort` shows what sessions ran at before and after.
2. `tool-budget.test.ts`: for every template, the Estimate of its granted tools' schema tokens (`estimateTokens(JSON.stringify(tool))` over the tools `resolveGrants(...)` grants, read from the connector registry as `grants-contract.test.ts` does) is under a ceiling set at today's largest plus 10%. It passes today and stops growth. verify: it runs.
3. `maxTurns` by task kind, from T1's report: the 90th percentile of turns of finished sessions of that kind, times 1.25, rounded up to 5; a kind with fewer than 20 finished sessions keeps 60 (the factor and the 20 are Estimates). verify: `session-live.test.ts`; in the report, under 5% of sessions have `num_turns` at the limit (Estimate).
4. `taskBudget`, only for a kind where the report shows more than 5% of sessions (Estimate) reaching the turn limit or ending blocked for `budget`: `total` is the 90th percentile of `tokens_out + cache_write_tokens` of finished sessions of that kind, never under 20,000, set once at launch. verify: `session-live.test.ts` asserts `taskBudget` only for the listed kinds; keep it only if WP-05's outcome eval holds within one case.
5. Needs D2: a session whose task kind is in `LIGHT_TASK_KINDS` and which the keep rule does not hold back runs on the route's `lowCredits` model (the credit saver's path, already built). Start with the kinds the report shows cheapest to redo; code and legal never. verify: `low-credits.test.ts`; then the done rate of those kinds does not fall by more than 5 points over 50 sessions (Estimate), or revert.
6. Tool results: one live check, inside D10, whether the SDK forwards both `content` and `structuredContent` to the model (two different markers, ask the agent to repeat what it read). If both arrive, drop `structuredContent` from `createMcpServer`'s results; keep `outcome` and `approvalId` in the text, because `session.ts` reads them. verify: `mcp.test.ts`.
7. Nothing to build for "## Skills": WP-06's index and `read_skill` shrink that section. After it merges, compare the median `cache_write_tokens` of sessions of agents with added skills before and after, and report it. AR-17 (splitting the system prompt at the brief) stays unbuilt until T1 shows one agent running several sessions within five minutes of each other. verify: the two medians are in `docs/PROGRESS.md`.
Tests and evals: above; steps 3 to 5 are judged on the ledger and on WP-05's outcome evals, not on the single-call golden tasks.
Done when: every session passes an explicit effort and a turn limit that comes from data.

### T8: A batch client in `packages/models`            [M] [ships alone]
Why: A7-12.
Files: create `packages/models/src/batch.ts`, `batch.test.ts`; modify `packages/models/src/index.ts`, `types.ts`, `client.ts`, `gate.ts`, `mock/index.ts`, `apps/orchestrator/src/models.ts` (`createBusinessModelClient` routes a batch to the paying key), the orchestrator's sink in `deps.ts`.
Interfaces, consumes: `plan(req)` (the same request body as `complete`), `meter(usage, modelId, { batch: true })`, `BATCH_DISCOUNT`, `bookUsage`'s `idempotencyKey`; the SDK's `client.messages.batches.create({ requests: [{ custom_id, params }] })`, `.retrieve(id).processing_status`, `.results(id)`.
Interfaces, produces:
```ts
export interface BatchItem<T = unknown> { customId: string; request: CompleteRequest<T> }     // letters, digits, "_" and "-"; at most 64 characters
export type BatchItemResult<T = unknown> = { customId: string; ok: true; result: CompleteResult<T> } | { customId: string; ok: false; kind: "errored" | "canceled" | "expired" | "refusal" | "invalid_output"; message: string };
export function submitBatch(client: ModelClient, items: readonly BatchItem[]): Promise<{ batchId: string; count: number }>;
export function batchEnded(client: ModelClient, batchId: string, businessId?: string): Promise<boolean>;
export function collectBatch<T>(client: ModelClient, batchId: string, items: readonly BatchItem<T>[]): Promise<BatchItemResult<T>[]>;
// UsageEvent gains batch?: { id: string; customId: string }; a sink books such an event with idempotencyKey `batch:${id}:${customId}`
```
Steps:
1. Tests first with a fake fetch: a batch body carries no `stream`, `speed` or `fallbacks`; results arriving in another order are matched by `custom_id`; each succeeded result is metered at half price and reaches `onUsage` once with `batch`; collecting twice books once; a refused or cut-off result is `ok: false`, with no repair call (a batch is single-shot); the gate is asked once per item at submit; all items of one batch belong to one business. verify: they fail.
2. Implement; the mock client answers at submit and reports ended at once, so `MODEL_MODE=mock` runs the whole path. verify: step 1 passes; `pnpm --filter @foundmill/models test batch`.
Tests and evals: unit only.
Done when: `batch.test.ts` passes. Its first callers are T10 here and WP-06 T8 (the platform's skill measurement, from `evals/`).

### T9: Training says a true price, checks it against the balance, and grades for less            [M] [ships alone]
Why: TS-03, A7-06, A7-11 (the breakpoint).
Files: modify `apps/api/src/routers/agent.ts` (`training.estimate`, `training.run`, `model.set`, a new `model.retestEstimate`), `apps/orchestrator/src/activities/training.ts`, `packages/models/src/types.ts`, `client.ts` (`buildSystem`), `routing.ts`, `routing.test.ts`, `apps/web/components/agents/ModelChangeDialog.tsx`, `packages/modules/src/team/ModelChangeDialog.tsx`; create `evals/src/skills/grader-agreement.ts`, `evals/src/__tests__/grader-agreement.eval.test.ts`; tests `apps/api/src/__tests__/agent-training.test.ts`, `apps/orchestrator/src/__tests__/activities.test.ts`, `apps/web/e2e/agent-profile.spec.ts`.
Interfaces, consumes: `REFERENCE_TEST_USAGE`, `REFERENCE_GRADE_USAGE` and the inline sum in `training.estimate` (which prices the grader at `MODELS.opus`); `checkPlatformCredits(db, businessId, { live }): Promise<PlatformCreditsCheck>` (`spendableMinor`); `runSkillTests`' candidate call (`system: [system, "## Training ..."]`, `cacheSystem: true`); `graderFor(...)` on route `skillGrader`; `scoreTest(graderScore, checks)`.
Interfaces, produces:
```ts
export function trainingEstimate(input: { tests: number; agentModel: ModelKey; batch: boolean }): { costMinor: number; currency: "USD"; label: "Estimate" };   // grader priced at resolveModel("skillGrader"), not a literal
// agent.training.estimate also returns batchCostMinor; agent.model.retestEstimate({ agentId, modelKey, applyScope }) → { agents: number; tests: number; costMinor: number; currency: "USD"; label: "Estimate" }
// agent.training.run and agent.model.set refuse a run the credits cannot finish: AppError("training_unaffordable", sentence, 402, { estimateMinor, spendableMinor })
// CompleteRequest.cacheSystem?: boolean | number   // a number is the index of the last system block to cache
```
Steps:
1. Tests first: a business with $1.00 spendable and a $1.40 estimate gets 402 with both figures and no run row; a business on its own key is not checked; `model.set` with retests it cannot afford is refused the same way. Sentence: "This check costs about $1.40 (Estimate) and $1.00 of credits is left. Check fewer skills, or add credits or your own key." verify: they fail.
2. Implement the check and `trainingEstimate`; calibrate the reference usage so the Estimate is not below the measured cost per test (the report's `trainingRuns` block: run cost over the tests in its marker rows). verify: step 1 passes; for the measured run's test count the Estimate is at or above its measured cost.
3. Both model dialogs show the retest's price from `retestEstimate` before the founder confirms, and `agent.model.set` gains `retest: z.boolean().optional()`: on for one agent as today, off unless chosen for "every agent of its type" and "all" (TS-03 c), where one press could otherwise queue a retest per agent. An agent whose model changed with no retest keeps its ratings marked as WP-06 marks an untested change. verify: `agent-profile.spec.ts`; `agent-training.test.ts`: a wider scope without `retest` queues none.
4. The candidate call passes `cacheSystem: 0`, so the agent's prompt is one cached block shared by every test and the per-test block stays outside it. verify: `client.test.ts` (breakpoint on block 0); the report's `cacheShareByRoute` rises for the training calls.
5. Grader agreement: grade the outputs of 30 golden tasks with the judge (Opus, `medium`) and with Haiku 5.5 at `low`. Move `skillGrader` to `haiku` with `effort: "low"` if pass or fail agrees on at least 27 of 30 and the mean score differs by at most 0.1 (Estimates); else try Sonnet at `low`; else keep Opus and set `effort: "low"`. verify: the agreement figures are in the pull request and `routing.test.ts` pins the result.
Tests and evals: above; `grader-agreement.eval.test.ts` is the gate for step 5.
Done when: Done-when item 4 except the batch figure. The Train dialog already shows an Estimate; this makes it true and binding.

### T10: Training tests on the batch path            [M] [after T8 and after WP-06 T10, the scoped check, merges]
Why: TS-03 (b), A7-06, A7-12.
Files: modify `apps/orchestrator/src/workflows/trainingRun.ts` (behind `patched("training-batch")`), `activities/training.ts`, `activities/types.ts` (`TrainingRunInput.batch?: boolean`), `apps/api/src/routers/agent.ts` (`training.run` input `mode: z.enum(["now", "batch"]).default("now")`), `apps/web/components/agents/TrainingTab.tsx` (two buttons with their prices); tests `activities.test.ts`, `agent-training.test.ts`, `agent-profile.spec.ts`.
Interfaces, consumes: T8's three functions; WP-06 T10's `training_runs.kind` and `skill_keys` (at most three); `runDeterministicChecks`, `scoreTest`, `finalizeTrainingRun`.
Interfaces, produces: activities `submitTrainingCandidates(input) → { batchId }`, `trainingBatchEnded({ batchId, businessId }) → boolean`, `submitTrainingGrades({ candidateBatchId }) → { batchId }`, `collectTrainingOutcomes({ candidateBatchId, graderBatchId }) → SkillTestsOutcome[]`.
Steps:
1. Tests first (mock mode): a batch run produces the same `SkillTestsOutcome[]` as a run now on the same fixtures; a refused candidate scores 0 and is not graded; a retried collect books nothing twice; a canceled run submits no second batch. verify: they fail.
2. Workflow: submit candidates, sleep two minutes at a time until ended (give up after 24 hours with "The half-price check did not finish in a day. Run it now, or try again."), run the deterministic checks, submit the grades, wait, collect, finalize. A run now keeps today's path. verify: step 1 passes; a run started before the change follows the old path (`patched`).
3. The dialog: "Run now, about $X" and "Run within a day at half price, about $Y", both labeled Estimate. Which is the default is D11. verify: `agent-profile.spec.ts`.
4. One live three-skill check each way, inside D10. verify: both costs are in `docs/DECISIONS.md` and replace the Estimates in Done-when item 4.
Tests and evals: above.
Done when: Done-when item 4 in full.

### T11: The first round of a free project fits the allowance            [S] [ships alone; needs D6; after WP-04 T3]
Why: FR-04 (fix 3), AR-14. WP-04 T3 decides which tasks commit creates and whether round 1 starts at commit (a founder with a budget) or later (plan approval, Continue or the first night). This task only bounds what round 1 may spend, wherever it starts.
Files: modify `packages/config/src/pricing.ts`, `apps/api/src/services/commit.ts` (the start at `workflowIds.cycle(result.business.id, 1)`), `apps/api/src/services/cycle.ts` (`startCycle`, when `cycleNumber === 1`), `apps/api/src/__tests__/idea-commit.test.ts` and the test that covers `startCycle` (grep `startCycle` in `apps/api/src/__tests__`).
Interfaces, consumes: `BusinessCycleInput { budgetCapMinor?: number | null; maxConcurrent?: number }` (`apps/orchestrator/src/activities/types.ts:175`); `temporal.start(WORKFLOWS.businessCycle, { args: [{ businessId, cycleNumber: 1, trigger: "continue" }] })`; `taskReserveMinor(budgetMinor, budgetRemaining, freeSlots)` (with one slot a session gets the whole remaining cap); the overnight path already carries its own cap.
Interfaces, produces: `export const FIRST_CYCLE_SESSION_CAP_MINOR = 75;` (Estimate) and `firstCycleInput(input: { modelBilling: "credits" | "byok"; tier: TierKey }): { budgetCapMinor?: number; maxConcurrent?: number }` in `packages/config`.
Steps:
1. From the report's `firstDayPerProject`: the cap is the first-session target ($1.50, D1) less the median of everything outside sessions on the first day (foundations, the page, the second read, the plan, the notes). Use 75 until the report exists. verify: the number and its arithmetic are in the pull request.
2. Test first: round 1 of a free project on credits starts with `budgetCapMinor` and `maxConcurrent: 1` from commit and from `startCycle`; a project on its own key or a paid plan, and every later round, start as today. verify: the two api tests assert the start arguments.
3. Implement. No workflow change: both inputs exist. verify: step 2 passes.
Tests and evals: above.
Done when: after 10 new projects (Estimate of enough) the report's first-day median is at or under the target, or the cap is changed and the reason recorded.

### T12: The overnight numbers come from the report            [S] [needs D7; the workflow half is WP-05's]
Why: AR-06. The 2026-11-12 decision set one cycle and $0.15 a night; the measured session costs $0.14 on Sonnet and $0.41 on Opus, and the cap is cut into shares.
The split: WP-05 T15 changes `workflows/businessCycle.ts` and `runLiveSession` (a capped round runs only as many sessions at a time as the cap can pay for at the floor; a session whose cap is under the floor ends blocked for budget before any model call) and adds `MIN_SESSION_CAP_MINOR = 10` (Estimate) in `apps/orchestrator/src/cycle-contract.ts`. This task sets that constant's value and `OVERNIGHT_SHIFT.ownSpendCeilingMinor` (`packages/shared/src/autopilot.ts`) from the report's `sessionsByModelAndOutcome`: the floor is the median cost of a finished session on the route's low-credits model, rounded up to 5 cents.
Files: modify `packages/shared/src/autopilot.ts`, `apps/orchestrator/src/cycle-contract.ts` (if WP-05 T15 has not merged, change only the preset and leave the floor to it), their tests, `docs/DECISIONS.md`.
Interfaces, consumes: `OVERNIGHT_SHIFT = { localHour: 2, cadence: "daily", ownMaxCyclesPerDay: 1, ownSpendCeilingMinor: 15 }`; `SessionLaunch` and `prepareSession`'s `lowCredits`; the session input's `spendCapMinor`. Produces: two numbers, and for option C one more condition on `lowCredits`.
Steps:
1. Put the report's medians and the three options to the founder (D7). verify: the choice is recorded in `docs/DECISIONS.md`.
2. Change the two numbers and the preset's comment. verify: the autopilot tests pass with the new values; the report later shows night sessions ending `done`, or `blocked` for a reason other than `budget`.
3. If the founder picks option C: in `prepareSession`, a session whose `spendCapMinor` is under the floor of its usual model runs on the route's `lowCredits` model, under the same keep rule as the credit saver. verify: `low-credits.test.ts`.
Tests and evals: `apps/orchestrator/src/__tests__/autopilot.test.ts`, `low-credits.test.ts`; no eval.
Done when: a default night can pay for at least one finished session, by the report.

### T13: Zero credits: what stopped, what still works, and a way on that works            [M] [steps 1 to 5 ship alone; step 6 needs setup S8]
Why: A7-05, FR-04 (fix 4). The credit saver (2026-11-13) already keeps routine work going on a lighter model below the low line; nothing changes there.
Files: modify `packages/shared/src/env.ts`, `packages/config/src/pricing.ts`, `apps/api/src/services/payments.ts`, `packages/db/src/billing.ts`, `apps/orchestrator/src/activities/session-credits.ts` (`CREDITS_USED_UP_SUMMARY`), the callers that pass the new option (`apps/api/src/services/models.ts`, `apps/composer/src/usage.ts`, `apps/orchestrator/src/deps.ts`, `models.ts`, `activities/session.ts`, `apps/gateway/src/builtins.ts`), `apps/web/components/settings/BillingTab.tsx`; tests `packages/db/src/__tests__/billing.test.ts`, `apps/api/src/__tests__/credits-ceiling.test.ts`, `billing-checkout.test.ts`, `apps/web/e2e/billing.spec.ts`.
Interfaces, consumes: `topUpAvailability(env)`; `creditsWayBack(tier, state, pool)`; `assertPlatformCredits(db, businessId, options: CreditsCheckOptions)`, whose sentence says "Top up in Settings › Billing" on every server; `bookUsage(db, businessId, input, options)`; `TOP_UP_OPTIONS_MINOR = [2500, 5000, 10000, 25000]`, `TOP_UP_MIN_MINOR = 500`.
Interfaces, produces:
```ts
export const topUpsOnSale = (env: Pick<Env, "APP_ENV" | "INTEGRATIONS_MODE" | "LIVE_CONNECTORS" | "ALLOW_MOCK_PAYMENTS">): boolean;   // packages/shared: platformBillingMode(env) === "live" || allowMockPayments(env)
export function waysToContinue(input: { tier: TierKey; topUps: boolean; nextCreditsOn: Date }): string;   // packages/db billing.ts: the one sentence builder; the existing own-key branch wraps it
// CreditsCheckOptions and bookUsage's options gain topUps?: boolean (default false: a top-up is never named unless the caller says it can be bought)
// packages/config: TOP_UP_OPTIONS_MINOR moves here (amounts are D4)
```
Steps:
1. Tests first: with `topUps: false` neither the Inbox note, the 402 sentence nor the session summary contains "Top up"; with `topUps: true` the 402 sentence and the session summary name it, and the Inbox note names it on a paid plan (the free plan's note is D4, step 5); all three name the own key and the date next month's credits arrive. verify: they fail on `main` (the 402 sentence names a top-up nobody can buy).
2. `waysToContinue` and its three users; the callers pass `topUps: topUpsOnSale(env)`. verify: step 1 passes.
3. The note also says what stopped (agents, conversations, Refresh, planning, drafting) and what still works with no model call. List only what a test proves at zero credits: reading everything the team wrote, editing and publishing the public page by hand (`pages.ts` checks text locally), answering a note with a prepared option. verify: `credits-ceiling.test.ts` runs each at zero credits; a conversation send returns 402.
4. The Billing tab shows the same three lines at zero. verify: `billing.spec.ts`.
5. Needs D4: the amounts offered, and whether the free plan's note names the top-up first where one can be bought (today it names only the key, by the 2026-10-12 decision). verify: `billing.spec.ts` shows the decided amounts and `billing.test.ts` pins the free plan's note.
6. Needs setup S8: after WP-00 records Stripe as set up, one test-mode run of checkout, webhook, `settleCreditCheckout`, lot, resume. Until then the code path stays as it is, with the mock passing. verify: the checkout id, the lot and the resumed team are recorded in `docs/DEPLOY.md`.
Tests and evals: above.
Done when: Done-when item 5.

### T14: Allowance and prices are config, and the numbers are the founder's            [S] [ships alone]
Why: THESIS 7.1 through AR-14; A7-05 (4).
Files: modify `packages/config/src/pricing.ts` (comment only where a number stays "TBD"), `packages/config/src/__tests__/pricing.test.ts`, `docs/DECISIONS.md`.
Interfaces, consumes: `TIERS`, `includedCreditsMinor(tier)`, `tierAvailability(env, tier)` (a numeric price already reads as "opens once the checkout is ready"). Produces: nothing new.
Steps:
1. A test lists every money number this package added (`FIRST_CYCLE_SESSION_CAP_MINOR`, `TOP_UP_OPTIONS_MINOR`, the two pre-commit ceilings, `MIN_SESSION_CAP_MINOR`, `OVERNIGHT_SHIFT.ownSpendCeilingMinor`) and asserts each is exported from `packages/config`, `packages/shared`, the env schema or, for the floor, `apps/orchestrator/src/cycle-contract.ts`: never a literal inside a function. verify: it passes.
2. After at least 30 projects and four weeks of T1's data (Estimate of enough), write one DECISIONS entry: the report's output, the share of projects that reached the low line and zero, the cost of a finished task by route, and the founder's choice for the allowance and for Pro (D1, D8). `TIERS.pro.priceMonthly` and `includedCreditsMinor` stay "TBD" until that entry exists; the code already handles numbers. verify: the entry quotes the report and names the founder's choice.
Tests and evals: the config test of step 1.
Done when: the entry exists, or the package closes with the reason it cannot yet (too few projects).

### T15: Decision record: a fourth model key            [S] [document only]
Why: A7-08, A7-23, Appendix C.
Files: modify `docs/DECISIONS.md` only. Interfaces: none. Tests and evals: none.
Steps: write one DECISIONS entry with the recommendation below and this list of every place that assumes three keys. verify: `grep -rn '"haiku"' apps packages` finds no file outside the list (tests and stories aside).
- Enum: `packages/shared/src/constants.ts` (`MODEL_KEYS`). Check constraints, new migration needed: `0004_agents_departments_tasks.sql` lines 12, 43, 353 and `0009_finance.sql` line 136; T2's `account_usage`.
- Drizzle and Zod: `packages/db/src/schema/agents.ts`, `schema/finance.ts`, `repos/usage.ts`, `apps/api/src/routers/agent.ts` (`z.enum(MODEL_KEYS)`).
- Models: `routing.ts` (`MODELS`, `MODEL_CAPABILITIES`, `ALWAYS_THINKS`, `RANK`), `pricing.ts`, `planParams.ts`, `client.ts`, `model-ids.test.ts` (its pattern matches only the three families: widen it in the same change).
- Agents and policy: `packages/agents/src/types.ts`, `prompts/agent-builder.ts`, `packages/policy/src/types.ts`.
- Orchestrator: `activities/session-credits.ts` (`MODEL_RANK`), `activities/training.ts` (`MODEL_NAMES`, the literal union on `runSkillTests`), `activities/holiday.ts`, `workflows/agentSession.ts`.
- Screens: `packages/dugout/src/components/agents/SquadCells.tsx`, `ModelPicker.tsx`, `mock.ts`, `packages/dugout/src/components/journey/fixtures.ts`, `apps/web/components/agents/logic.ts`, `LogsTab.tsx`, `ModelChangeDialog.tsx`, `TrainingTab.tsx`, `packages/modules/src/team/ModelChangeDialog.tsx`, `packages/modules/src/finance/WageBillScreen.tsx`; seed `packages/db/src/seed/journey.ts`.
Recommendation: do not add one now. `claude-fable-5-2` costs $8 / $40, twice Opus 5.5; the planning routes run at `low` or `medium` today, and raising effort on one model is the cheaper first test and keeps one cache. It also behaves differently (thinking cannot be configured, it needs 30-day data retention, single requests can run for minutes), so it is a migration, not a row in a table. Revisit when a sweep shows the cycle plan or the Planner failing at `high` effort.
Done when: the entry is merged.

### T16: The $5 entry plan and credit packs on Foundmill's own Stripe            [L] [after T12 to T14; behind its switch; live needs setup S8]
Why: founder, Nov 17, 2026 ("WE need Stripe from when WE launch"); docs/log/2026-11/2026-11-17-claude-wp09-paid-entry-plan.md and its two follow-ups.

What it builds:
- **The entry plan.**
  - A $5.00-a-month Stripe subscription (one recurring price, its id in env).
  - The ingest webhook grants each paid period's $5.00 of credits through the existing period row.
  - Cancellation and a failed renewal stop the next grant. Nothing already granted is taken back.
- **Credit packs** of $20, $50, $100, $250 and $500.
  - Each is a one-time Checkout with inline line items, as today's top-ups are.
  - A pack's credits come from config: price per credit and markup are the founder's open question, a placeholder
    marked Estimate until set.
  - "Has bought a pack" is recorded on the account. It unlocks Claude models on Foundmill's key (WP-13 T7's check)
    and lets the owner remove the "Built on Foundmill" mark (`tierShowsBuiltOnMark` takes it).
- **The gate at the first AI run.** Continue, an approval's cycle, cycle 1 at commit and the overnight shift are
  refused without the subscription, with the way to subscribe. The page, the plan and the foundations are drafted and
  shown first (WP-04's screens).
- **Paying is a pay-and-resume loop** (founder, Nov 17, 2026). When work needs something paid for, the request
  says in plain words what is bought, why the team needs it now and what it costs. One press goes to Stripe's
  checkout, and the payment's confirmed event resumes the paused work by itself.
  - This covers the plan at the first run, a pack when credits run out (T13's zero-credits exit is the first
    instance) and, later, a named one-off charge such as a domain.
  - A canceled or failed checkout leaves the work paused and the request in place, said once.
  - Agents never pay without asking. Virtual cards are dropped.
- **One config value** flips invite-only-free to paid entry. Invited test users convert on the day: their projects
  stay, and AI runs wait for the subscription.
- Checkout is always the person's own press on Stripe's page; agent code never moves money. Nothing is offered before
  Stripe is live, and nothing new appears in production until the switch.

Files, interfaces and steps are written when the task starts, from setup S8's answers.
Done when: in test mode, a subscription and a pack each settle once through the webhook, and the gate refuses then
lets through. The mock path passes with the switch off and on.

## Corrections to the audits

- A7-04 proposes `thinking: { type: "disabled" }` on four Haiku routes and in `validateKey`. The reference says to leave thinking unset on Haiku 5.5 and lower effort; T4 does that and adds the off switch only if measured output tokens call for it. `validateKey` needs no change: a `max_tokens: 1` call still returns 200.
- A7-04 says ten times cheaper. The new model counts about 30% more tokens for the same text, so about seven times (Estimate).
- A7-08 leaves the Opus cache-read price "not verified". It is right at $0.20; only Sonnet's is stale ($0.20 in code, $0.10 listed).
- A7-07 says every sink drops the cache counts. The composer's sink keeps them (`details.usage`) and already counts cache tokens in `quantity` (`apps/composer/src/usage.ts`).
- A7-02 and FR-11 say calls before commit are unbooked and uncapped in dollars. True for a signed-in person. The signed-out idea box already reserves against a daily dollar ceiling (`IDEA_BOX_DAILY_CEILING_CENTS`, default $20) and stores each card's cost in `idea_drafts.cost_micro`. The code also has two call sites neither audit lists: Import's single card (`services/import-concept.ts`) and the moderation screen of a post made without a business (`services/live.ts`).
- A7-02 would copy pre-commit rows into the business ledger at commit, and FR-11 would give the table an own-row read policy. Neither is needed: the report joins by `businesses.created_by`, and no screen reads the table.
- A7-09 says sessions run at the API's default effort. The code cannot show that: the Agent SDK is Claude Code as a library and may apply its own default. T1 records what the SDK reports and T7 sets it.
- A7-09 and Appendix A propose turn limits of 25 and 40 and `codeReview` at `high`. Both are guesses; T7 takes turn limits from the report and T6 keeps `codeReview` at today's `medium`.
- Appendix A puts `web.search_web` on Haiku 5.5 "or Sonnet". The reference lists `web_search_20260209` for Fable, Opus and Sonnet models, not Haiku 5.5: it stays on Sonnet.
- Appendix A marks `nightlyBatch` for batching. No code calls that route.
- A7-12 proposes a `model_batches` table. The workflow holds the batch id and each result is booked once by its idempotency key, so no table is needed.
- A7-06 and TS-03 read as if no price is shown before a run. The Train dialog shows an Estimate (`TrainingTab.tsx`, from `agent.training.estimate`); what is missing is the check against the balance, the retest's price in the two model dialogs, and an Estimate that matches measured runs.
- Appendix C misses three files that assume three keys: `apps/orchestrator/src/activities/holiday.ts`, `packages/agents/src/prompts/agent-builder.ts`, `packages/dugout/src/components/journey/fixtures.ts`.
- A7-01 step 1 names migration `0108_session_outcome_detail.sql` and TS-03 names `0109`. Numbers are taken when a branch is cut, never reserved.
- AR-14 and FR-04 (fix 1) each propose a report script. One exists in the plan: WP-02 T11 writes it and this package extends it.
- The evals are single calls. A7-09's "session golden tasks" do not exist; session outcome evals are WP-05's (AR-15).
- Not in any audit: `FAST_MODE_BETA` is sent for Opus 5.5 fast mode, which no longer needs a beta flag. Fast mode is off (2026-10-16), so nothing to do until someone turns it on.

## Decisions for the founder

- D1 Targets and allowance. Recommended: keep $5.00 a month; first session at most 30% of it, first week at most 70%; decide again from T14's entry.
- D2 Model moves, route by route, each with its eval table: `departmentLead`, `ideation` cards, `foundations` sections, `logoDesigner`, `documentReview`, `coach`, `journeyCommentary` to the key in the routing table, and routine task kinds of `worker` on the lighter model. Recommended: yes where the eval holds; the Opus-at-`low` test first for `departmentLead`.
- D3 Ceilings before commit. Recommended: $2.00 a day and $5.00 in 30 days per account, so an account with no project can cost at most what a free project is given (Estimates).
- D4 Top-ups. Recommended: offer $5, $10, $25 and $50 instead of $25 to $250, and let the free plan's note name the top-up first wherever one can be bought (this replaces part of the 2026-10-12 billing decision).
- D5 Before Stripe is live. Recommended: offer nothing new (own key, or wait for next month), say so honestly, and do setup S8 first. The alternative is a one-time grant in the first month, which is real money per account under open sign-up.
- D6 What the first round of work may spend on the free plan. Recommended: its sessions run one at a time under a 75-cent cap (Estimate) until the report sets it; WP-04 T3 decides which tasks exist and when the round starts.
- D7 Overnight. Option A: raise the nightly cap to the cost of one finished session (Sonnet: about $4.20 a month at $0.14, Estimate, most of the allowance). Option B: keep $0.15 and run every third night. Option C, recommended: keep $0.15 nightly and run routine night work on the lighter model, which the credit saver already knows how to do.
- D8 Pro: its price and included credits. Recommended: decide nothing until T14's entry; top-ups are the exit meanwhile.
- D9 A fourth model key. Recommended: no (T15).
- D10 Spending limit for live evals in this package. Recommended: $40 in total (Estimate: T4 about $5, T6 about $15, T9 and T10 about $10, T5 and T7 a few cents each).
- D11 Whether a training check defaults to "within a day at half price". Recommended: yes on the free plan. Decided Nov 25, 2026: yes on every plan, and the $1.00 target of Done-when item 4 applies to that path.

## Risks

- No new project has been created since Oct 25. Until the door opens (WP-03), Done-when item 1 can only be read on test accounts, and T11 and T14 wait for real ones.
- Haiku 5.5 thinks by default, counts more tokens and can decline a request with no server-side fallback. A declined read withholds the content and a declined post is held, both safe; watch the rate of each after T4.
- A fallback answers from another model: its price differs and it starts a cold cache. T5 meters by the model that answered; an id the table does not know is flagged, not guessed.
- The golden evals have one case for most templates and no tools. They can support an effort change on the `worker` route and little else; T6 and T7 say where they stop.
- `taskBudget` is alpha in the SDK and advisory in the API. It ships only where the report shows a problem it could fix.
- A batch can take up to a day. Training is the only user; the dialog says so before the founder chooses.
- The dollar ceiling before commit is read per call: twelve parallel card calls can pass it together. Accepted, bounded by one draft.
- `session.ts` is changed by WP-05 at the same time. Rebase before each T7 step; keep each step small.
- Prices are config with a date. Any figure here can be stale by the time a task starts: check the price page and the `claude-api` skill first.

## Starting prompt

```
You are executing work package WP-09 "Models and money" for Foundmill. Read, in this order: FOUNDMILL.md; docs/holistic-plan/README.md; docs/holistic-plan/WP-09-models-and-money.md; the CLAUDE.md files of packages/models, packages/db, apps/api, apps/orchestrator and apps/gateway; then, for the task you are on, the audit sections it cites under docs/holistic-plan/audits/.

Load the skills `claude-api` (the reference for every model id, price and request parameter: where it differs from the work package, it wins), `karpathy-guidelines`, `plan-change`, `test-driven-development` and `executing-plans`. Run `plan-change` before writing code: it finds overlapping branches and the next free migration number.

Work the tasks in order, T1 first: nothing is tuned before it is measured. One task, one pull request on a branch named claude/wp-09-t<n>, unless the task says otherwise. Write the failing test the task names, make it pass, run `verify-done`, and report each check with its result and what the checks do not cover. Never push to main and never merge.

Before each task, check the names it quotes against the code and against the sibling packages it names (WP-02 T11, WP-04 T3, WP-05 T15, WP-06 T8 and T10); if the code moved, follow the code and say so in the pull request. Check the routing table's "today" columns against packages/models/src/routing.ts before T4 and T6.

Stop and ask the founder instead of guessing when a task says "needs the founder", "needs D<n>" or "needs setup": T1 step 6, T4 to T10 for the eval spending limit (D10), T7 step 5 and every model move (D2), T11 (D6), T12 (D7), T13 steps 5 and 6 (D4, S8), T14 step 2 (D1, D8). Do not start T16. Live evals spend real money: state the expected cost before you run them.

After each merged task add one line to docs/PROGRESS.md, record judgment calls and measured figures in docs/DECISIONS.md, and tick the task in the work package file.
```
