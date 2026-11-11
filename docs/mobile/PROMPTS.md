# Foundmill mobile: the prompt sequence for Newly

Send these to the Newly agent **in order, one per message**, in the mode named in each heading. Wait for the preview after each Build step, check it against the acceptance list, and only then send the next. Each prompt assumes `AGENTS.md` is at the project root and the four skills are installed (see README.md). When a step misbehaves, use Ask mode to diagnose before asking for a fix, and "Restore to here" if a change goes the wrong way.

Replace `<SUPABASE_ANON_KEY>` before sending prompt 1. Replace `<FIRST_NAME>` with the founder's name where it appears.

## Where we are (Nov 11, 2026)

Prompts 0 to 12 are built. Newly runs a short device-check budget per turn, so every prompt from 12 on is cut into messages that each build one thing and run one group of checks.

**What changed around the app while it was being built.** The web app moved in three ways that the phone has to follow, and the founder recorded decisions on Nov 11 that change some of the words:

1. **The web's navigation now follows the founder's questions, not the departments.** Five areas (Plan, Customers, Money, Product, Team) group the departments' tabs by the module that owns each tab; a department is a label inside its area. Each area opens on one plain sentence from the same facts as its tiles, with the figure's label (Estimate or Forecast) as a chip. Company (the legal module) is a section inside Money; Milestones sits in Plan and Contacts in Customers. Builder view, an account switch that is off by default, shows the engine (every tab, code, health, hierarchy, ratings as numbers). The phone is a founder surface: Builder view is always off there.
2. **Help is one control: the Chief of Staff on every page.** "What's happening?", "What's blocking us?" and "Why am I seeing this?" are answered from Today's own facts with no model call (`chiefOfStaff.answer`); "Ask something else…" opens the conversation. On the web a separate "Explain this page" button shows a screen's three lines; on the phone the Chief of Staff's "Why am I seeing this?" covers it, so there is one control per screen.
3. **The first week explains itself and the sample says it is a sample.** `today.get` carries `firstWeek` (Day 1, Days 2–3, Week 1 with done / now / next); fifteen empty screens have one sentence each about what fills them and when; the two seeded businesses (Northwind Skincare and Ledgerly) carry a "Sample business" caption and roll forward with the calendar; Customers this week is one server number (`journey.ribbon.customers`); Continue answers with one sentence (`business.continue().summary`) and shows the last round's cost; approvals carry "What exactly" rows; the founder's own idea survives to the specification ("Use my idea as written", Edit on every card, "Choose this idea").
4. **The founder's words for people (Nov 11).** The humans of a business are its **People**: **cofounders** (equal standing, any number) and **collaborators** (limited access). "Staff" and "seat" leave every string; people are free on every plan. A business is a **project** until its first sale and a business after. Nothing a person reads names jobs, employment, careers or AI taking work as the reason to be here. The native app is the phone's home once it launches; the small-screen web will send people to the stores.

Prompt 12B below catches the app up with 1 to 3. Prompt 14 and the voice skill carry 4. The thesis review (`docs/THESIS_REVIEW.md` on the roadmap branch) plans person profiles, project pages, invitations, join requests and messaging; those are Phase B at the end of this file and wait for the backend.

---

## 0 · Start (the first message on Home; creates the project) ✅

