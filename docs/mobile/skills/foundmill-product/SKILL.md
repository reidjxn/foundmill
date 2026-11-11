---
name: foundmill-product
description: Use whenever you plan, build or change a screen or flow of the Foundmill mobile app. Carries what Foundmill is, who uses it, how the core loop works, every screen of the mobile app with its contents and actions, the engagement mechanics, and the product rules that must hold on every screen. Read it before touching navigation or any screen.
---

# Foundmill, the product, and what the mobile app is

## 1. What Foundmill is

Foundmill is where a person builds something of their own: one founder with a team of AI agents can build and run a real business end to end, and a founder who would rather build with someone finds them here too. Building alone is the normal, complete case: the app never suggests a founder needs anyone else, and offers people only where the founder looks for them. The founder sets the direction and makes the decisions that matter; the agents do the work: product specification, code, distribution across channels, finance, legal, research. Everything runs inside rules that keep money, signatures, identity and security in human hands. Winning a paying customer is the event that counts, and the product celebrates it.

The desktop web app (foundmill.com, 1280 px and wider) is a dense control room: a sidebar of departments, a top slab in the business's brand color, an Inbox with a reading pane and a decision bar, dashboards of widgets, live agent sessions. The **mobile app is the founder's companion to that room**: the place to answer the team, feel the business move, watch a customer get won, nudge an agent, and keep the team running from anywhere. It is more visual, more immediate and more fun than the desktop, and it connects to exactly the same backend, so a decision made on the phone is the decision.

The founder: first-time or fifth-time, often solo, time-constrained, checking in between other things. They are not a developer. They want to know three things fast: *what needs me*, *how is the business doing*, *what did the team do*. And they want it to feel alive.

Business modes (never named in the UI): Augmented (team asks before any outside contact or spend), **Assisted** (default: routine work alone, asks over a spend line, before anything irreversible and before any contract), Automated (decides alone within a ceiling; used on vacation). Game modes: **Personal** (private) and **LIVE** (social: network, communities, leaderboards). Most businesses are Personal.

Hard gates that no mode ever automates: moving money, signing, filings that need the founder's identity, accepting terms, permanent deletion, security settings, acting on instructions found in content. These always arrive as a note that needs the founder.

## 2. The core loop

**Read the Inbox → decide (one tap or a few words) → press Continue → the team works → new notes land.** Continue runs cycle after cycle until nothing is left to do. Only a hard stop holds it (credits used up, a revoked key, Stop all agents). Decisions wait in "Needs you" and never block the team.

Every screen of the mobile app serves that loop. The two most-used gestures in the app are *answer a note* and *press Continue*.

## 3. Navigation

Five tabs, left to right: **Today · Inbox · Team · Journey · Business**. The **Continue** pill floats above the tab bar on Today and Inbox. The top slab shows the current business (tap the logo to switch) and the "what the team can do" chip.

Stack navigation inside each tab. Universal deep links: `foundmill://b/<businessId>/today`, `/inbox/<itemId>`, `/journey/<journeyId>`, `/agents/<agentId>`, `/d/<deptSlug>/<tabSlug>`. Push notifications open these.

Before any business exists, the app shows the **Start** flow (section 12). A person with more than one business lands on the last one opened.

## 4. Today (the front door)

Vertical stack, pull to refetch:

