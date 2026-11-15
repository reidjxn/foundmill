# S2: Activation and growth review

Foundmill, main at 04a0a509, reviewed Nov 15, 2026. Read-only: nothing in the repo was changed, nothing was built or run, no form on the live site was submitted. Sources: `e0-production-evidence.md`, the live pages at foundmill.com and foundmill.com/login, and the first-run code named in each finding. `a1-first-run.md` did not exist when this was written, so the code findings here are my own reading.

## Skills used

All eighteen loaded. Each finding below carries the skill it came from in brackets.

| Skill | Loaded | How it shaped the review |
| --- | --- | --- |
| `marketing-skills:product-marketing` | Yes | It wanted a context file at `.agents/product-marketing.md` (none exists). I auto-drafted it from the repo and wrote it into section 1.1 here, not into the repo. Every other skill read that context. |
| `marketing-skills:onboarding` | Yes | Minimum path to value, one goal per session, the aha and activation definitions, endowed progress, the stalled-user plan. Sections 2 and 5. |
| `marketing-skills:signup` | Yes | Field-by-field verdicts (keep, defer, infer, cut), value before commitment, post-submit states. Section 4. |
| `marketing-skills:cro` | Yes | The seven-part page analysis of the live landing page, in order of impact. Section 3.1. |
| `marketing-skills:copywriting` | Yes | Situation diagnosis (the live page is situation B: a real voice aimed at the wrong reader), decompose and lock, the three-question gate, CTA formula. Section 3. |
| `marketing-skills:copy-editing` | Yes | Seven sweeps and the four-persona panel on the proposed landing copy. Section 3.11. |
| `marketing-skills:marketing-psychology` | Yes | Theory of constraints for the diagnosis; zero-price, endowment, Hick's law, peak-end, Fogg, default effect and the cobra effect in specific recommendations. |
| `marketing-skills:churn-prevention` | Yes | Risk signals, proactive interventions and the win-back for the 11 stalled projects. There is no paid plan, so cancel flows and dunning do not apply yet. Section 6. |
| `marketing-skills:emails` | Yes | One email, one job; the lifecycle plan with triggers, audiences, stop conditions and copy. Section 6. |
| `marketing-skills:referrals` | Yes | The viral potential check (Foundmill is on the natural end: its outputs are public), product-embedded mechanics before rewards. Section 8. |
| `marketing-skills:pricing` | Yes | Value metric (agent work), "pick a price you can learn from", pricing-page structure, what to measure first. Section 7. |
| `marketing-skills:paywalls` | Yes | Value before ask, respect the no, when not to show. Section 7.3. |
| `marketing-skills:free-tools` | Yes | The idea box scored as a free tool (32 of 40) and what it lacks as one. Section 8.4. |
| `marketing-skills:analytics` | Yes | Track for decisions, object-action names in the repo's dotted style, closed observation windows, compute from rows. Sections 2.5 and 2.6. |
| `marketing-skills:ab-testing` | Yes | Hypothesis format, sample sizes, fixed horizon, when not to test. Section 9. |
| `marketing-skills:launch` | Yes | The readiness gate (simple, lovable, complete) and the five phases. Section 9.3. |
| `humanizer:humanizer` | Yes | Embedded mode on every line of proposed copy: no dashes, no "not X but Y", no negation lists, no one-line closers, no forced threes. What it changed is in section 3.11. |
| `andrej-karpathy-skills:karpathy-guidelines` | Yes | Simplicity first: each recommendation is the smallest change that moves its number, reuses what the repo already has, and ends with a check that can pass or fail. Assumptions are stated where I could not verify. |

Where a skill asked questions meant for a person, I answered from the evidence and say so. The largest assumption: the target user's own words in section 1 are inferred from the thesis, not heard from founders. Section 9.2 is how to replace them with real ones.

## 0. The short version

1. The constraint is not the landing page's conversion rate. There is no traffic to convert (one new account in 14 days, one idea-box draft, an empty waitlist), and the people who did get in left on day one (11 of 13 projects). Tuning copy before fixing the first session would optimize the wrong step. [marketing-psychology: theory of constraints]
2. The product's own promise, "within the first session it has a public page you can send to anyone", has never happened for a real user. Public pages shipped Nov 12. The last real project was created Oct 25. `project_pages` has 0 rows.
3. A person on a phone cannot reach a live page. The landing page, the card, sign-in, the kept card, `/home`, Today and Needs you work at 390 px. The profile questions (`/onboarding`), the commit screen (`/new/commit/...`) and the page editor (Product, Public page) do not, and each shows "This needs a larger window". The kept card's only button leads straight into the first of those walls.
4. A stranger cannot get in, and the page does not say so. Production is invite-only (`SIGNUP_ALLOWLIST`). The landing page says "Sign in and it is saved to your account". A stranger signs in and reads "Invite only for now". The waitlist copy promises an email that no code sends.
5. Day one buries a first-timer: 25 to 27 agents hired, 4 to 17 notes, approval requests nobody can act on (79 of 127 were `launch_campaign`, and the integrations table shows no real channel connected on any real project), a "Day one" panel that sums wage caps into thousands of dollars beside "$5.00 of included credits", and a default spend line of €250 for someone with $0.
6. Nothing brings a person back. Every email kind is about a project that has started and has news. A person who signed up and stopped, or a project that went quiet, gets nothing.
7. The fix, in order: tell the truth at the door; make the phone path from card to live page; replace forms with defaults; make day one one voice and at most three notes; instrument eight events; then rewrite the landing page for a first-timer; then lifecycle email; then open the door with a small daily ceiling. Section 10 has files and checks.

## 1. Positioning for this person

### 1.1 Product-marketing context (the file the skill asked for, kept here)

Document version v1, Nov 15, 2026. Auto-drafted from CLAUDE.md, `docs/THESIS_REVIEW.md` sections 12 and 15, `docs/foundmill-plan/foundmill-plan.md`, the landing components and the production evidence. Sections that do not apply (B2B personas, paid ads) are left out. [product-marketing]

| Section | Content |
| --- | --- |
| One-liner | Foundmill is where one person builds something of their own, with a team of AI agents doing the work they have not learned yet. |
| What it does | You say your idea in a sentence. The team shapes it, rates it honestly, drafts a public page for it and plans the first week. You make the decisions; nothing is spent, sent or signed without you. |
| Shelf (how they search) | "how to start a business with no money", "business idea generator", "is my business idea good", "make a website for my idea free", "AI that builds a business". It sits beside chat assistants, website builders and "start with $0" videos. |
| Type and model | Web product, freemium. Free plan: $5 of agent work a month for one project, no card. Paid plans differ by agent work only; prices not set. People are free on every plan. 18 or older. |
| Who | A first-time founder, often young, with little or no money and no business experience, probably on a phone, who can describe something they would like to exist, or wishes they could. |
| Jobs to be done | 1. Make my idea real enough to show someone. 2. Tell me what to do next, because I have never done this. 3. Do the parts I cannot do or pay for: the page, the words, the research, the emails. |
| The problem, in their words (assumed until interviews) | "I have an idea but I don't know where to start." "I can't pay anyone." "I asked a chatbot and got a plan, and then nothing happened." "I don't want to look stupid." "Is this going to charge me?" |
| What it costs them today | Months of an idea sitting in a notes app. Hours of videos that end in a course to buy. |
| Direct alternative | A free chat assistant. It gives a plan that stays in the chat window. |
| Secondary alternatives | A site builder (an empty template, and you must know what to write). An app builder (you must know what to build, and it costs about $20 a month). A store builder (assumes you have a product). |
| Indirect alternative | Watching videos about starting, and not starting. This is the habit to beat. |
| What is different, and true today | A rated card for your idea in about ten seconds with no sign-up. Honest ratings that are never inflated. A public page hosted free at a Foundmill address (built, not yet used by any real project). One list of decisions, each with a recommendation. House rules the agents cannot cross: they never move money, sign, accept terms, file under your identity, delete for good or change security settings. |
| Push | An idea that has gone nowhere. Chat plans that lead to nothing you can show. |
| Pull | A page with my project's name on it, today, for $0. |
| Habit | "I'll start when I have money, time, or someone to do it with." |
| Anxiety | Cost. Looking foolish. Someone taking the idea. The AI doing something in my name. Needing a company, a bank account or a card. |
| Anti-persona (for now) | An experienced operator who wants agents to open pull requests on an existing codebase; regulated industries; anyone who needs a language other than English. Today's landing page speaks mostly to this person. |
| Words to use | idea, project, page, link, free, your team, what to do next, yours, today. |
| Words to avoid in first-run copy | cycle, archetype, specification, roadmap sign-off, distribution, runway, MRR, pull request, assisted mode, autopilot, wage cap, "credits" without a dollar figure. Never jobs, employment or careers as the reason to be here. |
| Voice | Someone a few years ahead of you, on your side. Calm and exact. Marks a first. Treats a setback as normal. (THESIS 12.6) |
| Proof available today | No user proof: no public page exists, no testimonial, 19 accounts. What exists: the card itself as a live demonstration; Foundmill built on Foundmill (41 rounds of work, 224 agent sessions, GitHub connected); the house rules enforced in code; the price, $0 and no card. |
| Goal | North star: weekly active projects with at least one real outside outcome. Conversion action: a page published and shared in session one. |
| Current metrics | 19 accounts, 1 new in 14 days, 2 active; 13 real projects, 11 not revisited after day one; 0 public pages; 14 of 127 approval requests resolved; 1 idea-box draft; 0 waitlist entries. |
| Learnings | Empty. First entries will come from section 9.2. |

### 1.2 The one page

**Who it is for.** Someone starting a first project with no money and no experience, most likely holding a phone.

**The problem in their words.** "I have an idea and I don't know the first step. I can't pay for help. Every plan I get stays a plan."

**The promise.** Say your idea in a sentence and leave today with a page for it at a link you can send. Your team of AI agents does the work you have not learned yet, and you decide everything that matters. It is free to start.

**Proof available today.** The card appears in front of you before you sign up. The page is real and public once you publish it. The house rules are a short list the agents cannot cross. Foundmill itself is built this way. There is no customer proof yet, and the page should not pretend there is.

**Objections and anxieties, in the order they arise.** Will it cost me? I have no idea yet. I am not technical. Will it do something in my name? Is my idea safe? Do I need a company or a bank account? Does it work on my phone? What if I stop for a week?

**The alternative they would use instead.** A free chat assistant, then nothing. Foundmill wins only at the moment the idea leaves the product as a page someone else can open. Until that moment it is a longer chat.

**The three messages the landing page must land.**

1. You can start right now with one sentence and $0, on this phone. (capability, zero price)
2. Today ends with a real page for your idea at a link you can send. (a concrete first outcome)
3. You stay in charge. Nothing is spent, sent or signed without you. (safety)

A fourth, as an offer and never a condition: people to build it with, if you want them, at no cost.

### 1.3 Claims on the live page checked against what a new free user gets today

[copy-editing: the "prove it" sweep; copywriting: claims must be supportable]

