# Status of the holistic plan

One row per task of docs/holistic-plan/WP-*.md, rebuilt on Nov 19, 2026 from the truth: the merged pull requests on main (to #331), the open pull requests (#238, #244, #300, #303, #319, #330), the package files' own ticks, and the docs/log entries. Update a row when its pull request opens and when it merges. Only Session 1 of docs/holistic-plan/LAUNCH_EVALUATION.md edits this file; every other session tells it, or the founder, what changed. An agent that takes over this work reads this file first.

States: **merged (#n)**, **pull request open (#n)**, **partly merged** (the Waits column says which part), **waiting** (on a founder decision, a setup step or another task), **superseded**, **not started** (no merged or open pull request, log entry or tick names it), **unknown** (the sources do not say; listed at the end). **Built, not pushed** is used only where a session reported it; a branch no one reported shows as not started. Setup steps (WP-00 S1 to S17) are done by a Desktop session or the founder, so their states come from the package file, the log and the coordinating session; nothing here was checked against production.

A package file's tick means a session built the task, not that it merged. WP-03 T5 is merged but not ticked in its package file; WP-03 T6 is ticked in the same change as this file. Where this file and LAUNCH_EVALUATION.md differ on a row, this file was checked against main and the log: LAUNCH_EVALUATION.md lists WP-04 T2, T4, T7, T9 and T15 as not started, but they merged in #277.

## Founder decisions of Nov 16 and 17 that changed tasks

Recorded in docs/log/2026-11/ (find them with `node scripts/decisions-index.mjs <words>`).

- **Free users run on GLM-5.3 Flash; Anthropic models stay grayed; Foundmill never pays Anthropic for a free user** (Nov 16, `stage3-founder-decisions-2`, `-3`, `wp13-plan`). Created WP-13, supersedes WP-09 T15 (no fourth model key), moves WP-09 T4's model id into WP-13, and holds WP-09 T5, T8 and the model moves until WP-13 T2 (now merged). A top-up on the free plan buys GLM work only; the $600 monthly cap is WP-13 T6.
- **Pro checkout waits** until GLM works (Nov 16); then, on Nov 17, **sign-up stays invite-only on the free plan, and at opening the plan becomes $5 a month with $5.00 of credits** on Haiku 5.5 and GLM-5.3 Flash; Opus and Sonnet unlock with a credit pack of $20 or more; the "Built on Foundmill" mark stays on the $5 plan until a pack is bought; test users convert on the day of the switch (`wp09-paid-entry-plan`, `wp09-entry-plan-answers`, #273, #274). Changes WP-09 T13 and T16, WP-13 T7's copy, WP-00 S5 and S8, and `tierShowsBuiltOnMark`.
- **WP-04**: commit with no budget starts no cycle (D1); three agents shown (D2); one plan note (D3); the spend line starts at $0 (D4); streak hidden on day one and less prominent everywhere (D5, WP-04 T7); letters signed "The Foundmill team" from hey@foundmill.com (D6; T16) (Nov 16, `stage3-founder-decisions`).
- **WP-06**: the measuring run is later, on the batch route (T8 waits); measured ratings or "Not tested yet" replace the constants (T9); skills are readable in the product (T2, T7); an agent's attributes follow its setup (T11).
- **WP-09**: $5.00 a month kept; first session at most 30%, first week at most 70%; ceilings before commit $2.00 a day and $5.00 in 30 days; round 1 one session at a time under 75 cents (T11); overnight keeps $0.15 every third night (T12); live evals may spend $40; model moves route by route, only where the eval passes.
- **WP-03** (Nov 15, `wp03-founder-decisions`): index once sign-up opens, indexing follows `SIGNUP_OPEN`; training crawlers allowed on Foundmill's own pages and kept off `/p/` and `/u/`; the Terms sentence and date were approved on Nov 16 (WP-03 T6). **WP-05** (Nov 16, `wp05-founder-decisions`) D1 to D4. **WP-11** (Nov 16, `wp11-decisions`): the items accepted for now, with what reopens each.
- **One operator** (Nov 17, `foundmill-runs-on-foundmill`): only the founder's own account has operator privileges (`OPERATOR_USER_IDS`); the reports queue is #208 (WP-12 T4). The goal once the product works end to end is to run Foundmill itself on Foundmill; agents are onboarded from docs/log, the package guides and the skills.
- **CI** (Nov 16): the Actions budget was raised and the minutes rules are in FOUNDMILL.md; one push per pull request.
- **The behavior brief** (Nov 17, `wp14-behavior-brief`): created WP-14, with the founder's answers of the same afternoon. The entry plan is **Try**: free today, $5 a month from the day sign-up opens; plans are Try, Founder, Studio, Partner; the Founder price is tested at **$15 and $25**; "plans differ by agent work only" is dropped (FOUNDMILL.md changed); **a founder can always bring their own Anthropic key, on every plan**; Commit's defaults are a 5.00 spend cap and Autopilot off; time and where you live are known before take charge; the waitlist opens in batches with a places count, three named invitations with no reward, and an indexable waitlist page; "built for a big screen" is allowed copy. Amends WP-09 T13, T14 and T16, WP-13 T7 and T11, WP-10 T9 and T12, WP-02 T10, WP-03 T2, T6 and T10, WP-04 T1 and T2, and the network session's invitations. In the evening: people invited while sign-up is invite-only never pay the Founder fee (replaces #274's answer 4); plans limit companies, not people (Try 1, Founder up to 5, Studio any number, deleted ones not counted); Founder carries $10.00 and Studio $50.00 of budget and both reach Opus and Sonnet without a credit pack. On Try a credit pack of $20 or more still adds credits and unlocks Opus and Sonnet (#274 stands). Four never-list lines are in FOUNDMILL.md. Nothing is open with the founder.
- **Nov 18 and 19**: ponytail and caveman are required on every code change (`2026-11-18-claude-ponytail-caveman-skills`; #310, #311). The plan goes first for every model call and canceling is one press (`wp09-plan-first`, #325). A payment from a provider's test mode is never a real outcome (#328). CLAUDE.md was renamed FOUNDMILL.md, with SaaS tools through the vendor's MCP server (Gmail stays on its API) and CLI-Anything in the sandbox; the plan is docs/holistic-plan/LAUNCH_EVALUATION.md (#331, `foundmill-md-mcp-cli-hub`).
- **WP-08 D1 to D6** (Nov 16) are recorded in pull request #244, which is open, so they are not on main yet.

## Production changes since Nov 15

All by the coordinating session on the founder's word (reported by that session, not checked here): `domains` (Nov 16) and `web` (Nov 17) added to `LIVE_CONNECTORS` on the gateway, api and orchestrator; `OPERATOR_USER_IDS` set on the api to the founder's one account (Nov 17); the `sites` service and its domain (WP-00 S9, above); `LIVE_MODE` is 1 on the api and stays so (founder, Nov 17).

## Open pull requests and branches (Nov 19)

| Pull request | What | State |
| --- | --- | --- |
| #238 | WP-11 T4, T5, T7: the database advisors as tests | conflict fixed and migrations renumbered 0143 to 0145 on Nov 19, checks green; #244 also uses 0143, so whichever merges second renumbers when it rebases; the founder merges |
| #319 | "Round of work" wherever a person reads "cycle" | two tests that still said "cycle" fixed on Nov 19; the founder merges |
| #244 | WP-08 T7: the project page for search engines and AI readers | open, Session 5 |
| #300 (draft) | WP-14 T14: plans | open, Session 3 |
| #303 (draft) | WP-14 T9: share a Customer Update as a card | open, Session 5 |
| #330 | WP-09 T9: training says a true price | open, Session 4 |

Branches pushed with no pull request: `claude/wp14-t1-resting` (WP-14 T1) and `claude/wp14-t3-team-budget` (T3), both Session 3; `claude/wizardly-turing-skic24` (WP-14 T15), Session 7. `claude/landing-daylight` is not wanted: it landed as #218 and its three commits only restate it (Nov 19). #217 merged.

## The launch plan's sessions (docs/holistic-plan/LAUNCH_EVALUATION.md)

| Session | Work | Owns | State |
| --- | --- | --- | --- |
| 1 | Consolidate: #238, #319, STATUS | `docs/holistic-plan/STATUS.md` | this change (Nov 19) |
| 2 | Models: WP-09 T6, T7; WP-13 T7 | `packages/models/src/routing.ts` | wave 1, not started |
| 3 | Plans and money: #300, WP-14 T1, T3 | | wave 1, not started |
| 4 | Skills: #330, WP-06 T13, T11, T10 | | wave 1, not started |
| 4b | CLI-Anything in the sandbox: the E2B template, the connector with its mock, wrappers, staged outputs and approval, default skills for Design, Product and Marketing; an eval where a Design agent makes a logo file and the founder's approval puts it on the page | `infra/e2b/`, `packages/sandbox/` | wave 1, not started |
| 5 | Go-to-market: #244, #303, WP-08 T4, T5, T6, T8, T12 | | wave 1, not started |
| 5b | MCP in the gateway, starting with Notion; the Settings cleanup and Builder view's custom MCP field; then Gmail's scope split (send and compose first, read later) | `apps/gateway/src/pipeline.ts`, `apps/gateway/src/mcp.ts` | wave 1, not started |
| 6 to 8 | Wave 2: the console by stage (WP-10 T1 to T4, T10); waitlist and people (WP-14 T15); data (WP-11 T6, T9) | | not started |
| 9, 10 | Wave 3: the first shareable thing at 390 px; cards and the gallery | | not started |
| 11 | Wave 4: production, live keys, Google's verification, founder zero | | not started |

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
| WP-04 | T2 | Commit as name and go, at any width | merged (#277) |  |
| WP-04 | T3 | What commit starts on the free plan | merged (#226) |  |
| WP-04 | T4 | The starting team, as shown | merged (#277) |  |
| WP-04 | T5 | One plan note, one approval | merged (#239) |  |
| WP-04 | T6 | Check, publish and share the page on any screen | merged (#230) |  |
| WP-04 | T7 | One first-day story; guidance on Today | merged (#277) | carries "make the streak less prominent in general" (Nov 16); LAUNCH_EVALUATION.md still lists T2, T4, T7, T9, T15 as not started: it is stale on this |
| WP-04 | T8 | Note budget and the day's digest | merged (#220) |  |
| WP-04 | T9 | The founder's own task and tomorrow's reason | merged (#277) |  |
| WP-04 | T10 | Chief of Staff as mentor, with founder context | merged (#232) |  |
| WP-04 | T11 | Lifecycle email for a started project | merged (#282) | needs the WP-00 step in the package |
| WP-04 | T12 | Email for a person with a card and no project | merged (#282) | needs the WP-00 step in the package |
| WP-04 | T13 | Single-key shortcuts off by default | merged (#223) |  |
| WP-04 | T14 | The one-click answer page on a phone | merged (#222) |  |
| WP-04 | T15 | A phone start without a card | merged (#277) |  |
| WP-04 | T16 | Win-back for the 11 stalled projects | merged (#282) | letters are signed "The Foundmill team" from hey@foundmill.com (Nov 16) |
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
| WP-06 | T4 | Skill index, `selectSkills`, `read_skill`; new limits | merged (#255, #307) | #307 made live sessions use the index and `read_skill` |
| WP-06 | T5 | One hire implementation | merged (#216) |  |
| WP-06 | T6 | Default skills at hire, at commit and by backfill | merged (#327) |  |
| WP-06 | T7 | Picker data: suggestions, the body on request, availability | merged (#243) |  |
| WP-06 | T8 | Measure once on the platform: evidence and starting ratings | waiting | Founder: the measuring run waits for the key to be confirmed, later, on the batch route (Nov 16) |
| WP-06 | T9 | Hire writes measured ratings; adding a skill shows its evidence | waiting | T8 |
| WP-06 | T10 | The scoped per-agent check | not started |  |
| WP-06 | T11 | Make an edit live without a run | not started |  |
| WP-06 | T12 | Two honesty fixes in Recruitment and Training copy | merged (#247) |  |
| WP-06 | T13 | Coding agents start with Ponytail and Caveman | partly merged (#311, #310) | the rule and the two skills are merged; Session 4 checks what the product's own coding agents still lack |
| WP-07 | T1 | Specialists can record a supplier and an interaction | merged (#234) |  |
| WP-07 | T2 | Site tables, the switch and the events | merged (#240) | with T4 |
| WP-07 | T3 | A site session starts from the latest release and ends in a release | merged (#271) |  |
| WP-07 | T4 | `apps/sites`, the service that serves previews and live sites | merged (#240) |  |
| WP-07 | T5 | Screening, Publish, the Site tab and the note in Needs you | merged (#263) |  |
| WP-07 | T6 | The waitlist form | merged (#271) |  |
| WP-07 | T7 | The pay button, with a link the founder pastes | merged (#276) |  |
| WP-07 | T8 | `create_payment_link`, so the team can make the link | waiting | a WP-00 step (S8) |
| WP-07 | T9 | The Planner builds for a site; first builds; the demo task | merged (#271) |  |
| WP-07 | T10 | The proof: idea to published site to a sign-up in Customers | merged (#271) |  |
| WP-07 | T11 | A founder who has a repository can choose it without Builder view | merged (#236) |  |
| WP-07 | T12 | Show the previews a connected repository already has | not started |  |
| WP-08 | T1 | The positioning record, read by every marketing call | merged (#241, #261) |  |
| WP-08 | T2 | A reply to the project is kept and can be answered | merged (#267) | behind the mail switch; WP-00 S1 and S2 are done, so it can go on |
| WP-08 | T3 | Write to your followers | merged (#278) |  |
| WP-08 | T4 | The first post, by tap, with a recorded outcome | not started |  |
| WP-08 | T5 | The first ten conversations | not started |  |
| WP-08 | T6 | A price, a pay or booking button and "Ask a question" on the page | not started | a WP-00 step (see the package) |
| WP-08 | T7 | The project page for search engines and AI readers | pull request open (#244) | Session 5 |
| WP-08 | T8 | Two page tools, so the SEO and GEO agents can work on the hosted page | not started | #241 is merged, so it can start |
| WP-08 | T9 | The Channel Board a real project sees | merged (#252) |  |
| WP-08 | T10 | No email without a basis, decided in policy | merged (#269) |  |
| WP-08 | T11 | Stop showing schedules that nothing runs | merged (#252) |  |
| WP-08 | T12 | Go-to-market evals, nightly | not started |  |
| WP-09 | T1 | The ledger says what happened, and the cost report can read it | merged (#251) |  |
| WP-09 | T2 | Calls before a business exists are booked and capped per account | merged (#251) |  |
| WP-09 | T3 | The gateway's model calls ask first and book the exact cost | merged (#225) |  |
| WP-09 | T4 | Haiku routes on `claude-haiku-5-5`, and a price table that is true | merged (#322) | the price table and the batch suites; #326 is the hand-run workflow for the live checks |
| WP-09 | T5 | Refusals are handled once, and Opus and Sonnet calls fall back on the server | merged (#322) |  |
| WP-09 | T6 | Effort is written down for every route, then lowered where a sweep holds | not started | Session 2 |
| WP-09 | T7 | Sessions are told their effort and their limits | not started | Session 2 |
| WP-09 | T8 | A batch client in `packages/models` | merged (#322) |  |
| WP-09 | T9 | Training says a true price, checks it against the balance, and grades for less | pull request open (#330) | Session 4 |
| WP-09 | T10 | Training tests on the batch path | not started |  |
| WP-09 | T11 | The first round of a free project fits the allowance | merged (#254) | the report sets the cap later |
| WP-09 | T12 | The overnight numbers come from the report | merged (#251) | every third night, keep $0.15 |
| WP-09 | T13 | Zero credits: what stopped, what still works, and a way on that works | merged (#251) | with the markup of #320 |
| WP-09 | T14 | Allowance and prices are config, and the numbers are the founder's | merged (#251) | the numbers are the founder's |
| WP-09 | T15 | Decision record: a fourth model key | superseded | by the free-plan-on-GLM rule (WP-13 plan, Nov 16) |
| WP-09 | T16 | A checkout for the Pro plan | merged (#251, #325) | behind `PAID_ENTRY`; the plan goes first and canceling is one press (#325); production waits on WP-00 S8 |
| WP-10 | T1 | Tabs and sidebar by stage | not started |  |
| WP-10 | T2 | Top bar by stage | not started |  |
| WP-10 | T3 | "Explain this page" wherever a first-timer lands | not started |  |
| WP-10 | T4 | Definitions for the first words | not started |  |
| WP-10 | T5 | Type, contrast and focus tokens | merged (#246, #268) | #268 fixes a regression |
| WP-10 | T6 | Amend DESIGN.md for the thesis | merged (#246) |  |
| WP-10 | T7 | Accessibility checked by a machine | merged (#265) |  |
| WP-10 | T8 | The skills picker and an agent's skills panel: the look | merged (#316) |  |
| WP-10 | T9 | Ratings a first-timer can read | merged (#265) |  |
| WP-10 | T10 | The ask before the evidence | not started |  |
| WP-10 | T11 | Settings opens on five basics | merged (#265) |  |
| WP-10 | T12 | States that lose or hide information | merged (#265) |  |
| WP-10 | T13 | Today's bundle, dead code and a token scanner | merged (#265) |  |
| WP-11 | T1 | Real Postgres in CI | merged (#147) |  |
| WP-11 | T2 | A failed migration fails readiness | merged (#148) |  |
| WP-11 | T3 | Backup and restore runbook | waiting | Founder decision or go-ahead |
| WP-11 | T4 | Advisor test, pinned service-only tables, `search_path` migration | pull request open (#238) | with T5 and T7; the conflict is fixed and its migrations are renumbered 0143 to 0145 (Nov 19) |
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
| WP-11 | T16 | Account export and closing, by request | merged (#264, #308, #329) | #329 keeps a closed account's reports for the operator |
| WP-11 | T17 | The service connection: the rule as it is, and a pinned list | merged (#248) |  |
| WP-11 | T18 | The P3 items in one change | partly merged | steps 2 to 4 merged (#248); step 1: unknown |
| WP-11 | T19 | A dated decision for every item left open | merged (#256) |  |
| WP-11 | T20 | A founder's own Stripe: store the webhook signing secret | merged (#256) |  |
| WP-12 | T0 | The standing solo-guard test | merged (#235) |  |
| WP-12 | T1 | Draft a public page for every project committed before the feature | merged (#237) |  |
| WP-12 | T2 | An invited person lands in the project | merged (#235) |  |
| WP-12 | T3 | "Someone arrived through your page", privately | merged (#235) | Session 7 checks it against the plan's private arrival notice |
| WP-12 | T4 | Report a person, a profile or a message; an operator queue | merged (#208) | the operator-list test the Nov 17 log entry asked for: unknown |
| WP-12 | T5 | People limits out of process memory | merged (#312) |  |
| WP-12 | T6 | The people layer flag, as a decision with its steps | merged (#235) |  |
| WP-12 | T7 | Bring the mobile session's branch onto main and keep the pack true | merged (#294) |  |
| WP-12 | T8 | The app prompt on public pages and the universal-link files | merged (#235) | Session 7 checks the app banner |
| WP-12 | T9 | The fate of `apps/social` | merged (#235) | `apps/social` removed |
| WP-13 | T1 | Probe Z.ai's Anthropic-compatible endpoint | merged (#250) | the SDK run moves into T4 |
| WP-13 | T2 | The GLM key, the provider seam and the guard | merged (#250) |  |
| WP-13 | T3 | Api, composer, gateway readers and the idea box choose by who pays | merged (#257) |  |
| WP-13 | T4 | Free projects' agent sessions run on GLM | merged (#284, #314) | #314 took the free plan's readers, agents, notes and planners off Haiku 5.5 (it failed the injection bar) |
| WP-13 | T5 | Free web search through Z.ai's Web Search API | merged (#260) | on Haiku 5.5 instead of Z.ai (founder, Nov 16); production switch is WP-00 S6 |
| WP-13 | T6 | The $600 monthly cap, and slowing down at it | merged (#283) | the sessions' part is in T4 |
| WP-13 | T7 | The model dialog shows GLM, and Anthropic models offer an upgrade | not started | Session 2; at opening its copy says "buy a credit pack" (Nov 17) |
| WP-13 | T8 | Evals on GLM-5.3 Flash | merged (#298) | platform suites run as the free plan does (#298); the GLM session cost run (#283: $0.0068 a session); #314 followed the Haiku 5.5 result |
| WP-13 | T9 | The privacy policy names Z.ai | merged (#260) | the DPA and SCCs are the founder's (Z3) |
| WP-13 | T11 | The api and composer use a founder's own Anthropic key | merged (#286) | the composer needs `COMPOSER_SERVICE_TOKEN_SECRET` (composer and gateway) and `GATEWAY_URL` on Railway |
| WP-13 | T10 | Switch it on | not started | T4 to T9, T11; setup Z2 |
| WP-14 | T1 | Resting, and the last task always finishes | branch pushed, no pull request | `claude/wp14-t1-resting`; Session 3 lands it after T14 |
| WP-14 | T2 | Quick fit before the ideas, sharpen after; time and where you live before take charge | merged (#299) |  |
| WP-14 | T3 | Team budget, outcomes first, on Billing | branch pushed, no pull request | `claude/wp14-t3-team-budget`; Session 3 lands it after T1 |
| WP-14 | T4 | Outcomes first on Today | merged (#291) | the line says "real outcomes", not "approved" |
| WP-14 | T5 | Show the work | merged (#291) | effort is in "What your team did today" and the weekly review |
| WP-14 | T6 | Named agents on by default for first-time founders | merged (#305) |  |
| WP-14 | T7 | One style for estimates, one legend | merged (#302) |  |
| WP-14 | T8 | The chapter report | merged (#297) | a template over records, no model call |
| WP-14 | T9 | Share a Customer Update as a card | pull request open (#303, draft) | Session 5, after #244 |
| WP-14 | T10 | The tour and landing copy | merged (#304) |  |
| WP-14 | T11 | Commit's defaults and its credits line | merged (#301) |  |
| WP-14 | T12 | Four measures | merged (#296) | Resting and the shares read zero until T1, T14 and T9 write the events named in `PENDING_SOURCES` |
| WP-14 | T13 | The plan document | merged (#288) | docs only |
| WP-14 | T14 | Plans, prices, companies and what each plan includes | pull request open (#300, draft) | Session 3 finishes it first |
| WP-14 | T15 | The waitlist in batches, and invitations to give | branch pushed, no pull request | `claude/wizardly-turing-skic24`; its migration 0141 collides with main's `0141_skill_defaults.sql`; Session 7 renumbers and lands it |

## Unknown, for the founder or the session that owns each

- WP-01 T2: whether the nightly lane has made its first real run. WP-01 T8: what became of #38.
- WP-05 T0 (the reading task) and the rest of WP-05 T1 after steps 1 and 2.
- WP-09 T4: whether the price table and Haiku suites were done beyond the model id.
- WP-11 T18 step 1.
- Any production change since Nov 15 beyond the list above.