> Build the Foundmill mobile app for iPhone and Android. Foundmill (https://foundmill.com, look at the public landing page for the brand, the words and the interactive example) is where one founder builds and runs a real business with a team of AI agents. The desktop web app already exists; this app is the founder's companion: a much more visual, intuitive and engaging way to answer the team, keep it running and feel the business grow, connected to exactly the same backend.
>
> Dark only, "a broadcast control room at night, in your pocket": canvas #08090C, lit card edges, tabular figures, status colors that glow, gold reserved for customers and milestones, Barlow Semi Condensed for figures and titles, Inter for text, Lucide icons, no emoji, no light theme, radii never 16 or more.
>
> Five tabs: Today, Inbox, Team, Journey, Business. A floating brand-colored **Continue** pill above the tab bar. Sign-in is a Supabase email one-time code (no passwords, no social sign-in, no Newly Backend sign-in). All data comes from Foundmill's own API (tRPC + superjson) and WebSocket stream. **Do not create a Newly Backend and do not connect the Supabase integration**; this app has no backend of its own and no secrets.
>
> For this first version build only: the project skeleton with Expo Router and the five tabs, the theme tokens file, the top slab in Foundmill steel (#3570CC) with the wordmark, the tab bar with Lucide icons (Sun, Inbox, Users, Route, Building2), a placeholder Today screen that says "Nothing needs you right now. The team keeps working.", and the Continue pill at rest. Bundle the three fonts. No data yet. Name the project "Foundmill".

**Accept when:** five tabs render on iPhone and Android simulators; the canvas is #08090C; the slab is a brand glass gradient; the fonts load; the Continue pill is a 56 px brand pill with an inner top highlight and a soft glow below; nothing is uppercase.

---

## 1 · Standing instructions and skills (Build) ✅

> Create `AGENTS.md` at the project root with exactly the content I paste below, and then create the four skills `foundmill-backend`, `foundmill-design`, `foundmill-voice`, `foundmill-product` from the four `SKILL.md` files I attach, scoped to this project. Afterwards, in `theme/tokens.ts` and `theme/type.ts`, replace the placeholder values with the exact tokens and type styles from the design skill, and add `app.json` `expo.extra` with `FOUNDMILL_API_URL: "https://api.foundmill.com"`, `FOUNDMILL_STREAM_URL: "wss://stream.foundmill.com"`, `SUPABASE_URL: "https://sdruubitufjqibsjyxlc.supabase.co"`, `SUPABASE_ANON_KEY: "<SUPABASE_ANON_KEY>"`, read through one `config.ts`. Set the URL scheme to `foundmill` and the bundle id to `com.foundmill.app`.
>
> [paste AGENTS.md; attach the four SKILL.md files]

**Accept when:** the agent confirms the files exist; `theme/tokens.ts` contains every hex from the design skill and nothing else; a native rebuild runs once for the scheme.

Newly does not let a skill be edited in place: when a skill changes, delete it in Settings › Skills and create it again with the new body (name, "when to use it" from the frontmatter's description, "what it does" = the whole body).

---

## 2 · Design system components (Plan, then Build) ✅

Plan message:

> Plan the component library from section 6 of the foundmill-design skill: TopSlab, TabBar, ContinueButton, Card (plain, department, brand), MetricTile, StatusPill, Chip, EstimateChip, Button (primary, secondary, ghost, danger, gold, two-line with description and tag), QuickReplies, DecisionSheet, Avatar, ProfileHeader, SkillBar, StarRating, FormCells, EntityText, ChatBubble, Toast, Sheet, Segmented, SectionLabel, Skeleton, EmptyState, ErrorState. For each, list the props and which tokens it uses. Propose a `app/dev/components` gallery route, visible only in development, that shows every component in every state with the real copy from the voice skill.

Then in Build mode:

> Build the plan. Use react-native-reanimated for press (scale .985 over 90 ms, spring back), overlay (scale .98 → 1 over 200 ms), and the 600 ms one-shot ring on ContinueButton. Draw the card's gradient edge with expo-linear-gradient and the department corner light with Skia. Make the gallery route show every component. Nothing may use a hex outside `theme/tokens.ts`.

**Accept when:** the gallery shows all components; the DecisionSheet renders three options with consequences, the first primary with a "Recommended" tag; pills always show an icon and a word; the Continue pill shows all five states (rest, blocked "Respond · 2", processing with an orbiting arc and "Pause", gold "Watch the update", vacation "Come back").

---

## 3 · Sign-in (Plan, then Build) ✅

> Plan sign-in exactly as section 1 of the foundmill-backend skill describes: supabase-js with the anon key, `signInWithOtp` with `emailRedirectTo: "foundmill://auth/callback"`, a six-digit code screen that calls `verifyOtp` with type "email", deep-link handling for the link, the session in expo-secure-store through a custom storage adapter, `autoRefreshToken` on, `detectSessionInUrl` off. After sign-in call `founder.businesses.list` over tRPC. Handle `not_invited` with the "Not on the list yet" screen from the voice skill. Then build it.
>
> Screens: Sign in (wordmark on the canvas with a faint brand aura, "Sign in with your email. No password.", email field, Continue), Code ("Check your email. Enter the six-digit code, or tap the link in the message.", six boxes, Resend after 30 s), Not on the list yet, and a Businesses chooser (logo tiles, name, role chip, "Sample" chip on a demo business) that lands on the last-opened business or, with none, on Start.

**Accept when:** a real email arrives, the code signs in, the session survives an app restart, sign-out clears everything, and a wrong code shows one sentence under the boxes.

---

## 4 · API client, business context, stream (Build) ✅

> Build `api/client.ts` exactly as section 2 of the backend skill shows (untyped tRPC client, superjson, splitLink with httpBatchStreamLink for the six streaming procedures using expo/fetch, bearer from `supabase.auth.getSession()` per request, 45 s read timeout, 4 min write timeout), `api/errors.ts` with the error table mapped to sentences, `api/stream.ts` as a `StreamClient` that implements the handshake with the two subprotocols, `sub`/`unsub`/`ping`/`auth`/`focus` frames, the `subscribed` gate, bursts as arrays, reconnect with jittered backoff, token refresh before `exp`, and `api/refetch-map.ts` with the event-type table from section 3. Add `useBusiness()`, `useStream()` and `useContinue()` hooks. Cache the last answers of the listed queries in MMKV and show them under a "Showing what you last saw" banner on launch. Write Jest tests for the error mapper, the frame parser, the refetch map, money and date formatting, and the mention regex.

**Accept when:** with the example business open, `business.get` and `today.get` load; killing the network shows the banner with cached data; the stream connects (log "subscribed ev:<id>") and reconnects after airplane mode; tests pass.

---

## 5 · Today (Build) ✅

> Build the Today tab from section 4 of the foundmill-product skill: Your goal card (brand-lit; approve / change with a sheet), Needs you (up to three rows with one-tap recommended option and Open), This week and next, Health (2 × 2 metric tiles plus the channel spend line), Live now (horizontal strip of working agents from `team.agents.list` filtered to presence working), Latest from the team. Wire the Continue pill to `useContinue()` (`business.continue`, `pauseCycle`, `resumeCycle`; states from `cycle.continueState`). Call `goal.ensure` once on open. Pull to refetch. Haptic medium on Continue, success on approving the goal. Every string from the voice skill verbatim.

**Accept when:** Northwind's Today shows the goal, the two red items, four tiles with correct currency (£ for Northwind, USD for AI usage), and pressing Continue (on your own business, not the example) flips the pill to processing and back when `cycle.completed` arrives.

---

## 6 · Inbox list and note (Build) ✅

> Build the Inbox tab and the note screen from section 5 of the product skill: segmented tabs All · Needs you · Customers · Updates · Archive with counts, rows with portrait, kind tag, two-line subject, preview, mono time, gold edge on customer wins, unread dot, swipe right to archive (not on notes that need an answer), the "Ask for an update" button on `inbox.refresh` with a 60 s "Writing…" state, infinite scroll on `nextCursor`. The note screen: header, subject, About chips, reading-style body via EntityText, status strip, exhibit folded under "Show the numbers" (chart as a Skia line or bars, table as rows, entity card, diff as "+12 −3 path" rows, agent tile as a mini tile), the conversation so far, and the pinned DecisionSheet / Go-ahead bar / composer. `inbox.markRead` after 1 s on screen. A landed note (from `inbox.item_created`) rises in with the "Just in" tag.

**Accept when:** "Approve batch 002 before the Ireland launch?" renders with its three options and consequences exactly as in the attached desktop screenshot, mentions are tappable, and on the example business the options read "Start your own to decide".

---

## 7 · Deciding and talking (Build) ✅

> Wire decisions: option tap → `inbox.decide` with `chosenOption`, buttons disabled on press, success haptic, the sheet collapses into "Your answer: <label>". Free text → `inbox.decide` with `freeText`; when the answer is `pending_confirmation`, show the plan's actions as rows and a Confirm button on `plan.confirm`, with "Nothing runs until you confirm." Questions go to `agent.conversation.inboxReplyStream`. Approvals: Approve / Decline → `team.approvals.resolve`. Build the Conversation screen (`agent.conversation.get`, `sendStream` with `clientMessageId`, streamed bubble, quick replies rising 40 ms apart, hand-off → staged plan → Confirm, the typing line naming what the agent reads). Build the Nudge sheet (`dev.tasks.shout` with the chips from the conversation's `persona.nudges` sent as `text`, plus a 280-char custom line) and the "Understood." acknowledgment bubble.

**Accept when:** a decision on your own business returns and the note shows the answer; a streamed reply renders word by word; a retry with the same `clientMessageId` does not duplicate the message.

---

## 8 · Team (Build) ✅

> Build the Team tab from section 6 of the product skill: the leads-first agents list (Chief of Staff pinned, leads with expanding specialists, background helpers behind one line and a sheet), the caption line, department filter chips; the Agent profile with ProfileHeader, Now card with "Watch", Talk, Nudge, the three skill sections with 20-cell bars and band words, Other roles, traits, Coach report with a development sparkline, Form, History, Contract; owner/admin actions Train (focus picker, Estimate, run with a live rail, results old → new with drops over 1 point highlighted, Promote / Discard, rollback during the seven-day watch), Change model (Opus / Sonnet / Haiku, comparison, apply scope sheet), Pause / Resume, Let go. Sub-screens People (the humans; built as "Staff", renamed in 12B), Health (Down rows with expected back), Hierarchy, Recruitment.

**Accept when:** Northwind shows "Chief of Staff · 6 leads · 23 specialists · 2 need you", portraits load from `/personas/...`, a down agent reads "Down · expected back in …", and ratings read like "16.5 Excellent".

Open decision that touches this tab: the thesis review asks whether the ratings out of 20, Form, Agent of the week, Hire / Let go / Lend and the wage cap stay in the default view or move behind Builder view (its §14, question 7, "management-game grammar"). Until the founder answers, the tab stays as built.

---

## 9 · Live sessions (Build) ✅

> Build "Watch <Agent> work": subscribe to `as:<sessionId>` while open, show the phase rail, progress ring, meter (elapsed, tokens, cost as Estimate, time left), test results as pills, the LogView on ink with `tool_call`, `stdout`, `file_changed`, `test_result`, `note` rows, auto-scroll with "Jump to latest", and the controls Pause, Resume, Nudge, Stop (`dev.tasks.*`). Load history with `dev.sessions.replay` before trusting the stream. Also build Development › Working now as a grid of small tiles (phase, progress, agent) that open this screen, and the Task graph as a pannable, zoomable Skia DAG colored by status.

**Accept when:** a running session's log scrolls live, pausing flips the phase pill, and reduced motion freezes the ring on its current value.

---

## 10 · Journey and the Customer Update player (Plan, then Build) ✅

> Plan the Journey tab from section 7 of the product skill and the JourneyRibbon and ChannelBoard anatomy in the design skill, then build it: the Ribbon as a horizontally scrollable Skia canvas (revenue line in kitLift drawing over 1.2 s on first open, bars beneath, chapters above, pins, the Today pill, the hatched forecast with a dashed line and 7 % cone, pinch to zoom, tap a day for facts, the runway sentence colored by months), the chapters carousel, the Customer Updates feed with gold-edged cards and "New", the Milestones 2 × 4 grid, and the daily round-up table.
>
> Then the Customer Update player as a full-screen stories experience: tap to advance, hold to pause, swipe down to close; stages Who was involved → First touch → touches → rails → Win moment → Debrief with the exact words from the voice skill; the Win moment as a 1.2 s brand wipe with a Skia particle burst in the brand's secondary color and gold, the customer's name in displayXl and the amount, success haptic; Debrief with 1–10 bars, the Standout agent and Lead channel starred and the attribution sentence; speeds Full / Highlights / Instant remembered in MMKV; the four closing options writing through `inbox.decide` on the customer_won note; `journey.markViewed` on close; a static gold card under reduced motion.

**Accept when:** Northwind's ribbon matches the attached Home screenshot's shape (revenue per day £248.68, the 1,000th customer pin, the forecast cone) and the player plays a Featured update end to end in under a minute.

---

## 11 · Business tab, departments, module screens (Build, in three messages) ✅

Message A:

> Build the Business tab: the department card grid from `department.list` in the founder's order (color dot, lead portrait, "2 of 3 working", Working on now, headline metric with a Skia sparkline, Next, health pill), then rows for Contacts, Milestones, Settings, and Network / Communities / Leaderboards only on a LIVE business. Build the department screen: a segmented control of the department's tabs, each rendering the supported widgets as a vertical stack and "Open on the web for this view" otherwise. Never hard-code a department name.

Message B:

> Build the native module screens for Product (Vision, Specification sign-off with Approve / Request changes, Roadmap as swipeable Now / Next / Later, Changes with accept all / reject / per-change), Distribution (the Channel Board on ink with the four quadrants, fit rings, 48 px running tokens, 28 px dashed ghosts in a tray, tap for the channel card, long-press a ghost for "Put on the board" via `distribution.channels.enable`; Channels list with fit, five cost-trend cells and cost to win; Campaigns; Creative with approve / reject; Attribution with the split bar; the "Waiting for the product" state and Start distribution), and Finance (the one-sentence opener and three numbers, More numbers revealing P&L, Cash, Runway scenarios, Payroll, Cap table, with the footer "Agents never initiate payments.").

Message C:

> Build Legal (Entity, Compliance calendar with "requires your identity" tags, Contracts, Regulatory, every recommendation captioned "Information, not legal or tax advice.", incorporation status linking to the web), Contacts (search, list with relationship strength 1–20 and role and stage chips, the contact sheet with facts, roles, notes and Add a note, reachable from every mention in the app), and Milestones as its own screen.

**Accept when:** Northwind's "Formulation Lab" and "Retail Partnerships" appear as departments with their own colors; Finance opens on exactly one sentence and three numbers; the Channel Board places running channels by fit.

Prompt 12B message A regroups this tab into the five areas; the department screens and module screens built here stay and are reached through their area.

---

## 12 · Settings, vacation, stop, preferences (Build) ✅ built, checks 2–7 open

> Build Settings from section 9 of the product skill: Business (read-only), What the team can do (the shield block verbatim, three radio cards in words, the spend line money field, who answers, Autopilot), Vacation (Until: a date / a condition / until I return; authority; budget ceiling; wake events; while on, Continue reads "On vacation until Oct 21" with Come back), Stop all agents with the "Nothing is deleted." confirmation, Preferences (Explain things as I go, Text size, Date format, Agent names and faces with the four styles, Notifications per kind, Hide amounts on the lock screen, Haptics, Sounds off by default), Billing (plan, usage, Top up opening Checkout in the system browser for owners), Example business (Explore / Leave), Account (email, Sign out). Rows for Departments, Members, Integrations, Keys and Danger zone open `https://foundmill.com/b/<businessId>/settings/<tab>`.

**Accept when:** changing the spend line updates the slab chip's words ("Asks over £100") after `business.get` refetches; starting a vacation flips Continue; a viewer sees every control disabled with the viewer sentence.

**Close-out message** (checks 2 to 7, one group per turn as Newly asks):

> Run the remaining Settings checks in order, one per turn, and tell me after each what you saw. (2) Tap the Continue pill while Commutair is on vacation: the sheet opens and Come back calls `business.endHoliday` with `{ reason: "founder_returned" }` (the only two values the server takes are "founder_returned" and "kill_switch"; anything else is a 400). The pill goes back to rest. (3) Stop all agents: the sheet's first line is "Nothing is deleted."; confirm, see the team stopped, then Resume. (4) Explain things as I go off and on. (5) Agent names and faces: Fantasy and back to Humans; portraits change. (6) Billing on Commutair: plan, usage this period labeled Estimate, Top up opens the checkout page in the system browser and nothing is charged (close it). (7) Open Northwind: every write control is disabled with "As a viewer you can follow this business, but not change it." If a round starts and stops with "the model account that runs Foundmill is out of credit", that is on Foundmill's side and not a bug in the app: show the sentence as the note says it.

---

## 12B · Catch up with the web: areas, the Chief of Staff, the first week, honest words (Build, in five messages)

Message A, **areas**:

> Regroup the Business tab into the founder's areas, exactly as the web's sidebar now does (backend skill, "Areas"). The tab opens on four area cards, in this order: **Plan, Customers, Money, Product** (Team is already the third tab, so it is not repeated here). Each card shows the area's one-sentence opening line from `business.areas.words` (words plus an Estimate or Forecast chip when `provenance` is set; a skeleton that says "Reading the numbers" until it answers; the Company line under Money's sentence), and under it the area's inline tabs as chips. Tapping a card opens the area screen: the sentence at the top, a segmented control of the area's **inline** tabs, a "More detail" sheet listing the rest, and each tab rendering the department screen you built in prompt 11 (module screen or widgets). Compute the grouping on the device from `department.list` with the mapping in the backend skill: a tab goes to the area of the module that owns its slug (product and development → Product, distribution → Customers, finance and legal → Money, team → Team; `roadmap` goes to Plan), a founder's own tab goes with the department's first module, a department with no modules keeps its own card after the areas, two departments with the same tab title in one area carry the department after a "·". Inline tabs are each module's default pair; a department with no inline tab gets its first one promoted so it is never only behind "More detail". Plan also lists **Milestones**; Customers also lists **Contacts**. Below the four cards keep the rows Settings and, on a LIVE business, Network / Communities / Leaderboards. Under a department's name show the kind line when it differs from the area ("Formulation Lab is part of Product."). Never hard-code a department name.

**Accept when:** Northwind's Business tab shows four cards with four sentences; Money's reads like "You have £25K and earn more than you spend, so cash is not running out." with an Estimate chip and a Company line; Plan lists Specification, Roadmap, Milestones and (behind More detail) the Product department's other tabs; "Formulation Lab › Specialists" is reachable from Product.

Message B, **the Chief of Staff on every screen**:

> Add one "Ask <Chief of Staff's name>" control to every screen's header (a ghost button with the Chief of Staff's portrait; hidden while `chiefOfStaff.who` is null). It opens a sheet with three rows, "What's happening?", "What's blocking us?", "Why am I seeing this?", and a last row "Ask something else…". A row calls `chiefOfStaff.answer { question, page: { path, area, purpose } }` and shows the two to four sentences through EntityText (mentions tappable), with "Continue in chat" opening the conversation with the question as the first message; "Ask something else…" opens the conversation with nothing typed. `page.path` is the web path of the screen you are on (`/b/<id>/today`, `/b/<id>/inbox`, `/b/<id>/d/<deptSlug>/<tabSlug>`, `/b/<id>/agents/<agentId>`, `/b/<id>/settings`, `/b/<id>/crm`, `/b/<id>/milestones`, `/b/<id>/journey`), `page.area` the area key when the screen is in one, `page.purpose` the screen's own one-line purpose from `docs/screens.md` when it has one (plain text, under 300 characters). Keep the answers as they come: the server already labels Forecast and Estimate and writes US dates. No model call happens here and no cost: say so nowhere, just make it instant.

