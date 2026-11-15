# A4. Building a product with the agents, end to end

Audit of `main` at `04a0a509` (2026-11-15). Read-only. Every claim cites `file:line` in `/Users/reidjackson/code/founder-manager`. "Verified" means read in the code as it is now; "Inference" means deduced from code that was not run (nothing was built, tested or executed). Production configuration is taken from `docs/DEPLOY.md` and `docs/PROGRESS.md`; no environment was inspected.

Short answer to the brief: the product-definition half is real and good (a page, a vision, a specification and a roadmap drafted by live models, signed off by the founder). The build half is real only for a founder who already has a private GitHub repository with commits and a CI workflow, and who turns Builder view on. For the target user (no GitHub, no code) a code task writes files into a per-task save in Postgres that nobody else can see, can never be marked done, and blocks every task that depends on it. THESIS package 1.7 is not started. The only thing a customer can open is still `/p/<slug>`.

---

## 1. How it works today

### 1.0 Common to all three kinds: day one, the product-definition path

**Commit.** `idea.commit` creates everything in one transaction (`apps/api/src/services/commit.ts:1-23`): the business, the departments and agents of the archetype, the empty specification blocks from `specOutline`, the `business_foundations` row (`pending`), the archetype's first-cycle tasks, the welcome note. It then starts the first `businessCycle`. Archetype seeds: `packages/agents/src/archetypes.ts` (software `BASE_OUTLINE` 10 sections at `:110`; physical `PHYSICAL_OUTLINE` 15 sections at `:111`; services 12 sections at `:640`).

**First open: the foundations.** `product.foundations.ensure` (`apps/api/src/routers/product.ts:75`) claims the row once and starts the Temporal workflow `businessFoundations` (`foundations:{businessId}:{attempt}`), or runs the same drafting in the api when Temporal does not answer (`apps/api/src/services/foundations.ts:9-12`). Order, in `apps/orchestrator/src/workflows/businessFoundations.ts`:

| Step | Activity (line) | Author | Route (`packages/models/src/routing.ts`) | Output |
| --- | --- | --- | --- | --- |
| 0 | `draftProjectPage` (`:96-101`) | Product lead | `projectPage`: Sonnet, low effort (`:200`) | `project_pages` draft and the note "Your project's page is ready"; falls back to a starter draft with no model |
| 1 | `draftFoundationsPlan` (`:104-109`) | Product lead | `foundationsSkeleton`: Opus, low effort, fast (`:172`), max 6,000 tokens (`foundations-staged.ts:62`) | the full vision (statement, for whom, problem, why now, principles, north star), one thesis per section, roadmap titles |
| 2 | `draftFoundationsSections` × up to 6 in parallel (`:112`, `chunkSections` `foundations-staged.ts:75`) | Product lead | `foundations`: Opus, low, fast (`:170`), 2,500 tokens per section | each section 80 to 250 words (`packages/agents/src/prompts/foundations.ts:74`) |
| 2 | `draftFoundationsRoadmap` (in parallel) | Product lead | same, max 8,000 tokens | 6 to 20 items, 2 to 5 in Now (`prompts/foundations.ts:75`) |
| 3 | `applyFoundations` (`:121`) | - | no model | writes blocks, roadmap, two `product_signoffs` rounds and two decision notes (`foundationsSignoffNotes`, `packages/agents/src/foundations.ts:773-798`) |
| 4 | `secondReadDocument` (`:124-130`) | a different agent | `documentReview`: Opus (`:163`) | at most two rounds, web fact-check "where the `web` connector answers"; one Inbox note and one revision task (`apps/orchestrator/src/activities/second-read.ts:10-15`) |

Then, outside the workflow:
- **Research plan**: `product.research.ensure` (Home and the Research tab call it once foundations are ready) drafts in the api process with one `worker`-route call (Sonnet) and no web access: `product_research` row plus `research_artifacts` drafts (interview plan, interview script, smoke test, survey, demo script), up to 4 first research tasks and one note (`apps/api/src/services/product-research.ts:1-16, 30-38`).
- **Goal**: `goal.ensure` proposes the first goal with no model call, but only after both sign-offs and one finished round of work (`apps/api/src/services/goals.ts:5-12`).
- **Build start**: the second sign-off calls `startBuilding` (`apps/api/src/services/signoff.ts:302-330`): one Planner call (Opus, `planner` route) for each of the first 2 Now items (`LIMITS.signoffPlanRoadmapItems`, `packages/config/src/limits.ts:49`), then `startCycle` as Continue does.

