# A2 — The in-project console and the design system, as a first-timer meets them

Audit of `/Users/reidjackson/code/founder-manager` at `04a0a509` (main, 2026-11-15). Read-only. All paths below are relative to that root. Nothing was built or run: every statement is from the source, the docs and the Oct 20 screenshots in `docs/ux-audit/`. Contrast figures are computed here from `packages/dugout/src/tokens.css` with the WCAG formula (tints blended in sRGB, so a tint figure is an Estimate within about ±0.1). Word counts per screen are Estimates from the string constants.

Scope read: `apps/web/app/b/[bid]/**`, `apps/web/components/{shell,providers,today,home,inbox,screen,tours,settings,milestones,journey,crm,calls,email}`, `apps/web/lib/*`, `packages/dugout/src/**`, `packages/widgets/src/{registry,data,index,widgets/status-strip}`, `packages/modules/src/{registry,env,lazy}`, `packages/shared/src/{areas,constants,terms,empty-why,first-week,area-words,team-can-do}`, `docs/DESIGN.md`, `docs/UX_AUDIT_AND_PLAN.md`, `docs/THESIS_REVIEW.md` §6, §12, §13, `docs/PROGRESS.md` 1286–2191, `.github/workflows/ci.yml`, `eslint.config.mjs`.

---

## 1. How it works today (what a founder sees in week one)

### 1.1 The request path and the providers

- `apps/web/app/layout.tsx:35-52`: `<AppProviders>` → `<DesktopOnly>` → page. The viewport meta stays `width=device-width`; `themeColor: "#0F1318"` (line 23).
- `apps/web/app/b/loading.tsx` → `ShellSkeleton` (rail, top bar, `ScreenSkeleton`) while the layout waits.
- `apps/web/app/b/[bid]/layout.tsx:45-98` (server, `force-dynamic`): profile gate (redirects to `/onboarding` unless `profile.complete && profile.adultConfirmed`, line 67), then `business.get` + `department.list` + date format + guidance prefs in parallel; `inbox.list`, `finance.overview`, `cycle.status` are prefetched and handed over pending (`lib/shell-data.server.ts`). Provider order: `Prefetched` → `GuidanceHost` → `DateFormatHost` → `AgentPersonaHost` → `BusinessShell` → `BusinessTitle` + page.
- `apps/web/app/b/[bid]/page.tsx` redirects to `/b/<id>/today`. `error.tsx` uses Next 16's `retry` (`components/shell/RouteError.tsx`), `trophies/page.tsx` redirects to `/milestones` (the only place `/trophies` survives; `lib/sidebar.ts:173` still lights Plan for it).
- `BusinessShell` (`apps/web/components/shell/BusinessShell.tsx`, 942 lines, client) wraps the page in: `GuidanceTermsProvider` (definitions with the business glossary applied) → `BusinessProvider` → `WidgetDataHost` → `ModuleEnvProvider` → `SpecUserProvider` → `EntityLinkProvider` → `ShellLinkProvider` → `AppShell` (design system) → `AgentDeskHost`.
- Every screen under `/b/[bid]` is a client component; the route files are thin server wrappers. 151 of 152 files in `apps/web/components` open with `"use client"`. Server prefetch exists only for the shell, Today (`goal.current`, `today.get`) and Details (`dashboard.list`, `dashboard.get`).

### 1.2 The sidebar and the areas model