**Accept when:** on Northwind's Today the three questions answer in under a second; "What's blocking us?" names the first note in Needs you; on a department tab "Why am I seeing this?" starts with the area's purpose sentence.

Message C, **Today's first week, empty states, the sample**:

> On Today, when `today.get().firstWeek` is not null, show the "Your first week" panel under Needs you: three steps (Day 1, Days 2–3, Week 1) with their state (Done / Now / Next), `when`, `team` and `asks` lines as the server sends them, and the `paused` line when present; nothing is computed on the device and the panel disappears when the field is null. Replace every bare empty state on Today, Customers' Leads and Campaigns, Contacts, Milestones, the Roadmap, the Specification, Money's cash views, Company's entity and compliance and Recruitment with the exact sentences in the voice skill's "Empty screens" list (the Needs you sentence has a first-days variant: use it when `firstWeek` is not null). On any business whose `business.get().isDemo` is true, show a quiet "Sample business" caption under the name in the slab, with the sentence "Its figures are made up for the example: nothing here is real money or real customers." in the business switcher; on the example business add "Nothing you do here is saved." Read Customers this week from `journey.ribbon().customers.thisWeek` (and `previousWeek` for the delta) instead of counting rows, and name the revenue tile "Average monthly revenue" when `finance.overview().revenue.recurring` is false and "Monthly recurring revenue" when true.