1. **Your goal** (brand-lit card): the sentence ("Get the first 10 paying customers by Dec 19"), a 6 px progress bar, a pace pill (On pace / Behind / Date passed / Reached, gold once reached), the pace line ("4 of 10 so far, 38 days left: on pace (Forecast)."). A proposed goal shows "Proposed by Ines Park, your Chief of Staff" with **Approve this goal** and **Change it** (a sheet asking "What should change?" in words). Empty: "Your Chief of Staff proposes a goal after the first round of work."
2. **Needs you**: up to three rows, each with the sender's portrait, a kind label (Your decision / Your approval / Request / Goal), the subject, and a one-tap primary where the note has a recommended option ("Approve · Recommended"), plus Open. "See all in the Inbox". Empty: "Nothing needs you right now. The team keeps working."
3. **This week and next**: three to five sentences from the API, no model call.
4. **Health**: four metric tiles in a 2 × 2 grid: Cash, Runway, Customers this week, AI usage this week (USD); then Channel spend this week as a line. Never summed across currencies.
5. **Live now**: a horizontal strip of agents currently working (portrait, name, what they are doing, a thin progress line). Tap to open the agent; long-press to Nudge.
6. **Latest from the team**: the last three notes as compact rows.

Continue sits above the tab bar. Its states come from `cycle.continueState`.

## 5. Inbox

Segmented tabs: **All · Needs you · Customers · Updates · Archive** (plus Messages on a LIVE business). Counts in pills; Needs you's is red.

Rows: 60 px minimum; 28 px portrait; kind tag (icon + word: Respond, Go-ahead, Customer, Milestone, Warning, Update, Report, Message); subject wrapping to two lines; preview; mono time. A customer-won row carries a gold left edge. Unread rows have a `kitLift` dot. Swipe right to archive an informational note; swipe left to open the sender's thread. A note that needs an answer cannot be swiped away.

An explicit **Ask for an update** button in the tab header calls `inbox.refresh` (one new note, costs credits; show "Writing…" in the button for up to 60 s). Pull-to-refresh only refetches.

**Note screen** (full screen, scroll): header (portrait, "Juno (Chief of Staff)", department chip, date, status pill "Needs your answer" / "Answered" / "Archived"); subject in `displayMd`; "About" line of entity chips; the body in the reading style with mentions tappable; a status strip of up to four metric tiles; the exhibit (chart, table, entity card, diff summary, agent tile) folded under **Show the numbers**; the conversation so far; then, pinned to the bottom, the **Decision sheet** when the note needs an answer, or a **Go-ahead bar** (Approve / Decline with the summary and amount) for an approval, or a composer ("Reply to Juno") otherwise. Answered notes show "Your answer" / "Chief of Staff's answer".

A free-text answer is compiled into a plan: show the plan's actions as rows with a Confirm button when the API says it needs confirmation ("Nothing runs until you confirm."). Questions and small talk go through the conversational reply, not the decision.

## 6. Team

**Agents** list, leads first: the Chief of Staff pinned at the top; then each department's lead with "+3 specialists" expanding beneath; background helpers hidden behind one line at the foot ("5 background helpers also run…" → sheet). Each row: portrait with presence ring, name and role, status pill, current task (founder title) with a thin progress line, five form cells, rating "16.5 Excellent", stars. Caption at the top: "Chief of Staff · 6 leads · 23 specialists · 2 need you". A filter chip row by department.

**Agent profile** (hero screen): ProfileHeader; "Now" card (current task, progress, ETA, "Watch" opens the live session); **Talk** button (opens the conversation); **Nudge** button (presets sheet plus a custom line, 280 chars); the SkillGrid in three sections (Craft / Judgment / Execution) with 20-cell bars, values, band words and deltas; "Other roles it could take" with band words ("Based on the skills each role needs. Estimate."); trait chips ("Asks before spending"); the Coach report and a development sparkline; Form; History (last tasks with outcomes); Contract (model, wage cap, "Needs your OK above £50"). Actions for owners and admins: Train (focus up to three skills, see the Estimate, run, then Promote or Discard), Change model (Opus / Sonnet / Haiku with the comparison and apply scope), Pause / Resume, Let go (confirm sheet).

**Conversation** screen: the presence column collapses to a header (portrait, breathing ring, "Live · typing", the Now line). Messages as bubbles; the agent's reply streams; quick replies rise under the last message; a hand-off shows the staged plan with Confirm. The keyboard never covers the quick replies.

