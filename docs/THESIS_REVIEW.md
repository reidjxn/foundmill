# Thesis review and rebuild roadmap

Written Nov 11, 2026, from a read of the whole repository at commit `0904088`. This is a working document for Claude Code: section 1 turns the thesis into requirements, sections 2 to 11 report what exists against them, section 12 describes the target, section 13 is the roadmap, and section 14 lists the decisions only the founder can take. Nothing in this document changes a rule in CLAUDE.md; where the thesis conflicts with a rule, section 14 says so and the roadmap waits for the answer.

> **Correction from the founder, Nov 11, 2026 (after the first draft).** The main user is a solo founder, and they must feel fully able to do all of it alone. The first draft of this review made "finding each other" the core loop and wrote as if a project with one person were incomplete; that was wrong. The rule now (CLAUDE.md "Solo is complete"): nothing is gated on a second person and nothing treats one person as missing someone; finding a cofounder or collaborator is seamless and always an offer, never a requirement. The north star is weekly active projects with at least one real outcome that week, whatever the number of people. Sections 1, 2, 12, 13, 15 and 16 are revised to match; the findings in sections 3 to 11 stand as written, and where they call the people side "the core" read "the offer that must be seamless".

> **Main moved on Nov 11, 2026** ([reidjxn/foundmill#75](https://github.com/reidjxn/foundmill/pull/75), merged into this branch): the backend for the native app built with Newly. It adds device registration, push notifications through a OneSignal connector (real and mock) with a notifier in the api, per-person notification preferences, and sign-in by a six-digit email code. So two findings below are out of date: section 4.4 (sign-in is no longer only a link opened "in this browser") and section 10 (a channel to the person now exists, for push to the app; there is still no email to a user beyond sign-in, and nothing notifies about people). Package 5.1 builds on that notifier (`apps/api/src/services/push`) and adds email and the people kinds. The prompt pack in `docs/mobile` describes the product as it was before the thesis rules; bringing it in line is package 5.6.

## 0. Method and confidence

- **How it was produced.** Five parallel code audits (the people side, the agent runtime, the first run, the in-business surface, the agents' voice and content), plus a direct read of `docs/foundmill-plan/foundmill-plan.md`, `docs/ARCHITECTURE.md`, `docs/BUILD.md` §11.14 and §16, `docs/DEPLOY.md`, `packages/config` and the last month of `docs/PROGRESS.md`.
- **Nothing was run.** The container has no installed dependencies, so every statement about behavior is "as the code reads", not "as observed in a browser". Production settings are taken from `docs/DEPLOY.md`; the live Railway and Vercel variables were not inspected.
- **Verified a second time by hand:** the free plan's single seat and $5.00 of credits (`packages/config/src/pricing.ts:15`), `liveMode: false` (`packages/config/src/flags.ts:3`), the desktop wall on every route (`apps/web/app/layout.tsx:47`), `robots: { index: false }` (`apps/web/app/layout.tsx:18`), the disallowed tools of a live session (`apps/orchestrator/src/activities/sdk-isolation.ts:44`), the fabricated channel metrics (`apps/orchestrator/src/activities/channel.ts:229-241`), and the Nov 2 and 3 cycle results (`docs/PROGRESS.md:1372-1376`).
- **Marked "Inference"** wherever a conclusion goes beyond what a file states.
- **Line numbers** are as of the commit above and will drift.

## 1. The thesis as requirements

The thesis: as AI spreads through the economy, most people move from being employed to building something of their own. One person with a team of AI agents can do all of it; many, perhaps most, will still prefer to do it with someone, and that has to be effortless. Foundmill is where both happen. Stated as things the product can be tested against:

| # | Requirement | Test |
| --- | --- | --- |
| R0 | **Solo is complete.** One person with the agent team can build and run a business end to end, and feels able to. | No feature, limit, rating, note or metric depends on a second person; no copy says or implies someone is missing. |
| R1 | **The person comes first, the business second.** Someone with no idea, no company and no money is a full member from the first minute. | A new account can be seen, found and contacted, and can do something useful, before any business exists. |
| R2 | **Finding each other is one step away.** A founder who wants someone can discover people by what they can do, what they want and what they are building. It is offered, never pushed. | From a cold start, a person who looks for someone reaches a relevant human within one session; a person who does not is never asked twice. |
| R3 | **Joining is as easy as starting.** A person can ask to join a project, try working on it, and become a cofounder with a recorded share. | Request, trial, accept and split all exist as product objects, on the free plan. |
| R4 | **What a project makes can travel.** The things a project produces (a page, a milestone, an open role) travel outside the product and bring people back in. | An unauthenticated visitor can open a project's page and land in sign-up with the invitation intact. |
| R5 | **Agents produce something real, quickly.** In the first session a first-timer gets an outcome they can show another person, and in the first week one that reaches a customer. | A live URL in session one; a real email, post or payment link in week one. |
| R6 | **It speaks to a first-timer.** Young, no business experience, little money, anxious, probably on a phone. | First run works at 390 px; no step assumes a budget, a company, a network or a technical account. |
| R7 | **It teaches.** The product leaves the person more capable each week, whatever happens to the project. | A founder-owned task and one explained idea per day. |
| R8 | **The subtext is never the text.** Nothing says "do this instead of a job". The message is ownership and capability, with company as an offer. | No user-facing string names jobs, employment or careers as the reason. |
| R9 | **It is honest.** Existing rule, kept: non-real numbers are labeled, agents never claim an action that did not happen. | A mock result can never read as a real one. |

## 2. Verdict

Foundmill today is a careful, well-governed operating console for **one experienced founder running one company alone with AI staff**. Its own vision statement says so: "where one founder builds and runs a real business with a team of AI agents" (`docs/foundmill-plan/foundmill-plan.md:3`), and its design brief is "A broadcast control room at night, built for one founder" (`docs/DESIGN.md:7-11`). Measured against the thesis:

| Requirement | Today | Short reason |
| --- | --- | --- |
| R0 Solo is complete | **Partly** | The whole product is built for one person, which is right. What fails the solo founder is R5: the agents cannot yet produce real outcomes, so "you can do it all on your own" is not true in practice. |
| R1 Person first | **Absent** | A person is publicly visible only as the owner or admin of a committed, public business; the public card is a display name. |
| R2 Finding each other | **Absent** | Search is by exact-ish name over those cards. No browse, no skills, no "looking for". The whole layer is switched off by default. |
| R3 Joining | **Absent** | Membership is a silent add of an existing account by email or account ID. The free plan has one seat, and paid plans are not on sale. A free founder cannot add anyone. |
| R4 Travels outside | **Absent** | No public project page, no invite link, no referral, no email of any kind to a user except the sign-in link. The site tells search engines not to index it. |
| R5 Real outcomes | **Mostly absent** | The one real outside action an agent can take is committing code and opening a pull request on a repository the founder already owns. Nothing can be put on the internet. Email, payments, web research and channel results are mock in production. |
| R6 First-timer | **Partly** | Plain-language work is strong. But every route, sign-in included, is blocked under 1280 px, sign-up is closed to a list, and the content assumes budgets, a bank account and a network. |
| R7 Teaches | **Partly** | Terms are defined and pages explained. Nothing teaches business, and the founder's only job is to approve. |
| R8 Subtext | **Nearly clean** | Three strings name a "day job". Nothing else mentions employment. |
| R9 Honest | **At risk** | Labels are good, but a live agent that calls a mock tool gets a success back and will report an email as sent. |

**What is worth keeping.** This is a rebuild of the product's center, not of its foundations. The parts that hold:

- The governance core: the gateway, Cedar policy, hard gates, audit chain, quarantined reader, row-level security with cross-tenant tests. A network of strangers building together needs exactly this.
- Connections, direct and group messages, communities with moderation: built, persisted and tested in `apps/api/src/routers/live.ts`, waiting behind a flag.
- Memberships with roles and per-section permissions, per-person read receipts, approvals routed to a named person, live co-editing of the specification.
- The plain-language system (`packages/shared/src/terms.ts`, the three CI linters), the Composer's note format, "Use my idea as written", the honest "nothing happens without you" assurances. For an anxious reader these are the strongest assets in the product.
- The connector contract with real and mock versions, the GitHub loop, the usage ledger and credits gate.

**What has to change at the root.**

1. Agents get a short list of real outside actions and lose the long list of pretend ones. This is what makes "you can do it on your own" true, and it comes first.
2. A project gets a public face, and that face is also the first real agent outcome.
3. Identity moves from business-centric to person-centric.
4. "Start something" stays the main door; "find people or a project" sits beside it, equally easy and never required.
5. "Staff" and "seats" become cofounders and collaborators, free.
6. The product reaches a phone.
7. The voice moves from a control room to a peer who knows more than you and is on your side.

## 3. Positioning and identity

**3.1 The written strategy describes a different product.** `docs/foundmill-plan/foundmill-plan.md` (also the seed of Foundmill's own business inside Foundmill):

- "For whom: solo and very small founding teams who are time-constrained" (line 5). The new user has time and lacks direction, money and company.
- The customers section starts with "Founders who can describe what they want to build, have a little budget" (line 37).
- The north star is "Weekly approved agent outcomes per active business" (line 18). It measures supervision throughput and says nothing about people.
- The social layer is one paragraph, listed after six departments, and scheduled under "Later" as "LIVE layer opened to the first founders" (lines 80-81, 413-417).
- Go-to-market is a build log, a waitlist and paid acquisition (lines 226-237). No loop in which a user brings a user.

**3.2 The build plan puts people last.** `docs/BUILD.md` §16 orders the work: foundations, core loop "(Personal mode)", build and sell, full team, then "Phase 4 — LIVE", then launch. The thesis inverts that order.

**3.3 The model of social is "businesses showing off".** BUILD §11.14 specifies profiles, connections, communities, leaderboards with divisions, promotion and relegation, and B2B negotiation between agents. That is a league of companies. It contains no cofounder search, no joining and no open roles.

**3.4 The management-game grammar is still the frame.** `docs/UX_AUDIT_AND_PLAN.md` §1 records the decision "The management-sim grammar stays". Visible today:

- A "game mode" per business: `GAME_MODES = ["live", "personal"]` (`packages/shared/src/constants.ts:9`), shown as "Personal or live" (`apps/web/components/settings/PersonalOrLiveSection.tsx:45-56`). "Personal" is the default and means private and alone.
- Agents carry a five-result "Form" strip and a rating out of 20 (`packages/dugout/src/components/agents/SquadCells.tsx:268`), "Agent of the week", "Hire", "Let go", "Lend to another department", a "wage cap" and a "line manager".
- URL slugs a user sees: `/d/team/squad`, `/d/distribution/formation`, `/d/development/training-ground`, `/d/finance/wage-bill`.
- `package.json:5` still describes "a squad of AI agents".

A management game is a fantasy of being the boss of many. The thesis is about being one of a few.

**3.5 Consequence for this document.** The plan, the build order, DESIGN §1 and the north star all need rewriting after the decisions in section 14. Until then they contradict the thesis, and every agent session that reads them (they are a source of Foundmill's own business) inherits the old aim.

## 4. Reach: device, access, cost

**4.1 A phone visitor sees a wall.** `apps/web/app/layout.tsx:47` wraps every route in `DesktopOnly`; under 1280 px the only thing rendered is "This needs a larger window" with "Current width: 390 px" (`packages/dugout/src/components/shell/NeedsLargerWindow.tsx:31-37`). That includes the landing page and sign-in. The wall has no email capture and no "send me the link". CLAUDE.md says "Never build mobile layouts. Desktop only (>= 1280 px)". Inference: most 13-inch laptops at default scaling are below 1280 CSS pixels too. For this user, and for any link passed between friends in a chat app, this single rule ends the loop before it starts.

**4.2 The site is invisible and unshareable.** `robots: { index: false, follow: false }` (`apps/web/app/layout.tsx:18`); one static site-wide share image; no page-specific titles or images.

**4.3 Sign-up is closed.** While models are live the api admits only addresses on `SIGNUP_ALLOWLIST` (`apps/api/src/trpc.ts:282`, `docs/DEPLOY.md:120`). A stranger reads "There is no account for this address, and new sign-ups are closed for now." (`apps/web/lib/auth/sign-in-errors.ts:95`). There is no waitlist and so no place to hold demand or credit a referrer.

**4.4 One sign-in method.** Email link only, and the link must be opened "in this browser" (`apps/web/app/login/LoginForm.tsx:57-103`). No Google, Apple or phone sign-in.

**4.5 Money.**

- Free: one seat, four agents at once, $5.00 of credits a month for one business (`packages/config/src/pricing.ts:15`).
- Ideation, the foundations and cycle planning run on Opus, and a task reserves up to $20 (`apps/orchestrator/src/cycle-contract.ts:66`). Inference: $5 is used up in the first day or two of real work, after which the top bar reads that the team is paused.
- The ways out are a top-up of $25 to $250 (`apps/web/components/settings/BillingTab.tsx:44`), which needs `stripe_billing` live and is not in the documented live connectors, or pasting an Anthropic key (`apps/web/components/settings/KeysTab.tsx:24-57`), which this user cannot be expected to do. Pro and Scale read "Not on sale yet" (`BillingTab.tsx:251`).
- So the person with the least money meets the earliest wall, and one of the walls (seats) has no purchasable exit at all.

**4.6 Language and place.** US English only, enforced in CI, with no translation layer. Supervised incorporation exists for Delaware and the UK only (`packages/agents/src/templates/leads/legal_lead.ts:30`). Bank data means Tink or Plaid. A global shift in how people work will not be mostly American; this is a later constraint, noted so the rebuild does not deepen it.

## 5. First run

The path today: landing → sign-in → "Before you start" profile → "Your first business" doors → Ideation Studio → optional Compare → Commit → Today.

**5.1 Landing.** The promise is solitary command: "Foundmill hires, trains and runs a team of AI agents across product, development, distribution, finance, legal and hiring. You set the direction and make the calls only a founder should make." (`apps/web/components/landing/Hero.tsx:53`). Supporting lines: "First company or fifth, the team comes with it" (`Hero.tsx:47`); "A whole company, in parallel… one plan, one budget" (`Thesis.tsx:13-15`); "Agents open real pull requests on your GitHub, send email from your own accounts and reconcile your Stripe and bank data." (`Thesis.tsx:18-20`); "Hire them. Train them. Watch them get better." (`TeamSection.tsx:50`); "within your runway" (`LiveSessions.tsx:91-93`); "Bring your own Anthropic key" (`Control.tsx:28`). One line reaches for the new user, near the bottom: "Never started a company? You do not need to know how to incorporate, price, run ads or keep books…" (`Control.tsx:147-158`). No other human appears anywhere on the page. Two of the claims (email from your accounts, Stripe and bank reconciliation) are not true in production today (section 7).

**5.2 Profile** (`apps/web/components/onboarding/OnboardingScreen.tsx`, `profile-form.ts`).

- Asked: a name, experience (First-time founder / Exited founder / Operator / Domain expert), time available, residence and citizenship. Optional: five skills self-rated 1 to 20 in operator terms ("Finance: Cash, pricing, forecasts, fundraising"), "Budget you can commit… A number like 25,000 or 25k", currency, target markets ("EU, UK, US, Nordics, DACH, Benelux"), constraints ("Bootstrapped, no outside funding", "B2B only", "Keep my day job for now"), risk appetite.
- Never asked: where the person is in life, whether they have an idea, whether they want a cofounder or want to join someone, what they would like to learn, what they want out of this.
- The skills are collected "so the team hires to cover what you don't have": a gap is always filled by an agent, never by a person.
- The side rail promises "Your profile is private… never shown on the network" (`OnboardingScreen.tsx:339-340`). The one field that points at another person is a collapsed "For a co-founder joining you" holding a 36-character account ID (`:352-355`).

**5.3 Doors** (`apps/web/components/new/Doors.tsx`). "I have an idea, or none yet", "I already run something" (import from GitHub, Notion, Stripe, a bank, the company registry), and "Explore an example: Walk around a business two years in, with paying customers and a team at full stretch." There is no door for joining something or finding someone, and the example is as far from day one as it could be.

**5.4 Ideation** (`apps/web/components/new/ideate/IdeationStudio.tsx`, `packages/agents/src/prompts/ideation.ts`).

- Good: "Use my idea as written" keeps the founder's own words; the profile's budget is a hard limit; "I have no budget yet" exists; the prompt asks for something that "could start this month" and a first paying customer within 90 days.
- Misses: the prompt is "What should exist that does not yet?" under the heading "Brief for the Ideation agent"; each card carries ten analyst scores out of 20 (Market pull, Market size, Competition, Speed to first customer, Capital intensity, Agent-executability, Founder fit, Defensibility, Regulatory load, Distribution clarity); the steering chips are "Cheaper to start", "B2B instead", "More defensible".
- For the thesis: no output says "this is better with a partner" or "you would need someone who can do X". "Founder fit" is one person's skills, and the stated frame is a business "a team of AI agents can run for this founder" (`packages/agents/src/ideation.ts:55`).

**5.5 Commit** (`apps/web/components/new/commit/CommitScreen.tsx`). Title "Commit to {name}", button "Take charge". With everything expanded a first-timer faces: name, a domain and trademark check, a logo, two brand colors, Personal or Live (Live needs "I am 18 or older" and currently reads "Live is not open yet"), one of seven kinds of business ("DTC physical product", "B2B SaaS"), one of three modes (Augmented / Assisted / Automated), a spend cap per action, Autopilot, and "Anthropomorphic agents" with a style. Guidance collapses most of it, which helps, but the vocabulary is still met.

**5.6 Count.** About 9 decisions on the shortest path and about 30 on the full one before anything happens, and roughly 40 terms of art (cycle, credits, concept card, archetype, specification, roadmap, sign off, hard gate, autopilot, runway, pull request, repository, Estimate, Anthropic key, and so on).

**5.7 What the first session produces.** Two documents to approve, a specification and a roadmap. The first-week checklist is: Sign off the specification; Sign off the roadmap; Run a cycle; Read a note from an agent; Talk to an agent; Start distribution; Connect a bank or Stripe (`packages/dugout/src/components/firstrun/FirstWeekChecklist.tsx:32-38`). The first built thing is planned for days 2 to 3 (Estimate), and without a GitHub account the screen reads "Nothing exists outside these screens yet." (`packages/modules/src/development/shared.tsx:281`). Nothing from session one can be shown to a friend, and no human is involved at any point.

**5.8 What earlier audits assumed.** `docs/UX_AUDIT_AND_PLAN.md` (Oct 20) and the "Maya's First Day" report (Nov 8) made the existing tool comprehensible to a first-time founder who already has an idea, a laptop, some money and a wish to run a company alone. Their fixes stand and are not repeated here. Their non-goals ("no mobile", "It does not mean fewer screens, fewer numbers, or bigger buttons") are the ones this review reopens.

## 6. Inside a business

**6.1 Size.** Sidebar: Today, Needs you, Plan, Customers, Money, Product, Team, Network, Settings (`apps/web/lib/sidebar.ts:104-133`). Behind it sit 39 area tabs, 6 Inbox tabs, 10 Settings tabs, a 6-tab agent profile and a 7-tab contact profile: about 71 surfaces. The audit rates about 14 as worth a first-timer's week-one attention.

| Area | Tabs | Needed in week one | Useful later | Intimidating or irrelevant |
| --- | --- | --- | --- | --- |
| Plan | 2 | 1 | 1 | 0 |
| Customers | 7 | 3 | 3 | 1 |
| Money and Company | 13 | 0 | 7 | 6 |
| Product | 11 | 4 | 5 | 2 |
| Team | 6 | 2 | 1 | 3 |

Money has thirteen tabs and none is needed in week one. Its default four are Overview, Runway, Company and Compliance.

**6.2 What a new business actually shows.** Real on day one: the vision, specification and roadmap, the agent roster, the sign-off notes, the Today timeline. Empty until distribution starts: Leads, Campaigns, Creative, Attribution, Contacts, Milestones. Empty until a bank or Stripe is connected: all of Finance. Empty until incorporation: Company, Compliance, Cap table. Eleven screens are dead ends in week one.

**6.3 The founder's role is to approve.** The loop is note → decide → Continue → agents work → note. To hold it in mind a first-timer needs about twenty concepts: cycle, Continue, note, decision versus go-ahead, sign-off, the three levels of how much the team does alone, the spend line, a per-agent limit, a wage cap, credits versus own key, Estimate versus Forecast, Stop all agents, Autopilot, vacation, Chief of Staff, lead versus specialist, Builder view, Personal versus Live, the Board, the goal. When nothing waits, Today says "Nothing needs you right now. The team keeps working." (`packages/shared/src/empty-why.ts:52`). There is never a task that belongs to the founder: talk to five people, post this, call this person.

The founder's own recorded verdict after the first full live round was "way too complex; I just want it to work" (`docs/PROGRESS.md:1376`).

**6.4 Money is company finance.** Cash, gross and net burn, runway, MRR and ARR, gross margin, payback (`packages/modules/src/finance/metrics.ts:131-140`). Nothing answers "what have I earned" or "how far am I from my first dollar". Milestones are 1st, 10th, 100th and 1,000th customer, first 1K, 10K and 100K MRR, and "First enterprise contract" (`packages/journey/src/trophies.ts:55-64`). Sharing one copies a line of text, and only for a Live business (`apps/web/components/milestones/MilestonesScreen.tsx:136-170`).

**6.5 Learning.** There is a good layer for learning the tool: term definitions, "Explain this page", three tours, the first-week timeline, the Chief of Staff's three canned answers. There is nothing for learning to run a business, and no sense of the founder's own progress. "Training" means training agents.

**6.6 A second human is "staff".** Roles are owner, admin, member, viewer, advisor (`packages/shared/src/constants.ts:167-176`), each with eleven section permissions. A second person can answer Inbox decisions (attributed), co-edit the specification, and be made the approver for seven kinds of decision. They are listed under "Staff" behind "More detail", rendered as "Member on the team · Account 3f2a91c0…" with no name (`apps/web/components/settings/MembersTab.tsx:82-97`). Humans cannot message each other inside a business, comment on anything, hold a task, or see each other's presence outside the specification editor.

## 7. What the agents can actually do

The founder's statement that the agents do not work is accurate, and the causes are specific.

**7.1 The execution path.**

- **Mock sandbox:** every session is a replay of one of seven recordings about the two demo businesses, chosen by a hash of the task id (`packages/sandbox/src/mock/recordings/`, `apps/orchestrator/src/activities/session.ts:203-211`). A new founder's "build my landing page" task plays back something like a webhook-retry fix for Ledgerly and ends "done".
- **Without Temporal:** Continue starts no agent sessions at all (`apps/api/src/services/cycle.ts:524`).
- **Live:** the session really runs the Claude Agent SDK (`session.ts:1708`), on the orchestrator host in a per-session directory. E2B is used only for a code task's acceptance run.
- **Live agents have no shell, no browser and no web tools.** Bash, WebFetch, WebSearch and sub-agents are disallowed for every task (`apps/orchestrator/src/activities/sdk-isolation.ts:44`). Code tasks get file tools; every other kind of task gets gateway tools only.
- **Work that is not code leaves no artifact.** Its whole deliverable is a completion summary of at most 4,000 characters (`packages/connectors/src/connectors/platform/tools.ts:98`); the capability to write a document is not served.

**7.2 Most of what agents are granted does not exist.** There are 47 templates (1 Chief of Staff, 6 leads, 8 specialists, 12 workers, 15 channel engines, 5 utilities). `packages/connectors/src/grants.ts` resolves their grants:

- About **66 connectors** named in grants have no implementation: every ad platform, every social publisher, the lead-data vendors, analytics, hosting, direct mail, PR wires, affiliates, events.
- **37 platform capabilities** are granted and served by no tool (`grants.ts:208-216`): creating or pausing a campaign, creating an asset, creating a contact, writing a document, enabling a channel or setting its budget, publishing the specification, updating the roadmap, categorizing a transaction, preparing an incorporation, generating a policy.

So a Social channel agent holds no publishing tool, a Paid ads agent no ad tool, the Product Lead cannot publish the specification it wrote, and the Distribution Strategist can read and nothing else.

**7.3 Production runs on mock integrations.** Documented production: `INTEGRATIONS_MODE=mock`, models live on three services, `LIVE_CONNECTORS=github,domains` (`docs/DEPLOY.md`).

- Agent web search returns `https://example.com/<slug>/1 "(result 1, mock)"` and page fetches are fabricated (`packages/connectors/src/connectors/web/mock.ts:8-40`). Research agents on a live model reason over invented pages.
- With no integration connected the gateway runs the mock and returns success (`apps/gateway/src/pipeline.ts:677`). `send_mail` returns a message id (`sendgrid/mock.ts:75`). Inference: a live agent then tells the founder the email went out. This breaks R9.
- Connecting an integration in Settings stores a row with status `mock` (`apps/api/src/routers/integrations.ts:97`).

**7.4 By department.**

| Department | Honest state |
| --- | --- |
| Product | Real model output: vision, specification, roadmap, research plans. Agents can propose changes; they cannot publish. |
| Development | The most real. Checkout, commit, CI, pull request, founder-approved merge, on a repository the founder already has. No deploy, no previews: nothing in production code writes `deploy.succeeded`, so Environments is always empty for a real business. |
| Distribution | Simulated end to end. "Launch" sets a status and emits an event (`apps/orchestrator/src/activities/channel.ts:198-221`). In mock mode "measure" invents impressions, leads, signups, customers and spend at 90% of budget from a hash (`channel.ts:229-239`); in live mode it does nothing (`:241`). Only the creative text is a real model call. |
| Finance | Empty for a real business; bank and payment connectors are mock. The demo's numbers are seeded. |
| Legal | Registry lookups are mock in production. Incorporation prepares a pack the founder submits, by design. |
| Team | Training runs the real model against mock tools in the mock sandbox. |

**7.5 Capability matrix.**

| Outcome a founder wants | Today |
| --- | --- |
| Idea, plan and specification text | Real |
| Code committed and a pull request opened | Real, on an existing repository with the GitHub App installed; proven only on Foundmill's own |
| Tests run on agent code | Real |
| A page on the internet | Absent |
| An email sent | Mock only |
| A social post published | Absent |
| A payment taken or a payment link | Mock only |
| A waitlist or form | Absent |
| A domain registered | Absent (availability check is real) |
| Web research | Mock only |
| Leads and contacts | Fabricated in mock; nothing in live |
| Channel results | Fabricated in mock; nothing in live |
| Bank and revenue data | Mock or seeded |
| Ads | Absent |

**7.6 The one live loop is fragile.** On Foundmill's own business: cycles 35 and 36 ran 25 sessions with 2 done and 23 blocked; cycle 37 ran 12 with 3 done and 9 blocked (`docs/PROGRESS.md:1372-1376`). The causes were plumbing (stale branches, a merge refused seconds early, tasks no agent had a tool for), each fixed one at a time.

**7.7 Nothing checks that agents achieve outcomes.** The evals are single-prompt, graded text; all skip without a live key; none runs in CI; none is an end-to-end session with tools. `docs/GATES.md:104-110` records the live smoke as never run and Gate 1 as not passed.

**7.8 The pattern behind it.** The build went wide before it went deep: 47 templates, 15 channels, 6 departments, about 90 named connectors, each with a screen, and one thin real path. For the new user the right shape is the opposite: three or four outcomes that are real every time, and nothing on screen that is pretend.

**7.9 Open security items that gate real actions.** `docs/SECURITY_REVIEW.md` items without a recorded fix: SEC-8 (database write policies wider than the api's roles), SEC-9 (`APP_ENV` defaults open), SEC-10 and SEC-11 (webhook to business binding, which matters the moment email or payment webhooks go live), SEC-14 (the api calling connectors without the gateway), SEC-16 (server-side request forgery guard), SEC-17 (no revocation of session tokens), SEC-19 (per-business policies never loaded). Not re-verified in code for this review.

## 8. What the agents say and assume

**8.1 Stance.** Agents are staff reporting to a boss. "I'm your Chief of Staff. I run the team so you only read and decide." (`packages/agents/src/prompts/club-rules.ts:67`). "you run the cycle so the founder only has to read the Inbox and decide" (`packages/agents/src/templates/chief_of_staff.ts:21`). Tone rules: "Calm, direct, specific… Never hype" (`:50`); "Terse and technical… No cheerleading" (`leads/engineering_lead.ts:40`). The eight voice registers (`packages/agents/src/voice.ts:15-52`) include none that encourages or teaches. The `coach` prompt coaches agents.

**8.2 What agents know about the person.** Almost nothing. The profile reaches ideation, a single `founder_experience` value reaches the Composer (taken from the longest-standing owner, `packages/db/src/repos/founders.ts:109-122`), and citizenship reaches the jurisdiction prompt. The per-cycle brief and the conversation prompt carry no founder data, not even a name. No field holds a personal goal: an income target, hours, something to learn, a reason for starting.

**8.3 The money they assume.** An approval line of €250 (`packages/config/src/limits.ts:16`); default department budgets of about €2,750 a month (`packages/agents/src/archetypes.ts:79-87`); a recommended first decision costing €500 (`:229`); the zero-cost alternative is "Three design partners from the founder's network" (`:256`). Template examples: "spend up to €500 on LinkedIn ads targeting fintech CFOs", "€3,000/month budget, 14 months of cash left", "raising from US angels within 12 months". Not traced: whether the defaults scale down to a profile with no budget.

**8.4 The Composer is the best-fitting piece.** Its rules suit a novice: stake, what happened, the ask; at most three short sentences; define a term in the sentence that uses it; never pass a chore to the founder (`packages/agents/src/prompts/inbox-composer.ts:52-69`). Keep it and extend it.

**8.5 The examples alienate.** The demo founder is an operator with £60,000 (`packages/db/src/seed/index.ts:144-147`). Northwind opens on a £60,000 director loan, minimum orders of 2,000 units and a £37,200 irreversible purchase decision. Ledgerly has two SAFEs at £6.0m and £11.0m caps, an option pool, angel investors and a salaried engineer. Its cofounder, Priya, exists only as a contact record and a line in the cap table (`packages/db/src/seed/ledgerly.ts:158-177`): the product's single depiction of a cofounder is a row of shares.

**8.6 More than one human.** Prompts say "the founder", singular and unnamed, everywhere. `inbox_items` has no recipient (`packages/db/src/schema/inbox.ts:13-33`). A cofounder reads notes pitched at the first owner's experience level and addressed to nobody.

**8.7 The subtext rule.** Strings that name employment: "Keep my day job for now" (`apps/web/components/onboarding/profile-form.ts:51`, and in the example profile at `:550`), "…or 'keep my day job'" (`OnboardingScreen.tsx:660`), the same chip in a Storybook story, and the Operator option's "inside someone else's company" (`profile-form.ts:29`, repeated to the model at `inbox-composer.ts:55`). Nothing mentions layoffs, careers or quitting. Lines that already carry the intended feeling: "Start your business", "Make it yours", "You stay in charge". None is about doing it with someone.

## 9. The people side

**9.1 What is built.** In `apps/api/src/routers/live.ts`, persisted in `packages/db/src/schema/social.ts`, covered by `apps/api/src/__tests__/live-social.test.ts`, with real screens under `apps/web/app/(live)/` (about 2,700 lines):

| Piece | State |
| --- | --- |
| Connections (request, accept, remove, block) | Works |
| Direct and group messages (connections only, up to 20 people) | Works |
| Communities (create, join, invite, posts, moderation queue, mute, ban, roles) | Works |
| Post screening (rules plus a model, fails closed; three reports hold a post) | Works |
| 18 or older self-attestation | Works |
| People search | Name only |
| Profile card | A display name; for a business: name, kind, colors, region, since |
| Leaderboards | Read-only; rows are written only by the demo seed |
| Agent-to-agent negotiation | Table only; the api refuses to enable it |
| `apps/social` service | One read route; everything else answers 501 |

**9.2 Why it cannot carry the thesis.**

1. **Switched off.** `FLAGS.liveMode = false`; every `live.*` procedure is refused unless `LIVE_MODE=1`. Inference: production is off.
2. **Identity derives from a business.** The `public_profiles` view admits a person only when their visibility is public and they are owner or admin of a committed, non-archived, Live business (`packages/db/migrations/0044_home_api_data.sql:53-64`). Someone who has not started anything, or who joined as a member, cannot be seen.
3. **Reaching out requires a Live business.** `connections.request` needs write access to the Live section of a Live business (`live.ts:164-167`).
4. **The web gate.** The `(live)` layout sends anyone without a business to `/new` (`apps/web/app/(live)/layout.tsx:44-65`).
5. **Nothing to match on.** Experience, skills and time are stored in `founder_profiles` and are private inputs to agents. There is no bio, picture, link, "looking for", or availability.
6. **A project has nothing to show.** No description, stage, need or open role is public.
7. **No way in.** Adding a person needs their sign-in email or account ID; they are added at once, without being asked or told; "No invitation email is sent" (`MembersTab.tsx:114`, `apps/api/src/routers/team.ts:267-285`). There is no invitation object, link, expiry, request to join, or trial.
8. **One free seat.** `seats: 1`, and the owner counts (`packages/db/src/tiers.ts:98-108`).
9. **No cofounder.** One person is "the founder" (creator or oldest owner, `packages/db/src/repos/memberships.ts:49-60`); the rest are staff. The cap table records holders as contact records with a free-form vesting field (`packages/db/src/schema/finance.ts:101-136`), unconnected to memberships. Contract kinds are NDA, DPA, SAFE, MSA, SOW and IP assignment; there is no founders' agreement.
10. **No signal leaves the app.** A connection request raises a badge on an open tab. No email, no push.
11. **Safety is community-scoped.** A post can be reported; a person, a profile or a direct message cannot. There is no platform-level queue. The moderation rule that holds posts containing an email or phone number (`packages/agents/src/community-screen.ts:27-34`) is right for a feed and needs a sanctioned alternative when the purpose is meeting people.
12. **The demo network is empty.** Two communities, three posts by the demo owner, two leaderboards with one row each; no other founders.

**9.3 Viral mechanics.** Invite links, referral credit, public project pages, per-page share images, shareable milestone cards with a URL, a public build log, open sign-up, a digest email: all absent.

## 10. Coming back

There is no channel from the product to the person. The only email a user ever receives is the sign-in link. There is no digest, no "your team shipped", no "someone wants to build with you", no push, no notification preferences, and no schedule that writes one (`apps/orchestrator/src/schedules.ts:36-48`). The Chief of Staff's rule to "wake the founder" has nothing behind it. Every loop in section 12 depends on fixing this first.

## 11. Engineering observations that shape the roadmap

- **Where the code is.** About 400,000 lines of TypeScript. The people side is 534 lines in `apps/social` plus one router; the solo console is nearly everything else. Inference: the proportion is roughly the inverse of what the thesis needs.
- **Stale documents.** The plan says the free tier is bring-your-own-key (line 157), while the code gives credits. It says code sessions start from an empty workspace (line 245), while sessions now check out the repository. It lists migrations through 0066; the repository is at 0074. `apps/social/src/app.ts` calls itself a Phase 4 skeleton while the real backend lives in the api.
- **Two homes for the people side.** Decide once: the api keeps the tRPC surface, and `apps/social` becomes the home of the unauthenticated public reads and the matching jobs, or is removed.
- **Rules that help.** Design-system-only UI, events through the outbox, vendors only through the gateway, real and mock for every connector, cross-tenant tests: all carry over unchanged and make the rebuild safer.
- **Rules that block.** "Never build mobile layouts", the "one founder" design brief, and the vocabulary table's silence on people (it legislates Team for agents and Staff for humans).

## 12. The target

**12.1 The product in one paragraph.** Foundmill is where you build something of your own, and a team of AI agents does the work you cannot do yet. You can do all of it alone, and the product treats that as the normal case. You arrive as a person. You say what you are good at and what you want; you start a project in a sentence. Within the first session it has a public page you can send to anyone. If you would like someone to build it with, they are one step away at every point: open a role, invite a friend, or join a project that fits you. Nothing waits on that choice.

**12.2 The loops.** The first is the product; the second is an offer inside it and the way the product spreads.

```
The solo loop (complete on its own)
arrive
  → say who you are and what you want            person profile
  → start a project in a sentence                the main door
  → agents make the project page and first asset   first real outcome, a link
  → a real outcome every week: research, a page, an email, a post, a payment link
  → first customer, first dollar; milestone cards go out

The together loop (optional at every step, never asked twice)
  from any point above: open a role, invite someone, or join a project
  → someone visits a page or card, signs up, asks to join     the invite survives sign-up
  → try it together for two weeks                             trial collaboration
  → become cofounders, with a recorded split
  → each page, card and invitation brings the next person
```

A founder who never touches the second loop loses nothing: the same agents, the same outcomes, the same milestones, no empty "People" panel asking to be filled.

**12.3 Objects that have to exist.**

| Object | Purpose | Starts from |
| --- | --- | --- |
| **Person profile** (public by choice, independent of any business) | R1, R2 | `founder_profiles`, widened: headline, about, picture, links, strengths as tags, wants to learn, looking for (start / join / either), hours, place and time zone, per-field visibility |
| **Project** (the user-facing word for an early business; "business" once it sells) | R1, R4 | `businesses`, with a public face: one-line pitch, stage, what exists, who is in it |
| **Project page** (unauthenticated, indexable, with its own share image) | R4, R5 | New public route; content drafted by agents, approved by a human |
| **Open role** ("needs someone who can…", hours, what is offered) | R2, R3 | New table, business-scoped, public when the project is |
| **Invitation** (link and email, token, expiry, role, inviter) | R3, R4 | New table; replaces the silent add |
| **Join request** (person → project, with a note) | R3 | New table; lands in the project's Needs you list |
| **Trial** (time-boxed collaborator membership) | R3 | `memberships` gains `expires_at` and a `collaborator` role |
| **Cofounder** (a membership kind, equal standing, several per project) | R3 | `memberships.role` gains `cofounder`; "the founder" becomes "the founders" |
| **Ownership split** (proposed, discussed, agreed by each person; vesting in plain words) | R3 | New proposal object linked to memberships; feeds the cap table later; signing stays a hard gate |
| **Referral** (who brought whom, through which page) | R4 | Attribution on invitation and sign-up |
| **Notification** (email first; in-app; preferences) | Everything | New platform sender through the gateway, separate from business email |
| **Founder task** (work only a human can do) | R7 | `tasks` with a human assignee, surfaced on Today |

**12.4 Surfaces.**

- **Public:** landing; project pages; person pages; an open-roles browse; milestone cards. All usable at 390 px.
- **Signed in, no project:** Home for a person: people and projects that fit, requests, messages, a short "start here".
- **Inside a project:** Today (what the team did, what needs a decision, your own task for today, who is here), People (founders, collaborators, open roles, requests), the work (plan, product, customers), Money as earnings first.
- **Everything else** in the current console stays reachable under Builder view and appears on its own when its data exists.

**12.5 Agents in the new shape.**

- Agents cover every gap by default. A solo founder is never told a person is needed; where a person could help, that is one optional line beside the agent's plan, shown once.
- A short, real set of outcomes: a project page live at a Foundmill address; real web research; an email sent from a platform-provided address; a waitlist form; a payment link; one social publisher.
- Agents that serve the people side: a matcher (suggests people and projects, explains why), an introducer (drafts the first message, a human sends it), a role writer (turns a gap into an open role), a split helper (explains common splits and vesting; never recommends terms as legal advice; never signs).
- The Chief of Staff as mentor: knows the founder's name and goals (and each person's, when there are several); gives a task; explains one idea a day.

**12.6 Voice.**

| | Today | Target |
| --- | --- | --- |
| Stance | Staff to a boss who "only reads and decides" | Someone a few years ahead of you, on your side |
| Addressee | "the founder" | The person by name; the group by name when there is one. One person is never addressed as if someone were absent |
| Warmth | "Never hype", "Understood." | Still calm and exact; marks a first; treats a setback as normal |
| Money | €250 lines, €500 first moves | Free first; any cost set against a small budget |
| Gaps | An agent covers it | An agent covers it, and says so with confidence. "You could also bring someone in for X" is an optional line, shown once, never a condition |
| Goals | Business metrics | Also the person's: first income, hours, what they learned |
| Subtext | Not considered | Ownership and capability; company as an offer. Never jobs, employment, careers, or fear of AI as the reason |
| Solo | Assumed, and lonely | Assumed, and capable: "you can do this" is the default register |

Subtext, worked: say "something that is yours", "what you can do now that you could not last month", and, as an offer, "people to build it with, if you want them". Do not say "instead of a job", "job-proof", "be your own boss", "escape the 9 to 5", "before AI takes it". The reader brings the worry; the product answers it without naming it. Solo, worked: never "find a cofounder to get started", "better with a partner", "you are missing a designer", or a profile or project meter that fills up when a person joins.

## 13. Roadmap

Seven phases. Each work package lists what to build, where, and what done means. Every package also carries the standing definition of done from CLAUDE.md (typecheck, lint, unit tests, Playwright for a touched screen, a story for a new component, an eval for new agent behavior, cross-tenant tests for a new table, PROGRESS updated). Phases 1 and 2 can overlap; phase 3 depends on 1; phase 4 on 3.

### Phase 0: Decide and tell the truth

Goal: the rules, the plan and the product stop contradicting the thesis and stop reporting pretend results.

Status, Nov 11, 2026: 0.1 done for the six answered decisions; 0.2 done (the plan is rewritten; re-importing it into Foundmill's own business is the founder's step); 0.3 done except the eval (1.8); 0.4 done; 0.6 done; people are free (3.2) done early. Leaderboards removed. 0.5 done (the Channel Board, "not connected", and templates granted only tools that exist). 0.7: N1, SEC-10, SEC-11, SEC-14 and SEC-16 fixed and SEC-9 narrowed (SECURITY_REVIEW "Re-check and fixes"); the items designed with email and Stripe (N2, N3) and a separate api token secret (N4) remain.

- **0.1 Founder decisions.** Get answers to section 14. Record them in `docs/DECISIONS.md`; update CLAUDE.md (vocabulary for people, the mobile rule, the subtext rule).
  Done when: each decision has a dated entry and CLAUDE.md matches.
- **0.2 Rewrite the plan.** `docs/foundmill-plan/foundmill-plan.md`: vision, for whom, principles (add "people first" and "built together"), north star, the roadmap sections; fix the stale facts in section 11 of this review. Re-import it as Foundmill's own plan.
  Done when: no sentence in the plan says "one founder" as the product's subject.
- **0.3 A mock result can never read as real.** Every mock tool result carries `simulated: true`; the gateway adds it to the wrapper; the house rules gain "a simulated result is not an action: say it was not done"; the Composer refuses to narrate a simulated send as sent. Where no integration is connected in a non-test environment, return `not_connected`, not a mock success.
  Touches: `apps/gateway/src/pipeline.ts`, `packages/connectors/src/mock-utils.ts`, `packages/agents/src/prompts/club-rules.ts`, `inbox-composer.ts`.
  Done when: an eval shows a live agent given a mock `send_mail` reports that nothing was sent.
- **0.4 Stop fabricating channel results for real businesses.** Hash-generated metrics and `.example` leads only for demo businesses and tests.
  Touches: `apps/orchestrator/src/activities/channel.ts`.
  Done when: a non-demo business in production has no row with invented impressions or leads.
- **0.5 Remove grants nothing serves.** Templates list only tools that resolve; the Channel Board shows only channels that can really act, and the rest are listed as "not available yet" in Builder view (founder, Nov 11, 2026).
  Touches: `packages/agents/src/templates/**`, `packages/connectors/src/grants.ts`, the grants contract test.
  Done when: `NOT_YET_SERVED` is empty for every template a new business is given.
- **0.6 Subtext check.** Remove the "day job" strings; add a subtext list to `scripts/banned-terms.mjs` (job, employment, career, 9 to 5, laid off, as reasons) covering UI strings, prompts, seeds and mock outputs.
  Done when: the script fails on a planted string and passes on main.
- **0.7 Security prerequisites.** Close SEC-9, SEC-10, SEC-11, SEC-14 and SEC-16 before any connector in phase 1 goes live; use the security-reviewer agent on each change.

### Phase 1: A real first outcome that travels

Status, Nov 11, 2026: 1.1, 1.2 and 1.3 done (public project pages at `/p/<slug>`, drafted by the team first, the first note and the first checklist item). 1.5 first part done (the Foundmill sending address; off until its DNS and SendGrid setup, docs/DEPLOY.md §5.7). 1.6 first part done (a Follow form with double opt-in). Email from Foundmill to a person started ("a decision is waiting", package 5.1). Next: 1.4 (web research live, a configuration step) and the payment link (the rest of 1.6); phase 2 (small screens, the person profile) can start in parallel.

Goal: R5 and the first half of R4. In the first session a project has a live page with its own address, made by agents, that a person can send to a friend.

- **1.1 Project pages.** Public, unauthenticated, indexable route (`/p/<slug>`), rendered from approved content: name, one-line pitch, what it is, who is building it, stage, a "follow" or waitlist form, and (after phase 2) open roles. Per-page title and share image. Works at 390 px.
  Touches: `apps/web/app/` (new public segment outside `DesktopOnly`), `packages/db` (page content table, business-scoped, with a public view like `public_profiles`), `apps/api`, `apps/web/lib/auth/redirects.ts`, `apps/web/app/layout.tsx` (robots per route).
  Done when: a signed-out phone opens a project page; the cross-tenant test proves a private project exposes nothing.
- **1.2 Agents write it.** A `project_page` task kind: the Product Lead drafts the page from the idea in the founder's words, a human approves, publishing is a platform tool (`publish_page`) through the gateway, audited. Served capabilities added: `documents.write`, `pages.publish`.
  Done when: commit → approved page live in under ten minutes on live models, and an end-to-end eval covers it.
- **1.3 The first session ends on the link.** Replace "sign off the specification, sign off the roadmap" as the first acts. New order: name it → page drafted → "this is live, send it to someone" → then the plan. The specification and roadmap are drafted in the background and arrive as one note.
  Touches: `apps/api/src/services/signoff.ts`, `packages/shared/src/first-week.ts`, `FirstWeekChecklist.tsx`, `apps/orchestrator/src/workflows/businessFoundations.ts`.
- **1.4 Real web research.** Put `web` live in production behind the existing guards; keep the quarantined reader.
  Done when: a research task cites real pages and the mock string never appears outside tests.
- **1.5 Platform email, to users and from projects.** One sender through the gateway (real and mock): transactional mail from Foundmill to a person (phase 2 needs it), and a platform-provided address a project can send from, with verified sender, suppression, and the existing approval gate for outside contact.
  Touches: `packages/connectors/src/connectors/` (extend `sendgrid` or add a provider), `apps/gateway`, `apps/ingest` (bounces, unsubscribes, bound to the business: SEC-10 and SEC-11).
- **1.6 Waitlist form and payment link.** The page's form writes contacts through ingest (real leads, with consent recorded). Stripe live per business with hosted onboarding, and a `create_payment_link` grant for one agent; creating the link is allowed, anything that moves money stays the founder's.
  Done when: a stranger's signup on the page appears in Customers as a real row, and a test payment produces a Customer Update.
- **1.7 A platform-owned repository for code.** For projects that build software and have no GitHub: a repository created for them and a hosted preview, so "Nothing exists outside these screens yet" stops being true. Larger than the rest of this phase; schedule last.
- **1.8 Outcome evals in CI.** Three end-to-end sessions with tools (page published, research with real citations, email sent to a test inbox) run nightly on live models; the live smoke of `docs/GATES.md` finally runs.

### Phase 2: Reach and the person

Status, Nov 12, 2026: 2.3 first part done (a person's own public profile at `/u/<handle>`); 2.2's Google half done (Continue with Google on the web, off until set up). **Ownership (founder, Nov 12):** the waitlist half of 2.2 and invitations (3.1) belong to the network session (`docs/NETWORK.md`), not this roadmap. 2.4 first part done (`/home`, a person with no project lands on a real screen; the `(live)` layout without a project is with the network session). Next here: 2.1 (small screens for the outer product).

Goal: R1 and R6. A person on a phone can arrive, exist and be found before any project exists.

- **2.1 Small screens for the outer product.** Landing, sign-in, profile, the doors, project and person pages, messages, Today and Needs you work from 390 px. The dense console keeps its 1280 px floor behind a kinder note with "email me the link". Needs decision 14.1.
  Touches: `apps/web/components/providers/DesktopOnly.tsx` (per-route), `packages/dugout` (responsive variants of the shell and the components those routes use, with stories at 390 px), `docs/DESIGN.md` §2, Playwright phone projects.
- **2.2 Open the door.** Ask "I am 18 or older" once at sign-up, for the whole product, and move the network's own attestation there. Replace the closed list with open sign-up or a waitlist that records who referred whom and moves people up when they bring someone; add Google and Apple sign-in; the email link works on any device. Protect the platform key with the existing credits gate and per-account ceilings.
  Touches: `apps/api/src/services/access.ts`, `apps/web/app/login/`, Supabase auth settings, `docs/DEPLOY.md` §4.
- **2.3 The person profile.** Widen `founder_profiles` (12.3). Rebuild "Before you start" as three plain questions (what should we call you; what are you good at or enjoy, as tags; what are you here for: start something of my own, join something, not sure yet) with everything else later. "On my own" is a complete answer and asks nothing further about people. Per-field visibility; public by choice, on by default for the fields that make matching work, off for residence and money. Remove the 25,000 placeholder and the operator vocabulary.
  Touches: `packages/db/src/schema/accounts.ts` plus migration and RLS, `packages/db/migrations` (replace the `public_profiles` view so a person no longer needs a Live business), `apps/web/components/onboarding/`, `apps/api/src/routers/founder.ts`.
  Done when: a new account with no business has a public page it controls, and the cross-tenant test proves private fields stay private.
- **2.4 Home for a person.** A signed-in person with no project lands on a real screen whose main action is "start something", with "find a project or people" beside it, plus their requests and messages if they have any. A person who has not asked for people sees no suggestions of people. Remove the redirect to `/new` from the `(live)` layout.
- **2.5 Retire "game mode".** Personal or Live becomes one plain setting on the project, "Who can see this: only me / anyone" ("only us" when there are several people), unrelated to whether the person can be found. Open the people layer for everyone (`liveMode` on), keeping the 18 or older attestation.
  Touches: `packages/shared/src/constants.ts`, `PersonalOrLiveSection.tsx`, `CommitScreen.tsx`, `live.ts` gates, the `public_profiles` view.
- **2.6 Shrink Commit.** Name and go. Kind of business is inferred; logo and colors are generated and editable later; the mode, spend line, Autopilot and agent faces take defaults and are explained when first relevant.
- **2.7 Landing and metadata.** New promise per 12.1: you can build this yourself, and people are there if you want them. Examples lead with one person in week one; remove claims that are not true yet; allow indexing.

### Phase 3: Build together

Goal: R3. Two people can go from strangers to cofounders inside the product, on the free plan. Guard for every package here (R0): a project with one person looks and works exactly as before, with no empty People panel, no "invite someone" step in a checklist, and no note addressed to an absent group.

- **3.1 Invitations.** A table with token, role, inviter, expiry and state; an invite link and an email; the invitee sees who invited them and to what, and accepts or declines; the invitation survives sign-up. The silent add is removed.
  Touches: `packages/db` (table, RLS, cross-tenant test, export), `apps/api/src/routers/team.ts`, `MembersTab.tsx`, `StaffScreen.tsx`, events `invitation.sent / accepted / declined` in `packages/events`.
- **3.2 Seats.** People are free on every plan; plans differ by agent work, not by humans. Decision 14.3.
  Touches: `packages/config/src/pricing.ts`, `packages/db/src/tiers.ts`.
- **3.3 Cofounder and collaborator.** Add `cofounder` (equal standing, several per project, replaces the single "founder" in copy and in `memberships.ts:49-60`) and `collaborator` (time-boxed, limited sections). Rename the surface from Staff to People. Vocabulary added to CLAUDE.md: cofounder, collaborator, People; "team" stays the agents.
- **3.4 Join requests.** A person asks to join a project from its page, with a note and what they bring. The request lands in the project's Needs you list for the founders; accept starts a trial.
- **3.5 Trial.** A two-week collaborator membership with an end date, a shared first task, and a check-in note to both sides at the end: continue, extend, or part, with access removed on parting.
- **3.6 Notes for more than one person.** `inbox_items` gains an optional recipient and a "who decides" derived from Responsibilities; prompts receive the people (name, role, experience); the Composer writes to a named person and pitches to their level; the Chief of Staff addresses the group.
  Touches: `packages/db/src/schema/inbox.ts`, `apps/composer/src/context.ts`, `compose.ts`, `packages/agents/src/prompts/inbox-composer.ts`, `agent-conversation.ts`, `chief-of-staff-planner.ts`, `apps/orchestrator/src/activities/brief.ts`.
- **3.7 People talking inside a project.** A project thread (reuse `message_threads`), comments on notes and tasks, presence beyond the specification editor, tasks assigned to a person.
- **3.8 Who owns what.** A split proposal any cofounder can open: percentages, vesting in plain words with a worked example, what happens if someone leaves. Each person agrees in the product; the agreed split is recorded and later feeds the cap table. A plain-language founders' agreement template is generated for the founders to review and sign themselves, outside any agent action. The helper agent explains and never advises on law. Signing remains a hard gate.
  Touches: `packages/db` (proposal tables), `packages/modules/src/legal/` (new contract kind), `packages/agents` (helper prompt with an eval that it refuses to recommend terms as legal advice).
- **3.9 Pooled credits.** Cofounders' included credits pool on a shared project. Needs decision 14.3.

### Phase 4: Finding each other

Goal: R2, and closing the loop of R4. Guard (R0): everything here is reached by the founder's own step. Suggestions of people go only to someone who said they are looking; a founder who said "on my own" is not asked again unless they change it.

- **4.1 Open roles.** A project states what it needs ("someone who can talk to cafe owners, five hours a week"), drafted by the role-writer agent from the plan's gaps, shown on the project page and in browse.
- **4.2 Browse and search.** People by strengths, wants, hours and place; projects by stage, kind and need. Replace name-only search. Start with Postgres filters and trigram; add meaning-based ranking later.
- **4.3 Suggestions.** For a person who is looking, the matcher proposes a few people and projects with one honest line of why, on Home and in a weekly email. An eval holds it to stated facts only, and to silence for a founder who is not looking.
- **4.4 Introductions.** The introducer drafts a first message from both profiles; the person edits and sends. Agents never send person-to-person messages (existing rule, kept).
- **4.5 Ideation for one person first.** Every concept is one the founder can run alone with the agent team, and says how the agents cover what the founder cannot do. Replace the ten scores with three plain answers for first-timers (can you start for free; who would pay; what the agents handle and what you do yourself), with the full set in Builder view. New prompts start from lived problems. A concept may carry one optional line, "someone who knows X could speed this up", with a one-tap "look for this person"; it never lowers a rating and is left off for a founder who said "on my own". An eval checks that no concept is presented as needing a partner.
  Touches: `packages/agents/src/prompts/ideation.ts`, `ideation.ts`, mock fixtures, the ideation eval.
- **4.6 Referral.** Every invitation, page visit and shared card carries who brought whom; both sides get credits when the new person does something real (publishes a page or joins a project). Needs decision 14.3.
- **4.7 Safety for meeting strangers.** Report a person, a profile and a message; a platform review queue with a response target; rate limits moved from process memory to Redis; a sanctioned way to exchange contact details after both sides connect; 18 or older confirmed once at sign-up for the whole product (founder, Nov 11, 2026; built in 2.2).
- **4.8 Communities for a purpose.** Seed communities by place and by interest; a "looking for people" post type that links to an open role.
- **4.9 Leaderboards.** Removed (founder, Nov 11, 2026).
- **4.10 One home for the people side.** Decide the fate of `apps/social` (section 11).

### Phase 5: Coming back

Goal: the loops have a pulse.

- **5.1 Notifications.** Push to the app exists (the api's push notifier and per-person preferences); extend its kinds and add email: a request to join, an invitation, a message, a decision waiting more than a day, "your page had visitors". Preferences per kind; one-click unsubscribe; quiet hours.
- **5.2 The weekly letter.** What the project shipped, what the founder (or each person) did, who visited; for someone who is looking, one suggestion of a person or project. Written by the Composer in the new voice.
- **5.3 Milestone cards.** New early milestones: page live, first follower, first conversation with a customer, first dollar. "First collaborator" and "first cofounder" exist and appear only when they happen; they are never shown as empty slots. Each has a public card with an image and a link to the project page, for any project that is visible.
  Touches: `packages/journey/src/trophies.ts`, `MilestonesScreen.tsx`, a public card route.
- **5.4 Build log.** A project's public page gains a running log drafted by agents from shipped work, approved by a human.
- **5.5 The native app is the phone's home** (built with Newly; push already exists on main). The small-screen web hands over to it through the store-links value of 2.1. No installable web app.
- **5.6 The mobile prompt pack follows the thesis.** `docs/mobile` (AGENTS.md, the product and voice skills, the prompts) still describes the console for one experienced founder: update what Foundmill is for, solo is complete, the words for people, the subtext rule, the removal of leaderboards and the 18 or older confirmation, and add the people screens as they are built on the web.

### Phase 6: The inside, re-cut for a first-timer

Goal: R7, and the rest of R6.

- **6.1 Show by stage.** A tab appears when its data exists or its moment arrives (a first payment reveals Money detail; "incorporate" appears when revenue or a cofounder split makes it relevant). Everything stays reachable in Builder view. Target: about a dozen surfaces in week one.
  Touches: `packages/shared/src/areas.ts`, `apps/web/lib/sidebar.ts`.
- **6.2 Earnings first.** Money opens on money in, money out, what you kept and days to first sale; each cofounder's share appears when there is more than one founder. Runway, burn and the rest follow when a bank is connected.
- **6.3 Founder tasks.** Each day Today gives each person one thing only a human can do, with a short "how" and a way to report back that feeds the plan.
- **6.4 Chief of Staff as mentor.** Rewrite the role line and the founder line of the house rules; add a mentor register to `voice.ts`; one explained idea per decision for first-timers; pass names, roles and personal goals into every prompt that speaks to a person.
- **6.5 Personal goals.** The profile gains what the person wants (first income, hours, something to learn); goals appear beside the business goal.
- **6.6 One switch for supervision.** A single sentence and control on first use; modes, per-agent limits, Autopilot and vacation move to Builder view.
- **6.7 Money defaults from the profile.** Department budgets, the approval line, the first recommended decision and every template example scale to the person's stated budget; the free option is the recommended one when the budget is zero.
  Touches: `packages/agents/src/archetypes.ts`, `packages/config/src/limits.ts`, the templates' examples.
- **6.8 New example projects.** Replace Northwind and Ledgerly as the front door with three week-one projects by first-timers with no money: two run by one person alone, one by two cofounders. Keep the old ones as Builder view samples. Rewrite seed notes to obey the Composer's own rules.
  Touches: `packages/db/src/seed/`, `apps/web/components/landing/examples/`.
- **6.9 The management-game wording stays** (founder, Nov 11, 2026): Form, ratings out of 20, Agent of the week, Hire / Let go / Lend, wage cap and line manager remain the default view, and the tab slugs keep their names. Only fix `package.json`'s description.
- **6.10 Copy pass.** Every string in sections 5 and 6 of this review, in the voice of 12.6, under the three linters plus the subtext check.

### Phase 7: Economics and reach

- **7.1 Prices and credits from measured cost.** Cost per first session and per week from the usage ledger; set a free allowance that reaches the first real outcome and a first week of work; route first-run work to cheaper models where quality holds (`packages/models/src/routing.ts`).
- **7.2 Working top-ups and paid plans**, so no wall lacks an exit.
- **7.3 More places:** payout and incorporation routes for more countries. No translation work: English only for the foreseeable future (founder, Nov 11, 2026).
- **7.4 Load and moderation capacity** measured before each widening of sign-up.

### Order and reasons

1. **Phase 0 first** because building on a product that reports pretend results makes every later number untrustworthy.
2. **Phase 1 before the people work** because real outcomes are what make a solo founder able, which is the main case, and because the project page is also the object every invitation, role and card links to.
3. **Phase 2 with or just after phase 1** because a page that works on a phone must lead somewhere a phone can use.
4. **Phase 3 before phase 4** because discovery that ends in "you cannot join" is worse than no discovery. Invitations between people who already know each other also give the first real growth with the least safety risk.
5. **Phase 5 threads through 3 and 4;** its email sender is built in 1.5.
6. **Phase 6 can run alongside from phase 2 on;** it is mostly independent.

## 14. Decisions for the founder

**All answered on Nov 11, 2026** (`docs/DECISIONS.md`, three entries of that date). In order: 1 yes, with the native app (built with Newly) taking over on phones; 2 yes; 3 yes; 4 yes; 5 18 or older for everything, asked at sign-up; 6 English only, no translation work; 7 the management-game wording stays the default view; 8 the north star is weekly active projects with at least one real outcome, any number of people; 9 leaderboards removed, negotiation dormant and hidden, the import door a smaller third option, the Channel Board shows only channels that can act; 10 scope confirmed, no lawyer's review, each cofounder signs in the platform; 11 Foundmill hosts project pages and provides a sending address with a daily cap now, and repositories and hosting for software projects after those are proven. The list below is kept as it was asked.

1. **Small screens** (blocks 1.1, 2.1). CLAUDE.md says "Never build mobile layouts." Recommendation: lift it for the outer product (public pages, sign-in, profile, people, messages, Today, Needs you) and keep the dense console at 1280 px.
2. **The words for people** (blocks 3.3). Recommendation: cofounder, collaborator, People; "project" for a business before its first sale; "team" stays the agents; "staff" retired from default copy.
3. **People are free** (blocks 3.2, 3.9, 4.6). Recommendation: no seat limits on any plan; cofounders' credits pool; referral credit on a real action.
4. **Open sign-up** (blocks 2.2). Recommendation: a waitlist with referral order now, open sign-up when per-account ceilings and 4.7 are in place.
5. **Age** (blocks 4.7). The people layer requires 18 or older by self-attestation. Meeting strangers and sharing ownership argue for keeping 18 as the floor. Confirm.
6. **English only** (blocks 7.3). The US English rule stays for now; confirm that a translation layer is wanted later.
7. **The management-game grammar** (blocks 6.9). The Oct 20 decision keeps it. Recommendation: move it to Builder view.
8. **The north star.** Decided: weekly active projects with at least one real outcome that week, whatever the number of people. Supporting, as descriptions and never as targets a solo founder is pushed toward: share of people who looked for someone and connected in their first week, and invitations accepted.
9. **Fate of what does not serve the thesis:** leaderboards (4.9), agent-to-agent negotiation, the import door's equal billing, the fifteen-channel Board for a business with no publisher.
10. **Ownership splits and legal care** (blocks 3.8). The product would record an agreed split and offer a template founders sign themselves. Confirm this scope, and whether a lawyer should review the template and the helper's wording before release.
11. **Platform-paid infrastructure** (blocks 1.5, 1.7). A platform sending domain and platform-owned repositories and hosting put cost and abuse risk on Foundmill. Confirm, with ceilings.

## 15. How to measure the rebuild

| Stage | Measure |
| --- | --- |
| Arrive | Share of project-page visitors who sign up; share on a phone |
| Exist | Share of new people with a public profile in session one |
| First outcome | Share of new projects with a live page in session one; median minutes to it |
| Share | Shares of the page per new project in week one |
| Connect | Of new people who said they are looking for someone, the share who exchange a message with another person in week one |
| Join | Join requests per open role; acceptance rate; trials that become cofounders |
| **North star** | Weekly active projects with at least one real outcome that week (page, email, post, payment link, a customer's reply), simulated ones excluded, any number of people |
| Solo | The north star for one-person projects alone, read beside the rest: it must not trail projects with several people for reasons the product causes |
| Together | Share of active projects with two or more people. A description of what founders chose, never a target |
| First dollar | Share of projects with a first payment within 30 and 90 days; median days |
| Return | Four-week retention of people, not businesses |
| Loop | New people per active person per month who arrived through a page, card or invitation |

All of these need events declared in `packages/events`; none exists today.

## 16. Risks

1. **Safety between strangers.** Harassment, scams and ownership disputes come with a network of young people forming partnerships. Phase 4.7 is a precondition, not a follow-up.
2. **Cost on the platform's key.** Open sign-up plus free agent work is an abuse surface. Per-account ceilings, cheaper routing for first-run work and measuring before widening.
3. **Promising what agents cannot do.** The current landing page already does. Every claim in new copy must map to a row marked real in 7.5.
4. **Equity is serious.** A split recorded in a product can be read as an agreement. Clear wording, founders sign outside agent action, legal review of the template.
5. **Two products at once.** The console is large; if it keeps growing while the people side is built, the proportions never change. Freeze new console surfaces until phase 3 ships.
6. **Pushing people together.** Growth through invitations tempts the product to nag. A solo founder who is made to feel one short leaves. Every people feature ships with the R0 guard, and the solo north star is read beside the overall one.
7. **An empty room.** Matching with few people disappoints. Start with invitations between people who know each other (phase 3), seed by place and interest, and show honest counts.
8. **Rule churn.** The mobile and vocabulary changes touch the design system and three linters. Do them once, in phase 0, with the linters updated in the same change.
