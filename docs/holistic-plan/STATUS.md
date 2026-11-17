# Status of the holistic plan

One row per task of docs/holistic-plan/WP-*.md, rebuilt on Nov 17, 2026 from the truth: the merged pull requests on main (to #274), the open pull requests, the package files' own ticks, and the docs/log entries. Update a row when its pull request opens and when it merges. An agent that takes over this work reads this file first.

States: **merged (#n)**, **pull request open (#n)**, **partly merged** (the Waits column says which part), **waiting** (on a founder decision, a setup step or another task), **superseded**, **not started** (no merged or open pull request, log entry or tick names it), **unknown** (the sources do not say; listed at the end). **Built, not pushed** is used only where a session reported it; a branch no one reported shows as not started. Setup steps (WP-00 S1 to S17) are done by a Desktop session or the founder, so their states come from the package file, the log and the coordinating session; nothing here was checked against production.

A package file's tick means a session built the task, not that it merged. WP-03 T5 is merged but not ticked in its package file; WP-03 T6 is ticked in the same change as this file.

## Founder decisions of Nov 16 and 17 that changed tasks

Recorded in docs/log/2026-11/ (find them with `node scripts/decisions-index.mjs <words>`).

- **Free users run on GLM-5.3 Flash; Anthropic models stay grayed; Foundmill never pays Anthropic for a free user** (Nov 16, `stage3-founder-decisions-2`, `-3`, `wp13-plan`). Created WP-13, supersedes WP-09 T15 (no fourth model key), moves WP-09 T4's model id into WP-13, and holds WP-09 T5, T8 and the model moves until WP-13 T2 (now merged). A top-up on the free plan buys GLM work only; the $600 monthly cap is WP-13 T6.
- **Pro checkout waits** until GLM works (Nov 16); then, on Nov 17, **sign-up stays invite-only on the free plan, and at opening the plan becomes $5 a month with $5.00 of credits** on Haiku 5.5 and GLM-5.3 Flash; Opus and Sonnet unlock with a credit pack of $20 or more; the "Built on Foundmill" mark stays on the $5 plan until a pack is bought; test users convert on the day of the switch (`wp09-paid-entry-plan`, `wp09-entry-plan-answers`, #273, #274). Changes WP-09 T13 and T16, WP-13 T7's copy, WP-00 S5 and S8, and `tierShowsBuiltOnMark`.
- **WP-04**: commit with no budget starts no cycle (D1); three agents shown (D2); one plan note (D3); the spend line starts at $0 (D4); streak hidden on day one and less prominent everywhere (D5, WP-04 T7); letters signed "The Foundmill team" from hey@foundmill.com (D6; T16) (Nov 16, `stage3-founder-decisions`).
- **WP-06**: the measuring run is later, on the batch route (T8 waits); measured ratings or "Not tested yet" replace the constants (T9); skills are readable in the product (T2, T7); an agent's attributes follow its setup (T11).
- **WP-09**: $5.00 a month kept; first session at most 30%, first week at most 70%; ceilings before commit $2.00 a day and $5.00 in 30 days; round 1 one session at a time under 75 cents (T11); overnight keeps $0.15 every third night (T12); live evals may spend $40; model moves route by route, only where the eval passes.
- **WP-03** (Nov 15, `wp03-founder-decisions`): index once sign-up opens, indexing follows `SIGNUP_OPEN`; training crawlers allowed on Foundmill's own pages and kept off `/p/` and `/u/`; the Terms sentence and date were approved on Nov 16 (WP-03 T6). **WP-05** (Nov 16, `wp05-founder-decisions`) D1 to D4. **WP-11** (Nov 16, `wp11-decisions`): the items accepted for now, with what reopens each.
- **One operator** (Nov 17, `foundmill-runs-on-foundmill`): only the founder's own account has operator privileges (`OPERATOR_USER_IDS`); the reports queue is #208 (WP-12 T4). The goal once the product works end to end is to run Foundmill itself on Foundmill; agents are onboarded from docs/log, the package guides and the skills.
- **CI** (Nov 16): the Actions budget was raised and the minutes rules are in CLAUDE.md; one push per pull request.
- **The behavior brief** (Nov 17, `wp14-behavior-brief`): created WP-14, with the founder's answers of the same afternoon. The entry plan is **Try**: free today, $5 a month from the day sign-up opens; plans are Try, Founder, Studio, Partner; the Founder price is tested at **$15 and $25**; "plans differ by agent work only" is dropped (CLAUDE.md changed); **a founder can always bring their own Anthropic key, on every plan**; Commit's defaults are a 5.00 spend cap and Autopilot off; time and where you live are known before take charge; the waitlist opens in batches with a places count, three named invitations with no reward, and an indexable waitlist page; "built for a big screen" is allowed copy. Amends WP-09 T13, T14 and T16, WP-13 T7 and T11, WP-10 T9 and T12, WP-02 T10, WP-03 T2, T6 and T10, WP-04 T1 and T2, and the network session's invitations. In the evening: people invited while sign-up is invite-only never pay the Founder fee (replaces #274's answer 4); plans limit companies, not people (Try 1, Founder up to 5, Studio any number, deleted ones not counted); Founder carries $10.00 and Studio $50.00 of budget and both reach Opus and Sonnet without a credit pack. On Try a credit pack of $20 or more still adds credits and unlocks Opus and Sonnet (#274 stands). Four never-list lines are in CLAUDE.md. Nothing is open with the founder.
- **WP-08 D1 to D6** (Nov 16) are recorded in pull request #244, which is open, so they are not on main yet.

## Production changes since Nov 15

All by the coordinating session on the founder's word (reported by that session, not checked here): `domains` (Nov 16) and `web` (Nov 17) added to `LIVE_CONNECTORS` on the gateway, api and orchestrator; `OPERATOR_USER_IDS` set on the api to the founder's one account (Nov 17); the `sites` service and its domain (WP-00 S9, above); `LIVE_MODE` is 1 on the api and stays so (founder, Nov 17).

## Other open pull requests

#217 (Network: one identity for a person and Find people, draft) belongs to the network session and is not a task of these packages.

| Package | Task | Name | State | Waits on |
| --- | --- | --- | --- | --- |
| WP-00 | S1 | Prove the front door works | done (Nov 17) | the founder's phone test passed |
| WP-00 | S2 | Confirm SendGrid's event webhook reaches ingest | done (Nov 17) | SendGrid's test deliveries answered 200 at /mail/events |
| WP-00 | S3 | Record what `LIVE_CONNECTORS` and `MODEL_MODE` are, per service | half done (Nov 15) | cloud half merged (#154: live connectors on /health); Desktop records the per-service values |
| WP-00 | S4 | Stop redeploying everything on every push | half done (Nov 15) | watch paths set (WP-01 T4, #145); "Wait for CI" on api and gateway is a dashboard toggle (founder); deadline Dec 1 |
| WP-00 | S5 | Open the door | waiting | Founder: on Nov 17 sign-up stays invite-only on the free plan; opening waits on the $5 entry plan (WP-09 T16), WP-09 T2 and WP-03 T8's switches |
| WP-00 | S6 | Real web research | waiting | Desktop; web search on every plan runs on Haiku 5.5 (WP-13 T5, #260), so this is the production switch |
| WP-00 | S7 | Indexing | waiting | cloud half merged (WP-03 T6, #245); Desktop runs the five curl checks, after sign-up opens (indexing follows SIGNUP_OPEN) |
| WP-00 | S8 | Payments | waiting | Founder, then Desktop; Pro checkout waits until GLM is working (Nov 16); the $5 entry plan needs it before opening (Nov 17) |
| WP-00 | S9 | A domain for Foundmill Sites | half done (Nov 16 to 17) | the Railway `sites` service is created, `*.foundmill.app` attached and verified, `sites_reader` has a login, and the service is healthy with SITES_DOMAIN unset; the founder decides and buys the rest, Desktop wires |
| WP-00 | S10 | Supabase settings | done (Nov 15) | redirect list narrowed to three; confirm-signup code merged (WP-03 T4, #195) |
| WP-00 | S11 | Skills in cloud sessions | done | optional founder step: plugins in the setup script |
| WP-00 | S12 | Watching production | waiting | cloud halves merged (WP-01 T2 #146, WP-02 T12 #168); Founder for accounts later |
| WP-00 | S13 | Spending backstops | waiting | Founder |
| WP-00 | S14 | Hosting plan | waiting | Founder decides |
| WP-00 | S15 | Mail reputation | waiting | Founder at Spaceship, later |
| WP-00 | S16 | Leftovers | waiting | Desktop, on the founder's go; the variable list is in docs/DEPLOY.md §3 (WP-11 T19) |
| WP-00 | S17 | Later, with the phone app | waiting | Desktop or Founder, with the phone app |
| WP-01 | T1 | Split the hour into parallel lanes | merged (#144) |  |
| WP-01 | T2 | A red main opens an issue; a nightly lane exists | merged (#146) | first real run unknown |
| WP-01 | T3 | Tests load a migrated database instead of replaying 96 migrations | merged (#150) |  |
| WP-01 | T4 | Watch paths per service, written out and proven | merged (#145) |  |
| WP-01 | T5 | Fewer web builds | merged (#151) |  |
| WP-01 | T6 | One small file per change; the two logs are frozen | merged (#155, #156) |  |
| WP-01 | T7 | Skipped and flaky tests are counted on every run | merged (#152) |  |
| WP-01 | T8 | The seven stale agent pull requests | partly merged | five pull requests closed (as decided), #52 merged; #38: unknown |
| WP-02 | T1 | An approval that expires says so | merged (#158) |  |
| WP-02 | T2 | The channel engine stops claiming launches on a real project | merged (#160) |  |
| WP-02 | T3 | Never ask the founder to approve a call that cannot run | merged (#161) |  |
| WP-02 | T4 | Remove fabricated results from real projects, and guard the generators | merged (#162) |  |
| WP-02 | T5 | The build path says what is true without a repository | merged (#163) |  |
| WP-02 | T6 | The first day says the page comes first; smaller untrue lines | merged (#164) |  |
| WP-02 | T7 | The Follow form is offered only when a confirmation can be sent | merged (#165) |  |
| WP-02 | T8 | One vocabulary in the shell | merged (#166) |  |
| WP-02 | T9 | Four funnel facts in the account event store | merged (#167) |  |
| WP-02 | T10 | Nightly numbers: funnel, north star, retention, agent work | merged (#173) |  |
| WP-02 | T11 | The cost report | merged (#169, #215) |  |
| WP-02 | T12 | One production record, and a script that checks it | merged (#168) |  |
| WP-02 | T13 | Say once when the team cannot do something | merged (#184) | closed by WP-05 T18 |
| WP-03 | T1 | The gate tells the truth at any width | merged (#194, #199) |  |
| WP-03 | T2 | A waitlist that admits and emails | merged (#198) | behind its switch; WP-00 S1 and S2 are done, so the email half can go on |
| WP-03 | T3 | The wall has exits | merged (#209) |  |
| WP-03 | T4 | The sign-in email carries a code for a new address | merged (#195) |  |
| WP-03 | T5 | The landing page, rewritten for a first-timer, desktop and phone | merged (#153, #157, #172, #182, #187) | the file is not ticked; follow-ups #204, #207, #228, #231, #249, #259, #262 |
| WP-03 | T6 | Findable by search engines and AI readers | merged (#182, #245) | the project pages in the sitemap wait for #244 |
| WP-03 | T7 | The idea box keeps its word under load | merged (#196, #199, #200) |  |
| WP-03 | T8 | The guards sign-up needs before it opens | merged (#210) | WP-09 T2 (#251 open), then WP-00 S5; the bot check's switches wait for the native app (D6) |
| WP-03 | T9 | The store-links value and its first readers | merged (#197, #199) |  |
| WP-03 | T10 | Order the waitlist by who brought whom | merged (#213) |  |
| WP-04 | T1 | Profile as three questions; the card keeps its thread | merged (#233) |  |
| WP-04 | T2 | Commit as name and go, at any width | not started |  |
| WP-04 | T3 | What commit starts on the free plan | merged (#226) |  |
| WP-04 | T4 | The starting team, as shown | not started |  |
| WP-04 | T5 | One plan note, one approval | merged (#239) |  |
| WP-04 | T6 | Check, publish and share the page on any screen | merged (#230) |  |
| WP-04 | T7 | One first-day story; guidance on Today | not started | carries "make the streak less prominent in general" (Nov 16) |
| WP-04 | T8 | Note budget and the day's digest | merged (#220) |  |
| WP-04 | T9 | The founder's own task and tomorrow's reason | not started |  |
| WP-04 | T10 | Chief of Staff as mentor, with founder context | merged (#232) |  |
| WP-04 | T11 | Lifecycle email for a started project | not started | a WP-00 step (see the package) |
| WP-04 | T12 | Email for a person with a card and no project | not started | a WP-00 step (see the package) |
| WP-04 | T13 | Single-key shortcuts off by default | merged (#223) |  |
| WP-04 | T14 | The one-click answer page on a phone | merged (#222) |  |
| WP-04 | T15 | A phone start without a card | not started |  |
| WP-04 | T16 | Win-back for the 11 stalled projects | not started | letters are signed "The Foundmill team" from hey@foundmill.com (Nov 16) |
| WP-05 | T0 | Read why sessions block, once, before building | unknown | a reading task; no pull request or log entry names it |
| WP-05 | T1 | An account-free mock connector is refused for a real project; search returns something to read | partly merged | steps 1 and 2 merged (#171); the rest unknown |
| WP-05 | T2 | A task that is not code is done only when the agent reported a result on real tools | merged (#175, #253) |  |
| WP-05 | T3 | Reports: the result of a task is saved, readable by the next agent and by the founder's note | merged (#186) |  |
| WP-05 | T4 | The brief says what the project is, and every session gets it | merged (#188) |  |
| WP-05 | T5 | The Planner sees the specification's text, the team it plans for, and whether code can land | merged (#177) |  |
| WP-05 | T6 | Outcome evals: a session with tools reaches a result, checked nightly | merged (#189, #193) |  |
| WP-05 | T7 | The founder can read the result | merged (#190) |  |
| WP-05 | T8 | A code task with nowhere to push still finishes, and says so | merged (#192) |  |
| WP-05 | T9 | A failing test goes back to the author, twice, before the session ends | merged (#201) |  |
| WP-05 | T10 | Reaching the turn limit is a checkpoint | merged (#202) |  |
| WP-05 | T11 | A resumed run knows what it already did | merged (#206) |  |
| WP-05 | T12 | The agent is told what is not connected; hopeless sessions do not start | merged (#214) |  |
| WP-05 | T13 | Lost sessions are closed and their tasks planned again | merged (#176) |  |
| WP-05 | T14 | The same outward call runs once per session | merged (#174) |  |
| WP-05 | T15 | A capped night gets one session it can afford | merged (#221) |  |
| WP-05 | T16 | A founder's "no" to a change has a next step | merged (#181) |  |
| WP-05 | T17 | A reviewer's "request changes" goes back to the author once | merged (#185) |  |
| WP-05 | T18 | A task the team cannot do is said once | merged (#184) |  |
| WP-06 | T1 | One resolver, so skills and the live version follow an agent into every call | merged (#224) |  |
| WP-06 | T2 | The library as Markdown with a generated catalog; the five bodies fixed | merged (#227) |  |
| WP-06 | T3 | The library type grows; the drafts move in | merged (#229) |  |
| WP-06 | T4 | Skill index, `selectSkills`, `read_skill`; new limits | pull request open (#255) | without session.ts |
| WP-06 | T5 | One hire implementation | merged (#216) |  |
| WP-06 | T6 | Default skills at hire, at commit and by backfill | not started | T3 (merged) |
| WP-06 | T7 | Picker data: suggestions, the body on request, availability | merged (#243) |  |
| WP-06 | T8 | Measure once on the platform: evidence and starting ratings | waiting | Founder: the measuring run waits for the key to be confirmed, later, on the batch route (Nov 16) |
| WP-06 | T9 | Hire writes measured ratings; adding a skill shows its evidence | waiting | T8 |
| WP-06 | T10 | The scoped per-agent check | not started |  |
| WP-06 | T11 | Make an edit live without a run | not started |  |
| WP-06 | T12 | Two honesty fixes in Recruitment and Training copy | merged (#247) |  |
| WP-07 | T1 | Specialists can record a supplier and an interaction | pull request open (#234) |  |
| WP-07 | T2 | Site tables, the switch and the events | merged (#240) | with T4 |
| WP-07 | T3 | A site session starts from the latest release and ends in a release | pull request open (#271) |  |
| WP-07 | T4 | `apps/sites`, the service that serves previews and live sites | merged (#240) |  |
| WP-07 | T5 | Screening, Publish, the Site tab and the note in Needs you | merged (#263) |  |
| WP-07 | T6 | The waitlist form | pull request open (#271) |  |
| WP-07 | T7 | The pay button, with a link the founder pastes | not started |  |
| WP-07 | T8 | `create_payment_link`, so the team can make the link | waiting | a WP-00 step (S8) |
| WP-07 | T9 | The Planner builds for a site; first builds; the demo task | pull request open (#271) |  |
| WP-07 | T10 | The proof: idea to published site to a sign-up in Customers | pull request open (#271) |  |
| WP-07 | T11 | A founder who has a repository can choose it without Builder view | merged (#236) |  |
| WP-07 | T12 | Show the previews a connected repository already has | not started |  |
| WP-08 | T1 | The positioning record, read by every marketing call | merged (#241, #261) |  |
| WP-08 | T2 | A reply to the project is kept and can be answered | merged (#267) | behind the mail switch; WP-00 S1 and S2 are done, so it can go on |
| WP-08 | T3 | Write to your followers | not started | a WP-00 step (see the package) |
| WP-08 | T4 | The first post, by tap, with a recorded outcome | not started |  |
| WP-08 | T5 | The first ten conversations | not started |  |
| WP-08 | T6 | A price, a pay or booking button and "Ask a question" on the page | not started | a WP-00 step (see the package) |
| WP-08 | T7 | The project page for search engines and AI readers | pull request open (#244) |  |
| WP-08 | T8 | Two page tools, so the SEO and GEO agents can work on the hosted page | not started | #241 is merged, so it can start |
| WP-08 | T9 | The Channel Board a real project sees | merged (#252) |  |
| WP-08 | T10 | No email without a basis, decided in policy | merged (#269) |  |
| WP-08 | T11 | Stop showing schedules that nothing runs | merged (#252) |  |
| WP-08 | T12 | Go-to-market evals, nightly | not started |  |
| WP-09 | T1 | The ledger says what happened, and the cost report can read it | pull request open (#251) | draft, with T2 |
| WP-09 | T2 | Calls before a business exists are booked and capped per account | pull request open (#251) | draft, with T1 |
| WP-09 | T3 | The gateway's model calls ask first and book the exact cost | merged (#225) |  |
| WP-09 | T4 | Haiku routes on `claude-haiku-5-5`, and a price table that is true | partly merged | the model id moved in WP-13 (#250); the price table and the suites: unknown |
| WP-09 | T5 | Refusals are handled once, and Opus and Sonnet calls fall back on the server | not started | WP-13 T2 (merged) |
| WP-09 | T6 | Effort is written down for every route, then lowered where a sweep holds | not started |  |
| WP-09 | T7 | Sessions are told their effort and their limits | not started |  |
| WP-09 | T8 | A batch client in `packages/models` | not started |  |
| WP-09 | T9 | Training says a true price, checks it against the balance, and grades for less | not started |  |
| WP-09 | T10 | Training tests on the batch path | not started |  |
| WP-09 | T11 | The first round of a free project fits the allowance | merged (#254) | the report sets the cap later |
| WP-09 | T12 | The overnight numbers come from the report | not started | D7 decided (every third night, keep $0.15) |
| WP-09 | T13 | Zero credits: what stopped, what still works, and a way on that works | not started | its sentences name the plan by a config value, never "free" (Nov 17) |
| WP-09 | T14 | Allowance and prices are config, and the numbers are the founder's | not started |  |
| WP-09 | T15 | Decision record: a fourth model key | superseded | by the free-plan-on-GLM rule (WP-13 plan, Nov 16) |
| WP-09 | T16 | A checkout for the Pro plan | waiting | Founder: becomes the $5 entry-plan subscription checkout, needed before sign-up opens (Nov 17); needs WP-00 S8 |
| WP-10 | T1 | Tabs and sidebar by stage | not started |  |
| WP-10 | T2 | Top bar by stage | not started |  |
| WP-10 | T3 | "Explain this page" wherever a first-timer lands | not started |  |
| WP-10 | T4 | Definitions for the first words | not started |  |
| WP-10 | T5 | Type, contrast and focus tokens | merged (#246, #268) | #268 fixes a regression |
| WP-10 | T6 | Amend DESIGN.md for the thesis | merged (#246) |  |
| WP-10 | T7 | Accessibility checked by a machine | pull request open (#265) | with T13 |
| WP-10 | T8 | The skills picker and an agent's skills panel: the look | not started |  |
| WP-10 | T9 | Ratings a first-timer can read | not started |  |
| WP-10 | T10 | The ask before the evidence | not started |  |
| WP-10 | T11 | Settings opens on five basics | not started |  |
| WP-10 | T12 | States that lose or hide information | not started |  |
| WP-10 | T13 | Today's bundle, dead code and a token scanner | pull request open (#265) | with T7 |
| WP-11 | T1 | Real Postgres in CI | merged (#147) |  |
| WP-11 | T2 | A failed migration fails readiness | merged (#148) |  |
| WP-11 | T3 | Backup and restore runbook | waiting | Founder decision or go-ahead |
| WP-11 | T4 | Advisor test, pinned service-only tables, `search_path` migration | pull request open (#238) | with T5 and T7 |
| WP-11 | T5 | Migration: `auth.uid()` once per statement | pull request open (#238) |  |
| WP-11 | T6 | Migration: split the `for all` write policies | not started |  |
| WP-11 | T7 | Migration: six foreign-key indexes | pull request open (#238) |  |
| WP-11 | T8 | `bak_20261013` and the production schema check | waiting | Founder decision or go-ahead |
| WP-11 | T9 | Demo data out of every cross-project number | not started |  |
| WP-11 | T10 | Measure the api under 100 Today loads | waiting | Founder decision or go-ahead |
| WP-11 | T11 | Gateway: who may mint what; a tool without hints is refused | merged (#242) |  |
| WP-11 | T12 | An api-only service token secret | merged (#256) |  |
| WP-11 | T13 | One JWT verifier for the api and the stream | merged (#242) |  |
| WP-11 | T14 | Supabase settings: declared and watched | merged (#248) |  |
| WP-11 | T15 | ingest: bounded webhook bodies; mail routes on `/health` | merged (#248) |  |
| WP-11 | T16 | Account export and closing, by request | pull request open (#264) | for the operator |
| WP-11 | T17 | The service connection: the rule as it is, and a pinned list | merged (#248) |  |
| WP-11 | T18 | The P3 items in one change | partly merged | steps 2 to 4 merged (#248); step 1: unknown |
| WP-11 | T19 | A dated decision for every item left open | merged (#256) |  |
| WP-11 | T20 | A founder's own Stripe: store the webhook signing secret | merged (#256) |  |
| WP-12 | T0 | The standing solo-guard test | pull request open (#235) |  |
| WP-12 | T1 | Draft a public page for every project committed before the feature | pull request open (#237) |  |
| WP-12 | T2 | An invited person lands in the project | pull request open (#235) |  |
| WP-12 | T3 | "Someone arrived through your page", privately | waiting | Founder decision or go-ahead |
| WP-12 | T4 | Report a person, a profile or a message; an operator queue | pull request open (#208) | built by the network session; migration 0129; the Nov 17 log entry asks for the operator-list test on it |
| WP-12 | T5 | People limits out of process memory | built, not pushed | built locally by the WP-12 session |
| WP-12 | T6 | The people layer flag, as a decision with its steps | waiting | Founder decision (D2) |
| WP-12 | T7 | Bring the mobile session's branch onto main and keep the pack true | waiting | Founder decision or go-ahead |
| WP-12 | T8 | The app prompt on public pages and the universal-link files | not started |  |
| WP-12 | T9 | The fate of `apps/social` | waiting | Founder decision or go-ahead |
| WP-13 | T1 | Probe Z.ai's Anthropic-compatible endpoint | merged (#250) | the SDK run moves into T4 |
| WP-13 | T2 | The GLM key, the provider seam and the guard | merged (#250) |  |
| WP-13 | T3 | Api, composer, gateway readers and the idea box choose by who pays | merged (#257) |  |
| WP-13 | T4 | Free projects' agent sessions run on GLM | merged (#284) | on Haiku 5.5 by default; `FREE_SESSION_MODEL=glm` is the founder's switch |
| WP-13 | T5 | Free web search through Z.ai's Web Search API | merged (#260) | on Haiku 5.5 instead of Z.ai (founder, Nov 16); production switch is WP-00 S6 |
| WP-13 | T6 | The $600 monthly cap, and slowing down at it | merged (#283) | the sessions' part is in T4 |
| WP-13 | T7 | The model dialog shows GLM, and Anthropic models offer an upgrade | not started | T2 (merged); at opening its copy says "buy a credit pack" (Nov 17) |
| WP-13 | T8 | Evals on GLM-5.3 Flash | partly merged | the session cost run (#283: $0.0068 a GLM session); the platform suites on Haiku 5.5 and GLM: not started |
| WP-13 | T9 | The privacy policy names Z.ai | merged (#260) | the DPA and SCCs are the founder's (Z3) |
| WP-13 | T11 | The api and composer use a founder's own Anthropic key | pull request open | the composer needs `COMPOSER_SERVICE_TOKEN_SECRET` (composer and gateway) and `GATEWAY_URL` on Railway |
| WP-13 | T10 | Switch it on | not started | T4 to T9, T11; setup Z2 |
| WP-14 | T1 | Resting, and the last task always finishes | not started | amends WP-09 T13: the session that takes T13 takes this; the own key stays offered; owner: the WP-09 session, as the next pull request after #251 (assigned Nov 17) |
| WP-14 | T2 | Quick fit before the ideas, sharpen after; time and where you live before take charge | not started | changes WP-04 T1's first profile |
| WP-14 | T3 | Team budget, outcomes first, on Billing | not started | WP-09 T1 and T2 (#251); owner: the WP-09 session, after T14 (assigned Nov 17) |
| WP-14 | T4 | Outcomes first on Today | pull request open | `claude/wp14-t4-outcomes-today`; the line says "real outcomes", not "approved" (see the log entry) |
| WP-14 | T5 | Show the work | not started |  |
| WP-14 | T6 | Named agents on by default for first-time founders | not started |  |
| WP-14 | T7 | One style for estimates, one legend | not started | amends WP-10 T9 and T12; changes docs/DESIGN.md §10; owner: the WP-10 session (assigned Nov 17) |
| WP-14 | T8 | The chapter report | not started |  |
| WP-14 | T9 | Share a Customer Update as a card | not started | #244 |
| WP-14 | T10 | The tour and landing copy | not started | the landing session (Desktop), told on Nov 17 |
| WP-14 | T11 | Commit's defaults and its credits line | not started | replaces WP-04 D4 and WP-09 D7 as defaults |
| WP-14 | T12 | Four measures | not started | amends WP-02 T10; two of the four need T1 and T9; owner: a new session, "WP-14 T12: four measures"; the two measures that need T1 and T9 follow them (assigned Nov 17) |
| WP-14 | T13 | The plan document | not started | docs only |
| WP-14 | T14 | Plans, prices, companies and what each plan includes | not started | amends WP-09 T14 and T16 and WP-13 T7's server check; owner: the WP-09 session, after #251 (assigned Nov 17) |
| WP-14 | T15 | The waitlist in batches, and invitations to give | not started | amends WP-03 T2, T6, T10 and WP-12; coordinate with the network session; owner: the landing idea-card session, with the network session told (assigned Nov 17) |

## Unknown, for the founder or the session that owns each

- WP-01 T2: whether the nightly lane has made its first real run. WP-01 T8: what became of #38.
- WP-05 T0 (the reading task) and the rest of WP-05 T1 after steps 1 and 2.
- WP-09 T4: whether the price table and Haiku suites were done beyond the model id.
- WP-11 T18 step 1.
- Any production change since Nov 15 beyond the list above.
