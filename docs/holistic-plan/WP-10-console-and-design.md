# WP-10: The console, re-cut and legible

**Goal:** in week one a project's console shows about a dozen surfaces, explains each one, reads comfortably, shows ratings and skills a first-timer can understand, and passes machine accessibility checks.

**Why:** `audits/a2-console-design.md` A2-04, A2-06 to A2-08, A2-13 to A2-17, A2-19 to A2-27 and §3b; `audits/s1-design-critique.md` §2, §3.10 to §3.13, §4.3 (items 4 and 6), §5, P1-7, P1-8, P1-13, P2-1 to P2-8, P2-12, §7; `audits/a3b-templates-skills-team.md` TS-02 (display side), TS-09, §3.2. Production (`audits/e0-production-evidence.md`): 11 of 13 projects never reopened, 113 of 127 approval requests unanswered, nobody added a library skill.

**Done when (each is a test in this package):**
1. A fresh project (no round of work finished, no page live) lists at most 9 sidebar items and at most 8 inline tabs across its area tab bars (6 more behind "More detail") with Builder view off; the example project and any account with Builder view on list everything (`apps/web/e2e/areas.spec.ts`, `packages/shared/src/areas.test.ts`).
2. Every inline area tab, Needs you, Details, Team call and each Settings tab has an "Explain this page" entry; a unit test fails when an inline tab has none.
3. `packages/dugout/src/tokens.test.ts` proves: a control's edge is at least 3 : 1 on the canvas and surfaces 1 to 3; a `bad` or `info` pill's word is at least 4.5 : 1 on its own fill over surfaces 1 to 4; reading text is 16/26.
4. The axe run over stories has no baseline entry for a component this package touches, the axe run over pages covers a fresh project and four more console screens, and `eslint-plugin-jsx-a11y` runs in lint.
5. From an agent's Overview a suggested skill is added in at most three presses; the picker story holds 120 skills.
6. No rating is shown without its band word and, where a figure shows, "of 20"; a rating that was never measured says so.
7. First-load JavaScript for `/b/[bid]/today` is under a recorded budget; `scripts/design-tokens.mjs` runs in CI.
8. `docs/DESIGN.md` §1 to §10 carry the amendment in T6.

**Scope in:** tabs, sidebar and top-bar chips by stage; explainers and definitions off Today; type, contrast and focus tokens; the DESIGN.md amendment; machine accessibility checks; the look of the skills picker and skills panel; rating legibility; the decision note's order; Settings › Basics; small state fixes; Today's bundle; dead code and a token scanner.

**Scope out (owned elsewhere; do not build here):** the small-screen wall, its exits and the store-links value (A2-01, A2-02: WP-03 and WP-12); keyboard shortcuts off by default, Today's tour, next step, panel order and one-click answer page (A2-03, A2-05, A2-10, A2-12: WP-04); words in the chrome and Today's Health tiles (A2-09, A2-11, A2-18: WP-02); landing, sign-in, "Before you start", doors, idea card, Commit, the first screen after commit (s1 §3.1 to §3.9, P0-1 to P0-3, P1-1 to P1-6, P1-9, P1-10, P2-9, P2-10: WP-03 and WP-04); skills data, suggestions' source, `read_skill`, measured ratings, Proven, promote without a run (TS-01, TS-03 to TS-08, TS-10 to TS-18: WP-06 and WP-09).

**Depends on:** WP-04 merged (it edits `TodayScreen.tsx`, `BusinessShell.tsx`, `tours/definitions.ts`, `founder.ts` first). T8 and T9 read fields WP-06 adds; both ship without them and say where the field plugs in.

**Collides with:** `claude/blissful-fermat-q03yq1` (axe checks; touches `.github/workflows/ci.yml`, `packages/dugout/.storybook/preview.ts`, `packages/dugout/src/components/shell/{AppShell,KitBar,Panel,PhoneBar}.tsx`, `packages/dugout/src/dugout.css`, `docs/DESIGN.md`): T2, T5, T6, T7 and T12 start only after it is merged, or rebase on it. WP-01 (`ci.yml`). WP-02 (`BusinessShell.tsx` strings, `packages/shared/src/founder-words.ts`). WP-06 (`packages/modules/src/team/skills.tsx`, `apps/web/components/agents/AddedSkillsPanel.tsx`): agree the order with that session before T8.

**Setup it needs:** none from WP-00. No migration, no new table, no new event, no gateway tool, no env var in this package.

Sizes: S under a day, M one to three days, L up to a week. One task is one pull request, branch `claude/wp10-t<n>`.

## Tasks

### T1: Tabs and sidebar by stage [M] [ships alone]

**Why:** A2-04 steps 1 and 2; THESIS_REVIEW §6.1 (line 484: "A tab appears when its data exists or its moment arrives… Everything stays reachable in Builder view. Target: about a dozen surfaces in week one"); a3b §3.2.

**Files.** Modify: `packages/shared/src/areas.ts`, `packages/shared/src/areas.test.ts`, `apps/api/src/routers/business.ts`, `apps/web/lib/areas.ts`, `apps/web/lib/sidebar.ts`, `apps/web/lib/__tests__/sidebar.test.ts`, `apps/web/components/shell/useAreaNav.ts`, `apps/web/components/shell/BusinessShell.tsx` (the `buildSidebarItems` call, line 510), `apps/web/e2e/areas.spec.ts`. No change to `apps/web/lib/search.ts`: the palette keeps calling `areaNav` without a stage, so every tab stays findable.

**Interfaces, consumed (as in the code):**
- `areaTabsByArea(departments: readonly AreaDepartment[], opts: AreaTabsOptions): Map<AreaKey, AreaTab[]>`; `AreaTabsOptions { builder: boolean; canOpen?; fixed?: Partial<Record<AreaFixedTab, boolean>> }`; an area with no tab is already left out of the map; a department with no inline tab already gets its first tab promoted.
- `areaNav(input: AreaNavInput): Map<AreaKey, AreaTab[]>` with `AreaNavInput { businessId; departments; access?; builder? }`; `buildSidebarItems(input: SidebarInput): SidebarItem[]`.
- `business.get` (`businessProcedure.query`), which already reads `repos.departments.list`, `signoffViews` and others in one `ctx.rls` `Promise.all`.
- `repos.pages.get(tx, businessId)` (`publishedAt`), `repos.events.list(tx, businessId, { type: "cycle.completed", limit: 1 })`, `repos.finance.cashPosition(tx, businessId)` (`accounts.length`), `repos.journeys.countPayingCustomers(tx, businessId, range = {})`, `repos.legal.primaryEntity(tx, businessId)`, `repos.memberships.list(tx, businessId, { activeOnly: true })`, `ctx.business.distributionStartedAt`.

**Interfaces, produced:**
```ts
// packages/shared/src/areas.ts
export interface StageFacts {
  pageLive: boolean;            // project_pages.published_at is set
  distributionStarted: boolean; // businesses.distribution_started_at is set
  roundCompleted: boolean;      // at least one cycle.completed event
  bankConnected: boolean;       // cashPosition().accounts.length > 0
  firstPayment: boolean;        // countPayingCustomers(all time) > 0
  entityExists: boolean;        // legal.primaryEntity() is not null
  people: number;               // active memberships, the example membership excluded
}
export type TabReveal = (f: StageFacts) => boolean;
export const TAB_REVEAL: Partial<Record<ModuleKey, Readonly<Record<string, TabReveal>>>>;
export const TEAM_CALL_REVEAL: TabReveal;                 // (f) => f.roundCompleted
export function tabRevealed(moduleKey: ModuleKey | null, slug: string, stage: StageFacts | undefined): boolean; // true when stage is undefined or no rule exists
export interface AreaTabsOptions { /* existing fields */ stage?: StageFacts }   // ignored when builder is true
// apps/web/lib/areas.ts: AreaNavInput gains stage?: StageFacts. apps/web/lib/sidebar.ts: SidebarInput gains stage?: StageFacts.
// apps/api business.get output gains: stageFacts: StageFacts
```
`TAB_REVEAL` (a tab with no rule always shows):