**Accept when:** a brand-new business shows "Your first week" with Day 1 as Now and the two later steps labeled Estimate; Northwind shows the Sample business caption and no first-week panel; the Customers this week tile matches the web's Home tile.

Message D, **Continue's words and the honest numbers**:

> Make Continue answer in words. After `business.continue` resolves, show `summary.plainHeadline` as the toast with `summary.detail` as its second line and, when the answer carries `item` (the one note written because the orchestrator was unreachable), make the toast open that note. Within a second of the press, before the server answers, the pill's label reads "Starting the next round of work…". On the pill's long-press sheet add "Last round cost $0.52 · Estimate" from `cycle.status().lastCost` (hide the line when null). When `business.get().orchestrator.reachable` is false, the idle pill's sheet says "The team cannot run right now: the service that runs the team's work is not reachable. A press writes one note; no agent works." and the press still works. Everywhere the app speaks to the founder, say "round of work", never "cycle N"; "cycle" stays only in code. On approval notes, render `inbox.get().approval.what` under the sentence: the `headline` when set, then `rows` as label and value pairs (mono face when `mono`), and when `what.empty` is true show the server's sentence as it is and make Reject the recommended option under the label "Ask for the details". When `approval.githubConnected` is false, show "Connect GitHub first" as the recommended action opening the web's Integrations page. When `approval.batch` has more than one entry, show one expander per request (agent, action, amount, what) and one Approve all / Reject all.

