# A8 — Data layer, API, events and security posture

Repo `/Users/reidjackson/code/founder-manager`, branch `main`, commit `04a0a509` (2026-11-15). Read-only audit: nothing was built, run or changed. Every path below is relative to the repo root unless it starts with `/`. Line numbers are from this commit.

Confidence: **high** where a file:line is cited (read directly); **medium** where marked "inferred" (derived from counts, names or docs); **not verified** where a claim needs the live database, Railway or the Supabase dashboard (each is flagged with a check to run). Areas only sampled, not read end to end: the 33 routers' bodies (headers, helpers and call-site greps were read; `live.ts`, `idea.ts`, `today.ts`, `agent.ts` in part), apps/stream and apps/collab internals, apps/gateway (out of scope, only spot-checked for SECURITY_REVIEW evidence).

---

## 1. How it works today

### 1.1 packages/db (`@foundmill/db`)

- **Client** `packages/db/src/client.ts`: `createDb(url, opts)` (:117-143) returns Drizzle over postgres.js, or over PGlite for `pglite:` URLs. Pool `max` default 10 (:132). A transaction pooler is detected from the URL (port 6543, `*.pooler.supabase.com`, `pgbouncer=true`; :97-108); through a pooler prepared statements are off (:136), `max_lifetime` is 6-7 h (:78, :124) and **no `statement_timeout` or `idle_in_transaction_session_timeout` is sent** (:125-126: both are `null` unless the connection is direct). Production uses the pooler (docs/DEPLOY.md:53 "transaction pooler, port 6543").
- **RLS** `withRls(db, { userId, role?, claims? }, fn)` (:278-302): opens a transaction, runs `select set_config('role', $1, true), set_config('request.jwt.claims', $2, true), set_config('jit', 'off', true)` (:248) piggy-backed on fn's first statement, then `fn(tx)`. Role whitelist `authenticated | anon | service_role` (:32). `rlsRoleOf(tx)` (:257) says which role a transaction runs as.
- **Pool care**: `warmPool` / `keepPoolWarm` (:193, :219), `pool-watchdog.ts` (`watchPoolOrExit`: exits the process when the pool is wedged while the database answers outside it; Railway restarts it).
- **Migrator** `packages/db/src/migrator.ts`: one transaction under `pg_advisory_xact_lock(7461, 1)` (:41), drizzle bookkeeping in `drizzle.__drizzle_migrations` (which is why Supabase's own migrations table is empty). Applied by the api at boot: `apps/api/src/index.ts:59-80` `migrateOnBoot`. A lock timeout exits 1; **any other migration failure is logged and the api keeps serving** (:77).
- **Repos** `packages/db/src/repos/<area>.ts` (68 area files plus `_shared.ts`, `_refs.ts`, `index.ts`), re-exported as `repos` from `packages/db/src/repos.ts`. Convention: `repos.<area>.<fn>(db: Executor, businessId, ...)`; person-level repos take `userId` in that position (`repos.ideas.get(db, userId, ideaId)`, `repos.social.*`). Shared helpers in `repos/_shared.ts`: `Executor` (:17), `PageInput`/`Page` (:30-40), `MAX_PAGE_SIZE = 500` (:28), keyset cursors (`timeKeyset` :116, `toPage` :157), `one`/`maybeOne`/`rowsOf` (:174-186).
- **Lint** `eslint.config.mjs:7-33` `fm/no-raw-db`: raw `db|tx|database|serviceDb|rlsDb .select/insert/update/delete/execute` is an error outside `packages/db/src/{repos,seed,migrate,testing,schema}`, migrations, `packages/events/src/{outbox,relay,consume}`, tests and scripts. Only 8 disables in non-test code (6 in `migrator.ts`, 1 `client.ts`, 1 `apps/api/src/context.ts` health probe). The rule enforces "through repos"; it does **not** enforce "under RLS".
- **Tests** `src/testing/pglite.ts` `createTestDb()` (:84) gives `{ db, asUser(userId), service(), anon(), createUser() }`; with `RLS_TEST_DATABASE_URL` set it builds the same harness on a real Postgres (`src/testing/postgres.ts`, 195 lines; added with migration 0087). `src/__tests__/rls/tables.ts` (`TENANT_TABLES`, write modes `member | admin | service | append`) drives the generated cross-tenant suite (`rls/cross-tenant.test.ts`); 37 more hand-written suites in `src/__tests__/rls/`; `fixtures.ts` `createBusinessFixture(h, slug)` (:67) builds businesses A and B; `RLS_DENIED` (:316). Migration-point tests `migration-00NN.test.ts` (12 files) apply only the migrations before NN.
- **tiers.ts** (165 lines): the three enforced plan limits (businesses per owner: unlimited for now; seats; concurrent agent sessions within `OPEN_SESSION_WINDOW_HOURS = 24`), raising `TierLimitError` (`tier_limit`).
- **Seeds** `src/seed.ts`, `src/seed/` (Northwind Skincare, Ledgerly; fixed ids in `seed/constants.ts:27` `DEMO_BUSINESS_IDS`), and `seed/roll-forward.ts` `rollDemoForward` (:484), called hourly by the api (see A8-06).

### 1.2 Migrations

**96 SQL files**, numbered `0001` to `0107` with 11 unused numbers (0029, 0032, 0037, 0038, 0042, 0043, 0045, 0047, 0049, 0050, 0051); 7,958 lines. Journal `packages/db/migrations/meta/_journal.json`: 96 entries, `idx` 0-95.

**Next free on main: file `0108_<name>.sql`, journal entry `{ "idx": 96, "version": "7", "when": <greater than 1796138640000; the last entries step by 600000, so 1796139240000>, "tag": "0108_<name>", "breakpoints": true }`.** Statements are separated by a line `--> statement-breakpoint`. Before taking a number a builder must run the open-branch check in `packages/db/CLAUDE.md` (I could not: read-only, no fetch). `migrations.test.ts` checks journal order and that `src/schema/*.ts` mirrors the SQL (tables, columns, indexes; policies are not mirrored: `src/schema/_common.ts` holds column helpers only).

Last 25:

| # | File | What it does |
|---|---|---|
| 0083 | founder_return | Return loop: `founder_presence`, `founder_visit_days`, `founder_notifications`; email switches on `account_preferences` |
| 0084 | autopilot_own_limits | Autopilot's own daily cycle cap and spend ceiling, apart from Continue's |
| 0085 | account_events | Person-scoped event store `account_events` + `account_outbox`; `fm_account_event_types()`; `events_not_account_scoped` check |
| 0086 | idea_drafts | Landing idea box: `idea_drafts`, `waitlist_entries` (service role only) |
| 0087 | client_grants | Real-Postgres fix: revokes what Supabase's default privileges gave anon/authenticated (execute on `fm_purge_business`, TRUNCATE/TRIGGER/REFERENCES everywhere, delete on three person tables) |
| 0088 | attributions | `attributions`: which public page/profile brought a new account (one row per account, service only) |
| 0089 | public_milestones | Milestones a founder shows: guard trigger, view `public_project_milestones` (service only) |
| 0090 | page_dates_recorded | `project_pages.published_at` etc. recorded by trigger, never typed in |
| 0091 | invitations | `invitations` (project invitations) and `account_admissions` |
| 0092 | people_roles | Roles `cofounder`, `collaborator`; `memberships.expires_at`; `is_member`/`has_role` redefined |
| 0093 | admission_cutover | `admission_existing_before()` constant; cofounder invitation must name an email |
| 0094 | collaborator_reads | `is_member_not_collaborator()`; 13 admin/Money tables' select closed to collaborators |
| 0095 | collaborator_money_legal | 7 Money/Legal tables closed to collaborators, read and write |
| 0096 | membership_grant_guards | What `section_permissions` may name; lock on one's own membership row |
| 0097 | founder_departures | `founder_departures` (trigger-written), `founder_cancel_links`, suppression_list write policy |
| 0098 | credit_lots | Bought credits as lots that last 12 months |
| 0099 | events_collaborator_walls | `fm_collaborator_event_types()`; `events`/`outbox` policies split, collaborator limited to listed types |
| 0100 | adult_confirmations | `adult_confirmations` (18+ once per account), kept in step with `network_attestations` |
| 0101 | project_postal_address | `project_postal_addresses` (CAN-SPAM address), owner/admin only |
| 0102 | post_media | `post_media`: video/voiceover of a post draft |
| 0103 | showcase_videos | `showcase_requests`, `showcase_consents`; restrictive policy `inbox_items_for_user` |
| 0104 | funding_source | Who funds a business's agent work (provider-neutral seam, off by default) |
| 0105 | page_quizzes | `page_quizzes`, `page_quiz_counts`, view `public_page_quizzes` |
| 0106 | post_attributions | `post_links`, `post_attributions`: what a shared team post led to |
| 0107 | collaborator_finance_fields | View `member_conversions`; `journey_daily` nulls spend/revenue for collaborators; `conversions_select` closed to collaborators |

### 1.3 The RLS model as built

- Helpers (all `security definer`, `search_path = public`): `is_member(bid)`, `has_role(bid, roles[])` (`0001_tenancy.sql:25-33`, redefined in `0092_people_roles.sql:33-53`: an expired membership opens nothing, a cofounder matches `'owner'`, a collaborator matches `'member'`), `business_has_members`, `is_public`, `is_member_not_collaborator` (`0094:24-32`), plus LIVE helpers (`is_thread_participant`, `is_community_member`, `is_community_moderator`, `connection_is_blocked`).
- `fm_tenant_table(tbl, write_roles default owner/admin/member, mode default 'standard')` (`0001:78-96`) is called 85 times: it enables RLS, creates `<tbl>_select` (`is_member(business_id)`) and, in standard mode, `<tbl>_write` **FOR ALL** (`has_role(...)`), revokes anon, grants DML to `authenticated` and `service_role`, adds the `updated_at` trigger. `'read_only'` mode creates the select policy only (services write). `fm_idea_table` (`0002:145-158`) does the owner-or-business variant for the three idea tables.
- Collaborator walls live in the database for 20 tables (0094: 13; 0095: 7), for `events`/`outbox` (0099), `conversions`/`journey_daily` (0107) and `credit_lots` (0098:32). Everything else a collaborator must not read is walled by the api only (`sectionRead/Write`, `eventAsSeenBy`).
- Service-only tables (RLS on, no policy, grants revoked from anon/authenticated): the 10 the advisor lists (see A8-19).
- Views: `journey_daily` and `member_conversions` filter by `is_member(business_id)` themselves (views run as owner and bypass RLS on the tables under them); `public_person_profiles`, `public_project_pages`, `public_project_milestones`, `public_page_quizzes` are granted to `service_role` only; **`public_profiles` is still granted to anon and authenticated** (`0012_live_social.sql:16`).

### 1.4 apps/api (`@foundmill/api`, 29.5k lines of source + 29.8k of tests, 154 test files)

- **Shape**: Hono app `apps/api/src/app.ts` (`createApp` :143), tRPC through the fetch adapter at `/trpc/*` (:321-332), `maxBatchSize` 25 (`packages/config/src/limits.ts:44`), body limit 2 MB or 6 MB for the four logo procedures (:313-316). Plain routes: `/health` (:189), `/personas/:style/:key` (:263-264), `/team-call-audio/:ticket` (:269), `/post-media/:token` (:289), the idea box routes (`idea-box-routes.ts`).
- **Routers**: 33 files in `apps/api/src/routers/`, merged in `apps/api/src/router.ts:38-82` into 39 top-level keys (`health` and 38 routers); about **424 procedures** (counted by grep of `.query(`, `.mutation(`, `.subscription(`). Per file (procedures): agent 21, billing 6, business 31, chief-of-staff 2, conversation 6, crm 16, cycle 3, department 23 (department/screen/dashboard), dev 23, distribution 15, email 3, finance 14, founder-businesses 2, founder 26 (+publicPerson), goal 4, idea-box 4 (+waitlist), idea 18, import 6, inbox 10 (+plan), integrations 12 (+keys), journey 9, legal 17, live 37, logo 9, page-quiz 7 (+publicQuiz), page 11 (+publicPage), people 6 (invitation), product 31, share 1, showcase 10, team-call 14 (+speechAccent), team 22, today 4.
- **Procedure helpers** `apps/api/src/trpc.ts`: `publicProcedure` (:298), `protectedProcedure` (:300; signed in and admitted via `admitOrWait`), `signedInProcedure` (:311; confirmed address, admitted or not), `businessProcedure` / `archivedBusinessProcedure` (:371/:376; `input.businessId`, membership loaded by `repos.memberships.access` on the service connection, memoized per HTTP request :334-348, attaches `ctx.business`, `ctx.membership`, `ctx.role`, `ctx.rls`), `writeProcedure` (:399), `adminProcedure` (:401), `ownerProcedure` (:403), `adminArchivedProcedure`/`ownerArchivedProcedure` (:405/:407), `sectionRead/sectionWrite/sectionAdmin(section)` (:422-424), `liveGate` (:417), `audit(tx, ctx, {action,target,details})` (:435), `emit(tx, ctx, {type,payload,...})` (:451), `modelLimited(rule)` (`services/model-limits.ts:120`).
- **Auth** `apps/api/src/auth.ts`: Supabase JWT verified with jose against the project's JWKS (ES256/RS256), HS256 only when `SUPABASE_JWT_SECRET` is set; audience `authenticated` is checked, **issuer is not** (:237-245). Password-only sessions refused (:204-212). `emailConfirmed` from `amr` (:191-196). Dev bypass (`dev`, `dev:<uuid>`, or no token) only when `APP_ENV` is development or test (:218; `packages/shared/src/env.ts:280` also nulls `DEV_AUTH_USER_ID` elsewhere). No session revocation check: a signed-out token works until `exp`.
- **Admission** `apps/api/src/services/access.ts` (345 lines): allow-list, invitation admission or open sign-up with a daily ceiling; decided once per request batch (`admissionMemo`) and cached in process for admitted accounts.
- **Pool and gate**: pool `API_DB_POOL_MAX` default 10 (`context.ts:37,141`); every HTTP request's `ctx.db` is a gated view (`context.ts:242`): at most 4 concurrent transactions per request and pool minus 4 = **6 across all requests** (`services/tx-gate.ts:165-175`), a wait capped at 15 s after which the transaction starts anyway. Background work uses the ungated database (`ungated()` :161; decision #123: foundations drafting and post drafts fall back to in-process runs when Temporal does not answer, `services/foundations.ts:196-207`).
- **Rate limits / allowances**: `services/rate-limit.ts` sliding windows; **Redis** (one Lua script per take) in staging and production, memory in development/test and as the fallback when Redis fails (`context.ts:152-157`). `services/model-limits.ts:36-76`: 18 named rules plus `SHARED_MODEL_LIMITS` (60/min, 600/h, 3,000/day per person; 1,200/h, 6,000/day per business). 55 take sites in all (model-backed procedures, public reads, follow, quiz, share, idea box, founder notices). There is **no general per-user or per-IP limit on ordinary tRPC procedures**.
- **Input bounds** (#139/#142): `boundedIssues` (`trpc.ts:84`), `boundedRecord` (`packages/shared/src/bounded-record.ts`), `apps/api/src/__tests__/input-limits.test.ts` fails on a new unbounded list or record.
- **Error shape**: `errorFormatter` (`trpc.ts:50-65`) returns tRPC's shape plus `data.appCode` and `data.details`; INTERNAL errors read "Something went wrong on our side. Quote reference <requestId>…" outside development/test (:256-259); FK, unique and RLS refusals are mapped to NOT_FOUND / CONFLICT / FORBIDDEN without echoing SQL (:162-186). The web shows `err.message` as is, except FORBIDDEN and TOO_MANY_REQUESTS (`apps/web/lib/trpc.ts:285-293`).
- **Boot** `apps/api/src/index.ts:131-249`: env, deps, shutdown steps, migrate, warm 8 connections (:86), watchdog, push notifier, outbox relay supervisor (business and account relays, `services/relay.ts`), listen, then in sequence: `SEED_ON_BOOT` demo seed, persona backfill, hourly demo roll-forward, idea box sweep, showcase sweep, hourly notify-email pass, worker monitor, workflow reconciler. All in the one api process.

### 1.5 packages/events (`@foundmill/events`, 5.0k lines)

- **Catalog**: `EVENT_TYPES` in `packages/shared/src/constants.ts:446-487` has **93 types**: 88 business-scoped, 5 account-scoped (`ACCOUNT_EVENT_TYPES` :532: `profile.published`, `profile.unpublished`, `signup.attributed`, `referral.arrived`, `founder_notice.sent`). Each is declared with a Zod payload in `packages/events/src/catalogue.ts` (2,474 lines; `declareEvent` / `declareAccountEvent`).
- **Write helpers**: `writeEvent(tx, { businessId, type, actor, entityIds, payload })` (`outbox/writer.ts:128`), `writeEvents` (:139), `writeAccountEvent(tx, input)` (`outbox/account-writer.ts:157`); in the api use `emit(tx, ctx, …)` (`trpc.ts:451`). Tables: `events` + `outbox` (`0011:232-276`), `account_events` + `account_outbox` (0085).
- **Relays**: `outbox/relay.ts` and `outbox/account-relay.ts` (`for update of o skip locked`, batch 100, idle poll 250 ms, `wake()` after each api mutation via the `wakeRelay` middleware `trpc.ts:290`), XADD to `ev:{businessId}` / `ae:{userId}` with MAXLEN ~100,000, trimmed to 30 days / 7 days. Published outbox rows are **never deleted**.
- **Consumers**: `consume.ts` (consumer groups, dead letter after 5 failures) exists, but **no service calls `consume()`**: grep over `apps/*/src` finds no use. The only readers of the business stream are apps/stream (fan-out to browsers) and the api's push notifier (fed from the relay's `onPublished`, `index.ts:201`). About 78 declarations in the catalog name a `metrics` consumer that does not exist.

### 1.6 apps/ingest, stream, collab, social

- **ingest** (3.2k lines; deployed, `railway/ingest.toml`): `/webhooks/:connector[/:businessId]` (`app.ts:83-84`), `/billing/stripe`, `/mail/*` (inbound, events, unsubscribe, confirm, notify/off, invitations/off), `/simulate/*` (development or staging with a verified service token; `app.ts:130-145`). Verify-before-parse, Redis nonce store with memory fallback (`nonce-store.ts`), tenant binding via `accountOf` (`webhooks.ts:185-199`).
- **stream** (2.5k lines; deployed): WebSocket fan-out of `ev:`, `as:`, `u:`, `ae:` streams; bearer in a subprotocol; `walls.ts` holds per-type section walls. Has its **own copy** of JWT verification (`apps/stream/src/auth.ts`).
- **collab** (1.5k lines): Yjs/ProseMirror spec editor server with a third copy of auth. **Not deployed**: no `railway/collab.toml`; docs/DEPLOY.md:249 "there is no collab service in staging"; the web falls back to the local editor when `NEXT_PUBLIC_COLLAB_URL` is empty (`apps/web/lib/env.ts:41-42`).
- **social** (295 lines of source + 226 of tests): `/health`, `GET /v1/public-profiles`, 501 placeholders (`apps/social/src/index.ts:1-8`). **Not deployed** (no railway file). The real LIVE backend is `apps/api/src/routers/live.ts` (37 procedures, closed by `liveGate` while `LIVE_MODE` is unset).

### 1.7 packages/shared (83 source modules, 16.7k lines; 7.7k lines of tests)

Exports everything through a wildcard (`package.json:12` `"./*": "./src/*.ts"`). It holds four different kinds of thing: (a) **infrastructure**: `env.ts` (329), `logger.ts`, `crypto/` (vault), `telemetry.ts` (414), `shutdown.ts`, `errors.ts`, `ids.ts`; (b) **cross-package contracts**: `constants.ts` (691: roles, `EVENT_TYPES`, scopes), `types.ts`, `permissions.ts`, `event-walls.ts`, `bounded-record.ts`; (c) **domain rules**: `goals.ts` (479), `autopilot.ts` (411), `morning-brief.ts` (393, incl. `REAL_OUTCOME_EVENT_TYPES` :45), `forecast.ts`, `money.ts`, `page-quiz.ts`, `project-page.ts`, `person-profile.ts`, `post-*.ts`, `showcase.ts`, `team-call.ts`, `logo-svg.ts` (896, the SVG sanitizer), `platform-mail.ts`, `notify-email.ts`; (d) **copy**: `terms.ts` (918), `personas.ts` (881), `founder-words.ts`, `notify-words.ts`, `area-words.ts`, `glossary.ts`, `copy.ts`.

### 1.8 supabase/

`supabase/config.toml` declares only: `project_id`, `auth.site_url`, three redirect URLs (already narrowed to `…/auth/callback**` plus the mobile scheme), `auth.email.otp_length = 6`, `otp_expiry = 900`, and the magic-link template (`supabase/templates/magic_link.html`, the only template). Not declared: Data API on/off, "Confirm email", anonymous sign-ins, sign-up on/off, JWT expiry, SMTP, auth rate limits (see A8-11).

---

## 2. Schema map

The migrations create 134 tables and drop 2 (`leaderboards`, `leaderboard_entries`, 0076): **132 tables by the repo; production reports 131** (see A8-32: diff the two lists). Views: `journey_daily` (over materialized `journey_daily_mv`), `member_conversions`, `public_profiles`, `public_person_profiles`, `public_project_pages`, `public_project_milestones`, `public_page_quizzes`. 58 distinct functions.

Write posture, in the words of `rls/tables.ts`: **member** = `fm_tenant_table` default (members read; owner/admin/member write; a collaborator counts as member unless noted), **admin** = owner/admin write, **service** = clients read only, **own** = the person's own rows, **svc-only** = no client access at all. "(−collab)" = closed to collaborators in the database (0094/0095/0098/0107).

### 2.1 People and accounts (person-level, no `business_id` unless said) — 20

- `memberships` (0001; `source` 0065, `expires_at` 0092): person-to-business role (`owner, cofounder, admin, member, viewer, advisor, collaborator`) + `section_permissions`. Hand-written policies (0092), guards 0026/0035/0096.
- `founder_profiles` (0002; handle and public profile 0080): one per account. own (`founder_profiles_own` FOR ALL).
- `account_preferences` (0022 and later columns): date format, guidance, anthropomorphic agents and style, builder view, email switches. own, no client delete (0087).
- `adult_confirmations` (0100): "18 or older", once per account. own select/insert.
- `network_attestations` (0027): the older 18+ record of the network, kept in step by triggers. **Duplicate of `adult_confirmations`.**
- `account_admissions` (0091): how an account got in (`invitation | open | existing`). svc-only.
- `invitations` (0091): invitations to a project (token, optional email, role). admin write; select (−collab).
- `founder_devices` (0075): push tokens. own.
- `founder_presence`, `founder_visit_days`, `founder_notifications` (0083): last seen per business, one row per visit day, what Foundmill sent. own (+`is_member`); carry `business_id`.
- `founder_departures` (0097): a founder demoted or removed (written by a security-definer trigger on `memberships`). select: self or owner.
- `founder_cancel_links` (0097): one-click cancel links for a deletion request. svc-only.
- `person_handle_releases` (0080): a released handle stays its owner's for 90 days. svc-only.
- `attributions` (0088): which page/profile brought a new account, one row per account. svc-only.
- `account_events`, `account_outbox` (0085): person-scoped events and their queue. `account_events`: own select; `account_outbox`: svc-only.
- `idea_drafts`, `waitlist_entries` (0086): signed-out visitor's idea card; waitlist. svc-only.
- `persona_portraits` (0067): AI-generated faces per persona key and style (platform asset). svc-only.

### 2.2 The business and its public face — 19

- `businesses` (0002): the tenant row. Columns that fight the vocabulary: `game_mode` (`live|personal`), `business_mode` (`augmented|assisted|automated`), `kit_primary`, `kit_secondary`, `crest_url` (held empty since 0017), `plan_tier`, `model_billing`, `is_demo` (0044). select `is_member(id)`; insert by any signed-in user (`businesses_insert`).
- `ideas`, `idea_versions`, `idea_comparisons` (0002): owner-scoped before commit, business-scoped after (`business_id` nullable; `fm_idea_table`).
- `business_logos` (0017), `business_foundations` (0018/0019): logo bytes; vision/spec/roadmap drafting state. admin, service-written.
- `goals` (0072), `chapter_titles` (0044), `holiday_periods` (0004; the UI says vacation), `demo_sample_rows` (0074; ids the seed wrote, per table).
- `project_pages` (0077): the public page (draft + published copy). Hand-written policies; view `public_project_pages`.
- `page_quizzes`, `page_quiz_counts` (0105): the optional quiz and its anonymous result counts.
- `contact_consents` (0079): followers of a page (double opt-in). owner, service-written.
- `project_mail` (0078): the project's Foundmill sending address and caps; `retired_mail_local_parts` (svc-only): local parts never reused.
- `project_postal_addresses` (0101): CAN-SPAM postal address. owner/admin only, read and write.
- `showcase_requests`, `showcase_consents` (0103): Foundmill's "house" business asking to feature a project.

### 2.3 Product — 10

`spec_blocks`, `spec_versions`, `change_proposals`, `proposal_hunks`, `roadmap_items`, `roadmap_dependencies`, `sources` (0003; member), `product_signoffs` (0062; member), `product_research` (0063; admin, service-written), `research_artifacts` (0063; member).

### 2.4 Agents, team, development — 24

- `agents`, `agent_versions` (member; column guard 0082), `departments`, `department_members` (admin), `screen_definitions` (member), `dashboard_layouts` (own within a business, 0044), `skill_definitions`, `skill_tests` (0004; library files 0061), `agent_skills` (service), `training_runs` (member), `tasks`, `task_edges` (member), `agent_sessions` (service; 17k rows, nearly all demo), `agent_metrics` (service), `playbooks` (member).
- `agent_threads`, `agent_messages` (0020): founder-agent conversations ("the desk"). member.
- `team_calls`, `team_call_turns`, `team_call_actions` (0082): calls with the team; visibility function `fm_team_call_visible`.
- `workspace_blobs`, `workspace_snapshots` (0013): a code task's saved workspace. service + owner/admin delete.
- `session_recordings` (0053): replay pointers. admin, service-written.
- `saved_table_views` (0041): a person's saved table views. own.

### 2.5 Inbox, plans, approvals — 7

`inbox_items` (0005; member + restrictive `inbox_items_for_user` 0103), `inbox_item_reads` (0048; own), `plans`, `plan_actions`, `decisions` (member), `composer_buffer` (service), `approvals` (0011; member in the database, owner/admin/named approver in the api).

### 2.6 Distribution — 8

`channels`, `campaigns`, `assets` (0006; member; a "team post" is an `assets` row), `channel_metrics` (service), `suppression_list` (0006; write policy redefined 0097), `post_media` (0102; service), `post_links`, `post_attributions` (0106; owner, service-written).

### 2.7 Customer journey — 5 (+ matview)

`visitors` (52k), `touches` (176k), `conversions` (64k; select −collab, clients read `member_conversions`), `journeys` (21k) (0007; all service-written), `milestones` (0007; member + platform guard 0089; `ref.trophyKey` marks platform-recorded firsts). `journey_daily_mv` is rebuilt whole by `refresh_journey_daily()`.

### 2.8 CRM — 7

`entities` (33k; tsvector `search`, trigram and embedding columns), `entity_roles`, `relationships`, `interactions`, `mentions`, `field_provenance`, `merge_log` (0008; member).

### 2.9 Money and billing — 10

`accounts` (0009; **bank accounts**, not user accounts; admin, −collab), `transactions`, `ledger_snapshots`, `forecasts` (member, −collab read and write), `securities`, `cap_table_entries` (admin, −collab), `usage_ledger`, `credit_balances` (service, −collab), `billing_checkouts` (0033; service, −collab), `credit_lots` (0098; service, −collab).

### 2.10 Legal — 6

`legal_entities`, `incorporations` (admin, −collab), `filings`, `contracts`, `compliance_events` (0010), `regulatory_gates` (0057) (member, −collab read and write).

### 2.11 Integrations, governance, events — 8

`integrations`, `webhooks`, `policies` (0011; admin, −collab), `credentials` (svc-only; sealed secrets), `app_installations` (0015; service, −collab), `audit_log` (hash-chained, append-only; members read and insert), `events`, `outbox` (0011; policies split by 0099).

### 2.12 LIVE network (closed by `LIVE_MODE`) — 8

`connections`, `message_threads`, `messages`, `communities`, `community_members`, `posts`, `negotiation_threads` (0012; hardened 0016/0027/0058), `post_reports` (0027).

### 2.13 Flags for the planner

**Looks unused or nearly so (do not drop before launch; verify row counts first):**
- `policies`: written only by the two seeds (`packages/db/src/seed/northwind.ts:352`, `ledgerly.ts:360`); never loaded into the policy engine (SEC-19).
- `network_attestations`: superseded by `adult_confirmations`; referenced only by comments and its schema (`packages/db/src/schema/social.ts:231`) and kept in step by triggers.
- `negotiation_threads`: dormant and hidden (THESIS §14 decision 9).
- The other seven LIVE tables: reachable only through `live.*`, which `liveGate` closes.
- `webhooks`: read by ingest (`apps/ingest/src/webhooks.ts:224`) for per-business secrets, but nothing stores a founder's own secret yet (SECURITY_REVIEW N2), so it is effectively seed-only.
- `demo_sample_rows`, and the demo share of `touches`/`conversions`/`visitors`/`journeys`/`agent_sessions`/`entities` (A8-06).
- Every table has at least one repo that references it; none is orphaned in code.

**Duplicated or confusable concepts (keep, but brief builders):**
- `attributions` (which page brought a new **account**; person-level, 0088) vs `post_attributions` (which shared **post** a follow/reply/payment came through; business-level, 0106) vs `touches`/`journeys` (multi-touch attribution of a project's **customer**; 0007). Three unrelated meanings of "attribution".
- `adult_confirmations` vs `network_attestations` (same fact twice).
- `/b/[bid]/trophies` redirects to `/b/[bid]/milestones` (`apps/web/app/b/[bid]/trophies/page.tsx`); the table is `milestones`, the platform-recorded key is `ref.trophyKey`, repo functions are `awardMilestone` / `awardedTrophyKeys` (`packages/db/src/repos/journeys.ts:731-742`).
- "post": `posts` (community posts, LIVE) vs team posts (`assets` rows + `post_media`, `post_links`, `post_attributions`).
- "messages": `messages` (person to person, LIVE) vs `agent_messages` (founder and agent) vs `team_call_turns`.
- "consents": `contact_consents` (a page's followers) vs `showcase_consents` (founders agreeing to be featured).
- "invitations": `invitations` (to a project) vs community invitations (`community_members.status = 'invited'`).
- "visits": `visitors` (a project's site visitors) vs `founder_visit_days` (the founder's own visits).

**Names that fight the vocabulary rules and must stay (no renames; warn builders):**
- `businesses` / `business_id` everywhere (the product says club, the newer copy says project); `founder_*` tables (manager); `agents` (squad); `departments` (labels over modules); `holiday_periods` (vacation).
- `accounts` = bank accounts, while `account_events`, `account_outbox`, `account_preferences`, `account_admissions` = user accounts.
- `plans` / `plan_actions` = an agent's plan of actions; `businesses.plan_tier` = the pricing plan.
- `policies` = Cedar policies (not RLS policies). `sources` = product research sources (not funding sources, 0104). `channels` = distribution channels (not stream channels).
- Events `signup.created`, `activation.reached`, `payment.received`, `customer.converted` and the table `conversions` are about the **project's customers** ("a match"), never about people signing up to Foundmill. A planner looking for Foundmill sign-ups will not find them there (A8-08).
- Payload keys with football words: `captainChannelKey` (`packages/shared/src/morning-brief.ts:96`), `trophyKey`; columns `kit_*`, `crest_url`, `game_mode`.

---

## 3. Findings

Severity: P0 = cross-tenant or unauthenticated breach reachable today; P1 = will hurt at launch scale or blocks safe execution of the plan; P2 = real defect or debt with a prerequisite; P3 = hardening and tidy-up. **No P0 found**: with the Supabase Data API off (docs/DEPLOY.md:149) the only path to the database is the api, every business procedure checks membership first (`trpc.ts:353-368`), repos scope by `businessId`/`userId`, and the cross-tenant suites exist. That statement depends on the Data API staying off; see A8-11.

Index (ids are stable; A8-31 is unused, the Railway deadline is in §7):

| ID | Sev | Title | Kind of change |
|---|---|---|---|
| A8-01 | P1 | CI never runs real Postgres / postgres.js / Supabase roles | CI job |
| A8-02 | P1 | api database throughput ceiling, no statement timeout, unmeasured at 100 users | load test, config, `client.ts` |
| A8-03 | P2 | 45 policies call `auth.uid()` per row | migration |
| A8-04 | P2 | `_select` + `_write FOR ALL` evaluated on every select (320 findings) | migration + helper |
| A8-05 | P2 | 13 functions with mutable `search_path` | migration |
| A8-16 | P2 | Half the api runs on the service connection; the "always RLS" invariant is untrue | docs, lint, tests |
| A8-06 | P2 | Demo data dominates production and is rewritten daily; first-run cost; metrics hygiene | seed, job, view |
| A8-07 | P2 | `bak_20261013`: undocumented manual backup schema | operator steps |
| A8-08 | P2 | No analytics store or consumer; three funnel events missing; north star SQL | events, table, job |
| A8-13 | P2 | No account deletion/export; deleted auth users orphan projects | api + orchestrator |
| A8-14 | P2 | No backup/restore/retention policy for the product database | docs, schedule |
| A8-15 | P2 | A failed migration does not stop the api | `index.ts` |
| A8-17 | P2 | `journey_daily_mv` rebuilt for all businesses on any change | migration (post-launch) |
| A8-09 | P2 | One `SESSION_TOKEN_SECRET` for twelve token kinds on five services (N4) | secrets, verifiers |
| A8-10 | P2 | Vault master key in env on four services | KMS, rotation |
| A8-11 | P2 | Data API off / Confirm email on are dashboard-only | `supabase/config.toml`, probe |
| A8-12 | P2 | Three copies of JWT verification, drifted | shared module |
| A8-18 | P3 | Six composite FKs without a covering index | migration |
| A8-19 | P3 | Ten RLS-on, no-policy tables: intentional | test only |
| A8-20 | P3 | pg_trgm and vector in `public` | accept, record |
| A8-21 | P3 | `public_profiles` readable by anon/authenticated | migration |
| A8-22 | P3 | ingest webhook and billing bodies unbounded | `apps/ingest/src/app.ts` |
| A8-23 | P3 | web defaults to development without `NEXT_PUBLIC_APP_ENV` | `apps/web/lib/env.ts` |
| A8-24 | P3 | `APP_ENV=test` in a production image honors the dev bypass | three auth files |
| A8-25 | P3 | Outbox rows never pruned; no cross-business index on `events` | schedule, index |
| A8-26 | P3 | Secret and dependency scans advisory; broad gitleaks allow-list | CI |
| A8-27 | P3 | `/health` detail, CORS localhost, `iss` unchecked, no general request limit | `app.ts`, `auth.ts`, `trpc.ts` |
| A8-28 | P3 | Raw zod messages reach people | web + api |
| A8-29 | P3 | Export held in memory | `lifecycle.ts` |
| A8-30 | P3 | Dead weight: apps/social, apps/collab, unused tables, shared sprawl | cleanup |
| A8-32 | P3 | 132 tables in the repo vs 131 in production | check |

Suggested migration packaging on main (each with its journal entry; confirm numbers against open branches first): **0108** `rls_initplan_search_path` (A8-03 + A8-05 + redefine `fm_idea_table`), **0109** `split_write_policies` (A8-04, incl. the new `fm_tenant_table`), **0110** `fk_indexes_public_profiles` (A8-18 + A8-21 + `events_type_occurred_idx` from A8-08). Keep them separate so each can be reverted alone and each is proven on real Postgres (A8-01 first).


### P1

**A8-01 (P1) CI never runs on real Postgres, postgres.js or Supabase's roles.**
- Evidence: `.github/workflows/ci.yml` has no Postgres service and never sets `RLS_TEST_DATABASE_URL` (grep: no hit); unit and e2e jobs run on PGlite (`ci.yml:205` `SEED_TARGET=pglite`). Two production-only bugs already got through this gap: Supabase default privileges (`0087_client_grants.sql:1-21`: "PGlite has no such defaults, so the suites could not see what this closes") and `Date` parameters on postgres.js (`packages/db/src/client.ts:152-162`: "The PGlite tests never saw it"). `src/__tests__/testing-postgres.test.ts` and `apps/api/src/__tests__/people-races.test.ts` only run by hand (docs/DEPLOY.md:182).
- Impact: every migration in this report (policies, grants, search_path) changes exactly the behavior PGlite cannot show. A cloud session executing the plan has no automatic proof on the production engine.
- Fix: add a CI job with a `postgres:17` service; bootstrap the Supabase-like roles and default privileges (the recipe is already written in docs/DEPLOY.md:182: roles `anon`, `authenticated`, `service_role`, `alter default privileges … grant all … to postgres, anon, authenticated, service_role`); run `RLS_TEST_DATABASE_URL=… pnpm --filter @foundmill/db test:rls`, `pnpm --filter @foundmill/db test` and the api's `people-races.test.ts`. Second step: a PgBouncer container in transaction mode on port 6543 and one smoke that boots the api's migrator and a `withRls` round trip through it. Make the job required.
- Tests to add: the job itself; `rls/advisors.test.ts` (A8-03/04/05) must run in it.

**A8-02 (P1) The api's database throughput has a low, unmeasured ceiling; 100 concurrent users will queue for seconds.**
- Evidence: pool 10 (`apps/api/src/context.ts:37`), gate: 6 concurrent RLS transactions for all requests, 4 per request, 15 s wait then start anyway (`services/tx-gate.ts:165-175`). Each procedure is its own transaction of at least three round trips (BEGIN; setup + statements; COMMIT; `packages/db/src/client.ts:273-276`), a batch carries up to 25 procedures (`packages/config/src/limits.ts:44`), Today alone runs about 20 statements in one transaction (`apps/api/src/services/today.ts:129-275`). Through the pooler there is **no statement timeout** (`client.ts:125-126`), and `set local role` does not apply the `authenticated` role's own timeout. docs/DEPLOY.md:110-112 records two pool outages (2026-10-19 wedge, 2026-11-12 one request filling the pool). One api process also runs both relays, the hourly demo roll, three sweeps and the notify pass (`index.ts:194-248`). docs/DEPLOY.md:112 reasons about "Railway Postgres's default `max_connections` of 100" and Temporal's pools, but the product database is Supabase behind Supavisor (DEPLOY.md:53) and Temporal has its own Railway Postgres (DEPLOY.md:122, :275): the paragraph sizes the wrong database.
- Impact (estimate, not measured): at 10 ms per round trip a typical screen transaction takes 60-100 ms, so 6 permits give roughly 60-100 transactions per second. 100 people opening Today at once is about 1,000 transactions: 10-17 s to drain, past the 15 s gate wait, after which transactions start without permits and the pool itself queues. THESIS_REVIEW.md:503 ("7.4 Load and moderation capacity measured before each widening of sign-up") has no measurement behind it yet.
- Fix, in order: (1) **measure**: a k6 or autocannon script against staging that replays the web's Home/Today/Inbox/Journey batches for 25, 50, 100 virtual users; record p50/p95 and `/health` `transactions.{peak,waiting,timeouts}`. (2) Read the real limits: `show max_connections;` on Supabase and the pooler's pool size and max clients (Dashboard → Database → Connection pooling); six services × 10 = 60 pooler clients today. (3) Add a per-transaction timeout in the same round trip: change `RLS_SETUP_SQL` (`client.ts:248`) to also `set_config('statement_timeout', '8000', true)` (and `'idle_in_transaction_session_timeout', '15000'`); background jobs keep their own. (4) Raise `API_DB_POOL_MAX` (20-30) once (2) shows room; the gate follows. (5) Collapse the heaviest batches into one procedure per screen, as `today.visit` already does (`routers/today.ts:16`). (6) Run two api replicas only after checking the singletons: the relays are safe (`skip locked`), rate limits are in Redis; the demo roll, sweeps and notify pass would run twice (move them to the orchestrator or guard each with `pg_try_advisory_xact_lock`).
- Tests to add: the load script checked into `scripts/` with a documented pass line (for example p95 < 1.5 s at 100 users, `timeouts = 0`); a unit test that a `withRls` statement longer than the timeout fails with 57014 on the real-Postgres harness.

### P2 — advisors and RLS

**A8-03 (P2) 45 policies call `auth.uid()` per row (`auth_rls_initplan`). Oversight, undocumented.**
- Evidence: no mention of the advisor in docs/DECISIONS.md. The count matches the hand-written policies exactly: `memberships` ×4 (`0066:11`, `0092:58-76`), `founder_profiles_own` (`0002:24`), `businesses_insert` (`0002:65`), the six `fm_idea_table` policies (`0002:149-153`), `dashboard_layouts` ×4 (`0044:12-23`), `connections` ×4 (`0016:74-97`), `message_threads_participants` (`0012:67`), `messages_insert` (`0012:101`), `communities_insert` (`0012:166`), `community_members` ×3 (`0012:180-190`), `posts` ×3 (`0012:224-226`, `0027:78`), `post_reports_select` (`0027:106`), `network_attestations_select` (`0027:130`), `account_preferences_own` (`0022:18`), `saved_table_views_own` (`0041:26`), `inbox_item_reads_own` (`0048:29`), `founder_devices_own` (`0075:24`), `founder_presence_own`, `founder_visit_days_own`, `founder_notifications_own_select` (`0083:33,63,112`), `account_events_own_select` (`0085:146`), `invitations_insert` (`0091:67`), `founder_departures_select` (`0097:59`), `adult_confirmations` ×2 (`0100:36-38`), `showcase_consents_select` (`0103:109`), `inbox_items_for_user` (`0103:126`). `fm_tenant_table` itself has no direct `auth.uid()` (it calls `is_member`/`has_role`), so it needs no change for this advisor.
- Fix (new migration, e.g. `0108_rls_initplan`): no policy on main contains `select auth.uid()` today (grep), so a single textual pass is safe:
```sql
do $$
declare p record; q text; c text;
begin
  for p in select schemaname, tablename, policyname, qual, with_check from pg_policies
            where schemaname = 'public' and (qual like '%auth.uid()%' or with_check like '%auth.uid()%')
  loop
    q := replace(p.qual, 'auth.uid()', '(select auth.uid())');
    c := replace(p.with_check, 'auth.uid()', '(select auth.uid())');
    execute format('alter policy %I on %I.%I%s%s', p.policyname, p.schemaname, p.tablename,
      case when q is not null then format(' using (%s)', q) else '' end,
      case when c is not null then format(' with check (%s)', c) else '' end);
  end loop;
end $$;
```
  Also `create or replace function fm_idea_table` with `(select auth.uid())` so the helper cannot reintroduce the form. `alter policy` keeps the command, roles and permissive/restrictive kind.
- Tests: `packages/db/src/__tests__/rls/advisors.test.ts`: `select count(*) from pg_policies where schemaname='public' and (qual ~ 'auth\.uid\(\)' and qual !~* 'select auth\.uid\(\)' or with_check ~ 'auth\.uid\(\)' and with_check !~* 'select auth\.uid\(\)')` is 0. The whole RLS suite must pass unchanged.

**A8-04 (P2) Every select on about 60 tables evaluates two policies (`<t>_select` and `<t>_write FOR ALL`): 320 advisor findings. Oversight; the repo already knows the fix.**
- Evidence: `fm_tenant_table` creates the FOR ALL policy (`0001:86-91`); `fm_idea_table` does the same (`0002:152`). The repo split one table by hand for a different reason (`0004_agents_departments_tasks.sql`, `skill_tests`: "Split per command (a `for all` policy's USING clause would make held-out rows visible to writers)") and split `events`/`outbox` in 0099. 0095's header notes that a FOR ALL write policy also answers SELECT.
- Impact: each row a select touches runs both `is_member()` and `has_role()` (two `exists` on `memberships`). Halving that is free.
- Fix (same or next migration): split only the policies named `<table>_write`; leave `posts_moderate` and `community_members_moderate` alone (their FOR ALL deliberately lets moderators read hidden rows) and leave single FOR ALL policies (`*_own`, `message_threads_participants`).
```sql
do $$
declare p record; r text;
begin
  for p in select tablename, policyname, qual, with_check, roles from pg_policies
            where schemaname = 'public' and cmd = 'ALL' and permissive = 'PERMISSIVE' and policyname = tablename || '_write'
  loop
    if exists (select 1 from pg_policies x where x.schemaname = 'public' and x.tablename = p.tablename
                and x.policyname in (p.tablename || '_insert', p.tablename || '_update', p.tablename || '_delete')) then
      raise exception 'split write policies: % already has a per-command policy', p.tablename;
    end if;
    if not exists (select 1 from pg_policies x where x.schemaname = 'public' and x.tablename = p.tablename and x.cmd = 'SELECT') then
      raise exception 'split write policies: % has no select policy; writers would lose reads', p.tablename;
    end if;
    r := array_to_string(p.roles, ', ');
    execute format('create policy %I on public.%I for insert to %s with check (%s)', p.tablename || '_insert', p.tablename, r, coalesce(p.with_check, p.qual));
    execute format('create policy %I on public.%I for update to %s using (%s) with check (%s)', p.tablename || '_update', p.tablename, r, p.qual, coalesce(p.with_check, p.qual));
    execute format('create policy %I on public.%I for delete to %s using (%s)', p.tablename || '_delete', p.tablename, r, p.qual);
    execute format('drop policy %I on public.%I', p.policyname, p.tablename);
  end loop;
end $$;
```
  and redefine the helper for tables created later:
```sql
create or replace function fm_tenant_table(tbl text, write_roles text[] default array['owner','admin','member'], mode text default 'standard') returns void
language plpgsql set search_path = pg_catalog, public, pg_temp as $$
begin
  if mode not in ('standard', 'read_only') then raise exception 'fm_tenant_table: unknown mode %', mode; end if;
  execute format('alter table %I enable row level security', tbl);
  execute format('create policy %I on %I for select using (is_member(business_id))', tbl || '_select', tbl);
  if mode = 'standard' then
    execute format('create policy %I on %I for insert with check (has_role(business_id, %L::text[]))', tbl || '_insert', tbl, write_roles);
    execute format('create policy %I on %I for update using (has_role(business_id, %L::text[])) with check (has_role(business_id, %L::text[]))', tbl || '_update', tbl, write_roles, write_roles);
    execute format('create policy %I on %I for delete using (has_role(business_id, %L::text[]))', tbl || '_delete', tbl, write_roles);
  end if;
  execute format('revoke all on %I from anon', tbl);
  execute format('grant select, insert, update, delete on %I to authenticated, service_role', tbl);
  perform fm_track_updated_at(tbl);
end; $$;
```
- Why it is safe: every write policy's writers are a subset of its select policy's readers (`has_role` implies `is_member`; the 0095 tables pair `has_role and is_member_not_collaborator` with a select of `is_member_not_collaborator`; the idea tables pair owner-or-writer with owner-or-member). An `update … where` or `returning` still needs the select policy, which writers pass.
- Follow-ups in the same change: `packages/db/src/__tests__/rls/founder-departures.test.ts:283` reads `suppression_list_write` by name; BUILD §7.1 and `packages/db/CLAUDE.md` describe "`T_write` (for all)"; 0095's guard is historical and does not run again.
- Tests: the generated cross-tenant suite and `people-roles`, `collaborator-finance`, `events-collaborator` suites unchanged and green on PGlite **and** real Postgres; in `advisors.test.ts`: no table in `public` has a permissive FOR ALL policy beside a permissive SELECT policy for the same role, except an explicit allow-list (`posts`, `community_members`).

**A8-05 (P2) 13 functions have a mutable `search_path`. Oversight in early migrations; later ones set it.**
- Evidence and origin: `fm_set_updated_at` (`0001:54`, redefined `0074:31`), `fm_track_updated_at` (`0001:62`), `fm_tenant_table` (`0001:78`), `fm_idea_table` (`0002:145`), `entities_search_update` (`0008:37`), `audit_log_chain` (`0011:165`), `audit_log_immutable` (`0011:188`, redefined `0028:34`), `fm_agents_clear_paused_reason` (`0023:16`), `fm_business_currency` (`0025:39`), `fm_page_content_ok` (`0077:16`, redefined `0079:50`), `fm_person_tags_ok` (`0080:23`), `admission_existing_before` (`0093:18`, created by `execute format`), `fm_page_quiz_ok` (`0105:29`). None is `security definer`, so the risk is low (a caller with create rights in an earlier schema could shadow a name); every security-definer function sets it (grep: no `security definer` without `set search_path`).
- Fix:
```sql
alter function fm_set_updated_at()              set search_path = pg_catalog, public, pg_temp;
alter function fm_track_updated_at(text)        set search_path = pg_catalog, public, pg_temp;
alter function fm_tenant_table(text, text[], text) set search_path = pg_catalog, public, pg_temp;
alter function fm_idea_table(text)              set search_path = pg_catalog, public, pg_temp;
alter function entities_search_update()         set search_path = pg_catalog, public, pg_temp;
alter function audit_log_chain()                set search_path = pg_catalog, public, pg_temp;
alter function audit_log_immutable()            set search_path = pg_catalog, public, pg_temp;
alter function fm_agents_clear_paused_reason()  set search_path = pg_catalog, public, pg_temp;
alter function fm_business_currency(text)       set search_path = pg_catalog, public, pg_temp;
alter function fm_page_content_ok(jsonb)        set search_path = pg_catalog, public, pg_temp;
alter function fm_person_tags_ok(text[])        set search_path = pg_catalog, public, pg_temp;
alter function admission_existing_before()      set search_path = pg_catalog, public, pg_temp;
alter function fm_page_quiz_ok(jsonb)           set search_path = pg_catalog, public, pg_temp;
```
  (`pg_catalog, public, pg_temp` is the form 0016, 0097, 0099, 0103 and 0105 already use; `public` must stay because `audit_log_chain` and the DDL helpers name tables unqualified and pg_trgm/vector live in `public`.) Cost: a function with a `SET` clause is not inlined and pays a small per-call setup; `fm_set_updated_at` fires on every update, so measure the demo roll-forward before and after.
- Tests: in `advisors.test.ts`, every non-extension function in `public` has a `search_path=` entry in `pg_proc.proconfig`.

**A8-16 (P2) "Every user-originated query runs under RLS" is not true of the code; RLS is the second wall for about half the api.**
- Evidence: `apps/api/CLAUDE.md` states the invariant. In `apps/api/src/routers`: 206 `ctx.rls(` call sites and 201 `ctx.db` (service connection) call sites; in `services`: 131 vs 236. Whole areas run on the service connection with the rules re-implemented in code: `routers/live.ts` (61 uses; :70-73 "this router runs on the service connection, so the rule is applied here"), `routers/idea.ts` (26), `routers/founder.ts` (15), `routers/email.ts` (15), `routers/agent.ts` (14: every write is `ctx.db.transaction`), `routers/business.ts` (14), `routers/integrations.ts` (10), `services/showcase.ts` (32), `services/product-research.ts` (23), `services/foundations.ts` (21), `services/pages.ts` (12). `businessProcedure` itself reads the membership on the service connection (`trpc.ts:336`). I found no call that skips the membership check: business procedures go through `businessBase`, person procedures pass `ctx.userId` into the repo.
- Impact: the database's collaborator walls (0094/0095/0099/0107) and section walls protect only the `ctx.rls` half. On the `ctx.db` half a missing `sectionRead` or a missing `eventAsSeenBy` is a leak the database will not catch (the class #131/#132 fixed by hand). When LIVE opens, person-to-person privacy (connections, messages, communities) rests on `repos/social.ts` alone.
- Fix: (1) correct the invariant in `apps/api/CLAUDE.md` and ARCHITECTURE §13: name the routers that are service-connection by contract and why. (2) Add a lint rule `fm/service-db-in-router`: `ctx.db` inside `apps/api/src/routers/**` needs an inline disable with a reason; that produces the reviewed inventory. (3) Convert plain reads behind `sectionRead` to `ctx.rls` where there is no reason not to (start with `today.ts:311-313,352,361`, `routers/agent.ts:38-41,257,291,389-393`, `routers/integrations.ts:163-212`). (4) Before `LIVE_MODE=1`: either move `live.*` under `ctx.rls` (the policies exist: 0012/0016/0027/0058) or add a suite that runs every `live.*` procedure as a non-participant.
- Tests: extend `apps/api/src/__tests__/section-walls.test.ts` to enumerate every procedure from `appRouter._def.procedures` and assert a collaborator and a walled member get FORBIDDEN or a redacted shape for every Money/Legal/Settings procedure (table-driven, so a new procedure fails until classified).

### P2 — data, lifecycle, analytics

**A8-06 (P2) Demo data dominates the production database and is rewritten every day.**
- Evidence: production volumes (176k touches, 64k conversions, 52k visitors, 33k entities, 21k journeys, 17k agent_sessions) are almost all the two demo businesses. `apps/api/src/services/demo-roll-forward.ts:17,54-60` runs `rollDemoForward` at boot and hourly; `packages/db/src/seed/roll-forward.ts:440-476` shifts every sample row's timestamps by the whole days elapsed, per table in a savepoint, then appends an audit row; afterwards `refresh_journey_daily()` rebuilds the matview for every business (`demo-roll-forward.ts:44`). Every new account gets a viewer membership of the demo business (`memberships.source = 'example'`, 0065), so the first screens a new person opens are the heaviest queries in the system: each RLS select calls `is_member()` per row over tens of thousands of rows.
- Impact: once a day roughly 360k row updates (an estimate from the row counts; the exact table list is in `roll-forward.ts`) (dead tuples, index churn, WAL, autovacuum) for data nobody owns; first-run latency for every new person; backups and exports sized by samples; the audit log (8.5k rows) mostly roll entries (inferred).
- Leak into metrics: guarded in most places by `businesses.is_demo` (`repos/presence.ts:125` retention report, `repos/notify-email.ts:51`, gateway notices, `repos/pages.ts:244`, `public_profiles` view `0092:103`). **Not guarded by construction**: any new SQL over `events`, `conversions` or `journey_daily` must add `not b.is_demo` itself, and `mockResultsAllowed(appEnv, isDemo)` lets demo businesses produce simulated results on purpose. The north star SQL in A8-08 excludes both. Foundmill's own "house" business (`HOUSE_BUSINESS_ID`, `packages/config/src/showcase.ts:13`) is not `is_demo` and must be excluded by id.
- Fix: (1) set `SEED_VOLUME_SCALE` for production (CI already uses 0.1, `ci.yml:205`) and reseed the demos once, cutting the sample by 10×; (2) roll forward weekly, or stop rewriting rows and instead render sample dates relative to an anchor at read time; (3) add a view `real_businesses` (`select * from businesses where not is_demo and id <> '<house id>' and archived_at is null`) and require analytics SQL to join it; (4) longer term, serve the example from a static snapshot instead of live tenant tables.
- Tests: `demo-isolation.test.ts`: seed a demo and a real business, run every analytics repo function (`presence.retentionReport`, the new north star function) and assert the demo contributes zero.

**A8-07 (P2) Schema `bak_20261013` (89 tables, no primary keys) is an undocumented manual backup that escapes deletion and review.**
- Evidence: no occurrence of `bak_` in the repo, in any doc, or in git history (`git log --all -S'bak_2026'` is empty); `node scripts/decisions-index.mjs bak_` finds nothing. Inferred origin: on 2026-10-13 the audit-fix releases 1 and 2 were merged and deployed (`git log`: "PROGRESS: release 1 merged to main", "release 2 merged and deployed", with migration renumbering commits `d3e91cf5`, `f5b7caa9`, `2934ee0d`, `48708c5b`); the repo had 91 tables at migration 0031, so 89 tables with no primary keys fits a `create table bak_20261013.x as select * from public.x` snapshot taken by hand before those migrations ran.
- Impact: copies of `credentials` (sealed secrets), `audit_log`, `founder_profiles`, CRM entities and messages that `fm_purge_business` never touches, so a business deleted since then still has its data there (the 7-day deletion promise is broken for those rows); no RLS on those tables (not reachable by clients while the Data API exposes only `public` and is off, but one setting away); storage and backup cost.
- Fix (operator steps, not a repo migration, because the api's migrator should not drop a schema it never created): (1) `select schemaname, relname, n_live_tup from pg_stat_user_tables where schemaname = 'bak_20261013' order by 3 desc;` and `select grantee, privilege_type from information_schema.schema_privileges where schema_name = 'bak_20261013';` (2) if anything is still wanted, `pg_dump --schema=bak_20261013` to encrypted cold storage with a deletion date; (3) `drop schema bak_20261013 cascade;` (4) record it in docs/DECISIONS.md with a rule: backups are Supabase backups or dumps, never schemas in the live database.
- Tests: an ops check in `advisors.test.ts` is not possible (harness databases are fresh); add a line to the deploy checklist: `select nspname from pg_namespace where nspname like 'bak\_%'` returns nothing.

**A8-08 (P2) There is no analytics store and no consumer; activation and the north star can only be computed by ad-hoc SQL, and three funnel steps have no event.**
- Evidence: `consume()` is never called by a service (§1.5). The only report is a CLI: `packages/db/src/retention-report.ts` → `repos.presence.retentionReport` (`repos/presence.ts:120`). `events` has no index led by `type` or `occurred_at` alone (`0011:246-254`: all indexes start with `business_id`), so cross-business queries scan the table (fine at 3.5k rows, not later). THESIS_REVIEW.md:547: "All of these need events declared in `packages/events`; none exists today" is now partly out of date.
- What exists for a planner: committed → `idea.committed` (+ `businesses.committed_at`); foundations → `foundations.progressed`, `product.signoff_decided`; page → `page.published` / `page.unpublished`; outcomes → `mail.sent`, `page.followed`, `payment.received`, `lead.replied` (`REAL_OUTCOME_EVENT_TYPES`, `packages/shared/src/morning-brief.ts:45`; simulated excluded by `isSimulatedEvent` :54-57); platform-recorded firsts → `milestones` rows with `ref.trophyKey`; return → `founder.session_started`, `founder_visit_days`; loop → `share.opened`, `visit.attributed`, `post.outcome_attributed`, `invitation.sent/accepted/declined`; account scope → `signup.attributed`, `referral.arrived`, `profile.published`.
- What is missing: (a) **sign-up**: no event; derive from `auth.users.created_at` and `account_admissions(how, created_at)`; (b) **profile done**: no event; `founder_profiles.created_at`; (c) **idea shaped**: no event; `ideas.created_at` / `idea_versions`; `idea_drafts` for signed-out cards; (d) a derived "first real outcome" fact; (e) a rollup table and a job that fills it.
- The north star today (weekly projects with at least one real outcome, demos, the house and simulated results excluded), mirroring `realOutcomes()` (`morning-brief.ts:86-128`):
```sql
with outcomes as (
  select e.business_id, date_trunc('week', e.occurred_at at time zone 'utc')::date as week, e.type
    from events e join businesses b on b.id = e.business_id
   where not b.is_demo and b.id <> 'f0f0f0f0-0000-4000-8000-00000000f00d'
     and e.occurred_at >= now() - interval '12 weeks'
     and not (e.actor->>'kind' = 'system' and e.actor->>'id' = 'simulate')
     and not (e.payload ? 'simulated' and e.payload->>'simulated' is distinct from 'false')
     and (   (e.type = 'page.published'   and e.actor->>'kind' = 'user')
          or (e.type = 'mail.sent'        and e.payload->>'simulated' = 'false')
          or (e.type = 'page.followed'    and e.actor->>'kind' = 'system' and e.actor->>'id' = 'public-page')
          or (e.type = 'payment.received' and e.actor->>'kind' = 'webhook')
          or (e.type = 'lead.replied'     and e.actor->>'kind' = 'webhook' and e.payload->>'sentiment' in ('positive','neutral')))
), people as (
  select business_id, count(*) as n from memberships
   where source <> 'example' and (expires_at is null or expires_at > now()) group by 1
)
select o.week,
       count(distinct o.business_id)                                   as projects_with_real_outcome,
       count(distinct o.business_id) filter (where p.n = 1)            as solo,
       count(distinct o.business_id) filter (where p.n >= 2)           as together,
       count(distinct o.business_id) filter (where exists (
         select 1 from founder_visit_days v where v.business_id = o.business_id and v.day >= o.week and v.day < o.week + 7)) as also_visited_that_week
  from outcomes o left join people p on p.business_id = o.business_id
 group by o.week order by o.week desc;
```
  Caveats: `page.published` is also written when a founder publishes changes to a live page (catalogue.ts:1773), so an edit counts as that week's outcome; a `mail.sent` on a mock connector is `simulated: true` and never counts; weeks are UTC.
- Fix: (1) declare account events `account.created` (written by the first admitted request: `services/access.ts:228` is the one place), `profile.completed` (`founder.profile.update` first save), `idea.shaped` (first `idea_versions` row) following the four steps in `packages/events/CLAUDE.md` (a migration redefining `fm_account_event_types()`); (2) add `project_week_facts(business_id, week, real_outcomes int, kinds text[], visited bool, people int)` filled nightly by an orchestrator schedule from the SQL above (service-only table: RLS on, no policy, revoke from anon/authenticated as 0088 does); (3) add `create index events_type_occurred_idx on events (type, occurred_at desc);` (4) either build the "metrics" consumer or delete the `consumers: ["metrics"]` annotations so the catalog does not promise one.
- Tests: `rls/account-events.test.ts` (list parity) for the new types; a repo test for the north star function with a demo, a simulated and a real business; the `new-event` skill's consumer test for each new type.

**A8-13 (P2) A person cannot delete or export their account, and a deleted auth user orphans their projects.**
- Evidence: deletion and export exist for a business only (`apps/api/src/services/lifecycle.ts:114` `exportBusiness`, :315 `requestDeletion` with re-auth and a 7-day delay, purge by the orchestrator through `fm_purge_business`). grep over `apps/api/src` finds no account deletion or account export procedure. `fm_memberships_keep_owner` (`0092:79-93`) deliberately lets the last owner's membership go when the `auth.users` row is being deleted, leaving a business with no members; nothing sweeps such businesses (grep "orphan": none). Person-level rows (`account_events`, `attributions`, `founder_visit_days`, …) cascade from `auth.users`, but Redis streams `ae:{userId}` need `deleteAccountStream` (`packages/events/src/outbox/account-relay.ts:249`), which no service calls (grep: only its own definition and a comment in `keys.ts:53`).
- Impact: GDPR/CCPA erasure and portability requests can only be met by hand in the Supabase dashboard, which silently strands project data.
- Fix: `founder.account.requestDeletion` / `cancelDeletion` / `export` mirroring the business flow (re-auth, 7 days, founder notice), refusing while the person is the only owner of a live project unless they choose "delete those projects too"; a nightly orchestrator sweep for businesses with zero unexpired memberships (archive, then purge after 30 days); call `deleteAccountStream` in the purge.
- Tests: cross-account test that the export contains only the caller's rows; a real-Postgres test that deleting `auth.users` leaves no row keyed by that user id in `public`.

**A8-14 (P2) No documented backup, restore or retention policy for the product database.**
- Evidence: docs/DEPLOY.md mentions backups only for Temporal's Railway Postgres (:122, :275). Nothing on Supabase PITR, restore drills, or retention of `events`, `audit_log`, `usage_ledger`, `agent_sessions`, outbox rows. Retention jobs that exist: Inbox `archiveSettled` (`apps/orchestrator/src/activities/cycle.ts:270`), workspace snapshot pruning (`repos/workspaces.ts`), idea box sweep 7/90 days (`apps/api/src/index.ts:232-237`), showcase sweep, Redis stream trims.
- Fix: write DEPLOY §4 "Backups and restore" (Supabase plan, PITR on or off, RPO/RTO, a restore drill into a branch project once before launch); correct DEPLOY.md:112 (A8-02); decide and record retention per table; add an orchestrator schedule that deletes `outbox` and `account_outbox` rows published more than 7 days ago (A8-25).

**A8-15 (P2) A failed migration does not stop the api.**
- Evidence: `apps/api/src/index.ts:77` "migrations failed; serving anyway (health reports db status)"; `/health` reports `db: true` (a `select 1`), not the schema version. New code then runs against the old schema.
- Fix: keep serving only when the failure is "database unreachable"; for a migration error exit 1 (Railway keeps the previous deployment because the healthcheck never passes). Add `schema: { applied, expected }` to `/health` and fail readiness when they differ.
- Tests: `migrate-on-boot.test.ts`: a journal with a failing statement makes `migrateOnBoot` call `exit(1)`.

**A8-17 (P2) `journey_daily_mv` is rebuilt for every business on any business's change.**
- Evidence: `refresh_journey_daily()` is `refresh materialized view concurrently journey_daily_mv` (`0007_journey.sql:172-176`; the matview itself was last redefined in `0041_widgets_modules.sql:48`); called debounced after journey and conversion writes (`apps/orchestrator/src/journey-refresh.ts`), nightly, after a time-zone change (`apps/api/src/routers/business.ts:141-157`: "450-850 ms" today) and after each demo roll.
- Impact: cost grows with total data, not with the business that changed; with real traffic the refresh becomes the largest recurring query.
- Fix: replace the matview with a table `journey_daily_rows` upserted per business and day range (`delete … where business_id = $1 and day >= $2; insert … select …`), keep the `journey_daily` view's shape and collaborator nulling (0107). Do it after launch unless A8-02's measurement says otherwise.

### P2 — security

**A8-09 (P2, SECURITY_REVIEW N4, wider than recorded) One secret signs twelve kinds of token across five services.**
- Evidence: `SESSION_TOKEN_SECRET` is read in 31 source files: gateway agent session tokens (`apps/gateway/src/tokens.ts`), the `svc: api` service token (`apps/api/src/services/gateway.ts`), Simulate tokens (`apps/api/src/services/simulate.ts`, `apps/ingest/src/simulate-token.ts`), collab tokens (`apps/collab/src/auth.ts`), one-click email answer and pause links (`packages/shared/src/email-links.ts`, `apps/api/src/routers/email.ts`), post-media signed URLs (`apps/api/src/services/post-media.ts`), OAuth install state (`apps/api/src/services/install-state.ts`), import job keys (`services/import.ts`), rate-limit HMAC keys for email addresses (`services/pages.ts`), quiz, milestones, idea box, post attribution. It is set on api, gateway, orchestrator, ingest and collab (docs/DEPLOY.md:59). Minimum length enforced is 16 characters (`apps/gateway/src/config.ts:47`) while DEPLOY asks for 32+ bytes.
- Impact: any one of those services (or a leaked env) can mint every other token, including the `svc: api` token that the gateway's vendor routes and the push route trust.
- Fix: three secrets by trust boundary: `GATEWAY_SESSION_SECRET` (orchestrator ↔ gateway), `SERVICE_TOKEN_SECRET` (api → gateway/ingest/collab), `LINK_SIGNING_SECRET` (api only: email links, media URLs, OAuth state, HMAC keys). Derive per-purpose keys with HKDF-SHA256 and the existing labels. Accept old and new for one deploy, then drop the old. Raise the minimum to 32.
- Tests: a token minted for one audience with one key is refused by every other verifier (table-driven across the five verifiers).

**A8-10 (P2) The vault's master key is an environment variable on four services.**
- Evidence: docs/DEPLOY.md:60: `DEV_MASTER_KEY` "identical on api, gateway, ingest … and orchestrator … it decrypts every stored credential (BYOK model keys, GitHub tokens)"; `KMS_KEY_ID` is the alternative "when an AWS KMS key exists". `createVault(env)` in `apps/api/src/context.ts:163-168`.
- Impact: one env leak on any of four services decrypts every founder's stored keys; there is no rotation path recorded. The name also says "DEV".
- Fix: move to KMS (or Supabase Vault) before taking real founders' keys at scale; until then document rotation (re-seal every `credentials` row under a new key) and remove the key from ingest unless a live webhook needs it.

**A8-11 (P2) The settings the security model rests on live only in dashboards.**
- Evidence: "Data API off" (DEPLOY.md:149), "Confirm email on", "anonymous sign-ins off", "phone provider off" (DEPLOY.md:150) are dashboard states; `supabase/config.toml` declares none of them. The api watches only `mailer_autoconfirm` (`apps/api/src/services/confirm-email.ts`). With the Data API on, SEC-8 (member-wide write policies), the `memberships_insert` first-owner bootstrap (`0092:58-62`: any signed-in user may insert an owner row for a business with no members) and `businesses_insert` (any id) become reachable from a browser.
- Fix: add to `supabase/config.toml` and push: `[api] enabled = false`, `[auth] enable_anonymous_sign_ins = false`, `[auth.email] enable_confirmations = true`, `[auth.sms] enable_signup = false` (check each key against the CLI version in use). Extend the api's 10-minute settings check to also probe `GET {SUPABASE_URL}/rest/v1/` with the anon key and log an error (and report on `/health`) when it answers anything but 503/404.
- Tests: unit test of the probe (stubbed fetch: 200 → error state; 503 → ok).

**A8-12 (P2) JWT verification exists three times and has drifted.**
- Evidence: `apps/api/src/auth.ts`, `apps/stream/src/auth.ts`, `apps/collab/src/auth.ts`. SECURITY_REVIEW (Nov 12, "Still open"): stream and collab admit a socket by the allow-listed email alone, without the confirmed-address rule, the "Confirm email" check or the password-session refusal.
- Fix: move `createAuthVerifier`, `emailConfirmedFromPayload`, `passwordOnlyFromPayload` to one module (`packages/shared/src/auth-verifier.ts` or a small `packages/auth`) and use it in all three; share the admission read (`repos.admissions.has`).
- Tests: one table-driven token suite imported by the three services (password-only refused, anonymous refused, `amr` rules, dev bypass only in development/test).

### P3

**A8-18 (P3) Six composite foreign keys have no index that covers both columns.** Each has an index on the first column, so cascades are already cheap; this only clears the advisor. Confirm the constraint names with the advisor's query, then:
```sql
create index account_outbox_event_user_idx        on account_outbox    (event_id, user_id);          -- account_outbox_event_fkey (0085:171)
create index agent_messages_thread_business_idx   on agent_messages    (thread_id, business_id);     -- agent_messages_thread_fkey (0020)
create index inbox_item_reads_item_business_idx   on inbox_item_reads  (inbox_item_id, business_id); -- inbox_item_reads_item_fkey (0048)
create index showcase_consents_item_business_idx  on showcase_consents (inbox_item_id, business_id); -- showcase_consents_inbox_item_fkey (0103)
drop index showcase_consents_inbox_item_id_idx;                                                       -- now redundant
create index team_call_actions_call_business_idx  on team_call_actions (call_id, business_id);       -- team_call_actions_call_fkey (0082)
create index team_call_turns_call_business_idx    on team_call_turns   (call_id, business_id);       -- team_call_turns_call_fkey (0082)
```
Mirror each in `packages/db/src/schema/*.ts` (`migrations.test.ts` compares). The migrator runs in one transaction, so no `concurrently`; the tables are small.

**A8-19 (P3) Ten tables with RLS on and no policy: intentional, documented in each migration.** `account_admissions` (`0091:143-147`), `account_outbox` (`0085:178-182`), `attributions` (`0088:49-53`), `credentials` (`0011:51-56`), `founder_cancel_links` (`0097:90-94`), `idea_drafts` and `waitlist_entries` (`0086:37-63`), `person_handle_releases` (`0080:121-125`), `persona_portraits` (`0067:30-35`), `retired_mail_local_parts` (`0078:69-73`): each revokes from `public, anon, authenticated` and grants to `service_role`. No SQL needed. Add a test that the set of "RLS on, zero policies" tables equals this list, so an eleventh by accident fails; optionally `comment on table … is 'service role only'`.

**A8-20 (P3) `pg_trgm` and `vector` live in `public`** (`0001_tenancy.sql:5-7`). Moving them (`alter extension … set schema extensions`) changes how every function with `search_path = public` and the PGlite harness resolve `gin_trgm_ops`, `%` and vector operators. Recommendation: accept and record in DECISIONS; do not move before launch.

**A8-21 (P3, SECURITY_REVIEW "still open") `public_profiles` is readable by anon and authenticated** (`0012_live_social.sql:16`; current definition `0092_people_roles.sql:98-110`: LIVE businesses' ids and names, and owners'/admins' **user ids** and display names). Every reader in code uses the service connection (`repos/social.ts`, `apps/social`). Fix: `revoke all on public_profiles from public, anon, authenticated; grant select on public_profiles to service_role;` and update any RLS test that reads it as a client.

**A8-22 (P3, new) ingest reads webhook and billing bodies without a size limit.** `apps/ingest/src/webhooks.ts:141` (`ctx.req.clone().text()`), `apps/ingest/src/billing.ts:67` (`req.text()`); only `/mail/*` has `bodyLimit` (`app.ts:92-93`). ingest is public. Fix: `app.use("/webhooks/*", tooLarge(1 MiB))` and the same for `BILLING_WEBHOOK_PATH`; GitHub deliveries can be far larger than Stripe's, so give `github` its own, explicit limit instead of none. Test: a 2 MB post answers 413 before verification.

**A8-23 (P3, new) The web treats a missing `NEXT_PUBLIC_APP_ENV` as development.** `apps/web/lib/env.ts:35-36`; `isDevLike()` (:75) then enables `/auth/dev` (`apps/web/app/auth/dev/route.ts:19`), which sets the dev cookie, and `getServerAuth` (`apps/web/lib/auth/server.ts:30-36`) treats the visitor as signed in with a `dev` bearer. The api refuses that bearer outside development/test, so no data is exposed, but the shell renders signed-in and the Simulate panel shows. Fix: when `process.env.NODE_ENV === "production"` and the variable is unset or invalid, default to `production`; fail the Vercel build without it.

**A8-24 (P3, SEC-9 residue) `APP_ENV=test` with `NODE_ENV=production` still honors the dev bypass.** `packages/shared/src/env.ts:273` allows it ("CI boots the built image"); `apps/api/src/auth.ts:218`, stream and collab honor `DEV_AUTH_USER_ID` there. The gateway already requires `NODE_ENV !== "production"` for its local path (`apps/gateway/src/config.ts:45`). Fix: apply the same condition to the three auth verifiers and log one warning line at boot whenever a dev bypass is active.

**A8-25 (P3) Published outbox rows are kept forever; `events` has no cross-business index.** Evidence §1.5; `outbox_unpublished_idx` keeps the relay cheap, so this is storage and vacuum only. Fix in A8-14 and A8-08.

**A8-26 (P3) Secret and dependency scans are advisory.** `.github/workflows/security.yml` (#138 "not required yet"; `pnpm audit || true` :67). `.gitleaks.toml` allow-lists whole path classes (`__tests__/`, `fixtures/`, `mock/`, `*.test.*`, `*.spec.ts`) and any line matching `env\.[A-Z][A-Z0-9_]+`: a real key pasted into a fixture passes. Fix: make gitleaks required; replace path allow-lists with an inventory of the invented values (by fingerprint) or at least keep `fixtures/` scanned for provider-shaped live prefixes (`sk_live_`, `ghp_`, `SG.`).

**A8-27 (P3) Small API surface notes.** `/health` is public and reports environment, modes, vault presence, model billing state and pool/gate numbers (`app.ts:189-234`): trim to `{ ok }` for unauthenticated callers. CORS always allows `http://localhost:3000` and `127.0.0.1:3000` with credentials (`app.ts:50`), also in production; `allowedOrigins` still reads `process.env.NEXT_PUBLIC_APP_URL` outside `loadEnv()` (`app.ts:51`, SEC-15). JWT `iss` is not checked (`auth.ts:237-245`); with JWKS the signature binds the project, with the legacy HS256 secret add `issuer: ${SUPABASE_URL}/auth/v1`. No general per-user request limit on `/trpc/*` (SEC-13 remainder): add one coarse Redis window per user (for example 600 requests a minute) in `protectedProcedure`.

**A8-28 (P3) Raw zod text reaches people.** A BAD_REQUEST message is `issueSummary` (`trpc.ts:90-93`: "path: zod message; …") and the web shows `err.message` (`apps/web/lib/trpc.ts:289`). Fix: map BAD_REQUEST without `appCode` to "Check the highlighted fields" plus field errors from `data.details`.

**A8-29 (P3) Export builds the whole archive in memory.** Up to 250,000 rows per table in one response (`services/lifecycle.ts:38-43`), read page by page but held until sent. Fine for today's real projects; stream it (NDJSON or zip) before large projects exist.

**A8-30 (P3) Dead weight.** `apps/social` (295 lines, not deployed, self-described skeleton; THESIS §11 asks to decide: remove it or make it the public-read service); `apps/collab` (built and tested, not deployed, web falls back); `SOCIAL_PORT`, `COLLAB_PORT` and the `Dockerfile` APP values for them; `network_attestations`; `policies` + `repos.policies` (SEC-19); `consume.ts` and the "metrics" annotations; `businesses.crest_url`. packages/shared: split is not urgent, but stop adding domain rules there: suggest `packages/shared` = infrastructure + contracts only, new `packages/domain` (rules) and `packages/copy` (words), moved file by file with the wildcard export kept as a shim.

**A8-32 (P3, check) 132 tables by the migrations, 131 in production.** Run `select tablename from pg_tables where schemaname = 'public' order by 1` and diff against §2; also `select count(*), max(created_at) from drizzle.__drizzle_migrations` (expect 96). A missing table means a migration did not fully apply (see A8-15).

---

## 4. Security findings: status as of `04a0a509`

"Doc" = docs/SECURITY_REVIEW.md says so; "seen" = I opened the cited code; "exists" = the fix's file is present but I did not re-read its logic (gateway and orchestrator are outside this area).

| ID | Title | Status | Evidence |
|---|---|---|---|
| SEC-1 | Gateway ignores agent/business state (kill switch advisory) | Fixed (doc, exists) | `apps/gateway/src/state.ts`; optional Redis revoke set and the orchestrator reacting to `agent-paused` still open |
| SEC-2 | Unauthenticated `/simulate/*` | Fixed (seen) | `apps/ingest/src/app.ts:130-145`, `simulate-token.ts`. Note: Simulate stays available to owners/admins where `APP_ENV=staging`, and DEPLOY.md:49 sets `APP_ENV=staging` on the Railway environment named `production`: **verify what the live services run with** |
| SEC-3 | Agent SDK on the orchestrator host with host env | Fixed (doc, exists) | `apps/orchestrator/src/activities/sdk-isolation.ts`; running the SDK inside the sandbox is the fuller fix |
| SEC-4 | Agent-supplied `amountMinor` | Fixed (doc) | `estimateCostMinor`, `policy-hardening.test.ts` |
| SEC-5 | Agent-supplied `kitMode` | Fixed (doc) | removed from `CallContextInput` |
| SEC-6 | Quarantined reader not wired | Fixed (doc, exists) | `apps/gateway/src/untrusted-reader.ts`, `recipients.ts`; the §9.8 injection eval was not re-run |
| SEC-7 | `member` changes caps, grants, approvals | Fixed (doc, exists) | `apps/api/src/services/approver.ts`, `staff-authority.test.ts` |
| SEC-8 | RLS write policies wider than the api's roles | **Open, accepted while the Data API is off** | `0001_tenancy.sql:86-91`; narrowed by 0087, 0094, 0095, 0099, 0107; depends on A8-11 |
| SEC-9 | `APP_ENV` fails open | Narrowed (seen) | `packages/shared/src/env.ts:273-281`, `apps/gateway/src/config.ts:45-47`; residue A8-24 (test + production), A8-23 (web) |
| SEC-10 | Webhook tenant binding | Fixed for per-business URLs (seen) | `apps/ingest/src/webhooks.ts:185-199` |
| SEC-11 | Vendor-scheme weaknesses | Fixed except Dropbox Sign's own scheme (doc) | confirm the request with the vendor before a contract is marked signed |
| SEC-12 | Stream token in query string | Fixed (doc, exists) | `apps/stream/src/protocol.ts` |
| SEC-13 | Rate limits | Narrowed (seen) | Redis windows on model, vendor and public procedures (`services/rate-limit.ts`, `model-limits.ts`); no general tRPC limit, no per-IP limit on ingest (A8-27, A8-22) |
| SEC-14 | api calls connectors directly | Fixed for the api (seen) | `apps/api/src/context.ts:170-176` (registry without secrets), `__tests__/gateway-double.ts` |
| SEC-15 | Log redaction, `process.env`, `approvals.args` | **Open in part** (seen) | `packages/shared/src/logger.ts:3-7` still one level deep; `apps/api/src/app.ts:51` reads `process.env`; `argsSummary` exists at `apps/gateway/src/pipeline.ts:260` (what is stored not re-read) |
| SEC-16 | SSRF | Fixed for what exists (seen) | `packages/connectors/src/connectors/web/page-fetch.ts`, `reader.ts:48-61` (public-only lookup pinned to the connection, every redirect hop); the api makes no user-supplied fetch (grep) |
| SEC-17 | Session-token revocation | **Open** | `apps/gateway/src/tokens.ts` mints a `jti` but keeps no deny-list; SEC-1's per-call state check is the mitigation |
| SEC-18 | Seed disables the audit trigger | Appears closed, not recorded | no `disable trigger` left in `packages/db/src/seed/` (grep); the purge path uses the transaction-local `fm.purge_business` setting (`0028_journey_runtime.sql:34-40`) |
| SEC-19 | Per-business policies unused | **Open** | `repos.policies` is called only by the seeds |
| N1 | Dropbox Sign substring match | Fixed (doc) | whole-id match |
| N2 | No per-business SendGrid/Stripe secrets | Fixed for the platform address; **open for a founder's own account** | DEPLOY keeps `sendgrid` out of ingest's `LIVE_CONNECTORS` |
| N3 | Stripe Connect account-to-business resolver | **Open** | a delivery with no business in the URL is refused |
| N4 | One `SESSION_TOKEN_SECRET` mints the `svc: api` token | **Open, wider than recorded** | A8-09 |
| Nov 11 | Email to a person; Follow form; person profiles | Fixed before merge (doc) | open: `public_profiles` grant (A8-21); existing display names not screened when a page with founders is published; Follow's per-visitor limit depends on a Vercel Firewall rule |
| Nov 12 | Google sign-in | Fixed (seen for the api) | `apps/api/src/auth.ts:174-212`; open: stream/collab rules (A8-12); re-auth through Google sends no `prompt=login` |
| #116 | Nov 13 audit (10 rows) | Fixed (doc) | "Supabase redirect wildcard": `supabase/config.toml` is narrowed (seen); **the dashboard step is still to confirm** |
| #129 | Quadratic regex in the untrusted-content scan | Fixed (doc) | |
| #131 | Collaborator reads of the event log | Fixed (seen) | `0099_events_collaborator_walls.sql`; P3 open: one field of a readable row cannot be hidden in the database |
| #132 | Collaborator Finance fields | Fixed (seen) | `0107_collaborator_finance_fields.sql:55-80`; three P3 open (agents' AI cost, free text quoting money, department metrics walls) |
| #133 | Next.js and dompurify advisories | Fixed (doc) | `pnpm-workspace.yaml:223-226` override |
| #139/#142 | zod memory exhaustion | Fixed (seen) | `apps/api/src/trpc.ts:76-93`, `__tests__/input-limits.test.ts` |
| A8-09 … A8-12, A8-22 … A8-27 | New in this audit | Open | §3 |

Checked and found sound (no finding):
- **Open redirects**: `safeNextPath` (`apps/web/lib/auth/redirects.ts:60-75`) is used by `/auth/callback` (`route.ts:42`) and `/auth/dev` (`route.ts:25`); it refuses `//`, backslashes, control characters, other origins and `/login`.
- **`/auth/dev`**: 404 unless `isDevLike()` (`apps/web/app/auth/dev/route.ts:19`); the api's bypass needs `APP_ENV` development or test (`apps/api/src/auth.ts:218`). Residues: A8-23, A8-24.
- **HTML from agents on public pages**: no HTML injection path. `react-markdown` with `skipHtml` (`packages/dugout/src/components/data/MarkdownEngine.tsx:17`); three `dangerouslySetInnerHTML` in all, a static script (`apps/web/app/layout.tsx:43`) and the generated avatar SVG with escaped inputs (`packages/dugout/src/components/foundation/Avatar.tsx:72-96,245`). dompurify is present only through monaco-editor (override 3.4.17).
- **Uploads served by the api**: portraits, call audio and post media are answered with `x-content-type-options: nosniff`, `content-security-policy: default-src 'none'; sandbox` and `cross-origin-resource-policy: same-site` (`apps/api/src/app.ts:253-298`); logo SVGs pass the shared sanitizer (`packages/shared/src/logo-svg.ts`, not reviewed line by line).
- **Webhook verification**: verify before parse, nonce after verify with release on refusal (`apps/ingest/src/nonce-store.ts:1-13`), mock webhooks refused outside development/test (`webhooks.ts:108-110`).

---

## 5. Interfaces a planner must know

**Database**
- `createDb(url, { max?, statementTimeoutMs?, … })`, `createServiceDb()`, `withRls(db, { userId, role?, claims? }, fn)`, `closeDb`, `warmPool`, `keepPoolWarm`, `rlsRoleOf` — `packages/db/src/client.ts`. Types `Db`, `DbTx`, `Executor = Db | DbTx` (`repos/_shared.ts:17`).
- `migrateDb(db, { lockTimeoutMs })` — `packages/db/src/migrator.ts`; applied by `apps/api/src/index.ts:59` at boot; other services only check readiness (`apps/*/src/db-boot.ts`).
- Repos: `import { repos } from "@foundmill/db"`; `repos.<area>.<fn>(db, businessId, …)`; lists take `PageInput` and return `Page<T>` (`{ items, nextCursor }`), `MAX_PAGE_SIZE` 500. Money is `{ amountMinor, currency }`.
- New business-scoped table, in one change: migration (`business_id uuid not null references businesses(id) on delete cascade`, `select fm_tenant_table('<t>'[, roles][, 'read_only'])`), the Drizzle mirror in `packages/db/src/schema/<area>.ts`, a row in `TENANT_TABLES` (`packages/db/src/__tests__/rls/tables.ts`: `{ name, table, write: "member"|"admin"|"service"|"append", sample }`) or its own `rls/<name>.test.ts`, and a line in `EXPORT_TABLES` or `EXPORT_EXCLUDED_TABLES` (`packages/db/src/repos/portability.ts`; `portability.test.ts` fails otherwise). If a collaborator must not read it: `is_member_not_collaborator` in the select policy and a case in `rls/people-roles.test.ts`.
- Service-only table pattern (copy 0088): `alter table t enable row level security; revoke all on t from public, anon, authenticated; grant select, insert, update, delete on t to service_role;` and add it to the A8-19 list.
- Service-only function rule (0087): `revoke execute … from public, anon, authenticated`, never from `public` alone. Every new function sets `search_path`.
- Migration file: `packages/db/migrations/NNNN_name.sql`, statements separated by `--> statement-breakpoint`, plus the journal entry (§1.2). Next on main: **0108, idx 96**. Fixtures insert by named columns so migration-point tests keep working.
- Cross-tenant test pattern: `const h = await createTestDb(); const A = await createBusinessFixture(h, "a"); const B = …; await h.asUser(A.ownerId).run((tx) => …)`; expect zero rows on reads of B and `RLS_DENIED` on writes. Real Postgres: `RLS_TEST_DATABASE_URL=postgres://… pnpm --filter @foundmill/db test:rls`.

**API**
- Router file `apps/api/src/routers/<area>.ts`, logic in `apps/api/src/services/<area>.ts`, merged in `apps/api/src/router.ts`. Helpers from `apps/api/src/trpc.ts`: `router`, `publicProcedure`, `protectedProcedure`, `signedInProcedure`, `businessProcedure`, `archivedBusinessProcedure`, `writeProcedure`, `adminProcedure`, `ownerProcedure`, `sectionRead(section)`, `sectionWrite(section)`, `sectionAdmin(section)`, `liveGate`, `Id`, `BusinessInput`, `audit`, `emit`, `QueuedResult`; `modelLimited(rule)` from `services/model-limits.ts`.
- A mutation's body: `ctx.rls(async (tx) => { …repos…; await audit(tx, ctx, {...}); await emit(tx, ctx, { type, payload }); })`. Context fields: `ctx.db` (service connection, gated per request), `ctx.rls`, `ctx.userId`, `ctx.email`, `ctx.businessId`, `ctx.business`, `ctx.membership`, `ctx.role`, `ctx.limits`, `ctx.models`, `ctx.gateway`, `ctx.temporal`, `ctx.env`, `ctx.log`, `ctx.requestId`, `ctx.clientAddress`.
- Errors: throw `AppError` subclasses from `@foundmill/shared` (`NotFoundError`, `ForbiddenError`, `ValidationError`, `ConflictError`, `TierLimitError`); the client reads `error.data.appCode` and `error.data.details`.
- Inputs: every list has `.max()`, every record goes through `boundedRecord` (`INPUT_LIMITS`); `input-limits.test.ts` enforces it.
- Tests: `apps/api/src/__tests__/harness.ts` gives `{ db, deps, limits, A, B, caller(user) }`; `caller({ userId }).inbox.list({ businessId })`.
- Background work started by a request and not awaited uses `ungated(ctx.db)` (`services/tx-gate.ts:161`).

**Events**
- New business event: the `new-event` skill; `EVENT_TYPES` (`packages/shared/src/constants.ts:446`), `declareEvent` in `packages/events/src/catalogue.ts`, fixture in `packages/events/src/testing/fixtures.ts`, a wall in `apps/stream/src/walls.ts`, and, if a collaborator may read it, the whole list again in a `create or replace function fm_collaborator_event_types()` migration. Write with `writeEvent(tx, …)` or `emit(tx, ctx, …)`.
- New account event: also `ACCOUNT_EVENT_TYPES` and a migration redefining `fm_account_event_types()`; write with `writeAccountEvent(tx, { userId, type, actor, payload, idempotencyKey? })`.
- Real outcomes for the north star: `REAL_OUTCOME_EVENT_TYPES`, `realOutcomes()`, `isSimulatedEvent()` in `packages/shared/src/morning-brief.ts:45-128`. Use them; do not re-derive.
- Stream keys: `ev:{businessId}`, `as:{sessionId}`, `u:{userId}`, `ae:{userId}` (`packages/events/src/keys.ts`).

**Flags that change what a builder may assume**
- `businesses.is_demo` and `memberships.source = 'example'` (sample businesses and their viewers); `HOUSE_BUSINESS_ID` (`packages/config/src/showcase.ts:13`).
- `LIVE_MODE` closes `live.*`; `INTEGRATIONS_MODE` / `LIVE_CONNECTORS`; `MODEL_MODE`; `SIGNUP_ALLOWLIST` / `SIGNUP_OPEN`; `SEED_ON_BOOT`; `DEMO_ROLL_FORWARD`; `API_DB_POOL_MAX`.

---

## 6. Tests and gaps

What exists: packages/db 38 RLS test files (one generated cross-tenant suite over `TENANT_TABLES`, 37 hand-written) + 12 migration-point tests + repo tests; apps/api 154 test files (notably `cross-tenant-refs`, `section-walls`, `input-limits`, `tx-gate`, `live-gate`, `people-races`, `staff-authority`, `google-signin-hardening`); packages/events 15; apps/stream 15 (walls, collaborator event types, token lifetime); apps/ingest 15 (webhooks, staging webhooks, platform mail, replay); apps/collab and apps/social have suites although neither is deployed. CI (`.github/workflows/ci.yml`): typecheck + lint, unit tests (`--concurrency=2`), Docker image build, Storybook build, three Playwright shards on a PGlite stack; `security.yml` (gitleaks, `pnpm audit`) is not required.

Gaps, in order of value:
1. **Real Postgres in CI** (A8-01): nothing proves grants, default privileges, postgres.js parameter handling or pooler behavior automatically.
2. **Advisor regression tests** (A8-03/04/05/19): none; add `rls/advisors.test.ts` with four assertions (no bare `auth.uid()` in policies; no permissive FOR ALL beside a SELECT policy outside the allow-list; every function has `search_path`; the "RLS on, no policy" set equals the known ten).
3. **Load** (A8-02): `apps/stream/src/__tests__/latency.test.ts` and `packages/db/src/__tests__/round-trips.test.ts` measure single calls; nothing measures concurrency or the gate under a realistic batch mix.
4. **Service-connection procedures** (A8-16): `section-walls.test.ts` is hand-listed; make it enumerate the router so a new procedure fails until classified. No suite runs `live.*` as a stranger.
5. **Demo isolation** (A8-06) and **north star** (A8-08): no test that a demo or simulated result contributes zero to an analytics query.
6. **Account lifecycle** (A8-13): no test for deleting an auth user (orphans, leftover rows, Redis stream).
7. **Migration failure at boot** (A8-15) and **body limits on ingest** (A8-22): untested paths.
8. **Token separation** (A8-09): no cross-audience refusal matrix.
9. The **e2e stack differs from production** in driver (PGlite), auth (dev bypass) and integrations (mock): there is no smoke against a staging stack with Supabase Auth and the pooler.

---

## 7. Surprises

1. **The api is also the scheduler.** Relays, hourly demo roll, three sweeps and the notify-email pass all run inside the one api process and share its pool of 10 (`apps/api/src/index.ts:194-248`). A second replica would double them.
2. **Nothing consumes events.** The catalog names a "metrics" consumer on about 78 declarations; no service runs a consumer group. Events are an audit trail and a browser feed, not yet an analytics source.
3. **CI has never run the production database engine**, although the repo ships a real-Postgres harness and has been bitten twice.
4. **The Railway environment called `production` is configured as `APP_ENV=staging`** in docs/DEPLOY.md:43-49, with `INTEGRATIONS_MODE=mock`. If the live product still runs that way, the Simulate panel is mounted for owners and admins and mock results are possible. Confirm on Railway.
5. **`railway.toml:2`: "Railway reads this file for existing services until 2026-12-01, when config-as-code stops being read."** Sixteen days from this audit; healthchecks, watch patterns, overlap and draining settings then need to live in the dashboard or the new mechanism (deploy auditor's area, flagged here because it gates every backend change in the plan).
6. **A hot trigger carries demo logic.** `fm_set_updated_at`, which fires on every update of every table, reads a setting and builds `to_jsonb(new)` to exempt the demo roll (`0074_demo_roll_forward.sql:31-41`); cheap when the setting is empty, but it is tenant-specific code on the hottest path.
7. **A vault key named `DEV_MASTER_KEY` is the production key** on four services (DEPLOY.md:60).
8. **0107's header says "The number is a placeholder"** (`0107_collaborator_finance_fields.sql:1-3`) and eleven migration numbers are unused: numbers are assigned across parallel branches by hand; the open-branch check in `packages/db/CLAUDE.md` is the only guard.
9. **`bak_20261013`** exists in production and nowhere in the repo, its docs or its history.
10. **The LIVE router (37 procedures, the largest by procedure count) bypasses RLS by design** and re-implements the policies in TypeScript, while the policies for the same tables exist and are tested in the database.
11. **Docs describe the wrong database for pool sizing** (DEPLOY.md:112 speaks of Railway Postgres `max_connections`; the product database is Supabase behind Supavisor).
12. **Three funnel words mean the project's customers, not Foundmill's users** (`signup.created`, `activation.reached`, `conversions`): a planner searching for sign-up analytics finds the wrong tables.
13. The web keeps a `/trophies` route only to redirect to `/milestones`; `HOUSE_BUSINESS_ID` is a fixed UUID baked into `packages/config`.
14. **The working tree changed while this audit ran, and not by this audit** (which wrote only to the scratchpad). `git status` was clean at the start; at the end it shows: `CLAUDE.md` modified (the "Never install or run an outside Claude Code skill … before reading every file of it" rule removed and a line added saying outside skills "are used freely (founder, 2026-11-15)"), `.claude/skills/vet-third-party-skill/SKILL.md` staged for deletion, about 30 new untracked skill directories under `.claude/skills/` with a `THIRD_PARTY_NOTICES.md`, and a new `docs/holistic-plan/`. This is uncommitted and relaxes a security rule of the repo, so the founder should confirm it is theirs before anything is committed; `.claude/skills/**` is also outside the gitleaks allow-list review of Nov 14 (A8-26). I did not open or run any of those skills.