| Module | Slugs | Shows when |
| --- | --- | --- |
| distribution | `formation` | `pageLive \|\| distributionStarted` |
| distribution | `leads`, `campaigns`, `channels`, `creative`, `attribution` | `distributionStarted` |
| finance | `overview`, `pnl`, `cash`, `runway` | `bankConnected \|\| firstPayment` |
| finance | `wage-bill` | `roundCompleted` |
| finance | `cap-table` | `firstPayment \|\| people > 1` |
| legal | `incorporate` | `firstPayment \|\| people > 1` |
| legal | `entity`, `compliance`, `contracts`, `ip`, `policies`, `regulatory` | `entityExists` |
| development | `training-ground`, `plan`, `pull-requests`, `environments`, `specialists` | `roundCompleted` |

Product, Team, Milestones and Contacts have no rule. Result for a fresh project: Today, Needs you, Plan (Roadmap, Milestones), Customers (Contacts), Product (Specification, Public page; Vision, Changes, Sources, Research behind "More detail"), Team (Agents, Recruitment; Staff, Responsibilities behind "More detail"), Network, Settings, Sign out. Money appears after the first round of work and lands on Payroll through the existing promotion rule; Team call appears after the first round.

**Steps.**
1. Write the failing table test in `areas.test.ts`: "a fresh project's stage leaves Money, Company and Development tabs out", "one finished round adds Payroll and Development's tabs", "a payment adds Overview, Runway, Cap table, Incorporate", "Builder view ignores the stage", "no stage given changes nothing" (the existing cases must stay green). verify: `pnpm --filter @foundmill/shared test areas` fails on the new cases only.
2. Add `StageFacts`, `TAB_REVEAL`, `TEAM_CALL_REVEAL`, `tabRevealed`; in `areaTabsByArea`, after `visibleTabs(...)`, drop tabs where `!opts.builder && !tabRevealed(tabModule(d.moduleKeys, t.slug), t.slug, opts.stage)` before the promotion rule runs. verify: step 1's tests pass.
3. `business.get`: add the six reads to the existing `Promise.all` and return `stageFacts`. For a demo business (`ctx.business.isDemo`) return every flag true and `people: 2`, so the example and the sample projects show everything. verify: new cases in `apps/api/src/__tests__/business-first-week.test.ts` ("stageFacts is all false for a new business", "true after a page is published", "another business's member is refused": the procedure is already `businessProcedure`, so this is the existing cross-tenant case extended to the new field).
4. Pass `stage: business.data.stageFacts` through `useAreaNav` and the `buildSidebarItems` call; in `buildSidebarItems` push the Team call item only when `!input.stage || input.builder || TEAM_CALL_REVEAL(input.stage)`. A tab opened by URL while hidden still renders (routes do not consult the stage) and shows its `emptyWhy` sentence. verify: `sidebar.test.ts` "a fresh project lists Today, Needs you, Plan, Customers, Product, Team, Network, Settings, Sign out".
5. `areas.spec.ts`: add a fresh-project case (commit a project in mock mode, assert the nine items and that `/b/<id>/finance/runway` opened by URL shows text, not a gate); keep the Northwind case. verify: `pnpm test:e2e areas`.

**Tests and evals:** the files in steps 1, 3, 4, 5. No agent behavior changes, so no eval.
**Done when:** Done-when 1 holds; the palette still finds "Runway" on a fresh project.

### T2: Top bar by stage [S] [ships after T1]

**Why:** A2-04 step 3, §3b F6; a2 §2 (the runway chip reads "Not known yet · connect a bank" from day one; the mode chip shows a $250 line to someone with no money in the project).

**Files.** Modify: `packages/dugout/src/components/shell/KitBar.tsx`, `AppShell.tsx` (prop pass-through), `KitBar.stories.tsx`, `AppShell.test.tsx`, `apps/web/components/shell/BusinessShell.tsx` (lines 837 to 918), `apps/web/components/shell/__tests__/business-shell.test.ts`.

**Interfaces.** Consumes `RunwayChip({ date, runwayMonths, words, cash, estimate, onClick })`, `ModeChip({ mode, holiday, spendLineMinor, currency, onClick })` in `KitBar.tsx:274-276`. Produces two optional `KitBar` / `AppShell` props: `showRunway?: boolean` (default true; false renders the date alone through a new `dateOnly` prop on `RunwayChip`) and `showMode?: boolean` (default true). `BusinessShell` passes `showRunway={builder || stage.bankConnected || stage.firstPayment}` and `showMode={builder || stage.roundCompleted || business.businessMode !== "augmented"}`.

**Cut from the audit:** A2-04 asks to move Stop all agents into the project menu. It stays where it is: it is the one control that stops spending, and hiding it trades trust for tidiness.

**Steps.** 1. Story "Week one" for `KitBar` and a failing `AppShell.test.tsx` case "no runway words and no mode chip when both are off". verify: fails. 2. Add the props. verify: passes; `KitBarFit` test still green. 3. Wire `BusinessShell`. verify: `business-shell.test.ts` "a fresh project's bar has the date, search and Continue"; `no-clip.spec.ts` at 1280 and 1440.
**Done when:** on a fresh project the top bar reads name, title, search, date, Continue, Stop all agents.

### T3: "Explain this page" wherever a first-timer lands [M] [ships alone]

**Why:** A2-06 (9 of 15 inline tabs and three of five area landings have no explainer; the phone title row never draws the button); a2 §6 gap 5.

**Files.** Create: `packages/modules/src/explainers.ts`, `packages/modules/src/__tests__/explainers.test.ts`. Modify (add one `<Explainer {...X} />` each, following `PULL_REQUESTS_EXPLAINER` in `packages/modules/src/development/PullRequestsScreen.tsx:137,320`): `packages/modules/src/product/RoadmapScreen.tsx`, `product/SpecificationScreen.tsx`, `distribution/LeadsScreen.tsx`, `distribution/CampaignsScreen.tsx`, `finance/RunwayScreen.tsx`, `legal/ComplianceScreen.tsx`, `development/EnvironmentsScreen.tsx`, `apps/web/components/milestones/MilestonesScreen.tsx`, `crm/CrmScreen.tsx`, `inbox/InboxScreen.tsx` (list level), `home/HomeScreen.tsx`, `calls/CallLobby.tsx`, `settings/SettingsScreen.tsx` (one per tab from a map), `packages/dugout/src/components/shell/AppShell.tsx` (draw `ExplainPageButton` in the phone title row), `apps/web/e2e/explain-page.spec.ts`. Today's explainer belongs to WP-04: if `TodayScreen.tsx` has none when this task starts, add `TODAY_EXPLAINER` here and say so in the pull request.

**Interfaces.** Consumes `Explainer({ screenId, purpose, action, watchFor, onExample? })` (`packages/dugout/src/components/guidance/Explainer.tsx:20`), `DEFAULT_TABS` (`packages/shared/src/constants.ts`). Produces `export type ExplainerCopy = { screenId: string; purpose: string; action: string; watchFor: string }` and `export const EXPLAINERS: Readonly<Record<string, ExplainerCopy>>` keyed `"<module>/<slug>"` plus `"milestones"`, `"crm"`, `"inbox"`, `"home"`, `"calls"`, `"settings/<tab>"`; the existing `*_EXPLAINER` constants are re-exported through it, not rewritten.

**Copy (new strings; three sentences each, written with the `copywriting` and `humanizer` skills, checked by `node scripts/plain-language.mjs --gate`).** Pattern, shown for two; write the rest the same way and list every string in the pull request:
- `product/roadmap`: purpose "What your team plans to build, in order." action "Read the next three items. Say so if the order is wrong." watchFor "A date here is a plan, labeled Estimate, until the work is done."
- `product/specification`: purpose "What your product does, written so your team can build it." action "Read it once and approve it, or ask for changes in your own words." watchFor "Your team builds what this says, so a wrong line here becomes wrong work."