**Accept when:** pressing Continue on your own business shows "The next round of work started: 3 tasks ready to build" (or the "nothing is ready to build yet" variant) within a second; an approval note on Commutair shows its What exactly rows; the sheet shows the last round's cost.

Message E, **People**:

> Rename every human-facing use of "Staff" to **People** (the Team sub-screen, its row, the invite sheet, `docs/screens.md`): the humans of a business are its People, **cofounders** (equal standing, any number) and **collaborators** (limited access). The role chips keep the API's role words where the API has no cofounder role yet (owner, admin, member, viewer) and the sheet's title reads "People". Remove the word "seat" anywhere it appears and never cap the number of people in copy. Call the business a **project** in the app's own sentences while `journey.ribbon().customers.total` is 0 and a **business** after the first sale (one `useProjectWord()` helper; API-written text is left as it comes). Run the banned-word check with the new entries from the voice skill (staff, seat, and the subtext list: job, jobs, employment, unemployment, career, 9 to 5, laid off, "AI taking", as reasons).

**Accept when:** Team shows a People row and screen; the banned-word test fails on a planted "staff" string; a business with no sale reads "project" in the app's own lines.

---

## 13 · Push notifications (Build)

> This is a native batch: in the same build also add `expo-crypto` so the tapped-link PKCE flow uses sha256 instead of plain, and set the Android package id to `com.foundmill.app` to match iOS (both deferred from prompt 3). Then add push notifications with OneSignal through Newly's Integrations › Push notifications, connecting **our own OneSignal account** (not the Newly-managed app): Foundmill's server sends through that OneSignal app's REST API key, so the app id must be ours. On sign-in and on every launch, send the OneSignal subscription id to `founder.devices.register` ({ platform, provider: "onesignal", token, appVersion }) and on sign-out to `founder.devices.unregister`; never block sign-in on either, log a failure and retry on the next launch. Route a tapped notification on its payload (`kind: inbox | journey | team | today`, `businessId`, `itemId`, `journeyId`, `agentId`, `approvalId`, `goalId`) to the matching screen after switching business. While the app is in the foreground show the stream's toasts instead of local notifications. Wire the per-kind notification switches in Preferences to `founder.preferences.notifications` and `founder.preferences.update` under `notifications` (the seven kinds: decision, approval, customer, agent_down, runway, run_finished, goal; every kind is on until turned off).

