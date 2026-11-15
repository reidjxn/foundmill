# WP-02: Truth and measurement

**Goal:** no screen, note or agent says something happened or can happen when it did not or cannot, and the funnel, the north star, retention and cost are computed every night from production, with demo projects left out.

**Why:** `audits/a5-go-to-market.md` GTM-02, GTM-03, GTM-09, GTM-10, GTM-16 and §3.5; `audits/a1-first-run.md` FR-06 (the parts outside the landing page), FR-07, FR-10, FR-11 (reporting only), FR-12; `audits/a3a-agent-runtime.md` AR-13, AR-14; `audits/a4-building-product.md` A4-03, A4-10, A4-15; `audits/a2-console-design.md` A2-09, A2-11, A2-18; `audits/a8-data-api-security.md` A8-06 (the metrics leak), A8-08; `audits/a7-models-gateway-economics.md` Appendix B; `audits/a11-roadmap-status.md` §4, §5, §9; `audits/e0-production-evidence.md`. On Nov 15, 2026 the first 13 founders had been asked 127 times to approve something, 79 of them a campaign launch that sends nothing, and answered 14; 19 fabricated leads sit in real projects' Customers; nobody can state the funnel or the north star without hand-written SQL.

**Done when (each line is checked by a named test or by the nightly numbers):**
1. On a real project, no `approvals` row with `tool = 'launch_campaign'` is created for a channel that is not in offline tracking, and no campaign is set `live` and no `campaign.launched` is written unless something left the product or a founder task was created (T2 tests).
2. Every approval that expires writes `approval.resolved` with `outcome: "expired"`; the nightly numbers show `open approvals older than 9 days = 0` (T1, T10).
3. On real projects: 0 contacts whose address ends in `.example` with an open `lead` role, 0 `channel_metrics` rows with `source = 'estimate'`, 0 `integrations` rows with `status = 'mock'`, 0 campaigns `live` with nothing sent (T4; reported nightly by T10 as `fabricated_left`).
4. Each string in the tables of T5, T6 and T7 reads as its "After" column under the stated condition, pinned by a unit test.
5. With Builder view off, the shell shows no "cycle", "orchestrator" or "Inbox" as a destination name, and says "project" where the stage is not known (T8 test).
6. `pnpm --filter @foundmill/db report:metrics -- --as-of 2026-11-15` prints the figures in "T10, numbers it must reproduce"; a row per day lands in `platform_metric_days` from the next night on.
7. `pnpm --filter @foundmill/db report:cost` prints cost per first day, per project-week, per route and per blocked session for real projects (T11).
8. docs/DEPLOY.md §6 is the production record table and `node scripts/check-production.mjs` exits 0 against production for every row it can check from outside (T12).

**Scope, in:** the channel engine's approval and "live" claims for real projects (the smallest honest version); approval expiry events; refusing before asking at the gateway; cleaning fabricated rows and guarding the generators; false strings outside the landing page; one vocabulary in the shell; four funnel events in the account event store; the nightly metrics; the cost report; the production record and its check script.

**Scope, out (and who has it):** landing page copy, robots, sitemap (WP-03). Launchers per channel, the `prepared`/`sent` campaign statuses, Channel Board copy, follower email, post outcomes (WP-08: this package only stops the false claims). `apps/orchestrator/src/activities/session.ts` beyond the three-line `codeTaskNote` condition in T5; dropping unconnected tools at `prepareSession` (GTM-09 b) and marking simulated calls on a session (GTM-26) are WP-05. `usage_ledger` changes, booking of pre-commit calls, per-account ceilings (WP-09: A7-02, A7-03, FR-11's table). The page as first panel on Today, one plan note, Commit as name-and-go (WP-04). The "So far" panel on Today (WP-10; T6 fixes only the Cash tile's false zero). OUTLINE.md's row for this package also lists AR-03, A4-06, A7-02 and A7-03; the brief for this package does not, and they stay with WP-05 and WP-09.

**Depends on:** nothing. **Feeds:** WP-03 (funnel events), WP-04 (`FIRST_DAY_PROMISE`), WP-08 (the engine gate it widens with launchers), WP-09 (`report:cost`), WP-00 and WP-01 (`scripts/check-production.mjs`, the nightly hook).