- Built by `buildSidebarItems` (`apps/web/lib/sidebar.ts:108-148`) from `department.list` + `inbox.list`. For a new project (six default departments from `packages/agents/src/archetypes.ts:32-39`, plus Operations for a physical product) it lists, in order: **Today**, **Needs you** (badge = `counts.respond`, red tone), **Plan**, **Customers**, **Money**, **Product**, **Team**, **Team call**, then a hairline, **Network** (always), **Communities** (only when `gameMode === "live"`), then the foot: **Settings**, **Sign out**, the "?" keyboard cap, the collapse toggle and the Foundmill wordmark. Twelve items for a solo, Personal-mode project.
- Areas are a mapping over `(module, tab)`: `packages/shared/src/areas.ts:29-49` (`MODULE_AREA`, `TAB_AREA_OVERRIDES` product›roadmap → Plan, `AREA_FIXED_TABS` Milestones → Plan, Contacts → Customers, `AREA_SECTIONS` legal → "Company" inside Money). Tiers come from `packages/shared/src/constants.ts:82-110`: `DEFAULT_TABS` (inline), everything else `detail` (behind the tab bar's "More detail" menu), `BUILDER_ONLY_TABS` (Code, Health, Hierarchy: not offered at all with Builder view off).
- Tab counts with Builder view off, default departments (inline + detail): Plan 2 + 0 (Roadmap, Milestones); Customers 3 + 4 (Leads, Campaigns, Contacts | Board, Channels, Creative, Attribution); Money 4 + 9 (Overview, Runway, Company, Compliance | Profit and loss, Cash, Payroll, Cap table, Incorporate, Contracts, IP, Policies, Regulatory); Product 4 + 7 (Specification, Public page, What changed, Live product | Vision, Changes, Sources, Research, Working now, Work list, Specialists); Team 2 + 2 (Agents, Recruitment | Staff, Responsibilities). Total 15 inline, 22 behind "More detail", 3 Builder-only. This is exactly the 39 area tabs THESIS §6.1 counted on Nov 11.
- **"Show by stage" (THESIS 6.1) is not built.** There is no stage or data condition anywhere in `areas.ts`, `constants.ts` (`tabTier`, `visibleTabs`) or `sidebar.ts`: tiers are static constants. The only gates are access walls (`canOpenDepartment`), Builder view, and `live` for Communities.
- Area landing: `areaLanding` = first inline tab. So Plan → Product › Roadmap; Customers → Distribution › Leads; Money → Finance › Overview; Product → Product › Specification; Team → Team › Agents.
- Each area tab opens on one sentence (`AreaOpening` from `@foundmill/modules/areas`, words in `packages/shared/src/area-words.ts`). Week one, Money reads "Connect your bank and this line shows your cash and how long it lasts." (`area-words.ts:93`).
- G chords: G H Today, G I Needs you, G P / C / M / R / T for the areas (`AREA_LETTERS`).

### 1.3 The top bar (`packages/dugout/src/components/shell/KitBar.tsx`)

Left to right at 1440 px: logo + project name (the business switcher: "Switch business", "Create a new business", "Manage businesses", Your profile, Your public profile), back / forward, the screen title, the search chip ("Search or jump to…" + ⌘K), then the right cluster: `ConnectionChip` (only when the stream is down), `RunwayChip` (date + runway), `GameModeChip` (LIVE only), `ModeChip`, `ContinueButton`, `StopAllAgents`.

- **Runway chip**: for a project with no bank it reads the date and "Not known yet · connect a bank" (`packages/widgets/src/shared/runway.ts:26`), tooltip "Runway: how many months your cash lasts…". Click opens Finance. It is shown from day one to everyone.
- **Mode chip**: `teamCanDoWords` (`packages/shared/src/team-can-do.ts:141-150`): "Asks before acting" (augmented), "Asks before spending over $250" (assisted; the default line is `LIMITS.approvalThresholdMinorDefault` = 25000 minor, `packages/config/src/limits.ts:16`), "Decides alone, asks over …" (automated). Click → Settings › What the team can do.
- **Stop all agents**: an icon button with a confirm dialog ("Nothing is deleted. … Tasks keep their state…"), admin-only; while stopped it becomes "Resume agents".
- The bar compacts in steps (`KitBarFit`): chips shorten before anything clips.

### 1.4 Continue, and what a press means today

State is computed in the browser by `computeContinueState` (`apps/web/lib/continue-state.ts:87-95`), priority vacation › hard stop › processing › idle:

| State | Label | A press does |
| --- | --- | --- |
| idle | "Continue" (brand primary, Play) | `business.continue`: starts a **run**: the next round of work, then another, until nothing is left, a day's limit, a hard stop or Pause (`BusinessShell.tsx:583-601`). If no orchestrator answers, the api writes one note in-process. |
| processing (the whole run, between rounds too) | "Pause" (dark slab, orbiting arc) | `business.pauseCycle`: pauses running tasks and ends the run. |
| blocked (only credits used up or a revoked key since Nov 7) | "Needs you · N" (amber) | Opens the Inbox's Needs you tab on the first blocking note. Open decisions never block. |
| holiday | "Come back" + "On vacation until …" | `business.endHoliday`, then opens "While you were away". |
| matchday | "Go to Journey" (gold) | Still implemented in `ContinueButton.tsx:290-296`, but `computeContinueState` never returns it (dead state). |

- Tooltip (`ContinueButton.tsx:127-144`): idle, guidance on: "Let the team work, one cycle after another, until nothing is left to do. A cycle is one round of work…" plus a Space key cap; a warn line when the orchestrator is down ("The orchestrator is not reachable right now: a press writes one note; no agent works.", `BusinessShell.tsx:221`); a hint "Last cycle cost $0.52 · Estimate" (`:243-246`).
- After a press the processing line says "Starting the next round of work…" (Builder off) then the api's one sentence, for up to 15 s, and a toast repeats it (`describeContinue`).
- **Space is Continue** whenever focus is on the page and not on a control (`packages/dugout/src/components/shell/keyboard.ts:152-160`, `spaceBelongsTo`), with no confirmation, for every account.
- First-Continue callout (`FIRST_CONTINUE_CALLOUT`, `BusinessShell.tsx:284-288`): "This is how you move forward" / "Press it when you have answered what needs you.", shown while `cycle.completedCount <= 1`, once per account.

### 1.5 Processing strip, connection, toasts

- 3 px strip under the top bar, one segment per department (`ProcessingStrip.tsx`), `role="status"`. Its sentence: "No cycle running" when idle (`:43`); "Product and Finance are working" when active (cycle number only in Builder view). While guidance is on, `AppShell.tsx:343` repeats the sentence at the right end of every tab row.
- Connection: `shellConnection` (`BusinessShell.tsx:193-200`). Builder off: nothing for a short drop, "Updates may be late" after 30 s; "off" when never live. The stream client reconnects with backoff and jitter, probes on `visibilitychange` and `online`, and `resyncBusiness` refetches every query of the business after a gap (`lib/stream.ts`, `lib/stream-client.ts`, `lib/query-client.ts:59-61`). Polling is the safety net (30 s without a stream, 60 s with).
- Toasts stack bottom left beside the sidebar (`useToastPlacement`).

### 1.6 Search and the keyboard

- The palette (`CommandPalette`, placeholder "Search, ask an agent or generate…"): CRM records (`crm.search`, debounced 150 ms), "On Foundmill" people (LIVE only), local screens and commands (`apps/web/lib/search.ts:78-150`), "Ask <agent>" rows that open the agent desk, "Call <agent>", "Generate…", and a Help group (every defined term + Keyboard shortcuts). Operators (`>`, `key:value`) are hidden until typed.
- Single-key shortcuts, always on (`keyboard.ts:309-323`): Space Continue, `/` and ⌘K search, G chords, R refresh the Inbox (one new note, a model call), J / K, **1–4 choose a decision option**, E edit layout, `?` help, Esc. Key caps on buttons are hidden while guidance is on; the keys still work. There is no preference to turn them off (`AppShell.tsx:372`: `enabled: keyboard?.enabled ?? true`, never passed).

### 1.7 Builder view

- What: one account-wide switch (`account_preferences.builder_view`, migration 0073) that shows "how the platform runs the team": cycle numbers, tokens, ETAs, test counts, the Code / Health / Hierarchy tabs, ratings out of 20, technical columns, the agent Logs tab, and every area tab inline with no "More detail" menu (DESIGN.md "Builder view", lines 241-251).
- How toggled: Settings › Preferences › Builder view (`apps/web/components/settings/PreferencesTab.tsx:231-260`); the inline "Turn on Builder view" on a gated screen opened by URL (`components/screen/BuilderGate.tsx`); found in the palette by "builder view". Off for a new account; turned on by the first profile save of an Exited or Operator founder.
- Primitives: `BuilderViewProvider`, `useBuilderView()` (false outside a provider), `<BuilderOnly fallback>` (`packages/dugout/src/components/guidance/BuilderView.tsx`); `DataTable` columns with `meta.builderOnly`; the tab registry in `constants.ts`.
- It does **not** hide: the runway and mode chips, Stop all agents, the Autopilot section, any of the 22 "More detail" tabs, Settings' ten tabs, single-key shortcuts.

### 1.8 Today (`/b/[bid]/today`, `apps/web/components/today/TodayScreen.tsx`)

Tab row: **Today | Details**. Content, top to bottom (`:196-246`):

1. `FormerProjects` (only for a former founder), `HomeBlockers` (the team could not start: out of credit, no key), `HomeFoundations` (the first-open drafting banner: vision, specification, roadmap as they are written).
2. `SinceLastVisit` ("Since you were last here", `today.visit`), `StreakStrip` ("Your streak": the last seven days as Opened / Not opened).
3. `FirstWeekTimeline` ("Your first week", Day 1 / Days 2–3 / Week 1; shown under 10 days old and before distribution starts; words in `packages/shared/src/first-week.ts:113-139`).
4. `GoalPanel` (6 columns): week one "Your Chief of Staff proposes a goal after the first round of work."
5. `NeedsYouList` (6 columns): up to three notes, one-tap answer where the note has a quick option, "Open" otherwise, "See all in the Inbox". Empty: "Nothing needs you yet. Your first notes, the specification and the roadmap to sign off, arrive once the team finishes drafting them, usually on day 1." (`empty-why.ts:57`).
6. `PublicPageNote` ("Your project's public page is ready to check" → Product › Public page), `PostReadyNote`.
7. `WeekPlan` ("This week and next"; empty: "The week's work shows here after the first round of work, which starts when you press Continue.").
8. "Health" panel: Cash, Runway, Customers this week, and one or two spend tiles (`packages/widgets/src/widgets/status-strip.tsx:116-190`).

Reading load, day one, guidance on, Builder off, 1440 px (Estimate): chrome about 45 words (sidebar 14, top bar 22, tab row 8) and content about 300 to 390 words (first-week panel alone about 110), with 8 to 12 numbers. Words a first-timer meets here with no definition on the screen: specification, roadmap, sign off, round of work, cycle (tab row), channels, Details, streak, AI usage. Defined on hover: Runway, Estimate; "Chief of Staff" through the goal panel's help.

### 1.9 Details (`/b/[bid]/home`, the dashboards; `apps/web/components/home/HomeScreen.tsx`)

Title "Details" (`:243`). Above the grid: the same blockers and foundations, `HomeAutopilot` (the Autopilot chip), `HomeLead` (the "Day one" panel with `NextStep` and ghosted milestones on day one, a one-line next step afterwards, `:454-499`). The grid is the stored layout: the Founder's view preset (`packages/config/src/dashboard-presets.ts:66-82`) = Journey ribbon, status strip, one department card per department, team pulse, Inbox preview, **first-week checklist**. The Home tour (`HomeTour`, `:280`) mounts here. Edit (E), New from preset, rename, share, delete.

### 1.10 Inbox / Needs you (`/b/[bid]/inbox[/<id>]`)

- `InboxScreen.tsx`: title "Inbox" (`:228`); tabs All, Needs you, Customers, Updates, Messages (LIVE only), Archive (`inbox/logic.ts:17-20`); 380 px list + reading pane; selection in the URL through `history.pushState`; Refresh (R) asks for exactly one new note; empty reading pane "Select a note".
- `ReadingPane.tsx` (756 lines): header (sender, date, department chip, related entities), the note (Markdown with terms defined on hover), a strip of up to four live metrics, the exhibit (folded under "Show the numbers" while guidance is on), the conversation with the agent, then `DecisionBar` (2–4 options with consequence, cost as an Estimate, reversibility, "because", a Recommended tag; "Pick one. Nothing runs until you do."), `ApprovalPanel` for an agent's gated call, `SignoffPanel`, and `ConfirmPlanDialog` ("Here is what will happen": every action with "Allowed on its own" / "Needs your go-ahead because it spends money" / "Not allowed" / "Only you can do this", total cost, "Not now" / "Go ahead").
- First-decision callout: "Each option says what it costs and whether you can undo it." once per account.
- One-click answer `/a/<token>` (`apps/web/components/email/EmailAnswer.tsx`): opening changes nothing; one button "Answer “<option>”" sends `email.action.answer`; states ready / answered / used / expired / unavailable; a second kind cancels a deletion. Brand frame, works from 390 px.

### 1.11 Customer Update, Milestones, Contacts, Team call, Settings

- Customer Update (`/journey/[id]`, `JourneyScreen.tsx`): the replay of a won customer on `JourneyStage` (PixiJS loaded on demand, static summary under reduced motion). Empty in week one.
- Milestones (`MilestonesScreen.tsx`, a Plan tab): "First outcomes, customers and revenue" cabinet + "Releases, decisions and launches" timeline; show on page, copy card link, tap-to-post once the page is live.
- Contacts (`CrmScreen.tsx`, a Customers tab): DataTable with saved views; empty text from `emptyWhy("contacts")`.
- Team call (`/calls`, `CallLobby.tsx`): start a spoken call with the team or one agent; past calls table. Desktop only.
- Settings (`SettingsScreen.tsx`): ten tabs for everyone, in this order: Business, What the team can do, Departments, Your words, **People**, Integrations, Keys, Billing, Preferences, Danger zone. Opens on Business. People (cofounders, collaborators, invitations) lives here only: there is no People item in the sidebar.

### 1.12 The guided layer: what exists and how consistently it is used

| Piece | Where | Usage outside the design system (non-test) |
| --- | --- | --- |
| Definitions source | `packages/shared/src/terms.ts`: 92 entries, `termsWithGlossary`, `PLAIN_LANGUAGE_TIERS`, `learnPath` | about 65 ids used by a `Term`, a `termId` or a column `meta.term`; 82 referenced anywhere in UI code; `churn`, `integration`, `runway_horizon` referenced nowhere |
| `Term` / `DefinitionCard` | `dugout/guidance/Term.tsx` | 154 call sites (web 75, modules 68, widgets 11). Top ids: cycle 25, runway 14, estimate 11, specification 10 |
| `InfoTip` | `dugout/guidance/InfoTip.tsx` | 4 direct uses in web (more through `Panel help` / `Field hint`) |
| `Explainer` + `ExplainPageButton` | registers with `PageExplainProvider`; one button in the tab row | 15 screens (list in finding A2-06) |
| `AskChiefOfStaff` | `shell/AskChief.tsx` → every business page | 1 (shell) |
| `AreaLine` / `AreaOpening` | every area tab, Contacts, Milestones | 3 hosts |
| `ConsequenceLine` / `ReassuranceLine` | under actions that spend or commit | 17 / 11 |
| `PlainFigure` | only through `MetricTile` and `DepartmentCard` | 0 direct |
| `NextStep`, "Day one" panel | `home/HomeScreen.tsx:454-499` | Details only |
| `FirstWeekChecklist` | widget `first_week_checklist` on the Founder's view | Details only |
| `FirstWeekTimeline` | Today | 1 |
| `Coachmark` tours | `apps/web/components/tours/definitions.ts`: home (5 steps), inbox (4), department (3) | mounted on Details, Inbox, department tabs |
| `Callout` | first Continue, first decision, example "Start your own" | 3 |
| `ExampleToggle` | profile, Ideation brief, Finance › Runway drivers | 3 |
| `emptyWhy` | `packages/shared/src/empty-why.ts`: 16 ids | 21 call sites |
| Example project | read-only demo membership (migration 0065), `exampleFrame` in the shell, "Start your own" in Continue's slot, "Sample business" caption | shell |
| Preferences | Settings › Preferences: "Explain things as I go", text size (Standard / Comfortable), "Replay the tour", "Anthropomorphic agents", Builder view | account-wide |
| Product signals | `guidance.tour_completed`, `tour_skipped`, `explainer_dismissed`, `term_opened`, `turned_off` (`packages/events/src/catalogue.ts:1407-1448`) | emitted from `tours/signal.ts`, `GuidanceHost` |

### 1.13 Small screens today

- Two gates. `DesktopOnly` (`apps/web/components/providers/DesktopOnly.tsx:79-86`, at the root) renders `NeedsLargerWindow` for any route not in `SMALL_SCREEN_PREFIXES` (`:29-51`) or `SMALL_SCREEN_PATTERNS` (`:58-61`: `/b/<id>/today`, `/b/<id>/inbox[/<id>]`) when the measured width is under 1280. `AppShell` (`AppShell.tsx:395`) does the same unless `phone` is set, which `BusinessShell.tsx:839` sets from `worksOnSmallScreens(pathname)`.
- Signed-in routes that work at 390 px: `/home`, `/public-profile`, `/network`, `/communities[/<id>]`, `/profiles/<kind>/<id>`, `/new/card/<id>`, `/b/<id>/today`, `/b/<id>/inbox[/<id>]`. Everything else under `/b/<id>` (Details, every area tab, Contacts, Milestones, Customer Update, Team call, agent profiles, all of Settings), `/new`, `/onboarding` and `/businesses` gets the wall.
- Phone layout of the shell (`AppShell.tsx:402-477`): `PhoneBar` (menu, logo, name, Continue, Stop all agents at 44 px), a title row with "Ask <Chief>", tabs scrolling sideways, content with a 16 px gutter, `PhoneMenu` (the sidebar's items as 44 px rows in a dialog). No search chip, runway, mode or connection chip, no "Explain this page".
- The wall (`packages/dugout/src/components/shell/NeedsLargerWindow.tsx:31-39`) says: "This needs a larger window" / "Foundmill is built for desktop screens at least 1280 px wide. Widen the window or move to a larger display." / "Current width: 390 px". It offers nothing: no link, no button, no "send me the link".
- **The native-app handoff value is not wired.** DECISIONS 3458 and `docs/mobile/BACKEND_CHANGES.md:62` promise "one config value (the store links, unset until launch) read by the small-screen shell". No such value exists in `packages/config/src/*`, `apps/web/lib/env.ts`, `next.config.ts` or any component (searched for store, native, app link, download).

### 1.14 Design system inventory (`packages/dugout`)

| Folder | Components | Story files | Test files | Notes |
| --- | --- | --- | --- | --- |
| `foundation/` | 45 | 39 | 19 | Button, Chip, StatusPill, Dialog, Tooltip, Toast, Skeleton, EmptyState, ErrorState, Input, Select, SegmentedControl, SkillSlider, Avatar, BusinessLogo… |
| `shell/` | 31 | 24 | 19 | AppShell, KitBar, PhoneBar, Sidebar, TabBar, ContinueButton, StopAllAgents, ProcessingStrip, CommandPalette, DecisionBar, Panel, PageGrid, NeedsLargerWindow, AskChiefOfStaff, AreaLine, chips |
| `agents/` | 27 | 11 | 15 | FormationBoard, TaskGraph, TileGrid/TileFrame, HierarchyChart, MonacoDiff, TerminalView, SkillPicker… |
| `data/` | 20 | 12 | 11 | DataTable (1,779 lines), WidgetGrid, MetricTile, Markdown, EntityLink, EntityText, FilterChips… |
| `guidance/` | 14 | 11 | 8 | GuidanceProvider, Term, DefinitionCard, InfoTip, Explainer, ExplainPageButton, PlainFigure, ScaleLabel, ConsequenceLine, ReassuranceLine, BuilderView |
| `conversation/` | 11 | 11 | 7 | AgentDesk, LiveRun, QuickReplies, StreamingText… |
| `call/` | 8 (+2 helpers) | 8 | 5 | CallStage, CallTile, CallControls… |
| `public/` | 10 | 10 | 9 | ProjectPage, PersonPage, MilestoneCard, InvitationCard, LegalPage… |
| `today/` | 9 | 9 | 5 | GoalPanel, NeedsYouList, WeekPlan, FirstWeekTimeline, SinceLastVisit, StreakStrip… |
| `firstrun/` | 6 | 6 | 7 | Coachmark, NextStep, FirstWeekChecklist, ExampleToggle, AdultCheck, AgentStylePicker |
| `journey/` | 6 (+ ribbon, stage, charts, concept subfolders) | 1 group + 2 | 4+ | JourneyRibbon, JourneyStage (PixiJS) |
| `share/` | 3 | 3 | 3 | SharePost, ShowcaseConsent, PostMediaPreview |

150 story files, 127 test files in the package. Components no story mentions: `PanelMenuButton`, `PanelMenuDropdown`, `TerminalView`, `MonacoDiff`, `DiffPane`, `PlanView`, `PreviewView`, `TileFrame`, `ShoutMenu`, `PersonaAvatar`, `ReturnFocus`, `ProvenanceTip`, `ShellLink`, `OnThisDayCard`, `GoalBurst`.

Tokens: `packages/dugout/src/tokens.css` (346 lines, the only file meant to hold color literals), mapped to Tailwind v4 utilities in `dugout.css` (`@theme inline`). Other stylesheets: `shell.css`, `controls.css`, `overlays.css`, `views.css`, `conversation.css`, `call.css`, `idea-box.css`, `fonts.css`.

How DESIGN.md's rules are enforced mechanically:

| Rule | Mechanism | Gap |
| --- | --- | --- |
| Tokens only (colors) | `@theme { --color-*: initial; --breakpoint-*: initial; }` (`dugout.css:38-45`) removes Tailwind's palette, so `bg-red-500` does not exist. `tokens.test.ts:197` asserts `dugout.css` holds no color literal. | Nothing scans `.ts`/`.tsx`: 15 files hold hex literals (A2-20). Spacing, radius and shadow scales are not reset. |
| No arbitrary values | Nothing. | 45 arbitrary size, color or shadow values in product code (A2-20). |
| Focus rings | `scripts/focus-visible.mjs` in CI (`ci.yml:55-57`); base `:focus-visible` outline (`dugout.css:594-601`). | Works. |
| WCAG AA | `tokens.test.ts:47-78` checks the text ramp and the status colors on plain surfaces; two Playwright checks in `keyboard-a11y.spec.ts`. | Storybook's a11y addon has `test: "error"` (`.storybook/preview.ts`) but no runner is installed or run in CI (`ci.yml:148-159` only builds Storybook). No axe in Playwright. ESLint has no `jsx-a11y` (`eslint.config.mjs:69-79`). |
| Never clip | `apps/web/e2e/no-clip.spec.ts` at 1280 and 1440. | Not at 390. |
| Words | `banned-terms.mjs`, `us-english.mjs`, `plain-language.mjs --gate` in CI. | "cycle", "Inbox", "business" drift is not a lint concern (A2-09). |
| Client boundaries | `clientBoundaries.test.ts`, `check:rsc`. | Works. |
| Reduced motion | global rule `dugout.css:630`, per-file blocks; `usePrefersReducedMotion`. | No `forced-colors` or `prefers-contrast` support. |

### 1.15 States

- Loading: skeletons everywhere (`ScreenSkeleton`, `ShellSkeleton`, `Panel loading`, `SkeletonRows`), never a spinner on a screen. One plain "Loading…" on `/a/<token>` (`EmailAnswer.tsx:81`).
- Empty: `EmptyState` with one sentence; 16 teaching sentences in `empty-why.ts`.
- Error: `ErrorPanel` (one plain line, technical text behind Details, Try again), `NotFoundPanel` (a way back, no retry), `RefreshFailedNotice` ("Couldn't refresh. What you see may be out of date." + Retry) when a background refetch fails with data on screen, `RouteError` (reloads once on a chunk error).
- No access: a lock and "Ask an owner or admin if you need it."
- Offline / stream down: the connection chip (desktop only); no banner; queries retry twice then show their own error.
- Slow agent: the strip, the tab-row line ("Product is working"), Continue as "Pause", `HomeFoundations` drafting banner, `LiveRun` in conversations. Today itself has no "the team is working on X right now" line outside the tab row.

### 1.16 Front-end engineering that shapes the experience

- Data: tRPC + TanStack Query. One browser client; `staleTime` 30 s by default, 5 min for stream-kept routers (`inbox`, `cycle`, `finance`) while the channel has been live since the fetch (`lib/query-client.ts:22-52`); `gcTime` 60 min; no retry on auth, not-found, rate-limit, bad-request, payment-required. Events → `INVALIDATE_ON_EVENT` (`BusinessShell.tsx:112-169`) → `invalidateForEvent`.
- Waterfalls that remain: Inbox note → up to seven dependent reads after `inbox.get` (`ReadingPane.tsx:276-332`, including `dev.tasks.list` with `limit: 500`); department tab → `screen.get` → module pack chunk → the module's own reads (`DepartmentScreen.tsx:107-117`); Today → `journey.ribbon` and `today.visit` start only in the browser.
- Optimistic updates: only the guidance and date-format preferences (`GuidanceHost.tsx:236`, `DateFormatHost.tsx:90`). Every answer, approval, archive and goal approval waits for the server with a pending button.
- Heavy libraries are on demand: Monaco (`React.lazy` in `DiffPane.tsx:13`), xterm (`import()` in `TerminalView.tsx:168`), PixiJS (`import()` in `RibbonPixiLayer.tsx:41`, `GoalBurst.tsx:43`), Tiptap + Yjs (`next/dynamic`, `BusinessShell.tsx:109`), module packs (`useModulePacks`), tours (`LazyTour`), Markdown engine. `packages/dugout` declares `sideEffects: ["**/*.css"]`; `packages/widgets` and `packages/modules` declare none.
- Next 16: `proxy.ts`, async `params`, `retry` in error boundaries, `staleTimes.dynamic: 300`, `typescript.ignoreBuildErrors: true` (typecheck runs separately), no `optimizePackageImports`.
- Hydration: the day, the vacation date and anything time-zone bound render after hydration (`useClientToday`, `useHydrated`); the shell's prefetched queries stay pending until hydration commits (`PrefetchBoundary`). I found no recorded open hydration issue for the Example or sample chip in PROGRESS, DECISIONS, GATES or the code; `SampleBadge` reads `business.get` initial data, which is the same on server and client. The one known first-paint mismatch is the phone flash (A2-01).

### 1.17 Accessibility and readability facts (computed and read)

Contrast of the text and status tokens on each surface (WCAG ratio; AA for text is 4.5 : 1):

| Token | canvas `#08090c` | rail `#0b0d11` | surface-1 `#0f1217` | surface-2 `#151920` | surface-3 `#1c212a` | surface-4 `#252b36` |
| --- | --- | --- | --- | --- | --- | --- |
| text-1 `#edf0f4` | 17.4 | 17.0 | 16.4 | 15.4 | 14.1 | 12.4 |
| text-2 `#a9b3c1` (secondary) | 9.4 | 9.2 | 8.9 | 8.3 | 7.6 | 6.7 |
| text-3 `#8a94a3` (captions) | 6.5 | 6.3 | 6.1 | 5.7 | 5.3 | 4.6 |
| text-4 `#5a6370` (disabled only) | 3.3 | 3.2 | 3.1 | 2.9 | 2.7 | 2.3 |
| accent / link `#7cc4ff` | 10.6 | 10.4 | 10.0 | 9.4 | 8.6 | 7.6 |
| status-good `#3dd68c` | 10.6 | 10.4 | 10.0 | 9.4 | 8.6 | 7.6 |
| status-warn `#f5b841` | 11.2 | 10.9 | 10.6 | 9.9 | 9.1 | 8.0 |
| status-bad `#f36066` | 6.3 | 6.2 | 6.0 | 5.6 | 5.1 | 4.5 |
| status-info `#5e8eff` | 6.4 | 6.3 | 6.1 | 5.7 | 5.2 | 4.6 |
| gold `#e8c56b` | 12.0 | 11.7 | 11.3 | 10.6 | 9.7 | 8.6 |

Status word on its own pill tint (12 % of the tone over the surface; 22 % when selected), Estimate:

| Tone | on surface-1 | surface-2 | surface-3 | surface-4 | selected on surface-1 | selected on surface-3 |
| --- | --- | --- | --- | --- | --- | --- |
| good | 8.1 | 7.5 | 6.8 | 5.9 | 6.4 | 5.4 |
| warn | 8.5 | 7.8 | 7.1 | 6.2 | 6.6 | 5.5 |
| bad | 5.2 | 4.8 | **4.4** | **3.9** | **4.45** | **3.8** |
| info | 5.2 | 4.8 | **4.4** | **3.9** | **4.4** | **3.7** |

Other figures: white on the default brand primary `#3570cc` 4.8 : 1; a field's edge (white 13 %) on surface-1 **1.43 : 1** and its well against the panel **1.04 : 1**; a panel against the canvas 1.06 : 1; the hairline (white 7.5 %) 1.2 : 1; the focus outline (accent at 80 %) 6.7 : 1; brand-slab text at 80 % opacity on the default steel about 3.7 : 1.

- Sizes: body 13/19, reading 15/24 (note bodies only), small 12/16, labels 12, data labels 11 px caps, micro 11. Nothing is under 11 px. Root 13 px in absolute pixels.
- Hit targets: buttons 28 / 32 / 40 px (`sm` / `md` / `lg`), icon-only buttons at least 24 px (`--target-size`), sidebar rows 32 px, tabs 40 px, table rows 28 / 34 px. Selectable `Chip` and `FilterChips` buttons are 22 px tall (`min-h-chip`, `Chip.tsx:83-109`, `FilterChips.tsx:323-379`), under the 24 px of WCAG 2.5.8. Phone routes raise controls to 44 px (`min-h-tap`, `tap-reach`), except `/a/<token>` (A2-12).
- Focus: a skip link ("Skip to content", `AppShell.tsx:418`, `:492`); `main` is focusable; the sidebar is one roving tab stop (arrows, Home, End); the tab bar is a `tablist`; dialogs, the phone menu and the palette are Radix (focus trapped, Esc closes, focus returns; `keyboard-a11y.spec.ts:26` checks the return); coach marks are non-modal popovers that return focus; Continue keeps focus while pending and across the vacation swap (`ContinueButton.tsx:173-189`).
- Live regions: the strip is `role="status"`; the answer to a press of Continue is announced once (`AppShell.tsx:96`); blockers use `role="status"`; toasts are Radix toasts with a 5 s default (`Toast.tsx:141`), including the ones that carry an "Open" action or a warning.
- Color is paired with a word or icon nearly everywhere (pills, deltas, runway tone, first-week states). The exceptions are the strip's segments (color per department; the sentence carries the meaning) and sidebar badges (the count carries it).
- Reduced motion: one global rule (`dugout.css:630`) plus per-file blocks; `usePrefersReducedMotion` for scripted motion; streams render whole.
- Not supported: `forced-colors`, `prefers-contrast`, a larger browser default font, any way to turn off single-key shortcuts.

---

## 2. What is real and what is placeholder on these screens (a non-demo project)

Real, from the project's own rows: the sidebar and its badges, Continue state, the strip, Today's goal, Needs you, first-week timeline, since-last-visit, streak, week plan, the Inbox and every note, decisions and plans, Milestones, Contacts, Settings, Team call, guidance progress.

Not real or not yet meaningful in week one:

| Surface | What shows | Evidence |
| --- | --- | --- |
| Top bar runway chip | "Not known yet · connect a bank" from day one | `runway.ts:26`, `BusinessShell.tsx:910-917` |
| Today › Health › Cash | A money figure of 0 with "Connect a bank in Settings" when no bank is connected (the tile takes `finance.cash.amountMinor` whenever `finance` loaded) | `status-strip.tsx:138-148`; the shell's own rule is the opposite: "no account reads 'Not known yet', never 'Cash £0'" (`BusinessShell.tsx:914-915`) |
| Today › Health › Runway | "Not known yet" + "Not enough data yet: connect your bank" | `status-strip.tsx:116-123` |
| Today › Health › Customers this week | 0 | real zero |
| Today › spend tile | AI usage, labeled Estimate | `status-strip.tsx:177-190` |
| Money area line | "Connect your bank and this line shows your cash and how long it lasts." | `area-words.ts:93` |
| Details › Day one | ghosted milestone cards (first 1K, 10 customers…) | `HomeScreen.tsx:468`, `ghostedMilestones` |
| Mode chip | "$250" (or the currency's 250) as the spend line for a founder who may have no money | `limits.ts:16`, `team-can-do.ts:146` |
| Sample business | seeded demo with a "Sample business" caption; figures made up, rolled forward hourly | `lib/access.ts:73-97` |
| Dead code | `components/placeholders/{HomePlaceholder,SurfacePlaceholder}.tsx`, `components/shell/ComingSoon.tsx`: imported by nothing | grep |
| Simulated results | Not checked here (agents and connectors are another auditor's). | |

Eleven screens are still empty dead ends in week one (THESIS §6.2); they now carry `emptyWhy` sentences, but they are all still linked.

---

## 3. Findings

Severity: P0 stops the target user reaching a real outcome or breaks trust; P1 major friction or risk; P2; P3.

### P1

**A2-01 (P1; P0 for anyone who arrives phone-first before the native app). The small-screen wall is a dead end, and Today and the phone menu lead straight into it.**
Evidence: `NeedsLargerWindow.tsx:31-39` (the copy tells a phone to "Widen the window", shows "Current width: 390 px" in mono, has no action). `AppShell.tsx:395` returns the wall *instead of* the shell, so there is no bar, menu or Back. `PhoneBar.tsx:91-163`: `PhoneMenu` lists every sidebar item, so Plan, Customers, Money, Product, Team, Team call and Settings all open the wall. `TodayScreen.tsx:177-184`: the "Details" tab opens the wall. `TodayScreen.tsx:118-131`: the one-tap answer on the page-ready note ("Check it and publish", the Day 1 ask in `first-week.ts:100`) pushes Product › Public page, a wall; `:230` `PublicPageNote` and the Health tiles (`:147-148`) do the same; the postal-address quick answer opens Settings (wall). In a note, every EntityLink to an agent or a contact opens a wall. First paint on a phone is the desktop shell until the width is measured (PROGRESS 1811 "Not done").
Impact: CLAUDE.md says "never leave a small screen at a dead end" and "says so kindly with a way to continue later". A young founder on a phone taps the main thing Today asks for on day one (publish the page: the first real outside outcome) and gets a screen that tells them to resize a phone. The only exit is the browser's Back.
Fix:
1. `packages/dugout/src/components/shell/NeedsLargerWindow.tsx`: new props `{ title?, body?, actions?: { label; href?; onClick?; variant? }[], children? }`; drop the pixel line by default (keep it behind `showWidth` for Builder view). New default copy: title "This part is for a bigger screen", body "It has tables and boards that do not fit a phone yet. Today and Needs you work here." Rename export to `BiggerScreenNote` and keep `NeedsLargerWindow` as an alias.
2. `AppShell.tsx:395`: when `tooSmall && !phone`, render the **phone layout with the note as `children`** (PhoneBar, menu and title stay), not a bare wall. `DesktopOnly.tsx:83-84`: for `/b/<uuid>/…` paths let the shell handle it (return children), so the note is inside the shell; keep the bare note for non-shell routes with actions "Go to your project" (`/`) and "Sign out".
3. In `BusinessShell`, pass the note's actions: primary "Back to Today" (`routes.today`), secondary "Needs you", and "Email me a link to this page" → new mutation `founder.email.sendLink({ businessId, path })` (apps/api, through the existing platform sender and the gateway; rate-limit 3 a day; another auditor owns the api side). Until that exists, "Copy link" (`navigator.clipboard`) is the stand-in.
4. `PhoneMenu`: mark items that are desktop-only with a quiet "Bigger screen" caption (`SidebarItem.desktopOnly?: boolean`, set in `buildSidebarItems` from `worksOnSmallScreens(item.href)`), and sort them after the ones that work.
5. `TodayScreen.tsx`: on a phone (`isViewportTooSmall(useViewportWidth())`), the quick answer that would open a desktop tab answers and then toasts "Saved. Check and publish it on a bigger screen" with "Email me the link"; hide the "Details" tab (`tabs` minus `details`) and make Health tiles non-clickable.
6. First paint: set a `fm_vw` cookie (width bucket) on first client measure and read it in `app/b/[bid]/layout.tsx` to pass `initialPhone` to `BusinessShell` → `AppShell viewportWidth`; or render the shell with CSS container queries only. Either removes the desktop flash.
Tests / stories: story `Shell/BiggerScreenNote` (390, with actions); `AppShell.test.tsx` "a desktop-only route in phone mode keeps the bar and menu"; `desktop-only.test.tsx`; `e2e/phone-today.spec.ts`: replace "another project route at 390 px still asks for a larger window" with "…shows the note inside the shell with Back to Today", add "Check it and publish at 390 px never leaves a dead end". DESIGN.md §2 line 19 and §6 "Small screens" need the amendment (the doc still says "renders `NeedsLargerWindow` and nothing else").

**A2-02 (P1, launch blocker for the app). The native-app handoff has no config value and no reader.**
Evidence: DECISIONS 3458; `docs/mobile/BACKEND_CHANGES.md:62`; nothing in `packages/config/src/` or `apps/web/lib/env.ts`.
Impact: CLAUDE.md asks that the switch be "one change". Today it would be a feature build at launch time, across the shell, the wall and every public page.
Fix: `packages/config/src/brand.ts` (or new `app-links.ts`): `export const APP_STORE_LINKS: { ios: string | null; android: string | null } = { ios: null, android: null }` and `appLinksLive()`; optional env override `NEXT_PUBLIC_APP_STORE_IOS` / `NEXT_PUBLIC_APP_STORE_ANDROID` in `apps/web/lib/env.ts` + `.env.example` (the env-example test requires it). New `packages/dugout/src/components/public/GetTheApp.tsx` (server-safe; two store buttons, 44 px; renders nothing when both are null) with a story. Readers: (a) signed-in small-screen shell: when links are set, `AppShell` phone layout and `BiggerScreenNote` show `GetTheApp` as the primary action (and Today / Needs you redirect is a later one-line change in `worksOnSmallScreens`); (b) public pages (`ProjectPage`, `PersonPage`, `InvitationCard`, `MilestoneCard`) take an optional `appLinks` prop and draw the prompt under the content. Tests: unit for `appLinksLive`, a story at 390 with and without links, one Playwright test with the env set.

**A2-03 (P1, trust). Single-key shortcuts act for a first-timer with no warning: Space starts paid work, 1–4 answer a decision.**
Evidence: `keyboard.ts:152-160` (Space → `onContinue` whenever focus is on the page; Space is also the browser's page-scroll key, and Today scrolls); `keyboard.ts:249-257` + `ReadingPane.tsx:451-458` (1–4 call `onChoose(option)` on the open note); R refreshes the Inbox (a model call), E opens layout editing. DESIGN.md line 221 hides the key caps while guidance is on but keeps the keys live. No preference turns them off (`AppShell.tsx:372`). The vacation state makes Space "Come back" (ends the vacation).
Impact: an accidental Space on Today starts a run that spends credits; an accidental digit in the Inbox records an answer (an "allow" plan executes at once). The person cannot see why, because the caps are hidden. WCAG 2.1.4 (character key shortcuts must be remappable or switchable) is not met.
Fix: add `account_preferences.keyboard_shortcuts boolean` (default **false** when guidance is on at account creation, true for Exited / Operator; migration + `founder.preferences` + `GuidanceHost`), exposed as Settings › Preferences › "Keyboard shortcuts" (`PreferencesTab.tsx`). `BusinessShell` passes `keyboard={{ enabled: prefs.keyboardShortcuts, … }}`; with it off keep only `/`, ⌘K, `?`, Esc and the G chords off. Independently of the preference: Space on the page never triggers `onContinue` unless the Continue button has focus (delete the page-level Space binding, keep `aria-keyshortcuts` only when enabled), and 1–4 only when focus is inside the DecisionBar. Tests: `keyboard.test.ts` (off by default for guided), `keyboard-a11y.spec.ts` "Space on Today scrolls and never starts work", `inbox.spec.ts` "a digit outside the decision bar does nothing". DESIGN.md "Key caps go the other way" needs the amendment.

**A2-04 (P1). "Show by stage" is not built: the week-one console is still the whole console.**
Evidence: §1.2 (no stage input anywhere in `packages/shared/src/areas.ts`, `constants.ts:103-172`, `apps/web/lib/sidebar.ts`); 12 sidebar items, 15 inline + 22 "More detail" tabs; the runway and mode chips and Stop all agents in the chrome from minute one (`KitBar.tsx:272-285`); Settings shows ten tabs including Departments, Keys, Integrations, Danger zone; Team call for everyone; Money lands on a bank-connection sentence. THESIS 6.1 target is "about a dozen surfaces in week one".
Impact: the first-timer's first impression inside a project is the operator console with words turned down, not a small place that grows. The founder's own verdict ("way too complex; I just want it to work", PROGRESS 1376) is still the default view.
Fix (the areas model, kept pure and tested):
1. `packages/shared/src/areas.ts`: add `export interface StageFacts { pageLive: boolean; distributionStarted: boolean; firstPaymentAt: string | null; bankConnected: boolean; entityExists: boolean; cofounders: number; roundsCompleted: number; ageDays: number }` and `export const TAB_REVEAL: Partial<Record<ModuleKey, Record<string, (f: StageFacts) => boolean>>>` (for example distribution `leads`/`campaigns` → `distributionStarted`; finance `runway`, `pnl`, `cash` → `bankConnected || firstPaymentAt`; `wage-bill` → `roundsCompleted >= 1`; `cap-table`, legal `incorporate` → `firstPaymentAt || cofounders > 0`; legal `entity`, `compliance`, `contracts`, `ip`, `policies`, `regulatory` → `entityExists`; development `pull-requests`, `environments` → `roundsCompleted >= 1`). `AreaTabsOptions` gains `stage?: StageFacts`; a tab whose rule is false gets a third tier `"later"` (not listed, still routable; opened by URL it shows the `emptyWhy` sentence, never a gate). `AREA_REVEAL` hides an area with no revealed tab (Money before a payment or a bank: replaced by the earnings-first page of THESIS 6.2 when that exists; Customers before the page is live shows only Contacts).
2. `business.get` returns `stageFacts` (one read; another auditor owns the api); `apps/web/lib/areas.ts areaNav` and `lib/sidebar.ts buildSidebarItems` pass it; Builder view on ignores it (everything shows, as the thesis asks).
3. Chrome by stage (in `BusinessShell`): `RunwayChip` only when `bankConnected || firstPaymentAt` (before that the chip slot shows the date alone); `ModeChip` only after the first approval was asked, or in Builder view; `StopAllAgents` moves into the business switcher menu for guided accounts until the first run has completed (keep the palette command).
4. A newly revealed area or tab gets a one-time `kit-lift` dot and a line in "Since you were last here" ("Money opened: your first payment arrived").
Tests: `areas.test.ts` table of stage facts → tabs; `sidebar.test.ts`; `e2e/areas.spec.ts` on a fresh project (expect Today, Needs you, Plan, Product, Team, Network, Settings) and on Northwind (everything); Storybook `Shell/Sidebar` "week one". DESIGN.md §8 (sidebar) and §9 need the amendment.

**A2-05 (P1). The guided layer's Home pieces were left behind on "Details" when Today became the front door.**
Evidence: `HomeTour` mounts only in `HomeScreen.tsx:280`; its steps point at the status strip and a department card (`tours/definitions.ts:35-48`), which Today does not have. `NextStep` and the "Day one" panel are in `HomeScreen.tsx:454-499`. `FirstWeekChecklist` is a widget on the Founder's view (`dashboard-presets.ts:80`). Today (`TodayScreen.tsx`) has none of them, no `Explainer`, and a different "Your first week" (`FirstWeekTimeline`). So there are two panels both titled "Your first week" with different content (three time steps on Today; seven items including "Run a cycle" and "Start distribution" on Details, `FirstWeekChecklist.tsx:35-43`). `HomeAutopilot` (the Autopilot chip and its `business.autopilot.ensure` nudge) is also Details-only: verify that a founder who never opens Details still gets Autopilot's schedule ensured.
Impact: a new founder lands on Today and never gets the tour of the sidebar, Continue and the strip unless they click a tab called "Details"; the one-line "what do I do now" exists only there too.
Fix: (a) new `TODAY_TOUR` in `tours/definitions.ts` (id `"today"`; steps: `needs-you` "What needs you", `continue` "Continue", `first-week` "Your first week", `sidebar` "Where everything lives"; stamps for `[data-testid="needs-you"]`, `[data-testid="first-week-timeline"]`), mounted from `TodayScreen` through `LazyTour`, not on a phone; mark `home` done when `today` is done. (b) Move the next-step line to Today: a `NextStep compact` row directly under the page title, fed by `nextStepFacts` (already pure, `home/dashboards.ts:152`). (c) Retire the `first_week_checklist` widget from the Founder's view preset and fold its still-useful items into `first-week.ts` steps; one "Your first week" only. (d) Move `HomeAutopilot`'s ensure into `GoalEnsure`'s sibling in `home/lead.tsx` so both front screens run it. Tests: `tours.spec.ts` starts at `/today`; `today.spec.ts` asserts the next-step line; unit tests for the new tour definition.

**A2-06 (P1). "Explain this page" is missing where a first-timer lands.**
Evidence: 15 screens register an `Explainer`: product/vision, product/public-page, product/changes, product/research, product/page-quiz, development/live-sessions, development/pull-requests, distribution/board, finance/overview, finance/cap-table, legal/entity, team-agents, team-recruitment, agent-training, ideate-cards. Of the 15 inline area tabs only 6 have one. None on: Plan › Roadmap, Plan › Milestones, Customers › Leads, Campaigns, Contacts, Money › Runway, Compliance, Product › **Specification**, Live product. So three of five area landing tabs (Plan, Customers, Product) have no button. Also none on Today, Details, Needs you (by design for notes, but the list has none), Team call, any Settings tab. The explainers were written for each department's first tab before the Nov 9 re-cut moved Vision, Board and Live sessions behind "More detail". The department tour's second step ("What a screen is for") silently skips when there is none. On a phone the button is never drawn (`AppShell.tsx:402-477`).
Fix: add `*_EXPLAINER` constants and `<Explainer>` to `RoadmapScreen`, `SpecificationScreen`, `LeadsScreen`, `CampaignsScreen`, `RunwayScreen`, `ComplianceScreen`, `EnvironmentsScreen` (packages/modules), `MilestonesScreen`, `CrmScreen`, `TodayScreen`, `HomeScreen`, `InboxScreen` (list level), `CallLobby`, and one per Settings tab (apps/web). Draw `ExplainPageButton` in the phone title row. Add a unit test in `apps/web/lib/__tests__` that walks `DEFAULT_TABS` and fails when an inline tab's screen module exports no explainer (a registry `EXPLAINERS: Record<"<module>/<slug>", ExplainerCopy>` in `packages/modules/src/explainers.ts` makes that mechanical). Extend `explain-page.spec.ts` to each area's landing tab.

**A2-07 (P1). DESIGN.md has not been amended for the thesis; its brief still asks for a control room.**
Evidence: `docs/DESIGN.md:7` "A broadcast control room at night, built for one founder"; `:11` "Composed. Dense. Alive."; `:13` "a financial terminal and the best management sim"; `:19` the wall "and nothing else"; §8 "Guidance" still describes `NextStep` "on Home" and the seven-item checklist. `git log -- docs/DESIGN.md` shows 30 commits since Nov 7 adding screens, none touching §1. THESIS §2 item 7 and §12.6 ask for "a peer who knows more than you and is on your side"; §11 lists "the 'one founder' design brief" under "Rules that block".
Impact: every new screen is still built to the old taste; the builder agents (`dugout-builder`, the `new-screen` skill) read this file first.
Fix: see section 3b "The feeling" for the proposed amendment and token values.

### P2

**A2-08 (P2). Type is small for the target reader, and the root size ignores the browser's setting.**
Evidence: `tokens.css:181-220`: `--fs-root` 13 px, body 13/19, small 12/16, label 12, data label 11 px caps with 0.09 em tracking, title 13. `dugout.css:541` `html { font-size: var(--fs-root) }` is an absolute pixel size, so a person who set a larger default font in the browser gets no change. "Comfortable" (`tokens.css:339-346`) adds one pixel to body and half a pixel to small, is opt-in, and sits in Settings › Preferences. Contrast is fine (text-2 8.9 : 1 and text-3 6.1 : 1 on surface-1; text-3 4.6 : 1 on surface-4); the problem is size and the amount of caption text carried in text-3 at 12 px, which is where the explanations live.
Fix: `--fs-body: 14px; --lh-body: 21px; --fs-small: 12.5px; --lh-small: 17px; --fs-label: 12.5px; --fs-chat: 14px; --lh-chat: 21px` as the standard; comfortable becomes `--fs-body: 15px; --lh-body: 23px; --fs-small: 13px; --fs-label: 13px; --fs-title: 14px; --fs-action: 14px`; `--fs-data: 11.5px; --ls-data: 0.06em`. New accounts with guidance on start on comfortable (`founder.preferences` default + the `fm_text_size` cookie). `html { font-size: calc(var(--fs-root) * 1) }` → express `--fs-root` as `0.8125rem` of the browser default so a larger browser default scales everything. Update `tokens.test.ts:79-104`, run `no-clip.spec.ts` at 1280 / 1440 in both sizes. Needs a DESIGN.md §4 amendment.

**A2-09 (P2). The chrome speaks three vocabularies.**
Evidence and fix, one string at a time:
- "Needs you" (sidebar, `lib/sidebar.ts:65`) versus "Inbox" (screen title `InboxScreen.tsx:228`, browser title `lib/page-titles.ts:17`, "See all in the Inbox" `NeedsYouList.tsx:56`, palette `search.ts:86`, "Open the Inbox" `EmailAnswer.tsx:95`). Pick one: the sidebar item and title become "Inbox" with the badge, or the title follows the tab ("Needs you" on `?tab=respond`). Recommended: title = active tab's label when the tab is `respond`, else "Inbox"; sidebar stays "Needs you".
- "cycle" with Builder view off, although the founder's word is "round of work": "No cycle running" (`ProcessingStrip.tsx:43`, shown in every tab row), "Your team works in cycles…" and "(does not start a cycle)" (`InboxScreen.tsx:46,55`), "Last cycle cost …" (`BusinessShell.tsx:245`), "No new cycle starts" / "No cycle is running." (`:261-262`), "The next cycle picks up…" (`:574`), "A cycle started." (`ReadingPane.tsx:349`), "one cycle after another" and "Pause the running cycle" (`ContinueButton.tsx:131,137,285`), "Run a cycle" (`FirstWeekChecklist.tsx:39`), the Autopilot labels (`AutopilotSection.tsx:26-105`). Add a `roundWords(builder)` helper in `packages/shared/src/founder-words.ts` and use it; idle line becomes "The team is not working right now".
- "business" where CLAUDE.md asks for "project" until the first sale: "Switch business", "Create a new business", "Manage businesses" (`BusinessSwitcher.tsx`, `search.ts:137-140`), "Sample business" / "This is an example business" (`lib/access.ts:67-73`), Settings tab "Business", "in every business" (`PreferencesTab.tsx:71-111`). No helper exists; add `ventureNoun(stage | undefined): "project" | "business"` in `packages/shared/src/founder-words.ts`, feed it from `business.get` (first payment), and extend `scripts/banned-terms.mjs` or a unit test to hold the shell strings to it.
- Engine words in guided copy: "The orchestrator is not reachable right now: a press writes one note; no agent works." (`BusinessShell.tsx:221`) → "The team cannot start right now. Pressing Continue will only write a short note."; "Holds Continue" pill (`NeedsYouList.tsx:117`) → "The team is waiting on this"; "Starting a call needs write access to Team." (`CallLobby.tsx:118`); "No replay for this id" (`JourneyScreen.tsx:94`).
- "Game mode: LIVE" / "Personal" (`ModeChip.tsx:133-150`) although THESIS 2.5 retires game mode; "Anthropomorphic agents" (`PreferencesTab.tsx:220`) → "Give agents names and faces"; Team › More detail › "Staff" (`constants.ts:73`) while Settings says "People"; "Details" as the name of the dashboards.

**A2-10 (P2). Today on a phone puts the reason to open it fifth, and the guided layer is hover-only there.**
Evidence: in one column the order is since-last-visit, streak, first-week (three stacked steps), goal, then Needs you (`TodayScreen.tsx:202-229`; PROGRESS 1811 lists it as not done). Radix tooltips do not open on touch, so `InfoTip` without `learn` (`InfoTip.tsx:53-57`), Continue's sentence, cost hint and orchestrator caveat (`ContinueButton.tsx:326-341`) and every `Tooltip`-only explanation are unreachable at 390 px; `Term` works (a tap pins the card). No connection notice on a phone (`PhoneBar` takes no `connection`). Stop all agents sits beside Continue at the same size.
Fix: `PageGrid stack` order on a phone: Needs you, public-page note, first week, goal, week plan, since-last-visit, streak, health (CSS `order` under `@max-page-wide`, or render order by `phone`). `InfoTip`: use `Popover` when `(hover: none)`; `ContinueButton`: in phone mode render the caveat as a visible line under the bar. Pass `connection` to `PhoneBar` as a one-line strip. Move Stop all agents into `PhoneMenu`.

**A2-11 (P2). Today's "Health" shows a finance console to someone with no money in the project.**
Evidence: §2 table. Cash 0 with "Connect a bank in Settings", Runway "Not known yet"; two of four tiles are about a bank on day one.
Fix: until `bankConnected || firstPaymentAt`, the panel is titled "So far" and holds: page (Live / Not live yet), followers, Customers (0, "your first one will show here"), "Spent this week (Estimate)". `cashTile` returns the words "Not known yet" when `finance.cash.accounts === 0` (one line in `status-strip.tsx:138-148`; test in `today-tiles.test.ts`). The rest belongs to THESIS 6.2.

**A2-12 (P2). The one-click answer page is not finished for a phone.**
Evidence: `EmailAnswer.tsx:90-96`: the answer button and "Open the Inbox" are `size="sm"` (28 px) with no `min-h-tap`, while the cancel variant on the same page uses `size="lg" className="min-h-tap"` (`:59,63`); `:43` `useMutation` has no `onError` and `answer.error` is never rendered, so a failed tap just stops spinning; `:81` shows bare "Loading…".
Fix: `size="lg" className="min-h-tap w-full @page-wide:w-auto"` on both; render `answer.isError` as an inline `role="alert"` line with Try again; a three-line skeleton for pending. Tests: `email-answer.test.tsx` (error line), `return-loop.spec.ts` at 390 (44 px target).

**A2-13 (P2). Accessibility is asserted in DESIGN.md but not checked by a machine.**
Evidence: §1.14 table. Also no `forced-colors` or `prefers-contrast` rules in any stylesheet.
Fix: add `@storybook/addon-vitest` (or the test-runner) and a CI step that runs the stories with the a11y addon (the param is already `test: "error"`); add `@axe-core/playwright` to `keyboard-a11y.spec.ts` for Today, Inbox with a note, a DataTable screen, Settings, a dialog, and the 390 px Today; add `eslint-plugin-jsx-a11y` (recommended set) to `eslint.config.mjs`; add a `forced-colors: active` block in `dugout.css` (borders on panels, fields, pills; `forced-color-adjust: none` only on the brand slab).

**A2-14 (P2). Two non-text contrast failures and one text one.**
Evidence (computed): field edge `--line-strong` (white 13 %) on surface-1 = 1.43 : 1 and the field's well against the panel = 1.04 : 1 (`controls.css:463-469`), under the 3 : 1 that WCAG 1.4.11 asks of an input's boundary; panel against canvas is 1.06 : 1 (by design, "lifted by light"). `StatusPill` draws the tone's text on its own 12 % tint (`controls.css:402-409`, `StatusPill.tsx:48-55`): bad and info reach 5.2 : 1 on surface-1 but about 4.4 : 1 on surface-3 (menus, hover cards) and 3.9 : 1 on surface-4, and 4.4 : 1 on surface-1 when selected (22 % tint). `tokens.test.ts:64-78` tests the status colors on plain surfaces only. The "Sample business" caption is `text-kit-on-primary opacity-80` at 12 px on the brand slab (`BusinessShell.tsx:324`): about 3.7 : 1 on the default steel.
Fix: new token `--line-field: rgba(255, 255, 255, 0.34)` (3.0 : 1 on canvas, surface-1 and surface-2) for `field-well` at rest, 0.42 on hover; checkbox, radio and switch rings the same. `StatusPill` and tinted `Chip`: the word in `--text-1`, the icon and ring in the tone (the icon and word already carry the meaning), or lift `--status-bad` to `#f57a7f` and `--status-info` to `#7ba1ff` (5.1 / 5.2 : 1 on the surface-3 tint, 4.5 / 4.6 on surface-4). Extend `tokens.test.ts` with "status text on its own 12 % and 22 % tint over surfaces 1–4" and "field edge ≥ 3 : 1". Sample caption: drop the opacity.

**A2-15 (P2). The front door loads the whole widget gallery.**
Evidence: `TodayScreen.tsx:31` and `home/lead.tsx:14` import from the `@foundmill/widgets` barrel, whose last line (`packages/widgets/src/index.ts:16`) registers all 16 widgets by side effect; `packages/widgets/package.json` and `packages/modules/package.json` have no `sideEffects` field, so the bundler must keep them. `BusinessShell` itself is careful (subpaths only). Today is the one in-project screen meant for phones.
Fix: change those two imports to subpaths (`@foundmill/widgets/shared/routes`, `/shared/departments`, a new `/shared/today-tiles` re-exporting `cashTile`, `runwayTile`, `customersWeekTile`, `spendWeekTiles`, `unavailableTile` moved out of `widgets/status-strip.tsx`); add `"sideEffects": ["./src/widgets.ts", "./src/widgets/*.tsx", "**/*.css"]` to widgets and the pack index files to modules; add `experimental.optimizePackageImports: ["@foundmill/dugout", "@foundmill/widgets", "@foundmill/shared"]` in `next.config.ts`. Guard with a first-load JS budget for `/b/[bid]/today` in `e2e/speed.spec.ts` (PROGRESS 212 and 227 record earlier budgets: Home 550 KB gz).

**A2-16 (P2). Opening a note fans out after the note arrives.**
Evidence: `ReadingPane.tsx:202` `inbox.get`, then `:276-332` `finance.overview`, `finance.pnl`, `journey.ribbon`, `dev.tasks.list({ limit: 500 })`, `distribution.channels.list`, `journey.list`, `team.humans.list`, each enabled by what the note's metric strip needs.
Fix: have `inbox.get` return the strip's resolved metric values (`metrics: { key, value, provenance }[]`) so the pane renders in one read; keep the client queries only for live refresh. At least replace `dev.tasks.list limit 500` with a count procedure.

**A2-17 (P2). The definitions source misses the first words a first-timer meets.**
Evidence: `terms.ts` has 92 ids, strong on finance, development and agents. No entry for: goal, round of work, note, Needs you, Continue, public page, follower, project, cofounder, collaborator, spend line ("asks before spending over"), go-ahead, decision, Today, streak, Builder view, credits exists but "AI usage" does not, "Details". Ids referenced by no UI code at all: `churn`, `integration`, `runway_horizon` (the seven `attr_*` ids are reached through `attributeTermId`); about 17 more are only reached through the palette's Help group or a tooltip string, never as an underlined word.
Fix: add the missing ids (short lines in the voice of THESIS 12.6), wrap the first occurrence on Today, the Inbox and the top bar; a unit test "every `TERM_IDS` entry is used by a Term, a `termId`, a `meta.term` or the Help group" keeps the map honest.

**A2-18 (P2). The first-Continue callout and tour copy describe the loop as it was before Nov 7.**
Evidence: "Press it when you have answered what needs you." (`BusinessShell.tsx:288`) although decisions no longer hold Continue and one press runs until nothing is left; the home tour says "This runs the team; what they need from you lands in the Inbox." (`definitions.ts:39`), and the sidebar says "Needs you", not "Inbox".
Fix: callout body "One press and your team works until nothing is left to do. Anything that needs you shows in Needs you."; align the tour lines; unit tests pin the strings (`business-shell.test.ts`, `tours/__tests__/definitions.test.ts`).

### P3

**A2-19 (P3). No optimistic updates on answers.** `inbox.decide`, `markRead`, `archive`, `goal.approve` wait for the server (`TodayScreen.tsx:107-134`, `ReadingPane.tsx:364-410`). Add `onMutate` to `inbox.markRead` and `inbox.archive` (remove from the list cache, roll back on error); keep decisions pessimistic.

**A2-20 (P3). Token-rule violations in product code (the rule has no scanner).**
- Hex literals outside `tokens.css`: `apps/web/app/layout.tsx:23` (`#0F1318`); stale pre-2027 fallbacks in `packages/dugout/src/components/agents/MonacoDiff.tsx:34-43` and `TerminalView.tsx:91-120` (for example `#0b0e12`, `#f2545b`, `#5b8cff`, which no longer equal the tokens); `shell/BusinessSwitcher.tsx:216` (`#1b4fd8`, not the steel default `#3570cc`); `public/IdeaCard.tsx:99` (`#3a87ff`); `journey/ribbon/JourneyRibbon.tsx:266,290` and `journey/stage/JourneyStage.tsx:475` (`#E8C56B`, `#ffffff`); `apps/web/components/spec/spec-user.tsx:45-52` (the eight department colors copied).
- Arbitrary values: `packages/dugout/src/components/shell/PhoneBar.tsx:104` `max-w-[85vw]`; `foundation/Dialog.tsx:47`; `call/CallTile.tsx:112-143` `z-[1]` ×4; `agents/TileFrame.tsx:225-302` `@min-[600px]` ×7, `@min-[300px]` ×3, `@min-[800px]`; `journey/stage/JourneyStage.tsx:251,465` `[420px]`; `public/IdeaCard.tsx:95`, `share/ShowcaseConsent.tsx:66` `max-w-[22.5rem]`; `apps/web/components/landing/idea-box/IdeaBox.tsx:175-290` (`text-[17px]`, `max-w-[47.5rem]` ×3, `max-w-[60rem]`); `apps/web/components/new/ideate/IdeationStudio.tsx:397` `max-w-[960px]`; `agents/LogsTab.tsx:213` `h-[420px]`; `live/MessagesPanel.tsx:190-217`; `inbox/ReadingPane.tsx:494` `flex-[1_1_16rem]`; `packages/modules/src/product/roadmap/Timeline.tsx:71` `h-[18px]`; three `max-h-[60vh]`; plus 30 `grid-cols-[…]` templates.
- Raw lucide icons with ad-hoc sizes instead of `Icon`: `home/HomeScreen.tsx:226-233` (`size-3.5`), `calls/CallLobby.tsx:81`.
- Raw `<a>` for in-app links (a full page load inside the console): `crm/CrmScreen.tsx:334`, `agents/ToolsTab.tsx:90`, `crm/EntityScreen.tsx:289,384`.
Fix: add tokens (`--container-tile-sm/md/lg`, `--stage-h: 420px`, `--z-raise: 1`, `--phone-menu-max: 85vw`), read the hex values from the tokens (`readToken` without fallbacks, or import a generated `tokens.ts`), and add `scripts/design-tokens.mjs` to CI: fail on `#[0-9a-f]{3,8}` in `.ts`/`.tsx` outside an allowlist, and on `-(?:\[[0-9.]+(px|rem|vh|vw|%)\])` class fragments. Use `ShellLink` for the four anchors.

**A2-21 (P3). The spacing scale is 13/16 of what DESIGN.md says.** DESIGN §6 line 116 says "8 px grid, 4 px half-steps" and line 118 admits Tailwind's numeric spacing "runs at 13/16" (so `gap-2` is 6.5 px, `p-4` 13 px). Set `--spacing: 4px` in the `@theme` block of `dugout.css` so numeric utilities land on the grid, then re-run `no-clip.spec.ts`; or strike the 8 px claim. Needs a DESIGN.md §6 amendment either way.

**A2-22 (P3). Dead code and stale states.** `components/placeholders/*`, `components/shell/ComingSoon.tsx` (unused); `ContinueState` `matchday` and `onGoToJourney` (`ContinueButton.tsx:75,139,290`, `BusinessShell.tsx:635-646`) unreachable from `computeContinueState`; `FLAGS.liveMode` comment "LIVE game mode surfaces (Phase 4)" (`flags.ts:3`); `AppShell` default `screenTitle ?? "Home"` (`BusinessShell.tsx:852`).

**A2-23 (P3). Storybook shows the engine by default.** `.storybook/preview.ts` `initialGlobals.builderView: "on"`. Whoever reviews a story sees what an operator sees. Default it to off; add a "Guidance" toolbar toggle too. Add stories for the 15 components listed in §1.14 and move `apps/web/components/live/PeopleList.tsx` into `packages/dugout` (PROGRESS 1804 notes it has no story).

**A2-24 (P3). Stale documents.** `docs/UX_AUDIT_AND_PLAN.md:386-395` (status of Oct 20: "Start your own" slot, the Example chip and the `guidance.*` events are listed open; all three are built); `docs/GATES.md:134-139` (UX gates 0–3 not updated since Oct 20); DESIGN.md §2 line 19 and §8 "Guidance" (`NextStep` "on Home", the seven-item checklist with "run a cycle" and "connect a bank or Stripe", while the code's list starts with "Publish your page").

**A2-25 (P3). Two small state bugs.** `JourneyScreen.tsx:89` shows the error panel whenever `journeyQ.error` is set, discarding a loaded replay on a failed background refetch (use `loadFailed` / `refreshFailed`). `MilestonesScreen.tsx:54` builds `today` from `new Date().toISOString()` in render (UTC, not the project's day; the key changes at UTC midnight); use `useToday()` from `@foundmill/widgets/data`.

**A2-26 (P3, opinion). The streak counts opens, not outcomes.** `StreakStrip` shows "Opened / Not opened" for seven days. The north star is a real outside outcome each week; a row of "Not opened" marks is the one place the product grades the person. Suggest: show only the opened days (no "Not opened" label), or count weeks with a real outcome.

**A2-27 (P3). Toasts that matter vanish in five seconds, and selectable chips are 22 px.** `Toast.tsx:141` (`duration = 5000`) applies to warnings ("All agents stopped", "Continue failed", the orchestrator-unreachable answer) and to toasts with an "Open" action (`BusinessShell.tsx:543`, `:591`). The Continue answer also stands in the tab row for 15 s, but not on a page without tabs and not on a phone. Fix: `tone: "warn" | "bad"` and any toast with an `action` default to `duration: Infinity` (dismiss button already exists); on a phone show the Continue answer as a line under the bar. Selectable chips: `min-h-target` (24 px) when a chip is a button (`Chip.tsx:99-109`, `FilterChips.tsx:331-379`).

### Suggested order of work in this area

1. A2-03 (shortcuts off by default for guided accounts; Space never from the page): small, removes a trust risk.
2. A2-01 + A2-02 together (the note inside the phone shell, links out of Today, the store-links value and `GetTheApp`): one change set across `packages/dugout/shell`, `DesktopOnly`, `BusinessShell`, `TodayScreen`, `packages/config`.
3. A2-09 + A2-18 + A2-11 (words and the Cash tile): copy-only plus one helper each (`roundWords`, `ventureNoun`).
4. A2-05 + A2-06 (Today tour, next step on Today, one "Your first week", explainers on every inline tab with the registry test).
5. A2-04 (stage facts, `TAB_REVEAL`, chrome by stage): needs `business.get` to return `stageFacts`; do it with THESIS 6.2 so Money has something to land on.
6. A2-07 + A2-08 + A2-14 + 3b (the DESIGN.md amendment, type and contrast tokens, Today's reading column and voice line): one design pass, with `no-clip` and Storybook re-run.
7. A2-13, A2-15, A2-16, A2-20 (a11y in CI, bundle, note fan-out, the token scanner): engineering hygiene, parallelizable.

---

## 3b. The feeling: specific recommendations

DESIGN.md §1 has not been touched for the thesis (A2-07). The system is well made and should stay dark, tabular and exact (the founder's "Dark only" stands). What intimidates a first-timer is not the darkness but four things: small type, the number of lit instruments in the chrome, caps data labels and finance words on the first screen, and a layout that fills 1440 px with equal-weight panels. Recommendations, each with whether DESIGN.md must change:

| # | Recommendation | Where | DESIGN.md amendment |
| --- | --- | --- | --- |
| F1 | Rewrite §1: "A quiet workshop at night with someone a few years ahead of you at the next bench: calm, exact and on your side. Three words: **Calm. Clear. Alive.** Density is earned: a screen starts with one sentence and one action, and shows more as there is more to show. Builder view is the control room." Keep the "what it is not" list. | `docs/DESIGN.md:5-15` | Yes, §1 |
| F2 | Type: values in A2-08. Data labels (`t-data`, caps) only in Builder view and inside tables; on Today, Inbox and panels use `t-label` sentence case in text-2. | `tokens.css`, `dugout.css` `.t-data`, `Panel`, `MetricTile` | Yes, §4 |
| F3 | Captions carry the teaching, so lift `--text-3` from `#8a94a3` to `#98a2b1` (7.3 : 1 on surface-1, 5.5 : 1 on surface-4). | `tokens.css:55`, `tokens.test.ts` | Yes, §5 |
| F4 | A reading column for the guided front door: Today and Needs you content capped at 960 px and centered from 1440 up (`max-w-(--page-read)`, new token `--page-read: 960px`); the 12-column full-width grid stays for Details and tables. | `TodayScreen.tsx:197`, `PageGrid` prop `measure="read"` | Yes, §2 "Structure never moves" (an exception for Today), §9 |
| F5 | One voice line first: Today opens with the Chief of Staff's sentence in reading type (15/24) with the avatar: "Good evening, Maya. The team finished your page draft; one thing needs you." It is `chiefAnswer("happening", facts)` (`packages/shared/src/chief-answers.ts`), no model call. The panels follow. | new `dugout/today/TodayLead.tsx` + story; `today.get` already has the facts | Yes, §9 Today |
| F6 | Fewer lit instruments in week one: runway chip, mode chip and Stop all agents by stage (A2-04 step 3). The top bar then reads: name, title, search, date, Continue. | `BusinessShell.tsx:837-918`, `KitBar` props `runway?: null`, `mode?: null` | Yes, §8 top bar |
| F7 | Continue says what it will do, in words under the label for guided accounts on first use: a two-line button state "Continue · your team keeps working" until the first run completes; the cost hint ("Last round cost $0.52 · Estimate") moves from the tooltip to a visible `t-small` line beside it at ≥1440. | `ContinueButton.tsx` (`subline` prop), `KitBarFit` | Yes, §8 Continue |
| F8 | Row and control comfort on guided screens: `--row-comfortable` 34 → 40 on Today and the Inbox list; primary actions on Today `size="lg"` (40 px). The structure tokens (sidebar 232, bar 56, list 380) stay. | `NeedsYouList`, `InboxList`, `GoalPanel` | Yes, §6 |
| F9 | Field edges visible at rest (`--line-field`, A2-14) and status pill words in text-1. | `controls.css` | Yes, §5, §8 |
| F10 | Glow budget: at rest only Continue and the active sidebar edge glow. Today's panels use `elev-0` (no `glow="brand"`), the strip rests at 40 % opacity when idle. "Alive" comes from the team's presence (avatars, "working now" line), not from light. | `Panel glow`, `shell.css .processing-strip`, `MilestonesScreen.tsx:201` | Yes, §3, §7 |
| F11 | Words in the chrome: A2-09. Add to §10 a short table "Engine word → founder word" (cycle → round of work; orchestrator → the team's engine, or nothing; Inbox / Needs you; business / project). | `docs/DESIGN.md` §10 | Yes, §10 |
| F12 | Small screens: A2-01 and A2-02. §2 line 19 and §6 "Small screens" restated: the console never shows a bare wall; inside a project the phone shell stays and the note offers Today, Needs you and a link by email; the store-links value is named. | DESIGN §2, §6 | Yes |
| F13 | Storybook defaults: Builder view off, guidance on, comfortable text, and a "Week one" story for AppShell, Sidebar and Today. | `.storybook/preview.ts` | No |
| F14 | Keep: the DecisionBar, the plan dialog, `emptyWhy`, `ErrorPanel`, the area sentences, EntityLink, the Estimate / Forecast chip, reduced-motion handling. These are the parts that already sound like a peer. | — | No |

---

## 4. Roadmap items in this area: done, partial, open

| Item | State | Evidence |
| --- | --- | --- |
| THESIS 2.1 small screens: landing, sign-in, profile, public pages, people, messages | Done | `SMALL_SCREEN_PREFIXES` (`DesktopOnly.tsx:29-51`), PROGRESS 1799-1804 |
| THESIS 2.1 Today and Needs you from 390 px | Partial | `AppShell phone`, `PhoneBar`, `e2e/phone-today.spec.ts`; open: first-paint flash, no Explain button, order of panels, tooltips on touch, links from Today into walls (A2-01, A2-10) |
| THESIS 2.1 "a kinder note with 'email me the link'" | Open | `NeedsLargerWindow.tsx:31-39` unchanged; no send-link procedure |
| THESIS 2.1 "the doors" (`/new`) from 390 px | Open | `/new` is not in the list (only `/new/card/`) |
| Native-app handoff, one config value | Open | A2-02 |
| THESIS 2.5 retire "game mode" | Open in the shell | `GameModeChip`, `mode={business.gameMode}`, `FLAGS.liveMode`, Communities gated on `live` |
| THESIS 6.1 show by stage | Open | A2-04 |
| THESIS 6.2 earnings first (shell part: Today Health, runway chip) | Open | A2-11 |
| THESIS 6.3 founder tasks on Today | Open | no task surface in `TodayScreen.tsx` or `today.get` |
| THESIS 6.6 one switch for supervision | Open | mode chip, `TeamCanDoTab`, `AutopilotSection`, vacation all in the default view |
| THESIS 6.9 management-game wording stays | As decided | Agents table unchanged |
| THESIS 6.10 copy pass | Partial | plain-language gate green in CI; drift listed in A2-09 |
| UX plan Phase 0 words | Done | PROGRESS 1286-1331 |
| UX plan Phase 1 guided layer | Done; verified by `tours.spec.ts`, `explain-page.spec.ts`, `preferences.spec.ts`, `first-days.spec.ts` | but orphaned on Details (A2-05) |
| UX plan Phase 2 depth and enforcement | Done except: explainers on today's landing tabs (A2-06); `plain-language` gate runs in CI (`ci.yml:84-85`); the status-contrast test exists but misses tints (A2-14); `docs/PLAIN_LANGUAGE_SWEEP.md` in the repo is the Oct 21 run (921 define-tier hits, 19 in UI roots) |
| UX plan Phase 3 teaching by doing | Built: tours, checklist, ExampleToggle ×3, comfortable text, example project, "Start your own" slot, sample caption, `guidance.*` events | open: Gate 3 (second external 30-minute test), never recorded |
| Nov 9 "Phase 3" (founder areas, area sentences, one Explain button, Ask Chief, first-week timeline, empty states) | Done | PROGRESS 1409-1430 |
| Builder view | Done | DESIGN 241-251, `builder-view.spec.ts` |
| DESIGN.md amended for the thesis | Open | A2-07 |

---

## 5. Interfaces a planner must know

**Shell (apps/web)**
- `BusinessShell({ businessId, initialBusiness: BusinessGet, initialDepartments: DepartmentList, viewer: { email, userId, name? }, children })` (`components/shell/BusinessShell.tsx:67-74`). Exports used by tests: `shellPollIntervals`, `INVALIDATE_ON_EVENT`, `shellConnection`, `cycleReducer`, `describeContinue`, `describePause`, `describeRunEnded`, `lastCycleCostLine`, `orchestratorDown`, `wantsFirstContinueCallout`, `FIRST_CONTINUE_CALLOUT`, `EXAMPLE_START_CALLOUT`, `exampleFrame`, `START_YOUR_OWN_HREF`, `continuePressedNotice`.
- A screen sets the chrome with `useShellChrome({ title, tabs?: TabBarProps, breadcrumbs?, rightRail? }, deps)` (`components/shell/chrome.tsx:16-51`) and page keys with `usePageShortcuts({ onRefreshInbox, onNextInboxItem, onPrevInboxItem, onChooseOption, onEditLayout, onEscape })` (`lib/keys.ts:18-90`).
- `useBusiness(): { businessId, data: BusinessGet, departments, departmentBySlug, access }`, `useBusinessCurrency()` (`components/shell/business-context.tsx`).
- `Access { role, isAdmin, canChange, isExample, canRead(section), canWrite(section) }`, `accessFor`, `canOpenDepartment`, `readOnlyReason`, `sampleMarker` (`lib/access.ts`).
- Area tab bars: `useAreaNav()`, `useAreaTabBar(area, activeId)` (`components/shell/useAreaNav.ts`); `areaNav`, `areaTabItems`, `areaHref`, `areaOfRoute`, `areaBreadcrumbs`, `areaOpeningOf`, `areaTabLabel` (`lib/areas.ts`).
- Sidebar: `buildSidebarItems(SidebarInput)`, `activeSidebarId`, `SIDEBAR_IDS`, `areaSidebarId`, `NEEDS_YOU_LABEL`, `TEAM_CALL_LABEL`, `CRM_LABEL` (`lib/sidebar.ts`).
- Continue: `computeContinueState`, `respondHref`, `journeyHref`, `unviewedWin`, `awayReportId` (`lib/continue-state.ts`).
- Small screens: `SMALL_SCREEN_PREFIXES`, `SMALL_SCREEN_PATTERNS`, `worksOnSmallScreens(pathname)`, `<DesktopOnly>`, `<WorksOnSmallScreens />` (`components/providers/DesktopOnly.tsx`).
- States: `ScreenSkeleton({ rows })`, `ShellSkeleton`, `ErrorPanel({ title, label?, message, detail?, onRetry?, retryLabel? })`, `NotFoundPanel({ title, heading, back, bare? })`, `RefreshFailedNotice({ query })`, `loadFailed(q)`, `refreshFailed(q)`, `isMissing(err)`, `RouteError({ error, retry, scope })`.
- Routes: `routes.{today,home,inbox,crm,milestones,calls,call,journey,department,settings,agent}` (`@foundmill/widgets/shared/routes`), `moduleHref`, `moduleTabHref` (`/shared/departments`).

**Design system shell (`@foundmill/dugout`)**
- `AppShell` props (`shell/AppShell.tsx:122-196`): `mode`, `businessMode`, `kit`, `logoSrc`, `businessBadge`, `businessBadgeLine`, `continueSlot`, `businessName`, `screenTitle`, `sidebar: { items, activeId, collapsed, onCollapsedChange, brand }`, `onNavigate`, `nav`, `continueButton: AppShellContinue`, `stopAll: StopAllAgentsProps`, `processing: { segments, active, cycleNumber, notice }`, `tabs`, `breadcrumbs`, `pageActions`, `rightRail`, `search`, `date`, `runwayMonths`, `runwayWords`, `cash`, `runwayEstimate`, `onRunwayClick`, `spendLineMinor`, `businessCurrency`, `onModeClick`, `businessMenu`, `connection`, `keyboard`, `viewportWidth`, `minViewportWidth`, `phone`.
- `SidebarItem { id, label, icon, href?, group: "main" | "area" | "department" | "live" | "foot", area?, dept?, badge?, badgeTone?, keys?, fixed?: "home" | "inbox", shortcut?, hint?, disabled? }`; `ContinueState` union; `TabItem { id, label, href?, subViews?, badge?, badgeTone?, disabled?, tier?: "default" | "detail" }` (`shell/types.ts`).
- `ContinueButton` props: `state`, `cycleNumber`, `pulseKey`, `bindSpace`, `disabled`, `pending`, `caveat`, `hint`, `size`, handlers `onContinue | onRespond | onPause | onGoToJourney | onComeBack`.
- `Panel({ title, meta?, help?, actions?, footer?, span?, loading?, error?, onRetry?, empty?, flush?, glow? })`, `PageGrid({ flush?, stack? })`, `EmptyState({ icon, title?, action?, actions?, compact? })`, `ErrorState`.

**Guided layer**
- `GuidanceProvider({ value: Partial<GuidanceState>, actions })`, `GuidanceTermsProvider({ terms })`, hooks `useGuided()`, `useTerm(id)`, `useGuidanceMode()`, `useGuidanceProgress()`, `useGuidance()`; state `{ guidance: "on" | "off", textSize: "standard" | "comfortable", explainersSeen, toursDone, checklistDismissedAt, terms, loaded }`; actions `setGuidance`, `setTextSize`, `markExplainerSeen`, `markTourDone`, `dismissChecklist`, `resetGuidance` (`guidance/GuidanceProvider.tsx`).
- `Term({ id, children?, fact?, always?, definition?, side?, align?, onOpen? })`; `InfoTip({ label, children, learn?, kind?: "tip" | "why", always? })`; `Explainer({ screenId, purpose, action, watchFor, example? })`; `Coachmark({ tourId, steps: CoachmarkStep[], onDone })`, `Callout({ tourId, targetId, title, body, side })`, targets are `data-coachmark="<id>"`; `NextStep({ steps, compact? })` with `nextStepsFor(facts, routes)`; `FirstWeekTimeline({ steps, paused })`; `ExampleToggle`.
- `BuilderViewProvider({ on })`, `useBuilderView()`, `<BuilderOnly fallback>`; web side `useBuilderViewPreference(): { on, loaded, setOn }`, `useGuidancePreferences()` (`components/providers/guidance-context.ts`).
- Definitions: `TERMS`, `TermId`, `termsWithGlossary(glossary)`, `learnPath(learn, businessId)` (`packages/shared/src/terms.ts`); `emptyWhy(id, facts)`; `firstWeekTimeline(facts)`; area sentences `moneyAreaWords` etc.
- Tours: `TourDefinition { id: "home" | "inbox" | "department", steps, stamps }`, `LazyTour({ id })`, `tourWanted(state, id)`.

**Widgets and modules**
- `registerWidget<S>({ key, title, description, icon, surfaces: ("home" | "department")[], defaultSize, settingsSchema?, defaultSettings?, liveOnly?, single?, Component, SettingsComponent? })`, `getWidget`, `listWidgets(surface?, live?)`, `parseWidgetSettings` (`packages/widgets/src/registry.ts`). Host side: `gridRegistry(surface, businessId, live)` (`apps/web/lib/widget-registry.tsx`).
- Data contract: `WidgetDataSource { useQuery(path, input, opts), mutate(path, input), navigate, subscribe(channel, handler, { focused }), setFocus?, businessId, glossary, gameMode?, currency, timeZone?, useStreamOpen? }`; hooks `useWidgetQuery`, `useWidgetData`, `useGlossary`, `useToday`, `useBusinessEvents` (`packages/widgets/src/data.tsx`). Host: `WidgetDataHost`, `createWidgetSource`, `INVALIDATION_MAP` (`apps/web/lib/widget-data.tsx:73-104`).
- `registerModule({ key: ModuleKey, screens: ModuleScreen[] })`, `ModuleScreen { moduleKey, tabSlug, title, subViews?, Component: ComponentType<{ businessId, departmentId, subView? }> }`, `getModuleScreen` (`packages/modules/src/registry.ts`); `useModulePacks(needed, preload)` (`lazy.ts`); `ModuleEnv { collabUrl, collabToken?, SpecEditor?, readOnly?, canWrite(section) }` (`env.tsx`). A department tab is a `screen_definitions` layout; a layout whose only widget is `module:<key>/<tab>` renders that module full-screen (`components/screen/DepartmentScreen.tsx:49-70`).
- Dashboard presets: `packages/config/src/dashboard-presets.ts` (`founder`, `builder`, `seller`, `investor`).

**Areas, tiers, flags, preferences**
- `AREA_KEYS`, `AREA_LABELS`, `AREA_LETTERS`, `MODULE_AREA`, `TAB_AREA_OVERRIDES`, `AREA_SECTIONS`, `AREA_FIXED_TABS`, `areaTabsByArea(departments, { builder, canOpen?, fixed? })`, `areaLanding` (`packages/shared/src/areas.ts`).
- `MODULE_TABS`, `DEFAULT_TABS`, `BUILDER_ONLY_TABS`, `FOUNDER_TAB_TITLES`, `tabTier`, `visibleTabs`, `firstVisibleTab`, `tabTitleFor` (`packages/shared/src/constants.ts:68-172`).
- Flags (`packages/config/src/flags.ts`): `liveMode` (false; `LIVE_MODE=1` opens it per environment), `devSimulatePanel`, `holidayMode`, `trainingGround`, `matchDaySound`, `ownPlanFunding`.
- Account preferences (`founder.preferences`): `guidance`, `textSize`, `explainersSeen`, `toursDone`, `checklistDismissedAt`, `builderView`, `anthropomorphicAgents`, `agentStyle`, date and time format; cookies `fm_text_size`, `fm_date_format`; `localStorage` `SIDEBAR_COLLAPSED_PREFIX + businessId`.

---

## 6. Tests and stories covering this area, and the gaps

Covered:
- Unit (apps/web): `components/shell/__tests__/business-shell.test.ts` (274 lines), `business-switcher`, `business-title`, `ask-chief`, `error-panel`, `route-error`, `query-states`, `shell-skeleton`, `not-found-screens`, `next-shell-link`; `components/providers/__tests__/{desktop-only,guidance-host,guidance-root,date-format-host,agent-persona-host,text-size-cookie}`; `components/tours/__tests__/{definitions,signal,tours}`; `components/screen/__tests__`; `lib/__tests__` (sidebar, areas, continue-state, search, query-client, stream…).
- Unit (dugout): `AppShell.test.tsx`, `ContinueButton`, `Sidebar`, `CommandPalette`, `DecisionBar`, `StopAllAgents`, `KitBarFit`, `coachmarkTargets`, `Dialogs`, `tokens.test.ts`, `clientBoundaries.test.ts`, `Explainer`, `Term`, `InfoTip`, `Coachmark`, `NextStep`, `FirstWeekChecklist`, `Today.test.tsx`.
- Playwright (`apps/web/e2e`, 73 specs, three shards in CI on PGlite): `shell`, `shell-chrome`, `shell-resilience`, `areas`, `today`, `phone-today`, `home`, `inbox`, `tours`, `explain-page`, `ask-chief-of-staff`, `builder-view`, `preferences`, `keyboard-a11y`, `no-clip` (1280, 1440), `example-business`, `first-days`, `stop-resume`, `return-loop`, `milestones`, `journey`, `crm`, `team-call`, `settings-*`, `titles-not-found`, `speed`, `server-path`.
- Stories: 150 files; groups Foundation 39, Shell 24, Guidance 17, Data 12, Agents 11, Conversation 11, Public 10, Today 9, Call 8, Journey 6, Share 3; 390 px stories for AppShell, PhoneBar, the Today panels, the public pages.

Gaps:
1. No machine a11y check anywhere (A2-13).
2. No test that a fresh (week-one) project's sidebar and tab bars are what a first-timer should see; `areas.spec.ts` and `shell.spec.ts` run on Northwind.
3. `phone-today.spec.ts` asserts the wall for other routes (a test of the dead end); nothing checks links out of Today at 390 px.
4. `tours.spec.ts` starts the Home tour at `/home`; nothing asserts what a new founder sees on `/today`.
5. No test that every inline area tab has an explainer, that every `TERM_IDS` entry is used, or that shell strings avoid "cycle" with Builder view off.
6. `no-clip.spec.ts` does not run at 390 px or with comfortable text.
7. Contrast tests cover text on plain surfaces only (no tints, no field edges, no text on the brand slab at reduced opacity).
8. No hex or arbitrary-value scanner; no bundle budget per route in CI (only the `speed.spec.ts` timings).
9. `EmailAnswer` has no error-state test; no 390 px Playwright test for `/a/<token>` target sizes.
10. Stories missing for 15 components (§1.14); `PeopleList` is outside the design system; no "week one" story of the shell.
11. UX Gate 3 (second external test) has no record.

---

## 7. Anything surprising

1. The Home tour, the next-step line and the checklist all still live on a tab called "Details"; the front door has had no first-visit tour since Nov 7.
2. There are two different panels titled "Your first week".
3. Space starts agent work from anywhere on the page, and digits answer decisions, with the key caps hidden from exactly the people most likely to press them by accident.
4. The phone menu offers eight destinations that end in a screen telling a phone to "widen the window".
5. The store-links "one config value" is written into CLAUDE.md, DECISIONS and the mobile plan, and exists nowhere in code.
6. Storybook's a11y addon is set to fail on violations, but nothing runs it; CI only builds the static Storybook.
7. `PlainFigure`, `ProvenanceTip` and `DefinitionCard` have no direct callers outside the design system; `InfoTip` has four. The guided layer is carried almost entirely by `Term` (154 uses) and the hidden `Explainer` button.
8. Tailwind numeric spacing runs on a 3.25 px unit because the root font size is 13 px; DESIGN.md states both that and "8 px grid" in adjacent paragraphs.
9. Monaco's and xterm's fallback colors are the pre-2027 palette, so if a token ever fails to resolve the terminal and the diff show the old theme.
10. `ContinueState "matchday"` ("Go to Journey") is fully styled, tested and wired, and can no longer occur.
11. Today's Cash tile and the top bar's cash rule disagree about a project with no bank (0 versus "Not known yet").
12. The data layer is better than the brief suggested: stream-aware freshness, resync after a gap, kept data on a failed refetch, a chunk-error reload. The weak spots are product decisions (what to show, in which words, at what size), not engineering.
13. I could not find the "open hydration issue for the Example chip" in PROGRESS, DECISIONS, GATES, the UX plan or the code; if it exists it is recorded somewhere outside the repo. The only first-paint mismatch I can see in this area is the phone flash.
14. The working tree changed under this audit, and not by it (this audit wrote only to the scratchpad; `HEAD` is still `04a0a509`, and everything above was read from files that match it). The tree was clean at the start; by the end `git status` showed: an untracked `docs/holistic-plan/`; `CLAUDE.md` modified (two lines added under "Always": follow the `karpathy-guidelines` skill, and "Outside Claude Code skills and plugins are used freely (founder, 2026-11-15; this replaces the 2026-11-13 rule that they be vetted first)"; the "Never install or run an outside Claude Code skill…" line removed); a staged deletion of `.claude/skills/vet-third-party-skill/SKILL.md`; and about 30 new untracked skill folders under `.claude/skills/` with a `THIRD_PARTY_NOTICES.md`. Another session is writing to the repo. Whoever plans from this report should confirm that change is the founder's before relying on it; this audit kept to the brief's rule and invoked no outside skill.