**Accept when:** a test push from the OneSignal dashboard with `{"kind":"inbox","businessId":"…","itemId":"…"}` opens that note cold-start and warm.

Before sending: the founder creates Foundmill's own OneSignal app, connects it in Newly, and sets `ONESIGNAL_APP_ID`, `ONESIGNAL_API_KEY` and `LIVE_CONNECTORS=onesignal` on the gateway (docs/DEPLOY.md §5.6).

---

## 14 · Start flow: profile, doors, ideation, commit, import (Plan, then Build in two messages)

> Plan section 12 of the product skill: Before you start (two passes; the time-commitment card that used to say "Keep my day job for now" reads "Fits around what I already do"; skill sliders with the None / Some / Solid / Expert anchors mapping to 3 / 8 / 13 / 18; "Show me an example"; the Welcome aboard toast), Your first project (three doors; the example door says what it opens: a business two years in, whose figures are its own and not a forecast of yours), Ideation (the brief with the Fan generate control streaming `idea.draft`; **"Use my idea as written"** → `idea.write` makes one card from the founder's words; swipeable concept cards with ten attributes and stars; **Edit** on every card → `idea.edit` for the name, the pitch and the kind of business; a "Your words" chip while the pitch is the founder's and a "Sample" chip when the mock model wrote it; Shortlist / Merge / Fork / Ask / Discard; More like this; Compare up to four with a Skia radar; the card's button reads **"Choose this idea"**), Commit (name with `idea.domainCheck` stamped with the time this device received the list; logo upload / generate / initials; brand colors with the contrast check; four labeled lines Where it runs / Who decides / Kind of business / On a schedule instead of a chip row; the roster without background helpers and its monthly wage line in USD labeled Estimate; a renamed department introduced as "Editorial · your Product department"; **Take charge** → `idea.commit` → Today, which shows "Your first week" from `today.get().firstWeek`), Import (sources, polling `import.status`, the Import report, Commit). Then build the profile and doors, then ideation, commit and import.
>
> Keep the profile and Commit screens thin and data-driven: the web plans to shrink both to a few plain questions (what should we call you, what are you good at, what are you here for) with everything else later, so no screen here may hard-code the question list.

**Accept when:** a new account can go from sign-in to Today of a brand-new project entirely on the phone, "Use my idea as written" produces a card that keeps the typed words and goes straight to Commit, and "Explore an example" opens Northwind in read-only mode with "Start your own" in Continue's slot.

---

## 15 · Mobile-only touches (Build)

> Add the mobile-only touches from section 10 of the product skill, each computed from existing data and labeled honestly: a **"Since you were last here"** card at the top of Today when the app was closed for more than six hours (notes landed, customers won, rounds finished, from `inbox.list`, `journey.list` and `cycle.history` since the last-open time kept in MMKV; "Nothing happened while you were away." when nothing did); the Sunday **"Your week"** card (notes answered, customers won, rounds run, AI usage from `billing.usage`); a long-press on any portrait for a quick profile card; a long-press on Continue for **"Run one round only"** (`business.continue` then `pauseCycle` after the first `cycle.completed`); home-screen quick actions (iOS and Android) for "Needs you" and "Continue". No streaks of any kind (a daily count punishes the vacation the product offers), no points, no badges, no streak fire, no emoji. The Agent of the week card waits for the founder's decision on the ratings (prompt 8's note); do not build it yet.

