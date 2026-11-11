# Foundmill mobile: the prompt sequence for Newly

Send these to the Newly agent **in order, one per message**, in the mode named in each heading. Wait for the preview after each Build step, check it against the acceptance list, and only then send the next. Each prompt assumes `AGENTS.md` is at the project root and the four skills are installed (see README.md). When a step misbehaves, use Ask mode to diagnose before asking for a fix, and "Restore to here" if a change goes the wrong way.

Replace `<SUPABASE_ANON_KEY>` before sending prompt 1. Replace `<FIRST_NAME>` with the founder's name where it appears.

---

## 0 · Start (the first message on Home; creates the project)

> Build the Foundmill mobile app for iPhone and Android. Foundmill (https://foundmill.com, look at the public landing page for the brand, the words and the interactive example) is where a person builds something of their own: one founder with a team of AI agents can build and run a real business end to end, and a founder who would rather build with someone finds them here too. The desktop web app already exists; this app is the founder's companion: a much more visual, intuitive and engaging way to answer the team, keep it running and feel the business grow, connected to exactly the same backend.
>
> Dark only, "a broadcast control room at night, in your pocket": canvas #08090C, lit card edges, tabular figures, status colors that glow, gold reserved for customers and milestones, Barlow Semi Condensed for figures and titles, Inter for text, Lucide icons, no emoji, no light theme, radii never 16 or more.
>
> Five tabs: Today, Inbox, Team, Journey, Business. A floating brand-colored **Continue** pill above the tab bar. Sign-in is a Supabase email one-time code (no passwords, no social sign-in, no Newly Backend sign-in). All data comes from Foundmill's own API (tRPC + superjson) and WebSocket stream. **Do not create a Newly Backend and do not connect the Supabase integration**; this app has no backend of its own and no secrets.
>
> For this first version build only: the project skeleton with Expo Router and the five tabs, the theme tokens file, the top slab in Foundmill steel (#3570CC) with the wordmark, the tab bar with Lucide icons (Sun, Inbox, Users, Route, Building2), a placeholder Today screen that says "Nothing needs you right now. The team keeps working.", and the Continue pill at rest. Bundle the three fonts. No data yet. Name the project "Foundmill".

**Accept when:** five tabs render on iPhone and Android simulators; the canvas is #08090C; the slab is a brand glass gradient; the fonts load; the Continue pill is a 56 px brand pill with an inner top highlight and a soft glow below; nothing is uppercase.

---

## 1 · Standing instructions and skills (Build)

> Create `AGENTS.md` at the project root with exactly the content I paste below, and then create the four skills `foundmill-backend`, `foundmill-design`, `foundmill-voice`, `foundmill-product` from the four `SKILL.md` files I attach, scoped to this project. Afterwards, in `theme/tokens.ts` and `theme/type.ts`, replace the placeholder values with the exact tokens and type styles from the design skill, and add `app.json` `expo.extra` with `FOUNDMILL_API_URL: "https://api.foundmill.com"`, `FOUNDMILL_STREAM_URL: "wss://stream.foundmill.com"`, `SUPABASE_URL: "https://sdruubitufjqibsjyxlc.supabase.co"`, `SUPABASE_ANON_KEY: "<SUPABASE_ANON_KEY>"`, read through one `config.ts`. Set the URL scheme to `foundmill` and the bundle id to `com.foundmill.app`.
>
> [paste AGENTS.md; attach the four SKILL.md files]

**Accept when:** the agent confirms the files exist; `theme/tokens.ts` contains every hex from the design skill and nothing else; a native rebuild runs once for the scheme.

---

## 2 · Design system components (Plan, then Build)

Plan message:

> Plan the component library from section 6 of the foundmill-design skill: TopSlab, TabBar, ContinueButton, Card (plain, department, brand), MetricTile, StatusPill, Chip, EstimateChip, Button (primary, secondary, ghost, danger, gold, two-line with description and tag), QuickReplies, DecisionSheet, Avatar, ProfileHeader, SkillBar, StarRating, FormCells, EntityText, ChatBubble, Toast, Sheet, Segmented, SectionLabel, Skeleton, EmptyState, ErrorState. For each, list the props and which tokens it uses. Propose a `app/dev/components` gallery route, visible only in development, that shows every component in every state with the real copy from the voice skill.

Then in Build mode:

> Build the plan. Use react-native-reanimated for press (scale .985 over 90 ms, spring back), overlay (scale .98 → 1 over 200 ms), and the 600 ms one-shot ring on ContinueButton. Draw the card's gradient edge with expo-linear-gradient and the department corner light with Skia. Make the gallery route show every component. Nothing may use a hex outside `theme/tokens.ts`.

**Accept when:** the gallery shows all components; the DecisionSheet renders three options with consequences, the first primary with a "Recommended" tag; pills always show an icon and a word; the Continue pill shows all five states (rest, blocked "Respond · 2", processing with an orbiting arc and "Pause", gold "Watch the update", vacation "Come back").

---

## 3 · Sign-in (Plan, then Build)

> Plan sign-in exactly as section 1 of the foundmill-backend skill describes: supabase-js with the anon key, `signInWithOtp` with `emailRedirectTo: "foundmill://auth/callback"`, a six-digit code screen that calls `verifyOtp` with type "email", deep-link handling for the link, the session in expo-secure-store through a custom storage adapter, `autoRefreshToken` on, `detectSessionInUrl` off. After sign-in call `founder.businesses.list` over tRPC. Handle `not_invited` with the "Not on the list yet" screen from the voice skill. Then build it.
>
> Screens: Sign in (wordmark on the canvas with a faint brand aura, "Sign in with your email. No password.", email field, Continue), Code ("Check your email. Enter the six-digit code, or tap the link in the message.", six boxes, Resend after 30 s), Not on the list yet, and a Businesses chooser (logo tiles, name, role chip, "Demo" chip) that lands on the last-opened business or, with none, on Start.

**Accept when:** a real email arrives, the code signs in, the session survives an app restart, sign-out clears everything, and a wrong code shows one sentence under the boxes.

---

## 4 · API client, business context, stream (Build)

> Build `api/client.ts` exactly as section 2 of the backend skill shows (untyped tRPC client, superjson, splitLink with httpBatchStreamLink for the six streaming procedures using expo/fetch, bearer from `supabase.auth.getSession()` per request, 45 s read timeout, 4 min write timeout), `api/errors.ts` with the error table mapped to sentences, `api/stream.ts` as a `StreamClient` that implements the handshake with the two subprotocols, `sub`/`unsub`/`ping`/`auth`/`focus` frames, the `subscribed` gate, bursts as arrays, reconnect with jittered backoff, token refresh before `exp`, and `api/refetch-map.ts` with the event-type table from section 3. Add `useBusiness()`, `useStream()` and `useContinue()` hooks. Cache the last answers of the listed queries in MMKV and show them under a "Showing what you last saw" banner on launch. Write Jest tests for the error mapper, the frame parser, the refetch map, money and date formatting, and the mention regex.

**Accept when:** with the example business open, `business.get` and `today.get` load; killing the network shows the banner with cached data; the stream connects (log "subscribed ev:<id>") and reconnects after airplane mode; tests pass.

---

## 5 · Today (Build)

> Build the Today tab from section 4 of the foundmill-product skill: Your goal card (brand-lit; approve / change with a sheet), Needs you (up to three rows with one-tap recommended option and Open), This week and next, Health (2 × 2 metric tiles plus the channel spend line), Live now (horizontal strip of working agents from `team.agents.list` filtered to presence working), Latest from the team. Wire the Continue pill to `useContinue()` (`business.continue`, `pauseCycle`, `resumeCycle`; states from `cycle.continueState`). Call `goal.ensure` once on open. Pull to refetch. Haptic medium on Continue, success on approving the goal. Every string from the voice skill verbatim.

**Accept when:** Northwind's Today shows the goal, the two red items, four tiles with correct currency (£ for Northwind, USD for AI usage), and pressing Continue (on your own business, not the example) flips the pill to processing and back when `cycle.completed` arrives.

---

## 6 · Inbox list and note (Build)

> Build the Inbox tab and the note screen from section 5 of the product skill: segmented tabs All · Needs you · Customers · Updates · Archive with counts, rows with portrait, kind tag, two-line subject, preview, mono time, gold edge on customer wins, unread dot, swipe right to archive (not on notes that need an answer), the "Ask for an update" button on `inbox.refresh` with a 60 s "Writing…" state, infinite scroll on `nextCursor`. The note screen: header, subject, About chips, reading-style body via EntityText, status strip, exhibit folded under "Show the numbers" (chart as a Skia line or bars, table as rows, entity card, diff as "+12 −3 path" rows, agent tile as a mini tile), the conversation so far, and the pinned DecisionSheet / Go-ahead bar / composer. `inbox.markRead` after 1 s on screen. A landed note (from `inbox.item_created`) rises in with the "Just in" tag.

**Accept when:** "Approve batch 002 before the Ireland launch?" renders with its three options and consequences exactly as in the attached desktop screenshot, mentions are tappable, and on the example business the options read "Start your own to decide".

---

## 7 · Deciding and talking (Build)

> Wire decisions: option tap → `inbox.decide` with `chosenOption`, buttons disabled on press, success haptic, the sheet collapses into "Your answer: <label>". Free text → `inbox.decide` with `freeText`; when the answer is `pending_confirmation`, show the plan's actions as rows and a Confirm button on `plan.confirm`, with "Nothing runs until you confirm." Questions go to `agent.conversation.inboxReplyStream`. Approvals: Approve / Decline → `team.approvals.resolve`. Build the Conversation screen (`agent.conversation.get`, `sendStream` with `clientMessageId`, streamed bubble, quick replies rising 40 ms apart, hand-off → staged plan → Confirm, the typing line naming what the agent reads). Build the Nudge sheet (`dev.tasks.shout` with the presets from the agent's profile plus a 280-char custom line) and the "Understood." acknowledgment bubble.

**Accept when:** a decision on your own business returns and the note shows the answer; a streamed reply renders word by word; a retry with the same `clientMessageId` does not duplicate the message.

---

## 8 · Team (Build)

> Build the Team tab from section 6 of the product skill: the leads-first agents list (Chief of Staff pinned, leads with expanding specialists, background helpers behind one line and a sheet), the caption line, department filter chips; the Agent profile with ProfileHeader, Now card with "Watch", Talk, Nudge, the three skill sections with 20-cell bars and band words, Other roles, traits, Coach report with a development sparkline, Form, History, Contract; owner/admin actions Train (focus picker, Estimate, run with a live rail, results old → new with drops over 1 point highlighted, Promote / Discard, rollback during the seven-day watch), Change model (Opus / Sonnet / Haiku, comparison, apply scope sheet), Pause / Resume, Let go. Sub-screens Staff, Health (Down rows with expected back), Hierarchy, Recruitment.

**Accept when:** Northwind shows "Chief of Staff · 6 leads · 23 specialists · 2 need you", portraits load from `/personas/...`, a down agent reads "Down · expected back in …", and ratings read like "16.5 Excellent".

---

## 9 · Live sessions (Build)

> Build "Watch <Agent> work": subscribe to `as:<sessionId>` while open, show the phase rail, progress ring, meter (elapsed, tokens, cost as Estimate, time left), test results as pills, the LogView on ink with `tool_call`, `stdout`, `file_changed`, `test_result`, `note` rows, auto-scroll with "Jump to latest", and the controls Pause, Resume, Nudge, Stop (`dev.tasks.*`). Load history with `dev.sessions.replay` before trusting the stream. Also build Development › Live sessions as a grid of small tiles (phase, progress, agent) that open this screen, and the Task graph as a pannable, zoomable Skia DAG colored by status.

**Accept when:** a running session's log scrolls live, pausing flips the phase pill, and reduced motion freezes the ring on its current value.

---

## 10 · Journey and the Customer Update player (Plan, then Build)

> Plan the Journey tab from section 7 of the product skill and the JourneyRibbon and ChannelBoard anatomy in the design skill, then build it: the Ribbon as a horizontally scrollable Skia canvas (revenue line in kitLift drawing over 1.2 s on first open, bars beneath, chapters above, pins, the Today pill, the hatched forecast with a dashed line and 7 % cone, pinch to zoom, tap a day for facts, the runway sentence colored by months), the chapters carousel, the Customer Updates feed with gold-edged cards and "New", the Milestones 2 × 4 grid, and the daily round-up table.
>
> Then the Customer Update player as a full-screen stories experience: tap to advance, hold to pause, swipe down to close; stages Who was involved → First touch → touches → rails → Win moment → Debrief with the exact words from the voice skill; the Win moment as a 1.2 s brand wipe with a Skia particle burst in the brand's secondary color and gold, the customer's name in displayXl and the amount, success haptic; Debrief with 1–10 bars, the Standout agent and Lead channel starred and the attribution sentence; speeds Full / Highlights / Instant remembered in MMKV; the four closing options writing through `inbox.decide` on the customer_won note; `journey.markViewed` on close; a static gold card under reduced motion.

**Accept when:** Northwind's ribbon matches the attached Home screenshot's shape (revenue per day £248.68, the 1,000th customer pin, the forecast cone) and the player plays a Featured update end to end in under a minute.

---

## 11 · Business tab, departments, module screens (Build, in three messages)

Message A:

> Build the Business tab: the department card grid from `department.list` in the founder's order (color dot, lead portrait, "2 of 3 working", Working on now, headline metric with a Skia sparkline, Next, health pill), then rows for Contacts, Milestones, Settings, and Network / Communities / Leaderboards only on a LIVE business. Build the department screen: a segmented control of the department's tabs, each rendering the supported widgets as a vertical stack and "Open on the web for this view" otherwise. Never hard-code a department name.

Message B:

> Build the native module screens for Product (Vision, Specification sign-off with Approve / Request changes, Roadmap as swipeable Now / Next / Later, Changes with accept all / reject / per-change), Distribution (the Channel Board on ink with the four quadrants, fit rings, 48 px running tokens, 28 px dashed ghosts in a tray, tap for the channel card, long-press a ghost for "Put on the board" via `distribution.channels.enable`; Channels list with fit, five cost-trend cells and cost to win; Campaigns; Creative with approve / reject; Attribution with the split bar; the "Waiting for the product" state and Start distribution), and Finance (the one-sentence opener and three numbers, More numbers revealing P&L, Cash, Runway scenarios, Payroll, Cap table, with the footer "Agents never initiate payments.").

Message C:

> Build Legal (Entity, Compliance calendar with "requires your identity" tags, Contracts, Regulatory, every recommendation captioned "Information, not legal or tax advice.", incorporation status linking to the web), Contacts (search, list with relationship strength 1–20 and lead score stars, the contact sheet with facts, roles, notes and Add a note, reachable from every mention in the app), and Milestones as its own screen.

**Accept when:** Northwind's "Formulation Lab" and "Retail Partnerships" appear as departments with their own colors; Finance opens on exactly one sentence and three numbers; the Channel Board places running channels by fit.

---

## 12 · Settings, vacation, stop, preferences (Build)

> Build Settings from section 9 of the product skill: Business (read-only), What the team can do (the shield block verbatim, three radio cards in words, the spend line money field, who answers, Autopilot), Vacation (Until: a date / a condition / until I return; authority; budget ceiling; wake events; while on, Continue reads "On vacation until Oct 21" with Come back), Stop all agents with the "Nothing is deleted." confirmation, Preferences (Explain things as I go, Text size, Date format, Agent names and faces with the four styles, Notifications per kind, Hide amounts on the lock screen, Haptics, Sounds off by default), Billing (plan, usage, Top up opening Checkout in the system browser for owners), Example business (Explore / Leave), Account (email, Sign out). Rows for Departments, Members, Integrations, Keys and Danger zone open `https://foundmill.com/b/<businessId>/settings/<tab>`.

**Accept when:** changing the spend line updates the slab chip's words ("Asks over £100") after `business.get` refetches; starting a vacation flips Continue; a viewer sees every control disabled with the viewer sentence.

---

## 13 · Push notifications (Build)

> This is a native batch: in the same build also add `expo-crypto` so the tapped-link PKCE flow uses sha256 instead of plain, and set the Android package id to `com.foundmill.app` to match iOS (both deferred from prompt 3). Then add push notifications with OneSignal through Newly's Integrations › Push notifications, connecting **our own OneSignal account** (not the Newly-managed app): Foundmill's server sends through that OneSignal app's REST API key, so the app id must be ours. On sign-in and on every launch, send the OneSignal subscription id to `founder.devices.register` ({ platform, provider: "onesignal", token, appVersion }) and on sign-out to `founder.devices.unregister`; never block sign-in on either, log a failure and retry on the next launch. Route a tapped notification on its payload (`kind: inbox | journey | team | today`, `businessId`, `itemId`, `journeyId`, `agentId`) to the matching screen after switching business. While the app is in the foreground show the stream's toasts instead of local notifications. Add the per-kind notification switches to Preferences and store them with `founder.preferences.update` under `notifications`.

**Accept when:** a test push from the OneSignal dashboard with `{"kind":"inbox","businessId":"…","itemId":"…"}` opens that note cold-start and warm.

---

## 14 · Start flow: profile, doors, ideation, commit, import (Plan, then Build in two messages)

> Plan section 12 of the product skill: Before you start (two passes, skill sliders with the None / Some / Solid / Expert anchors mapping to 3 / 8 / 13 / 18, "Show me an example", the Welcome aboard toast), Your first business (three doors), Ideation (the brief with the Fan generate control streaming `idea.draft`, swipeable concept cards with ten attributes and stars, Shortlist / Merge / Fork / Ask / Discard, More like this, Compare up to four with a Skia radar), Commit (name with `idea.domainCheck`, logo upload / generate / initials, brand colors with the contrast check, archetype, How it runs, Take charge → `idea.commit` → Today with the first-week checklist), Import (sources, polling `import.status`, the Import report, Commit). Then build the profile and doors, then ideation, commit and import.

**Accept when:** a new account can go from sign-in to Today of a brand-new business entirely on the phone, and "Explore an example" opens Northwind in read-only mode with "Start your own" in Continue's slot.

---

## 15 · Mobile-only delight (Build)

> Add the mobile-only touches from section 10 of the product skill, each computed from existing data and labeled honestly: the "Answered within a day, N days running" line on Today's Needs you header (from `cycle.history` and answered notes), the Sunday "Your week" card (notes answered, customers won, cycles run, AI usage from `billing.usage`), the Agent of the week card on Mondays, a long-press on any portrait for a quick profile card, a long-press on Continue for "Run one cycle only" (`business.continue` then `pauseCycle` after the first `cycle.completed`), and home-screen quick actions (iOS and Android) for "Needs you" and "Continue". Keep every one inside the voice and design rules: no points, no badges, no streak fire, no emoji.

---

## 16 · LIVE social (Build; only after the business is LIVE)

> When `business.get().gameMode === "live"`, add Network (connections, requests, people search, visibility) and Communities (feed, post, join, invitations) under the Business tab (no leaderboards: that feature was removed), driven by `live.*`, and subscribe to `u:<userId>` for the badge. Hide all of it on Personal businesses; the API answers FORBIDDEN "LIVE is not open yet" there.

---

## 17 · Hardening and store readiness (Ask, then Build)

Ask message:

> Review the whole app against AGENTS.md and the four skills and list every violation: hex outside tokens, a banned word or British spelling in a string, a dash shown for a missing value, a number without Estimate or Forecast where it is not measured, a control under 44 × 44, text under 4.5:1, an animation without a reduced-motion state, a screen without an empty / loading / error / read-only state, a fetch outside the api layer, a place where a founder could see an id, enum or mode name.

Then:

> Fix every item on that list. Then prepare for the stores: app icon from the attached `foundmill-icon-512.png`, splash on #08090C with the wordmark, bundle id `com.foundmill.app`, version 1.0.0, privacy manifest (no tracking, no third-party analytics), the App Review note "Sign in with any email; the code arrives by email. To see a full business without onboarding, tap Explore an example.", and ship to TestFlight.

---

## Reusable follow-up prompts

- **A screen looks wrong:** "On <screen> the <element> shows <what I see>; it should <what the skill says>. Attach: screenshot. Diagnose first in Ask mode, then fix."
- **New data from Foundmill:** "Foundmill added `<procedure>` returning `<fields>`. Use it on <screen> for <purpose>, with the empty state '<sentence>'."
- **Copy audit:** "List every string in app/, components/ and features/ that is not sentence case, contains an exclamation mark, a banned word, a British spelling, or a dash used as a placeholder."