**Steps.** 1. `explainers.test.ts`: "every `DEFAULT_TABS` slug has an `EXPLAINERS` entry" and "every entry has three non-empty sentences under 160 characters". verify: fails listing the nine missing tabs. 2. Add the entries and mount them. verify: test passes. 3. Phone title row button. verify: `AppShell.test.tsx` "phone mode draws Explain this page when a screen registered one". 4. Extend `explain-page.spec.ts` to each area's landing tab and Needs you. verify: `pnpm test:e2e explain-page`.
**Done when:** Done-when 2.

### T4: Definitions for the first words [S] [ships alone]

**Why:** A2-17 (92 definitions, none for the words Today and Needs you use; three ids used nowhere).

**Files.** Modify: `packages/shared/src/terms.ts`, its test, and the first occurrence of each word in `apps/web/components/inbox/InboxScreen.tsx`, `packages/dugout/src/components/today/GoalPanel.tsx`, `NeedsYouList.tsx`, `StreakStrip.tsx`, `packages/dugout/src/components/shell/ModeChip.tsx`. Create: `apps/web/lib/__tests__/terms-used.test.ts`.

**Interfaces.** Consumes `TERMS`, `TermId`, `Term({ id, children })`. Produces new ids: `goal`, `round_of_work`, `note`, `needs_you`, `continue`, `public_page`, `follower`, `project`, `cofounder`, `collaborator`, `spend_line`, `go_ahead`, `decision`, `builder_view`, `ai_usage`. If WP-02 has added `roundWords` or a `round_of_work` id, reuse it. Remove `churn`, `integration`, `runway_horizon` only if step 1's test shows no caller.

**Copy, examples (one or two short sentences, no jargon):** `needs_you` "The few things only you can decide. Your team keeps working on everything else." `go_ahead` "Your yes to one action that spends money or contacts someone outside. Nothing like that runs without it." `spend_line` "The amount your team may spend on one action without asking you first."

**Steps.** 1. `terms-used.test.ts`: walk `apps/web` and `packages/{modules,widgets,dugout}/src` sources for `<Term id=`, `termId:`, `meta: { term` and the palette's Help group; fail on a `TERMS` id with no use. verify: fails on the three unused ids. 2. Add ids and wrap first occurrences. verify: passes; `plain-language.mjs --gate` green.
**Done when:** every word in A2-17's list is defined on hover, focus or tap where a first-timer first meets it.

### T5: Type, contrast and focus tokens [M] [ships alone, after blissful-fermat]

**Why:** A2-08, A2-14; s1 §2.1, §2.2, §2.7, §2.8, P1-13, P2-1, P2-2, P2-4, P2-8, the `rating-1` P3; s1 §5.2 F1, F2.

The two audits disagree; this is what ships and why (Karpathy: the smallest change that passes a test).

| Token or rule | Now | Ships | Check (WCAG blend in sRGB, as `tokens.test.ts` computes) |
| --- | --- | --- | --- |
| `--fs-reading` / `--lh-reading` / `--ls-reading` | 15px / 24px / -0.006em | **16px / 26px / 0em** | 640 px measure is about 78 characters |
| Text size for a new guided account | `standard` | **`comfortable`** (body 14/20, small 12.5/16, chat 14/21: the existing block, unchanged) | existing test "comfortable text… touches nothing else" stays |
| new `--line-control` | n/a (`--line-strong`, white 13 %: 1.43 : 1) | **`rgba(255, 255, 255, 0.34)`**; `--line-control-hover: rgba(255, 255, 255, 0.42)` | 3.02 canvas, 3.11 surface-1, 3.11 surface-2, 3.07 surface-3 |
| `--status-bad` | `#f36066` | **`#f57a7f`** | on its 12 % fill: 6.07 / 5.59 / 5.09 / 4.51 over surfaces 1 to 4 |
| `--status-info` | `#5e8eff` | **`#7ba1ff`** | on its 12 % fill: 6.27 / 5.80 / 5.26 / 4.62 |
| `chip-tone[aria-pressed="true"]` | tone's own color on a 22 % fill (4.46 on surface-1) | add **`color: var(--text-1)`** (as `chip-plate` pressed already does) | 12.3 and 12.0 on surface-1 |
| `--rating-1` | `#f2545b` | **`var(--status-bad)`** | 5.40 on surface-4 (was 4.19) |
| `--ring` | `0 0 0 1px rgba(124,196,255,.65), 0 0 0 4px rgba(124,196,255,.16)` | **`0 0 0 2px rgba(124, 196, 255, 0.8), 0 0 0 5px rgba(124, 196, 255, 0.18)`** | 6.7 : 1 on surface-1 |
| `focus-ring`, `focus-within-ring` | `outline: none` + shadow | **`outline: 2px solid transparent; outline-offset: 2px`** + shadow | forced-colors draws the outline |
| `ReassuranceLine`, `Field` | `text-tertiary`; error replaces hint | **`text-secondary`**; hint and error both render | 8.85 on surface-1 |
| new `@utility type-outer` | n/a | body 16/24, small 14/20, reading 17/28 (`--ls-reading: 0em`), label 14/20, action 15/20, title 16/22, chat 16/24 (s1 §2.2, verbatim) | applied here only to `AppShell` in `phone` mode |

Not shipped, with the reason: a2's body 14/21 as the standard size and `--fs-root` in rem (both move every screen; the comfortable default reaches the same reader with no layout change, and rem-based structure would hit the 1280 px wall sooner, which waits on founder question 3); a2 F3's lift of `--text-3` (it passes at 6.1 : 1; s1 measured the same and says leave the ramp alone); s1's pill fill at 10 % (still 4.0 on surface-4, and the Oct 20 precedent in DESIGN §5 is to lift the two colors by the smallest step that passes); a third "Large" text step (s1 P2-11 itself says it needs a visual pass on dense tables first).

**Files.** Modify: `packages/dugout/src/tokens.css` (lines 36, 68, 69, 72, 118, 210 to 212), `tokens.test.ts`, `dugout.css` (`focus-ring` 1221, `focus-within-ring` 1228, new `type-outer`), `controls.css` (`chip-tone` 403, `field-well` 463, `check-box` 539, `radio-dot` 560, `switch-track` 617), `components/guidance/ReassuranceLine.tsx`, `components/foundation/Label.tsx` (`Field`, `fieldDescribedBy`), `components/shell/AppShell.tsx` (phone root class), `apps/api/src/routers/founder.ts` (line 201), `apps/api/src/__tests__/founder-profile-guidance.test.ts`, `apps/web/e2e/no-clip.spec.ts`, `apps/web/e2e/preferences.spec.ts`.

**Interfaces.** Consumes `repos.preferences.update(tx, userId, patch: AccountPreferencesPatch)`, `guidanceOffByDefault(profile.experience)`, `contrastRatio`, `hex` in `tokens.test.ts`. Produces: in `founder.profile.update`'s first-save branch, `else await asUser(ctx, (tx) => repos.preferences.update(tx, ctx.userId, { textSize: "comfortable" }))`. Existing accounts keep their setting; no migration (the column default stays `standard`, so an account that never saves a profile is unchanged).

**Steps.**
1. Tests first in `tokens.test.ts`: "a control's edge reaches 3 : 1 on the canvas and surfaces 1 to 3"; "bad and info reach 4.5 : 1 on their own 12 % fill over surfaces 1 to 4" (add a `blend(fg, bg, alpha)` helper); "documents the lifted values" updated to the new hexes; "reading is 16/26 with no tracking"; "rating-1 follows status-bad"; "type-outer declares the seven sizes". verify: all fail.
2. Change the tokens and utilities. verify: `pnpm --filter @foundmill/dugout test tokens` passes; `node scripts/focus-visible.mjs` passes.
3. `Field` renders hint and error; `aria-describedby` carries both ids. verify: `Label.test.tsx` "an invalid field keeps its hint".
4. `founder.ts` default. verify: `founder-profile-guidance.test.ts` "a first-time profile starts on comfortable text; an Operator's does not".
5. Run `no-clip.spec.ts` at 1280 and 1440 with `data-text="comfortable"` added as a second project in the spec. verify: no clipped element; fix any by the component's own token, never by a one-off size.
6. Re-run the story axe run and delete baseline entries this fixes (rule: an entry that no longer occurs must be removed). verify: `pnpm --filter @foundmill/dugout test:a11y`.
**Done when:** Done-when 3; a new guided account's `<html>` carries `data-text="comfortable"`.