---

## 16 · LIVE social (on hold)

Do not send this yet. The thesis review plans to retire "game mode" (Personal or Live becomes "Who can see this: only us / anyone"), to open the people layer to everyone, and to remove or rework leaderboards (packages 2.5 and 4.9). Network, Communities and Leaderboards would be built against an API that is about to change. The People surfaces that replace them are Phase B below. Until then, hide every `live.*` surface on the phone; the API answers FORBIDDEN "LIVE is not open yet" on Personal businesses anyway.

---

## 17 · Hardening and store readiness (Ask, then Build)

Ask message:

> Review the whole app against AGENTS.md and the four skills and list every violation: hex outside tokens, a banned word or British spelling in a string ("staff" and "seat" included), a sentence that names jobs, employment or careers as a reason to be here, a dash shown for a missing value, a number without Estimate or Forecast where it is not measured, "cycle" shown to a founder, a control under 44 × 44, text under 4.5:1, an animation without a reduced-motion state, a screen without an empty / loading / error / read-only state, a screen without the Chief of Staff control, a fetch outside the api layer, a place where a founder could see an id, enum or mode name.

Then:

> Fix every item on that list. Then prepare for the stores: app icon from the attached `foundmill-icon-512.png`, splash on #08090C with the wordmark, bundle id `com.foundmill.app`, version 1.0.0, privacy manifest (no tracking, no third-party analytics), the App Review note "Sign in with any email; the code arrives by email. To see a full business without onboarding, tap Explore an example.", and ship to TestFlight.

