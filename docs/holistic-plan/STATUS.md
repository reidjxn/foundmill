# Status of the holistic plan

One row per task of docs/holistic-plan/WP-*.md. Updated before a task starts and when its pull request opens. States: not started, in progress, pull request open (#n), merged, waiting. Until `claude/holistic-review-plan` merges into main, every task branch is stacked on it.

| Package | Task | Name | State | Waits on |
| --- | --- | --- | --- | --- |
| WP-00 | S1 | Prove the front door works | waiting | Desktop, read-only, then Founder for one test |
| WP-00 | S2 | Confirm SendGrid's event webhook reaches ingest | waiting | Founder in SendGrid, Desktop records |
| WP-00 | S3 | Record what `LIVE_CONNECTORS` and `MODEL_MODE` are, per service | waiting | Founder reads, Desktop records |
| WP-00 | S4 | Stop redeploying everything on every push | half done (Nov 15) | watch paths set; Wait for CI on api and gateway is a dashboard toggle (founder) |
| WP-00 | S5 | Open the door | waiting | Founder decides, Desktop switches |
| WP-00 | S6 | Real web research | waiting | Desktop |
| WP-00 | S7 | Indexing | waiting | cloud half is WP-03 T6; then Desktop and Founder |
| WP-00 | S8 | Payments | waiting | Founder, then Desktop |
| WP-00 | S9 | A domain for Foundmill Sites | waiting | Founder decides and buys, Desktop wires |
| WP-00 | S10 | Supabase settings | done (Nov 15) | redirect list narrowed to three; confirm-signup code is WP-03 T4 |
| WP-00 | S11 | Skills in cloud sessions | done (in the plan branch) | optional founder step: plugins in the setup script |
| WP-00 | S12 | Watching production | waiting | cloud half is WP-01 T2 and WP-02 T12; then Founder |
| WP-00 | S13 | Spending backstops | waiting | Founder |
| WP-00 | S14 | Hosting plan | waiting | Founder decides |
| WP-00 | S15 | Mail reputation | waiting | Founder at Spaceship, later |
| WP-00 | S16 | Leftovers | waiting | Desktop, on the founder's go |
| WP-00 | S17 | Later, with the phone app | waiting | Desktop or Founder |
| WP-01 | T1 | Split the hour into parallel lanes | merged (#144) | |
| WP-01 | T2 | A red main opens an issue; a nightly lane exists | pull request open (#146) | founder merge; first real run after merge |
| WP-01 | T3 | Tests load a migrated database instead of replaying 96 migrations | pull request open (#150) | founder merge; step 5 (fewer unit shards) after CI numbers |
| WP-01 | T4 | Watch paths per service, written out and proven | pull request open (#145) | founder merge; then WP-00 S4 |
| WP-01 | T5 | Fewer web builds | pull request open (stacked on #144) | founder merge; WP-01 founder decision 4 (no agent previews) |
| WP-01 | T6 | One small file per change; the two logs are frozen | pull request open | the banners (#155) first |
| WP-01 | T7 | Skipped and flaky tests are counted on every run | not started |  |
| WP-01 | T8 | The seven stale agent pull requests | in progress | five closed; #52 and #38 updating; branch deletion is the founder's |
| WP-02 | T1 | An approval that expires says so | not started |  |
| WP-02 | T2 | The channel engine stops claiming launches on a real project | not started |  |
| WP-02 | T3 | Never ask the founder to approve a call that cannot run | not started |  |
| WP-02 | T4 | Remove fabricated results from real projects, and guard the generators | not started | founder decision or go-ahead (see the package) |
| WP-02 | T5 | The build path says what is true without a repository | not started |  |
| WP-02 | T6 | The first day says the page comes first; smaller untrue lines | not started |  |
| WP-02 | T7 | The Follow form is offered only when a confirmation can be sent | not started |  |
| WP-02 | T8 | One vocabulary in the shell | not started |  |
| WP-02 | T9 | Four funnel facts in the account event store | not started |  |
| WP-02 | T10 | Nightly numbers: funnel, north star, retention, agent work | not started |  |
| WP-02 | T11 | The cost report | not started |  |
| WP-02 | T12 | One production record, and a script that checks it | not started |  |
| WP-02 | T13 | Say once when the team cannot do something | not started | founder decision or go-ahead (see the package) |
| WP-03 | T1 | The gate tells the truth at any width | not started |  |
| WP-03 | T2 | A waitlist that admits and emails | not started |  |
| WP-03 | T3 | The wall has exits | not started |  |
| WP-03 | T4 | The sign-in email carries a code for a new address | not started |  |
| WP-03 | T5 | The landing page, rewritten for a first-timer, desktop and phone | not started |  |
| WP-03 | T6 | Findable by search engines and AI readers | not started |  |
| WP-03 | T7 | The idea box keeps its word under load | not started |  |
| WP-03 | T8 | The guards sign-up needs before it opens | not started |  |
| WP-03 | T9 | The store-links value and its first readers | not started |  |
| WP-03 | T10 | Order the waitlist by who brought whom | not started |  |
| WP-04 | T1 | Profile as three questions; the card keeps its thread | not started |  |
| WP-04 | T2 | Commit as name and go, at any width | not started |  |
| WP-04 | T3 | What commit starts on the free plan | not started |  |
| WP-04 | T4 | The starting team, as shown | not started |  |
| WP-04 | T5 | One plan note, one approval | not started |  |
| WP-04 | T6 | Check, publish and share the page on any screen | not started |  |
| WP-04 | T7 | One first-day story; guidance on Today | not started |  |
| WP-04 | T8 | Note budget and the day's digest | not started |  |
| WP-04 | T9 | The founder's own task and tomorrow's reason | not started |  |
| WP-04 | T10 | Chief of Staff as mentor, with founder context | not started |  |
| WP-04 | T11 | Lifecycle email for a started project | not started | a WP-00 step (see the package) |
| WP-04 | T12 | Email for a person with a card and no project | not started | a WP-00 step (see the package) |
| WP-04 | T13 | Single-key shortcuts off by default | not started |  |
| WP-04 | T14 | The one-click answer page on a phone | not started |  |
| WP-04 | T15 | A phone start without a card | not started |  |
| WP-04 | T16 | Win-back for the 11 stalled projects | not started | founder decision or go-ahead (see the package) |
| WP-05 | T0 | Read why sessions block, once, before building | not started |  |
| WP-05 | T1 | An account-free mock connector is refused for a real project; search returns something to read | not started |  |
| WP-05 | T2 | A task that is not code is done only when the agent reported a result on real tools | not started |  |
| WP-05 | T3 | Reports: the result of a task is saved, readable by the next agent and by the founder's note | not started |  |
| WP-05 | T4 | The brief says what the project is, and every session gets it | not started |  |
| WP-05 | T5 | The Planner sees the specification's text, the team it plans for, and whether code can land | not started |  |
| WP-05 | T6 | Outcome evals: a session with tools reaches a result, checked nightly | not started |  |
| WP-05 | T7 | The founder can read the result | not started |  |
| WP-05 | T8 | A code task with nowhere to push still finishes, and says so | not started | founder decision or go-ahead (see the package) |
| WP-05 | T9 | A failing test goes back to the author, twice, before the session ends | not started |  |
| WP-05 | T10 | Reaching the turn limit is a checkpoint | not started |  |
| WP-05 | T11 | A resumed run knows what it already did | not started |  |
| WP-05 | T12 | The agent is told what is not connected; hopeless sessions do not start | not started |  |
| WP-05 | T13 | Lost sessions are closed and their tasks planned again | not started |  |
| WP-05 | T14 | The same outward call runs once per session | not started |  |
| WP-05 | T15 | A capped night gets one session it can afford | not started |  |
| WP-05 | T16 | A founder's "no" to a change has a next step | not started |  |
| WP-05 | T17 | A reviewer's "request changes" goes back to the author once | not started | founder decision or go-ahead (see the package) |
| WP-05 | T18 | A task the team cannot do is said once | not started | founder decision or go-ahead (see the package) |
| WP-06 | T1 | One resolver, so skills and the live version follow an agent into every call | not started |  |
| WP-06 | T2 | The library as Markdown with a generated catalog; the five bodies fixed | not started |  |
| WP-06 | T3 | The library type grows; the drafts move in | not started |  |
| WP-06 | T4 | Skill index, `selectSkills`, `read_skill`; new limits | not started |  |
| WP-06 | T5 | One hire implementation | not started |  |
| WP-06 | T6 | Default skills at hire, at commit and by backfill | not started |  |
| WP-06 | T7 | Picker data: suggestions, the body on request, availability | not started |  |
| WP-06 | T8 | Measure once on the platform: evidence and starting ratings | not started | founder decision or go-ahead (see the package) |
| WP-06 | T9 | Hire writes measured ratings; adding a skill shows its evidence | not started |  |
| WP-06 | T10 | The scoped per-agent check | not started |  |
| WP-06 | T11 | Make an edit live without a run | not started |  |
| WP-06 | T12 | Two honesty fixes in Recruitment and Training copy | not started |  |
| WP-07 | T1 | Specialists can record a supplier and an interaction | not started |  |
| WP-07 | T2 | Site tables, the switch and the events | not started | founder decision or go-ahead (see the package) |
| WP-07 | T3 | A site session starts from the latest release and ends in a release | not started | founder decision or go-ahead (see the package) |
| WP-07 | T4 | `apps/sites`, the service that serves previews and live sites | not started | founder decision or go-ahead (see the package) |
| WP-07 | T5 | Screening, Publish, the Site tab and the note in Needs you | not started | founder decision or go-ahead (see the package) |
| WP-07 | T6 | The waitlist form | not started | founder decision or go-ahead (see the package) |
| WP-07 | T7 | The pay button, with a link the founder pastes | not started | founder decision or go-ahead (see the package) |
| WP-07 | T8 | `create_payment_link`, so the team can make the link | not started | a WP-00 step (see the package) |
| WP-07 | T9 | The Planner builds for a site; first builds; the demo task | not started | founder decision or go-ahead (see the package) |
| WP-07 | T10 | The proof: idea to published site to a sign-up in Customers | not started |  |
| WP-07 | T11 | A founder who has a repository can choose it without Builder view | not started |  |
| WP-07 | T12 | Show the previews a connected repository already has | not started |  |
| WP-08 | T1 | The positioning record, read by every marketing call | not started |  |
| WP-08 | T2 | A reply to the project is kept and can be answered | not started | a WP-00 step (see the package) |
| WP-08 | T3 | Write to your followers | not started | a WP-00 step (see the package) |
| WP-08 | T4 | The first post, by tap, with a recorded outcome | not started |  |
| WP-08 | T5 | The first ten conversations | not started |  |
| WP-08 | T6 | A price, a pay or booking button and "Ask a question" on the page | not started | a WP-00 step (see the package) |
| WP-08 | T7 | The project page for search engines and AI readers | not started |  |
| WP-08 | T8 | Two page tools, so the SEO and GEO agents can work on the hosted page | not started |  |
| WP-08 | T9 | The Channel Board a real project sees | not started |  |
| WP-08 | T10 | No email without a basis, decided in policy | not started |  |
| WP-08 | T11 | Stop showing schedules that nothing runs | not started |  |
| WP-08 | T12 | Go-to-market evals, nightly | not started |  |
| WP-09 | T1 | The ledger says what happened, and the cost report can read it | not started |  |
| WP-09 | T2 | Calls before a business exists are booked and capped per account | not started |  |
| WP-09 | T3 | The gateway's model calls ask first and book the exact cost | not started |  |
| WP-09 | T4 | Haiku routes on `claude-haiku-5-5`, and a price table that is true | not started |  |
| WP-09 | T5 | Refusals are handled once, and Opus and Sonnet calls fall back on the server | not started |  |
| WP-09 | T6 | Effort is written down for every route, then lowered where a sweep holds | not started |  |
| WP-09 | T7 | Sessions are told their effort and their limits | not started |  |
| WP-09 | T8 | A batch client in `packages/models` | not started |  |
| WP-09 | T9 | Training says a true price, checks it against the balance, and grades for less | not started |  |
| WP-09 | T10 | Training tests on the batch path | not started |  |
| WP-09 | T11 | The first round of a free project fits the allowance | not started | founder decision or go-ahead (see the package) |
| WP-09 | T12 | The overnight numbers come from the report | not started | founder decision or go-ahead (see the package) |
| WP-09 | T13 | Zero credits: what stopped, what still works, and a way on that works | not started | a WP-00 step (see the package) |
| WP-09 | T14 | Allowance and prices are config, and the numbers are the founder's | not started |  |
| WP-09 | T15 | Decision record: a fourth model key | not started |  |
| WP-09 | T16 | A checkout for the Pro plan | not started | founder decision or go-ahead (see the package) |
| WP-10 | T1 | Tabs and sidebar by stage | not started |  |
| WP-10 | T2 | Top bar by stage | not started |  |
| WP-10 | T3 | "Explain this page" wherever a first-timer lands | not started |  |
| WP-10 | T4 | Definitions for the first words | not started |  |
| WP-10 | T5 | Type, contrast and focus tokens | not started |  |
| WP-10 | T6 | Amend DESIGN.md for the thesis | not started |  |
| WP-10 | T7 | Accessibility checked by a machine | not started |  |
| WP-10 | T8 | The skills picker and an agent's skills panel: the look | not started |  |
| WP-10 | T9 | Ratings a first-timer can read | not started |  |
| WP-10 | T10 | The ask before the evidence | not started |  |
| WP-10 | T11 | Settings opens on five basics | not started |  |
| WP-10 | T12 | States that lose or hide information | not started |  |
| WP-10 | T13 | Today's bundle, dead code and a token scanner | not started |  |
| WP-11 | T1 | Real Postgres in CI | pull request open (#147) | founder merge; then F1 |
| WP-11 | T2 | A failed migration fails readiness | pull request open (#148) | founder merge |
| WP-11 | T3 | Backup and restore runbook | not started | founder decision or go-ahead (see the package) |
| WP-11 | T4 | Advisor test, pinned service-only tables, `search_path` migration | not started |  |
| WP-11 | T5 | Migration: `auth.uid()` once per statement | not started |  |
| WP-11 | T6 | Migration: split the `for all` write policies | not started |  |
| WP-11 | T7 | Migration: six foreign-key indexes | not started |  |
| WP-11 | T8 | `bak_20261013` and the production schema check | not started | founder decision or go-ahead (see the package) |
| WP-11 | T9 | Demo data out of every cross-project number | not started |  |
| WP-11 | T10 | Measure the api under 100 Today loads | not started | founder decision or go-ahead (see the package) |
| WP-11 | T11 | Gateway: who may mint what; a tool without hints is refused | not started |  |
| WP-11 | T12 | An api-only service token secret | not started |  |
| WP-11 | T13 | One JWT verifier for the api and the stream | not started |  |
| WP-11 | T14 | Supabase settings: declared and watched | not started |  |
| WP-11 | T15 | ingest: bounded webhook bodies; mail routes on `/health` | not started |  |
| WP-11 | T16 | Account export and closing, by request | not started | founder decision or go-ahead (see the package) |
| WP-11 | T17 | The service connection: the rule as it is, and a pinned list | not started |  |
| WP-11 | T18 | The P3 items in one change | not started |  |
| WP-11 | T19 | A dated decision for every item left open | not started |  |
| WP-11 | T20 | A founder's own Stripe: store the webhook signing secret | not started |  |
| WP-12 | T0 | The standing solo-guard test | not started |  |
| WP-12 | T1 | Draft a public page for every project committed before the feature | not started |  |
| WP-12 | T2 | An invited person lands in the project | not started |  |
| WP-12 | T3 | "Someone arrived through your page", privately | not started | founder decision or go-ahead (see the package) |
| WP-12 | T4 | Report a person, a profile or a message; an operator queue | not started | founder decision or go-ahead (see the package) |
| WP-12 | T5 | People limits out of process memory | not started |  |
| WP-12 | T6 | The people layer flag, as a decision with its steps | not started | founder decision or go-ahead (see the package) |
| WP-12 | T7 | Bring the mobile session's branch onto main and keep the pack true | not started | founder decision or go-ahead (see the package) |
| WP-12 | T8 | The app prompt on public pages and the universal-link files | not started |  |
| WP-12 | T9 | The fate of `apps/social` | not started | founder decision or go-ahead (see the package) |
| WP-13 | T1 | Probe Z.ai's Anthropic-compatible endpoint | done except the SDK run (Nov 16) | the SDK run moves into T4 |
| WP-13 | T2 | The GLM key, the provider seam and the guard | pull request open (#250) | auto-merge on; CI waiting on Actions billing |
| WP-13 | T3 | Api, composer, gateway readers and the idea box choose by who pays | built locally | pushed after #250 merges |
| WP-13 | T4 | Free projects' agent sessions run on GLM | not started | T2; a word from the plan-execution session on `session.ts` |
| WP-13 | T5 | Free web search through Z.ai's Web Search API | not started | T2 |
| WP-13 | T6 | The $600 monthly cap, and slowing down at it | not started | T3 |
| WP-13 | T7 | The model dialog shows GLM, and Anthropic models offer an upgrade | not started | T2 |
| WP-13 | T8 | Evals on GLM-5.3 Flash | not started | T3, T4 |
| WP-13 | T9 | The privacy policy names Z.ai | pull request open | the DPA and SCCs are the founder's (Z3) |
| WP-13 | T11 | The api and composer use a founder's own Anthropic key | not started | T3 |
| WP-13 | T10 | Switch it on | not started | T3 to T9, T11; setup Z2 |