| # | Claim, and where | True for a new free user today? | What to do |
| --- | --- | --- | --- |
| 1 | "Sign in and it is saved to your account. From there your team checks it against real sources, drafts the plan, and starts building when you say so." (`IdeaBox.tsx`, `keepLead`) | No, for a stranger. Production is invite-only; after signing in they read "Invite only for now" (`NotInvitedPage.tsx`). Nothing before that says so. | P0-1. Say it before the person signs in. |
| 2 | "Start your business" in the top bar and the closing section, linking to `/login` | Same wall. | Replace with "Shape my idea", which focuses the box. |
| 3 | "You are on the waitlist. We will email you when there is room." (`NotInvitedPage.tsx`, `joined`) | Not kept. `waitlist_entries.admitted_at` exists; no code sets it and no email kind exists for it. Admitting means editing `SIGNUP_ALLOWLIST` by hand. | P0-1. Build the admission email or change the sentence. |
| 4 | "Your card works here." (phone note, `LandingPage.tsx`) | The card works. The next step does not: "Answer three questions about you" opens `/onboarding`, which is not in `SMALL_SCREEN_PREFIXES` and renders "This needs a larger window". CLAUDE.md forbids leaving a small screen at a dead end. | P0-2. |
| 5 | "Answer three questions about you" (`CardKeptView.tsx`) | The form requires a name, experience and time, asks residence and citizenship, and carries an 18-or-older box. Its own lede says "Four quick answers". | P0-3 removes the form from session one. |
| 6 | "Agents open real pull requests on your GitHub, send email from your own accounts and reconcile your Stripe and bank data." (`Thesis.tsx`, pillar 2) | Only after connecting accounts a first-timer does not have. 1 of 13 real projects connected GitHub; none connected Stripe. 215 of 319 agent sessions on real projects ended blocked. It also undersells the free path: Foundmill gives every project a page and a sending address without any account. | Rewrite around what needs no account. Move this pillar to a page for experienced founders. |
| 7 | "Better every cycle. Agents are trained against real tests between cycles." (`Thesis.tsx`, pillar 3) | No. `skill_tests` has 0 rows. The one real training run has waited on a decision since Oct 22 and cost $12.78, two and a half months of the free allowance. | Remove from the first-timer page. |
| 8 | "Six departments work at once every cycle" (`Thesis.tsx`, pillar 1) | The free plan runs 4 agents at once (`maxConcurrentAgents: 4`), on $5 a month. | Remove. A first-timer needs one voice, not six departments. |
| 9 | "Your team of AI agents shapes it, builds it and runs it, in the open." (hero lede) | Shapes: yes. Builds and runs: for a free user with nothing connected, the team drafts, plans and researches. Code tasks were the largest blocked kind (138 of 299). | Promise the first step and say what needs your own accounts later. |
| 10 | "Starts with $5.00 of included credits · no card" | True. Unclear: "credits" is undefined and nobody knows what $5 buys. Evidence suggests two to three rounds of work at today's model mix (Estimate, section 7.1). | State it as agent work with a plain example. |
| 11 | "The team drafts; you sign off; then they build. Nothing is spent until you approve it." (`HowItWorks.tsx`) | The project's money is not spent. The $5 allowance is spent as agents work, and the team pauses at zero. A person with $0 will read "nothing is spent" as "this cannot run out". | Say both halves. |
| 12 | Example businesses: Tutorlane at cycle 215, chapter 9, $10K MRR, 14 months of runway | Labeled as an example, so not false. It shows year two to a person who needs to see day one. | Replace in the hero with week-one examples (section 3.5). Keep one long-run example lower down. |
| 13 | "First company or fifth, the team comes with it" (hero badge) | True, and aimed at a serial founder. | Replace. |
| 14 | "Your first card is free · no sign-up" and "Your idea stays private until you choose to share it" | True. | Keep. |
| 15 | "Never started a company? You do not need to know how to incorporate, price, run ads or keep books." (closing section) | True in stance, and the right reader. It is the last thing on a page a phone never shows. | Move this stance to the top. |

Two things I could not verify and that change what the page may claim: whether platform mail is switched on in production (`PLATFORM_MAIL_DOMAIN` on the gateway; `docs/PROGRESS.md` says "Off until configured"), and whether paid credit top-ups take real payments. If mail is off, no follower can confirm, no project email goes out and no email from Foundmill reaches anyone, which removes three of the five kinds of real outcome.

## 2. The activation model

### 2.1 Aha, activation, habit

[onboarding: find the aha moment; one goal per session]