---

## Phase B · People (after the backend ships it; not before)

The thesis review's roadmap (docs/THESIS_REVIEW.md §13, phases 2 to 5) makes the native app the phone's home for the people side: a person exists before any project, finds people and projects, invites, joins, messages. None of it is in the API yet. Each prompt below names the backend package it waits for; send it only once `BACKEND_CHANGES.md` marks that package shipped and the backend skill carries the procedures.

- **18 · The person** (packages 2.3, 2.4): Before you start becomes three plain questions (what should we call you; what are you good at or enjoy, as tags; what are you here for: start something, join something, not sure yet), a public person page with per-field visibility, and Home for a person with no project: people and projects that fit, requests, messages, the two doors.
- **19 · People in a project** (packages 3.1, 3.3, 3.4, 3.5): the People screen with cofounders, collaborators and open roles; invitations by link and email with accept / decline; join requests landing in Needs you; the two-week trial with its check-in note.
- **20 · Share** (packages 1.1, 5.3): the project page link from Today and from every milestone; milestone cards as images with a link to the page; "this is live, send it to someone" as the first session's ending.
- **21 · Messages and finding people** (packages 3.7, 4.2, 4.3): a project thread, comments on notes and tasks, browse people by strengths and projects by need, the matcher's suggestions with one honest line of why.
- **22 · Store hand-over** (package 2.1): once the app is in the stores, the small-screen web sends people to download it through one config value; nothing to build in the app beyond universal links (`BACKEND_CHANGES.md` item 5).

---

## Reusable follow-up prompts

- **A screen looks wrong:** "On <screen> the <element> shows <what I see>; it should <what the skill says>. Attach: screenshot. Diagnose first in Ask mode, then fix."
- **New data from Foundmill:** "Foundmill added `<procedure>` returning `<fields>`. Use it on <screen> for <purpose>, with the empty state '<sentence>'."
- **Copy audit:** "List every string in app/, components/ and features/ that is not sentence case, contains an exclamation mark, a banned word, a British spelling, 'staff', 'seat', 'cycle', or a dash used as a placeholder."
- **A skill changed:** "I replaced the `<skill>` skill. Re-read it before the next change; list anything in the app that now disagrees with it."