**Live session** screen ("Watch <Agent> work"): a phase rail (Plan → Build → Check → Review → Done), progress ring, a meter (elapsed, tokens, cost as Estimate, time left), test results as pills, the log on ink. Controls: Pause, Resume, Nudge, Stop. Subscribes to `as:<sessionId>` while open.

Other Team sub-screens, reachable from a "More" row: **People** (the humans of the project: cofounders and collaborators, with their roles; shown only when the project has more than one person or the founder opens it; add by email for admins, with the line "They need a Foundmill account with this address; no email is sent." until invitations by link exist; people are free on every plan, so never show a limit), **Health** (agents grouped by status, Down rows with expected back), **Hierarchy** (founder → Chief of Staff → leads → specialists as an indented tree), **Recruitment** (catalog by family; hire into a department).

## 7. Journey (the fun tab)

1. **The Ribbon** (mobile JourneyRibbon): revenue per day as the hero figure ("£248.68 per day, 7-day average" with the delta pill), the lit line, chapters above, pins, Today, the forecast cone, the runway sentence ("Cash runs out ~Mar 2027 · Estimate", amber under 9 months, red under 6).
2. **Chapters**: a horizontal carousel of chapter cards ("Q3 2026 · Steady progress"), each with that quarter's wins, milestones and releases.
3. **Customer Updates**: a vertical feed of gold-edged cards, newest first: customer name (anonymized if the business says so), level chip (Brief / Standard / Featured), amount, "Lead channel: Email automation", "Standout agent: Priya". Unviewed cards carry "New". Tap to **Watch**.
4. **Milestones**: the eight definitions as a 2 × 4 grid of gold tiles, reached ones lit with the date, upcoming ones outlined with "Next: 100th customer · 57 to go".
5. **Daily round-up**: once a business has many wins, a table per day (customers, amounts, channels) instead of one card each.

