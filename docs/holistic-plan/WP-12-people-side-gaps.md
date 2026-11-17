# WP-12: People side: gaps only

**Goal:** the unowned pieces of the people plan that the door and the growth loop need now, each one passing the solo guard: a project with one person looks and works exactly as before.

**Why:** `audits/a9-people-network-mobile.md` A9-P0-3, A9-P1-2, A9-P1-3, A9-P1-4, A9-P1-6, A9-P1-7, A9-P2-1 and §6 gap 4; `audits/a11-roadmap-status.md` §2 (no network branch is in flight) and §6 items 4 and 5; `audits/e0-production-evidence.md` (19 accounts; `connections`, `messages`, `invitations`, `waitlist_entries` and `project_pages` at 0 rows; 13 real projects older than the page feature); `audits/s6-market-last30days.md` implications 7 and 10 (a page a stranger can visit, shared by the founder's own tap, nothing public without their press).

**Done when (each is a check, not an opinion):**
1. This query returns 0 (13 today), and no page was published by this package: `select count(*) from businesses b where b.committed_at is not null and b.archived_at is null and not b.is_demo and b.agents_stopped_at is null and not exists (select 1 from project_pages p where p.business_id = b.id);`
2. `apps/web/e2e/invitations.spec.ts`: a new account accepts at 390 px and lands on `/b/<id>/today`, never on `/onboarding`.
3. A new account that arrived with `?via=p.<slug>` (from a page, its story or a card) has an `attributions` row, and the credited founder's Today shows one line about it. An accepted invitation names both people on its `invitations` row and credits the inviter in `attributions` when the project's page is live.
4. `report.create` stores a report of a profile, a person and a message; `/operator/reports` shows it to an operator account and answers "not found" to everyone else.
5. docs/DECISIONS.md holds the founder's answer on the people layer, and docs/DEPLOY.md holds the steps and tests for turning it on.
6. `apps/api/src/__tests__/mobile-contract.test.ts` passes on main: every procedure the mobile skill names exists on the api.
7. `apps/web/e2e/solo-guard.spec.ts` and `apps/api/src/__tests__/solo-guard.test.ts` pass after every task: no empty People panel, no meter, no nudge to add someone.

**Scope, in:** the page catch-up; the invited account's path; the private "someone arrived" line; reports and an operator queue; limits out of process memory; the people layer flag as a decision; the mobile branch; the app prompt on public pages and the universal-link files; the fate of `apps/social` as a decision.
**Scope, out:** the sign-up gate, the waitlist (including recording `fm_via` at the waitlist join, A9-P2-2), the invite-only page, the refusal `invitation_cannot_admit` (A9-P2-3), the small-screen wall with its exits, and the store-links value with its first readers (WP-03 T9): WP-03. The profile form at `/onboarding`, publishing a page from a phone, re-engagement email content: WP-04. Sharing from Today and the `launch_campaign` loop: WP-08. Everything in "Not now" below.

**Assumptions (say so in the pull request if one is wrong):** for an invitation, the `invitations` row (`invited_by_user_id`, `accepted_by_user_id`) is the record of who brought whom, and the inviter already sees it happen in Settings › People and by the `invitation_accepted` email; reporting needs a signed-in account with a confirmed address; the first operator is the founder. No task adds agent behavior, so no task adds an eval; T1 reuses the `projectPage` route and its existing checks.

**Depends on:** nothing to start. T8 needs WP-03 T9 (the store-links value and `GetTheApp`). T3 shows something only once WP-03 lets strangers in and founders publish the pages T1 drafts. T1 should merge before WP-04's quiet-project email ships, so that email has a true next step to name.
**Collides with:**
- `claude/blissful-fermat-q03yq1` (1 commit, no PR): `packages/dugout/src/components/public/*`, `apps/web/components/shell/BrandFrame.tsx`, `packages/shared/src/project-page.ts`, `apps/web/e2e/public-page.spec.ts`, `.github/workflows/ci.yml`. No task here edits those files; T4 names the one case where it might (a slot in `PersonPage`) and waits.
- `claude/zealous-rubin-8q52gr` (the mobile session, 11 commits): T7 merges it. Until then nothing here edits `docs/mobile/**` (DECISIONS Nov 12, 2026 "Working beside the other sessions; three answers relayed from the founder").
- Door files (`apps/web/lib/auth/redirects.ts`, `apps/api/src/services/access.ts`, `apps/web/app/login/**`): WP-03's. No task here edits them, with one conditional line in T8.
- The two "one place" files, `apps/api/src/services/person-created.ts` and `apps/web/lib/auth/start-destination.ts`: not edited here.
- Reports elsewhere: WP-03 admits from the waitlist by SQL and builds no operator screen; WP-07 writes `site.reported` audit rows and expects this package's queue to take them later (T4 leaves room, builds nothing for it).
**Who owned this before (DECISIONS Nov 12, 2026, same entry; `audits/a9-people-network-mobile.md` §4.1):** the network session owned NETWORK's waves, invitations, attribution and message requests; its branches `claude/bold-johnson-hjxopx` (#93), `claude/waitlist-invitations` (#120) and `claude/founder-notices` (#124) still exist on the remote, are fully merged and idle. The roadmap session owned small screens and the person profile; its branch is even with main. The retention session owned the one email sender; merged. The mobile session owns `docs/mobile`; its branch is the only one with unmerged work. Nothing in this package has a live owner.
**Setup it needs:** WP-00 S1 and S2 (platform mail proven, so T1's note can reach a founder by email); S17 (store listing ids for T8, founder); `OPERATOR_USER_IDS` on the api (T4, Desktop session, after D3).

**Migrations:** T4 adds one. Take the next free number when the branch is cut (0108 at `04a0a509`); renumber on rebase, with a journal `when` later than the last applied (DECISIONS Nov 12, 2026 "Merge order and migration numbers").

**Order:** T0 first. Then T1 and T2 (the door and the loop). T7 any time. T4 then T5. T3 after D1. T6 and T9 are decisions with small follow-ups. T8 last, after WP-03 T9.

## Tasks

### T0: The standing solo-guard test            [S] [ships alone, first]
- [x] merged

Why: A9 §6 gap 4; NETWORK §10 ("Each feature ships with a test of the right-hand column"); THESIS_REVIEW §13 phase 3 guard. Today the guard is tested only on the person page and `/home`.
Files: create `packages/shared/src/solo-guard.ts`, `packages/shared/src/solo-guard.test.ts`, `apps/api/src/__tests__/solo-guard.test.ts`, `apps/web/e2e/solo-guard.spec.ts`.
Interfaces: consumes `today.get`, `today.visit`, `inbox.list`, `FIRST_WEEK_WORDS` (`packages/shared/src/first-week.ts`), `projectPageReadyNote()` (`packages/agents/src/project-page.ts`), e2e `takeChargeToToday(page, name)` (`apps/web/e2e/helpers.ts`). Produces `SOLO_GUARD_PHRASES: readonly RegExp[]` and `soloGuardViolations(text: string): string[]`.
Steps:
1. Write `solo-guard.test.ts`: `soloGuardViolations` flags "Invite someone", "find a cofounder", "add a collaborator", "find a partner", "team up", "0 people", "No people yet"; passes "the team" (agents), "Settings › People" and "invitation accepted". verify: fails (no module).
2. Implement the list and the function. Phrases, case-insensitive: `invite (someone|a |your )`, `co-?founder`, `collaborator`, `find (a )?partner`, `team up`, `\b0 people\b`, `no people yet`, `add (a person|someone)`. verify: the unit test passes.
3. `apps/api/src/__tests__/solo-guard.test.ts`: for a freshly committed one-person project in mock mode, join every string in `today.get`, `today.visit` and every subject and body from `inbox.list`; expect `soloGuardViolations` to be empty. Run it twice: `LIVE_MODE` unset and `LIVE_MODE=1`. verify: passes on main as it is (if it fails, that is a finding: fix the copy in the same PR and say so).
4. `apps/web/e2e/solo-guard.spec.ts`: `takeChargeToToday`, then read the visible text of Today, Needs you and the first-week checklist at 1280 px and at 390 px: no violation; the only control whose name matches `/invite/i` in the whole project is in Settings › People; Team › People lists exactly one row. verify: `pnpm test:e2e solo-guard` passes. The e2e stack runs with `LIVE_MODE=1` (`apps/web/playwright.config.ts:51`), so this covers the open layer; step 3 covers the closed one.
Tests: the three files above.
Solo guard: this task is the guard. Every later task adds its own case to these files.
Done when: both suites run in CI and pass.

### T1: Draft a public page for every project committed before the feature            [S] [ships alone; merges after D6]
- [x] merged

Why: A9-P0-3; e0 (`project_pages` 0 rows, 13 real projects). Chosen over "a prompt on Today" because Today already shows its quiet page line for these projects (see Corrections 1) and 11 of 13 founders have not opened Today since day one: the missing piece is the draft and its note, not a prompt.
Files: modify `packages/db/src/repos/pages.ts`, `apps/orchestrator/src/activities/foundations.ts`, `apps/orchestrator/src/workflows/schedules.ts`, `apps/orchestrator/src/workflows/index.ts`, `apps/orchestrator/src/schedules.ts`, `docs/ARCHITECTURE.md` §10 (the schedule list). Create `apps/orchestrator/src/__tests__/page-catch-up.test.ts`.
Interfaces:
- Consumes `runProjectPageStep(ctx: ProjectPageStepContext, store: ProjectPageStore)` (`packages/agents/src/foundations-steps.ts`), `projectPageStore(db, businessId, authorAgentId)` and `repos.foundations.inputs(db, businessId)` as `draftProjectPage` uses them (`apps/orchestrator/src/activities/foundations.ts:197-215`), `PROJECT_PAGE_USAGE_KIND`, `ScheduleResult`, `SCHEDULES`, `daily(minute, hour)`.
- Do not call the `draftProjectPage` activity: it answers `skipped` unless the foundations row is `drafting` for that attempt.
- Produces `repos.pages.listMissingTeamDraft(db: Executor, opts: { committedBefore: Date; limit: number }): Promise<string[]>` (committed, not archived, not a sample, team not stopped, no `project_pages` row, oldest first); activity `draftMissingProjectPages(input: { businessIds?: string[]; limit?: number; at?: string }): Promise<ScheduleResult>`; workflow `pageCatchUp(input?: { businessIds?: string[]; limit?: number }): Promise<ScheduleResult>`; schedule `{ id: "page-catch-up", workflowType: "pageCatchUp", spec: daily(30, 3), args: [{ limit: 25 }] }`.
Steps:
1. Write `page-catch-up.test.ts` (pattern: `foundations.test.ts`, "draftProjectPage (package 1.2)"). Cases: a committed real project with no page gets one `project_pages` row with `published` null and `draft.showFounders` false, one open note whose `decision.key` is `project_page.ready`, and one `inbox.item_created` outbox row; a second run writes nothing; a project whose founder already saved a draft is untouched; a sample, an archived, an uncommitted and a stopped project are skipped; a project committed under one hour ago is skipped (its own first session is drafting); a failed model call still writes the starter draft (`source: "starter"`); `limit` is respected. verify: fails (activity missing).
2. Add `listMissingTeamDraft` with a repo test beside the existing pages repo tests. verify: passes.
3. Add the activity: for each id, `repos.foundations.inputs`, then `runProjectPageStep` with `projectPageStore`; heartbeat after each project; one failure is logged with the business id and the loop continues. `touched` is the number written. The one-hour floor is a constant in this file. verify: step 1 passes.
4. Add the workflow (use the `acts` proxy for batches) and the schedule entry; extend `schedules.test.ts`'s job list. verify: `pnpm --filter @foundmill/orchestrator test page-catch-up schedules`.
5. After deploy (Desktop session, read-only): run the query in Done-when 1 the next morning and record the count in docs/PROGRESS.md.
Tests: above, plus the solo-guard case: `soloGuardViolations(note.subject + note.bodyMd)` is empty and the draft never names founders.
Solo guard: the note and the draft say nothing about people; no page is published; nothing is drafted twice.
Done when: Done-when 1 returns 0 in production and `select count(*) from project_pages where published is not null` is unchanged by the job.
Cost (Estimate): one `projectPage` call per project, about one cent each, charged to the project's own credits; a project with none gets the starter draft.

### T2: An invited person lands in the project            [S] [ships alone]
- [x] merged

Why: A9-P1-2. After Accept, a new account is redirected to `/onboarding` (`apps/web/app/b/[bid]/layout.tsx:67`), which is desktop-only and ends at `/new`.
Files: modify `apps/api/src/services/invitations.ts`, `apps/web/components/people/InvitationScreen.tsx`, `apps/web/e2e/invitations.spec.ts`. Create `apps/web/components/people/__tests__/InvitationScreen.name.test.tsx`; add cases to `apps/api/src/__tests__/invitations-admission.test.ts`.
Interfaces:
- Consumes `acceptInvitation(ctx, accepter, token, options)` returning `AcceptedInvitation { businessId, already }`; `founder.profile.update` (creates the profile on the first save; `displayName` is the only field it needs; it calls `onPersonCreated`, whose first step is `recordInvitationAttribution`); `routes.today(businessId)`; the design system's `InvitationCard` (`actions` slot) and `Button`.
- Produces `AcceptedInvitation.hasProfile: boolean` (read with `repos.founders.get` after the transaction; also on the `already` answer), and the words `INVITATION_NAME_LABEL = "What should we call you?"` and `INVITATION_NAME_HINT = "The people on this project see this name."`.
- Why a field on the answer: `founder.profile.get` is a `protectedProcedure`, so the card cannot ask it before the accept has admitted the account.
Steps:
1. Api test first: `invitation.accept` answers `hasProfile: false` for a new account and `true` for one with a profile; after `founder.profile.update({ displayName })` the account has a profile, no `adult_unconfirmed` is raised (the accept recorded the confirmation), `attributions` credits the inviter when the project's page is published, and holds no row when it is not (the `invitations` row is then the record). verify: fails on `hasProfile`.
2. Add the field. verify: passes.
3. Unit test `InvitationScreen.name.test.tsx`: accept with `hasProfile: true` pushes to Today at once; with `false` the card shows one field labeled `INVITATION_NAME_LABEL` and a Continue button, an empty name is refused in place, Continue calls `founder.profile.update` with the trimmed name and then pushes to Today; a person with a profile never sees the field. verify: fails.
4. Implement in `InvitationScreen.tsx` only (no change to `BrandFrame` or `InvitationCard`). verify: passes.
5. Tighten `invitations.spec.ts` (the case "a second account signs in, accepts, and is taken into the project", line 152; the detour is at lines 166-170): set the viewport to 390 x 844, type a name, expect `/b/<bid>/today`, and delete the branch that accepts `/onboarding`. verify: `pnpm test:e2e invitations`.
Tests: above. Send the new field to T7's shape list.
Solo guard: the name field exists only on `/i/<token>` after an accept; `solo-guard.spec.ts` unchanged and passing; the inviting project's Today shows nothing new until someone has joined.
Done when: Done-when 2.

### T3: "Someone arrived through your page", privately            [S] [ships alone; needs D1]
- [x] merged

Why: A9-P1-4 (the F6 line), A9 §1.4, A11 §6 item 4. A sign-up through a page is recorded (`attributions`, `referral.arrived`) and nobody can see it. NETWORK F20 puts people lines in "Since you were last here"; F6's running total on the Network page waits with the credit (Not now).
Decision it waits on (D1): docs/PROGRESS.md:1937, "A person can read their own account events ... For the founder to confirm". The line tells the credited founder that someone arrived and, by the visit window, roughly when. Build it behind `FLAGS.referralLine` (false); the founder's yes is a one-line change.
Files: modify `packages/config/src/flags.ts`, `packages/db/src/repos/attributions.ts`, `apps/api/src/services/today.ts`, `apps/web/components/today/today-view.ts`; tests `apps/api/src/__tests__/since-last-visit.test.ts`, `apps/web/components/today/__tests__/since-last-visit.test.ts`, `packages/db/src/__tests__/rls/attributions.test.ts`.
Interfaces: consumes `SinceLastVisit`, `sinceVisit(ctx, presence, now)`, `sinceLastVisitLines(view, businessId, money)`, the `attributions` columns `referrer_user_id`, `source_business_id`, `created_at`. Produces `FLAGS.referralLine`, `repos.attributions.countArrivedSince(db: Executor, q: { referrerUserId: string; businessId: string; since: Date }): Promise<number>` (service connection), `SinceLastVisit.arrived: number`, and the line `{ id: "arrived", text }` with text "1 person arrived through your page." or "3 people arrived through your page."
Steps:
1. Api test: with the flag off `arrived` is 0 whatever the rows; with it on (inject the flag as `ownPlanFunds` does with its options) it counts only rows where the reader is `referrer_user_id`, the project is `source_business_id` and `created_at` is after the previous visit; a second founder of the same project reads 0; a member of another project reads 0; a view with only `arrived > 0` is not null. verify: fails.
2. Add the repo function and the field; include `arrived` in the `nothing` test. verify: passes.
3. Web test and line: singular and plural words; no line at 0; no link, no name, no count anywhere public (NETWORK §14 answer 4). verify: passes.
Tests: above.
Solo guard: a project nobody arrived through shows no line and never "0 people" (case added to `solo-guard.test.ts`).
Done when: Done-when 3 with the flag on in a test stack; the flag's state in production follows D1.

### T4: Report a person, a profile or a message; an operator queue            [M] [ships alone; needs D3 for the switch]
- [ ] merged

Why: A9-P1-6; NETWORK F21 and THESIS_REVIEW 4.7 (nothing reaches strangers before it). Only a community post can be reported today (`live.posts.report`), and no role above a project's owner exists. A recorded decision also waits on it: DECISIONS Nov 11, 2026 "The thesis, and the founder's first five answers", answer 4, opens sign-up only once "reporting of people, profiles and messages" exists. WP-03 asks the founder (its Decision 4) whether that condition moves to opening the people layer; either way this task is what meets it.
Files: create `packages/db/migrations/<next>_reports.sql`, `packages/db/src/schema/reports.ts`, `packages/db/src/repos/reports.ts`, `packages/shared/src/reports.ts`, `apps/api/src/routers/report.ts`, `apps/api/src/routers/operator.ts`, `apps/web/app/operator/reports/page.tsx`, `apps/web/components/operator/ReportsQueue.tsx`, `packages/db/src/__tests__/rls/reports.test.ts`, `apps/api/src/__tests__/reports.test.ts`, `apps/web/e2e/reports.spec.ts`. Modify `packages/db/src/schema/index.ts`, `packages/db/src/repos.ts`, `packages/db/src/__tests__/rls/tables.ts`, `apps/api/src/trpc.ts`, `apps/api/src/router.ts`, `packages/shared/src/env.ts`, `.env.example`, `apps/web/components/live/community-dialogs.tsx` (`ReportDialog`), `apps/web/components/live/ProfileScreen.tsx`, `apps/web/components/live/MessagesPanel.tsx`, `apps/web/app/u/[handle]/page.tsx`, `docs/DEPLOY.md`.
Interfaces:
- Table `reports`: `id`, `reporter_user_id` (not null, cascade), `target_kind` in `person | profile | message`, `target_user_id` (set null), `target_message_id` references `messages` (set null), `reason`, `note` (1,000 characters at most), `resolved_at`, `resolved_by`, `resolution`, timestamps; one open report per reporter and target (unique index). It is person-level, so it follows `attributions` (0088): row level security on, every client role revoked, service role only.
- `packages/shared/src/reports.ts`: `REPORT_TARGET_KINDS`, `REPORT_REASONS = ["spam", "harassment", "scam", "asks_for_money", "personal_data", "other"]`, `REPORT_RESOLUTIONS = ["no_action", "warned", "removed"]`, `REPORT_RESPONSE_TARGET_HOURS = 48`.
- `report.create`: a `signedInProcedure` (a refused stranger can still report), not behind `liveGate` (stepping back never needs the layer). Input: `{ target: { kind: "profile"; handle } | { kind: "person"; userId } | { kind: "message"; messageId }, reason, note? }`. Answer: always `{ reported: true }`: an unknown handle, the reporter's own account and a message in a thread the reporter is not in store nothing and read the same. Limit: 10 a day per reporter through `takeOrThrow(ctx.limits, "Report", …)`.
- `operatorProcedure` in `trpc.ts`: `protectedProcedure` plus `ctx.userId` in the env list `OPERATOR_USER_IDS` (comma-separated account ids; unset means nobody); everyone else gets `NOT_FOUND`. Never a database role.
- `operator.reports.list` returns open reports oldest first with `dueAt` (created plus the target), the reporter's and the target's display names, and a reported message's body read at view time; `operator.reports.resolve({ reportId, resolution })`.
- `target_kind` can grow: WP-07's site reports can join this queue later as a `site` kind. Not built here.
- No event: a report is not a fact of any project, and an account event may not name another account (the two-person rule, DECISIONS "Account events").
Steps:
1. `rls/reports.test.ts` (use the `rls-test` skill): the reporter, the person reported and a third account cannot select, insert, update or delete through the client roles; the service role can; a deleted reporter takes their reports with them. Add `reports` to `rls/tables.ts` as a service table. verify: fails (no table).
2. Write the migration, schema and repo (`file`, `listOpen`, `resolve`). verify: step 1 and `migrations.test.ts` pass.
3. `reports.test.ts`: the three kinds each store one row; a duplicate stores none; self, unknown and not-in-thread store none and answer the same; the 11th in a day is a 429; it works with `LIVE_MODE` unset; `operator.reports.list` is `NOT_FOUND` for a founder and lists for an operator; `resolve` empties the queue. verify: fails, then implement the two routers and the gate, then passes.
4. Web: give `ReportDialog` a `target` prop (a post, as today, or a `report.create` target) and add "Report" to a message's menu in `MessagesPanel`, to `ProfileScreen`, and to `/u/[handle]` for a signed-in visitor who is not the owner (render it from the route under `PersonPage`; if that needs a slot in `PersonPage`, add it only after `claude/blissful-fermat-q03yq1` has merged). `/operator/reports`: desktop only, the design system's `Panel` and `DataTable`, columns When, Due by, Kind, Reason, Who, About, Note, and one "Reviewed" control per row. The note and a message body are shown as plain text and are never sent to a model. verify: `reports.spec.ts` (a second account reports `/u/<handle>`; the operator sees and resolves it; a non-operator gets not found).
5. Run the `security-reviewer` agent on the diff; fix what it finds in the same PR. Write "Reports: who checks and how often" in docs/DEPLOY.md with `OPERATOR_USER_IDS`. verify: the review's findings are listed in the pull request, each fixed or answered.
6. If WP-02 T10's nightly numbers (`recordPlatformMetrics`) are on main, add `reports_open` and `reports_overdue` to its snapshot from `repos.reports.counts(db, now)`; if not, name the two numbers in the pull request for WP-02. verify: the snapshot test shows both.
Tests: above.
Solo guard: a person building on their own sees no report count, no People panel and no new line anywhere; their public page looks the same to them; a visitor's Report control says nothing about people (case in `solo-guard.spec.ts`: the owner's view of their own `/u/<handle>` has no Report control).
Done when: Done-when 4. Not covered: nobody is told when a report arrives; an operator has to look (see T6's checklist and Risks).

### T5: People limits out of process memory            [S] [ships alone, after T4]
- [ ] merged

Why: A9-P1-6, A11 4.7. `takeLive` (`apps/api/src/services/live.ts:58-64`) counts in one process. For new communities, community invitations and post reports it is the only limit; for requests, messages and posts a shared-store limit already runs beside it with different numbers.
Files: modify `packages/config/src/limits.ts`, `apps/api/src/services/live-limits.ts`, `apps/api/src/services/live.ts`, `apps/api/src/routers/live.ts` (the seven `takeLive` calls at lines 171, 250, 318, 359, 399, 445, 459), `apps/api/src/__tests__/live-limits.test.ts`, `apps/api/src/__tests__/live-social.test.ts`.
Interfaces: consumes `takeOrThrow(store, what, entries)`, `RateLimitStore`, `ctx.limits`, `takeConnectionRequest`, `takeMessage`, `takePost`. Produces `takeCommunity(limits, userId)`, `takeCommunityInvite(limits, userId)`, `takePostReport(limits, userId)`, and `LIMITS.liveCommunitiesPerUserPerDay = 3`, `liveInvitesPerUserPerDay = 50`, `liveReportsPerUserPerHour = 30`, `liveMessagesPerUserPerHour = 200` (added to `takeMessage`). Set `livePostsPerUserPerHour` to 40 (the in-process value that binds today). Requests keep the shared 20 an hour, which is already the stricter one. Then delete `takeLive`, `liveLimiter`, the in-process `LIVE_LIMITS` and `WHAT`.
Steps:
1. Test first: two api contexts sharing one `MemoryRateLimitStore` (two replicas): the fourth community of a day is refused on the second context; the same for the 51st invitation and the 31st report; the 201st message in an hour is refused. verify: fails.
2. Implement, replace the seven calls, remove what is now unused. verify: `pnpm --filter @foundmill/api test live-limits live-social live`; `grep -rn "takeLive\|liveLimiter" apps/api/src` prints nothing.
Tests: above.
Solo guard: no screen changes; T0's suites pass unchanged.
Done when: no people-side limit is counted in process memory, and none is looser than before.

### T6: The people layer flag, as a decision with its steps            [S] [needs the founder: D2]
- [x] merged

Why: A9-P1-3, THESIS_REVIEW 2.5, A11 "just below the line". `FLAGS.liveMode` is false and production leaves `LIVE_MODE` unset; docs/DEPLOY.md:72 still describes leaderboards.
What `LIVE_MODE=1` changes, from the code: every `live.*` procedure answers (`liveGate`, `apps/api/src/routers/live.ts:25`); committing as Live and "Go live" are allowed (`routers/idea.ts:361`, `routers/business.ts:342`) and `business.get` stops reading a stored `live` as Personal; `founder.profile.get` answers `features.liveMode: true`, so `/home` links to `/network` instead of the "Opening soon" chip and Commit offers "Personal or live".
What stays untrue after the switch: search finds only owners of Live, committed projects by name (`live.people.search` over the old `public_profiles` view), and production has never had the layer open, so its projects were committed as Personal and the room is empty (not measured: `select game_mode, count(*) from businesses group by 1;`); a person with no Live project cannot ask to connect (`live.connections.request` is `sectionWrite("live")`); a profile published at `/u/<handle>` is not found; `/home` would say "Join someone's project" with nothing to join.
Recommendation: keep it closed. Open it when all of these hold:
1. T4 and T5 are on main, an operator is named (D3), and a new report sends the operator an email (a new safety kind on the one sender; build it then).
2. One identity: `live.people.search`, `live.people.profile` and `repos.social.lookupPeople` read `public_person_profiles`; `VisibilityPanel` is replaced by the state of `/public-profile` (THESIS 2.5; not built here).
3. `/home`'s find card says only what can be done.
4. At least 25 people have a public profile (`select count(*) from public_person_profiles;`), so a search returns someone.
5. The `security-reviewer` agent has read `live.*` as open to every account.
Files: modify `docs/DEPLOY.md` (fix line 72; add "Opening the people layer" with the list above and the tests below), `docs/DECISIONS.md` (the founder's answer, dated). Extend `apps/api/src/__tests__/solo-guard.test.ts`.
Interfaces: consumes `FLAGS.liveMode`, `liveModeOpen(env, flag)` (`packages/config/src/flags.ts`), `assertLiveOpen`, `liveGate`, `LIVE_CLOSED_MESSAGE` (`apps/api/src/trpc.ts`), `features.liveMode` on `founder.profile.get`. Produces no code beyond one test.
Steps:
1. Add the closed-state case to `solo-guard.test.ts` (below). verify: passes on main.
2. Write the DEPLOY section and correct line 72. verify: `grep -n "leaderboards" docs/DEPLOY.md` prints nothing.
3. Put D2 to the founder with this task's text; record the answer in docs/DECISIONS.md. verify: the entry names the conditions and who flips the switch.
Tests to run before the switch: `live-gate.test.ts`, `live.test.ts`, `live-social.test.ts`, `live-limits.test.ts`, `reports.test.ts`, `adult-signup.test.ts`; e2e `live.spec.ts`, `person-home.spec.ts`, `solo-guard.spec.ts`, `reports.spec.ts`; and a new closed-state check in `solo-guard.test.ts`: with `LIVE_MODE` unset, `founder.profile.get` answers `features.liveMode: false`, `live.summary` is refused with `LIVE_CLOSED_MESSAGE`, and `today.get` for a one-person project reads the same as with the layer open.
Solo guard: with the layer open, a one-person Personal project's sidebar, Today and Needs you are the same as with it closed (asserted in `solo-guard.spec.ts`, which runs on the open stack).
Done when: Done-when 5.

### T7: Bring the mobile session's branch onto main and keep the pack true            [M] [ships alone; needs D5]
- [x] merged

Why: A9-P1-7; THESIS_REVIEW 5.5 and 5.6. `docs/mobile/skills/foundmill-backend/SKILL.md` on main names none of `invitation.*`, `founder.adult.*`, `adult_unconfirmed`, `on_waitlist`, `publicPage.storyBySlug`, `publicPerson.byHandle`, `share.opened`; the branch adds `today.sinceLastVisit` and `founder.presence.ping` and a wording fix main lacks.
Files: merge of `origin/claude/zealous-rubin-8q52gr` (9 files: `docs/mobile/{BACKEND_CHANGES,PROMPTS}.md`, `docs/mobile/skills/foundmill-backend/SKILL.md`, `packages/shared/src/autopilot.ts`, `apps/api/src/__tests__/cycle.test.ts`, `apps/web/components/shell/__tests__/business-shell.test.ts`, `apps/web/e2e/home.spec.ts`, `docs/DECISIONS.md`, `docs/PROGRESS.md`). Create `apps/api/src/__tests__/mobile-contract.test.ts`. Modify `.claude/skills/ship-change/SKILL.md`.
Interfaces: consumes `appRouter._def.procedures` (as `input-limits.test.ts:91` reads it) and `EVENT_TYPES` (`packages/shared`). Produces the contract test.
Steps:
1. `git fetch origin`, then `git log --oneline origin/main..origin/claude/zealous-rubin-8q52gr`. verify: 11 commits ending at `fdc81a6e`. If there are more, or D5 says the session is still working, stop and hand it this task's list instead.
2. Cut `claude/wp12-t7-mobile-pack` from `origin/main` and `git merge --no-ff origin/claude/zealous-rubin-8q52gr`. A merge, not a rebase: the session's commits stay as written, and a rebase would replay ten commits over the same three conflicts (the branch already holds a merge of main, `11fffcbf`). The merge commit must carry the repo's author identity (DECISIONS Oct 6, 2026 "Commit identity for Vercel's commit-author check"): the 11 commits are authored `noreply@anthropic.com`.
3. Three files conflict: `docs/DECISIONS.md`, `docs/PROGRESS.md`, `docs/mobile/BACKEND_CHANGES.md`. Keep both sets of lines (BACKEND_CHANGES §13 says so for the pack); put the branch's DECISIONS and PROGRESS entries where main's current structure takes entries (WP-01 may have changed that: follow main). verify: `git diff origin/main --stat` lists only the 9 files; outside `docs/` each differs by the one sentence "New rounds of work start on their own until nothing is left to do, or until you pause."
4. Write `mobile-contract.test.ts`: take every backticked token in the skill made of letters and dots whose first segment is a top-level router of the api, expanding `a.b.x|y|z`; each must be a procedure path, a prefix of one, or a declared event type. It also asserts the product skill still carries the sentence that starts "**Solo is complete**". verify: run it; every failure is a stale name: correct the name in the skill.
5. Add the shapes the pack lacks (with D5's yes): `invitation.byToken|accept|decline` with `hasProfile` (T2); `founder.adult.get|confirm`; the refusals `adult_unconfirmed`, `not_invited`, `on_waitlist`, `invitation_cannot_admit`, `invitation_admissions_limit`; `founder.profile.update` needs `confirmAdult: true` on the save that creates a profile (prompt 14 in `PROMPTS.md`); `publicPage.storyBySlug|cardById`; `publicPerson.byHandle`; `share.opened`; the role enum with `cofounder` and `collaborator` (BACKEND_CHANGES §9); `report.create` (T4) and `SinceLastVisit.arrived` (T3) when they merge. verify: the contract test passes; `node scripts/banned-terms.mjs` and `node scripts/us-english.mjs` pass.
6. One line in `ship-change`: a change to a procedure the mobile skill names updates the skill in the same pull request; the contract test fails otherwise.
7. After the founder merges: the founder pastes the skill into the Newly project again (BACKEND_CHANGES §11), and deletes the remote branch if they wish.
Tests: `mobile-contract.test.ts`; the three tests the branch changes.
Solo guard: the pack adds no People screen, no invite step and no empty state for people; the contract test's "Solo is complete" assertion holds the rule in the pack.
Done when: Done-when 6, and `git diff origin/main origin/claude/zealous-rubin-8q52gr -- docs/mobile packages/shared/src/autopilot.ts` shows only lines main gained after the merge.

### T8: The app prompt on public pages and the universal-link files            [S] [ships alone, after WP-03 T9; values need the founder]
- [x] merged

Why: A9-P2-1; CLAUDE.md "Small screens" (after launch a public page "still shows its content with a prompt to get the app, through one config value"); `docs/mobile/BACKEND_CHANGES.md` §5 (the two files do not exist).
Who does which half: WP-03 T9 adds the one value (`NEXT_PUBLIC_STORE_LINKS`), its parser, `PublicEnv.storeLinks`, the `GetTheApp` component and its first readers (the wall's controls and the landing footer), and leaves the signed-in handover as a commented branch in `DesktopOnly`. This task passes the links to the four public page kinds and adds the two files.
Files: create `apps/web/components/shell/PublicAppPrompt.tsx`, `apps/web/components/shell/__tests__/public-app-prompt.test.tsx`, `apps/web/lib/app-links.server.ts`, `apps/web/app/.well-known/apple-app-site-association/route.ts`, `apps/web/app/.well-known/assetlinks.json/route.ts`, `apps/web/app/__tests__/well-known.test.ts`. Modify `.env.example`, `docs/DEPLOY.md`, and one line each in `apps/web/app/p/[slug]/page.tsx`, `apps/web/app/u/[handle]/page.tsx`, `apps/web/app/m/[id]/page.tsx`, `apps/web/app/i/[token]/page.tsx`.
Interfaces: consumes `publicEnv().storeLinks`, `StoreLinks`, `GetTheApp({ links, className })` (WP-03 T9: `packages/config/src/app-links.ts`, `packages/dugout/src/components/public/GetTheApp.tsx`), `useViewportWidth` and `isViewportTooSmall` (as `DesktopOnly` uses them). Produces `PublicAppPrompt()` (client; renders `GetTheApp` only when links are set and the window is small) and `appLinks(env): { iosAppId: string | null; android: { packageName: string; sha256: string[] } | null }` from the server values `APP_LINKS_IOS_APP_ID` (`<Team ID>.com.foundmill.app`), `APP_LINKS_ANDROID_PACKAGE`, `APP_LINKS_ANDROID_SHA256`.
Steps:
1. Check the ground: `grep -n "parseStoreLinks" packages/config/src/app-links.ts`. verify: it prints a line; if not, WP-03 T9 has not merged: stop.
2. Tests first: `PublicAppPrompt` renders nothing when `storeLinks` is null and nothing at 1280 px; each well-known route answers 404 when its ids are unset and `application/json` with the app id and the paths `/b/*`, `/p/*`, `/u/*`, `/m/*`, `/i/*`, `/a/*` (never `/login` or `/auth/*`) when set; a signed-out request for `/.well-known/assetlinks.json` is not sent to sign-in. verify: fail.
3. Implement. The proxy: WP-03's task for unknown signed-out addresses lets `/.well-known/` through (its `redirects.test.ts` case). If that has not merged, append `"/.well-known/"` to `PUBLIC_PREFIXES` in `apps/web/lib/auth/redirects.ts` and tell WP-03's session. verify: step 2 passes; `node scripts/env-example.test.mjs` passes.
4. Mount `PublicAppPrompt` in the four route files. verify: with the value unset, `public-page.spec.ts`, `person-page.spec.ts`, `milestones.spec.ts` and `invitations.spec.ts` pass unchanged.
5. Record in docs/DEPLOY.md: the three server values, that they are set at launch with the store links (WP-00 S17), and who sets them (founder for the ids, Desktop session for the variables).
Tests: above.
Solo guard: with the value set, a one-person project's public page shows its content and the app prompt and nothing about people; with it unset the page's text is the same as before (the set case is a unit test in `public-app-prompt.test.tsx`, since the value is fixed when the web is built; `solo-guard.spec.ts` covers it unset).
Done when: setting the store links shows the prompt on a project page, a person page, a card and an invitation at 390 px, and the two files answer once their ids are set.

### T9: The fate of `apps/social`            [S] [needs the founder: D4]
- [x] merged

Why: THESIS_REVIEW 4.10 and §11 "Decide once"; A11 §6 item 5. It is 295 lines: one read over the old `public_profiles` view and four routes that answer 501 (`apps/social/src/app.ts`). It is not deployed (e0: "No collab or social service deployed"). The people side's signed-in procedures and the public reads (`publicPage.*`, `publicPerson.byHandle`) are all in the api.
Recommendation: remove it. NETWORK §8 proposed making it the home of public reads and of the feed and suggestion jobs; the public reads were built in the api, the jobs do not exist, and a scheduled job belongs in the orchestrator. Bring a separate service back when a measured load asks for one.
Steps on "remove": delete `apps/social`; drop it from `scripts/us-english.mjs:67`, docs/ARCHITECTURE.md lines 16 and 61, and "(and social)" in docs/DEPLOY.md:72; refresh the lockfile in the cloud session; record the decision. verify: `pnpm -w turbo typecheck lint test --force` passes; `grep -rn "apps/social\|@foundmill/social" --include='*.ts' --include='*.json' --include='*.mjs' .` prints nothing outside `docs/` and `node_modules`.
Steps on "keep": change nothing in code; correct the file's header comment and record why it stays.
Solo guard: no screen changes; T0's suites pass unchanged.
Done when: the decision is in docs/DECISIONS.md and the code matches it.

## Not now, and what would change that

Nobody should start these from this plan. There are 19 accounts and no connection between any two of them.

| Item | Why not now | What would make it worth building |
| --- | --- | --- |
| F4 feedback links | Two tables, a public route with a bot check, three events, a summary note and a return email: a week, not a day | 10 projects with a live page, and WP-08's outreach task asking for a link to send |
| F6 credit for bringing people; the Network-page total | Amounts wait for measured cost and for prices (A11 §6 item 1) | WP-09's cost per first session, the founder's amounts, D1 answered, and 20 attributed sign-ups |
| An `attributions` row for every accepted invitation | Needs a third source kind and a change to two account event schemas; nothing reads it until F6 | F6 starting |
| A line for arrivals through a person's profile (`u.<handle>`) | Has no project to show it in; belongs on the Network page | The people layer open (T6) |
| The record (F1), Built with (F19) | Nothing to list until outcomes are real | 25 projects with a verified outcome |
| Open roles (F15) | A role needs someone to read it | 100 people with a public profile, or 5 founders asking for it |
| Browse and search (F16, THESIS 4.2) | An empty room disappoints most | 100 people with a public profile |
| Suggestions and the matcher (THESIS 4.3) | Needs density and an eval | 300 people, 50 of whom said they are looking |
| Introductions and message requests (F17) | Needs its own security review (DECISIONS Nov 12, 2026) | Browse live, and T6's list done |
| Join requests, trials, parting (F18; THESIS 3.4, 3.5) | No stranger can find a project yet | 10 accepted collaborator invitations, or open roles live |
| Splits, founders' agreement, pooled credits (THESIS 3.8, 3.9) | No project has two founders | 5 projects with two or more founders |
| Communities for a purpose, cohorts, build hours (F12, F13, F14) | One community row, no members | 200 weekly active people |
| Latest and signals (F7, F8), asks (F10) | Nothing to fill a feed | 50 projects with a real outcome in one week |
| People notifications and the weekly letter (F20) | No people events exist to send | The first of the features above shipping |
| One identity for a person (THESIS 2.5's build) | Only matters once the layer opens | D2 answered "open" |
| Block everywhere, money-request screening (F21's rest) | Applies to messages between strangers | F17 starting |
| "Come see" invitations, group links | No measured request | A founder asking |

## Decisions for the founder

| # | Decision | Recommendation | Blocks |
| --- | --- | --- | --- |
| D1 | May a founder see that someone arrived through their page, and roughly when? (docs/PROGRESS.md:1937, unanswered) | Yes: one private line with a count since the last visit, nothing about who | T3's flag |
| D2 | The people layer (`LIVE_MODE`): open now, or stay closed? | Stay closed until T6's five conditions hold | T6 |
| D3 | Who are the operators (account ids), and what is the response target for a report? | The founder's own account; two days | T4's switch |
| D4 | `apps/social`: remove, or keep for public reads and jobs as NETWORK §8 proposed? | Remove | T9 |
| D5 | Is the mobile session still working on `claude/zealous-rubin-8q52gr`? May this package merge it and add the missing shapes to `docs/mobile`? | Yes to both; from then on the pack changes in the same pull request as the procedure | T7 |
| D6 | T1's note will send one "a decision is waiting" email to each of about 10 founders who have not been back, a day after their page is drafted (if platform mail is live). Send it? | Yes: it is the first true next step the product has for them. On a no, T1 waits for WP-04's email plan (switching `NOTIFY_EMAIL` off for a day would only delay the email: a note stays eligible for seven days) | T1's timing |

Not re-decided here, and cited where used: no public counts and no ranking (NETWORK §14 answers 3 and 4); the founder taps Share each time (answer 11); a feedback answer is never a real outcome (answer 5); the mark's rule (DECISIONS Nov 12, 2026 "The 'Built on Foundmill' mark"); who reads an attribution row (DECISIONS Nov 12, 2026 "Sign-up attribution: the calls made"); one sender for email (DECISIONS Nov 12, 2026 "One sender for every email from Foundmill").

## Corrections to the audits

1. `audits/a9-people-network-mobile.md` A9-P0-3 says `pageReady` "is true only when a draft is waiting, so nothing prompts an existing project". The code says the opposite: `todayView` sets it whenever no page is live and the ready note is not open (`apps/api/src/services/today.ts:270-272`). All 13 projects already show Today's quiet page line. What is missing is the draft, its note, and a founder who opens Today.
2. The same finding proposes starting the existing `draftProjectPage` activity. It returns `skipped` unless the foundations row is `drafting` for that attempt (`apps/orchestrator/src/activities/foundations.ts:204`). The catch-up calls `runProjectPageStep` directly. The audit's open question is answered: the store writes nothing when a row exists (`teamDraftNeeded`, `onConflictDoNothing`).
3. A9 §2.2: "`via` has no letter yet for a card". True, and not needed: a card's "Start your own" already carries the project's page reference (`apps/web/app/m/[id]/page.tsx:68`), so a card visitor is attributed as the page.
4. A9 §1.4 reads as if an invitation is always attributed. `recordInvitationAttribution` records nothing when the project has no live page and the inviter no public profile, which is every project in production today.
5. A9-P1-2 says the api needs a name. It does not: `founder.profile.update` falls back to the address's local part. And the card cannot ask `founder.profile.get` before the accept (it is refused for an account that is not admitted yet), hence `hasProfile` on the accept's answer.
6. A9 §6 says CI sets `LIVE_MODE` for `live.spec.ts`. The whole e2e stack runs with `LIVE_MODE=1` (`apps/web/playwright.config.ts:51`, `.github/workflows/ci.yml:180`), so no end-to-end test covers the closed layer production runs.
7. A9-P1-6 treats `takeLive` as a second copy of the shared limits. For communities, community invitations and post reports it is the only limit, and where both exist the numbers differ (30 against 20 requests an hour; 40 against 60 posts an hour).
8. A9-P1-7 calls the mobile branch a rebase. A dry merge conflicts in three files, the branch contains a merge of main, and all 11 commits are authored `noreply@anthropic.com`, which Vercel's commit-author check refuses.
9. `audits/a11-roadmap-status.md` §1 row 3.6 says `inbox.ts` has no recipient column. It has `for_user_id` (0103), as A9 says.

## Risks

- **T1 emails quiet founders.** The page note is a decision, so the waiting-decision email follows a day later. That is wanted (D6), but it is the first email most of them get. Run T1 only after WP-00 S1 proves mail, and before WP-04's quiet-project email.
- **A report nobody looks at.** T4 gives a queue, and a nightly count only if WP-02 T10 is on main; it sends no alert. With the layer closed, only public profiles and messages between existing connections (0 today) can be reported, so volume is near zero. The alert is condition 1 of T6 and must exist before the switch.
- **An operator list in an environment variable** is one more place to keep current. Only the api reads it. Record it in docs/DEPLOY.md with the date it was set.
- **The mobile session may have unpushed work.** The audits and this plan saw pushed refs only. T7 step 1 stops if the branch moved.
- **Drift back into wave 2.** Every item in "Not now" has a number beside it. A pull request from this package that adds one of them without that number being met is out of scope: say so in review.
- **`docs/DECISIONS.md` and `docs/PROGRESS.md` conflict on most merges** until WP-01 lands. Rebase each task's log lines last.

## Starting prompt

```
You are executing docs/holistic-plan/WP-12-people-side-gaps.md in the Foundmill repo. Read, in this order: CLAUDE.md;
docs/holistic-plan/README.md (the rules for executing a work package); the work package; then, for the task you are
on, the audit sections it cites under docs/holistic-plan/audits/ and the package CLAUDE.md files for the code you touch.
docs/NETWORK.md §10 (the solo guard) and §15 (what not to build) bind every task.

Rules: use the plan-change skill before writing code (it checks other branches and gives the next free migration
number); follow the karpathy-guidelines skill on every change; one task, one pull request, on a branch named
claude/wp12-t<n>-<short-name>; tests first, as each task's steps say; verify-done before saying a task is finished;
never push to main and never merge (the founder merges, ship-change). Author commits with the repo's identity
(DECISIONS, Oct 6, 2026).

Start with T0, then T1 and T2. T7 can run at any time. T4 comes before T5. T8 waits for WP-03 T9. Some steps wait
for the founder's answer to a decision (D1 to D6 in the work package), recorded in docs/DECISIONS.md: merging T1 (D6),
turning T3's flag on (D1), T4's operator list (D3), T6's switch (D2), T7 step 5 (D5) and T9's removal (D4). Until
then build the code path behind its switch with tests passing and stop there. Do not build anything listed under
"Not now". If a task looks larger than its steps need, say so in the pull request instead of building
the excess. After each merged task: one line in docs/PROGRESS.md, judgment calls in docs/DECISIONS.md, and tick the
task's box in the work package in the same pull request.
```