### T6: Amend DESIGN.md for the thesis [S] [ships with T5, or alone if T5 slips]

**Why:** A2-07 (§1 still asks for a control room; 30 commits since Nov 7 and none touched it; the builder agents read it first), A2-21, A2-24, §3b F1, F11, F12; s1 §7, P2-12.

**Files.** Modify: `docs/DESIGN.md`, `docs/UX_AUDIT_AND_PLAN.md` (lines 386 to 395: mark the three built items done), `docs/GATES.md` (lines 134 to 139: date the UX gates; Gate 3, the second outside test, stays open and says so). Run `node scripts/banned-terms.mjs` and `node scripts/us-english.mjs`.

**The text.** Replace §1's first three paragraphs (lines 7 to 13) with:

> **A quiet workshop at night, with someone a few years ahead of you at the next desk: calm, exact and on your side.**
>
> The room is dark and the work is lit. A screen starts with one sentence and one action, and shows more as the project has more to show: density is earned, never the starting point. Numbers are tabular and quiet, and every one carries a word that says what it means. Status glows softly in its own color. Generating is a visible live process, never a modal wait. Agents are a team you talk to: they have faces, presence and a voice, and the founder can always answer with one press. Nothing on a screen grades the person using it.
>
> Three words: **Calm. Clear. Alive.**
>
> There are two registers in one system. The **default view** is for a person building their first project: sentences before tables, one filled main action, reading type for anything longer than a line, and only the surfaces their stage needs. **Builder view** is the control room: the engine's numbers, every tab, the dense tables. It is one switch away and nothing in it is removed. Dense but never cramped. Quiet but never dead. Nothing is ever clipped.

Keep the "What it is not" paragraph. Then, section by section:

- **§2, after the AA bullet, add:** "AA includes non-text contrast (WCAG 1.4.11): the edge of a field, checkbox, radio and switch is `line-control`, at least 3 : 1 on the canvas and surfaces 1 to 3. `tokens.test.ts` holds the text ramp, the status words on their own fills, and the control edge."
- **§3, Lines:** add "`line-control` (white 34 %) is for the boundary of an input control only; panels, dividers and buttons keep `line-strong`." **Elevation table, `ring`:** "2 px accent at 80 % plus a 5 px halo at 18 %, always with a transparent 2 px outline so forced-colors mode draws it."
- **§4, table:** reading 16/26, tracking 0. **"Comfortable text":** "A new account with guidance on starts on comfortable text (set at the first profile save); Operator and Exited profiles start on standard." **New paragraph "Outer type":** "Pages read on a phone put `type-outer` on their root: body 16/24, small 14/20, reading 17/28, label 14/20, action 15/20, title 16/22, chat 16/24. Inputs are 16 px there, so iOS does not zoom on focus. Data labels in caps and mono stay out of outer pages."
- **§5, Status (line 107):** "Red and blue were lifted again on <merge date> to `#F57A7F` and `#7BA1FF`, the smallest step that keeps a pill's word at 4.5 : 1 on its own 12 % fill over surfaces 1 to 4. A pressed tinted chip draws its word in `text-1`." **Rating ramp:** "`rating-1` is `status-bad`: one red."
- **§6 (line 116 to 118):** replace "8 px grid, 4 px half-steps" with "Sizes come from the tokens. Tailwind's numeric spacing runs on the 13 px root (`gap-2` is 6.5 px, `p-4` is 13 px); use the named size tokens for structure." (A2-21: striking the claim is the smaller fix; changing `--spacing` would move every screen.)
- **§7:** replace the sentence describing Continue's blocked state as a red "Respond · N" with "Blocked is amber and reads 'Needs you · N'. It appears only for a hard stop: credits used up or a revoked key. Open decisions never block Continue (founder, Nov 7, 2026)."
- **§8, Sidebar and tab bar:** add "**By stage.** With Builder view off, a tab shows when its moment has arrived (`TAB_REVEAL` in `@foundmill/shared/areas`): Money after the first round of work, its bank tabs after a bank or a payment, Company after an entity exists, Development's tabs after the first round. A hidden tab is still found by search and opens by URL with its one-sentence reason. Builder view shows everything." **Top bar:** "The runway words show once a bank is connected or a payment has arrived; the mode chip after the first round of work. Stop all agents is always there."
- **§8, Guidance (line 216 onward):** replace "`NextStep` on Home" and the seven-item checklist description with whatever WP-04 shipped on Today (read `TodayScreen.tsx` and state it); add "Every inline area tab registers an explainer (`EXPLAINERS` in `@foundmill/modules/explainers`; a unit test holds it)."
- **§8, new entries:** "`RatingKey`: the legend '1–5 Poor · 6–10 Average · 11–15 Good · 16–20 Excellent' with the four ramp swatches, once on any screen that shows a rating. `SkillCard`: one library skill as a row: name, one line, where it shows, state, and what it changed." **`ReassuranceLine`:** "in `text-2`."
- **§9, Agent profile and Team:** "A rating is never a bare number: the band word always, 'of 20' wherever the figure shows, 'Not tested yet' when nothing has measured it, and one line saying what it is from. Stars keep their one caption."
- **§10, add a table "Engine word → founder word":** cycle → round of work; orchestrator → (say what the founder can do instead); Inbox → Needs you (for the tab that needs an answer); business → project until the first sale; Untested → Not tested yet; Staff → People. (WP-02 owns the strings; this table is the rule they follow.)

**Steps.** 1. Apply the text. verify: `node scripts/banned-terms.mjs`, `us-english.mjs`, `plain-language.mjs --gate` pass; `grep -n "control room" docs/DESIGN.md` returns only the Builder view sentence. 2. Read §9 screen notes against the code changed by T1 to T5 and correct any line they made false. verify: list each corrected line in the pull request.
**Done when:** Done-when 8. Merging this pull request is the founder's yes to replacing the Oct 9 "Mission control 2027" brief for the default view (docs/DECISIONS.md "2026-10-09 — The 2027 art direction"); record it in docs/DECISIONS.md in the same pull request.

### T7: Accessibility checked by a machine [M] [ships alone, after blissful-fermat is merged]

**Why:** A2-13, A2-27 (22 px selectable chips), a2 §6 gaps 1, 6 and 7; s1 §5.2 F1 and F4, §5.3 T1, P2-4, P2-5.