| Term | Definition | Why this one |
| --- | --- | --- |
| Aha moment | The person sees their idea as a public page with its name on it, at a Foundmill address, on their own device. | It is the first thing that exists outside the product, which is what a chat assistant cannot give. It is also the north star's first real outcome. |
| Activation event | Within 24 hours of sign-up, the same person (a) published a page for a project that is not a sample (`page.published`, actor kind `user`, not simulated) and (b) opened a share of it (`share.opened` with `kind: "page"`). Report a stricter cut as well: both inside the first session (the repo's session rule, a 30-minute gap, `PRESENCE.sessionGapMs`). | "Live" proves the product worked. "Shared" proves the person believed in it enough to show someone, and it is the loop's first turn. |
| Confirmation (not required, tracked) | The page gets its first visit from someone who is not a member of the project. | `share.opened` records a press, not an arrival. An outside visit is the first sign the world answered. It needs a new `page.visited` event. |
| Habit | The project has at least one real outcome in its second week and the founder visited on at least 3 different days in days 1 to 7 (the repo's `HABIT`). | The second week is the first one the north star can count without the publish. |
| Retained founder | Active with a real outcome in week 4. | THESIS section 15: four-week retention of people. |

The repo already defines "activated" (`packages/shared/src/founder-return.ts`): the founder signed off the specification and the roadmap and pressed Continue within 24 hours of commit. That is three actions inside the product on two documents a first-timer cannot judge. Founders answered 0 to 1 decisions, so almost nobody met it, and meeting it would not have produced anything the north star counts. Recommendation: keep the function for comparison, and make the definition above the one the reports use. [onboarding: judge activation by later retention, not by setup completed]

### 2.2 The steps between the landing page and the aha, and what to do with each

Counted from the code. "Phone" says whether the step renders at 390 px today.

| # | Step today | Phone | Verdict | What replaces it |
| --- | --- | --- | --- | --- |
| 1 | Type one line, get a rated card (`IdeaBox.tsx`) | Yes | Keep | Nothing. This is the best thing in the funnel: value before any ask. |
| 2 | "Continue with Google" or "Continue with email" | Yes | Keep | Lead with the six-digit code inside in-app browsers (section 4.2). |
| 3 | Admission check: not on the list, "Invite only for now", then a button to join the waitlist | Yes | Fix | Say it before sign-in; join the waitlist automatically; send the admission email (P0-1). Later, an open door with a daily ceiling. |
| 4 | "Keep this card?" confirmation (`CardKeepView.tsx`) | Yes | Keep, quietly | It is a security decision (nobody's card lands in a deck unseen). Add the next step to the same screen so it does not feel like a pause. |
| 5 | "<name> is yours", then "Answer three questions about you" | Yes | Change | This screen becomes the whole setup: what your team should call you (prefilled), the 18-or-older box, and one button, "Draft my page". |
| 6 | `/onboarding`, "Before you start": name, experience, time, residence, citizenship, 18 or older, plus an optional section with five skill sliders, budget, currency, markets, constraints, risk appetite | No | Cut from session one | Default, infer or ask later (section 4.1). |
| 7 | After saving the profile the person is sent to `/new`, the doors page, not back to their card (`OnboardingScreen.tsx`, `router.push("/new")`). The kept card is somewhere under "earlier concepts". | No | Cut | Goes away with step 6. |
| 8 | `/new/commit/<id>`: business name with domain availability and a trademark screen, logo and brand colors, "How it runs" (personal or live, kind of business, business mode, spend cap, Autopilot), the "Day one" team list with a wage-cap total, "Take charge" | No | Default | The project is created with defaults when the person presses "Draft my page": name from the card, kind of business from the card, personal, ask-first, spend line $0, the overnight shift on for the first night, initials mark and seeded colors. Everything stays editable in Settings. |
| 9 | Foundations draft for "a minute or two"; 4 to 17 notes arrive, among them two sign-offs and "Your project's page is ready" | Today and Needs you: yes | Reorder | The page first and alone. The specification and roadmap sign-offs wait until after the page is live. |
| 10 | "Check it and publish" opens Product, Public page (`TodayScreen.tsx`, `moduleTabHref(... "public-page")`) | No | Fix | A phone-width publish screen: the draft, the address, Publish, confirm. |
| 11 | "Copy link" and "Share your page" | No (same screen) | Keep, move | Show them as the end of session one, with a message already written. |

Today: eleven steps, two desktop-only forms holding about thirty controls (four of them required), three walls on a phone and one wall for anyone not on the list. Target: card, sign in, name and age, publish, share. Five steps, two inputs after the idea itself. [onboarding: minimum path to value; marketing-psychology: activation energy, default effect]

The page does not need to wait for a model. `page.get` already builds a starter draft from the founder's own words with no model call (`starterPageDraft`, `apps/api/src/services/pages.ts`). Show that at once and let the Product lead's better draft replace it when it arrives.

### 2.3 Target time to value

| Moment | Target | Today |
| --- | --- | --- |
| First words of the card | 2 s (already the founder's target) | Not measured in production; one draft exists |
| Whole card | 10 s | Same |
| Signed in | 60 s with Google, 2 min with the email code | Not measured |
| Page live, from landing | 10 min median, on a phone | Never happened |
| Page shared | 15 min median | Never happened |
| Inputs after the idea | 2 (name, age box) | 4 required and about 30 shown, across steps 6 and 8 |

### 2.4 Behaviors that should predict a retained founder

These are hypotheses. With 13 projects nothing here is proven; the two projects that kept going are the two with a real connection to the outside (Foundmill's own, with GitHub connected, and one marketplace project with 16 rounds of work). Confirm each on a cohort that has had its full four weeks before adopting it. [onboarding: treat correlated early actions as candidates, confirm on a later mature cohort]

| Day | Behavior | How to read it from data |
| --- | --- | --- |
| 0 | Page published. Page shared. At most one note left unanswered when the session ends. | `page.published`, `share.opened`, `inbox_items` open at the session's last ping |
| 1 | Came back (a visit on the next calendar day). Opened the morning email. The page had an outside visit or a confirmed follower. | `founder_visit_days`, `founder.session_started` with `via: "email"`, `page.visited`, `page.followed` |
| 3 | A second real outcome of any kind. Three or more decisions answered in total. The page edited after someone's reaction. | The real-outcome event types; `inbox_items` answered; `page.published` count above 1 |
| 7 | Three or more visit days in days 1 to 7. A real outcome in days 2 to 7. A reply or a follower from someone outside. | `founder_visit_days`; `lead.replied`, `page.followed` |

### 2.5 The funnel as events

Names follow `packages/events` (lower case, dotted, object then action). "Exists" is checked against `packages/events/src/catalogue.ts`. Karpathy rule applied: reuse an existing event before declaring a new one. [analytics: track for decisions; name consistently]

| Event | Exists | Properties | Written where | Decision it informs |
| --- | --- | --- | --- | --- |
| `idea.shaped` | No. `idea_drafts` rows stand in, but unclaimed rows are deleted after 7 days, so the top of the funnel erases itself. | `source` (typed, interest), `interest`, `weak` (bool), `device` (phone, desktop), `via`, `ms_to_first_word`, `ms_to_card`, `sample` (bool) | `apps/api/src/services/idea-box.ts`, at the `card` line | Is the hook working, and is it fast |
| `idea.kept` | No. `idea_drafts.claimed_at` stands in. | `source` (browser, link, waitlist), `seconds_since_shaped` | `claimIdeaDraft` | Does the card survive sign-in |
| `account.signed_up` | No. `auth.users.created_at` stands in. | `method` (google, email_link, email_code), `device`, `via`, `had_card` (bool), `in_app_browser` (bool) | First admitted request, `apps/api/src/services/access.ts` | Which sign-in path works on phones |
| `account.admitted` / `account.waitlisted` | No. `account_admissions` and `waitlist_entries` stand in. | `mode`, `reason` (listed, invitation, open, existing; not_listed, ceiling) | `admitOrWait` | How many people the door turns away, and for how long |
| `profile.completed` | No. `founder_profiles.created_at` stands in. | `inputs_typed`, `detail_added` (bool), `device`, `seconds_on_form` | `founder.profile.update` | Whether the profile costs activations (experiment T2) |
| `idea.committed` | Yes | Add `door` (card, studio, import), `defaults_used` (bool), `seconds_since_signup`, `device` | `apps/api/src/services/commit.ts` | How many shaped ideas become projects |
| `page.published` | Yes | Add `seconds_since_signup`, `edited_before_publish` (bool), `device`, `first` (bool) | `publishPage` | The aha rate and time to value |
| `page.shared` | Use `share.opened` with `kind: "page"`. Declaring a second event for the same press would be duplication. | `network` (exists) | Exists | The activation rate |
| `page.visited` | No | `via`, `referrer_class` (direct, social, search, messaging), `first_outside` (bool). One per page per hashed address per day. Never a member of the project. | `publicPageBySlug` | Did anyone open the link. The founder's private return hook. |
| `outcome.recorded` | Do not declare. Define one SQL view, `real_outcomes`, over `REAL_OUTCOME_EVENT_TYPES` with the same rules as `realOutcomes()` in `morning-brief.ts`. | `kind`, `business_id`, `at` | View only | The north star, so the report and the morning brief can never disagree |
| `founder.session_started` | Yes | `via`, `notificationId` | Exists | Which emails bring people back |
| `notify.email_sent` | Yes | `kind`, `simulated` | Exists | Email volume against the three-a-day limit |
| `signup.attributed`, `referral.arrived`, `invitation.sent`, `invitation.accepted` | Yes | Exists | Exists | The loop |

Landing visits stay out of the database. Count them with Vercel Web Analytics on `/` (no personal data), split by device and referrer.

### 2.6 Each rate at SQL level

Column names follow the Drizzle schema I read (`events`, `memberships`, `businesses.committed_at` and `is_demo`, `idea_drafts`, `founder_visit_days`). `founder_profiles.user_id` is assumed. Every rate uses only cohorts whose window has closed; younger cohorts are reported as pending. [analytics: match observation windows]

```sql
-- One row per sign-up week: the funnel inside the first 24 hours.
with a as (
  select u.id as user_id, u.created_at as t0
  from auth.users u
  where u.created_at < now() - interval '24 hours'            -- closed window only
),
profile   as (select user_id, min(created_at) as at from founder_profiles group by 1),
committed as (
  select m.user_id, min(b.committed_at) as at
  from memberships m join businesses b on b.id = m.business_id
  where m.role = 'owner' and not b.is_demo and b.committed_at is not null
  group by 1),
published as (
  select (e.actor->>'id')::uuid as user_id, min(e.occurred_at) as at
  from events e join businesses b on b.id = e.business_id and not b.is_demo
  where e.type = 'page.published' and e.actor->>'kind' = 'user'
    and coalesce(e.payload->>'simulated', 'false') = 'false'
  group by 1),
shared as (
  select (e.actor->>'id')::uuid as user_id, min(e.occurred_at) as at
  from events e
  where e.type = 'share.opened' and e.payload->>'kind' = 'page' and e.actor->>'kind' = 'user'
  group by 1)
select date_trunc('week', a.t0)                                              as cohort,
       count(*)                                                              as signed_up,
       count(*) filter (where p.at  <= a.t0 + interval '24 hours')           as profile_completed,
       count(*) filter (where c.at  <= a.t0 + interval '24 hours')           as idea_committed,
       count(*) filter (where pb.at <= a.t0 + interval '24 hours')           as page_published,
       count(*) filter (where pb.at <= a.t0 + interval '24 hours'
                          and s.at  <= a.t0 + interval '24 hours')           as activated,
       percentile_cont(0.5) within group (order by extract(epoch from pb.at - a.t0))
         filter (where pb.at <= a.t0 + interval '7 days')                    as median_seconds_to_page
from a
left join profile p using (user_id) left join committed c using (user_id)
left join published pb using (user_id) left join shared s using (user_id)
group by 1 order by 1;
```

| Rate | Numerator | Denominator | Window |
| --- | --- | --- | --- |
| Shape rate | `idea.shaped` | Unique visitors of `/` (Vercel Web Analytics) | Same day, by device |
| Keep rate | `idea.kept` | `idea.shaped` | 7 days from the card (its life on the device) |
| Sign-up rate | `account.signed_up` with `had_card` | `idea.shaped` | 7 days |
| Admission rate | `account.admitted` | `account.signed_up` | 24 h; also the median hours from waitlisted to admitted |
| Commit rate | `idea_committed` above | Admitted accounts | 24 h |
| Page-live rate (aha) | `page_published` above | Admitted accounts | 24 h, and inside session one |
| Activation rate | `activated` above | Admitted accounts | 24 h, and inside session one |
| Time to value | Median and 90th percentile of `page.published` minus sign-up | Accounts that published within 7 days | Cohorts at least 7 days old |
| Decision answer rate | `inbox_items` of type decision answered within 48 h of creation | Decisions created in a project's first 7 days | Projects at least 9 days old. Today: 14 of 127 approval requests resolved, 11%. |
| Day-1 return | Accounts with a `founder_visit_days` row on the calendar day after sign-up | Admitted accounts | Cohorts at least 2 days old |
| Week-1 habit | Accounts with 3 or more distinct `day` values in days 1 to 7 | Accounts with a committed project | Cohorts at least 8 days old |
| Four-week retention | Accounts with a visit day in days 22 to 28 | Admitted accounts | Cohorts at least 28 days old |
| Loop | Accounts whose `signup.attributed` names a page, card or invitation | People with a visit day in the month | Calendar month |

```sql
-- North star: weekly active projects with at least one real outcome that week.
select date_trunc('week', e.occurred_at) as week, count(distinct e.business_id) as projects
from events e
join businesses b on b.id = e.business_id and not b.is_demo
where e.type in ('page.published', 'mail.sent', 'page.followed', 'payment.received', 'lead.replied')
  and coalesce(e.payload->>'simulated', 'false') = 'false'
  and not (e.actor->>'kind' = 'system' and e.actor->>'id' = 'simulate')
  and (e.type <> 'page.published' or e.actor->>'kind' = 'user')
  and exists (select 1 from founder_visit_days v
              where v.business_id = e.business_id
                and v.day >= date_trunc('week', e.occurred_at)::date
                and v.day <  (date_trunc('week', e.occurred_at) + interval '7 days')::date)
group by 1 order by 1;
```

This mirrors `realOutcomes()` except for two filters that live in code (`mail.sent` counts only when the vendor accepted it, `lead.replied` only for positive or neutral replies). Put those in the `real_outcomes` view so there is one definition. Report the same query for one-person projects alone beside it, as THESIS section 15 asks.

## 3. The landing page, rewritten for a first-timer

### 3.1 What is wrong with the live page

Page type: a homepage that has to work as a landing page. Conversion goal: an idea shaped, then the card kept. Expected traffic once the loop turns: links on project pages, shared cards, friends' messages and short videos, so mostly phones. [cro: analysis in order of impact]

| Dimension | Finding | Impact | Recommendation |
| --- | --- | --- | --- |
| Value proposition | "Build a real business with a team of AI agents." says what the category is. It does not say what I get today, what it costs, or that it is for someone who has never done this. | A first-timer with $0 hears "real business" as far away. | Promise the first step and its price. Keep the tagline for the title tag and the footer. |
| Headline | Any agent product could run it (the swap test fails). No time, no outcome, no price. | Nothing to remember or repeat to a friend. | Section 3.3. |
| Calls to action | Three compete: the idea box, "Start your business" (to sign-in), "Or watch an example run". The top bar's button asks for an account before any value. | The best action on the page shares attention with the worst. | One primary action everywhere: "Shape my idea". |
| Hierarchy | On a desktop, a two-year-old example company fills the screen below the box, followed by eight sections of console. On a phone the page ends after the hero with a note about screen width. | Desktop: the wrong story, told at length. Phone: no story. | Section 3.2. |
| Trust | The strongest trust asset, the six house rules, is the ninth of ten sections and absent on a phone. | The main anxiety (will it act in my name, will it charge me) is unanswered where most people read. | Move it up and onto the phone. |
| Objections | Cost is one line. "No idea" is handled well (Surprise me). There are no questions and answers. The phone question is answered with a negative. | The person leaves with their doubts intact. | Section 3.7. |
| Friction | The invite wall is undisclosed. The phone path dead-ends after the card. | Effort invested, then refused. This is worse than no hook. | P0-1, P0-2. |

Copywriting diagnosis: situation B. The page has a real voice and a clear argument ("the team used to be the hard part"), written for an experienced founder. I kept its strongest lines (the house rules, "Never started a company?", the idea box's assurances) and changed the reader. [copywriting]

### 3.2 Section order

| # | Desktop | Phone |
| --- | --- | --- |
| 1 | Top bar: wordmark, Sign in, "Shape my idea" (focuses the box) | Top bar: wordmark, Sign in |
| 2 | Hero and idea box | Hero and idea box, above the fold |
| 3 | What you have by the end of today (three tiles drawn with the product's own card, page and note components) | Same, stacked |
| 4 | A first week, from $0 (three example projects, one open at a time) | One example as a five-line timeline, the others behind "See another" |
| 5 | How it works (three steps) | Same |
| 6 | You are in charge (house rules) | Same, as one paragraph |
| 7 | What it costs | Same |
| 8 | On your own, or with someone | Same |
| 9 | Questions | Same, as an accordion |
| 10 | The idea box again | A sticky "Shape my idea" button once the hero has scrolled away; it returns to the box |
| 11 | Footer: tagline, Terms, Privacy | Terms, Privacy |

The departments, live sessions, journey, channel board and attribute ratings move to a second page ("How the team works", linked from the footer and from section 5) with the long-run example. They are good and true for the person they were written for. Delete the phone note about 1280 px; after P0-2 the phone page has nothing to apologize for.

### 3.3 The hero: three options

Each headline passed the three-question gate (can the reader picture it, can it be proven false, could a competitor write it). None uses a dash. [copywriting; humanizer]

| | Headline | Subhead | Angle | Must be true first |
| --- | --- | --- | --- | --- |
| A (recommended) | Start with one sentence. Leave with a page for your idea. | Type what you want to make. Your team of AI agents shapes it, rates it honestly and drafts its first page, live at a link you can send today. It is free to start, and you approve everything before it goes out. | Outcome and time | P0-1 and P0-2. Until a phone can publish, this is false for most readers. |
| B | Make something that is yours. | Say your idea in a sentence. A team of AI agents does the parts you have not learned yet: the research, the plan, the page. You make the decisions, and it costs nothing to start. | Ownership (the thesis, as subtext) | P0-1 |
| C | Your first project, started today, for $0. | Never built anything before? Foundmill is made for a first project. Say the idea in a sentence, and your team of AI agents turns it into a plan and a live page, then tells you what to do next. | Capability and zero price | P0-1 and P0-2 |
| Interim, true today | Say your idea in a sentence. See it shaped and rated in ten seconds. | Your first card is free and needs no sign-up. Foundmill is opening to a few people at a time, and your card holds your place. | The hook alone | Nothing |

The pill above the headline changes from "For founders · First company or fifth, the team comes with it" to "Free to start · No experience needed".

Code note: the `h1` is `APP_TAGLINE` today and a test pins it. Give the hero its own constant and keep `APP_TAGLINE` for the document title, the share image and the footer.

Title tag: "Foundmill | Start your first project with one sentence". Meta description: "Say your idea in a sentence. A team of AI agents shapes it, rates it honestly and drafts a page you can publish today. Free to start, no card."

### 3.4 Idea box microcopy

[signup: labels stay visible, placeholders are examples; marketing-psychology: endowment, zero price, activation energy]

| Element | Today | Proposed |
| --- | --- | --- |
| Visible label (phone; today it is screen-reader only) | "Your idea, in a sentence" | "What do you want to make?" |
| Placeholder on focus | "Describe your idea in a sentence" | "One sentence is enough. Rough is fine." |
| Typed examples | Eight, five of them software for businesses ("Bookkeeping for small cafes, done overnight", "Playtesters that try every build of an indie game") | Eight a first-timer could start with $0 and no code: "Sneaker cleaning for people at my school" · "A weekly email about cheap eats in Houston" · "Coding lessons for kids, online, two evenings a week" · "Candles that smell like places I have lived" · "Vintage band tees, found and resold" · "Meal prep for people who work nights" · "Dog walking in my neighborhood, booked by text" · "Study notes for my nursing class" |
| Button | "Shape my idea" | Keep |
| No idea | "No idea yet? Say what you are good at, or [Surprise me]" | "No idea yet? [Pick something you like]" and add four starts that are things a person can do, in the same list (`IDEA_BOX_INTERESTS`): "Teaching what I know", "Making things to sell", "Helping people near me", "Fixing or cleaning things" |
| Assurance 1 | "Your first card is free · no sign-up" | "Your first card is free and needs no sign-up" |
| Assurance 2 | "Your idea stays private until you choose to share it" | Keep |
| Assurance 3 (desktop only today) | "Nothing moves money or signs in your name without you" | Keep, and show it on the phone too |
| While drafting | "Shaping" | Keep |
| Weak idea | Honest numbers and one line on what would raise them | Keep. This honesty is the product's best proof. |
| Headline once the card lands | "<name> is yours to keep." | Keep |
| Under the card | "Sign in and it is saved to your account. From there your team checks it against real sources, drafts the plan, and starts building when you say so." | Open door: "Keep it and your team drafts a page for <name> next. You check it, publish it and have a link to send." Invite-only: "Foundmill is opening to a few people at a time. Sign in to hold your place and keep this card. We email you the day your place opens." |
| Buttons | Continue with Google, then "Continue with email" | Keep the order. Inside an in-app browser show email first (section 4.2). |
| Under the buttons | "Free to start · $5.00 of included credits · no card" | "Free to start. Your plan includes $5 of agent work every month. You never enter a card." |
| The three "unlocks" | "A researched version of this card, with sources" / "More directions to compare side by side" / "A team of agents to build it" | "A page for <name> at its own link" / "One decision at a time, each with a recommendation" / "A team of agents for the work you have not learned yet" |
| Not now | "Not now? This card waits on this device for 7 days." | Keep, and add "Email it to me" (address only, no account; section 8.4) |

Why the examples matter beyond tone: production's 13 real projects are 7 business software, 4 consumer apps, 1 marketplace, 1 media, and no services or physical products. The box's examples teach people to ask for software, software needs a connected code account and far more than $5 of agent work, and code tasks are the largest blocked kind. Examples that end in a page, a list of followers and a first reply are the ones a free user can finish.

### 3.5 Proof and examples

There is no customer proof and the page must not manufacture any: no testimonials, no counts (the founder's rule against public counts also applies, and the true counts would not help). What stands in for proof, in the order to earn it: [copy-editing: prove it; marketing-psychology: availability, pratfall effect]

1. The demonstration. The card appears before any ask. Keep everything that makes it honest.
2. A real page. No project has one, including Foundmill's own. Publish Foundmill's page first and link it as "See a real page".
3. Week-one examples, labeled "Example project" with the design system's Example tag, replacing the two-year-old companies in the hero.
4. The first five concierge founders' pages, with their consent (`showcase_consents` exists), replacing the examples one by one.

**Section copy.**

> ### What you have by the end of today
>
> **A card for your idea.** Its name, a one-line pitch and ten honest ratings, each with the evidence behind it. A weak rating comes with one line on what would raise it.
>
> **A page at its own link.** Your team drafts it from your words. You change what you like and publish it at foundmill.com/p/your-project. Hosting is free.
>
> **A short plan for the week.** What your team does next, and the decisions it needs from you, one at a time.

> ### A first week, from $0
>
> *Example project* · **Sole Revival** · Sneaker cleaning for people at one college
>
> - Day 1. Idea shaped and rated: 3 stars now, 4 with a waiting list. Page live. Link sent to two group chats.
> - Day 2. Nine people opened the page. Four left an email address to follow it.
> - Day 3. The team's suggestion: clean one pair for free and photograph it before and after.
> - Day 5. First email to the four followers, with the photos, sent from the project's own Foundmill address.
> - Day 7. Two replies asking for a slot. Money spent: $0.
>
> *Example project* · **Cheap Eats Houston** · A weekly email about meals under $10
>
> - Day 1. Page live, with a Follow form.
> - Day 3. The founder posts the link in two neighborhood groups. Fourteen followers.
> - Day 6. First issue sent to fourteen people.
> - Day 7. Three replies naming places to try. Money spent: $0.
>
> *Example project* · **Code Club Evenings** · Online coding lessons for kids, two evenings a week
>
> - Day 1. Card rated. Weakest rating: reaching parents. Page live.
> - Day 2. The team finds four parent groups and drafts a short post. The founder posts it.
> - Day 4. Six followers and two replies.
> - Day 7. First free trial lesson booked. Money spent: $0.

Every step but one uses something the code has: the card, the page, the Follow form with its confirmation, the project's sending address, a drafted post the founder shares by hand, replies. The exception is "nine people opened the page", which needs the private visit count in P1-3. None needs a payment account, a code account or a budget. Before shipping the email lines, confirm platform mail is on in production.

### 3.6 How it works

> ### How it works
>
> **1. Say it.** One sentence about what you want to make. No idea yet? Pick something you like and react to what comes back.
>
> **2. Check it and publish.** Your team drafts the page. You read it, change the words and publish. Nothing is public before that.
>
> **3. Decide, a little each day.** Your Chief of Staff, the agent that runs your team, brings you one decision at a time, with a recommendation and what each choice costs. The team does the work in between.

> ### You are in charge
>
> Your agents work inside house rules they cannot change. They never move money, sign anything, accept terms, file anything under your name, delete anything for good or change security settings. Anything that reaches another person waits for your yes. One button stops every agent at once.

### 3.7 Objections, as questions

[cro: objection handling; copy-editing: zero risk; marketing-psychology: regret aversion]

> **Does it cost anything?** Starting is free and you never enter a card. Your free plan includes $5 of agent work every month. If that runs out, your team pauses until the next month starts and your page stays live.
>
> **I do not have an idea yet.** Tap "Pick something you like". You get one honest idea to react to, and you can ask for other directions once you are in.
>
> **I have never done this. Will I know what to do?** Yes. Your Chief of Staff plans the work, explains each new term the first time it appears and tells you which decision is yours.
>
> **Can the agents do something in my name without asking?** No. They cannot move money, sign, accept terms, file under your identity, delete for good or change security settings, and anything that goes to another person waits for your approval.
>
> **Is my idea private?** Yes, until you publish your page. You choose what the page says and you can take it down whenever you like.
>
> **Do I need a company, a bank account or a website?** No. Foundmill hosts your page at a Foundmill address and gives your project an address to send email from. You can connect your own accounts later.
>
> **Does it work on a phone?** Yes. Your idea, your page and your daily decisions all work on a phone. The full workspace, with every department's detail, is built for a laptop.
>
> **Can I do this on my own?** Yes, all of it. If you would like someone to build it with, you can invite a friend or look for people here. That is your choice, and adding people is free.
>
> **What can it not do yet?** It takes payments only once you connect your own payment account, and it builds and ships an app only once you connect a code account. Your team tells you when a step needs one of those and what you can do in the meantime.
>
> **Who can use Foundmill?** Anyone 18 or older.

The phone answer is true only after P0-2. Until then use: "You can make and keep your card on a phone. Publishing your page needs a laptop for now."

### 3.8 The free plan, stated plainly

> ### What it costs
>
> Starting is free, and the free plan does not expire. You never enter a card.
>
> Your project gets $5 of agent work every month. That covers shaping your idea, drafting your page and about [N] rounds of work a month (Estimate).
>
> Free on every plan: your page at a Foundmill address, an address for your project to send email from, and as many cofounders and collaborators as you like.
>
> If the $5 runs out before the month ends, your team pauses until the next month starts. Your page stays live and nothing you made is lost.

`[NEED: N, from measured cost per round. The evidence points to 2 or 3 at today's model mix; section 7.1 says how to make it 5.]` Add "You can add more agent work, or use your own model key, whenever you want" only after confirming top-ups take real payments in production.

> ### On your own, or with someone
>
> You can do all of this by yourself. Your team covers the work. If you would like someone to build it with, invite a friend or look for people here. Adding people is free.

### 3.9 Calls to action

| Place | Today | Proposed |
| --- | --- | --- |
| Top bar | "Start your business" to `/login` | "Shape my idea", focuses the box |
| Hero | "Shape my idea" | Keep |
| After the card | "Continue with email" | "Keep my card" as the group's heading, then the two sign-in buttons |
| Mid-page link | "Or watch an example run" | "See a real page" (Foundmill's own, once published) |
| Closing | "Start your business" and "Sign in", then "Sign in with your email. No password, no card. Start from an idea or bring the business you already have." | The idea box again under "Start with one sentence.", then "Your first card is free and needs no sign-up. Foundmill is for people 18 or older." |
| Import (experienced founders) | In the closing line | A footer link, "Already running something? Bring it in." |

### 3.10 The phone page

It is the same copy in one column, in the order of 3.2, with three rules: the hero and the box fit above the fold at 390 by 844 with the keyboard closed; the card and the sign-in buttons appear in place without a scroll jump; every section stands on its own if the reader lands in the middle from the sticky button. Nothing on it mentions screen width. The check is a Playwright run at 390 px: every section renders, there is no horizontal scroll, and the sticky button returns focus to the field.

### 3.11 What the editing passes changed

Humanizer, embedded mode, on all copy in sections 3, 4, 6 and 7. No dashes survive. Examples of what it caught in my first draft:

| Draft | Tell | Final |
| --- | --- | --- |
| "No money needed, and nothing goes out without your say." | Negation list | "It is free to start, and you approve everything before it goes out." |
| "No card, no trial clock." | Negation list | "You never enter a card, and the free plan does not expire." |
| "Free. No card. 18 or older." | Row of fragments | "Your first card is free and needs no sign-up. Foundmill is for people 18 or older." |
| "It's not a chatbot plan, it's a page." | Not X but Y | Cut. The page is described; the comparison is left to the reader. |
| "That is the whole point." after the first-week examples | One-line closer | Cut |
| "Your team shapes it, builds it and runs it" | A three that is not true for a free user | "shapes it, rates it honestly and drafts its first page" (three things that happen) |

Seven sweeps, then the four-persona panel from the copy-editing skill on the option A page: conversion copywriter 8 (one action, price stated early), UX writer 8 (labels visible, every wall has words), brand strategist 8 (ownership and capability carry the thesis without naming it; solo reads as complete), target customer 7. The 7 is the proof gap: the examples are examples. It closes only with real pages, which is why publishing Foundmill's own page and the concierge cohort come before any traffic. I also checked the copy by eye against the vocabulary table (project, team, People, Chief of Staff, no football terms, US spelling); run `node scripts/banned-terms.mjs` and `node scripts/us-english.mjs` when it lands in components.

## 4. Sign-up and "Before you start"

Flow type: freemium, consumer, passwordless (Google, or an email link with a six-digit code). The sign-in page itself is close to the skill's ideal: one field or one button, no password, no card. The damage is done after it. [signup]

### 4.1 Field by field

Profile form (`apps/web/components/onboarding/profile-form.ts`, `OnboardingScreen.tsx`), desktop only today:

| Field | Today | Verdict | How |
| --- | --- | --- | --- |
| Name ("What the team calls you") | Required, prefilled from the email | Keep, infer | Prefill from the Google profile's given name, else the email's local part. Ask on the kept-card screen. |
| 18 or older | A box on the form | Keep (binding rule) | Same screen as the name. One tap, once. |
| Experience (first-time, exited, operator, domain expert) | Required, four cards | Default | "First-time founder", guidance on. The other three labels are jargon to this reader. An experienced founder changes it in Settings. |
| Time you can give | Required, four cards | Defer | Default "A few hours a week". On day 1 the Chief of Staff asks "How many hours can you give this week?" as a note, and the plan visibly changes with the answer. |
| Residence | Optional; derives currency and first market | Infer | From the request's country and the browser's locale and time zone. Show it as one editable line later. |
| Citizenship | Optional | Cut from the first run | It matters when a legal step arrives. Ask then. |
| Five skills, rated 1 to 20 | Optional section | Cut from the first run | The idea box already takes "what you are good at" in words. On day 3 ask for strengths as three tags, the shape THESIS 12.3 wants for the person profile. |
| Budget and currency | Optional section, with "I have no budget yet" | Default | No budget. Never ask in session one: a budget field in front of someone with $0 reads as a price of entry. Ask at the first real spend decision. |
| Target markets | Optional | Infer | Already derived from residence. |
| Constraints | Optional chips | Defer | Settings. |
| Risk appetite | Prefilled "Medium", inside the optional section | Default | Low for a profile with no budget. The label means nothing to a first-timer. |

Commit screen (`apps/web/components/new/commit/CommitScreen.tsx`, `naming.ts`), desktop only today:

| Field | Today | Verdict | How |
| --- | --- | --- | --- |
| Business name | Required, with suggestions | Keep, prefilled | The card's name, labeled "Project name". Editable on the page screen. |
| Domain availability and the trademark quick screen | A panel | Defer | To the day the founder wants a domain. Showing .com availability to someone with $0 invites a spend. |
| Logo and brand colors | A panel; generating marks is one Opus call per set | Default | The initials mark and seeded colors (`kitFromSeed`). Offer "Pick your logo" on day 3 as a reason to come back. |
| Personal or live | Radio, plus an adult check for the network | Default | Personal. |
| Kind of business (archetype) | Required cards | Infer | The card already carries it. |
| Business mode | Augmented, Assisted (default), Automated | Default | Keep Assisted. The count of asks is the problem, not the mode (section 5.3). |
| Spend cap per action | Default €250 (`approvalThresholdMinorDefault: 25000`) | Default to 0 | For a profile with no budget: every spend asks first. "Asks you above €250" contradicts "$0" on the same screen. |
| Overnight shift (Autopilot) | On by default (`initialCommitForm`): one round of work each night, news every morning | Keep on for the first night, then weekly on the free plan | The first night gives the day-1 email something real. A round every night would use the month's $5 in two to six nights (Estimate, section 7.1), so the free default after that is one round a week, and the founder can choose nightly. |
| "Day one" panel | 25 to 27 agents listed, and "Up to $X a month in wage caps" | Cut | By `WAGE_CAP_FOR_FAMILY` a team this size sums to several thousand dollars a month (Estimate, from the family caps), shown beside "$5.00 of included credits". It is the most frightening number in the product and it is not a price. |
| "Take charge" | Button | Replace | "Draft my page", on the kept-card screen. |

Session one then asks for two things after the idea: a name that is already filled in, and the age box.

### 4.2 Social sign-in

Keep Google first and the email code second. Two changes:

1. In-app browsers. A young audience arrives from links inside TikTok, Instagram and messaging apps. Google refuses sign-in inside embedded web views, and an emailed link opens in a different browser from the one holding the card. The repo already handles the second case (the claim token and the typed code). Detect an in-app browser, hide the Google button there, and lead with "We email you a six-digit code". Check by hand in two in-app browsers; track `account.signed_up.method` and `in_app_browser`.
2. Apple. Add it when the native app ships, where a store rule will require it beside Google. Not before: it is one more thing to maintain for a web flow with one sign-up in two weeks. [karpathy: nothing speculative]

### 4.3 The door: waitlist or open

| Option | What the person meets | Risk to the platform's model key | Verdict |
| --- | --- | --- | --- |
| A. Invite-only, as today | A hook, then an unannounced refusal, then a promise of an email that nothing sends | None | Stop. It spends the idea box's goodwill and teaches nothing: 0 waitlist entries. |
| B. Invite-only, honest, with daily hand admission | "A few people at a time" said before sign-in; the waitlist joined automatically; the founder admits 5 to 10 a day and watches their sessions | None beyond today's | Do this week (P0-1). It is also the concierge plan in section 9.2. |
| C. Open, with a small daily ceiling | Most people walk in; past the ceiling, "today's places are taken, we email you tomorrow" | Bounded: see below | Do next, at 25 a day, once the two guards below exist. This is the founder's own Nov 11 decision ("open once per-account spend ceilings and reporting exist"); I am recommending the ceiling start at 25, not the default 200. |
| D. Fully open | No wall | Unbounded | Not yet. |

The exposure, from the code. In a project, a free account's spend is capped: $5 a month, for one project per founder (`includedCreditBusinesses: 1`), and the team pauses at zero. Before a project exists it is not capped in dollars: the ideation studio allows 20 drafts an hour and 60 a day per person on the platform key (`IDEATION_LIMITS`), each a set of 6 to 12 cards. The idea box is capped at $20 a day across all visitors.

- Worst case per new account per month: $5 of project work, plus ideation with no dollar limit. Guard 1: a dollar ceiling per account before commit (for example $1, Estimate), and three directions per draft for first-time founders instead of 6 to 12.
- Worst case per day at the ceiling: 25 accounts times $5 is $125 if every one drains its month on day one. At the spend the twelve credit projects showed ($0.57 to $7.36 each over their lives) the realistic figure is $25 to $50 a day (Estimate). At 200 a day the worst case is $1,000.
- Many addresses, one person: the deploy notes already name per-domain caps and a captcha. Turnstile runs on the idea box; run it at sign-up too. Guard 2: a daily ceiling on total free agent work across the platform, like the idea box's $20. When it is reached, new projects are told "your team starts tomorrow morning" and nothing fails.
- Cheaper first sessions make every figure above smaller: route session-one work to the lower-cost models the routing table already names for low credits (section 7.1).

### 4.4 What the person sees at each wall

| Wall | Words today | Proposed words | Needs |
| --- | --- | --- | --- |
| Before the card, while invite-only | Nothing | Under the box: "Foundmill is opening to a few people at a time. Your card is free now and we hold it for you." | Copy only |
| Not on the list | Title "Invite only for now". "<email> is not on the list". "Join the waitlist and we will let you in as soon as there is room. If you made a card on the home page, it is kept for you." Button "Join the waitlist". | Title "Your place is saved." Body: "We are letting people in a few at a time so that every project gets real agent work. Your card for <name> is kept for 90 days. We email <email> the day your place opens." Secondary link: "See an example week". No button needed. | Join on arrival; the admission email |
| The day's ceiling (open mode) | "You're on the list. We'll let you in as soon as there is room. Come back tomorrow to check." | "Today's places are taken. Yours opens tomorrow, and we email you when it does. Your card is saved." | The admission email |
| Address not confirmed | "This address is not confirmed yet. Open the link we sent to it, then sign in again." | Keep | |
| 18 or older (existing accounts) | "Before you continue. Foundmill is for people 18 or older. Confirm it once and we won't ask again." | Keep | |
| A desktop-only screen on a phone | "This needs a larger window. Foundmill is built for desktop screens at least 1280 px wide. Widen the window or move to a larger display. Current width: 390 px" | Never on the path to a live page. Elsewhere: "This part is built for a laptop. [Email me a link to it] [Back to Today]" | P0-2; a small change to `NeedsLargerWindow` |
| The month's agent work is used up | The team pauses with a credits notice | Section 7.3 | |

Admission email. Subject options: "Your place on Foundmill is open" / "You are in, and <name> is waiting". Preview: "Your card is saved in your account." Body: "Hi. Your place opened today. Your card for <name> is saved in your account. Sign in with <email> and your team starts on its page. Your place does not expire." Button: "Open my card". [emails: one email, one job]

## 5. The first session

### 5.1 The ideal first ten minutes, from the person's side

| Time | What they do | What they see | What they feel |
| --- | --- | --- | --- |
| 0:00 | Open a friend's link on a phone. Type "sneaker cleaning for people at my school". | The headline, one field, three short assurances. | "I can try this without signing anything." |
| 0:10 | Read. | A card: a name, a pitch, stars now and with work, ten ratings, one line on the weakest. | "It took my idea seriously, and it didn't flatter me." |
| 0:40 | Tap "Continue with Google". | One tap. | Nothing, which is right. |
| 1:10 | Check the name, tick the age box, tap "Draft my page". | "Sole Revival is yours." One prefilled field, one box, one button. | "That was the whole form?" |
| 1:20 | Read the page. | A page preview built from their own words, at once. One voice: "Hi Maya. I'm Orla. I run your team. This is your page. Change any words you like. Nothing is public until you press Publish." The team's better draft replaces the starter within a minute. | "This looks like a real thing." |
| 3:00 | Change one line. Pick the address. | foundmill.com/p/sole-revival | Ownership: these are my words. |
| 4:00 | Tap Publish, confirm. | "Your page is live." The link, Copy link, Share, and a message already written. | The peak. |
| 5:00 | Share to a group chat. | The phone's share sheet. | A small risk, taken. |
| 6:00 | Look at Today. | "Your first week": idea shaped, card kept, page live, sent to someone, all checked. Next: "Tomorrow: what your team found, and one thing to do." At most one note waiting. | Progress, and nothing hanging over them. |
| 8:00 | Read one message. | "Tonight I'll check three things about your idea against real sources and draft your week. That uses about $0.40 of this month's $5 (Estimate). I'll email you in the morning." | "I know what happens next and what it costs." |
| 10:00 | Close the tab. | | Has a link. Has a reason to open tomorrow's email. |

[onboarding: one goal per session, peak-end rule, endowed progress; marketing-psychology: IKEA effect, goal gradient]

### 5.2 What the code does now

On a desktop: the card, sign-in, "Keep this card?", "<name> is yours" and "Answer three questions about you"; a profile screen with three required answers, where you live, the age box and an optional section of ten more; a redirect to the doors page, where the kept card has to be found again; a commit screen with a name check against domains and trademarks, a logo, five "How it runs" controls and a list of 25 to 27 agents with a wage total; "Take charge"; a wait of a minute or two; then Today with 4 to 17 notes, two of them asking for sign-off on a specification and a roadmap, and one saying the page is ready; then a department tab to edit and publish it. The first-week panel (`first-week.ts`) does put the page first on Day 1, which is right, but it sits beside everything else.

On a phone: the card, sign-in, the kept card, then "This needs a larger window".

For a stranger on any device: the card, sign-in, "Invite only for now".

### 5.3 Changes, in priority order

1. A phone-width path from the kept card to a live page (P0-2).
2. The project is created with defaults when the person presses "Draft my page" (P0-3).
3. The page comes first and alone. The specification and roadmap sign-offs wait until the page is live or until day 1, whichever is later.
4. One voice and a small team on day one (below).
5. A decision budget: at most one open decision when session one ends, at most three open at any time.
6. An explicit end to the session: what was done, what happens tonight, what it costs, when the email comes.

**25 agents and up to 17 notes on day one.** Hire lazily. On day one the person meets the Chief of Staff and nobody else. An agent appears the first time it finishes something real, with one line ("Ines wrote your page"). The rest of the roster exists as templates and is hired when its first task is ready. This also cuts cost and noise: each hire writes 13 to 16 skill rows, and `agent.health_changed` fired 744 times across real projects. Notes on day one collapse into one digest from the Chief of Staff ("what your team did today") plus the page. `LIMITS.inboxBufferSize` is already 3; it bounds the composer's buffer, not what a founder receives. Make three the founder-facing limit in the first week. Check: projects created after the change have a median of 3 notes or fewer on day one and 5 or fewer agents at commit.

**Decisions that pile up unanswered.** 113 of 127 approval requests were never answered. By tool: `launch_campaign` 79, `request_human_action` 36, `merge_pr` 12. Most are asks the founder could not act on: campaigns where the integrations table shows no real channel connected, merges where only one project has a repository, "do this by hand" tasks with no context. Four changes, smallest first: (a) do not create an approval whose precondition fails (no connected channel, no repository); the repo already knows when no channel can run (`noChannelCanRun`, `channel-availability.ts`). (b) Batch: 79 campaign asks become one note, "Ready to start reaching people? Here is the first message." (c) Expire: an unanswered, non-blocking ask is set aside after 7 days with one quiet line, and Today says so. (d) Keep the one-click answers the repo has (from Today and from email) and count the answer rate. Check: decisions answered within 48 hours, of those created in a project's first week, rise from 11% to 70%.

**A first-timer who has no idea.** Before sign-up, "Pick something you like" already works. After sign-up it breaks: `/home` works on a phone, its main button "Start something" opens `/new`, and the studio is desktop only and drafts "6–12 ideas", which is a wall of choice. Put the idea box itself on `/home` (the same component, signed in), show three directions for a first-time founder, and add six starter projects that need $0 and no code (lessons, cleaning, a local email, resale, pet care, tutoring) as prewritten sample cards, which cost nothing to show. Check: a phone can go from `/home` to a kept card without a desktop wall; the share of admitted accounts with no idea kept after 24 hours falls.

**A first-timer with $0.** Defaults say it: no budget, spend line 0, no wage totals, no domain or trademark panel. The plan says it: free channels and the founder's own messages first, and any option that costs money appears beside one that does not. The examples say it (section 3.4). And the idea itself is steered: for a profile with no budget, the first-week plan is "show it to people before building it" (page, Follow form, five conversations), with no code tasks. Check: for no-budget projects, zero approval requests with a cost above $0 in the first week, and zero `task.blocked` of kind code.

## 6. Coming back

### 6.1 What exists, and its rules

One sender (the gateway's `POST /v1/notify/email`), eight kinds (`EMAIL_NOTIFICATION_KINDS`: `decision_waiting`, `win`, `milestone`, `run_finished`, `credits`, `daily_brief`, `weekly_review`, `invitation_accepted`), each with its own switch and a pause-everything link. At most three a day per person and one a day per project for the limited kinds; the morning brief and the Monday review do not count. Never sent while the person is in the app. Every email is about something real in a started project, and one-click answers exist for recommended, reversible, free, internal options. This is a sound base, and the plan below stays inside it. [emails; churn-prevention: proactive interventions]

The gaps: (1) nothing is sent to a person who signed up and has no project, or who has a project and no news; the brief is skipped when there is nothing to report, so a quiet project gets silence, which is when a nudge is needed. (2) No email tells a waitlisted person they are in. (3) No email is sent after 14, 30 or 60 days away. (4) I could not confirm platform mail is on in production; if `PLATFORM_MAIL_DOMAIN` is unset, none of this has ever been sent. Check `founder_notifications` for rows with status `sent`.

Smallest addition: three kinds. `getting_started` (setup help in the first week; label "Help while you set up"; counts toward the daily limits), `checkin` (a project that has gone quiet; counts), `admitted` (one message answering the waitlist; no switch needed, like `invitation_accepted`). Each lifecycle email carries a real thing (the card, the drafted page, a finding, the week), so the rule "about something real" holds.

### 6.2 The plan

| When | Trigger | Audience | Kind | The one action | Stops when |
| --- | --- | --- | --- | --- | --- |
| Day 0, 30 min after the last ping | `account.signed_up`, no `page.published` | Admitted, card kept or project created | `getting_started` | Check my page | Page published; kind off; emails paused |
| Day 0, at publish | `page.published` (the "Page live" milestone already exists) | Activated | `milestone` | Share my page | Sent once |
| Day 1, 8 AM local | First morning after sign-up | Page live | `daily_brief`, first edition | Open Today | Brief off; person present |
| Day 1, 8 AM local | Same | No page live | `getting_started` | Check my page | Page published |
| Day 3 | 72 h after sign-up, no second real outcome, no brief or win sent that day | Page live | `getting_started` | Copy the message | A second real outcome |
| Day 3 | 72 h after sign-up, still no page | No page live | `getting_started`, from the founder, plain text, replies read | Reply with one line | Page published. This is the last setup email. |
| Day 7 | Seventh day, whatever the weekday | Any project | `weekly_review`, first edition | Answer the oldest decision, or publish | Review off |
| Weekly | Monday (exists) | Projects with a visit or an outcome in the last 14 days | `weekly_review` | Open Today | Two weeks with neither: move to check-ins |
| Day 14, 30, 60 without a visit | `founder_visit_days` gap | Any project, not archived | `checkin` | One per email: publish, tell us why, keep or archive | A visit; after the third, nothing more |
| Admission | `waitlist_entries.admitted_at` set | Waitlisted accounts | `admitted` | Open my card | Sent once |

Rules across all of them: at most one `getting_started` a day and four in total; priority under the three-a-day limit is a decision holding up work, then a win or milestone, then `getting_started`, then `checkin`; an email is skipped the moment its action has been done; three lifecycle emails with no return through their links end the sequence early. Subjects hold up as the only line read. No emoji, no fake replies.

### 6.3 The emails

**Day 0, no page yet.** Subject: "Your card for {idea} is saved" or "{idea}: your page is two minutes away". Preview: "Next: read the page your team drafted and publish it."

> Hi {name},
>
> {idea} is saved in your account. Your page for it is drafted from your own words. Read it, change what you like and publish it, and you have a link you can send to anyone. Nothing is public until you press Publish.
>
> [Check my page]
>
> {chief}, Chief of Staff for {idea}

**Day 0, page live.** Subject: "Your page for {project} is live" or "Your link for {project}". Preview: "Send it to three people and ask one question."

> Hi {name},
>
> {project} has a page: {url}
>
> Send it to three people who might want this and ask whether they would use it. What they say shapes what your team does next. Tomorrow morning I'll send you what the team found overnight and one thing to do.
>
> [Share my page]

**Day 1, page live (the first morning brief).** Subject: "{project}, day 2: one thing to do today" or "What your team found about {project}". Preview: "{n} people opened your page. One decision is waiting."

> Good morning {name}.
>
> What worked. Your page went live yesterday. {n} people have opened it. Only you see that number.
>
> Waiting on you. {decision subject} [Answer in Today]
>
> Today's one thing. Ask five people the question on your page. A message you can paste: "I'm starting {project}. {pitch} Would you use this? {url}"
>
> Behind the scenes, your team checked three claims on your card against real sources and drafted your week.

The count of people needs `page.visited` (P1-3). The answer is a one-click button only when the option is one `oneClickOption` allows; otherwise it is a link.

**Day 1, no page yet.** Subject: "Pick up {idea} where you left it" or "Two minutes to put {idea} on a page". Preview: "Its strongest rating was {top}. Here is the next step."

> Hi {name},
>
> Yesterday you shaped {idea}. Its strongest rating was {top}. Its weakest was {weak}, and {weak line from the card}
>
> The next step is small. Your page is drafted from your own words; read it and publish it. If now is a bad time, your card and your draft stay where they are.
>
> [Check my page]

**Day 3, page live, nothing since.** Subject: "Five people, one question" or "The quickest way to learn if {project} works". Preview: "A message you can copy, and where to send it."

> Hi {name},
>
> Your page has been live for two days. The most useful ten minutes you can spend this week are these. Send the link to five people who might want {project} and ask whether they would use it.
>
> "I'm starting {project}. {pitch} Would you use this? {url}"
>
> When someone follows your page or replies, I'll tell you the same day.
>
> [Copy the message]

**Day 3, no page yet, from the founder.** Subject: "Did something get in the way?" or "A question from the person who built Foundmill". Preview: "One line back would help me fix it." Plain text, with a reply address someone reads; the standard line "Replies to this email don't reach the team" must not appear on it.

> Hi {name},
>
> I'm {founder's first name}. I built Foundmill. You shaped {idea} three days ago and stopped before the page. I'd like to know why, because the next person will stop in the same place. Was it the phone, the questions, the idea, or something else?
>
> Reply with one line. I read every reply. If you want to pick it up, it is where you left it: [Open {idea}]

**Day 7, the first week.** Subject: "{project}: your first week" or "Week one of {project}, in four lines". Preview: "What exists now, what is waiting, and next week's one goal."

> What exists now. Your page ({url}), {followers} followers, {replies} replies.
>
> What your team did. {one line}
>
> Waiting on you. {count} decisions. The oldest: {subject} [Answer]
>
> Next week. {goal}

When nothing real happened, the first section reads: "Nothing reached the outside world this week. That is common in a first week, and it takes two minutes to change: publish your page."

**Check-ins.** Day 14: "{project} is still here", with one real change since they left and the one action it makes possible. Day 30: from the founder, asking why, replies read. Day 60: "Keep {project} or archive it?", two buttons, and then no further email unless the person returns.

### 6.4 Reasons to return, inside the product

| Hook | State | What it gives |
| --- | --- | --- |
| "{n} people opened your page", shown to the founders only | Needs `page.visited` (P1-3). No public count, per the founder's rule. | The first sign the outside world answered. The strongest reason to open the app on day 1. |
| Followers and replies, told the same day | `page.followed` and `lead.replied` exist; the `win` email exists | A reward that comes from people |
| One finding a morning ("what I found") | The overnight shift exists and is on by default. It needs to fit inside the $5 (section 7.1) and to lead its morning news with one finding. | Something new that did not exist yesterday |
| One thing to do today, from the Chief of Staff | Not built (THESIS R7, the founder task). I found no code for it. | An easy action with a clear end |
| The first-week panel, starting part done | `FirstWeekTimeline` exists; add "Idea shaped" and "Card kept" as done steps | Endowed progress: two of five before they begin |
| "Pick your logo" on day 3 | Logo generation exists at commit; move it | A light, personal choice |
| Milestone cards: page live, first follower, first reply, first dollar | `/m/<id>` and "Page live" exist | Pride, and something to share |
| The daily streak | `StreakStrip` exists | Keep as the only streak |
| "Since you were last here" | `SinceLastVisit` exists | A returning person is oriented in one glance |

### 6.5 Win-back for the 11 stalled projects

Ten owners, eleven projects, all created Oct 5 to 25, before public pages existed. Each holds 4 to 17 notes from day one, almost all unanswered, and most of November's $5 unused. This is a list short enough to handle by hand, which is what the churn-prevention skill prescribes for a small, high-value group. [churn-prevention: detection, human touch; emails: re-engagement]

1. Clean the room first. Set aside the stale approval requests and day-one notes on those projects so a returning founder sees one screen: what changed, and "Check my page". Do not email until the phone path (P0-2) works.
2. One personal email from the founder, plain text, replies read.

   Subject: "{project} can have its page now" or "What changed since you started {project}".

   > Hi {name},
   >
   > I'm {founder's first name}, the founder of Foundmill. You started {project} on {date}, and I think we lost you on the first day. Your team sent you {n} notes at once, and none of them led to anything you could show someone. That was our mistake.
   >
   > Since then, every project gets a public page at its own link, and your team asks for one decision at a time. {project} is still here, with most of this month's $5 of agent work unused. Its page is drafted from what you told us in October and takes about two minutes to check and publish: [Check my page]
   >
   > If you would rather tell me why you stopped, reply to this email. I read every reply.

3. Seven days later, a second note to those who did not come back, with the one thing that changed since. Twenty-one days later, "Keep {project} or archive it?", then stop.
4. Ask each of the ten for fifteen minutes. They are the first interviews in section 9.2.

Check: within 30 days, at least 3 of the 10 owners visit, at least 2 publish a page, and at least 3 reply with a reason. Fewer than that is also a result: it says the first impression was final, and the effort belongs with new people.

## 7. Money

### 7.1 Making $5 read as generous, and be clear

What $5 buys today, from the usage ledger (Estimate): an Opus session on a real project averaged $0.41 and a Sonnet session $0.14. Foundmill's own project ran 224 sessions over 41 rounds of work, about 5.5 sessions a round. A round therefore costs roughly $0.80 on the cheaper model and $2.25 on the dearer one, and at the current mix $5 is two or three rounds a month. Eleven projects ran one to three rounds on their first day. A free project can spend most of its month before the founder has seen anything outside the product. Check how many of the twelve credit projects reached a zero balance in October; if any did on day one, the first paywall arrived before the first outcome. [pricing: the value metric must track value received]

1. Make it go further before making it bigger. Every route in `packages/models/src/routing.ts` already names a lower-cost model for low credits. On the free plan, use it for routine work from the start and keep the stronger model for what the founder reads (the page, the brief). Target: session one at $0.50 or less, a weekly round at $1.00 or less. Then $5 is the first session plus a round every week, which is a sentence a person can repeat.
2. Say it as work, with the dollars beside it. "Your team does a round of work every week, free ($5 of agent work a month)." The meter reads "3 of 5 rounds left this month", dollars second. Never "credits" on its own.
3. Never show a sum of wage caps to a person on the free plan.
4. List what is always free: the page and its address, the project's sending address, people, the card, answering decisions.
5. Say what happens at zero before it happens: the team pauses, the page stays, the month restarts on a date.

### 7.2 The first paywall moment

It should be the day a founder who already has a real outcome wants the team to do more than the month allows. Value first, then the ask, and an easy no. [paywalls]

> Your team has used this month's $5 of agent work. It starts again on {date}.
>
> This month it wrote your page, checked three sources and drafted two emails.
>
> Your page stays live, and you can still answer decisions and do your own tasks.
>
> [Add $5 of agent work] [Wait until {date}]

A quiet third option under the buttons: "Use my own model key". The second moment is the "Built on Foundmill" mark, offered once on the page screen, since removing it is the one difference between plans outside agent work.

It must not be: anything about people (inviting, the number of cofounders or collaborators, a shared project); publishing a page or keeping it live; answering a decision or exporting; anything in session one; a proposal that costs more than the month has left (the one real training run asked a free founder for $12.78); a stop in the middle of a round (let it finish); a countdown or any invented urgency; a screen without a plain way to continue for free.

### 7.3 Pricing page structure

Value metric: agent work. It scales with the value received and it is the only thing plans may differ by, so tiers are amounts of it. Per-person pricing is ruled out by CLAUDE.md. [pricing]

1. Headline: "You pay for agent work. People, your page and your project's address are free on every plan."
2. Three columns, prices in text: Free ($0, $5 of agent work a month, one project draws on it, 4 agents at once, the small mark shown), Pro and Scale (more agent work, 3 projects and unlimited, 16 and 64 agents at once, no mark). While prices are open, show "Price to be announced" (the label exists) with one question, "What would you want more agent work for?", which doubles as demand research.
3. A row across all columns: "Free on every plan: cofounders and collaborators without limit, your public page, your sending address."
4. "What does $5 of agent work do?": one real week's ledger from a project, line by line.
5. More agent work without a plan: top-ups and your own model key.
6. Questions: what happens when it runs out, does unused work carry over (today a paid top-up expires at month's end; decide and say), do people cost anything, how to stop.

### 7.4 What to measure before prices are set

Cost of session one and of a weekly round, median and 90th percentile, from `usage_ledger`. The share of free projects that use up the $5, and on which day of the month. What people do at zero (wait, press the top-up button, add a key, leave): the button can measure intent before payments exist, if it says plainly that top-ups are not open yet. Whether a pause ends the project (return rate after a pause against no pause). The first-dollar rate, since willingness to pay will follow whether projects earn. The four Van Westendorp questions, asked only of activated founders, and read only once 30 have answered. Then choose a first price to learn from in the $10 to $20 range for this reader, tested on new sign-ups only; do not open at $9. [pricing: pick a price you can learn from]

## 8. The loop

### 8.1 Where Foundmill sits

On the natural end of the referrals skill's spectrum: what a founder makes here is public by design (a page, a card, a post), so use of the product shows it to people who do not have it. That argues for mechanics built into the product before any reward program. The repo has most of them, and none has ever run: `project_pages`, followers, posts and invitations are all at 0 rows. [referrals]

| Mechanic | In the repo | Safe for a solo founder | Smallest version |
| --- | --- | --- | --- |
| The page carries "Built on Foundmill" on the free plan | Yes (`tierShowsBuiltOnMark`) | Yes, it needs nobody | Make the link land on the idea box with one line above it: "{project} was built here. Start yours with one sentence." |
| Share at the peak | "Share your page" and `share.opened` exist, on a desktop tab | Yes | Put it on the "Your page is live" screen, on a phone, with the message written and the question "Would you use this?" |
| Milestone cards | `/m/<id>` and "Page live" exist | Yes | Offer the card once, when the milestone is reached. No counts on it. |
| Invitations | `/i/<token>`, with admission, exist | Yes, if it stays an offer | One line, shown once, after the page is live: "Want someone to build this with? Invite them. Adding people is free." Never a checklist item, never a meter. |
| Arriving through someone's link | `referral.arrived`, `signup.attributed` exist | Yes | A person who arrives through a page, card or invitation skips the waitlist, within the per-inviter daily limit the repo already has. This is the founder's "waitlist ordered by referral". |
| Agent work for bringing someone | Planned (NETWORK loop 7), not built | Yes | Not yet. See below. |

### 8.2 The smallest version worth shipping

No reward program. Ship the first, second and fifth rows: the share at the peak, the mark's landing, and the waitlist skip. All three reuse what exists. Add rewards only after the natural loop has numbers, and then: both people get agent work, paid when the new person publishes a page (a real outcome, not a sign-up), at most three a month per person, said as "a second month of agent work" since that sounds larger than "$5". The cap and the trigger matter because the reward is spent on the platform's model key, and a reward on sign-up would pay people to create accounts. [referrals: reward at the milestone; marketing-psychology: the cobra effect]

Measures: shares per newly live page in week one; outside visits per share; sign-ups per 100 outside visits to pages; the activation rate of people who arrived through a link against those who did not; new activated people per active person per month.

### 8.3 The idea box as a free tool

Scored on the free-tools card: search demand 4, audience match 5, uniqueness 3, path to the product 5, feasibility 5 (it is built), upkeep 3, link-worthiness 3, share-worthiness 4. Total 32 of 40, a strong candidate. Four things keep it from working as one: it has no name or address of its own to search for or link to (give the landing page the title "Rate my idea" for search, or a route `/idea`); a card cannot be shared (the card page leaves a slot; a shared card must be the person's explicit choice, since the box promises privacy); a visitor who is not ready has no way to keep the card except an account (add "Email it to me", address only); and at $20 a day the tool goes dark the first time it is popular (when the ceiling is reached, show a prewritten sample card, say plainly that it is a sample, and take the address). [free-tools: ungated with optional capture; budget for upkeep]

## 9. Experiments

### 9.1 The first five tests, once there is traffic

Sample sizes are per arm, for 95% confidence and 80% power, from n ≈ 16·p(1−p)/δ². Baselines are assumptions until section 2.6 runs. Fixed horizon, no early stopping, assignment kept per browser before sign-in and per account after. The landing page is prerendered, so assign in `proxy.ts` with a cookie and serve a prerendered variant; do not swap copy in the browser. [ab-testing]

| # | Hypothesis | Arms | Primary metric | Guardrail | Sample per arm |
| --- | --- | --- | --- | --- | --- |
| T1 | Because the tagline names a category and not a first outcome, a headline that promises a page today will get more first-timers to type an idea. | Tagline against hero A | Shape rate: `idea.shaped` per landing visitor | Activation rate per card must not fall | 1,600 visitors (10% to 13%); 690 if the lift is 50% |
| T2 | Because the profile form sits between the card and the page, asking only for a name and the age box will raise the share who publish. | Four questions first against name and age only | Page-live rate within 24 h per admitted account | Day-7 return; pages held by the publish screen | 300 accounts (25% to 35%). About 3.5 weeks at 25 admissions a day. |
| T3 | Because sharing is a tab away from publishing, a written message on the "live" screen will raise shares. | Copy link only against share sheet with a written message | `share.opened` (page) within 24 h per `page.published` | Pages taken down within 24 h | 150 published pages (30% to 45%) |
| T4 | Because a new project gets no email unless it has news, a morning message with one finding and one task will bring more people back on day 1. | No email against the first brief | A visit on day 1 or 2 per activated account | Pause and unsubscribe rate | 260 accounts (20% to 30%) |
| T5 | Because "credits" means nothing to this reader, stating the free plan as weekly work will raise the share who keep their card. | "$5.00 of included credits" against "a round of work every week, free" | `idea.kept` per `idea.shaped` | Share of projects paused for credits in month one | 710 cards (20% to 26%) |

The day-one team (one voice and three notes against 25 agents and 17) is not on this list. The evidence for the change is strong and the control is known to fail, so ship it and compare the cohort before and after as a directional reading. Below about 1,500 landing visitors a week, T1 and T5 cannot be read; do not run them.

### 9.2 Before there is enough traffic to test

1. Five founder interviews, twenty minutes each. Start with the ten stalled owners, then people who match the target (18 to 24, no business experience). Ask about the last time they tried to start something: what they did first, what they expected here, where they stopped and why, what they would have wanted to show a friend, what else they have tried. Write their exact words into the Customer Language row of section 1.1 and replace my assumed quotes.
2. A concierge first session, five times. The founder watches a target user go from the landing page to a live page on their own phone, saying nothing unless they are stuck. Record the time at each step of section 2.2, every question asked and every hesitation. Pass: four of five have a page live and shared within 15 minutes. Admit these five by hand; this is option B in section 4.3.
3. Send the day 1, 3 and 7 emails by hand to those five, from the founder's own address, before automating any of them. Keep the ones that brought someone back.
4. The founder runs the phone path on a new account every week. It is the "founder zero" principle applied to the first ten minutes.
5. Instrument first (P0-5), so that the five concierge sessions are also the first five rows of the funnel report.

### 9.3 Launch readiness

By the launch skill's gate, the first session has to be simple (one thing: an idea becomes a live page), lovable (the card is; the session after it is not yet) and complete (it is not: the phone path stops and the door is shut). Foundmill is between the alpha and beta phases and behaving like stealth. Order: publish Foundmill's own page and walk the phone path (internal); the ten stalled owners and five concierge founders (alpha); hand admission of 5 to 10 a day from the waitlist (beta); open with a ceiling of 25 a day and the waitlist skip for referred people (early access); a public launch only when the activation rate in a closed cohort is 40% or more (Estimate, a working target). Product Hunt reaches technical early adopters, who are the anti-persona. The borrowed channels that match this reader are creators who teach starting with $0, college founder clubs and Discord servers; the owned channel is the waitlist's email list and the pages themselves. [launch]

## 10. Prioritized changes

| ID | Change | Files | Verified by |
| --- | --- | --- | --- |
| P0-1 | Tell the truth at the door: say "a few people at a time" before sign-in; join the waitlist on arrival; send an admission email | `apps/web/components/landing/idea-box/IdeaBox.tsx` (`IDEA_BOX_WORDS`), `apps/web/components/shell/NotInvitedPage.tsx`, `packages/shared/src/allowlist.ts`, `packages/db/src/repos/idea-drafts.ts` (set `admitted_at`), `packages/shared/src/constants.ts` (kind `admitted`), `packages/shared/src/notify-words.ts`, `apps/gateway/src/notify-email.ts` | Playwright: an unlisted address goes card, sign-in, "Your place is saved" with the card's name; a `waitlist_entries` row exists; admitting it writes one `notify.email_sent` of kind `admitted` |
| P0-2 | A phone path from the kept card to a live, shared page | `apps/web/components/new/card/CardKeptView.tsx`, `apps/web/components/providers/DesktopOnly.tsx` (`SMALL_SCREEN_PATTERNS`), `packages/modules/src/product/PublicPageScreen.tsx` (a phone layout, or a slim publish view), `apps/web/components/today/TodayScreen.tsx` (`onQuickAnswer` target) | Playwright at 390 by 844: landing, card, sign-in, name and age, publish; `/p/<slug>` answers 200 signed out; `needs-larger-window` never renders on the path; `project_pages` has a published row |
| P0-3 | Defaults instead of forms: no profile screen and no commit screen in session one | `apps/web/lib/auth/start-destination.ts`, `apps/web/components/onboarding/profile-form.ts`, `apps/web/components/new/commit/naming.ts` (`initialCommitForm`; spend line 0 with no budget; the overnight shift weekly after the first night on the free plan), `apps/web/components/new/commit/CommitScreen.tsx` (remove the wage line), `apps/api/src/services/commit.ts` | Unit test on `startDestination`; e2e counts two inputs typed after the idea; a no-budget project has `spend_cap_minor` 0 |
| P0-4 | Day one: one voice, three notes, no ask that cannot be acted on; the page before the sign-offs | `apps/api/src/services/commit.ts` and `packages/agents/src/templates` (starting roster, lazy hire), `apps/orchestrator/src/activities/foundations.ts` (note order), `apps/gateway/src/pipeline.ts` with `packages/shared/src/channel-availability.ts` (precondition before an approval is created) | SQL on projects created after the change: day-one notes median 3 or fewer; agents at commit 5 or fewer; no `approval.requested` for a tool whose connector is not connected; an eval for the Chief of Staff's day-one digest |
| P0-5 | Instrument the funnel | `packages/events/src/catalogue.ts` (`idea.shaped`, `idea.kept`, `account.signed_up`, `account.admitted`, `profile.completed`, `page.visited`), `packages/shared/src/constants.ts` (`ACCOUNT_EVENT_TYPES`), `apps/api/src/services/idea-box.ts`, `access.ts`, `pages.ts`; a `real_outcomes` view | Each event has a Zod schema and a consumer test (the `new-event` skill); the section 2.6 queries return one row per stage for a seeded account |
| P0-6 | Remove claims that are not true for a free user | `apps/web/components/landing/Thesis.tsx`, `HowItWorks.tsx`, `Hero.tsx`, `apps/web/components/new/card/CardKeptView.tsx` | Every row of section 1.3 marked fixed; `banned-terms` and `us-english` pass |
| P0-7 | Win-back by hand for the 11 stalled projects, after P0-2 | No product code; a one-off cleanup of stale notes through the api | 3 of 10 owners return, 2 publish, 3 reply (section 6.5) |
| P1-1 | The landing page of section 3, desktop and phone | `LandingPage.tsx` (`PhoneLanding`), `Hero.tsx`, `idea-box/typing.ts` (`PLACEHOLDER_IDEAS`), `packages/shared/src/idea-box.ts` (`IDEA_BOX_INTERESTS`), `examples/*`, new section components with stories | Playwright at 390 px; a five-second test with five target users: four can say what it is and what it costs |
| P1-2 | Lifecycle email: `getting_started`, `checkin`, first-edition brief and review | `packages/shared/src/constants.ts`, `notify-words.ts`, `notify-email.ts`, `apps/gateway/src/notify-email.ts`, the orchestrator's notify sweep, `apps/web/components/settings/EmailNotificationsSection.tsx` | Unit tests for every stop condition; `notify.email_sent` by kind; sessions with `via: "email"` per email sent |
| P1-3 | Page visits as a private return hook | `apps/api/src/services/pages.ts` (`publicPageBySlug`), `packages/shared/src/morning-brief.ts`, `TodayScreen.tsx` | A signed-out visit adds one; a member's visit adds none; no number appears on the public page |
| P1-4 | The free plan goes further: lower-cost routes by default, a meter in rounds | `packages/models/src/routing.ts`, `packages/config/src/pricing.ts`, the credits notice | `usage_ledger`: session one median $0.50 or less, a weekly round $1.00 or less; evals hold on the cheaper routes |
| P1-5 | Sign-in inside in-app browsers leads with the code | `apps/web/app/login/LoginForm.tsx`, `IdeaBox.tsx` | By hand in two in-app browsers; sign-ups by `method` |
| P1-6 | The idea box and starter projects on `/home`, for a person with no idea | `apps/web/components/person-home/PersonHome.tsx`, `IdeaBox.tsx` (signed-in mode) | Phone e2e from `/home` to a kept card |
| P1-7 | Open the door at 25 a day, with a dollar ceiling before commit and a daily ceiling on free agent work | `apps/api/src/services/access.ts` (configuration), `apps/api/src/services/ideation.ts`, `docs/DEPLOY.md` | The 26th admission of a day waits; one account cannot spend more than $1 before commit; an alert at the daily ceiling |
| P2-1 | The used-up notice of section 7.2 and a pricing page with Free in full | A new `apps/web/app/pricing`, the credits notice, `packages/config/src/pricing.ts` | Notice shown only at zero; top-up intent clicks counted |
| P2-2 | Share at the peak; the mark lands on the idea box; referred people skip the waitlist | `PublicPageScreen.tsx`, the public page's mark link, `access.ts` | Shares per live page; `signup.attributed` rows |
| P2-3 | The idea box as a named tool: title, "Email it to me", a sample card at the ceiling | `IdeaBox.tsx`, `apps/api/src/services/idea-box.ts`, page metadata | Addresses captured per card not kept; no error line at the ceiling |
| P2-4 | Stale asks expire and similar asks batch | The approval and inbox services | Decision answer rate of section 2.6 at 70% |
| P2-5 | Experiment plumbing: a cookie in `proxy.ts`, a `variant` property on funnel events | `apps/web/proxy.ts`, `packages/events` | Arms split evenly; a person sees one arm on return |
| P3-1 | Agent work for bringing someone, paid at a published page | The referral and credits services | Capped at three a month; no reward without `page.published` |
| P3-2 | Apple sign-in, with the native app | Auth configuration, `LoginForm.tsx` | Store review |
| P3-3 | "How the team works": the long-run example and the console sections on their own page | `apps/web/components/landing/*`, a new route | The landing page's weight falls; the page is linked from the footer |
| P3-4 | Willingness-to-pay survey and a first price for new sign-ups | A survey; `pricing.ts` | 30 activated founders answered before any number is read |

## Assumptions and what I could not verify

- The target user's words in section 1 are inferred, not heard. Section 9.2 replaces them.
- Whether platform mail is on in production, whether any email from Foundmill has been sent, and whether top-ups take real payments. Each changes a claim in sections 3 and 7.
- The cost of a round of work is an estimate from session averages and one project's sessions per round; the cost of one idea-box card is in `idea_drafts.cost_micro` and I did not read production data.
- The wage-cap total on the commit screen is computed from `WAGE_CAP_FOR_FAMILY`, not observed.
- Baselines in section 9.1 are placeholders. Nothing in this review was tested with users, built or run.