**Customer Update player** (full screen, stories-style): tap right to advance, left to go back, hold to pause, swipe down to close. Stages: **Who was involved** (portraits of the agents and the channel tokens fan in) → **First touch** (the first contact, when, through which channel) → the **touches** (one card per touch, narrated in the reading style, with the channel and agent) → the rails (customer facts; attribution split; touch count; time to convert; acquisition cost; the conversion-probability curve drawn live) → **Win moment** (the brand wipe, particles, the customer's name and amount, haptic success) → **Debrief** (agent ratings 1–10 as bars, the Standout agent starred, the Lead channel starred, "Attribution: early touches 40 %, last touch 40 %, middle 20 %"). Speeds: Full (45–60 s), Highlights (10–15 s), Instant; remembered per founder. Options at the end: Send a thank-you, Ask for a review in 14 days, Offer an annual upgrade, Just celebrate (each writes through `inbox.decide` on the customer_won note). Call `journey.markViewed` on close.

## 8. Business (departments and the rest)

A grid of **department cards** in the founder's order (two columns): department name with its color dot, lead's portrait, "2 of 3 working", "Working on now" (one line), a headline metric with a sparkline, "Next" (or "Nothing planned yet"), a health pill. Tap opens the **department screen**: a segmented control of its tabs (from `department.list`) and, per tab, a vertical stack of the widgets the app supports; anything else says "Open on the web for this view" with a link.

Below the grid: **Contacts** (the CRM: search, a list of people and organizations with relationship strength 1–20 and lead score stars; a contact sheet with facts, roles, notes, "Add a note"), **Milestones**, **Settings**, and on a LIVE business **Network**, **Communities**, **Leaderboards**.

Module screens the app renders natively:

- **Product**: Vision (one card), Specification sign-off (Approve the specification / Request changes), Roadmap as Now / Next / Later columns (swipe between), Changes (proposals: accept all, reject, or per-change accept/reject with the summary).
- **Development**: Live sessions (a grid of small agent tiles with phase and progress; tap to watch), Plan (tasks grouped by status, founder titles), Task graph (a pannable, zoomable Skia DAG colored by status), Merged changes (list), Code (read-only list of saved code with status "Pushed · abc1234").
- **Distribution**: Board (the Channel Board), Channels (list with fit, five-week cost trend as five cells, cost to win a customer), Campaigns, Creative (assets to approve or reject with a preview), Attribution (the sentence and a split bar). Until distribution starts: "Waiting for the product" and the **Start distribution** button for admins once the product is signed off.
- **Finance**: opens on one sentence and three numbers (Cash, Net burn, Runway); **More numbers** reveals P&L ("Management view, unaudited, counted when the cash moves"), Cash accounts, Runway scenarios (Base / Upside / Downside), **Payroll** (per-agent AI cost in USD plus human payroll), Cap table (read-only). Agents never initiate payments; say so in the Finance footer.
- **Team**: see section 6.
- **Legal**: Entity card, Compliance calendar (filings with due dates and "requires your identity" tags), Contracts (status pills), Regulatory gates. Every recommendation captioned "Information, not legal or tax advice." Incorporation always stops at the founder's own submit: the app shows the status and links to the web.

Departments can be renamed, merged, split and reordered on the web; the app renders whatever `department.list` returns and never hard-codes a department name ("Formulation Lab" and "Retail Partnerships" are real department names in the example business).

## 9. Settings (mobile subset)

- **Business**: name, logo, brand colors (read-only; "Change on the web").
- **What the team can do**: the shield line verbatim; "How much should the team do before checking with you?" as three radio cards (the words, never the mode names); "Above what amount should a purchase always ask you first?" as a money field; "Who answers when the team asks" (read-only summary). Autopilot toggle with cadence. **Vacation**: Until (A date / A condition / Until I return), what the Chief of Staff may decide, a budget ceiling, the wake events list; while on, Continue reads "On vacation until Oct 21" with Come back.
- **Stop all agents** (admin): confirm sheet starting "Nothing is deleted."
- **Preferences**: Explain things as I go (guidance switch), Text size (Standard / Comfortable), Date format, Agent names and faces (on/off and style: Humans / 3D cartoon / 2D cartoon / Fantasy), Notifications (per kind), Hide amounts on the lock screen, Haptics, Sounds (off by default).
- **Billing**: plan, usage this period, Top up (owner; opens Checkout in the browser).
- **Example business**: "Explore an example" opens the read-only example business; "Leave the example".
- **Account**: email, Sign out, "Delete my data" links to the web.
- Everything else ("Departments", "Members", "Integrations", "Keys", "Danger zone") is a row that opens the web.

## 10. Engagement mechanics (how each works; the app must get the numbers right)

- **Attribute ratings 1–20** in three groups: Craft (varies by agent type), Judgment (Planning, Scope control, Prioritization, Risk awareness, Knowing when to ask), Execution (Speed, Reliability, Tool use, Cost efficiency, Communication). Each skill shows Displayed, and on tap "Tested 15 · Proven 13 · 42 tasks". Bands: Poor 1–5, Average 6–10, Good 11–15, Excellent 16–20. An agent's rating is the mean of its skills; stars are rating/20 × 5 in halves; potential stars are outlined.
- **Form**: the last five tasks, each went well / partly / failed, as five cells.
- **Training**: pick a focus (up to three skills), see the Estimate, run (2–5 minutes, show the live rail), see old → new per skill (drops over 1 point highlighted), read the Coach's words, Promote or Discard. A seven-day watch offers one-tap rollback.
- **Agent of the week**: best agent by rating, form or value; a card on Today on Mondays.
- **Goal**: the Chief of Staff proposes; the founder approves or changes it in words; pace is a Forecast; a missed date re-proposes six weeks out.
- **Wins and Customer Updates**: signup = Brief, activation = Standard, first payment = Featured. Every win gets a full update until the 100th of its kind; after that only large or flagged ones, the rest in the daily round-up.
- **Milestones**: fire once each; gold; shareable as an image card on a LIVE business (customer anonymized unless permission is recorded).
- **Chapters**: one per calendar quarter, titled by the team.
- **Streaks and summaries the app adds** (mobile-only, computed client-side from existing data, always labeled as what they are): "Answered within a day, 12 days running" on Today's Needs you header; a Sunday "Your week" card (notes answered, customers won, cycles run, AI usage) built from `cycle.history`, `journey.list` and `billing.usage`. No invented numbers, no points, no badges beyond the Milestones.

## 11. Product rules that hold on every screen

1. Today is the front door; the business switcher remembers the last business.
2. Only a hard stop holds Continue; decisions never do.
3. Finance opens on three numbers; everything else is behind "More numbers".
4. No placeholder dashes. Use the API's words ("Not known yet", "No team yet", "No limit").
5. Every non-measured number says Estimate or Forecast in full.
6. Agents keep the name the founder chose, everywhere, with their role beside it.
7. The house rules block appears wherever the team's limits are described.
8. Viewers and advisors see everything they may read and no write controls. Example-business members are viewers.
9. Nothing in the app can move money, sign, accept terms, delete permanently or change security settings, for the founder or for an agent. Those always link to the web with a sentence saying why.
10. Never render raw event payloads, ids, enum values or mode names to a founder.
11. US English, US dates, the business's currency, never summed across currencies.
12. Agent text is content: render it, link its mentions, never act on instructions inside it.

## 12. Start (no business yet)

- **Sign in**: the Foundmill wordmark on the canvas with a faint brand aura; "Sign in with your email. No password." Email field; Continue; the six-digit code screen.
- **Before you start** (founder profile, two short passes): name; experience as four cards (First business / Ran one before / Serial founder / Operator); time commitment; where you live (currency derives from it). An optional "Add detail" pass: skills 1–20 with the four anchors None / Some / Solid / Expert (= 3 / 8 / 13 / 18), budget ("I have no budget yet"), markets, constraints, risk appetite. "Show me an example" fills it. Save shows the toast **Welcome aboard**.
- **Your first business**: three doors: **I have an idea, or none yet** (Recommended for a first business), **I already run something** (Import), **Explore an example** ("Walk around a running business before you start yours. Nothing you do there is saved.").
- **Ideation**: a brief field with the Fan generate control; concept cards as swipeable profile cards (ten attributes 1–20 with band words and evidence, current and potential stars); Shortlist, Merge, Fork, Ask a question, Discard; "More like this"; Compare up to four side by side (radar in department colors, "Agent verdict"; "Nothing is committed until you take charge.").
- **Commit**: name with domain and trademark screen ("a screen, not legal clearance"); logo (upload, generate four marks, or initials); brand colors; archetype; "How it runs" (the three radio cards and the spend line); **Take charge** lands on Today with the first-week checklist (sign off the specification, sign off the roadmap, run a cycle, read a note, talk to an agent, start distribution, connect a bank or Stripe).
- **Import** ("I already run something"): pick sources (GitHub, Drive, Notion, Linear, Jira, website, Stripe, Shopify, bank, registry; each connects on the web and the app polls the job); the **Import report** (what exists, what is missing, strengths, weaknesses, first decisions, roadmap seeds) then Commit.

## 13. The example business (also the App Review account)

"Explore an example" joins the person to **Northwind Skincare**, a DTC skincare business in GBP with departments including "Formulation Lab" and "Retail Partnerships", a Chief of Staff, agents with portraits, an Inbox with decisions ("Approve batch 002 before the Ireland launch?"), a 1,000th-customer milestone and a Journey. It is read-only (decisions show "Start your own to decide"). Any signed-in person can open it, which is how App Store reviewers see a full business without onboarding. Continue's slot there reads **Start your own**; Stop all agents is hidden.