**Cost (Estimate, computed from the code's own caps and price list, not measured).** Price list `packages/models/src/pricing.ts:36-47` (Opus fast: 8 USD in, 40 USD out per million tokens). Output ceiling for the foundations: 6k + 6×7k + 10k ≈ 58k tokens ≈ 2.30 USD worst case; a typical 10-section draft at 15k to 25k output tokens is about 0.60 to 1.00 USD, plus the page (Sonnet), the second read (up to two Opus calls), the research plan (Sonnet) and two Planner calls (Opus). So roughly 1.50 to 4 USD before any agent session runs. The Free tier grants 5 USD of credits a month (`packages/config/src/pricing.ts:19`), and a task without its own budget may spend up to 20 USD (`DEFAULT_TASK_RESERVE_MINOR = 2_000`, `apps/orchestrator/src/cycle-contract.ts:66`), bounded by the credits left (`session-budget.ts:1-20`). See finding A4-15.

**What a first-timer has to read and decide on day one.**

| Item | Size | Decision |
| --- | --- | --- |
| Welcome note (Chief of Staff) | short | none |
| "Your project's page is ready" | pitch ≤ 140 characters, about ≤ 1,500 characters, for whom ≤ 300 (`packages/shared/src/types.ts:265-290`) | publish (owner or admin, their own press; no agent tool: `apps/api/src/services/pages.ts:12-14`) |
| "Sign off the product specification" | note ≤ 180 words; the document is 10 sections × 80-250 words = 800 to 2,500 words (software), 12 sections for a service, 15 sections = 1,200 to 3,750 words for a physical product | Approve, or Request changes in own words (`product.signoff.decide`, `routers/product.ts:97`) |
| "Sign off the product roadmap" | note ≤ 180 words; 6 to 20 items with descriptions and acceptance criteria | Approve or Request changes |
| Second-read note | a list of issues | none required |
| Research plan note | five draft artifacts on Product › Research | none required |
| After both approvals: "Building starts: N tasks planned" | short | none; later "Your first goal" |

At 200 words a minute that is about 10 to 20 minutes of reading for software and 15 to 30 for a physical product, and three decisions (publish, approve, approve). The two sign-offs gate the build: nothing is planned until both are approved (`signoff.ts:230`). Vocabulary in those notes that a first-timer has not met: "specification", "blocks", "pinned", "Planner", "Now/Next/Later", "north star", "the engineers pick them up in the next cycle" (`foundations.ts:782, 791`).

**Editing afterwards.**
- Specification: `product.spec.editBlock`, `spec.versions`, `spec.compare`, `spec.publish`, `spec.restore` (`routers/product.ts:140-186`). The editor is Tiptap over Yjs through `apps/collab` (Hocuspocus) when `NEXT_PUBLIC_COLLAB_URL` is set, otherwise `PlainBlockEditor` (`packages/modules/src/product/SpecificationScreen.tsx:1-6`, `spec/PlainBlockEditor.tsx`). DEPLOY lists collab as optional and "no collab service in staging" (`docs/DEPLOY.md:43, 249`), so production is probably on the plain editor (not confirmed).
- A block the founder edits is pinned; agents then propose instead of overwrite. Approving the specification publishes a numbered `spec_versions` row (`signoff.ts:185-194`); publishing while a round is sent back reopens the sign-off (`reopenSpecSignoffAfterPublish`).
- Roadmap: `product.roadmap.upsert/move/link` (`routers/product.ts:188-229`), board and timeline in `packages/modules/src/product/roadmap/*`. No agent tool changes the roadmap (`roadmap.update` is in `packages/agents/src/templates/PLANNED_GRANTS.md`).
- Request changes creates a research task "Revise the specification from your notes" for the Product lead at priority 10 and starts it at once (`signoff.ts:206-221, 236-250`).

**How a change proposal appears.** Only the Product lead holds `spec.propose` (`packages/agents/src/templates/leads/product_lead.ts:48`); it calls the platform tool `propose_spec_change({ specBlockId, title, rationale, text })` (`packages/connectors/src/connectors/platform/tools.ts:193-198`), which writes `change_proposals` + `proposal_hunks` (`packages/db/src/schema/product.ts:54, 119`). The founder sees it on Product › Changes and decides per hunk (`product.proposals.decideHunk/acceptAll/reject`, `routers/product.ts:285-312`). The Source Watcher (`sourceWatch` workflow) is the other producer.

**Is web research real?** The code is real: `search_web` calls Anthropic's server web search on the platform key and `fetch_page` reads public pages with SSRF guards (`packages/connectors/src/connectors/web/index.ts:1-12, 108-125`). Whether it runs in production is configuration: `web` follows `INTEGRATIONS_MODE` (`docs/DECISIONS.md:1555`), production is documented as `INTEGRATIONS_MODE=mock` with `LIVE_CONNECTORS=github,domains` (`docs/PROGRESS.md:1251, 1253`; `docs/DEPLOY.md:271`), and THESIS status on Nov 11 lists 1.4 as "Next ... a configuration step" (`docs/THESIS_REVIEW.md:395`). In mock mode `search_web` returns `https://example.com/<slug>/1 "(result 1, mock)"` (`web/mock.ts:33-37`); the gateway now marks every mock result `simulated: true` with a notice (`apps/gateway/src/pipeline.ts:923`). Because `web` has `auth.kind: "none"`, the "not connected" refusal for real businesses (`pipeline.ts:757-759`) does not apply to it: a real project's research agent gets a simulated result, not a refusal. The research plan itself never touches the web.

### 1.1 "I have an idea for an app" (software)

Archetypes `b2b_saas`, consumer, marketplace. Team includes `CODING_CORE` = planner, backend, frontend, QA, review agent, integration agent (`archetypes.ts:68`). First-cycle tasks are not code: answer the specification's open questions (Product lead), a runway forecast (Finance lead), where to incorporate (Legal lead) (`archetypes.ts:201-208`). Each is a non-code session whose whole deliverable is a `complete_task` summary of at most 4,000 characters (`platform/tools.ts:98`).

After both sign-offs the Planner writes code tasks. It is given only `{ goal, roadmap_item, spec_sections: [titles] }` (`apps/api/src/services/task-graph.ts:55-63`; the cycle's own planning is identical, `apps/orchestrator/src/activities/roadmap-plan.ts:61-68`). It does not see the specification text, whether a repository exists, or any stack.

**Case (a): no GitHub, no code (the target user).** Step by step for one code task:
1. Dispatch starts `agentSession` (`session:{sessionId}`); `prepareSession` resolves grants and the model (`apps/orchestrator/src/activities/session.ts:762-798`).
2. `runLiveSession` creates a private directory under `ORCHESTRATOR_WORKSPACE_DIR` on the orchestrator host (`:1455`). `checkoutRepository` answers `{ status: "none", reason: "no repository is chosen on the Code tab" }` (`activities/checkout.ts:174`) and the session note says "this session starts from the code saved on this task only" (`checkout.ts:533-534`). `restoreWorkspace(db, businessId, task.id, …)` is keyed by task (`session.ts:1491`): a second task never sees the first task's files.
3. The agent is told, wrongly for this case, that "the platform saves your changes and pushes them to your branch ... runs the repository's CI and opens the pull request" (`codeTaskNote`, `session.ts:2020-2026`).
4. The agent has `Read, Glob, Grep, Edit, Write` and its MCP tools; no shell (`sdk-isolation.ts:42-44, 114-123`).
5. At the end the acceptance command runs in E2B. With no checkout and prose-only criteria it is `pnpm -r --workspace-concurrency=1 run --if-present test` (`session.ts:2761-2779`).
6. `keepWorkspace` saves the files into `workspace_snapshots`/`workspace_blobs`; `pushWorkspace` returns `skipped: "connect GitHub and choose a repository on the Code tab"` (`workspace-push.ts:132`).
7. `finishSession` puts a finished code task in `review`, never `done` (`session.ts:970-977`). `mergeReview.prepareMerge` returns `skipped: "no repository is chosen on the Code tab"` (`activities/merge.ts:253-254`) and the cycle sweep `pendingMerges` returns nothing without a push-enabled repository (`merge.ts:212-213`).
8. Nothing else ever sets `done`: the only writers are `merge.ts:184` and `:267` (both after a repository lookup) and the gateway's `complete_task`, which sends code to `review` (`apps/gateway/src/platform-host.ts:184`). `repos.tasks.dispatchable` requires every dependency to be `done` (`packages/db/src/repos/tasks.ts:365-378`).

Result: the first layer of the task graph runs, each task ends "in review", and every task that depends on one of them waits forever. "Ready to start selling?" is offered only when all tasks of a roadmap item are `done` (`session.ts:1106-1110`), so it never comes either.

What the founder sees instead (Builder view off): Product › "What changed" lists the task under "Waiting for your go-ahead" with the footer "Nothing goes live until you say so" (`packages/modules/src/development/founder-views.tsx:172-186`) and no decision ever arrives; "Live product" says "No release recorded yet" and "Each change gets its own preview to try before it goes live" (`:270-275`); the panel "What exists now" says "Nothing exists outside these screens yet ... Connect GitHub in Settings › Integrations to keep the code" (`development/shared.tsx:275-282`). The saved files are visible only on Development › Code, which is a Builder-view tab (`packages/shared/src/constants.ts:82-83`).

**THESIS 1.7 (platform-owned repository and hosted preview): not started.** No code creates a repository, no hosting, no preview: `grep -rniE 'platform-owned|create_repo|createRepository|hosted preview'` over `apps` and `packages` finds nothing relevant, and the "Nothing exists outside these screens yet" string is still the product's answer. The founder decided "yes, after pages and email are proven" (`docs/DECISIONS.md:3484-3502`, item 5).

**Case (b): the founder connects GitHub.**
1. Settings › Integrations › GitHub › Connect: the api signs a state for this founder and business (`apps/api/src/services/install-state.ts:26-30`, 15 minutes), GitHub sends the founder to `apps/web/app/integrations/github/callback/route.ts` with `installation_id`, `code`, `state`; that route only redirects to `/b/<id>/settings/integrations?...` (`:27-40`). "Connect installation" calls `integrations.connect`, which hands `{ installationId, code }` to the gateway (`apps/api/src/routers/integrations.ts:99-111`); the gateway trades the code for a user token and accepts the installation only if that user owns the account or is an active org admin (`packages/connectors/src/connectors/github/index.ts:153-176`), recording `app_installations`.
2. App permissions (`docs/DEPLOY.md:196`): contents write, pull requests write, actions write, checks read, metadata read, members read; webhooks inactive.
3. Development › Code ("Set up GitHub"): `dev.code.setRepository({ repository, pushEnabled })` (`apps/api/src/routers/dev.ts:302-329`). The repository must be reachable by the installation and private, and its numeric id is pinned (`apps/api/src/services/code-repository.ts:30-50`). `pushEnabled` defaults to false (`dev.ts:304`). This is the only place the repository can be chosen (`packages/modules/src/development/CodeScreen.tsx:227`) and the tab is Builder-view only.
4. Session: `download_archive` checkout of the task's branch or the default branch (`checkout.ts:172-206`; limits 8,000 files, 300 MB, 60 MB archive, `:49`); the agent edits files; mid-session it may also `commit_files` to `agent/<taskId>` (engineers hold `pulls.create`).
5. Guards: `commit_files` and `run_checks` accept only `agent/…` branches (`AGENT_BRANCH`, `github/tools.ts:92`) of private repositories and never `.git` or `.github` (`:96-103`); the gateway re-checks the repository and the push switch and appends `[skip ci]` (`guardGithubWrite`, `apps/gateway/src/pipeline.ts:170-180`).
6. End of session: acceptance run in E2B on a copy of the checkout plus changes; save; push (`workspace-push.ts`, rebuild on the default branch when needed, `:87`).
7. `mergeReview` (`workflows/mergeReview.ts`): open or find the pull request, `run_checks` (dispatches `.github/workflows/ci.yml`, refused if `.github` differs from the default branch), assess, bring a behind branch up to date (`update_branch`), second read of the diff by a different agent (`secondReadMerge`), then `askMerge`: the gateway types it `merge_to_main` (`pipeline.ts:696`), always the founder's decision (`docs/DECISIONS.md:2959`). After yes: wait for checks up to 90 minutes, `merge_pr`, retries, hand-back or hold with an Inbox update.
8. After the merge: `finishMerged` sets the task `done` and writes `pr.merged`. Nothing deploys. No production code writes `deploy.succeeded` (grep: only readers in `dev.ts:378`, `area-words.ts:96`, the two screens and the catalogue), the GitHub webhook normaliser handles only merged pull requests (`github/webhooks.ts:65-93`) and the App's webhooks are off. A deploy happens only if the founder's own repository is wired to a host (Foundmill's own is: Vercel builds every agent branch, see §6).

### 1.2 "I want to sell a physical product"

Archetype `dtc_physical` (`archetypes.ts:428-486`): an Operations department with eight specialists (sourcing, formulation, regulatory, certification, packaging, quality, logistics, costing), plus a small development team and six channels. Specification outline has 15 sections including Formulation / BOM, Manufacturing, Packaging, Compliance, Fulfillment. First-cycle tasks: open questions; "Supplier long list and RFQ pack" (acceptance: "At least 20 suppliers recorded as CRM entities"); "Landed cost model v1"; runway forecast; compliance and incorporation. First build after sign-off: "Plan the storefront and order flow" (code).

What a specialist session can call (`templates/specialists/_specialist.ts:33-36, 56-62` resolved by `packages/connectors/src/grants.ts:137-256`): task tools (list, claim, block, hand off, complete), typed messages, `request_human_action`, `search_entities` (read only), `read_product`, repository docs, `search_web`/`fetch_page`, `read_untrusted`, Gmail `create_draft`/read and Drive read/`create_doc`/`append_to_doc` (only if the founder connected Google; otherwise the gateway refuses "not connected"), and for costing `ecb_rates`. It cannot create a CRM record, log an interaction, write a document in Foundmill, track an RFQ, a quote or a sample, or update a cost model: those grants were removed on Nov 11 because nothing serves them (`_specialist.ts:29-32`, `PLANNED_GRANTS.md`). The specialists' standing rule still says "Record every outside party ... as a CRM record and every exchange as an interaction" (`templates/_shared.ts:96`).

Week one for this founder: a page, a 15-section specification, a roadmap, and five or so task summaries (each ≤ 4,000 characters, visible as Inbox notes) built on simulated web results unless `web` is live. The specialist tiles (RFQ funnel, quote table, sample tracker) fill only from `specialist:<json>` notes in the session stream (`development/specialist-data.ts:1-16`), which no prompt asks for (grep of `packages/agents` for `specialist:` finds no instruction). No supplier is contacted (email is a draft in the founder's Gmail at best), no storefront exists (the code path of §1.1 applies; the Shopify connector is mock).

### 1.3 "I want to sell a service"

Archetype `services` (`archetypes.ts:620-664`): Product is renamed "Service design"; outline adds "Service delivery process" and "Engagement model and SLAs"; first-cycle tasks are open questions, forecast, and engagement terms; the first build is "Plan the client portal and intake" (a web app: intake form, client portal, delivery checklist). Channels: lead generation, events, email automation, SEO, PR.

Week one: the same documents plus the public page with its Follow form. What a service seller needs first (an offer with a price, a way to ask for or book a slot, a way to pay) does not exist: the page has no price, no booking request, no call-to-action other than Follow (`packages/shared/src/types.ts:270-278`), there is no payment link ("The payment link is not on main yet", `apps/ingest/src/post-outcomes.ts:49`), and the planned portal is code that cannot land (§1.1 case a).

### 1.4 What a coding session can really do in production

- **Runner**: Claude Agent SDK (`sdk.query`, `session.ts:1738-1783`) on the orchestrator host in a 0700 per-session directory that is `cwd`, `HOME` and `TMPDIR`, with an environment built from scratch (`sdk-isolation.ts:74-97`), `settingSources: []`, `strictMcpConfig`, `permissionMode: "dontAsk"`, a `PreToolUse` path guard (`guardToolCall`, `:156-178`). E2B is used only for the acceptance run and the design check, 30-minute TTL (`SANDBOX_TTL_MINUTES`, `session.ts:86`), egress to `registry.npmjs.org` and `temporal.download` during install, then closed (`:2077-2083`, `closeEgress` `:2564`).
- **Tools**: code tasks: `Read, Glob, Grep, Edit, Write` plus gateway MCP tools; all other kinds: MCP tools only. `Bash`, `WebFetch`, `WebSearch`, sub-agents, `TodoWrite` and the rest are disallowed for every kind (`sdk-isolation.ts:44`).
- **Tests**: never by the agent. The platform runs one command after the session: the task's `{command}` criterion if any (the Planner emits strings only, `packages/models/src/schemas.ts:248-260`), else `pnpm --filter <changed packages> run --if-present test`, else the every-package fallback minus Playwright packages (`acceptanceCommandFor`, `session.ts:2768-2779`). Install 10 minutes, run 15 minutes (`:79-80`). pnpm and Node only (`acceptancePrepareScript`, `:2302-2326`).
- **Length**: at most 60 turns (`DEFAULT_MAX_TURNS`, `:74`); the run activity may last 8 hours with a 3-minute heartbeat (`workflows/agentSession.ts:32-33`); the gateway token lives 4 hours (`SESSION_TOKEN_TTL_SECONDS`, `:75`); approval wait 30 minutes, pause hold 10 minutes then the session parks for up to 7 days (`apps/orchestrator/src/env.ts:19-21`, `agentSession.ts:38`).
- **Cost**: `maxBudgetUsd` = min(task budget left (default 20 USD), credits left, agent wage cap left, monthly model budget left) (`session-budget.ts`, `session.ts:1752`). Sandbox seconds are booked too. Workers run on Sonnet, on Haiku when credits are low (`routing.ts:175`). Free tier: 4 concurrent agents (`pricing.ts:19`).
- **Failure**: outcomes `done | blocked | failed | stopped`. Blocks the founder can meet: no model credential (`:1427-1430`), credits or budget used up (`:1436`, `:1447`), "changed no files" (`NO_CHANGES_REASON`, `:2484`), acceptance failed or did not run (`:1973-1981`), a loop (the same tool call three times, `:1866-1869`), "needs review" when the session changed test setup (`testSetupChanges`, `:1984-1993`), a hand-back after conflicts or failed checks (`merge.ts handBack`). Each writes `task.blocked` and the Composer turns it into an Inbox note.
- **While it runs** (`apps/api/src/routers/dev.ts:133-219`): `dev.tasks.shout` (five presets or 280 characters; reaches the session within about 2 seconds), `pause` (tool calls wait at the hook; after 10 minutes the session parks and frees its slot), `resume`, `stop`, `reassign` (stops the session, task back to `ready` for the new agent), `upgradeModel` ("Use the strongest model": Opus for the rest of the session, `session.ts:1575-1592`), `openInClaudeCode` (a `git fetch origin agent/<id>` line and the task context; meaningless without a repository).
- **Is "Live sessions" understandable?** With Builder view off it is "Working now": tiles only, the task in the founder's words, progress, elapsed time, a cost Estimate and Nudge; the task graph, the replay scrubber, terminals and diffs are hidden (`TrainingGroundScreen.tsx:123-127, 256, 337-338`). There is an explainer line (`:92-97`). Remaining jargon: the nudge presets "Focus on tests", "Ask before schema changes", "Match the design system" (`:57-63`), and the footer's concurrency hint. Verdict: understandable as "who is working on what"; it does not answer "what will I be able to open when this is finished", because nothing can be opened.

### 1.5 From code to something a customer can open: what exists per first product

The only public address a project has today is `https://foundmill.com/p/<slug>` (plus its story page and milestone cards). It is a fixed template: pitch, about, who it is for, stage, optional founders, a Follow form with double opt-in, an optional quiz (0105), a share image. No agent can change it after the first draft, and it has no price, button, booking or file.

| Piece | Landing page with a waitlist | Booking page | Small web app | Digital download with a payment link |
| --- | --- | --- | --- | --- |
| Page content written by the team | Exists (project page, first draft only) | Missing (no offer, slots or request form) | n/a | Missing (no product block) |
| Hosting at an address | Exists for the project page only | Missing | Missing (no hosting, no preview; `deploy.succeeded` unwritten) | Missing |
| Custom domain | Missing (availability check only, `apps/api/src/services/domains.ts`; a `cloudflare_dns` connector exists on the founder's own token but nothing points a domain at a page) | Missing | Missing | Missing |
| Sign-ups reaching Customers | Exists: Follow form → `contact_consents` + CRM lead → `page.followed` on confirmation (needs the sending setup live) | Missing | Missing | Missing |
| Database for the customer's app | n/a | n/a | Missing (nothing provisions one; the Supabase project is Foundmill's own) | n/a |
| Sign-in for the customer's app | n/a | n/a | Missing | n/a |
| Payments | n/a | Missing | Missing | Missing: no payment link (`apps/ingest/src/post-outcomes.ts:49`); the `stripe` connector has `create_checkout_session` and `start_connect_onboarding` but runs mock for businesses and no agent holds a grant for them (`grants.ts:199-205` lists reads only) |
| File delivery | n/a | n/a | n/a | Missing |
| Code the agents wrote | n/a | Saved per task in Postgres, visible only in Builder view | Same; cannot be composed or run (A4-01, A4-02) | Same |

With a connected repository the picture changes only for "code lands on GitHub after the founder's yes"; hosting, domain, database, sign-in and payments are still whatever the founder set up on their own.

### 1.6 Quality gates on agent-built product work

| Gate | What it checks | Can it stop the work? | Where it is absent |
| --- | --- | --- | --- |
| Acceptance criteria (Planner) | Prose shown to the agent | No: nothing evaluates them (`session.ts:2768-2772`) | Always advisory |
| Acceptance run (E2B) | The changed packages' own `test` script, offline, pnpm only | Yes: a failing or missing run blocks (`session.ts:1973-1981`) | Zero tests passes; browser tests excluded; non-Node projects; A4-06 |
| "Changed no files" and test-setup review | A session that wrote nothing is not done; a session that touched `package.json` scripts, a runner config or deleted a test is held for the founder (`checkout.ts:505-524`, `session.ts:1984-1993`) | Yes | Without a checkout (no base to compare) |
| Path and branch guards | Only `agent/<taskId>` branches of a private pinned repository, never `.git`/`.github`; `run_checks` refuses a branch whose `.github` differs | Yes (gateway and connector) | n/a |
| Second read of the diff (#117) | A different agent reviews the diff on the `codeReview` route; verdict and findings on the approval | No (`second-read.ts:8`) | No repository; A4-12 |
| Design check (#114) | Screenshots at desktop and 390 px, a separate reviewer, one fix turn | No (`design-check.ts:8-10`) | Probably every production run today (A4-11); projects without `dev`/`start` or `index.html` |
| Repository CI | The founder's own `ci.yml`, dispatched by the platform | Yes, when it exists: failure hands the branch back | Repositories without that workflow: "the merge is tried once the founder approves" (`merge.ts:302-306`) |
| The founder's yes (`merge_to_main`) | One Inbox decision per change | Yes | A "no" has no follow-up (A4-13) |
| Second read of documents | Issues list and one revision task | No | Fact-checks are simulated unless `web` is live |
| Page publish | The founder's own press plus deterministic screening (markup, script links, email addresses, phone numbers; no model) (`pages.ts:12-16`) | Yes | No check of claims (prices, health, legal) |
| Specification and roadmap sign-off | The founder reads and approves | Yes | A first-timer cannot judge a 2,500-word specification (A4-16) |

**Where low-quality or unsafe work can reach a customer today.**
1. Through the founder's own repository after a yes given on "It passed every quality check" when little or nothing was checked (A4-06) and the reviewer's "request changes" was only displayed (A4-12). If that repository deploys from its default branch, the change is live to customers with no further gate; Foundmill neither sees nor records the deploy.
2. Before any review: every push of an agent branch builds a preview on the founder's host (Vercel ignores `[skip ci]`, `docs/DEPLOY.md:202`), at a public address unless the founder turned on deployment protection.
3. Through the public page: the first draft is model-written and the founder publishes it; the screening looks for markup and contact details, not for false or risky claims.
4. Not through agents acting alone: there is no deploy tool, no publish tool, no merge without the founder, and non-code work has no outward tool in production beyond what the founder connected.

---

## 2. Real vs simulated vs not connected in production

How I know: code paths as cited; production settings from `docs/DEPLOY.md §6` (status table, lines 236-278) and PROGRESS; not inspected live.

| Capability | State | Evidence |
| --- | --- | --- |
| Page, vision, specification, roadmap, research plan text | Real (live models) | `MODEL_MODE=live` on api, composer, orchestrator (`DEPLOY.md:259`); §1.0 |
| Founder sign-off, spec versions, proposals, roadmap edits | Real | `signoff.ts`, `routers/product.ts` |
| Public project page `/p/<slug>` with Follow form | Real page; Follow confirmation depends on the sending setup (`DEPLOY.md §5.7`, "off until its DNS and SendGrid setup", `THESIS_REVIEW.md:395`) | `pages.ts:1-29` |
| Second read of documents | Real model; fact-check uses simulated web unless `web` is live ("A simulated web result is never a checked fact", `second-read.ts:15`) | |
| Agent coding session (file edits) | Real (Agent SDK on the orchestrator host) | `session.ts:1736` |
| Acceptance run | Real (E2B, `SANDBOX_MODE=e2b`, `DEPLOY.md:260`) for pnpm/Node projects | `session.ts:2493-2580` |
| Design check screenshots | Built; probably `unavailable` in production: the capture needs the Playwright library in the image and `infra/e2b/e2b.Dockerfile:24-27` installs Chromium through `npx` and deletes the npm cache; the module header says the template change is "not done here" (`packages/sandbox/src/browser.ts:18-24`). Inference; nobody recorded a production capture | |
| Commit, push, CI, pull request, merge on GitHub | Real, proven only on `reidjxn/foundmill` | PROGRESS 1352-1378 |
| Second read of a diff | Real, only with a repository (`second-read.ts:93`) | |
| Platform-owned repository, hosted preview | Not built | §1.1 |
| Deployments, previews, "Your live product" | Not connected: no writer of `deploy.succeeded`; Vercel connector is read plus "redeploy" on the founder's own token (`vercel/tools.ts:1-10`) | |
| Web search and page reads for agents | Code real; production not confirmed live (documented `LIVE_CONNECTORS=github,domains`) | §1.0 |
| Specialists' Drive and Gmail | Not connected unless the founder connects Google; then mock unless those connectors are live | `pipeline.ts:751-759` |
| CRM writes, documents, RFQ, quotes, costing by agents | Not built (no tool) | `PLANNED_GRANTS.md` |
| Payment link, booking, checkout for the founder's product | Not built | `post-outcomes.ts:49`; grep `payment_link` |
| Custom domain for a page or product | Not built (availability check only, `services/domains.ts`) | |
| Session recording and replay | Real (`session_recordings`, 8 MB cap, `activities/recording.ts`), Builder view only | |
| Mock replays of seven demo recordings | Only where the sandbox mode is mock (development and tests; production runs `SANDBOX_MODE=e2b`) | `session.ts:206-211` |

---

## 3. Findings

Severity: P0 stops the target user reaching a real outcome or breaks trust; P1 serious; P2 moderate; P3 minor.

### A4-01 (P0) A finished code task can never become done without a push-enabled GitHub repository, so the build stalls silently
- **Evidence (verified by reading; not run).** `finishSession` sends every finished code task to `review` (`apps/orchestrator/src/activities/session.ts:970-977`). `prepareMerge` skips with "no repository is chosen on the Code tab" or "pushing ... is turned off" (`activities/merge.ts:253-256`); `pendingMerges` returns `[]` when `!target?.writeEnabled` (`merge.ts:212-213`). The only writers of `done` are `merge.ts:184, 267` and non-code `complete_task` (`apps/gateway/src/platform-host.ts:184`). Dependents need `d.status = 'done'` (`packages/db/src/repos/tasks.ts:374`). `offerReadyToSellAfterTask` needs every sibling `done` (`session.ts:1109-1110`). Pushing is off by default (`routers/dev.ts:304`).
- **Impact.** Every founder without GitHub (the common case) and every founder who connected GitHub but did not tick "Push" gets a first layer of tasks "waiting for your go-ahead" with no question ever asked, and nothing after it. Days 2-3 of "Your first week" promise "You are asked to approve ... the first changes going live" (`packages/shared/src/first-week.ts:102, 128`); it cannot happen. Credits are spent on work that cannot move.
- **Fix.** Short term (one change): decide the no-destination case explicitly.
  1. `apps/orchestrator/src/activities/session.ts` `finishSession`: compute `destination = await repos.integrations.codeRepository(db, businessId)`; when there is none or `!writeEnabled`, a code task that passed acceptance becomes `done` with `task.completed.payload.landed = "saved_only"` (new optional field in `packages/events/src/catalogue.ts` `taskCompleted`), and no `merge` is returned.
  2. `packages/modules/src/development/founder-views.tsx` and `EnvironmentsScreen.tsx`: show such rows as "Saved, not live anywhere" (the `no_artifact` state at `EnvironmentsScreen.tsx:188` already exists for `done` without a push).
  3. Until A4-02/A4-03 exist, stop planning code that cannot land: see A4-05.
  4. Tests: `apps/orchestrator/src/__tests__/session-live.test.ts` (no repository → `done`, dependents dispatchable), `merge.test.ts` (sweep ignores them), `packages/db` `tasks.dispatchable`, a Playwright case in `apps/web/e2e/team-development.spec.ts`.
  Long term: A4-03's site workspace replaces this.

### A4-02 (P0) Without a repository there is no shared codebase: each task starts from its own saved files only
- **Evidence.** `restoreWorkspace(deps.db, input.businessId, task.id, cwd, …)` (`session.ts:1491`); note "this session starts from the code saved on this task only" (`checkout.ts:533-534`); `workspace_snapshots.task_id` is the key (`packages/db/src/schema/workspaces.ts:38`). The Planner's graph assumes tasks build on each other (`prompts/planner.ts:45`).
- **Impact.** Even if A4-01 were patched, task B would not contain task A's files. A multi-task product cannot be assembled without GitHub. This is the substance of THESIS 1.7 and it is not started.
- **Fix.** The project workspace of §8 (business-level tree with releases), or a platform-owned GitHub repository. Do not patch per-task restore.

### A4-03 (P0) No path from agent work to anything a customer can open, and the screens say there is
- **Evidence.** No writer of `deploy.succeeded` in production code; `dev.deployments.list` reads only those events (`routers/dev.ts:370-392`). Copy: "Each change gets its own preview to try before it goes live; it opens here once the quality checks pass" and "The address of your live product appears here after its first release" (`founder-views.tsx:271, 275`); "Nothing goes live until you say so" (`:182`). The page schema has no call to action besides Follow (`packages/shared/src/types.ts:270-278`).
- **Impact.** The founder's question "where is my product?" has no answer in week one or later. For the north star (a real outside outcome per week) the build half contributes nothing; only the page does. The copy promises previews that never arrive: trust.
- **Fix.** §8. Immediately: change the two sentences to what is true when no deployment has ever been recorded for the business ("Previews are not available yet" / "Nothing is live yet. Your public page is at …" with a link to Product › Public page), in `founder-views.tsx` and `packages/shared/src/empty-why.ts`; add to `scripts/plain-language.mjs` fixtures; Playwright `team-development.spec.ts`.

### A4-04 (P1) The GitHub path only works for someone who already has a codebase and CI, and can find a Builder-view tab
- **Evidence.** Repository chooser exists only on Development › Code (`CodeScreen.tsx:227`), a Builder-only tab (`constants.ts:82-83`); the non-Builder hint says only "Connect GitHub in Settings › Integrations" (`shared.tsx:281`). An empty repository cannot be checked out ("the repository or its default branch was not found", `checkout.ts:188`), and a save made without a checkout is never pushed over a repository (`workspace-store.ts:400`, `workspace-push.ts:149-152`), so agents cannot bootstrap a new repository. `run_checks` needs `.github/workflows/ci.yml` with `workflow_dispatch` already on the default branch (`github/tools.ts:11-14, 173, 383`), and agents can never write `.github` (`:96-103`). Public repositories are refused (`code-repository.ts:27, 49`).
- **Impact.** A founder who follows the product's own advice and creates a GitHub account and an empty private repository gets nothing pushed, with warnings in a stream they cannot see. THESIS §7.5 "Real, on an existing repository ... proven only on Foundmill's own" still holds.
- **Fix.** (1) Put the repository choice and the push switch in Settings › Integrations › GitHub right after "Connect installation" (new small panel calling `dev.code.repository`/`dev.code.setRepository`; keep the Code tab). (2) First push to an empty repository: allow `pushWorkspace` when the repository has no commits (new route-only tool `init_repository` in `packages/connectors/src/connectors/github` that creates the first commit on the default branch from a platform starter, including `.github/workflows/ci.yml`; real and mock; gateway guard: only the pinned repository, only when it has zero commits, founder approval). (3) Tests: github contract suite, `workspace-push.test.ts`, gateway write guard, Playwright `code.spec.ts`.

### A4-05 (P1) The Planner plans blind
- **Evidence.** Both planning paths send `{ goal, roadmap_item, spec_sections }` where `spec_sections` is a list of section names (`task-graph.ts:55-63`; `roadmap-plan.ts:55-68`). The richer `plannerPrompt` with `spec_excerpt`, `repo_summary`, `worker_types`, `max_tasks` (`packages/agents/src/prompts/planner.ts:22-56`) is defined and not used by either caller. `test_expectations` from the answer are dropped (`repos.tasks.writePlannedGraph`, `packages/db/src/repos/tasks.ts:258-268`). No input says whether code can land anywhere.
- **Impact.** Tasks carry file scopes for a repository that does not exist, "client portal" or "signup → payment" slices for a founder with no hosting, and acceptance criteria that nothing checks. In the dogfood this showed as "re-scoped tasks keep file scopes that do not exist on main" (`docs/PROGRESS.md:1372`).
- **Fix.** One shared `buildPlannerRequest` in `packages/agents/src/prompts/planner.ts` used by `task-graph.ts` and `roadmap-plan.ts`, given: the text of the sections the roadmap item names (bounded), `destination: "none" | "site" | "github"`, a repository summary (top-level tree and `package.json` scripts through the existing first-party reader, or "empty"), the worker types actually on the team. Rule: with `destination: "none"` plan no `code` tasks; say so in `questions_for_founder`. Store `test_expectations` on the task (`tasks.acceptance` as `{ text }` and `{ test }` entries; no migration needed, it is jsonb). Eval: `evals/src/planner.ts` (new) with three fixtures (no destination, site, repository).

### A4-06 (P1) "Passed its quality checks" can mean nothing was checked
- **Evidence.** Criteria are strings; `acceptanceCommandFor` looks only for `{command}` objects (`session.ts:2768-2772`), so every planned task falls to "tests of the changed packages" or the fallback with `--if-present` (`:2761, 2775`). `passed = res.code === 0 && testsFailed === 0` (`:2577`), so zero tests is a pass (Inference for the greenfield case: not run). Playwright packages are excluded (`workspaceAppTestPackages`, `:2237`). Dogfood: PR #38 changed only `apps/web/e2e/example-business.spec.ts` and its body says "144 of 144 acceptance tests passed in the platform's sandbox" (`gh pr view 38`): those are the web package's unit tests; the changed spec never ran there. The founder's approval note then reads "It passed every quality check. OK to put it live?" (`docs/PROGRESS.md:1381`).
- **Impact.** The founder is asked to approve on a statement that overstates what was verified. For a first product with no tests yet, everything "passes".
- **Fix.** `runAcceptanceIn`: return `testsRun`; when `testsRun === 0` the verdict is `not_verified`, the task goes to review with the reason "nothing checked this change", and `approvalItem` (`packages/db/src/approvals.ts`) says "No automatic check covers this change" instead of "passed every quality check". When changed files include tests the sandbox excludes, say "N checks ran; the browser tests you changed run later". Tests: `acceptance-toolchain.test.ts`, `packages/db approvals-inbox`.

### A4-07 (P1) Physical-product and service founders get documents and summaries; the specialists cannot do their stated job
- **Evidence.** §1.2. Acceptance "At least 20 suppliers recorded as CRM entities" (`archetypes.ts:455`) against a grant list with no CRM write (`_specialist.ts:33-36`); rule to record every party (`_shared.ts:96`); description still advertises "Tools: documents in Google Drive, CRM search, email drafts" (`_specialist.ts:39`). A task whose agent says it lacks the tool is stopped and archived silently (`stopToollessTasks`, `docs/PROGRESS.md:1377, 1381` item 3). Services: first build is a portal (`archetypes.ts:650-654`).
- **Impact.** A physical-product founder's first week ends with no supplier list they can open, no quote table, no cost model, only notes. If the agent is honest it blocks and the task disappears; if it is not, it reports a summary as if the list existed.
- **Fix.** Smallest real slice, three platform tools in `packages/connectors/src/connectors/platform/tools.ts` + `apps/gateway/src/platform-host.ts`, each audited as the agent: `create_entity` (kind supplier/lab/contact, source URL required, capability `crm.entities.create`), `log_interaction` (`crm.interactions.append`), `write_document` (`documents.write`: Markdown ≤ 50,000 characters into a new business-scoped table `documents` with `task_id`, `kind`, `title`, `body_md`, `created_by_agent_id`; RLS like `research_artifacts`; cross-tenant test). Show documents on the task and in a "Files" list on Product. Then re-grant in `_specialist.ts` and `product_researcher.ts`, delete the rows from `PLANNED_GRANTS.md`, rewrite the two first-cycle tasks' acceptance to what the tools can prove, and make the costing task write a `documents` row of kind `cost_model`. For services: replace `firstBuild` with "An offer page with a price and a way to ask for it" once §8 exists. Evals: one end-to-end session per specialist task with mock tools (the session harness of `apps/orchestrator/src/__tests__/harness.ts`).

### A4-08 (P1) Web research is not confirmed live, and research artifacts cannot be written by agents
- **Evidence.** §1.0. `findings` is an artifact kind (`packages/shared/src/constants.ts:402`) but `repos.research.createArtifact` has no caller outside the plan drafting (grep). Research and specialist sessions therefore end in a summary.
- **Fix.** Configuration: `web` in `LIVE_CONNECTORS` and `ANTHROPIC_API_KEY` on the gateway (`web/index.ts:109`), after checking the cost attribution of `search_web` (it runs on the platform key inside the gateway; I found no booking of that call to the business: unverified, see §7). Code: a platform tool `record_finding` writing `research_artifacts(kind: "findings")` with source URLs; refuse when every cited source came from a simulated result.

### A4-09 (P1) The dogfood loop does not close: seven agent pull requests open since Oct 27 to Nov 3, none merged, none closed, none reviewed
- Evidence and analysis in §6. Fix list there (F1 to F6).

### A4-10 (P1) Copy that promises what the build path cannot do for a founder without a repository
- **Evidence.** `first-week.ts:102, 125-128` ("the first changes going live"); roadmap sign-off note "the engineers pick them up in the next cycle" (`foundations.ts:791`); `buildingStartsBody` (`signoff.ts:289-294`); `codeTaskNote` tells the agent its work is pushed, CI runs and a pull request opens (`session.ts:2023`), false without a repository, so the agent's own summary repeats it.
- **Fix.** Make all four conditional on the destination (`none | site | github`) read once in `packages/db/src/product-stage.ts` (`loadProductStage` already feeds these surfaces). Tests: `packages/shared` first-week tests, `signoff.test.ts`, `agents` prompt tests.

### A4-11 (P2) The design check (#114) likely sees nothing in production, and never blocks
- **Evidence.** `packages/sandbox/src/browser.ts:18-24` (needs `npm install -g playwright@1.63.0` in the template; "not done here"); `infra/e2b/e2b.Dockerfile:24-27` does not install the library. A check that cannot run records `not_seen` and the session goes on (`design-check.ts:8-10`). It serves only pnpm `dev`/`start` scripts or a static `index.html` (`planDesignServe`, `:111-138`).
- **Fix.** Add the global install to the Dockerfile and rebuild through `.github/workflows/e2b-template.yml`; add a boot-time self-test activity that captures a fixture page once per template id and logs `design_check_available`; surface `not_seen` on the approval as "Nobody looked at this page" (it is recorded but check the wording in `approvalWhatFor`).

### A4-12 (P2) The second read (#117) is advisory and exists only where there is a repository
- **Evidence.** `secondReadMerge` skips without a repository (`second-read.ts:93`); it "never blocks the founder's decision" (`:7-9`); a `request_changes` verdict (`schemas.ts:272`) is shown, not acted on.
- **Impact.** A non-technical founder cannot weigh a code-review finding; a "request changes" verdict should go back to the author once before the founder is asked.
- **Fix.** In `mergeReview.ts` after `secondReadMerge`: when the verdict is `request_changes` and this is the first review of the task, `handBack({ why: "review" })` with the findings as the revision goal (one round only), then ask. New `MergeHoldReason` value; patched behind a new patch id. Workflow test in `mergeReview.test.ts`; eval in `evals/src/second-read.ts`.

### A4-13 (P2) A founder's "no" to a change leaves it in limbo
- **Evidence.** `recordMergeDecision` only audits (`merge.ts:452-456`); `pendingMerges` treats a task with a `decision` step as settled (`merge.ts:227, 232`); the api says "Nothing goes live; the work waits" (`apps/api/src/services/approvals.ts:106-108`). The task stays `review`; its dependents stay blocked (A4-01's rule).
- **Fix.** On rejection ask one question in the same note ("What should change?" free text, or "Drop this change"); with words → `handBack({ why: "founder" })` with the founder's words as trusted goal text; "Drop" → archive the task and remove its edges (the pattern of `stopPlatformDuties`). Tests: api `approvals.test.ts`, orchestrator `merge.test.ts`.

### A4-14 (P2) Templates, prompts and the acceptance toolchain assume Foundmill's own monorepo
- **Evidence.** Frontend engineer: "Every screen touched has a Playwright test and every new component a Storybook story", "Run typecheck, lint, unit and Playwright tests; capture a screenshot" (`templates/workers/frontend_engineer.ts:19-36`) while the session has no shell (`session.ts:2022-2024` has to contradict it). Acceptance is pnpm/Node only, with a Temporal test-server download step (`session.ts:2384-2416`). No scaffold or starter exists (grep `scaffold|starter|boilerplate`: nothing).
- **Impact.** A greenfield project would be hand-typed file by file with no lockfile and no install; dogfood PR #24's first commit "wrote a placeholder into BusinessShell.tsx by mistake" and then "re-typed in full" a file (`gh pr view 24`).
- **Fix.** Starters as data (`packages/agents/src/starters/<key>/**`: `static-site`, later `next-app`) applied by the platform, not typed by the agent; template playbooks rewritten around "write the change and its tests; the platform runs them"; remove the Temporal lines from the generic prepare script (make them a per-repository setting on the integration row).

### A4-15 (P2) Credits: a first-timer can spend the month's included credits on day one
- **Evidence.** §1.0 cost. Free tier 500 cents (`pricing.ts:19`); default task reserve 2,000 cents (`cycle-contract.ts:66`); Opus fast for foundations (`routing.ts:170-172`), Opus for planner, second read, design review and Inbox Composer.
- **Fix.** Measure first: a one-off report from `model_calls` grouped by `kind` for the first 24 hours of each real business (a script under `scripts/`, read-only). Then set a first-week budget line the founder sees before the second sign-off ("Building the first two items is estimated at X; you have Y"), using the existing priced Continue (`docs/DECISIONS.md:3342`).

### A4-16 (P2) Day-one reading load and two gating sign-offs
- **Evidence.** §1.0 table; `signoff.ts:230` (both approvals needed). THESIS 1.3 wanted the specification and roadmap to "arrive as one note"; they are still two decisions (`foundations.ts:773`).
- **Fix.** One note "Your plan is ready" with a 5-line summary (what we will build first, for whom, what you will be able to open and when, what it costs) and one Approve that approves both rounds (`decideProductSignoff` called twice in one transaction; keep the two rounds in the data). "Read the full plan" stays a link. Playwright `foundations.spec.ts`, api `signoff.test.ts`.

### A4-17 (P2) Previews already exist for a connected repository and are not shown
- **Evidence.** Every dogfood pull request carries a Vercel preview (checks `Vercel: SUCCESS` and the bot's comment with the preview URL on #24, #30, #38, #39, #45, #49, #52). Foundmill records none of it: App webhooks are off (`DEPLOY.md:198`), the normaliser ignores everything but merged pull requests (`github/webhooks.ts:65-67`).
- **Impact.** For a founder with a repository on Vercel or Netlify the "See it" column (`founder-views.tsx:140`) could work today.
- **Fix.** Without webhooks: in `prepareMerge`/`assessMerge` read the head commit's deployments with a new read tool `list_deployments` on the github connector (`GET /repos/{o}/{r}/deployments?sha=` then statuses; typed facts only: environment, state, `environment_url` host-checked) and emit `deploy.succeeded` (`environment: "preview"`, `provider`, `url`, `commitSha`, `taskId`) through the outbox with an idempotency key. Real and mock, contract tests, gateway first-party rule, `merge.test.ts`.

### A4-18 (P2) The demo task after "shipped" cannot be done
- **Evidence.** "Record a demo of … Walk through what shipped as a first customer would" is given to a research agent with no browser and no address (`session.ts:1140-1149`).
- **Fix.** Create it only when a preview or live address exists; otherwise skip. With §8, give it the site's preview address and the design check's screenshots.

### A4-19 (P3) The founder-only merge rule is enforced at approval time but the settings API still accepts a delegate
- **Evidence.** PR #52's two-line change is not on main (`grep merge_to_main apps/api/src/routers/team.ts`: no match); the approval path ignores a delegate for merges (the PR's own test comment "the founder answers every merge").
- **Fix.** Merge #52 (it is `MERGEABLE`/`CLEAN` with 11 green checks) or re-apply its diff.

### A4-20 (P3) Small things
- Nudge presets are engineering phrases (`TrainingGroundScreen.tsx:57-63`); offer founder presets while Builder view is off ("Keep it simple", "Ask me before big changes", "Hurry up").
- `openInClaudeCode` is offered without a repository (`dev.ts:209-218`).
- `legacyBusinessFoundations` is past its stated removal point (`businessFoundations.ts:141-150`).
- The services archetype keeps a 300 USD development budget and a full coding team for a founder who needs an offer page (`archetypes.ts:633`).
- `apps/gateway/src/connectors/` does not exist on main; PRs #39/#49 create it against the repository's own connector layout (`packages/connectors/src/connectors/<key>/`), see §6.

---

## 4. Roadmap items in this area (THESIS §13)

| Package | State on Nov 15 | Evidence |
| --- | --- | --- |
| 0.3 mock result never reads as real | Done (gateway marks `simulated`; real businesses get "not connected" for connectors with auth) | `pipeline.ts:757-759, 923`. Gap: `web` (auth none) still answers simulated for a real business |
| 0.5 grants nothing serves | Done | `NOT_YET_SERVED` empty (`grants.ts:289`), `PLANNED_GRANTS.md`. Side effect: specialists hollowed out (A4-07) |
| 1.1 project pages | Done | `pages.ts`, `apps/web/app/p/[slug]` |
| 1.2 agents write the page | Partial: drafted by the foundations runner on the Product lead's behalf (`draftProjectPage`); there is no `project_page` task kind, no `publish_page` tool, no `documents.write`; publishing is the founder's press (a deliberate change from the package text) | `businessFoundations.ts:96-101`, `pages.ts:12-14` |
| 1.3 first session ends on the link | Done for order (page first); the two sign-offs remain two notes | `first-week.ts:98-104`, A4-16 |
| 1.4 real web research | Open (configuration) | §1.0 |
| 1.6 waitlist and payment link | Follow form done; payment link open | `0079`, `post-outcomes.ts:49` |
| **1.7 platform-owned repository and hosted preview** | **Not started** | §1.1; founder said yes, last in phase 1 (`DECISIONS.md:3499`) |
| 1.8 outcome evals in CI | Open: only `evals-typed-reads.yml` runs live; no end-to-end session eval | `.github/workflows/`, `evals/src/__tests__` |
| Item 6 second read (#117) | Done as advisory | `second-read.ts` |
| Item 13 design check (#114) | Built; production capture unverified (A4-11) | `design-check.ts`, `browser.ts` |
| Handover item 3: Railway deploy connector for Foundmill's own production | Contract only, in two duplicate open PRs (#39, #49), wrong directory, conflicting | §6 |
| Handover item 2: first live loop | Reached a founder approval twice (Nov 2, Nov 6); no agent change has landed on main | PROGRESS 1374, 1378 |

---

## 5. Interfaces a planner must know

**Statuses and kinds** (`packages/shared/src/constants.ts`): `TASK_KINDS` include `code`, `research`, `specialist`, `channel`, `finance`, `legal`; task statuses `planned, ready, running, paused, blocked, review, merging, done, failed, stopped` (transitions `packages/db/src/repos/tasks.ts:55`); `PLANNABLE_TASK_STATUSES` (`constants.ts:257`); `RESEARCH_ARTIFACT_KINDS = interview_plan, interview_script, smoke_test, survey, demo_script, demo, findings` (`:402`); `SignoffKind` = `spec | roadmap | ready_to_sell`.

**tRPC (apps/api/src/routers)**
- `product.foundations.get | ensure | retry`; `product.signoff.get`, `product.signoff.decide({ kind: "spec"|"roadmap", decision: "approve"|"request_changes", notes? }) → SignoffResult` (`services/signoff.ts:144-166`: `signoff, stage, item, decision, plan, followUp, specVersion, task, revision, build`).
- `product.research.get | ensure | retry`, `product.research.artifacts.update({ artifactId, status }) | archive`.
- `product.spec.get({ section? }) | editBlock({ blockId, patch }) | versions | compare({ from, to }) | publish({ changelogMd }) | restore({ version })`.
- `product.roadmap.list | upsert | move({ itemId, horizon, index }) | link`; `product.plan.preview | import`; `product.sources.*`; `product.proposals.list | get | decideHunk({ hunkId, decision, edited? }) | acceptAll | reject`.
- `dev.tasks.plan(PlanInput { roadmapItemId?, goal?, departmentId? }) → { tasks, graph, costMinor, costLabel: "Estimate", reused }`; `dev.tasks.list | get | start | pause | resume | shout({ taskId?, preset?, text? ≤ 280 }) | reassign({ taskId, agentId }) | upgradeModel | stop | openInClaudeCode`.
- `dev.sessions.stream | replay({ sessionId, limit?, after?, kinds? }) | list`; `dev.code.list | files | file | repository → { connected, status, repository, simulated } | setRepository({ repository, pushEnabled=false }) | forget`; `dev.prs.list → { open, merged }`; `dev.deployments.list`.
- `page.get | saveDraft | setSlug | publish | unpublish`; `publicPage.bySlug | storyBySlug | cardById | follow | visited`.
- `goal.current | ensure | approve | requestChange`.

**Temporal** (`apps/orchestrator/src/workflows`): `businessFoundations` (`foundations:{businessId}:{attempt}`; patches `foundations-staged`, `foundations-project-page`, `foundations-second-read`), `businessCycle` (`cycle:{businessId}:{n}`; patch `merge-sweep`), `agentSession` (`session:{sessionId}`; signals pause, resume, stop, shout, decision; query progress; patches `session-runner-retry`, merge review patch), `mergeReview` (`merge:{taskId}`; patch `merge-second-read`), `approvalWait` (`approval:{approvalId}`), `sourceWatch`, `planExecution`. Sessions run on the `-sessions` task queue. Any behaviour change needs `patched()`.

**Activities to extend**: `prepareSession`, `runAgentSession`, `finishSession` (`session.ts:763, 804, 912`), `checkoutRepository`, `updateConflicts`, `defaultBranchChanges` (`checkout.ts`), `saveWorkspace`/`restoreWorkspace` (`workspace-store.ts`), `pushWorkspace` (`workspace-push.ts:130`), `prepareMerge | assessMerge | updateBranch | askMerge | awaitChecks | completeMerge | handBack | holdMerge | recordMergeDecision | pendingMerges` (`merge.ts`), `secondReadMerge | secondReadDocument`, `liveDesignCheck` (`session.ts:2629`), `planRoadmap`.

**Types**: `SessionLaunch`, `SessionResult` (`outcome`, `reason`, `blockedReason: credential|budget|awaiting_approval|dependency|error|loop_detected|stopped`, `review`, `parked`), `MergeInput`, `MergeOutcome`, `MergeAssessment` (`activities/types.ts`); `SdkToolPolicy` (`sdk-isolation.ts:102-111`); `Checkout`, `CheckoutBase`, `CheckoutResult` (`checkout.ts:67-100`); `PushResult` (`workspace-push.ts:39-45`); `PlannedTask`/`TaskGraphOutput` (`packages/models/src/schemas.ts:248-266`); `DesignServePlan` (`design-check.ts:94-103`); `Sandbox`, `SandboxProvider` (`packages/sandbox/src/types.ts`).

**Connector tools and policy**
- `github` (`packages/connectors/src/connectors/github/tools.ts`): reads `list_repos, read_tree, read_file, compare_refs, list_pull_requests, get_pull_request, get_checks`; writes `create_branch, commit_files (rebuild, fromRef, expectedHeadSha), run_checks, open_pr, update_branch, merge_pr`; route-only `download_archive, get_repository` (`:257`). Capabilities `repos.read, pulls.list, pulls.read, checks.read, actions.read, checks.run, pulls.create, pulls.update, pulls.review, pulls.merge` (`grants.ts:160-173`). Gateway: `guardGithubWrite` (`pipeline.ts:170-180`), first-party read rule (`apps/gateway/src/code-repository.ts`), decision type `merge_to_main` (`pipeline.ts:696`), archive concurrency 3.
- `platform` (`platform/tools.ts`): `list_tasks, get_task, create_task, claim_task, assign_task, update_task, block_task, handoff_task, complete_task (summary ≤ 4,000), send_message, list_messages, request_human_action, read_business, search_entities, list_approvals, list_sessions, check_contact, read_product, propose_spec_change, read_finance, read_legal, read_distribution, list_repository_docs, read_repository_doc, list_skills, assign_skill, remove_skill`. Host implementation: `apps/gateway/src/platform-host.ts`.
- `web`: `search_web`, `fetch_page`, `fetch` (Source Watcher). `quarantine`: `read_untrusted`.
- `vercel` (founder's own token): `list_deployments`, `get_deployment`, `create_deployment` (redeploy only; hints `irreversible`, `spendsMoney`).
- `e2b` connector tools exist but the orchestrator uses `packages/sandbox` directly.
- Every template grant must resolve: `apps/orchestrator/src/__tests__/grants-contract.test.ts`; new capability → entry in `CAPABILITY_TOOLS` (`grants.ts:137`).

**Tables** (`packages/db/src/schema`): `business_foundations` (status, door, attempt, runner, workflow_id, vision, summary, progress, error); `spec_blocks`, `spec_versions`, `change_proposals`, `proposal_hunks`, `roadmap_items`, `roadmap_dependencies`, `sources`, `product_signoffs` (`product.ts:13-168`); `product_research`, `research_artifacts` (`research.ts`); `goals` (`goals.ts:16`); `tasks` (`acceptance jsonb`, `file_scope text[]`, `founder_title`, `budget_minor`, `code_forgotten_at`), `task_edges`, `agent_sessions`, `session_recordings` (`agents.ts:302-418`); `workspace_blobs`, `workspace_snapshots` (`workspaces.ts`); `project_pages` (0077), `contact_consents` (0079), `page_quizzes` (0105); `integrations.settings` `{ repo, repoId, writeEnabled }`; `app_installations` (service role only).

**Events** (`packages/events/src/catalogue.ts`): `task.completed` (carries `acceptanceTests`, `acceptanceTestsPassing`, `prNumber`, `branch`), `task.blocked` (`reason` includes `needs_update`), `pr.merged`, `deploy.succeeded` (declared, unwritten), `task.design_checked`, `product.signoff_decided`, `spec.version_published`, `foundations.progressed`, `product.research_drafted`, `page.followed`.

**Flags and env**: `INTEGRATIONS_MODE`, `LIVE_CONNECTORS`, `MODEL_MODE`, `SANDBOX_MODE`, `E2B_API_KEY`, `E2B_TEMPLATE` (`packages/shared/src/env.ts:73`), `ORCHESTRATOR_WORKSPACE_DIR`, `ORCHESTRATOR_MAX_SESSIONS` (16), `APPROVAL_WAIT_MINUTES` (30), `SESSION_PAUSE_HOLD_MINUTES` (10) (`apps/orchestrator/src/env.ts:15-33`), `MOCK_SESSION_SCENARIOS`, `GITHUB_APP_*` (gateway only), `NEXT_PUBLIC_COLLAB_URL`; Builder view (`BUILDER_ONLY_TABS`, `FOUNDER_TAB_TITLES`, `DEFAULT_TABS`, `constants.ts:82-108`); tier limits `TIERS` (`packages/config/src/pricing.ts:19-21`), `LIMITS.signoffPlanRoadmapItems = 2`, `LIMITS.cyclePlanRoadmapItems = 2`.

---

## 6. Dogfood evidence, and tests and evals

### 6.1 The seven open agent pull requests (read with `gh pr view`, Nov 15)

| PR | Opened / last push | Size | State | What it is |
| --- | --- | --- | --- | --- |
| #24 | Oct 27 / Nov 2 | +80/-4, 4 files, 8 commits | CONFLICTING | Hydration fix for the Example chip. Body admits the first commit "wrote a placeholder into BusinessShell.tsx by mistake" and the file was "re-typed in full"; adds two near-identical test files (`example-badge.test.tsx` and `example-badge-hydration.test.tsx`, 31 lines each); also edits the spec #38 edits. "Not verified: I could not run typecheck, lint, vitest or Playwright" |
| #30 | Oct 30 / Nov 6 | +40/-11, 6 files | CONFLICTING | A diagnosis written as a PR body (four hypotheses, three ruled out) with a small fix to dead code (`prepareAgentWorkspace`, which the orchestrator never calls) |
| #38 | Nov 1 | +33, 1 file | MERGEABLE, BLOCKED (required checks never ran) | Playwright assertion; "144 of 144 acceptance tests passed" refers to tests that do not include the changed spec |
| #39 | Nov 1 / Nov 6 | +341, 6 files | CONFLICTING | "Deploy connector contract": Zod schemas, an allowlist of Foundmill's six Railway services and tests, placed in `apps/gateway/src/connectors/deploy/` (not the repository's connector layout). No implementation. Approved by the founder on Nov 2; GitHub refused 17 seconds early; then conflicted on `docs/DECISIONS.md` and `docs/PROGRESS.md` |
| #45 | Nov 2 / Nov 6 | +42/-7, 3 files | draft, CONFLICTING | Orchestrator rule; body: "Branch is 12 commits behind main; I have no git or shell ... did not rebase or run typecheck/lint/tests" |
| #49 | Nov 2 | +341, 6 files | CONFLICTING | Byte-for-byte duplicate of #39, produced by a task titled "Rebase the deploy contract branch ... and hand it back for review" (a platform-duty task the Planner should not have made) |
| #52 | Nov 3 / Nov 6 | +16/-2, 2 files | MERGEABLE, CLEAN, 11 checks green | Founder-only merge handler in the api. Approved by the founder on Nov 6; the first merge was refused, the approval had been spent, and nothing retried after the fix |

All seven: zero reviews, zero human comments, only the Vercel bot. 228 commits have landed on main since Nov 6.

**What it says about output quality.** Small, scoped changes are plausible and honest about what was not verified (#52 is correct and green; #38 is a reasonable assertion). Anything that needs running code is typed blind (#24's placeholder commit, duplicate test files). Agents produce diagnoses and contracts more readily than working features (#30, #39). Architecture rules are not absorbed (#39's directory; a deploy "connector" without real and mock implementations).

**Where agents get stuck** (`docs/PROGRESS.md:1352-1380`): no shell ("23 of 25 sessions blocked" on Nov 2, `:1372`); stale branches and `branch_moved`; tasks invented for platform duties (run CI, rebase, open a pull request, route the merge); tasks needing tools nobody has; acceptance sandbox failures unrelated to the change (memory, missing workspace dependency, Temporal test server); the hiring-time agent version shadowing template updates.

**Why the PRs were never merged or closed.**
1. Every agent PR must edit `docs/PROGRESS.md` and usually `docs/DECISIONS.md` (CLAUDE.md "Always"), so every merge to main conflicts every other open agent branch on those two files; #39 was handed back for exactly that (`PROGRESS.md:1375, 1378`). Main moves about 25 commits a day from Claude Code sessions.
2. The merge path had three successive defects on the only two approvals the founder ever gave (17-second race, spent approval, behind branch), each fixed after the fact (`:1374, 1378`).
3. The loop only moves when the founder presses Continue on Foundmill's own business; the last recorded cycle is cycle 40 on Nov 6. After the founder's verdict "way too complex; I just want it to work" (`:1376`) work moved to the first-time-founder report, the thesis review and the network, all built by Claude Code sessions, not by the product's agents.
4. Nothing closes a pull request: there is no `close_pr` tool and no rule for duplicates or superseded branches (#49 vs #39; #24 vs #38), and no staleness sweep.
5. Agent commits carry `[skip ci]`, so GitHub shows required checks as missing until `run_checks` is dispatched; #38 sits BLOCKED for that reason.

**Fixes (F1 to F6).** F1: agents never edit `docs/PROGRESS.md`/`DECISIONS.md` on a branch; they put the entry in the pull-request body and the platform appends it at merge time (a post-merge step in `finishMerged`, or a `docs/progress/<date>-<task>.md` fragment per change: no shared file, no conflict). F2: a `close_pr` github tool (founder-approved, or automatic for a branch whose task was archived) and a sweep in `planCycle` that closes pull requests of archived or duplicate tasks. F3: a weekly "open changes" note listing pull requests older than 7 days with one decision each (retry, drop). F4: merge #52 now and close #49; decide #39 (re-home under `packages/connectors` or drop), #24/#38 (one of them), #30, #45. F5: an autopilot round for the dogfood business so the loop does not depend on a button press. F6: the 1.8 nightly outcome eval must include "one code task from plan to merged on a fixture repository" so these defects are found by a test, not by the founder.

### 6.2 Tests and evals covering this area

- **Orchestrator** (`apps/orchestrator/src/__tests__`): `session.test.ts`, `session-live.test.ts`, `session-budget`, `session-handoff`, `session-recording`, `sdk-isolation`, `acceptance-toolchain`, `checkout` (in `workspace-*` and `merge` suites), `workspace-store|sync|push|fingerprint`, `merge.test.ts`, `design-check.test.ts`, `second-read.test.ts`, `foundations.test.ts`, `roadmap-plan.test.ts`, `plan*.test.ts`, `dispatch.test.ts`, `grants-contract.test.ts`; workflows: `agentSession`, `mergeReview`, `businessFoundations` (+ replay), `businessCycle`, `sessionHandoff`.
- **API**: `foundations`, `signoff`, `product-research`, `product-changes`, `plan-import`, `goals`, `pages`, `page-follow`, `dev-code`, `dev-prs`, `dev-auth`, `approvals`.
- **Connectors/gateway/sandbox**: `github.test.ts` (1,112 lines, contract real+mock), `tarball.test.ts`, `web.test.ts`, `vercel.test.ts`; gateway `first-party-repo`, `approvals`, `platform-skills`, `web-fetch`; sandbox `e2b`, `docker`, `browser`, `worktree`, `replay-timing`.
- **Screens**: modules `product/__tests__/*` (foundations, specification, roadmap, changes, research, public-page), `development/__tests__/*`; Playwright `apps/web/e2e`: `foundations`, `specification`, `product`, `product-research`, `public-page`, `code`, `live-sessions`, `team-development`, `first-days`, `builder-view`; `e2e/tests/golden-path.spec.ts`.
- **Evals** (`evals/src`): `foundations`, `project-page`, `second-read`, `design-review`, `goal-proposal`, `source-watcher`, `golden`, `injection`. All single-call, all skipped without `MODEL_MODE=live` and a key (`harness.ts:53-60`); only typed-read injection runs in CI.

**Gaps.**
1. No test for a code task finishing with no repository or with pushing off (A4-01): `merge.test.ts:188-192` asserts the skip, nothing asserts what the task becomes.
2. No test that a second task sees the first task's files (A4-02).
3. No end-to-end session eval with tools; no nightly run (THESIS 1.8).
4. No Planner eval (prompt, inputs, platform-duty filter are unit-tested on titles only).
5. No test that the E2B template can capture a page (A4-11).
6. No specialist session test against the real grant list (A4-07): the grants contract only proves grants resolve, not that the first-cycle tasks are achievable.
7. Acceptance verdict with zero tests (A4-06) untested.
8. Mock recordings cover two demo businesses; nothing replays a first-timer's greenfield project.

---

## 7. Anything surprising

1. **The deadlock (A4-01) has probably never been observed** because the only business that ran live code sessions is Foundmill's own, which has a repository with pushing on. Every other real founder's code tasks would stop in "review". In live mode the "No artifact yet" state added on Nov 8 (`docs/DECISIONS.md:3342`) is reachable only for tasks marked `done` before Oct 31 or by a mock replay.
2. **The pieces for a hosted preview already exist inside the design check**: copy the workspace into E2B, install with the network open, close egress, start the project or a static server on port 4317, open pages (`session.ts:2629-2660`, `design-check.ts:111-138`, `packages/sandbox/src/browser.ts`). It is thrown away after two screenshots.
3. **A richer Planner prompt exists and is unused** (`prompts/planner.ts:22-56`).
4. **Persona portraits are the agents' faces** (`apps/api/src/services/personas.ts:1-5`), not customer personas; product research has no persona artifact kind.
5. **The public page is the only agent-authored thing a stranger can see, and the agent does not author it through a tool**: the foundations runner writes the draft; no agent can revise it later (no `pages.*` capability in `grants.ts`).
6. **`search_web` runs a model call on the platform key inside the gateway** (`web/index.ts:108-116`) with `resolveModel("worker")`; I did not find where that call is booked to the business's credits or own key. If it is not, turning `web` live gives every agent an unmetered platform-paid model call. Verify before 1.4.
7. **A GitHub installation token is installation-wide** (`github/index.ts:146-149`, `getInstallationOctokit`), isolated per business only because each founder has their own installation. A platform-owned organisation holding many projects under one installation would let one project's agent read another's repository (as a quarantined digest, but still read). Any 1.7 design on GitHub must mint per-repository tokens.
8. **The founder's first two approvals through the product both failed** (Nov 2 and Nov 6), and no agent-written change has reached main in the 19 days since the first agent pull request.
9. **Agents' pushes build on the founder's Vercel account before any review** (`DEPLOY.md:202`: `[skip ci]` does not stop Vercel). The preview URLs are public unless deployment protection is on. For a founder's own repository this is unreviewed agent code served from their domain.

---

## 8. The single most valuable thing to build: Foundmill Sites

**What.** A platform-owned project workspace with a hosted address: the team builds a small static site (a landing page with a waitlist, an offer or booking page, a sales page for a digital download), the founder opens a preview link the same day, presses Publish, and has `https://<slug>.<sites-domain>` to send to people, with three built-in things that make it a product and not a brochure: a form that creates real contacts, a pay button, and a file delivered after payment. It is the first slice of THESIS 1.7, cut to what a non-technical solo founder can finish in week one, and it removes A4-01, A4-02, A4-03, A4-10 and A4-18 for that founder. Software that needs its own database and sign-in stays on the GitHub path (improved by A4-04, A4-17) and gets a platform repository later.

**Why this and not "a GitHub repository for everyone".** A repository does not give the target user anything to open; hosting arbitrary server code under Foundmill's name is an abuse and security problem (finding 7.7, 7.9); and three of the four first products named in the brief are static pages plus a form, a payment and a file.

**Fit with decisions.** "Foundmill-owned repositories and hosting for software projects: yes, after pages and email are proven" (`docs/DECISIONS.md:3499`); pages hosted free at a Foundmill address (`:3497`); publishing is the founder's own press, never an agent tool (`pages.ts:12-14`; same shape as "Merges to main are the founder's", `DECISIONS.md:2959`); the SDK process stays confined with file tools only (SEC-3, `DECISIONS.md:748`); saved code lives in Postgres (`DECISIONS.md:815`); payments on the founder's own account (founder's-own-key rule, `DECISIONS.md:3838`); agents never move money or accept terms (CLAUDE.md "Never"); public pages work from 390 px (`DECISIONS.md:3454` item 1); north star counts "a page live ... a payment taken" (`DECISIONS.md` Nov 11, "Solo is complete", item 2).

**Architecture.**

1. *Workspace (business-level, in Postgres).* New tables, all with `business_id`, RLS (members read; writes by the service role only, like `workspace_snapshots`) and cross-tenant tests:
   - `sites` (`id, business_id unique, slug` (reuse the page's slug rules, `pageSlugProblem`), `status draft|live|taken_down`, `live_release_id`, `starter_key`, timestamps).
   - `site_releases` (`id, business_id, site_id, number, files jsonb` (manifest `{path, sha256, size}` over `workspace_blobs`), `file_count, total_bytes, parent_release_id, task_id, session_id, agent_id, state draft|preview|live|superseded|held, screening jsonb, design_check jsonb, approved_by, published_at`).
   - `site_forms` (`id, business_id, site_id, key, kind waitlist|contact|booking_request, fields jsonb, consent_text`) and `site_products` (`id, business_id, site_id, key, title, price_minor, currency, payment_link_url, payment_link_id, file_blob_sha256 null`).
   Limits: 200 files, 10 MB per release, text and image types only.
2. *Sessions.* `checkout.ts`: a third source beside "repository" and "none": `siteCheckout(db, businessId)` restores the latest non-held release (or the starter from `packages/agents/src/starters/static-site/`) into the session directory. `finishSession`: a code task whose destination is `site` saves a new `site_releases` row (`draft`) built from the workspace, and becomes `done` (the release is the reviewable unit, not the task), so dependents run and see each other's files. Two sessions writing at once: a release names its parent; the second save rebases file-wise and hands back on a same-file conflict (reuse `updateConflicts`' wording).
3. *Preview and serving.* A new small service `apps/sites` (Hono, like ingest) on its own registrable domain (never a subdomain of `foundmill.com`: cookies and origin isolation), wildcard host `<slug>.<sites-domain>` for live and `<slug>--r<number>.<sites-domain>` for previews (unguessable suffix, `noindex`). It reads the manifest and blobs through a service-role view that exposes only `preview|live` releases, sets a strict CSP (`default-src 'self'; script-src 'self'; form-action` the ingest origin; no third-party scripts), `X-Content-Type-Options`, long cache for hashed assets, and puts a CDN in front. The "Built on Foundmill" mark follows `tierShowsBuiltOnMark`. Deploy: one more Railway service (`railway/sites.toml`), `SITES_DOMAIN` env, wildcard DNS and certificate.
4. *Gates before a human sees it.* Deterministic screening on every release (`communityScreenLocalFlags` plus: no external script or iframe, no form posting anywhere but ingest, no password or card fields, link allow-list by scheme); the existing design check runs on the static site (it already serves `index.html`, `design-check.ts:133-137`) and its screenshots go on the approval; a second read compares the release with its parent (`boundedDiff` over manifests instead of `compare_refs`). A `request_changes` verdict goes back once (A4-12).
5. *Publish.* `site.publish({ releaseId })` in a new `apps/api/src/routers/site.ts`: owner or admin with Product write, their own press, exactly the checks of `publishPage`; writes `site.published` through the outbox and the milestone "Site live"; unpublish is one press. No agent capability reaches it. Inbox note from the Product lead: "Your site is ready to look at" with the preview link and Publish.
6. *Forms.* `apps/ingest` `POST /sites/:siteId/forms/:key`: Turnstile, per-address and per-site limits, the double opt-in and `contact_consents` path of the Follow form (`apps/api/src/services/pages.ts` `followPage`, ingest `/mail/confirm`), a CRM lead with source `site`, event `signup.created` so it shows in Customers and counts for the goal. The static starter ships a `<fm-form key="waitlist">` snippet whose script is served by `apps/sites` itself.
7. *Pay button and download.* Stripe on the founder's own account through hosted onboarding (the connector already has `start_connect_onboarding` and `create_checkout_session`, `packages/connectors/src/connectors/stripe/tools.ts:81, 111`); new tool `create_payment_link` (hints: no money moves; `ask` in augmented and assisted mode) granted to one agent (THESIS 1.6); the link is stored on `site_products` and rendered by `<fm-buy key="…">`. The Stripe webhook in ingest (already bound to the business, SEC-10/11) writes `payment.received` (already in the catalogue, `packages/events/src/catalogue.ts:668`) and, when the product has a file, emails a signed, expiring download link through platform mail. Refunds and payouts stay the founder's in Stripe.
8. *Planning.* `destination` (A4-05) becomes `site` for every new business without a repository; the archetype `firstBuild` for services and physical products becomes "An offer page with a price and a way to ask or pay"; the Planner's worker types for a site are `frontend_engineer` and `docs_writer` only.

**Screens.** Product › "Site" tab (new-screen skill: Dugout components, saved views, Storybook, Playwright): the preview in a frame at 390 px and desktop, the release list in the founder's words, Publish, the forms' sign-ups count, the pay buttons with their state. "Live product" (`founder-views.tsx`) shows the site's address. First-week day 2-3 reads "You are asked to look at your site and publish it".

**Events (packages/events, Zod, outbox).** `site.release_created`, `site.screened`, `site.published`, `site.unpublished`, `site.form_submitted`; reuse `deploy.succeeded` (`provider: "foundmill"`, `environment: preview|production`) so the existing Environments and "See it" columns light up with no new reader.

**Costs (Estimate).** Serving and storage are negligible at this size (10 MB cap per release in Postgres; move blobs to object storage when the table passes a few GB). Per release: one Sonnet coding session (cents to about 1 USD), one design check (two sandbox starts of a few minutes plus one Opus vision call), one second read (one Opus call). One extra always-on Railway service and a domain. Stripe fees are the founder's.

**Risks and how they are held.** Phishing or malware pages on a Foundmill-owned domain (strict CSP, no external scripts, deterministic screening, the founder's own press, a report link on every site, one-press takedown by Foundmill, rate limits on publish, the adult attestation already required at sign-up, a separate domain so a block-listing does not hit `foundmill.com`). Prompt injection through site content read back by agents (the site workspace is first-party like the Code-tab repository; form submissions are untrusted and go through the quarantined reader). Tenant isolation (service-role view per host, cross-tenant tests, no shared installation tokens). Scope creep into application hosting (static only; anything needing a server is told "this needs a repository" by the Planner). SEO and legal (noindex on previews; imprint and privacy text slots; the postal-address rule of 0101 for mail).

**Order of work.** (1) A4-01 short-term fix and the truthful copy of A4-03/A4-10; (2) tables, `siteCheckout`, release save, `apps/sites` with previews; (3) publish, screening, design check and second read on releases; (4) forms through ingest; (5) payment link and download; (6) Planner destination and archetype first builds; (7) the nightly outcome eval "idea → published site → a form submission appears in Customers" (THESIS 1.8).

**Done when.** A new account with no GitHub, on live models, reaches a published site with a working waitlist form in one sitting, a stranger's submission appears in Customers, a test payment produces a Customer Update, and the nightly eval proves it.
