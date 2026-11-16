# WP-04: The first session

**Goal:** from a kept idea card to a live public page in one sitting on any screen, with a small team shown, one plan to approve, at most three notes on day one, and a reason to come back tomorrow.

**Why:** 11 of 13 real projects ran 1 to 3 rounds on day one and were never opened again; no project has a page; each got 25 to 27 agents and 4 to 17 notes (`audits/e0-production-evidence.md`). The code explains it: `audits/a1-first-run.md` FR-03 to FR-05, FR-07 to FR-09, FR-15 to FR-19; `audits/s2-activation-growth.md` §2.2, §4.1, §5, §6; `audits/a2-console-design.md` A2-03, A2-05, A2-06, A2-10, A2-12; `audits/a3b-templates-skills-team.md` TS-06, TS-13, §2.2; `audits/a4-building-product.md` A4-16; `audits/a9-people-network-mobile.md` A9-P0-2, A9-P0-4; `audits/s1-design-critique.md` §3.4, §3.7 to §3.9.

**Done when (measured):**
1. `apps/web/e2e/first-session.spec.ts` passes at 390 x 844 and 1440 x 900: kept card to a published `/p/<slug>` in at most 6 screens (kept card, three questions, name and go, Today, the page, the page live with Share), with 2 required inputs (the name, prefilled, and the 18-or-older box), and `needs-larger-window` never renders on the path.
2. On live models the median from `idea.committed` to `page.published` is under 10 minutes (WP-02's funnel report; until it exists, one timed run by hand recorded in docs/PROGRESS.md).
3. A new project whose founder does not press Continue has at most 3 notes in `inbox_items` (state not `archived`) 24 hours after commit, and at most 3 emails that day (the sender's existing limit).
4. Commit and the first note show a starting team of at most 5 agents; no screen on the path shows a headcount of 25 or a wage total.
5. `evals/src/mentor.ts` passes offline in CI and live in the nightly run.

**Scope in:** the profile's first pass, the kept card's thread, Commit, what commit starts, the starting team as shown, the plan note, publishing and sharing on a small screen, the first-day story, Today's first-run guidance, the note budget, the founder's own task, the Chief of Staff's voice and founder context, lifecycle email content and kinds, shortcuts off by default, the one-click answer page.
**Scope out:** the landing page, the gate, the waitlist and its email, `NeedsLargerWindow`'s exits, the sign-in email (WP-03); funnel events, the north-star query, false claims elsewhere (WP-02); session runtime and reports (WP-05); skills at hire and the shared hire implementation (WP-06); allowances, routes, the overnight shift's cadence and pre-commit booking (WP-09); sidebar, type, contrast, the Agents tab's design (WP-10); the catch-up page drafts for the 13 old projects (WP-12).

**Depends on:** WP-02 (its string table for stale claims; its funnel report measures Done-when 2). T11 and T12 send nothing until WP-00 S2 and S3 are recorded in docs/DEPLOY.md.
**Collides with:** WP-06 in `apps/api/src/services/commit.ts` (hire): T3 and T4 land first or rebase. WP-05 in `apps/orchestrator/src/activities/*`: this package touches only `notify.ts` and `notify/rules.ts` there. WP-10 in `TodayScreen.tsx`, `keyboard.ts`, `packages/modules/src/team/SquadScreen.tsx`. WP-02 in `CardKeptView.tsx`, `CommitScreen.tsx` strings. Branch `claude/blissful-fermat-q03yq1` touches `packages/dugout/src/components/shell/{AppShell,PhoneBar}.tsx`: T13 changes `keyboard.ts` and `BusinessShell.tsx` only.
**Setup it needs:** WP-00 S2 (SendGrid's event webhook confirmed), S3 (recorded `LIVE_CONNECTORS`) for T11, T12 and T16. Everything else needs none.

**Rules for every task here.** One task, one pull request, branch `claude/wp04-t<n>`. Migrations take the next free number when the branch is cut (0108, journal idx 96, at `04a0a509`); renumber on rebase. No new business event is declared in this package: it uses `page.published`, `share.opened`, `inbox.item_created`, `notify.email_sent`. After every copy change run `node scripts/banned-terms.mjs`, `node scripts/us-english.mjs`, `node scripts/plain-language.mjs`.

**Recorded decisions this package builds on (do not re-decide):** 2026-11-11 "Retention plan: measurement and the return loop" (profile after the first idea; emails are templates, not model calls; the one-click rule); 2026-11-12 "One sender for every email from Foundmill" (3 a day per person, 1 a day per project, briefs outside the count); 2026-11-12 "Retention, part 2" (the overnight shift is one cycle and $0.15 a night); 2026-11-11 "Packages 1.2 and 1.3: the calls made" (the team never writes over the founder's page; "Later" answers the note); 2026-11-11 "Solo is complete; the north star"; 2026-11-13 "The outer product from 390 px" (one `phone` prop on `AppShell`, opt-in reflow with `PageGrid stack`). Two judgment calls of 2026-10-18 "The first days are about the product" are changed here and listed for the founder: item 2 (two sign-off notes; its own text says "Reversible: ... merge into one note") and item 7 (cycle 1 starts at commit with groundwork; "Reversible").

## Tasks

- [ ] T1 Profile as three questions; the card keeps its thread (M)
- [ ] T2 Commit as name and go, at any width (M)
- [ ] T3 What commit starts on the free plan (M)
- [ ] T4 The starting team, as shown (S)
- [ ] T5 One plan note, one approval (M)
- [ ] T6 Check, publish and share the page on any screen (M)
- [ ] T7 One first-day story; guidance on Today (M)
- [x] T8 Note budget and the day's digest (M)
- [ ] T9 The founder's own task and tomorrow's reason (M)
- [ ] T10 Chief of Staff as mentor, with founder context (M)
- [ ] T11 Lifecycle email for a started project (M, needs setup)
- [ ] T12 Email for a person with a card and no project (M, needs setup)
- [ ] T13 Single-key shortcuts off by default (S)
- [x] T14 The one-click answer page on a phone (S)
- [ ] T15 A phone start without a card (S)
- [ ] T16 Win-back for the 11 stalled projects (S, needs the founder)

Order: T1, T2, T3 first (the path), then T6, T5, T4, T7, T8; T9 to T16 in any order after T7.

### T1: Profile as three questions; the card keeps its thread   [M] [ships alone]

**Why:** FR-05, FR-08, FR-03 item 1, FR-19 (`ideaDraftToken`), A9-P0-2 item 1, s2 §4.1, s1 §3.4.

**Files:** create `apps/web/components/onboarding/FirstProfile.tsx`, `apps/web/components/onboarding/__tests__/FirstProfile.test.tsx`, a story `FirstProfile.stories.tsx` (390 and 1440). Modify `apps/web/app/onboarding/page.tsx`, `apps/web/components/onboarding/OnboardingScreen.tsx` (new accounts render `FirstProfile`; the long form stays for editing), `apps/web/components/new/card/CardKeptView.tsx`, `apps/web/components/providers/DesktopOnly.tsx`, `apps/web/e2e/onboarding.spec.ts`, `apps/web/e2e/idea-box.spec.ts`.

**Interfaces, existing:** `founder.profile.update` input `FounderProfileUpdateInput` (`apps/api/src/routers/founder.ts:105`); the create branch already fills `displayName` and needs only `confirmAdult: true` (`:191-203`). `founder.publicProfile.update({ handle?, content: { headline, about, strengths, wantsToLearn, lookingFor, place } })` (`PublicProfileInput`, `:82-91`) writes `founder_profiles.strengths` and `looking_for`. `LOOKING_FOR_QUESTION`, `LOOKING_FOR_OPTIONS`, `PERSON_TAGS_MAX = 8`, `PERSON_TAG_MAX = 30` (`packages/shared/src/person-profile.ts`). `safeNextPath(next, fallback)` (`apps/web/lib/auth/redirects.ts:60`). `StudioFrame({ smallScreen, width })`. `displayNameFromEmail` (`profile-form.ts:295`).
**Interfaces, new:** `OnboardingScreenProps.next?: string | null`; `FirstProfile({ email, via, next })`; `onboardingNext(raw: string | undefined): string | null` in `apps/web/lib/auth/redirects.ts`, which accepts only `/new/commit/<uuid>` and `/new/card/<uuid>`. No api change, no migration.

**Steps:**
1. Test first: `redirects.test.ts` cases for `onboardingNext` (a commit path passes; `//evil.example`, `/b/x`, an unknown path return null). verify: fails, then passes.
2. `FirstProfile`: one column, `StudioFrame smallScreen width="measure"`, title "Three quick things about you". Fields: (a) "What should your team call you?" text, prefilled from `displayNameFromEmail(email)`, required; (b) "What are you good at, or enjoy?" up to 8 tags, optional, with six suggestion chips (Design, Writing, Selling, Organizing, Building things, Teaching); (c) `LOOKING_FOR_QUESTION` with `LOOKING_FOR_OPTIONS`, "Building on my own" selected; then the existing `AdultCheck`. Button "Continue". On submit call `founder.profile.update({ displayName, confirmAdult: true, via })`; on success, when tags were added or the answer is not `on_my_own`, call `founder.publicProfile.update` with those two fields and empty strings for the rest, and never hold the person up if it fails (log, continue). Then `router.push(next ?? "/new")`. verify: component test asserts two required inputs, the second call's payload, and that a failed second call still navigates.
3. `OnboardingScreen`: `if (!editing) return <FirstProfile …/>`; the existing form is unchanged for `editing`. Remove the "Welcome aboard / Next: ideate a concept or import what already exists." toast from the create path. Stop sending `ideaDraftToken` (no step reads it). verify: `OnboardingForm.test.tsx` still passes for editing.
4. `page.tsx`: read `searchParams.next` through `onboardingNext`, pass it down; the signed-out redirect keeps it. `CardKeptView`: `next = profileComplete ? /new/commit/<id> : /onboarding?next=/new/commit/<id>`.
5. Add `"/onboarding"` to `SMALL_SCREEN_PREFIXES`. An existing account editing the long form on a phone is out of scope: when `editing` and the viewport is small, render the three questions prefilled instead of the long form. verify: `desktop-only.test.tsx` gains `/onboarding`.
6. Copy (before → after):

| Where | Before | After |
| --- | --- | --- |
| `CARD_KEPT_WORDS.lede` | "It is saved in your deck. Your team starts from your words and checks every number against real sources." | "It is saved in your account. Your team starts from your own words." |
| `CARD_KEPT_WORDS.profileNext` | "Answer three questions about you" | "Three quick things about you" |
| `CARD_KEPT_WORDS.profileWhy` | "Founder fit, and the plan your team drafts, come from what you can put in: your time, your money and what you are good at." | "So your team knows what to call you and what you like doing. It takes under a minute." |
| Onboarding lede (new account) | "Foundmill drafts concepts, hires the team and runs the business within your constraints. Four quick answers are enough to start; add detail when you have it." | "So your team works the way you do. You can change any of it later." |

**Tests and evals:** the unit and component tests above; `onboarding.spec.ts` rewritten for the three questions at 390 and 1440; `idea-box.spec.ts`: after keeping a card and saving, the URL is `/new/commit/<id>`. No agent behavior changes, so no eval.
**Done when:** a new account on a phone goes kept card → three questions → Commit without a wall; the long form is reachable only when editing.
**Left for later, on purpose:** re-rating "Founder fit" after the profile (FR-15) is one more Opus call for a number a first-timer cannot use; the card keeps `founderFitKnown={false}`. Time, place, budget and the five ratings stay in the editing form; an agent asks when it first needs one (T10's context carries nulls as "not said").

### T2: Commit as name and go, at any width   [M] [ships alone]

**Why:** FR-09, FR-03 item 2, FR-16 (weak strings), FR-19 (the 18+ source), s2 §4.1 (Commit table), s1 §3.7.

**Files:** modify `apps/web/components/new/commit/CommitScreen.tsx`, `apps/web/components/new/commit/naming.ts`, `apps/web/components/new/StudioFrame.tsx` (step label), `apps/web/components/providers/DesktopOnly.tsx`, `apps/web/components/new/__tests__/CommitForm.test.tsx`, `apps/web/e2e/commit.spec.ts`, `e2e/tests/golden-path.spec.ts` (labels only), `docs/DESIGN.md` (the Commit paragraph, two lines).

**Interfaces, existing:** `idea.commit` input (`apps/api/src/routers/idea.ts:328`) is unchanged; `initialCommitForm(idea, kit, currency, …)` (`naming.ts:325`); `runsOpen` (`CommitScreen.tsx:505`); `WHAT_HAPPENS_NEXT` (`:238`); `includedCreditsLine()` (`:246`); test ids `take-charge`, `take-charge-bottom`, `commit-form` stay.
**Interfaces, new:** none on the wire. In the file: `const [moreOpen, setMoreOpen]` replacing `runsChosen`; one disclosure `data-testid="commit-more"` labeled "More options".

**Steps:**
1. Test first (`CommitForm.test.tsx`): with guidance on or off, the default render shows the name field, the credits line, three "what happens next" lines and one button; the name-check, logo, "How it runs" and team panels are absent until "More options" is pressed; a validation error inside opens it. verify: fails, then passes.
2. Restructure the form into one column (max width `measure`) that reads the same at 390 and 1440: Name panel (with suggestions), `ReassuranceLine` "You can change the name, the logo and how your team works any time.", what happens next, credits line, the button. Move the four panels (name checks, logo and colors, How it runs with all its controls, the team preview from T4) under "More options", closed for everyone. Do not call `idea.domainCheck` until the disclosure opens (today it fires on every name change). verify: test asserts no `domainCheck` call on load.
3. Pass `smallScreen` to every `StudioFrame` in the file; add `/^\/new\/commit\/[0-9a-f-]{36}\/?$/i` to `SMALL_SCREEN_PATTERNS`. Buttons `size="lg" className="min-h-tap w-full @page-wide:w-auto"`.
4. Read the 18-or-older record from `founder.profile.get.adultConfirmed` instead of `live.summary` (`:106`).
5. Remove the wage line (`squad-preview-wages`, `:876-877`) from default view; it stays inside "More options" only while Builder view is on.
6. Copy:

| Where | Before | After |
| --- | --- | --- |
| Title (`:514`) | "Commit to {name}" | "Start {name}" |
| Lede (`:519-523`) | "Name it, give it a logo, choose how it is run. Taking charge hires the team, which starts by drafting your vision, specification and roadmap." | "Check the name and start. Your team drafts your public page first, from your own words." |
| Button (`:531`, `:906`) | "Take charge" / "Setting up…" | "Start my project" / "Starting…" |
| Step trail label | "Launch" | "Start" |
| Error toast (`:136`) | "Not committed" | "That did not start" |
| `WHAT_HAPPENS_NEXT` | the four lines quoted in a1 §1.9 | T7's `FIRST_DAY_PROMISE` |

**Tests and evals:** the component test; `commit.spec.ts` at 390 and 1440 (name prefilled, one press reaches Today); golden path label updates.
**Done when:** a first-timer sees one field and one button; nothing on the default view names a domain, a trademark, a spend line, a mode or a wage.

### T3: What commit starts on the free plan   [M] [ships alone]

**Why:** FR-04 items 2 and 3 (item 1, the measurement, is WP-02; item 4, the exit at zero, is WP-09), s2 §5.3 ("A first-timer with $0"), TS-13 (the spend line), e0 (blocked: finance 8, legal 17, research 55).

**Assumption to state in the pull request:** with no task ready, cycle 1 has nothing to dispatch and only costs a Chief of Staff plan and notes. The first cycle then starts from the plan's approval (`startBuilding` → `startCycle`), a press of Continue, or the first overnight shift. `cycleStatus` numbers cycles from history (`nextCycleNumber: maxNumber + 1`, `apps/api/src/services/cycle.ts:197`), so a project with no cycle 1 at commit is valid.

**Files:** modify `packages/agents/src/archetypes.ts`, `apps/api/src/services/commit.ts`, `apps/web/components/new/commit/naming.ts`, `apps/api/src/__tests__/idea-commit.test.ts`, `packages/agents/src/__tests__/archetypes.test.ts`, `apps/orchestrator/src/__tests__/` (autopilot decide test, one case), `docs/ARCHITECTURE.md` §19 (two lines).

**Interfaces, existing:** `ArchetypeSeed.firstCycleTasks`, `FINANCE_TASK`, `LEGAL_TASK`, `OPEN_QUESTIONS_TASK` (`archetypes.ts:124-156`); `commitIdea(db, temporal, userId, input, importKey, deps)` (`commit.ts:171`); the cycle start at `commit.ts:436`; `startAutopilotWorkflow` (`apps/api/src/services/autopilot.ts:92`); `DEFAULT_SPEND_CAP_MINOR` (`naming.ts:280`).
**Interfaces, new:** `firstCycleTasksFor(seed: ArchetypeSeed, founder: { hasBudget: boolean }): FirstCycleTask[]` exported from `archetypes.ts`: without a budget it drops tasks of kind `finance` and `legal`; with one it returns the seed's list. `CommitIdeaResult.cycle` becomes `TemporalResult | null`.

**Steps:**
1. Tests first: (a) `archetypes.test.ts`: `firstCycleTasksFor(b2b_saas, { hasBudget: false })` holds only the open-questions task; with a budget, all three. (b) `idea-commit.test.ts`: a founder with `budgetMinor` null gets one ready task and `temporal.start` is not called with `WORKFLOWS.businessCycle`; the page and foundations still start on first open; a founder with a budget gets today's behavior. verify: fail, then pass.
2. `commit.ts`: load the founder's profile once (it is already read in `routers/idea.ts:362`; pass `hasBudget: (profile?.budgetMinor ?? 0) > 0` in), seed with `firstCycleTasksFor`, and start cycle 1 only when `hasBudget`. Keep the Autopilot start as is. The open-questions task stays `ready`, so the first overnight shift (one cycle, $0.15 cap, decision of 2026-11-12) or the plan's approval picks it up.
3. Orchestrator: add one case to the autopilot decision test: a project with zero cycles and one ready task starts cycle 1 at its first scheduled look, and a project with zero cycles and zero ready tasks is not counted as an idle night. verify: `pnpm --filter @foundmill/orchestrator test autopilot`. If the second assertion fails, fix `decideAutopilot` in the same pull request and say so.
4. Spend line: in `initialCommitForm` take `hasBudget`; without a budget the spend cap field starts at "0". Before changing it, read the test for `parseSpendCapMinor` and the policy's use of `spend_cap_minor` and confirm 0 means "ask before any spend" rather than "no cap" (`null` is no cap today, `commit.ts:210`). verify: an api test that a business with `spend_cap_minor = 0` asks for approval on a 1-cent spend. If 0 does not mean that, leave the default and record it in docs/DECISIONS.md.
5. Record in docs/DECISIONS.md: what starts at commit for a profile with no budget, and that 2026-10-18 item 7 is narrowed (founder decision 1 below).

**Tests and evals:** as above, plus `apps/web/e2e/first-days.spec.ts` (Today after commit shows no running cycle and no finance or legal task). No eval: the planner prompt is unchanged.
**Done when:** a no-budget project commits with one task, no agent session before the page note, and less than $1.00 spent in its first hour (Estimate; WP-02's cost report confirms).

### T4: The starting team, as shown   [S] [ships after T2]

**Why:** s2 §5.3 ("25 agents and up to 17 notes on day one"), s1 §3.7 and §3.8, a3b §2.2, FR-16 row 2.

**Decision taken here, flagged for the founder (decision 2):** hire everyone as today and show a starting team; do not hire lazily. Reason: tasks, channels, department leads and the planner all look agents up by template (`agentIdByTemplate`, `commit.ts`); hiring on demand touches the planner, `startBuilding`, `startDistribution` and the channel engines, which WP-05 and WP-06 are editing. Showing a small team fixes what the founder meets at a tenth of the change, and is undone by deleting one constant.

**Files:** modify `packages/agents/src/archetypes.ts`, `apps/api/src/services/commit.ts` (`welcomeNote` input only; words in T7), `apps/web/components/new/commit/CommitScreen.tsx`, `packages/modules/src/team/SquadScreen.tsx`, tests beside each, a story for the preview.

**Interfaces, new:** `export const STARTING_TEAM_TEMPLATE_KEYS: readonly string[] = ["chief_of_staff", "product_lead", "researcher"]` in `archetypes.ts`; `startingTeam<T extends { templateKey: string }>(agents: readonly T[]): { starting: T[]; later: T[] }`. `welcomeNote` input drops `agents` and `departments`.

**Steps:**
1. Test first: `startingTeam` splits the `b2b_saas` preview into 3 and 24, and every key in the constant exists in every archetype seed. verify: fails, then passes.
2. Commit's team panel (inside "More options" after T2, and as one line on the default view): "Your starting team: {Chief of Staff}, {Product lead} and {Researcher}. {n} more join as the work needs them." The full list sits behind "See everyone". No model chips or wage figures outside Builder view.
3. `SquadScreen`: while `today.get.firstWeek` is not null, the default view shows `starting` plus any agent with a current task, with a caption "Showing who is working this week" and a button "Show all {n}". The saved-view mechanism (`SIMPLE_VIEW_ID`, `:43`) stays. If WP-10 has opened a pull request on this file, hand this step to it and note that in PROGRESS.
**Tests and evals:** unit test; `CommitForm.test.tsx` (the line); `apps/web/e2e/first-days.spec.ts` (Agents tab lists at most 5 rows before "Show all").
**Done when:** no first-run surface shows more than 5 agents unasked.

### T5: One plan note, one approval   [M] [ships alone]

**Why:** A4-16, FR-07, THESIS 1.3; e0 (founders answered 0 to 1 decisions).

**Files:** modify `packages/agents/src/foundations.ts` (`foundationsSignoffNotes`), `packages/db/src/repos/foundations.ts` (`apply`, `ApplyFoundationsOptions`), `packages/db/src/repos/product-signoffs.ts`, `apps/api/src/services/signoff.ts`, `apps/api/src/services/foundations.ts:290` and the orchestrator's caller of `repos.foundations.apply` (`apps/orchestrator/src/activities/foundations.ts`), `packages/shared/src/first-week.ts`, tests: `apps/api/src/__tests__/signoff.test.ts`, `foundations.test.ts`, `packages/agents/src/__tests__/foundations.test.ts`, `apps/web/e2e/foundations.spec.ts`.

**Interfaces, existing:** `productSignoffsRepo.open(db, businessId, { kind, item, snapshot?, specVersionId? })` (`product-signoffs.ts:120`), `.forInboxItem`, `.latest`, `.decide`; `decideProductSignoff(ctx, { kind, decision, notes })` (`signoff.ts:172`); `decideSignoffItem(ctx, item, signoff, input)` (`:371`); `startBuilding(ctx)` (`:302`); `reopenSpecSignoffAfterPublish` (`:537`); `signoffDecisionBlock(kind)`.
**Interfaces, new:** `PLAN_READY_NOTE = { key: "product.plan_ready", subject: "Your plan is ready", approveLabel: "Approve the plan", changeLabel: "Ask for changes" }` in `packages/shared/src/first-week.ts`; `foundationsSignoffNotes` returns `{ plan: NoteDraft }` (the `spec` and `roadmap` drafts stay for the re-ask); `open` gains `inboxItemId?: string` (attach the round to an existing note instead of creating one); `productSignoffsRepo.attach(db, businessId, signoffId, inboxItemId)`; `decidePlanNote(ctx, item, input)` in `signoff.ts`. The two `product_signoffs` rounds stay in the data. No migration.

**Steps:**
1. Tests first (`signoff.test.ts`): (a) applying foundations writes one decision note with `decision.key = "product.plan_ready"` and two pending rounds pointing at it; (b) Approve approves both rounds in one transaction, publishes the specification version, snapshots the roadmap and calls `startBuilding` once; a second Approve answers `already_decided`; (c) "Ask for changes" with words sends the specification round back with those words, creates one revision task, leaves the roadmap round pending; (d) when the revised specification is published, the re-ask is the plan note again and the pending roadmap round is attached to it. verify: fail, then pass.
2. Extract the body of `decideProductSignoff`'s `ctx.rls` callback into `decideRoundTx(tx, ctx, input)`; `decidePlanNote` calls it for `spec` then `roadmap` inside one `ctx.rls`, then `startBuilding`. `decideSignoffItem` routes to `decidePlanNote` when the item's `decision.key` is the plan's.
3. The note's body, five lines at most, from the draft: what gets built first (first Now item), who it is for (the vision's audience line), what you will be able to open (the first roadmap item's outcome), what it costs ("Nothing until you approve a spend."), and "Read the full plan" linking to Plan › Roadmap. Subject before: "Sign off the product specification" and "Sign off the product roadmap". After: "Your plan is ready".
4. `first-week.ts` Day 1 words: before "You are asked to publish your page and sign off the specification and the roadmap." After "You are asked to publish your page and approve your plan." `FirstWeekFacts` keeps both dates.
5. The plan note does not hold Continue before the page is published (`blocks_continue: false` while `project_pages.published_at` is null, true after), so the page is the only thing asked first. verify: api test on both states.

**Tests and evals:** above; `evals/src/foundations/` gains one structure check that the plan note has at most five lines and no figure the draft does not contain. `foundations.spec.ts`: one Approve starts the build.
**Done when:** a new project gets one plan note; one press approves it.

### T6: Check, publish and share the page on any screen   [M] [ships alone]

**Why:** FR-03 item 3, A9-P0-2 items 3 and 4, s2 P0-2 and §2.2 rows 10 and 11.

**Smallest change chosen:** let the existing Public page tab render in the shell's phone mode, instead of a second publish surface. A9's "Publish it as drafted" option is not built: publishing unread words is a worse first act than reading them, and the tab already has the confirm dialog and the hold screen.

**Files:** modify `apps/web/components/providers/DesktopOnly.tsx`, `packages/modules/src/product/PublicPageScreen.tsx`, `apps/web/components/today/TodayScreen.tsx` (nothing but the test id if needed), `apps/web/e2e/public-page.spec.ts`, `apps/web/e2e/phone-today.spec.ts`; create `apps/web/e2e/first-session.spec.ts`.

**Interfaces, existing:** `page.get` → `PageView`, `page.saveDraft`, `page.publish({ content })` → `{ outcome: "published" | "held", … }` (`apps/api/src/services/pages.ts:218`); `routes.department(bid, deptSlug, tabSlug)` = `/b/<bid>/d/<deptSlug>/<tabSlug>`; `moduleTabHref(bid, rows, "product", "public-page")`; `SharePost` (`packages/dugout/src/components/share/SharePost.tsx`); `starterPageDraft` (`packages/shared/src/project-page.ts`).
**Interfaces, new:** one entry in `SMALL_SCREEN_PATTERNS`: `/^\/b\/[0-9a-f-]{36}\/d\/[^/]+\/public-page\/?$/i`.

**Steps:**
1. Test first: `desktop-only.test.tsx` (the pattern matches the tab and no other department tab); `first-session.spec.ts` at 390 x 844: sign in with the developer bypass holding a card → keep → three questions → Start my project → Today → "Check it and publish" → Publish → confirm → the link is shown → `/p/<slug>` answers 200 signed out; assert `[data-testid="needs-larger-window"]` never appears and count 6 screens and 2 required inputs. verify: fails at the tab.
2. `PublicPageScreen`: the two `Panel span={6}` stack in one column in a narrow container (the opt-in pattern of 2026-11-13: container queries on the screen's own `@container` root); the preview goes below the form; Publish, Copy link and Share are `size="lg" min-h-tap`, full width when narrow. Confirm the phone frame draws the page title and a way back to Today; if the department tab bar is drawn in phone mode, hide it for this route.
3. After a successful publish on a narrow screen, open the existing share panel in place with the message "I'm starting {project}. {pitch} Would you use this? {url}", and use `navigator.share` when present (the press still records `share.opened` with `kind: "page"`). On desktop keep today's buttons and add the same prefilled message to Copy.
4. While the Product lead's draft has not arrived, the tab already shows `starterPageDraft`; add one line above it: "This is a first draft from your own words. Your team's version replaces it in about a minute; your edits are never overwritten." verify: `pages.test.ts` already proves the team writes only when there is no row.

**Tests and evals:** as above, both widths; Storybook story of the screen at 390.
**Done when:** Done-when 1 of this package passes.

### T7: One first-day story; guidance on Today   [M] [ships after T5 and T6]

**Why:** FR-07, FR-16 rows 2 and "also weak", FR-18 (tour), A2-05, A2-06 (Today only; the other screens are WP-10), A2-10, s1 §3.8 and §3.9.

**Files:** modify `packages/shared/src/first-week.ts` (+ test), `packages/shared/src/empty-why.ts`, `apps/api/src/services/commit.ts` (`welcomeNote`), `apps/web/components/new/commit/CommitScreen.tsx`, `apps/web/components/today/TodayScreen.tsx`, `apps/web/components/tours/definitions.ts`, `packages/config/src/dashboard-presets.ts` (retire the `first_week_checklist` widget from the founder preset), `apps/web/e2e/today.spec.ts`, `phone-today.spec.ts`, `tours.spec.ts`.

**Interfaces, new:** `FIRST_DAY_PROMISE: readonly string[]` in `first-week.ts`: ["Your page is drafted first, from your own words. About a minute.", "You check it and publish it. Then you have a link to send.", "Your plan arrives as one note to approve.", "Nothing costs money or goes out in your name unless you say so."]. `TODAY_TOUR` (id `"today"`, three steps: `needs-you` "What needs you", `first-week-timeline` "Your first week", `continue` "Continue: one round of work") in `definitions.ts`; completing it also marks `home` done.

**Steps:**
1. Test first: a unit test that `welcomeNote(...).bodyMd`, `WHAT_HAPPENS_NEXT` and `emptyWhy("today_needs_you", { firstDays: true }).text` contain no "specification", "roadmap" or "two notes", and that the first two share `FIRST_DAY_PROMISE` lines. verify: fails, then passes.
2. Copy:

| Where | Before | After |
| --- | --- | --- |
| Welcome note subject | "Your team is drafting the product foundations" | "{Project} has started" |
| Welcome note body | the house-rules line + "The team is hired: N agents in M departments." + the two-notes paragraph + the distribution line | "Hi {name}. {Project} is yours, and it has started." + "{Product lead} is drafting its public page from your own words. In about a minute you can check it and publish it." + "After that your plan arrives as one note. Nothing costs money or goes out in your name unless you say so." |
| Commit toast | "Your team is drafting the vision, specification and roadmap; two notes will ask you to sign them off." | "Your page is being drafted now. You will check it first." |
| Needs-you empty, first days | "Nothing needs you yet. Your first notes, the specification and the roadmap to sign off, arrive once the team finishes drafting them, usually on day 1." | "Nothing needs you yet. Your page is being drafted and will show here in about a minute." |

   `welcomeNote` takes `displayName` and `businessName` (the profile is loaded at `routers/idea.ts:362`).
3. Today's order. Desktop: while a page-ready note is open or `pageReady` is true and nothing is published, render Needs you first at `span={12}`, then the first-week panel, then the goal. Phone (`PageGrid stack`): Needs you, the public-page line, first week, goal, week plan, since-last-visit, streak, health. Hide the health tiles and the streak until day 2 of the project (s1 §3.8: four empty figures on day one). verify: `today.spec.ts` asserts DOM order at both widths.
4. Mount `TODAY_TOUR` from `TodayScreen` through the existing `LazyTour`, never on a phone, starting on the second visit. One "Your first week" only: remove the checklist widget from the founder preset.
5. Add an `Explainer` to `TodayScreen` (three lines: what Today is, what Needs you is, what Continue does) and draw `ExplainPageButton` in the phone title row for Today only.

**Tests and evals:** above; `evals/src/founder-strings.ts` gains the new strings.
**Done when:** every first-day surface tells the page-first story in the same words, and Today leads with the one thing to do.

### [x] T8: Note budget and the day's digest   [M] [ships alone]

**Why:** s2 §5.3 (decision budget; digest), e0 (4 to 17 notes on day one; 47 updates and 32 warnings unread), FR-07.

**Design (smallest that holds at one choke point):** in a project's first 7 days, an agent's plain update (type `update` or `report`, no decision, not holding Continue, not from the Chief of Staff) is stored archived and listed in one Chief of Staff note, "What your team did today", which replaces itself (updates from one agent already supersede: `supersedeUpdates`, `packages/db/src/repos/inbox.ts:444`). Decisions, approvals, warnings, wins, milestones and people's messages are never folded. The goal proposal waits for the page.

**Files:** create `packages/shared/src/note-budget.ts` (+ test). Modify `packages/db/src/repos/inbox.ts` (`createItem`), `apps/api/src/services/goals.ts` (`ensureGoal`), `packages/config/src/limits.ts`, tests `packages/db/src/__tests__/inbox-note-budget.test.ts`, `apps/api/src/__tests__/goals.test.ts`.

**Interfaces, new:** `LIMITS.firstWeekNotesPerDay = 3`, `LIMITS.firstWeekDays = 7`. `noteVerdict(f: { type: InboxItemType; hasDecision: boolean; blocksContinue: boolean; fromChiefOfStaff: boolean; committedAt: Date | null; isDemo: boolean; now: Date }): "deliver" | "fold"`. `digestBody(lines: readonly { agentName: string; subject: string }[]): string` (a template, no model call; at most 8 lines, then "and {n} more in the Inbox"). `DIGEST_SUBJECT = "What your team did today"`.

**Steps:**
1. Tests first: `noteVerdict` table (a decision delivers; a lead's update on day 2 folds; the same on day 9 delivers; a demo business always delivers; a warning delivers). Repo test: three agent updates on day one leave one unread Chief of Staff note listing three lines and three archived rows; a decision in between is untouched. verify: fail, then pass.
2. `createItem`: after parsing, load `businesses.committed_at`, `is_demo` and the Chief of Staff's id once; on "fold" insert with `state: "archived"` and upsert the digest (create the Chief of Staff update with `digestBody`, which supersedes the earlier one, the welcome note included once the founder has a first digest). Callers pass nothing new. `inbox.item_created` is still written by the callers that write it today.
3. `ensureGoal`: propose nothing while the project is under 24 hours old or its page is unpublished, whichever ends first (one condition before `writeProposal`).
4. SQL for Done-when 3, to put in the pull request: `select b.id, count(*) from inbox_items i join businesses b on b.id = i.business_id where not b.is_demo and i.type <> 'human_message' and i.state <> 'archived' and i.created_at < b.committed_at + interval '24 hours' group by 1;`
**Tests and evals:** above; `evals/src/composer.ts` unchanged (the digest is a template).
**Done when:** a project left alone on day one holds the welcome or digest note, the page note and the plan note, and nothing else unarchived.
**Risk:** an update a founder wanted is one click further away. The digest links each line to its note.

### T9: The founder's own task and tomorrow's reason   [M] [ships after T7]

**Why:** s2 §5.1 (the session's end), §6.4 ("One thing to do today … Not built"), THESIS R7; onboarding skill: one goal per session, end on a positive note.

**Files:** create `packages/shared/src/founder-task.ts` (+ test), `packages/dugout/src/components/today/FounderTaskPanel.tsx` (+ story, + test). Modify `apps/api/src/services/today.ts`, `apps/web/components/today/TodayScreen.tsx`, `apps/api/src/__tests__/today.test.ts`, `apps/web/e2e/today.spec.ts`.

**Interfaces, new:**
```ts
export type FounderTaskId = "publish_page" | "share_page" | "approve_plan" | "ask_five";
export interface FounderTask { id: FounderTaskId; title: string; why: string; action: { label: string; kind: "open_page" | "share" | "open_note" | "copy"; text?: string }; tomorrow: string }
export interface FounderTaskFacts { pagePublished: boolean; pageShared: boolean; planNoteOpen: boolean; outsideSignal: boolean; projectName: string; pitch: string | null; url: string | null }
export function founderTaskOf(f: FounderTaskFacts): FounderTask | null
```
`TodayView.founderTask: FounderTask | null` (null for a sample business and for a member without Product read). Facts come from rows that exist: `project_pages.published_at`, an event `share.opened` with `kind: "page"`, the open plan note, an event `page.followed` or `lead.replied`. No table, no event, no model call. WP-08 adds outreach tasks by extending `FounderTaskId` and the function; it must not add a second panel.

**Steps:**
1. Test first: the order is publish → share → approve plan → ask five; each returns the words below; null when all are done. verify: fails, then passes.
2. Words. publish_page: "Check your page and publish it" / "It is the first thing of yours that people outside can see." share_page: "Send your page to three people" / "Ask if they would use it. What they say shapes what your team does next." with the message from T6. approve_plan: "Read your plan and approve it" / "Five lines. Your team starts building when you do." ask_five: "Ask five people the question on your page". `tomorrow` for each: "Tomorrow morning: what your team found overnight, and one thing to do." (shown only when the overnight shift is on; otherwise "Come back when you have heard from someone, or press Continue for a round of work.").
3. `FounderTaskPanel` (`span={12}`, first on Today after Needs you): title "Your one thing today", the task, its button, and under a rule the `tomorrow` line. One per day: once done, it reads "Done for today." with the next task named for tomorrow.
4. `today.ts`: compute the facts in the existing read; no extra round trip from the web.
**Tests and evals:** above; Storybook states (each task, done, none).
**Done when:** Today always names one thing the founder can finish in minutes, and says what happens next.

### T10: Chief of Staff as mentor, with founder context   [M] [ships alone]

**Why:** TS-06, TS-13 (examples), FR-16 row 2, a3b §3.3 (Composer and conversation rows), THESIS §12.6.

**Files:** create `packages/shared/src/founder-context.ts`, `evals/src/mentor.ts`, `evals/src/__tests__/mentor.test.ts`. Modify `packages/db/src/repos/founders.ts`, `packages/agents/src/prompts/club-rules.ts`, `packages/agents/src/templates/chief_of_staff.ts`, `packages/agents/src/voice.ts`, `packages/agents/src/conversation.ts`, `packages/agents/src/prompts/inbox-composer.ts`, `packages/agents/src/prompts/agent-conversation.ts`, `apps/orchestrator/src/activities/brief.ts`, the api callers that build conversation and composer inputs, `evals/src/index.ts`.

**Interfaces, new:**
```ts
export interface FounderContext { firstName: string | null; experience: FounderExperience; strengths: string[]; wantsToLearn: string[]; lookingFor: PersonLookingFor; budget: "none" | "some" | "not_said"; others: { firstName: string }[] }
repos.founders.contextFor(db: Executor, businessId: string, userId: string): Promise<FounderContext>
```
`ConversationRequestInput.founder?: FounderContext`; `InboxComposerVariables.founder` (JSON, a trusted input block, never spliced into instructions); a "## Founder" section in the cycle brief. Voice register `mentor` for the Chief of Staff's template family.

**Steps:**
1. Test first: `mentor.test.ts` (offline, runs in CI): the built Chief of Staff conversation prompt and Composer prompt contain the founder block; `HOUSE_RULES_FOUNDER_LINE` has no "only read and decide"; no template example in `chief_of_staff.ts` contains "€" or a spend above $0 as the recommended first move. verify: fails, then passes.
2. Words. `HOUSE_RULES_FOUNDER_LINE` before: "I'm your Chief of Staff. I run the team so you only read and decide. Some things are always yours: money, signatures, contracts, deleting things." After: "I'm your Chief of Staff. I run the team beside you and tell you what matters and why. Some things are always yours: money, signatures, contracts, deleting things." Role line (`chief_of_staff.ts:21`) before: "you run the cycle so the founder only has to read the Inbox and decide." After: "you run the cycle and help the founder learn to run this project: say what happened, what it means, and the one decision that is theirs, with its reason."
3. Mentor rules, each with its reason, added to the Chief of Staff's instructions only: use the founder's first name when known; for `first_time`, explain one idea per decision in a sentence, where it is used; mark a first when it happens (first page live, first follower); recommend the free option first when `budget` is "none" or "not_said"; one person is a complete team (never suggest finding a cofounder; "people to build it with, if you want them" only when asked); never give a reason to be here that names jobs or employment. Replace the "€500 on LinkedIn ads" example with a no-budget one (a reply that asks five people from the founder's own contacts).
4. `contextFor`: `firstName` is the first word of `displayName`; `others` are the other owners' first names; a missing field is "not_said", never a guess.
5. Live eval `evals/src/mentor.ts` (nightly, skipped without a key): four cases (first-timer with no budget; operator; two cofounders; a founder with no name) scored on: addresses the person by first name when present; at most one explained idea; the recommended option costs nothing in case 1; none of `SUBTEXT_PATTERNS` (`evals/src/team-call.ts`) match; no sentence says someone is missing.
**Tests and evals:** above; existing `evals/src/composer.ts` and `conversation/` suites must still pass.
**Done when:** the eval passes live, and a welcome note, a decision note and a conversation reply for a first-timer all use their name and recommend a free first move.

### T11: Lifecycle email for a started project   [M] [needs setup: WP-00 S2, S3]

**Why:** s2 §6.1 to §6.3, A9-P0-4 items 2, 3 and 5. Build with the mock passing; sends nothing live until S2 and S3 are recorded.

**Files:** migration `packages/db/migrations/<next>_lifecycle_email_kinds.sql` (+ journal). Modify `packages/shared/src/constants.ts`, `packages/shared/src/notify-email.ts` (labels, hints), `packages/shared/src/notify-words.ts`, `apps/orchestrator/src/notify/rules.ts`, `apps/orchestrator/src/activities/notify.ts`, `apps/gateway/src/notify-email.ts`, `apps/web/components/settings/EmailNotificationsSection.tsx`, tests beside each, `apps/web/e2e/return-loop.spec.ts`.

**Interfaces, existing:** `EMAIL_NOTIFICATION_KINDS`, `DEFAULT_EMAIL_NOTIFICATION_PREFS`, `LIMITED_EMAIL_KINDS` (`constants.ts:621-631`); `RetentionEmailPlan`, `retentionEmail(plan, ctx)`, `briefIsEmpty` (`notify-words.ts`); `planNotifications(b, r)`, `dedupeKeyOf` (`rules.ts`); `RETRY_REASONS` (`activities/notify.ts:22`); `NOTIFY_PER_PERSON_PER_DAY = 3`; `sendNotifyEmail(deps, input, service)`.
**Interfaces, new:** kinds `getting_started` (label "Help while you set up") and `checkin` (label "When your project has been quiet"), both in `LIMITED_EMAIL_KINDS` (they count toward three a day). Plans: `{ kind: "getting_started"; stage: "page_ready" | "page_live" | "ask_five"; task: FounderTask }` and `{ kind: "checkin"; days: 14 | 30 | 60; nextStep: FounderTask | null }`. Migration: drop and re-add `founder_notifications_kind_check` with the two kinds, as 0091 and 0097 did; no table, no policy change.

**The sequence (one job each; skipped the moment its action is done; never while the person is present; never on vacation):**

| When | Kind | Condition | Subject | One action |
| --- | --- | --- | --- | --- |
| 30 min after leaving, day 0 | `getting_started` page_ready | page drafted, not published | "Your page for {project} is ready to check" | Check my page |
| At publish | `milestone` (exists) | first publish | "Your page for {project} is live" | Share my page |
| Day 1, the brief's hour | `daily_brief` first edition | first 7 days: sent even with no news, carrying the founder task | "{project}, day 2: one thing to do today" | Open Today |
| Day 3 | `getting_started` ask_five | page live, no second real outcome | "Five people, one question" | Copy the message |
| Day 7 | `weekly_review` first edition | whatever the weekday | "{project}: your first week" | Answer the oldest decision, or publish |
| Day 14, 30, 60 with no visit | `checkin` | not archived; stops after the third | "{project} is still here" / "Keep {project} or archive it?" (day 60) | the one next step |

Bodies are s2 §6.3's, edited to the emails skill (reason first, one action, no stock opener, no fake reply, at most one dash). Day 0 body: "Hi {name}, your page for {project} is drafted from your own words. Read it, change what you like and publish it, and you have a link you can send to anyone. Nothing is public until you press Publish." Day 3 body: "Hi {name}, your page has been live for two days. Send the link to five people who might want {project} and ask whether they would use it. A message you can paste: “I'm starting {project}. {pitch} Would you use this? {url}” When someone follows your page or replies, I'll tell you the same day." Day 7 with nothing real: "Nothing reached the outside world this week. That is common in a first week, and it takes two minutes to change: publish your page." Day 1 does not quote a visit count until WP-02 lands `page.visited`.

**Steps:**
1. Tests first (`notify-rules.test.ts`): each row's trigger and stop; at most one `getting_started` a day and four in total; priority under the limit is decision holding up work, then win or milestone, then `getting_started`, then `checkin`; nothing on vacation; three lifecycle emails with no return through their links end the sequence. verify: fail, then pass.
2. Add `simulated` to `RETRY_REASONS` and log one warning per sweep when a real project's email came back simulated (A9-P0-4 item 2).
3. Words in `retentionEmail`; every piece of user or agent text passes `withoutLinks` as today. Settings gains the two switches.
4. Vacation: `planNotifications` returns nothing but account-safety notices for a project on vacation.
**Tests and evals:** above; gateway `notify-email.test.ts` for the two kinds and the limit; `platform-mail.spec.ts` unchanged. Metrics to read once live: `notify.email_sent` by kind, and `founder.session_started` with `via: "email"` per email sent.
**Done when:** in mock mode a new project's day 0, 1, 3 and 7 emails are planned and recorded, never more than three in a day.

### T12: Email for a person with a card and no project   [M] [needs setup: WP-00 S2, S3]

**Why:** FR-17, A9-P0-4 item 4, s2 §6.2 row 1.

**Files:** migration `<next>_account_notifications.sql`; modify `packages/db/src/schema/founder-return.ts`, `packages/db/src/repos/notifications.ts`, `apps/orchestrator/src/activities/notify.ts` (a second walk), `apps/gateway/src/notify-email.ts`, `packages/shared/src/notify-words.ts`; test `packages/db/src/__tests__/rls/founder-return.test.ts` (the existing file for this table).

**Interfaces, new:** `founder_notifications.business_id` becomes nullable with `check (business_id is not null or kind = 'getting_started')`. RLS: keep the own-rows policy (`user_id = auth.uid()`); read migration 0083's policy first and confirm it does not join through membership, and add a cross-account case (another person never reads a row with a null business) to the RLS test in the same pull request. The gateway's request accepts `businessId: null` only for `getting_started` with `ideaId`.

**Steps:**
1. Test first: the RLS case; a sweep test: a person with a profile, one kept idea and no membership gets one plan an hour after `ideas.created_at`, one more on day 7, then none; a person with a project gets none from this walk. verify: fail, then pass.
2. Email: subject "Your card for {idea} is saved". Body: "Hi {name}, {idea} is saved in your account. The next step takes a minute: check the name and start, and your team drafts its page from your own words." Button "Start {idea}" → `/new/commit/<ideaId>` (works at 390 after T2).
3. Counts toward the person's three a day; the pause link and the kind's switch apply.
**Done when:** the mock sweep records the two emails for a card-holder and nothing for anyone else.

### T13: Single-key shortcuts off by default   [S] [ships alone]

**Why:** A2-03 (an accidental Space starts paid work; 1 to 4 answer a decision; WCAG 2.1.4).

**Files:** migration `<next>_keyboard_shortcuts_pref.sql` (`alter table account_preferences add column keyboard_shortcuts boolean not null default false;` then set it true for accounts whose `guidance = 'off'`); modify `packages/db/src/schema/accounts.ts`, the preferences repo and `AccountPreferencesPatch`, `apps/api/src/routers/founder.ts` (the create branch sets it true with `guidanceOffByDefault`), `apps/web/components/shell/BusinessShell.tsx:919`, `packages/dugout/src/components/shell/keyboard.ts`, `apps/web/components/settings/PreferencesTab.tsx`, `docs/DESIGN.md` ("Key caps go the other way": add "single keys are off until the person turns them on in Settings › Preferences"), tests `keyboard.test.ts`, `apps/web/e2e/keyboard-a11y.spec.ts`, `inbox.spec.ts`.

**Interfaces:** `account_preferences` is account-scoped with an own-row policy already; a column needs no new policy. New field `keyboardShortcuts: boolean` on the preferences view; `KeyboardMapContext.enabled` (`keyboard.ts:101`) is the existing switch.
**Steps:** 1. Tests first: with the preference off only `/`, the command palette chord, `?` and Esc act; "Space on Today scrolls and never starts work"; "a digit outside the decision bar does nothing". 2. Whatever the preference, delete the page-level Space binding (`keyboard.ts:152-160`): Space presses Continue only when Continue has focus; 1 to 4 act only with focus inside the decision bar. 3. Settings switch "Keyboard shortcuts" with the list behind `?`. verify: the three specs pass.
**Done when:** a new guided account cannot start work or answer a note with one stray key.

### [x] T14: The one-click answer page on a phone   [S] [ships alone]

**Why:** A2-12. **Files:** `apps/web/components/email/EmailAnswer.tsx`, its test, `apps/web/e2e/return-loop.spec.ts`.
**Steps:** 1. Test first: a failed `email.action.answer` renders an inline `role="alert"` line "That did not go through. Try again." with a Try again button; at 390 the answer button is at least 44 px tall. 2. Both buttons `size="lg" className="min-h-tap w-full @page-wide:w-auto"`; add `onError`; replace bare "Loading…" with a three-line skeleton. verify: both tests pass.
**Done when:** a tap from an email on a phone either answers or says why not.

### T15: A phone start without a card   [S] [ships after T2]

**Why:** FR-03 item 5, s2 §5.3 ("A first-timer who has no idea"), FR-18 (`/home`).
**Files:** create `apps/web/app/new/write/page.tsx`, `apps/web/components/new/WriteIdea.tsx` (+ test, + story); modify `apps/web/components/person-home/PersonHome.tsx`, `DesktopOnly.tsx` (`"/new/write"`).
**Interfaces, existing:** `idea.write({ title (<=60), pitch (<=4000), archetype: Archetype | null })` → the idea; then `/new/commit/<id>`. The fields mirror `WriteDialog` (`components/new/ideate/dialogs.tsx:507-560`).
**Steps:** 1. Test first: on a narrow viewport `/home`'s "Start something" links to `/new/write`, on a wide one to `/new`; submitting calls `idea.write` once and navigates to Commit. 2. The page: "What do you want to build?" / "One sentence is enough." / fields "A working name" and "Your idea, in your words" / button "Shape it". 3. Hide `/home`'s "Opening soon" card while `features.liveMode` is false. verify: `person-home.spec.ts` at 390 reaches Commit.
**Not built:** a signed-in "no idea at all" path on a phone (the interest picker lives in the signed-out idea box). Build it when WP-02's funnel shows admitted accounts with no idea after 24 hours.

### T16: Win-back for the 11 stalled projects   [S] [needs the founder; after T6, T8 and WP-12's catch-up drafts]

**Why:** s2 §6.5, A9-P0-4 item 6. No product code.
**Steps:** 1. A Desktop session lists, through the Supabase connector, each of the 10 owners' first name, project, creation date, count of day-one notes and whether a page draft exists (counts only; no addresses in the pull request). 2. On the founder's go-ahead, set aside notes older than 14 days with no answer on those 11 projects, except credit warnings (an api script that archives through `repos.inbox`, dry run first, the list shown before it runs). 3. The founder sends s2 §6.5's letter from their own mailbox, one by one, with replies read; a second note at day 7 and "Keep {project} or archive it?" at day 21, then stop. 4. Record replies and returns in docs/PROGRESS.md.
**Done when:** each owner got one personal email after their page draft existed. Target (Estimate): 3 of 10 visit, 2 publish, 3 reply.

## Corrections to the audits

1. a1 FR-08 asks for a migration adding `founder_profiles.strengths` and `looking_for`. Both exist since 0080 (`packages/db/src/schema/accounts.ts`, with `wants_to_learn`), written by `founder.publicProfile.update`. T1 needs no migration.
2. a1 FR-08's third question offers "start something of my own / join something / not sure yet". The code's values are `on_my_own`, `open_to_people`, `looking_for_cofounder`, `looking_to_join` (`PERSON_LOOKING_FOR`); T1 uses them.
3. a1 §1.10 and FR-16 quote the welcome note as "14 agents in 6 departments"; production gives 25 to 27 (e0, a3b §2.2).
4. a9 A9-P0-4 names the new kind `project_quiet`; s2 names it `checkin`. One kind, `checkin`, is built.
5. a2 A2-05 says the first-week checklist sits "on Details"; it is a widget of the founder dashboard preset (`packages/config/src/dashboard-presets.ts`), which T7 retires from the preset rather than moving.
6. s2 P0-3 ("no profile screen and no commit screen in session one") is shrunk: both screens stay, each cut to one press with prefilled fields, because the 18-or-older box and the project's name need a place and `startDestination` stays one table. The count is still 6 screens and 2 inputs.
7. s2 §5.3 "hire lazily" is not done (T4 says why). a1 FR-04's "tasks created when they become relevant" for Finance and Legal is shrunk to "not seeded without a budget"; the triggers are not built.
8. a1 FR-03 item 4 and a9 A9-P0-2 item 2 (the wall's exits) belong to WP-03 by OUTLINE's boundaries; this package removes the walls on the path instead.

## Decisions for the founder

1. **What commit starts.** For a profile with no budget: no cycle and no finance or legal task at commit; the page and the plan are drafted; the first round of work starts on the plan's approval, on Continue, or with the first overnight shift. This narrows your 2026-10-18 choice 7. Yes or no.
2. **The starting team.** Everyone is hired as today; three are shown until work brings in more. The alternative, hiring on demand, is a week or more across the planner and channels. Confirm "shown".
3. **One plan note** replacing the two sign-off notes (2026-10-18 choice 2, which named this as its reverse). Confirm.
4. **The spend line starts at $0** for a profile with no budget, so every spend asks first (T3 step 4, if 0 means that in policy).
5. **The streak** is hidden on a project's first day (T7). Keep, or show from day one.
6. **Who signs the day-3 and win-back letters** and which mailbox receives replies (T16). Until answered they are sent by hand.

## Risks

- T3 changes what the orchestrator sees at a project's start; the autopilot case in step 3 is the guard. Roll back by passing `hasBudget: true`.
- T8 hides updates inside a digest in week one. If founders miss something, lower the fold to day 3 by changing `LIMITS.firstWeekDays`.
- T5's re-ask path after "Ask for changes" is the least-traveled branch; test (d) covers it, and the roadmap tab's own Approve still works.
- T6 puts a department tab in phone mode for the first time; other tabs must stay walled (the pattern test).
- T11 and T12 can be merged and still send nothing: `platformMailLive` gates them. Do not mark Done-when 3's email half until WP-00 S2 and S3 are recorded.
- All dollar and minute figures here are Estimates until WP-02's reports exist.

## Starting prompt

```
You are executing docs/holistic-plan/WP-04-the-first-session.md. Read, in order: CLAUDE.md; docs/holistic-plan/README.md; the work package; the CLAUDE.md of each package the next task touches; and the audit sections the task cites under docs/holistic-plan/audits/. Line numbers have drifted: find each citation by the function or string it names.

Take the first unticked task in the order the package gives (T1, T2, T3, T6, T5, T4, T7, T8, then T9 to T16). For that task: run plan-change (other branches, next free migration number); state your assumptions; write the failing test the task names; make the smallest change that passes it; run verify-done and report every check with its result. One task is one pull request on branch claude/wp04-t<n>; never push to main and never merge. Tick the task in the work package file, add one line to docs/PROGRESS.md and any judgment call to docs/DECISIONS.md in the same pull request.

Stop and ask before: changing a decision listed under "Decisions for the founder" in a way the package does not describe; starting T11, T12 or T16 live (build with the mock passing and stop); touching apps/orchestrator/src/activities/session.ts (WP-05 owns it); or building anything the task does not name. If a task looks larger than its finding needs, say so in the pull request instead of building the excess.
```