**What already exists on `claude/blissful-fermat-q03yq1` (commit 38ae2616; do not rebuild it):** `packages/dugout/a11y/stories.spec.ts` runs axe over every story against `a11y/baseline.json` (116 lines of owed fixes; a new violation fails, and so does a listed one that no longer occurs); `packages/dugout/.storybook/a11y-rules.ts` exports `AXE_TAGS`; `pnpm --filter @foundmill/dugout test:a11y`; `apps/web/e2e/axe.ts` (`expectNoAxeViolations(page, where)`, `KNOWN_EXCEPTIONS`) and `apps/web/e2e/accessibility.spec.ts` (signed-out pages at 390 and 1280, a founder's phone pages, five console screens at 1440); the CI step sits inside the "Storybook build" job. If that branch has not merged when this task starts, stop and tell the founder; do not copy its files.

**Files.** Modify: `apps/web/e2e/accessibility.spec.ts`, `apps/web/e2e/keyboard-a11y.spec.ts`, `packages/dugout/a11y/baseline.json` (entries removed only), `eslint.config.mjs`, root `package.json` and `pnpm-workspace.yaml` catalog (`eslint-plugin-jsx-a11y`), `packages/dugout/src/dugout.css` (a `@media (forced-colors: active)` block), `packages/dugout/src/components/foundation/Chip.tsx` (lines 83 to 116), `packages/dugout/src/components/data/FilterChips.tsx` (line 323), `apps/web/components/inbox/ReadingPane.tsx` (scroll padding).

**Interfaces.** Consumes `expectNoAxeViolations`, `ready(page, path)` in the spec, `--target-size: 24px` and the `min-h-target` utility, `--decision-bar` (the sticky bar's height token). Produces no new API.

**Steps.**
1. `accessibility.spec.ts`: add to `CONSOLE` an agent's profile, Team › Agents, Product › Specification, Settings › Preferences and an open note with a decision; add a test "a fresh project's Today and Needs you at 1440 and 390 px" (commit a project in mock mode first). verify: the spec fails on real violations; fix each in the component, or, only where the cause is outside this package, add a `KNOWN_EXCEPTIONS` row with its owner.
2. Baseline: for every component T5, T8 and T9 touch, fix the violation and delete its entries. Target: the file at least one third shorter (116 lines at 38ae2616; Estimate). verify: `test:a11y` passes with the shorter file.
3. `eslint.config.mjs`: add `jsx-a11y` recommended for `**/*.tsx`. Fix what it finds; a rule that fires on a Radix pattern is switched off for that rule with a one-line reason, never per file. verify: `pnpm lint`.
4. Forced colors: `@media (forced-colors: active)` giving panels, fields, pills and chips a 1 px `CanvasText` border, and `forced-color-adjust: none` on the brand slab only. verify: `keyboard-a11y.spec.ts` new case with `page.emulateMedia({ forcedColors: "active" })`: a focused field's computed `outline-style` is not `none`, a panel's `border-top-width` is 1px.
5. Targets: a chip that is a button gets `min-h-target`; the chip's remove button gets a 24 px hit area through an `::after` inset (the pattern of the existing `tap-reach` utility). verify: `Chip.test.tsx` "a pressable chip is at least 24 px tall"; Playwright: a click 8 px outside the remove glyph removes the chip.
6. Focus not obscured: `scroll-padding-bottom: var(--decision-bar)` on the reading pane's scroller. verify: `keyboard-a11y.spec.ts` "tabbing through a long note never leaves the focused control under the decision bar" (the focused element's box does not intersect the bar's).
**Done when:** Done-when 4.
**Not here:** `prefers-contrast` (no finding shows a user need yet); a 390 px `no-clip` run for console screens (they are desktop by rule).

### T8: The skills picker and an agent's skills panel: the look [M] [ships alone; coordinate with WP-06]

**Why:** TS-09 (the picker hides what a skill says and suggests nothing; the toast and the empty state tell a founder to rewrite the skill by hand); s1 §3.12, §4.3 item 4, P1-8; e0 (zero skills added). WP-06 owns the data: default skills at hire, `suggested` and `effect`, the body on demand. This task owns the components, their states and their words, and works on today's 20 skills.

**Files.** Create: `packages/dugout/src/components/agents/SkillCard.tsx`, `SkillCard.stories.tsx`, `SkillCard.test.tsx`. Modify: `packages/dugout/src/components/agents/SkillPicker.tsx` (`SkillLibraryList`, `ChosenSkillList`), its stories and test, the `agents` barrel, `packages/modules/src/team/skills.tsx` (`SkillLibraryDialog`), `apps/web/components/agents/AddedSkillsPanel.tsx`, `apps/web/components/agents/OverviewTab.tsx`, `TrainingTab.tsx`, `apps/web/e2e/agent-profile.spec.ts`.

**Interfaces, consumed (quoted):** `LibrarySkillOption { key; name; description; categoryLabel; attribute: { name; group: SkillGroup } }`; `LibrarySkillRow extends LibrarySkillOption { skillKey; category; instructionsMd }` (already returned by `team.skills.library`, never rendered); `SkillLibraryListProps { skills; selected; onToggle; unavailable?; max?; className? }`; `matchesSkillQuery(skill, query)`; `SkillLibraryDialogProps { open; onOpenChange; unavailable?; remaining?; agentName?; onAdd; pending?; error? }`; `MAX_ADDED_SKILLS = 8`; `agent.skills.added`, `agent.skills.add`, `agent.skills.remove`; `VirtualList` (`packages/dugout/src/components/data/VirtualList.tsx`).

**Interfaces, produced:**
```ts
// SkillCard.tsx
export interface SkillCardProps {
  skill: LibrarySkillOption;
  state: "available" | "selected" | "added" | "unavailable";
  reason?: string;                 // why unavailable, or why suggested
  suggested?: boolean;
  result?: { tested: boolean; rating?: number };
  effect?: ReactNode;              // WP-06 fills it ("Used in 3 tasks since Nov 3"); absent: the line is not drawn
  onToggle?: () => void; onPreview?: () => void; onRemove?: () => void;
  previewing?: boolean;
}
// SkillLibraryListProps gains:
suggested?: readonly { key: string; reason: string }[];   // WP-06 passes it; absent or empty: no Suggested group or chip
category?: string | null; onCategoryChange?: (c: string | null) => void;
previewKey?: string | null; onPreview?: (key: string | null) => void;
preview?: (key: string) => ReactNode;                      // the right-hand pane's content
// SkillLibraryDialogProps gains: suggested?: readonly { key: string; reason: string }[]
```
Layout: the dialog keeps `size="lg"` with two panes (list left, preview right) as drawn in s1 §3.12. The preview shows the skill's name, "Adds to <group> · <attribute>", the first 12 lines of `instructionsMd` through `Markdown` under the heading "What <agent> will do", and the line "It never changes tools, spend limits or approvals." Category chips are single-select with counts; the list goes through `VirtualList` above 50 rows; the search result count is a `role="status"` line. An unavailable row shows its reason in place of the description at full opacity (today the whole row is `opacity-60`).

**Copy, before → after.**
- Dialog description (`skills.tsx`): "Each skill gives the agent how-to instructions for a kind of work and shows on its attributes, untested until a training run scores it. Skills never change its tools, how much it may do without asking you, or its…" → "A skill is a short how-to your agent follows for one kind of work. Pick one to read it before you add it. Skills never change an agent's tools, spend limits or approvals."
- Panel title (`AddedSkillsPanel.tsx:66`): "Skills from the library or files" → "Skills <name> has learned".
- Toast (`:42`): "On the attributes now, marked Untested. Library and file skills carry no tests, so a training run reports them as No tests yet; to have one scored, add it as a custom skill." → "<name> will use it from the next task. Not tested yet."
- Empty state (`:81`): the paragraph ending "…To have a skill scored, add it as a custom skill" → "Teach <name> a kind of work: release notes, a pricing page, a first email. Add a skill to see what it says."
- Chip (`SkillPicker.tsx:180`) "Untested" and `TrainingResults.tsx` "No tests yet" → "Not tested yet".
- At the cap: "This agent already has 8 skills from the library or files. Remove one to add another." → "<name> has 8 skills. Remove one to add another."

**Steps.**
1. `SkillCard.test.tsx` (each state's accessible name; the reason replaces the description; Remove is named "Remove <skill>") and a story "Library with 120 skills" built from a fixture generator in the story file. verify: fail, then pass after the component exists.
2. Rebuild `SkillLibraryList` on `SkillCard` with chips, the status line, `VirtualList` and the preview pane; keep every existing prop working. verify: the existing `SkillPicker.test.tsx` cases stay green; new cases "a chip filters", "Suggested is first when given", "no Suggested group when none is given".
3. `SkillLibraryDialog`: pass `preview` from `instructionsMd`. verify: `packages/modules` test "choosing a row shows what the skill says".
4. Move `AddedSkillsPanel` from `TrainingTab` to `OverviewTab` under the Skills panel, with header action "Add a skill"; "Upload a skill file" and "Write your own" (today's `CustomSkillsPanel`, which stays on Training) go in the panel's menu. Apply the copy. verify: `agent-profile.spec.ts` "from Overview, a library skill is added in at most three presses"; `node scripts/plain-language.mjs --gate`.
**Tests and evals:** as above. No eval: no agent behavior changes here (WP-06 owns the eval that a skill changes output).
**Done when:** Done-when 5. With no `suggested` passed the picker opens on "All"; when WP-06 passes it, "Suggested" becomes the default chip with no further change here.

### T9: Ratings a first-timer can read [M] [ships alone]

**Amended by WP-14 T7 (Nov 17, 2026):** there is no dashed Estimate chip any more. Where step 3 says a `starting` row shows an "Estimate" chip, pass the rating figure as `ProvenanceChip`'s children so it draws in the estimate style (with Builder view off, where no figure shows, keep the word: `<ProvenanceChip kind="estimate" />`). The shell already carries the legend line. DESIGN §8 "Estimate / Forecast" and §10 are the rule.

**Why:** TS-02, display side ("Tested 10" is a constant written at hire, not a test result; FOUNDMILL.md "Label every non-real number"); a3b §3.2 ("add one sentence of meaning where a number is shown"); s1 §3.11, §4.3 item 6, P2-6. Recorded decisions this task keeps: ratings out of 20 stay (docs/DECISIONS.md "2026-11-11 — The last five answers to docs/THESIS_REVIEW.md §14", answer 3); with Builder view off a rating draws as its band word (docs/DECISIONS.md "Builder view… PR 1 of 2", Nov 8, 2026). Whether the figure should also show with Builder view off is founder decision 5 below; this task makes it a one-line change.

**Files.** Create: `packages/dugout/src/components/guidance/RatingKey.tsx` (+ story, test; add to `SERVER_SAFE_FILES` in `clientBoundaries.test.ts`), `packages/dugout/src/lib/rating-words.ts` (+ test). Modify: `packages/dugout/src/components/data/SkillGrid.tsx`, `RatingBar.tsx` (`RatingFigure`), `packages/modules/src/team/SquadScreen.tsx`, `apps/web/components/agents/logic.ts` (`toSkillRows`), `OverviewTab.tsx`, `packages/shared/src/terms.ts` (`potential`, line 557), `apps/web/components/agents/__tests__/w19-logic.test.ts`.

**Interfaces, consumed:** `SkillRow { id; name; group; value; delta?; tested?; proven?; tasks?; potential?; note? }`; `toSkillRows(skills: readonly AgentSkillRecord[], runs: readonly TrainingRunRecord[] = []): SkillRow[]`; `latestPromotedRun(runs)`; `ratingBandLabel`, `RATING_MAX`, `ScaleLabel({ value, scale, compact })`, `useBuilderView()`, `SKILL_GRID_FOOTER`.

**Interfaces, produced:**
```ts
// packages/dugout/src/lib/rating-words.ts
export const RATING_SHOWS_FIGURE_WITHOUT_BUILDER = false;            // founder decision 5 flips this one constant
export function ratingText(value: number, opts: { figure: boolean }): string;   // "14 of 20 · Good" | "Good"
export type RatingSource = { kind: "starting" } | { kind: "tested"; on: string } | { kind: "work"; tasks: number };
export function ratingSourceLine(s: RatingSource): string;
// "Starting estimate. Not tested yet." | "From practice tests on Nov 14." | "From 12 tasks of real work."
// SkillRow gains: source?: RatingSource
// RatingKey.tsx
export interface RatingKeyProps extends HTMLAttributes<HTMLParagraphElement> { compact?: boolean }
export const RATING_KEY_WORDS = "1–5 Poor · 6–10 Average · 11–15 Good · 16–20 Excellent";
```
`toSkillRows` sets `source`: `work` when `nLive > 0`; `tested` when a promoted run has a result for the skill (date from the run's `endedAt`); otherwise `starting`. When WP-06 starts writing `tested: null` at hire, the same branch already yields `starting`.

**Copy, before → after.**
- `SKILL_GRID_FOOTER`: "Scores 1–20. 'Tested' is the result on practice tests, 'Proven' the result on real work; more real work makes Proven count for more. Potential is how good the agent could become with training." → "Scores run from 1 to 20. A new agent starts on an estimate for its role. Practice tests and real work replace it as they happen."
- Builder view hover (`skillHoverText`): "Tested 10" for a `starting` row → "Starting estimate 10".
- `terms.ts` `potential`: the sentence "An agent close to its ceiling is better replaced than trained" is removed (at hire potential equals the rating, so it reads as "replace the whole team"); the definition ends at how good the agent could become with training.
- `SquadScreen.tsx:257`: "Rating is the 1–20 mean of the agent's skills." → "Rating is the average of the agent's skills, from 1 to 20. New agents start on an estimate."

**Steps.**
1. `rating-words.test.ts`: every band; "no bare number" (the text always contains a band word, and "of 20" whenever `figure` is true); the three source lines; US date. verify: fails, then passes.
2. `RatingKey` with the four swatches each beside its word; draw it once in the Skills panel header on `OverviewTab` and in the Agents table footer. verify: story; `RatingKey.test.tsx` "each swatch has its word".
3. `SkillGrid`: the figure's title and accessible name through `ratingText`; a `starting` row shows an "Estimate" chip (the existing dashed chip) in both views; under the panel title, the source line of the row set ("From practice tests on Nov 14." when any row is tested, else the starting line). verify: new `packages/dugout/src/components/data/SkillGrid.test.tsx` "a starting row is labeled Estimate", "Builder view off shows the band word and no figure".
4. `toSkillRows` and the copy changes. verify: `w19-logic.test.ts` three source cases; `agent-profile.spec.ts` "a new agent's skills say Starting estimate".
**Cut from the audit:** dropping the stars and the /10 mean from agents (s1 §3.11): both already carry a caption and a band word (DESIGN §10 rule 8), and removing them changes a kept part of the default view. Regrouping the Agents list into "Working now / Waiting for work" and reordering the profile belong with WP-04's starting-team task. Measured ratings and Proven are WP-06's.
**Done when:** Done-when 6.

### T10: The ask before the evidence [M] [ships alone; check WP-04 and WP-05 first]

**Why:** s1 §3.10, P1-7 (113 of 127 approval requests unanswered; the decision is the last thing in a long note; "Expires in 5 days" states no consequence). If WP-04 or WP-05 has already reordered `ReadingPane.tsx`, skip this task and tick it with a link to that pull request.

**Files.** Create: `packages/dugout/src/components/shell/DecisionLead.tsx` (+ story, test). Modify: `apps/web/components/inbox/ReadingPane.tsx`, `packages/dugout/src/components/shell/DecisionBar.tsx` (the deadline sentence only), `apps/web/e2e/inbox.spec.ts`.

**Interfaces.** Consumes `DecisionBarProps { options: DecisionOption[]; onChoose; disabled?; executing?; answered?; onReopen?; hotkeys?; sticky?; note?; deadline? }` and `DecisionOption` (label, consequence, cost as an Estimate, reversibility, recommended). Produces:
```ts
export interface DecisionLeadProps {
  agentName: string;
  recommended: DecisionOption;                 // the option tagged Recommended; no tag: the component renders nothing
  others: readonly DecisionOption[];
  onChoose: (o: DecisionOption) => void;
  onAsk?: () => void;                          // "Not sure? Ask <name>"
  disabled?: boolean;
}
```
It renders, in reading type above the note body: "<Agent> suggests: <option>. <consequence>. Costs <x> (Estimate). <Can be undone | Cannot be undone>.", the recommended option as the one filled button, the others as secondary buttons, and "Not sure? Ask <name>". It calls the same `onChoose` the bar does, so the plan dialog and every policy check are unchanged. The note body, metric strip and exhibit follow under a heading "Why". The sticky `DecisionBar` stays for long notes.

**Copy.** Deadline (`DecisionBar` `deadline`): "Expires in 5 days" → "If you do nothing by Nov 20, <agent> waits." (the date through `useFormatters()`).

**Steps.** 1. `DecisionLead.test.tsx`: "renders nothing without a recommended option", "the filled button is the recommended one", "choosing calls onChoose once". verify: fail then pass. 2. Mount in `ReadingPane` above the body when guidance is on and the note has a decision. verify: `inbox.spec.ts` "the recommended option is in the first viewport at 1440 and precedes the note body in DOM order"; the existing decision tests stay green. 3. Deadline sentence. verify: `DecisionBar.test.tsx`.
**Tests and evals:** as above; no eval (the agent's note is unchanged). Measure afterward with WP-02's nightly report: answered / asked.
**Done when:** a note with a decision shows the suggestion, its cost and the buttons before any evidence.

### T11: Settings opens on five basics [S] [ships alone]

**Why:** A2-04 (ten Settings tabs for everyone, opening on "Business"); s1 §3.13, P2-7.

**Files.** Create: `apps/web/components/settings/BasicsTab.tsx` (+ test). Modify: `apps/web/lib/search.ts` (`SETTINGS_TABS`, `SettingsTabSlug`: add `basics` first), `apps/web/components/settings/SettingsScreen.tsx` (`ICONS`, `TABS`, the default tab for a guided account), `apps/web/lib/sidebar.ts` (Settings href → `basics` when guidance is on), `apps/web/e2e/settings-*.spec.ts` (one new case).

**Interfaces.** Consumes `routes.settings(businessId, slug)`, `useBusiness()`, `useGuidancePreferences()`, `teamCanDoWords` (`packages/shared/src/team-can-do.ts`), the credits figure Billing already reads. Produces tab slug `basics`: five rows, each a link with its current value, to the existing tabs: "Name and logo" → `business`; "How much your team asks before acting" → `mode` (value: the `teamCanDoWords` sentence); "Text size and explanations" → `preferences`; "Credits and spending" → `billing` (value "$3.20 of $5.00 left this month", labeled Estimate if the figure is one); "People" → `people` (value "Just you" or the count; never a prompt to add someone: Solo is complete). The other tabs follow under a group label "Everything else". No setting moves and no tab is renamed here (renames are WP-02's vocabulary pass).

**Steps.** 1. `BasicsTab.test.tsx`: five rows, each an anchor with a value; the People row with one person reads "Just you" and holds no call to action. verify: fail then pass. 2. Wire the tab and the default. verify: Playwright "a guided account's Settings opens on Basics; Builder view opens on Business as before".
**Done when:** a first-timer reaches each of the five settings in one click from Settings.

### T12: States that lose or hide information [S] [ships alone]

**Why:** A2-25, A2-27 (toasts), A2-19, A2-16 (the minimum).

**Files and changes.**
- `apps/web/components/journey/JourneyScreen.tsx:89`: `if (journeyQ.error && !notFound)` → `if (loadFailed(journeyQ) && !notFound)`, and render `<RefreshFailedNotice query={journeyQ} />` above the replay (both helpers exist in `apps/web/components/shell`). Test: `journey` unit "a failed background refetch keeps the loaded replay".
- `apps/web/components/milestones/MilestonesScreen.tsx:54`: `new Date().toISOString().slice(0, 10)` → `useToday()` from `@foundmill/widgets/data` (the project's day). Test: with the project in `America/Los_Angeles` at 23:30, the query key holds the local day.
- `packages/dugout/src/components/foundation/Toast.tsx`: a toast with `tone: "warn" | "bad"` or with an `action` defaults to `duration: Infinity` (the dismiss button exists); others keep 5000. Test: `Toast.test.tsx` (new) three cases.
- `apps/web/components/inbox/ReadingPane.tsx:206, 399`: `onMutate` for `inbox.markRead` and `inbox.archive` (update or remove the row in the `inbox.list` cache, restore it in `onError`). Decisions stay pessimistic. Test: `inbox` unit "archive removes the row at once and puts it back on failure".
- `ReadingPane.tsx:276-332`: replace `dev.tasks.list({ limit: 500 })` with a count. New procedure in `apps/api/src/routers/dev.ts`, beside `tasks.list` (line 108): `tasks.count: read.input(TaskListFilter.pick({ status: true, kind: true, departmentId: true })).query(...)` returning `{ count: number }` from a `count(*)` over the task repo's existing filter, under the same `read` guard and `ctx.rls` as `tasks.list`; test in `apps/api/src/__tests__` with the cross-tenant refusal. The full "one read" redesign of A2-16 is not done here: the count removes the only heavy query, and the rest are small.
**Steps.** One commit per bullet, test first each time. verify: the named tests; `pnpm test:e2e inbox journey milestones`.
**Done when:** the five tests pass.

### T13: Today's bundle, dead code and a token scanner [S] [ships alone]

**Why:** A2-15, A2-20, A2-22, A2-23; s1 §2 (token leaks).

**Files and changes.**
1. Bundle. `apps/web/components/today/TodayScreen.tsx:31` and `apps/web/components/home/lead.tsx:14` import from the `@foundmill/widgets` barrel, whose last line registers every widget. Create `packages/widgets/src/shared/today-tiles.ts` holding `cashTile`, `runwayTile`, `customersWeekTile`, `spendWeekTiles`, `unavailableTile`, `StatusTile` (moved out of `widgets/status-strip.tsx`, which re-imports them); change the two imports to `@foundmill/widgets/shared/routes`, `/shared/departments`, `/shared/today-tiles` (the package's `"./*": "./src/*.ts"` export already serves them). Add `"sideEffects": ["./src/index.ts", "./src/widgets.ts", "./src/widgets/*.tsx", "**/*.css"]` to `packages/widgets/package.json`. Not done: `optimizePackageImports` (unmeasured; add it only if the budget below is missed). Guard: in `apps/web/e2e/speed.spec.ts`, sum `transferSize` of script resources on a cold load of `/b/<id>/today`, record the figure before and after in the pull request, and assert at most the after figure plus 10 % (Estimate until measured; an earlier Home budget was 550 KB gzipped). verify: the figure drops; the test passes.
2. Dead code. Delete `apps/web/components/placeholders/HomePlaceholder.tsx`, `SurfacePlaceholder.tsx`, `apps/web/components/shell/ComingSoon.tsx` (imported by nothing: confirm with `grep -rn "ComingSoon\|HomePlaceholder\|SurfacePlaceholder" apps packages`). Remove the unreachable `matchday` state: `ContinueState` member (`packages/dugout/src/components/shell/types.ts:73`), its four cases and `onGoToJourney` in `ContinueButton.tsx` (31, 75, 139, 155, 290), `onGoToJourney` in `BusinessShell.tsx` (635 to 646, 874) and the `matchday` branches of `journeyHref` (`apps/web/lib/continue-state.ts:82-83`), with their tests and story. Fix `screenTitle ?? "Home"` → `"Today"` (`BusinessShell.tsx:852`). verify: typecheck; `ContinueButton.test.tsx`, `continue-state` tests.
3. Storybook. `packages/dugout/.storybook/preview.ts` `initialGlobals.builderView: "on"` → `"off"`, so a reviewer sees what a founder sees. verify: the story axe run still passes (fix or baseline nothing new: a story that needs the engine pins `globals.builderView`).
4. Scanner. Create `scripts/design-tokens.mjs` (+ `scripts/design-tokens.test.mjs`, in the style of `scripts/focus-visible.mjs`): fail on `#[0-9a-fA-F]{3,8}\b` in `.ts`/`.tsx` under `apps/web` and `packages/{dugout,modules,widgets}/src` outside tests, stories and an allowlist file `scripts/design-tokens.allow.json`; fail on class fragments matching `-\[[0-9.]+(px|rem|vh|vw|%)\]`. Seed the allowlist with today's hits (the 15 files with hex literals and the 45 arbitrary values A2-20 lists), so the gate holds the line now; fix the four cheapest in this pull request (`apps/web/app/layout.tsx:23` is a `themeColor` and stays allowlisted with a reason; `BusinessSwitcher.tsx:216` `#1b4fd8` and `IdeaCard.tsx:99` `#3a87ff` read the steel default from the tokens; `PhoneBar.tsx:104` `max-w-[85vw]` becomes a token `--phone-menu-max`). Add the script to the lint job in `.github/workflows/ci.yml` beside `focus-visible.mjs` (rebase on WP-01 and blissful-fermat first). verify: `node scripts/design-tokens.mjs` passes; adding `text-[17px]` to any component fails it.
**Done when:** Done-when 7.

## What was cut, and why

| Audit item | Decision |
| --- | --- |
| A2-04 step 4 (a dot and a "Money opened" line when an area appears) | Cut: nothing shows people miss a new area; add it if they do. |
| A2-04 "Stop all agents into the menu" | Cut (T2). |
| §3b F2 (caps data labels only in Builder view), F7 (two-line Continue), F8 (40 px rows), F10 (glow budget) | Cut: taste, no finding behind them; each restyles many screens. |
| §3b F4, F5 (Today's reading column and voice line) | WP-04 owns Today. |
| A2-08 body 14/21, rem root; F3 `text-3` lift; s1 pill fill 10 %; "Large" text | See T5. |
| A2-16 one-read note | Shrunk to the count procedure (T12). |
| A2-21 `--spacing: 4px` | Shrunk to a correction in DESIGN §6 (T6). |
| A2-23 fifteen missing stories, moving `PeopleList` | Cut: a story is owed when a component is next changed (the Definition of done already says so). |
| s1 §4.3 `Sheet`, `Note`, `Stepper`, `Checklist`, `IdeaAnswers` | Not console pieces: WP-03 and WP-04 build what their screens need. |
| s1 P1-11 (console scrolls sideways between 640 and 1279 px) | Founder question 3; not built until answered. |
| A2-26, s1 §3.9 (streak without "Not opened") | Founder decision 6; not built until answered. |

## Corrections to the audits

1. s1 §5.1 K2 and P2-3 say the shell has no skip link. It has one: "Skip to content" in `packages/dugout/src/components/shell/AppShell.tsx:419` and `:493` (a2 §1.17 is right). `StudioFrame` has none; that frame is WP-04's.
2. A2-13 proposes adding `@storybook/addon-vitest` and axe in Playwright. Branch `claude/blissful-fermat-q03yq1` already does both jobs another way (a Playwright run over the built stories with a baseline, and `apps/web/e2e/axe.ts`). T7 extends that; it adds no second runner.
3. A2-04 puts the Board behind `distributionStarted`. The Board is where distribution is started (`business.startDistribution`, "via: board"), so T1 shows it once the page is live.
4. A2-04's fix names `StageFacts` fields `firstPaymentAt`, `roundsCompleted`, `ageDays`, `cofounders`. `business.get` has no cheap source for a payment date or a round count; T1 uses booleans from reads that exist (`countPayingCustomers`, one `cycle.completed` event) and `people` from memberships.
5. s1 §3.13 lists the Settings tabs as "Business, Mode, Departments, Glossary, Members…". The labels in code are Business, What the team can do, Departments, Your words, People, Integrations, Keys, Billing, Preferences, Danger zone (a2 §1.11); the slugs are what s1 quotes.
6. s1 §2.8 and A2-14 name the same new token differently (`--line-control`, `--line-field`) with the same value. T5 uses `--line-control` because it also edges checkboxes, radios and switches.
7. s1 §3.11 and DESIGN §9 disagree with DECISIONS on ratings: the Nov 8 Builder view decision draws a rating as its band word when the switch is off, and the Nov 11 answer says ratings out of 20 stay the default view. The code follows Nov 8. T9 keeps the code's behavior and asks (decision 5).
8. A2-15 asks for `sideEffects` on `packages/modules` too. Today's imports do not touch modules' pack indexes, so T13 leaves that package alone.

## Decisions for the founder

Questions 1 to 4 are carried from `audits/s1-design-critique.md` §9. Only 3 blocks work in this package; 1, 2 and 4 are answered inside WP-03 and WP-04 and are repeated here so they are not lost.

1. **Is the landing page for the first-timer alone,** with the investor's material moved to a linked tour? Most of s1 §3.1 follows from the answer. (WP-03.)
2. **May the main action on outer pages be the flat filled primary,** including "Shape my idea", reversing the Oct 10 and Nov 13 glass and dark-outline decisions for that one role? (WP-03, WP-04.)
3. **May the console scroll sideways between 640 and 1279 px instead of showing the wall?** It fixes zoom for low-vision users (WCAG 1.4.4, 1.4.10) and 13-inch laptops at once. It needs FOUNDMILL.md's "Never show the dense console below 1280 px" read as "never lay it out narrower than 1280 px". If yes, it is one more S task here: `DesktopOnly.tsx` and `AppShell.tsx` render at `min-width: 1280px` in a scrolling shell with a dismissible note; test at 1152 × 800.
4. **How far should a phone-only person get:** the profile and "Start building" with a name, so that Today (which already works on a phone) is reachable? (WP-04.)
5. **Should a rating's figure show with Builder view off** ("14 of 20 · Good" instead of "Good")? Nov 8 says band word only; Nov 11 says ratings out of 20 stay the default view. Yes is one constant in T9 (`RATING_SHOWS_FIGURE_WITHOUT_BUILDER`).
6. **The streak (your Nov 12 decision):** keep "Not opened" days and the at-risk line, or show only the days opened? Both audits read the empty days as the one place the product grades the person (A2-26, s1 §3.9).
7. **T6 replaces §1 of DESIGN.md,** the Oct 9 "Mission control 2027" brief, for the default view; the control room becomes Builder view. Merging T6 is the yes.

## Risks

- **T1 hides Money on day one.** A founder looking for what the team costs finds it on Today's spend tile and in Settings › Basics (T11) until the first round finishes. If WP-04 removes the spend tile, keep `wage-bill` unconditional.
- **T1 adds six reads to `business.get`,** which the shell prefetches on every project open. They run in the existing parallel batch; check `speed.spec.ts` timings before and after, and move them to `business.firstWeek.get`'s style of separate read if the shell slows by more than 50 ms (Estimate).
- **T5 is visible everywhere:** brighter field edges, lighter red and blue, a thicker focus ring, larger reading text. The contrast figures are computed with an sRGB blend while the browser mixes in oklab, so each is an Estimate within about ±0.1; `status-bad` on surface-4 passes by 0.01. If the story axe run disagrees, lift `--status-bad` one step further (`#f78f93` gives 5.09) and say so in the pull request.
- **Comfortable text as the default** has only been checked by `no-clip` at standard size; step 5 of T5 exists to catch a clipped cell.
- **Order with other sessions.** T2, T5, T6, T7, T13 touch files `claude/blissful-fermat-q03yq1` changes; T8 touches files WP-06 changes; T1, T2 and T10 touch `BusinessShell.tsx` and `ReadingPane.tsx`, which WP-02, WP-04 and WP-05 edit. Run `plan-change` before each task.
- **T8 without WP-06** improves reading and adding a skill but cannot show what a skill changed; the zero-adds number may not move until WP-06 lands defaults and suggestions.

## Starting prompt

```
You are executing docs/holistic-plan/WP-10-console-and-design.md in the Foundmill repo. Read, in this order: FOUNDMILL.md; docs/holistic-plan/README.md; the work package; packages/dugout/CLAUDE.md, packages/modules/CLAUDE.md, apps/web/CLAUDE.md, apps/api/CLAUDE.md; docs/DESIGN.md §1 to §10; and, for the task you are on, the audit sections it cites in docs/holistic-plan/audits/ (a2-console-design.md, s1-design-critique.md, a3b-templates-skills-team.md).

Before any code: run the plan-change skill; confirm WP-04 has merged and whether claude/blissful-fermat-q03yq1 has merged (T2, T5, T6, T7 and T13 wait for it or rebase on it); ask the WP-06 session which of us edits packages/modules/src/team/skills.tsx first. Tell me what you found.

Then take the tasks in this order: T1, T2, T3, T4, T12, T13, T5 with T6, T7, T9, T8, T10, T11. One task is one branch (claude/wp10-t<n>) and one pull request; never push to main and never merge. For each task: follow the karpathy-guidelines skill (state assumptions, the smallest change, touch only what the task names); write the named failing test first (test-driven-development skill); use dugout components and tokens only; show every changed string before and after in the pull request; run typecheck, lint, the unit tests, the Playwright specs the task names, node scripts/banned-terms.mjs, node scripts/us-english.mjs and node scripts/plain-language.mjs --gate; add a Storybook story for each new component; then run verify-done and report each check with its result and what the checks do not cover. Add one line to docs/PROGRESS.md, record judgment calls in docs/DECISIONS.md, and tick the task in the work package file in the same pull request.

Do not build anything listed under "Scope out" or "What was cut". Do not start founder decision 3 or change the streak until I answer. If the code no longer matches a path, name or line in the work package, follow the code and say so in the pull request.
```