**Collides with:** WP-05 on `apps/orchestrator/src/activities/session.ts` (T5 step 5 touches only `codeTaskNote`, lines 2021 to 2027: merge it before WP-05's first session task or hand it to that task); WP-08 on `apps/orchestrator/src/activities/channel.ts` and `packages/shared/src/channel-availability.ts` (T2 goes first; WP-08 widens `channelEngineMayRun` when it adds a launcher); WP-10 and `claude/blissful-fermat-q03yq1` on `packages/dugout/src/components/shell/*` (T8 changes strings only in `ProcessingStrip.tsx`, `ContinueButton.tsx`, `BusinessSwitcher.tsx`: rebase on that branch if it has merged); WP-01 on `.github/workflows/` (T12 adds no workflow: WP-01 owns the nightly job that calls the script); every package that adds a migration (T9 and T10 each take the next free number when the branch is cut, 0108 and journal idx 96 at `04a0a509`; renumber on rebase).

**Setup it needs:** T4's apply step needs the founder's yes and one Railway variable on the orchestrator (Desktop session). T12 reads what WP-00 S3 records. Nothing else waits on WP-00.

**Order:** T1, T2, T3 (stop the noise), T4 (clean up), T5 to T8 (words), T9 to T11 (numbers), T12 (record). T1 to T3, T5 to T8 and T9 to T12 can run as three parallel lanes; inside a lane, in order.

---

## Tasks

### [x] T1: An approval that expires says so                                   [S] [ships alone]

**Why:** GTM-02 step 4; §1.8 of `audits/a5-go-to-market.md` ("79 requested, 14 resolved"). The code has three silent expiry paths, not one (see Corrections).

**Files:** modify `apps/orchestrator/src/activities/approvals.ts`, `packages/db/src/repos/approvals.ts`, `packages/db/src/repos/campaigns.ts`, the callers of the two repo functions; tests `apps/orchestrator/src/__tests__/approvals.test.ts` (or the file that already tests `resolveApproval`), `packages/db/src/__tests__/approvals.test.ts`.

**Interfaces, consumes:** `expireApproval(input: { businessId: string; approvalId: string }): Promise<{ expired: boolean; outcome: "approved" | "rejected" | "expired" | "withdrawn" }>` (`activities/approvals.ts:105`); `repos.approvals.expireBefore(db, businessId, before: Date): Promise<number>` (`repos/approvals.ts:450`); `repos.campaigns.endForChannel(db, businessId, channelId): Promise<Campaign[]>` (`repos/campaigns.ts:224`, expires `launch_campaign` approvals in bulk); `closeApprovalItem(db, businessId, approval)` (`packages/db/src/approvals.ts:403`); event `approval.resolved` whose `outcome` enum already holds `"expired"` and whose `agentId` is required (`packages/events/src/catalogue.ts:896`); `emitEvent(db, { businessId, type, actor, payload })` as `resolveApproval` uses it eleven lines above.
**Produces:** no new type. `repos.approvals.expireBefore` and `repos.campaigns.endForChannel` return the expired rows (`Approval[]` beside what they return today) so the caller can write the events; a helper `expiredApprovalEvents(deps, businessId, approvals: Approval[]): Promise<void>` in `activities/approvals.ts` that writes one `approval.resolved` per row with an `agentId` (`actor` and `resolvedBy`: `{ kind: "system", id: "expiry" }`, `note: null`, `latencyMs` from `createdAt`) and calls `closeApprovalItem` for each.

**Steps**
1. Test first: an approval with an agent, expired through `expireApproval`, leaves one `approval.resolved` event with `outcome: "expired"`; one without an agent leaves none and does not throw. verify: the test fails on main.
2. Write the event in `expireApproval`. verify: step 1 passes.
3. Test, then change `expireBefore` and `endForChannel` to return the rows; call `expiredApprovalEvents` at each caller (grep `expireBefore(` and `endForChannel(`: session end, vacation end, a channel taken off the board in `channel.ts:131`). verify: a channel taken off the board with one open `launch_campaign` approval leaves the event and an archived Inbox item.
4. No backfill of events for approvals that expired before this change: history is read from `approvals.outcome` (T10 does). Say so in docs/DECISIONS.md.

**Tests and evals:** the three cases above; `pnpm --filter @foundmill/orchestrator test`, `pnpm --filter @foundmill/db test`. No agent behavior changes, so no eval.
**Done when:** on a seeded business, requested minus resolved equals the number of approvals still open.

### [x] T2: The channel engine stops claiming launches on a real project        [M] [ships alone]

**Why:** GTM-02 (P0), GTM-36, §3.5 row "Can a campaign read live with nothing sent?"; e0: 79 `launch_campaign` requests. This is GTM-02 cut down to its honest core: the audit's launchers, new campaign statuses and renamed notes are WP-08. Here an engine simply does not run where its launch step has nothing to run.

**How it works today (read before changing):** on a real project an engine runs when `channelEngineMayRun(availability, kitMode)` is true: the channel is in offline tracking, or its reason is `acts` (an agent holds a live, connected tool: Email once platform mail is live, SEO and GEO with a repository). The `launch` step (`channel.ts:232-256`) calls no tool for any channel: it sets the campaign `live` and writes `campaign.launched`; only offline tracking also creates a founder task. `channelEngineReconcile` restarts every eligible engine each 15 minutes (`listEnginesToEnsure`, `activities/schedules.ts:322`), so stopping an engine inside a step is not enough: it has to stop being eligible.

**Files:** modify `packages/shared/src/channel-availability.ts` (+ `channel-availability.test.ts`), `apps/orchestrator/src/activities/channel.ts` (`channelUnavailableNote`, the `approve` case), `apps/api/src/services/channel-availability.ts` (the refusal at `:133`), `apps/web/components/inbox/request.ts`; tests `apps/orchestrator/src/__tests__/channel*.test.ts`, the schedules activity test, `apps/api/src/__tests__/` the distribution and sign-off tests; one eval beside the channel evals in `evals/src/`.

**Interfaces, consumes:** `channelEngineMayRun(availability: Pick<ChannelAvailability, "available" | "reason"> | null | undefined, kitMode: boolean | null | undefined): boolean` (`channel-availability.ts:119`), today `kitMode === true || channelTeamRuns(availability)`; reasons `"acts" | "no_publisher" | "not_connected" | "simulated_allowed" | "by_tap"`; its five callers: `listEnginesToEnsure` (`apps/orchestrator/src/activities/schedules.ts:332`), `channelEngineBlocked` (`activities/channel-availability.ts:34`, read by `channelStep` at `channel.ts:145` and by `plan.ts:388,408`), `runnableChannels` and the launch refusal (`apps/api/src/services/channel-availability.ts:76`, `:133`), `signoff.ts:455`, `session.ts:1117` (a read; do not edit that file); `channelUnavailableNote(label, availability)` (`channel.ts:43`); `launchApprovalReason` (`channel.ts:98`); `repos.campaigns.lastLaunched`.
**Produces:** the same function, narrower: `true` for offline tracking, for `reason === "simulated_allowed"` (sample projects, development, test) and for an unknown availability (`null`, as today); `false` for `acts`. Its doc comment says why: "the weekly engine's launch step sends nothing for any channel yet; a channel whose agents can act does so through tasks and sessions. WP-08 adds a launcher per channel and lists it here." No new event, table, status or export.

**Steps**
1. Shared tests first: `channelEngineMayRun({ available: true, reason: "acts" }, false)` is false; `simulated_allowed` true; offline tracking true whatever the reason; `by_tap` false; `null` true. verify: the `acts` case fails on main.
2. Change the function. Then read each of the five callers and fix only wording that is now wrong: `channelUnavailableNote` gains a branch for `acts` ("<Channel> has nothing the weekly engine can send yet; the team works on it through tasks. Engine stopping; nothing planned or launched."); the api refusal at `:133` uses `channelByTapRefusal` for every reason: for `acts` answer "The team works on <Channel> through tasks. There is no weekly campaign to launch yet." verify: orchestrator test: a real project (`APP_ENV: "production"`, `isDemo: false`) with Email available as `acts` gets no engine from `listEnginesToEnsure`, and a running engine's next step ends its campaigns and returns `stop: true`; with T1 its open approval leaves an `approval.resolved`. A sample project behaves exactly as on main.
3. Offline tracking asks once. Test first: an offline-tracking channel asks; the approval expires; the next week's `approve` step finds that the channel's latest `launch_campaign` approval is `expired` and nothing launched since, creates no new approval and returns `done("Waiting for you: the materials are on Creative.")`; when the founder approves the materials on Creative or puts the channel on the board again, the next week asks as before. Then, in the `draft` case, skip drafting while that state holds (it saves a model call a week per channel). verify: the test; no second `approval.requested` in four simulated weeks.
4. `live` by hand (GTM-36): `distribution.campaigns.setStatus` (`apps/api/src/routers/distribution.ts:169-196`) goes through the refusal at `:133`, which step 2 now makes true for `acts` channels. Add: on a real project, `live` is set only by the engine's `launch` step, so a hand-set `live` on an offline-tracking channel is refused too with `AppError("campaign_nothing_to_send", "Nothing is sent from here, so the campaign stays as it is. Submit the materials yourself, then mark it ended.", 409)`. verify: api test; a sample project can still set it.
5. Copy, same change (the only strings touched):

| File | Before | After | When |
| --- | --- | --- | --- |
| `channel.ts` `approval.requested.summary` (`:228`) | `<agent> wants to launch "<Channel> — week N, <date>"` | `<agent> has <channel> materials ready for you to check` | offline tracking on a real project |
| `apps/web/components/inbox/request.ts:171` | "<who> wants to launch the campaign …" | "<who> has materials ready for you to check and submit yourself" | the approval's channel is in offline tracking |

6. Eval `channel_engine.reports_prepared_not_launched`: given the engine's step notes for a real project in offline tracking, the Composer's note never says launched, live, sent or published. verify: `pnpm evals` lists it and it passes in mock; run it live once (say so in the PR if you cannot).

**Tests and evals:** as named. Playwright: the Campaigns spec asserts no "Live" chip on a real-project fixture.
**Done when:** Done-when 1 of the header holds in the test database, and the reconciler starts no engine for an `acts` channel.

### [x] T3: Never ask the founder to approve a call that cannot run            [M] [ships alone]

**Why:** GTM-09 (a), GTM-16 (P1, honesty: one SendGrid row with status `mock` on a real project). GTM-09 (b) is WP-05.

**Files:** modify `apps/gateway/src/pipeline.ts`, `apps/api/src/routers/integrations.ts`, `apps/web/components/settings/IntegrationsTab.tsx`; tests `apps/gateway/src/__tests__/pipeline*.test.ts` (the file that covers `integration_not_connected`), `apps/api/src/__tests__/integrations.test.ts`, `apps/web/e2e/` the integrations spec.

**Interfaces, consumes:** in `pipeline.ts`: `allow(...)` (`:736`) holds the connection checks at `:751-759` and the platform-mail check through `preparePlatformMail`; `ask(...)` (`:703`) is reached from `:351-361`; `modeFor(deps, connector.key)`; `GatewayError("integration_not_connected", …, 409)`; `NOT_RUN_ERRORS` (`:428`). In the api: `connectorMode(ctx.env, key)`, `integrations.connect` writes `status: connected.mode === "mock" ? "mock" : record.status` (`routers/integrations.ts:145`), `integrations.list` returns `catalogue[].live`.
**Produces:** `connectionRefusal(deps, loaded, mode): GatewayError | null` in `pipeline.ts`: the two existing `integration_not_connected` checks moved into one side-effect-free function, plus one new case: `mode === "mock"`, a row with `status === "mock"`, and `!mockResultsAllowed(deps.appEnv, loaded.business.isDemo)` is refused the same way (today only a missing row is). Called at the top of `allow` (same behavior) and immediately before `ask`. Api: error code `connector_not_live` (409, "<Connector> is not available yet. Nothing was connected."). `integrations.list` adds `available: boolean` per catalogue entry (`live || mockResultsAllowed(env.APP_ENV, business.isDemo)`).

**Steps**
1. Gateway tests first: assisted mode, real business, connector with no row, policy answers `ask` → 409 `integration_not_connected`, zero `approvals` rows, zero Inbox items; same with a `mock`-status row; a sample business still gets the mock's simulated answer. verify: fail on main.
2. Extract `connectionRefusal`, call it before `ask`. It must not load a credential or touch the vault (the vault check stays in `allow`). verify: step 1 and the whole gateway suite pass.
3. Platform mail: before `ask`, when `connector.key === PLATFORM_MAIL_KEY` and platform mail is not switched on for this deployment, refuse with the existing `platform-mail-off` reason instead of asking. Reuse the switch check `preparePlatformMail` already makes; do not run its rate-limit or suppression steps before the approval (they take tickets). verify: gateway platform-mail test "off → no approval row".
4. Api tests, then code: `integrations.connect` on a real business for a connector that is not live throws `connector_not_live` and writes nothing; `integrations.list` carries `available`. verify: api test.
5. `IntegrationsTab.tsx`: a connector with `available: false` shows the chip "Not available yet" and no Connect button; the tab title's "Test mode" stays for sample projects only. verify: Playwright.

**Tests and evals:** as named, plus `apps/orchestrator` session-contract test unchanged (proves no contract moved).
**Done when:** on a real project in assisted mode, an agent's call to an unconnected connector produces a refusal the agent can read and nothing in Needs you.

### T4: Remove fabricated results from real projects, and guard the generators   [M] [ships alone; apply step needs the founder]

**Why:** GTM-10 (19 `lead.created` events from `recordMockLeads` on real projects; `channel_metrics` rows with `source = 'estimate'` written until Nov 11), GTM-16 (the `mock` rows), GTM-02 (campaigns left `live`), §1.8 (approvals still open).

**Files:** create `apps/orchestrator/src/activities/mock-results-cleanup.ts`, `apps/orchestrator/src/__tests__/mock-results-cleanup.test.ts`; modify `apps/orchestrator/src/activities/channel.ts` (guards), `apps/orchestrator/src/workflows/schedules.ts` and `apps/orchestrator/src/schedules.ts` (one entry), `apps/orchestrator/src/env.ts`, `.env.example`, `docs/DEPLOY.md`.

**Interfaces, consumes:** `mockLead(seed)` (`channel.ts:67`, addresses end in `.example`); `recordMockLeads` (`channel.ts:322`); `repos.channels.upsertMetric(… source: "estimate")` (`channel.ts:276`); `repos.entities.upsertLead` stores `source: channelKey`; `entity_roles.ended_at`; `repos.audit.append(tx, businessId, { actorKind, action, target, details })`; `closeApprovalItem`; `repos.inbox.createItem`; `SCHEDULES` (`apps/orchestrator/src/schedules.ts:36`, `{ id, workflowType, spec, args, description, triggerOnRegister? }`); `HOUSE_BUSINESS_ID` (`packages/config/src/showcase.ts:13`).
**Produces:**
- env `MOCK_RESULTS_CLEANUP: "off" | "report" | "apply"` on the orchestrator, default `"report"`.
- activity `cleanMockResults(input: { mode: "report" | "apply" }): Promise<{ businesses: number; leads: number; metricRows: number; mockIntegrations: number; liveCampaigns: number; openLaunchApprovals: number }>`; workflow `mockResultsCleanup`; schedule `{ id: "mock-results-cleanup", workflowType: "mockResultsCleanup", spec: daily(30, 3), args: [{}], triggerOnRegister: true }`.
- audit action `data_fix.mock_results_removed` with the counts in `details` (no names, no addresses).
- `assertMockResultsAllowed(appEnv: string, isDemo: boolean, what: string): void` in `packages/shared/src/channel-availability.ts` (throws `AppError("mock_result_refused", …)`).

**What "apply" does, per business where `is_demo = false` (the house project included), in one transaction each:**
1. Leads: for entities whose `identifiers->>'email'` ends in `.example` and whose `source` is one of `CHANNEL_KEYS`: set `ended_at = now()` on their open `lead` roles and archive the entity the way the CRM's own archive does (read `repos.entities` for the function; do not hard-delete: the 19 `lead.created` events keep pointing at them).
2. `delete from channel_metrics where business_id = $1 and source = 'estimate'`, then `requestJourneyDailyRefresh`.
3. Integrations with `status = 'mock'`: archive through `repos.integrations` (the Disconnect path), never touching `credentials`.
4. Campaigns with `status = 'live'` on a channel that is not in offline tracking (`kit_mode = false`): `repos.campaigns.setStatus(… "ended")`.
5. Open approvals with `tool = 'launch_campaign'` on those channels: resolve `expired` through T1's helper (event and Inbox item closed).
6. If any count is above zero: one audit row, and one Inbox update from the Chief of Staff, once per business (idempotency key `mock_results_removed`): subject "We removed sample figures from your project"; body "Before Nov 11, 2026 your Customers and Channels screens could show leads and channel numbers that were generated, not real. We removed <n> generated contacts and <m> days of generated channel numbers. Nothing real was removed. From now on a number here means something happened."

**Steps**
1. Test first on a PGlite fixture with one demo and one real business holding each kind of row: `report` returns the counts and writes nothing; `apply` leaves the real business clean, the demo untouched, one audit row, one note; a second `apply` returns zeros and writes nothing. verify: fails, then passes.
2. Guards: call `assertMockResultsAllowed` as the first line of `recordMockLeads` and immediately before the `upsertMetric(… source: "estimate")` call; test that both throw for `("production", false)`. The call site already checks (see Corrections); this makes a second caller unable to skip it. verify: `channel.test.ts`.
3. Register the schedule; in `report` mode the workflow logs `{ platformReport: "mock_results", …counts }` and stops. verify: schedule fingerprint test updated.
4. **Needs the founder (Desktop session):** after deploy, read the logged counts; show them to the founder; on yes, set `MOCK_RESULTS_CLEANUP=apply` on the orchestrator; the next run applies; record counts and date in docs/DEPLOY.md §6; then set it back to `report`. Read-only check before and after, through the Supabase connector:
```sql
select (select count(*) from entities e join businesses b on b.id = e.business_id join entity_roles r on r.entity_id = e.id
         where not b.is_demo and r.role = 'lead' and r.ended_at is null and e.identifiers->>'email' like '%.example') as mock_leads,
       (select count(*) from channel_metrics m join businesses b on b.id = m.business_id where not b.is_demo and m.source = 'estimate') as estimate_rows,
       (select count(*) from integrations i join businesses b on b.id = i.business_id where not b.is_demo and i.status = 'mock') as mock_integrations,
       (select count(*) from campaigns c join businesses b on b.id = c.business_id join channels ch on ch.id = c.channel_id where not b.is_demo and c.status = 'live' and not ch.kit_mode) as live_campaigns,
       (select count(*) from approvals a join businesses b on b.id = a.business_id where not b.is_demo and a.tool = 'launch_campaign' and a.resolved_at is null and a.requested_at < now() - interval '9 days') as stale_launch_approvals;
```
5. Follow-up PR one week after the nightly numbers show zero: remove the schedule entry and the env var; keep the guards and their tests.

**Tests and evals:** as named; RLS is not involved (service role, existing tables).
**Done when:** the query in step 4 returns five zeros on production, and T10's `fabricated_left` is 0 every night after.

### [x] T5: The build path says what is true without a repository             [S] [ships alone]

**Why:** A4-03 (P0, the copy half), A4-10 (P1). The site workspace that makes the promises true is WP-07.

**Files:** modify `packages/db/src/product-stage.ts`, `packages/modules/src/development/founder-views.tsx`, `packages/shared/src/first-week.ts`, `packages/agents/src/foundations.ts`, `packages/db/src/repos/product-signoffs.ts`, `apps/api/src/services/signoff.ts`, `apps/orchestrator/src/activities/session.ts` (`codeTaskNote` only), `scripts/plain-language.mjs` fixtures; tests beside each (`first-week.test.ts`, `signoff.test.ts`, the agents prompt test, `apps/orchestrator` `session` prompt test, `apps/web/e2e/team-development.spec.ts`).

**Interfaces, consumes:** `loadProductStage(db, businessId): Promise<{ stage; facts: ProductStageFacts; signoffs }>` (`packages/db/src/product-stage.ts:37`); `repos.integrations.codeRepository(db, businessId): Promise<CodeRepository | null>` (`repos/integrations.ts:116`); `firstWeekTimeline(f: FirstWeekFacts)`; `buildingStartsBody(build: BuildStart)` (`signoff.ts:289`); `codeTaskNote(branch: string): string` (`session.ts:2021`).
**Produces:** `type BuildDestination = "none" | "github"` in `packages/shared/src/types.ts` (WP-07 adds `"site"`); `ProductStageFacts.destination: BuildDestination`, filled in `loadProductStage` (`"github"` when `codeRepository` returns a repository with pushing on, else `"none"`); `FirstWeekFacts.destination?: BuildDestination`; `codeTaskNote(branch: string, destination: BuildDestination): string`.

| # | File | Before | After | When |
| --- | --- | --- | --- | --- |
| 1 | `founder-views.tsx:271` | "The address of your live product appears here after its first release. Every change waits for your go-ahead before it goes live." | "Nothing is live from here yet. Your public page is the first thing people can open: Product › Public page." (the last words link there) | no `deploy.succeeded` was ever recorded for the business |
| 2 | `founder-views.tsx:275` footer | "Each change gets its own preview to try before it goes live; it opens here once the quality checks pass." | "Previews are not available yet." | same |
| 3 | `founder-views.tsx:182` footer | "Nothing goes live until you say so: when a change passes the quality checks, you get one decision in your Inbox, whatever the business mode." | "The team's code is saved in your project. It has nowhere to go live yet: connect a GitHub repository in Settings › Integrations to have it pushed there for you to approve." | `destination === "none"` |
| 4 | `first-week.ts:102`, `:128` | "the first changes going live" / "You approved your first goal and the first changes going live." | "the first pieces of work" / "You approved your first goal and the first pieces of work." | `destination === "none"` |
| 5 | `foundations.ts:791`, `product-signoffs.ts:45` | "… the Planner turns the Now items into tasks and the engineers pick them up in the next cycle." | "… the Planner turns the Now items into tasks and the team starts on them in its next round of work." | always (also removes "cycle") |
| 6 | `signoff.ts:292-293` | "The first build cycle is under way." / "Press Continue to start the first build cycle" | "The first round of work is under way." / "Press Continue to start the first round of work"; then, when `destination === "none"`, one more sentence: "The code is kept in your project; nothing goes live from it until a repository is connected." | as stated |
| 7 | `session.ts:2024` | "When your session ends the platform saves your changes and pushes them to your branch, runs the task's acceptance command in a test copy, brings the branch up to date with the live product, runs the repository's CI and opens the pull request; the founder decides what goes live." | "When your session ends the platform saves your changes and runs the task's acceptance command in a test copy. This project has no repository connected, so nothing is pushed and no pull request opens: never say that it was." | `destination === "none"`; the existing sentence stays for `"github"` |

**Steps**
1. Tests first, one per row (string equality under the condition, the old string under the other). verify: fail.
2. Add `destination` to the facts and pass it down (`business.get` already carries the stage facts to the modules; add the field to that output). verify: typecheck across `packages/modules`, `apps/web`.
3. Change the strings. Run `node scripts/banned-terms.mjs`, `node scripts/us-english.mjs`, `node scripts/plain-language.mjs --gate`. verify: all green.
4. Row 7 is a pure function change plus its one caller (`session.ts:1530`, `launch` knows the repository). verify: the orchestrator prompt test; nothing else in `session.ts` changes (`git diff --stat` shows under 10 lines there).

**Tests and evals:** as named; extend the existing engineer eval's rubric with "does not claim a pull request when none can open" only if an eval file for code summaries already exists; do not add a new harness here (WP-05 AR-15 builds it).
**Done when:** a real project with no repository shows none of the seven "Before" strings.

### [x] T6: The first day says the page comes first; smaller untrue lines      [S] [ships alone]

**Why:** FR-07 (the copy half; the panel order on Today is WP-04), FR-06 outside the landing page (the kept card), A2-18, A2-11 (the Cash tile's zero), FR-16 row 2 (stale order in the welcome note; the voice rewrite is WP-04).

**Files:** modify `packages/shared/src/first-week.ts` (+ test), `apps/api/src/services/commit.ts`, `apps/web/components/new/commit/CommitScreen.tsx`, `packages/shared/src/empty-why.ts`, `apps/web/components/new/card/CardKeptView.tsx`, `apps/web/components/shell/BusinessShell.tsx`, `apps/web/components/tours/definitions.ts`, `apps/web/components/landing/CycleDeck.tsx` (it repeats the callout line), `packages/widgets/src/widgets/status-strip.tsx`; their tests (`business-shell.test.ts`, `tours/__tests__/definitions.test.ts`, `packages/widgets/src/__tests__/today-tiles.test.ts`, `empty-why.test.ts`, the commit test).

**Produces:** `FIRST_DAY_PROMISE` in `packages/shared/src/first-week.ts`, the one place the first day is told:
```ts
export const FIRST_DAY_PROMISE = {
  steps: ["Your team is hired", "Your public page is drafted first: check it and put it live", "Then your plan arrives as two notes to sign off", "Nothing is spent on finding customers until you say so"],
  sentence: "Your team is drafting your public page first, then your plan. You check the page and put it live; two notes then ask you to sign off the plan.",
} as const;
```
WP-04 changes this constant when the two notes become one; nothing else needs to move.

| # | File | Before | After | When |
| --- | --- | --- | --- | --- |
| 1 | `commit.ts` `welcomeNote` subject | "Your team is drafting the product foundations" | "Your team is drafting your page and your plan" | always |
| 2 | `commit.ts` `welcomeNote` third paragraph | "<who> is drafting the vision, the specification and the roadmap from <from>; you will get two notes asking you to sign off each. Building starts when both are approved." | "<who> is drafting your public page first, from <from>: check it and put it live. The vision, the specification and the roadmap follow as two notes to sign off. Building starts when both are approved." | always |
| 3 | `CommitScreen.tsx:126` toast | "Your team is drafting the vision, specification and roadmap; two notes will ask you to sign them off." | `FIRST_DAY_PROMISE.sentence` | always |
| 4 | `CommitScreen.tsx:238-243` `WHAT_HAPPENS_NEXT` | the four lines quoted in FR-07 | `FIRST_DAY_PROMISE.steps` | always |
| 5 | `CommitScreen.tsx:521` lede | "… Taking charge hires the team, which starts by drafting your vision, specification and roadmap." | "… Taking charge hires the team, which starts by drafting your public page, then your plan." | always |
| 6 | `empty-why.ts:56` | "Nothing needs you yet. Your first notes, the specification and the roadmap to sign off, arrive once the team finishes drafting them, usually on day 1." | "Nothing needs you yet. Your page arrives first, usually within a few minutes, then the plan to sign off." | `facts.firstDays` |
| 7 | `CardKeptView.tsx:18` | "It is saved in your deck. Your team starts from your words and checks every number against real sources." | "It is saved in your deck. Your team starts from your words." | until WP-00 S6 is recorded done in docs/DEPLOY.md; then WP-05 restores the claim with its eval |
| 8 | `BusinessShell.tsx:288`, `CycleDeck.tsx:54` | "Press it when you have answered what needs you." | "One press and your team works until nothing is left to do. Anything that needs you shows in Needs you." | always |
| 9 | `tours/definitions.ts:39` | "This runs the team; what they need from you lands in the Inbox." | "This runs the team; what they need from you lands in Needs you." | always |
| 10 | `status-strip.tsx:143-145` `cashTile` | value 0 in the project's currency, caption "Connect a bank in Settings" | value "Not known yet" (`NOT_KNOWN_YET.value`, already in the file), caption "No bank connected" | `finance.cash.accounts === 0` |

**Steps:** 1. Tests pin every "After" (and that rows 3 and 4 read the constant, not a copy). verify: fail. 2. Change the strings; run the three word scripts. verify: green. 3. `apps/web/e2e/first-days.spec.ts`: the toast and the empty text on a new business. verify: passes locally in the cloud session.
**Done when:** the six places that tell the first day agree, by test.

### [x] T7: The Follow form is offered only when a confirmation can be sent    [S] [ships alone]

**Why:** FR-12, GTM-03 (b) and (c). Part (a) is WP-00 (S1, S2); part (d), re-offering confirmation to old pending records, is not needed: `contact_consents` has 0 rows (e0).

**Files:** modify `apps/api/src/services/pages.ts`, `apps/api/src/routers/page.ts`, `apps/api/src/app.ts` (health), `apps/web/components/` the Public page screen (`PublicPageScreen`), tests `apps/api/src/__tests__/pages.test.ts`, `apps/web/e2e/public-page.spec.ts`.

**Interfaces, consumes:** `platformMailLive(env): boolean` (`packages/shared/src/env.ts:325`); `publicPageBySlug` returns `followForm` from `page.content` (`pages.ts:375-389`); `followPage` refuses when `!target.followForm` (`pages.ts:574`); `repos.followers.target`.
**Produces:** `publicPageBySlug(...).followForm = page.content.followForm && platformMailLive(ctx.env)`; the same condition where `followPage` reads its target; `page.view` output gains `followAvailable: boolean`; api `/health` gains `platformMail: "live" | "off"` (T12 checks it).

**Steps:** 1. Api tests first: mail off → the public page has `followForm: false` and `followPage` answers the existing "not accepting" refusal; mail live → unchanged. verify: fail, then pass. 2. Console: when `followAvailable` is false, the switch is disabled with the line "Following opens when email is switched on for Foundmill. Your page works without it." verify: Playwright at 390 and 1440 px. 3. Health field. verify: `apps/api` health test.
**Done when:** no visitor can be told "Check your email to confirm." on a deployment that cannot send it.

### [x] T8: One vocabulary in the shell                                        [M] [ships alone]

**Why:** A2-09. CLAUDE.md: "project" until the first sale and where the stage is not known; "team"; Needs you. Only strings a first-timer meets with Builder view off; Builder view keeps the engine's words.

**Files:** modify `packages/shared/src/founder-words.ts` (+ test); `packages/dugout/src/components/shell/ProcessingStrip.tsx`, `ContinueButton.tsx`, `BusinessSwitcher.tsx`; `packages/dugout/src/components/today/NeedsYouList.tsx`; `packages/dugout/src/components/firstrun/FirstWeekChecklist.tsx`; `apps/web/components/shell/BusinessShell.tsx`; `apps/web/components/inbox/InboxScreen.tsx`, `ReadingPane.tsx`; `apps/web/components/settings/AutopilotSection.tsx`, `PreferencesTab.tsx`; `apps/web/components/email/EmailAnswer.tsx`; `apps/web/lib/search.ts`, `lib/access.ts`, `lib/page-titles.ts`; `packages/shared/src/autopilot.ts`; create `apps/web/lib/__tests__/shell-words.test.ts`.

**Produces:** in `founder-words.ts`:
```ts
/** The founder's word for a cycle. Builder view keeps the engine's word. */
export function roundWords(builder: boolean): { one: string; a: string; idle: string } // builder: { "cycle", "a cycle", "No cycle running" }; else { "round of work", "a round of work", "The team is not working right now" }
/** "project" until the first sale and where the stage is not known (CLAUDE.md, 2026-11-11). */
export function ventureNoun(hadFirstSale?: boolean | null): "project" | "business"
```
`ventureNoun` is called with no argument everywhere in this task (no real project has a sale, and no field carries it yet); WP-08 passes the fact when the first payment exists. Do not add a column or a query for it here.

| File:line | Before | After (Builder view off) |
| --- | --- | --- |
| `ProcessingStrip.tsx:43` | "No cycle running" | "The team is not working right now" |
| `InboxScreen.tsx:46` | "Your team works in cycles: rounds of work whose notes land here. Press Continue to start one." | "Your team works in rounds, and their notes land here. Press Continue to start one." |
| `InboxScreen.tsx:55` | "Ask the team for one quick note (does not start a cycle)" | "Ask the team for one quick note (does not start a round of work)" |
| `BusinessShell.tsx:221` | "The orchestrator is not reachable right now: a press writes one note; no agent works." | "The team cannot start right now. Pressing Continue will only write a short note." |
| `BusinessShell.tsx:245` | "Last cycle cost $0.52 · Estimate" | "The last round of work cost $0.52 · Estimate" |
| `BusinessShell.tsx:261-262` | "No new cycle starts. …" / "No cycle is running." | "No new round of work starts. …" / "The team is not working right now." |
| `BusinessShell.tsx:574` | "… The next cycle picks up the paused tasks." | "… The next round of work picks up the paused tasks." |
| `ReadingPane.tsx:349` | " A cycle started." | " The team started working." |
| `ContinueButton.tsx:131`, `AutopilotSection.tsx:34` | "… one cycle after another …" | "… one round of work after another …" |
| `ContinueButton.tsx:285` aria-label | "Pause the running cycle" | "Pause the team" |
| `FirstWeekChecklist.tsx:39` | "Run a cycle" | "Let the team work" |
| `NeedsYouList.tsx:56` | "See all in the Inbox" | "See all" |
| `NeedsYouList.tsx:117` | "Holds Continue" | "The team is waiting on this" |
| `EmailAnswer.tsx:95` | "Open the Inbox" | "Open Needs you" |
| `autopilot.ts:254` | "… Open the Inbox's Needs you tab." | "… Open Needs you." |
| `lib/page-titles.ts:17`, `InboxScreen.tsx:228` | title "Inbox" | "Needs you" when the tab is `respond`, else "Inbox" |
| `BusinessSwitcher.tsx:142,146,158,207,253,258`; `lib/search.ts:137-140` | "Switch business", "Create a new business", "Manage businesses" | "Switch project", "Start a new project", "Your projects" |
| `lib/access.ts:67,73` | "This is an example business: look around, then start your own." / "Sample business" | "This is an example project: look around, then start your own." / "Sample project" |
| `PreferencesTab.tsx:220` (and `CommitScreen.tsx:788`) | "Anthropomorphic agents" | "Give agents names and faces" |

Left alone, with the reason: Settings tab "Business" and Team › "Staff" (tab slugs and labels tied to routes; WP-10's sidebar task renames them with the tabs); "Game mode" on `ModeChip` (THESIS 2.5, WP-12's liveMode decision); `JourneyScreen.tsx:94`, `CallLobby.tsx:118` (not first-week surfaces).

**Steps:** 1. `founder-words.test.ts` for the two helpers; `shell-words.test.ts` renders each constant or component with Builder view off and asserts none matches `/\bcycles?\b|orchestrator|\bInbox\b(?! tab)|Switch business|Sample business/`. verify: fails listing every row. 2. Change the strings; where a string is built from a number or a flag, take the word from `roundWords(builder)`. verify: the test passes; Storybook stories for the three dugout components still render (update their fixtures). 3. Run the word scripts and update `docs/DESIGN.md` §10 with the four-row table "Engine word → founder word" (cycle → round of work; orchestrator → the team; Inbox as a place → Needs you; business → project until the first sale). verify: `node scripts/banned-terms.mjs` green. 4. Playwright specs that assert the old strings (`today.spec.ts`, `inbox.spec.ts`, `shell.spec.ts`: grep the old text under `apps/web/e2e`). verify: green.
**Done when:** Done-when 5.

### T9: Four funnel facts in the account event store                      [M] [ships alone]

**Why:** FR-10 step 1, A8-08 fix 1. Recorded decision: "Account events: a private, person-level event store (founder, 2026-11-12)" and "The account relay is turned off" (same day): writes still land in `account_events`; nothing here starts a poller.

**What is deliberately not an event:** sign-up (`auth.users.created_at`), commit (`idea.committed`, `businesses.committed_at`), page live (`page.published`), the idea box card itself (no account yet: `idea_drafts`, counted nightly by T10 because the sweep deletes drafts after 7 days). The audits propose seven names between them; these four are the ones no table states with a time and a way in.

| Type | Payload (closed object, no free text, no ids) | Written by | Idempotency key |
| --- | --- | --- | --- |
| `account.admitted` | `{ how: "list" \| "invitation" \| "open" \| "existing" }` | `PERSON_CREATED_STEPS` new step `admission_fact` (`apps/api/src/services/person-created.ts`): reads `repos.admissions` for the row's `how`, or `"list"` when there is none (the allowlist path records nothing; see Corrections) | `account.admitted` |
| `profile.created` | `{ client: "web" \| "app" }` | the same list, step `profile_fact`; `client` from the `x-foundmill-client` header (`apps/api/src/app.ts:100`, `clientOf`) | `profile.created` |
| `idea.kept` | `{ from: "idea_box" }` | `ideaBox.claim` in `apps/api/src/routers/idea-box.ts`, when `claimIdeaBoxDraft` returns `again: false` | `idea.kept:<ideaId>` (an id may be part of a key; it never goes in the payload) |
| `idea.drafted` | `{ source: "set" \| "written" \| "idea_box"; cards: number (1 to 12) }` | `apps/api/src/routers/idea.ts`: where a draft or a written idea first creates `ideas` rows for the person (grep `repos.ideas.create`); once per account | `idea.drafted:first` |

All four: `consumers: []` (there is no metrics consumer; T10 reads the table), `actor: { kind: "user", id: userId }`.

**Files:** modify `packages/shared/src/constants.ts` (`EVENT_TYPES`, `ACCOUNT_EVENT_TYPES` at `:532`), `packages/events/src/catalogue.ts`, `packages/events/src/testing/fixtures.ts`, `apps/api/src/services/person-created.ts`, `apps/api/src/routers/idea-box.ts`, `apps/api/src/routers/idea.ts`, `docs/ARCHITECTURE.md` §5 "Account events"; create migration `packages/db/migrations/<next>_funnel_account_events.sql` (+ journal entry) that is one `create or replace function fm_account_event_types()` with the whole list (copy the body from the latest of `0085`, `0088`, `0097` and append the four); tests `packages/db/src/__tests__/rls/account-events.test.ts` (list parity, existing), `apps/api/src/__tests__/person-created.test.ts` (the step list assertion at `:67` gains the two names), `idea-box` and `idea` router tests.

**Interfaces, consumes:** `declareAccountEvent(type, schema, { doc, consumers, recordIds? })`; `writeAccountEvent(tx, { userId, type, actor, payload, idempotencyKey })` (`packages/events/src/outbox/account-writer.ts:157`); `PersonCreatedStep { name; run(deps, userId, input) }`; the rules in `packages/events/CLAUDE.md` (four steps for an account event; the two-person rule).

**Steps:** 1. Use the `new-event` skill for each type. Catalogue and fixtures first; `pnpm --filter @foundmill/events test` fails until the declarations exist. verify: green. 2. Migration; `pnpm test:rls` compares the SQL list with `ACCOUNT_EVENT_TYPES`. verify: green. 3. The two steps in `PERSON_CREATED_STEPS` (each in its own transaction and try/catch, as the file's rules say; a failure never fails the save). verify: `person-created.test.ts`. 4. The two router writes, each inside the transaction that makes the change; a repeat writes nothing. verify: router tests assert exactly one `account_events` row after two calls. 5. The remaining `consumers: ["metrics"]` annotations in the catalogue (77 types, no consumer): leave them, and add one line to `packages/events/CLAUDE.md` saying "metrics" names T10's nightly reader, not a `consume()` group. verify: none needed.
**Done when:** a new account's four facts are rows in `account_events`, and T10's funnel reads them.

### T10: Nightly numbers: funnel, north star, retention, agent work        [M] [ships alone, after T9]

**Why:** FR-10 steps 2 to 4, A8-08 fixes 2 and 3, A8-06 (demo leak), AR-13 (count the parked tasks), OUTLINE principle 1 ("we can see it in the numbers").

**Files:** create `packages/db/src/repos/metrics.ts`, `packages/db/src/metrics-report.ts`, `packages/db/src/schema/` one table (in `governance.ts` beside `account_events`), migration `<next>_platform_metric_days.sql`, `packages/db/src/__tests__/metrics.test.ts`, `packages/db/src/__tests__/demo-isolation.test.ts`, `apps/orchestrator/src/activities/platform-metrics.ts`; modify `packages/db/package.json` (`"report:metrics": "tsx src/metrics-report.ts"`), `packages/db/src/index.ts`, `packages/shared/src/morning-brief.ts` and `founder-return.ts` (+ tests), `apps/orchestrator/src/schedules.ts`, `apps/orchestrator/src/workflows/schedules.ts`, `packages/db/src/__tests__/rls/tables.ts`.

**Produces**
- Table `platform_metric_days`: `day date primary key`, `facts jsonb not null`, `created_at timestamptz not null default now()`. Not business-scoped (it holds counts across projects, no ids, no names). RLS on, no policy, `revoke all … from anon, authenticated` as 0088 does for `attributions`; listed in `rls/tables.ts` as service-only; test: a signed-in role selects zero rows. Also `create index events_type_occurred_idx on events (type, occurred_at desc)` (A8-08 fix 3; drop it from WP-11's 0110 if this lands first, and tell that package).
- `repos.metrics.snapshot(db, asOf: Date): Promise<MetricFacts>` and `repos.metrics.record(db, day, facts)`; CLI `pnpm --filter @foundmill/db report:metrics [-- --as-of YYYY-MM-DD] [--json] [--history 14] [--print-sql]` shaped like `retention-report.ts`. Write each query as a raw `sql` template in one exported list (`METRIC_QUERIES: { name; text }[]`) so `--print-sql` prints exactly what runs and a Desktop session can run it read-only through the Supabase connector (`report:cost` in T11 does the same).
- Shared: `isRealOutcome(e: { type; actor; payload }): boolean` exported from `morning-brief.ts` (the per-type rules `realOutcomes()` already applies, so the brief and the SQL test share one definition); `founderActivation` keeps its fields and gains `pagePublishedWithin24h: boolean` and `minutesToPage: number | null` (FR-10 step 4).
- Schedule `{ id: "platform-metrics", workflowType: "platformMetrics", spec: daily(15, 3), args: [{}], description: "Nightly: funnel, north star, retention and agent-work counts for real projects" }`; activity `recordPlatformMetrics()` = snapshot for yesterday (UTC) + `record`, logging `{ platformReport: "metrics", day }`.

**`MetricFacts` (every count is over projects with `is_demo = false`; "outside" figures also exclude `HOUSE_BUSINESS_ID`; windows are the UTC day, 7 and 14 days back from `asOf`):**
- `accounts`: `total`, `new_14d` (`auth.users`), `signed_in_14d` (`last_sign_in_at`), `profiles`.
- `gate`: `waitlist`, `invitations`, `admissions` by `how`.
- `funnel` (per day and 14-day totals): `idea_cards` (`idea_drafts.created_at`), `cards_kept` (`claimed_at`), `accounts_new`, `admitted` (`account.admitted` by `how`), `profiles_created` (by `client`), `idea_drafted`, `committed`, `page_published` (first `page.published` per project by a user), `first_other_outcome` (first real outcome that is not the page); medians in minutes: profile → commit, commit → page.
- `projects`: `total`, `demo`, `real`, `real_outside` (without the house), `committed`, `with_page_draft`, `with_page_live`.
- `north_star`: for each of the last 12 UTC weeks, `projects_with_real_outcome`, `solo`, `together`, `also_visited`: the SQL in `audits/a8-data-api-security.md` A8-08, verbatim, with one change: a `page.published` counts only in the week of the project's first one (see Decisions for the founder, 1).
- `retention`: `visit_users_14d`, `visit_days_14d` (`founder_visit_days`); `presenceRepo.retentionReport` totals for the last 14 days; per real project the number of cycles and the days between first and last cycle, summarized as `ran_only_first_day`.
- `agent_work`: `sessions` by `outcome` (ended sessions), `blocked_share`; `events` counts for `task.blocked`, `task.completed`, `approval.requested` (by tool), `approval.resolved` (by outcome); `approvals_open`, `approvals_open_over_9d`; `tool_missing_stopped` (`audit_log.action = 'cycle.tool_missing_stopped'`); `notes_day_one` (max and median Inbox items in a project's first 24 hours).
- `honesty`: `fabricated_left` = the five counts of T4's query; `simulated_outcomes_excluded`.

**Numbers it must reproduce on production with `--as-of 2026-11-15`** (from `audits/e0-production-evidence.md`; a difference is a bug in the query or a change since, and the PR says which): accounts 19, new in 14 days 1, signed in during 14 days 2, profiles 12; waitlist 0, invitations 0, admissions 0, idea drafts 1; projects 15 = 2 demo + 13 real (12 outside the house), 13 committed, 0 pages; visit users in 14 days 2; sessions 319 = 81 done, 215 blocked, 23 failed (blocked share 67%); `task.blocked` 299, `task.completed` 80; `approval.requested` 127 (`launch_campaign` 79, `request_human_action` 36, `merge_pr` 12), `approval.resolved` 14; north star 0 for every week (no page was ever published).

**Steps**
1. `metrics.test.ts` on a PGlite fixture: one demo, the house, two real projects (one with a user-published page, one with only a simulated `mail.sent` and a Simulate-panel payment). Assert every block; `north_star` counts exactly one project; `isRealOutcome` and the SQL agree on each fixture event. verify: fails, then passes.
2. `demo-isolation.test.ts` (A8-06): every function in `repos.metrics` and `presenceRepo.retentionReport` returns the same result with and without the demo project's rows. verify: passes.
3. Table, migration, RLS listing. verify: `pnpm test:rls`.
4. CLI and schedule. verify: `pnpm --filter @foundmill/db report:metrics -- --json` against the local seed prints valid JSON; the schedule fingerprint test passes.
5. **Desktop session, once after deploy:** run the snapshot's SQL for Nov 15 through the Supabase connector (read-only; the CLI's `--print-sql` flag prints each statement so nothing is retyped) and compare with the list above; put the comparison in docs/DEPLOY.md §6. verify: every figure matches or is explained.
6. `docs/ARCHITECTURE.md`: a short "Platform numbers" section naming the table, the schedule and the definitions.

**Tests and evals:** as named. No agent behavior.
**Done when:** Done-when 6; `select day from platform_metric_days order by day desc limit 3` shows the last three days.

### T11: The cost report                                                   [S] [ships alone]

**Why:** AR-14, A4-15 ("measure first"), FR-11's "invisible spend" (reported as a gap, not fixed here), a7 Appendix B. WP-09 sets prices and allowances from this output.

**Files:** create `packages/db/src/repos/cost-report.ts`, `packages/db/src/cost-report.ts`, `packages/db/src/__tests__/cost-report.test.ts`; modify `packages/db/package.json` (`"report:cost": "tsx src/cost-report.ts"`), `packages/db/src/index.ts`.

**Interfaces, consumes:** `usage_ledger` (`kind`, `currency`, `billed_to`, `cost_minor`, `cost_micro_minor`, `details->>'route' | 'model' | 'source'`, `session_id`, `agent_id`, `occurred_at`), `agent_sessions` (`model_key`, `outcome`, `tokens_in`, `tokens_out`, `cost_minor`, `ended_at`), `training_runs`, `credit_balances`. Exact dollars: `coalesce(cost_micro_minor, cost_minor * 1000000) / 1e8`.
**Produces:** `repos.costReport.run(db, { from?: Date; to?: Date }): Promise<CostReport>` with blocks `byRoute`, `sessionsByModelAndOutcome`, `firstDayPerProject` (total, foundations, sessions, notes and replies; median and p90 across projects), `projectWeeks` (p50, p90, max; who paid), `byAgentFamily`, `blockedSessions` (count and dollars by reason), `trainingRuns`, `creditsThisMonth`, and `notMeasured: string[]`. These are queries 1, 2, 3, 4, 4b, 5, 6, 8 and 9 of `audits/a7-models-gateway-economics.md` Appendix B, used as written; query 7 waits for WP-09 (A7-07). CLI `pnpm --filter @foundmill/db report:cost [-- --from --to] [--json]`; every dollar figure is printed with "(measured)" and every figure derived from fewer than 5 projects with "(small sample)".

**Steps:** 1. Fixture test: a ledger with a demo project, micro and pre-0039 rows, one blocked session with a `task.blocked` event keyed `task.blocked:<sessionId>` (confirm the payload's reason key in `packages/events` before relying on query 6, as Appendix B warns). Assert totals to the cent and that the demo adds nothing. verify: fails, then passes. 2. `notMeasured` always lists: "Model calls before a project exists (ideas, compare, logo) are not in the ledger (A7-02)", "The gateway's reader and web search are not booked (A7-03)". verify: test. 3. **Desktop session, once:** run against production (`--print-sql`, read-only) and paste the output into the WP-09 file's "measured" section and docs/DEPLOY.md §6. Expected from e0: about $119 total; opus sessions 142 at $58.25, sonnet 176 at $24.67; one training run at $12.78. verify: totals agree within a dollar or the PR explains.
**Done when:** Done-when 7.

### T12: One production record, and a script that checks it               [M] [ships alone]

**Why:** a11 §9 ("one current record of what is configured in production"), §5; WP-00 "Done when"; e0 "Live configuration". docs/DEPLOY.md §6 is dated Oct 8 to Oct 20.

**Files:** modify `docs/DEPLOY.md` (§6 replaced; the old table moves under a heading "History: staging status, Oct 2026" at the end, unchanged); create `scripts/check-production.mjs`, `scripts/check-production.test.mjs`.

**The table (new §6, between the markers `<!-- production-record:start -->` and `<!-- production-record:end -->`).** Columns: `Area | Expected | State on <date> | Check`. `Check` is a check id the script runs, or `manual: <who>` for what cannot be seen from outside. Seed it from WP-00 §1; rows and their check ids:

| Area | Expected (today's honest value; a work package changes it in the PR that changes the fact) | Check |
| --- | --- | --- |
| api health | `env: "staging"`, `modes.integrations: "mock"`, `modes.models: "live"`, db, redis, temporal healthy | `api-health` |
| Platform mail | `platformMail: "live"` (after T7) | `api-platform-mail` |
| ingest webhooks | `refusedMockWebhooks` contains `sendgrid` until WP-00 S2; then `webhooks` contains it | `ingest-webhooks` |
| Landing indexing | `noindex` and `/robots.txt` 404 until WP-03; then 200 and indexable | `landing-robots` |
| Sign-up | closed to a list; the sign-in page loads and offers Google | `signin-page` |
| Public page route | `/p/<unknown>` answers 404, not 500 | `public-404` |
| Web deployment | `https://foundmill.com` 200, `www` redirects to apex | `web-up` |
| Stream, composer | `/health` 200 on each public host listed in §3 | `service-health` |
| `LIVE_CONNECTORS`, `MODEL_MODE` per service | values recorded by WP-00 S3 | `manual: founder reads, Desktop records` |
| Turnstile, idea cookie, Google sign-in, Stripe, push, E2B template | as WP-00 §1 | `manual: Desktop (variable names)` |
| Wait for CI, watch paths | as WP-00 S4 | `manual: Desktop` |
| Supabase: Data API off, Confirm email on | `/rest/v1/` answers 503 | `manual: Desktop` until a public project URL is added to the script's inputs |
| Fabricated rows on real projects | five zeros (T4) | `manual: Desktop, T4 query` |
| Nightly numbers | a `platform_metric_days` row for yesterday | `manual: Desktop` |
| Hosting plan, spend limits, DMARC | WP-00 S13 to S15 | `manual: founder` |

**`scripts/check-production.mjs`:** Node 20, no dependencies, same style as `scripts/decisions-index.mjs`. Reads the table from docs/DEPLOY.md, runs each check id with `fetch` (10 s timeout, GET or HEAD only, no credentials, user agent `foundmill-production-check`), compares with the `Expected` cell through a small per-check function, prints one line per row (`ok`, `differs: expected … got …`, `manual`), exits 1 if any checked row differs. Flags: `--base https://foundmill.com --api https://api.foundmill.com --ingest https://ingest.foundmill.com` (defaults as shown), `--json`, `--only <check id>`. It never writes to docs/DEPLOY.md: a difference is fixed by a person or a session changing the record or the product. WP-01 calls it from the nightly workflow; a failure opens no issue by itself (WP-01 decides the alert).

**Steps:** 1. `check-production.test.mjs` (`node --test`): parses a fixture table; with a fake `fetch`, a matching response is `ok`, a changed `env` is `differs` with exit code 1, a `manual` row is never fetched, an unknown check id fails the run (so a typo in the record cannot pass silently), a timeout is `differs: no answer`. verify: fails, then passes. 2. Write the script and the new §6; fill "State on Nov 15, 2026" from WP-00 §1 and e0, word for word where they are quoted. verify: `node scripts/check-production.mjs` from the cloud session against production (public GETs only) prints `ok` for the rows whose expected value is today's state; paste the output into the PR. 3. Add the test to CI beside the other script tests (one line; if WP-01 has rewritten `ci.yml`, add it to its fast lane instead). verify: CI green. 4. `docs/holistic-plan/WP-00-setup-and-switches.md`: every step's "record in docs/DEPLOY.md" now means "change the row in §6"; add that sentence to its header. verify: none.
**Done when:** Done-when 8.

### T13: Say once when the team cannot do something                        [S] [needs the founder: decision 2]

**Owner:** this change is built once, as WP-05 T18 (the same founder decision, D1 there). This package builds nothing for it; the text below is kept as the reasoning.

**Why:** AR-13. Today `stopToollessTasks` (`apps/orchestrator/src/activities/cycle.ts:287`) archives the task and tells nobody, by the founder's own ruling of Nov 7, 2026 (the comment at `:279-286`: "never into the founder's Inbox"). T10 already counts these (`tool_missing_stopped`). The audit's further step, one clause in the round's note, changes that ruling, so it waits for the founder.

**If the founder says yes.** Files: `apps/orchestrator/src/activities/cycle.ts`, the Composer request builder that receives the cycle's facts, `evals/src/` composer evals. `stopToollessTasks` already returns the stopped ids; pass their founder titles (max 3, 120 characters each) to the round's summary facts as `parked: string[]`; the Composer's instruction gains: "If `parked` is not empty, end the note with one sentence: 'One thing the team cannot do yet: <title>. It is parked.' Never ask the founder to do it." No to-do, no decision, no Needs you item. Tests: `dispatch.test.ts` (facts carry the titles); eval `composer.parked_clause` (the clause appears once, with no request). verify: both pass.
**Done when:** a round that parks a task says so in one sentence, and Needs you is unchanged.

---

## Corrections to the audits

1. `audits/a5-go-to-market.md` GTM-02 step 4 names one silent expiry (`expireApproval`). The code has three: `repos.approvals.expireBefore` (`packages/db/src/repos/approvals.ts:450`) and `repos.campaigns.endForChannel` (`repos/campaigns.ts:224-237`) also set `outcome: "expired"` with no event. T1 covers all three.
2. GTM-10 reads as if mock leads can still be written on a real project. They cannot: the `measure` step returns before `recordMockLeads` when `!mockResultsAllowed(...)` (`channel.ts:263-266`). What remains is old rows and a guard that lives only at the call site (T4).
3. GTM-16 cites `integrations.ts:132-145`; the file is `apps/api/src/routers/integrations.ts` (there is no `services/integrations.ts`).
4. `audits/a2-console-design.md` A2-11 cites `status-strip.tsx:138-148` as if under `apps/web`; `cashTile` is in `packages/widgets/src/widgets/status-strip.tsx`, tested by `packages/widgets/src/__tests__/today-tiles.test.ts`.
5. `audits/a1-first-run.md` FR-10 would write `account.admitted` "in `admitOrWait` where it records". An address on the allowlist, the only way in today, returns before any record (`access.ts:207-211`), so that event would never fire in production. T9 writes it once, at profile creation, with `how: "list"` when no admission row exists.
6. FR-10 and A8-08 propose computing the first funnel step from `idea_drafts`. The sweep deletes drafts after 7 days (90 when held) (`apps/api/src/services/idea-box.ts`, `startIdeaBoxSweep`), so a later query undercounts. T10 snapshots daily.
7. `audits/a4-building-product.md` A4-15 asks for a report "from `model_calls`". No such table exists; direct model calls are `usage_ledger` rows with `details->>'route'` (a7 Appendix B has it right).
8. `audits/e0-production-evidence.md` "13 real" projects include Foundmill's own (`HOUSE_BUSINESS_ID` is not `is_demo`). T10 prints both 13 and 12.
9. FR-06's "real sources" line also sits in `apps/web/components/landing/idea-box/IdeaBox.tsx:53`; that one is the landing page and belongs to WP-03. T6 changes only `CardKeptView.tsx:18`. The audit's third file, `CardKeepView.tsx`, does not contain the phrase.
10. OUTLINE.md cites `reports/e0-production-evidence.md`; the file is `audits/e0-production-evidence.md`.

## Decisions for the founder

1. **Does republishing a page count as that week's real outcome?** `page.published` is written on every publish of changes. Built default (T10): only a project's first publish counts; an edit does not. Say if an edited, republished page should count.
2. **AR-13: one sentence in the round's note when the team parks something it has no tool for?** Your Nov 7 ruling keeps it out of the Inbox entirely. Default: unchanged (T13 not built); the count is in the nightly numbers either way.
3. **T4 apply.** Removing the generated leads, channel numbers and `mock` connections from real projects is permanent for the channel numbers. You see the counts first; nothing is removed until you say yes. Each affected founder gets one note (text in T4).
4. **Attested outcomes** (a founder saying "I posted it" or "I recorded a sale", GTM-05 and GTM-13) are not counted by T10. WP-08 brings the question with its flows; no answer is needed for this package.

## Risks

- **T2 ends engines that are running today** (Email on any project once platform mail is live, SEO and GEO on the one project with a repository). That is the intent; their drafts stay on Creative. It uses the stop path the engine already takes for a channel taken off the board, so no workflow code changes; if step 3 needs a new branch in `channelEngine.ts`, put it behind `patched("wp02-ask-once")` and run the replay test.
- **T3 could refuse a call that today is approved and then runs** if `connectionRefusal` is stricter than `allow`. It must be the same code moved, plus the one `mock`-row case; the gateway suite is the proof.
- **T4 touches production data.** Mitigations: `report` is the default, the demo and every archive path are tested, hard deletes are limited to rows a seed function generated, and the founder sees counts first.
- **T8 breaks tests that assert old strings** across `apps/web/e2e` and Storybook. Budget for it; do not weaken an assertion, change its text.
- **T9 adds two inline writes to the profile save.** They follow the file's rule (own transaction, own try/catch), so a failure cannot fail the save; the cost is two inserts once per account.
- **T10's figures drift from e0 with time.** The comparison is against `--as-of 2026-11-15`; counts of rows deleted since (idea drafts) can only be lower, and the PR says so.
- **The metrics table is one more thing in the database.** It holds one small row a day; if a warehouse or PostHog arrives later it is the export source, not a second system.
- **`check-production.mjs` reads public endpoints only**, so it cannot see a wrong variable that changes nothing visible; those rows stay `manual` and are only as fresh as the last Desktop session.

## Starting prompt

```
You are executing WP-02 (Truth and measurement) for Foundmill. Read, in this order: CLAUDE.md; docs/holistic-plan/README.md; docs/holistic-plan/WP-02-truth-and-measurement.md in full; the package CLAUDE.md of each package the task touches; and, for the task you take, the audit findings it cites under docs/holistic-plan/audits/. Apply the karpathy-guidelines skill on every change and use plan-change before writing code (it checks other branches and gives the next free migration number).

Take the tasks in the order T1, T2, T3, T4, then T5 to T8, then T9 to T12. One task is one pull request on a branch named claude/wp02-t<n>-<short-name>; never push to main and never merge. For each task: write the named tests first and watch them fail, make the change, run typecheck, lint, the package's tests, the three word scripts (banned-terms, us-english, plain-language --gate) and the Playwright spec for any screen touched, then run verify-done and report each check with its result and what it does not cover. Add one line to docs/PROGRESS.md, record judgment calls in docs/DECISIONS.md, and tick the task in the work package file in the same pull request.

Do not build T13: it waits for the founder's answer to decision 2. In T4, build and ship report mode only; the apply step is done later by a Desktop session on the founder's yes. Where a task says "Desktop session", write the exact statement or command into the pull request description and stop there: you cannot reach production. If a file path, function name or line in the work package no longer matches the code, find it by the name it quotes, follow the code, and say so in the pull request. If a task looks larger than its finding needs, build the smaller version and say what you left out.

Start with T1 and tell me your assumptions before you write code.
```
