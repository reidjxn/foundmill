# The landing page draft that WP-03 T5 held (reference for the landing session)

This was task T5 of `docs/holistic-plan/WP-03-the-door.md` until Nov 15, 2026, when the founder moved the landing page to its own session (`docs/holistic-plan/landing/PROMPT.md`). It is kept here unchanged as research: the claims audit, the switch table and the true lines are worth reusing. It is not a task, and the landing session is free to replace its structure, copy and design. Its section on people is too thin: see the prompt.

## Former T5: The landing page, rewritten for a first-timer, desktop and phone [L] [ships alone]

**Why:** FR-06, s2 §1.3 (all fifteen rows), §3; s1 §3.1, §3.2; a11 §4 (the promises table); s3 finding 9; s6 §5 items 3, 4, 7.

**Diagnosis (copywriting skill):** situation B. The live page has a real voice written for an experienced founder. Kept: the house rules, the idea box's assurances, "Never started a company?" as a stance, the dark Generate button (founder, Nov 13). Changed: the reader, the order, and every claim a new free user cannot check today.

**The hero chosen: outcome, in s2's option A, reworded so it is true for a stranger while the door is invite-only.** s2's "Leave with a page" promises a page in this sitting; that is true only for an admitted person on a laptop until WP-04. "Finish with" names the same outcome without the sitting. Options B and C were set aside: B ("Make something that is yours.") passes none of the three questions on its own, and C promises "today" on a phone.

**Files (modify):** `apps/web/components/landing/LandingPage.tsx`, `Hero.tsx`, `idea-box/IdeaBox.tsx`, `idea-box/typing.ts`, `parts.tsx`, `Thesis.tsx`, `Control.tsx`, `LiveSessions.tsx`, `HowItWorks.tsx` (strings only, for the tour), `apps/web/app/examples/[id]/page.tsx`, `apps/web/lib/auth/redirects.ts` (`PUBLIC_PREFIXES` gains `"/tour"`), `apps/web/components/landing/__tests__/LandingPage.test.tsx`, `apps/web/e2e/landing.spec.ts`, `docs/DESIGN.md` §9a (replace the section with the section list below; keep its "Glass and windows", "Dates and hydration" and "Example labels" bullets for the tour).
**Files (create):** `apps/web/components/landing/words.ts` (every string below, one export `LANDING_WORDS`), `apps/web/components/landing/FirstWeek.tsx`, `Questions.tsx`, `TourPage.tsx`, `apps/web/app/tour/page.tsx`, stories for `FirstWeek` and `Questions` at 390 px.

**Interfaces consumed:** `LandingPage({ terminalRenderer?, initialExample?, renderDay? })` branches on `isViewportTooSmall(width)` into `PhoneLanding` (the hero, a note about 1280 px, legal links); `Hero({ layout })` prints `APP_TAGLINE` as the `h1` with "real business" lit and the pill "For founders · First company or fifth, the team comes with it"; `LandingPage.test.tsx` line 62 pins `h1 === APP_TAGLINE` and line 63 the "Start your business" links; `landing.spec.ts` line 96 clicks "Start your business"; `IDEA_BOX_WORDS`; `PLACEHOLDER_IDEAS` (`typing.ts`); `IdeaCard` (`@foundmill/dugout`); `INCLUDED` (`formatMoney(includedCreditsMinor("free"))`, never a typed figure); `goToSection(id)`; `SIGN_IN = "/login"`; `LEGAL_ROUTES`.

**Structure.** One responsive page for every width: no `PhoneLanding` branch, so the server's HTML is the page a phone keeps (this also ends the desktop flash, s1 §3.2). One column, 16 px gutters under 640 px, a centered 640 px column to 1279 px, the 92 rem column above. The page stops wearing an example business's brand colors. Today's sections (ticker, Why now, four-step How it works, Your team, Live sessions, The journey, Channels, You decide, the example deck and picker) move unchanged in layout to `TourPage` at `/tour`: desktop only, `noindex`, linked from the footer on wide screens only. `/examples/[id]` renders `TourPage`.

| # | Section (`id`) | Heading | Notes |
| --- | --- | --- | --- |
| 1 | top bar | | Wordmark; "Sign in" (ghost, to `/login`); from 640 px also "Shape my idea" (focuses the field). |
| 2 | `hero` | h1 | Pill, h1, subhead, visible label, field, button, "No idea yet?", all three assurances at every width, the door line. |
| 3 | `today` | What you have to show for it | Three tiles; the first holds one example `IdeaCard` labeled Example, replaced by the visitor's card when it lands. |
| 4 | `first-week` | A first week, from $0 | `FirstWeek`: one example open, two behind "See another". Each carries the Example chip. `data-nosnippet` on the section. |
| 5 | `how` | How it works | Three steps. |
| 6 | `control` | You are in charge | The house rules. |
| 7 | `cost` | What it costs | |
| 8 | `people` | On your own, or with someone | |
| 9 | `questions` | Questions | `Questions`: native `<details>` so it works without script. |
| 10 | `start` | Start with one sentence. | A button that scrolls to and focuses the field (one idea box per page: one bot-check widget). Under 640 px a sticky "Shape my idea" appears once the hero has scrolled away. |
| 11 | footer | | Tagline (`APP_TAGLINE`), Terms, Privacy; from 1280 px "How the team works" to `/tour`. The line "Desktop only · 1280 px and wider" is deleted. |

**The copy (`LANDING_WORDS`; `{INCLUDED}` is the config figure, "$5.00" today).**

> Pill: **Free to start · No experience needed**
>
> # Start with one sentence. Finish with a page for your idea.
>
> Type what you want to make. A team of AI agents shapes it and rates it honestly while you watch, then drafts its first page for you to check and publish. It is free to start, and nothing goes out without your yes.
>
> Label: **What do you want to make?** · Placeholder on focus: "One sentence is enough. Rough is fine." · Button: **Shape my idea** · "No idea yet? **Surprise me**"
>
> Assurances: "Your first card is free and needs no sign-up" · "Your idea stays private until you choose to share it" · "Nothing moves money or signs in your name without you"
>
> Door line, under the assurances: "Foundmill lets new people in a few at a time. Your card is free now, and signing in holds your place."

> **What Foundmill is.** Foundmill is a web app where one person works with a team of AI agents to start a project of their own. The team shapes the idea, rates it honestly, drafts a public page for it and plans the next steps. It asks you before anything that spends money or acts in your name. It is for people 18 or older.

> ## What you have to show for it
>
> **A card for your idea.** Its name, a one-line pitch and ten honest ratings, each with the reason behind it. A weak rating comes with one line on what would raise it. You get this before you sign up.
>
> **A page at its own link.** Once you are in, your team drafts it from your words. You change what you like and publish it at foundmill.com/p/your-project. Hosting is free.
>
> **One decision at a time.** Your Chief of Staff, the agent that runs your team, brings you what needs your answer, with a recommendation. The team does the work in between.

> ## A first week, from $0
>
> *Example project* · **Sole Revival** · Sneaker cleaning for people at one college
> - Day 1. Idea shaped and rated: 3 stars now, 4 if a first few people sign up. Page drafted, checked and published.
> - Day 2. The founder sends the link to two group chats. Four people leave an email address on the page to follow it.
> - Day 3. The team drafts a short post with a before-and-after photo idea. The founder posts it with one tap.
> - Day 5. The project's story shows two milestones: page live, first follower.
> - Day 7. One decision waiting: clean the first pair free, or charge $5. Money spent: $0.
>
> *Example project* · **Cheap Eats Houston** · A weekly list of meals under $10
> - Day 1. Card rated. Weakest rating: standing out. Page published with a Follow form.
> - Day 3. The founder posts the link in two neighborhood groups. More people follow.
> - Day 6. The team drafts the first list. The founder reads it and decides what goes on the page.
> - Day 7. Money spent: $0.
>
> *Example project* · **Code Club Evenings** · Online coding lessons for kids, two evenings a week
> - Day 1. Card rated. Weakest rating: reaching parents. Page published.
> - Day 2. The team drafts a post for parent groups. The founder posts it.
> - Day 4. First followers. The team suggests a free trial lesson and drafts the invitation.
> - Day 7. Money spent: $0.

> ## How it works
>
> **1. Say it.** One sentence about what you want to make. No idea yet? Tap Surprise me, pick something you like and react to what comes back.
>
> **2. Check it and publish.** Your team drafts the page. You read it, change the words and publish. Nothing is public before that.
>
> **3. Decide, a little each day.** Your Chief of Staff brings you one decision at a time, with a recommendation. The team does the work in between.

> ## You are in charge
>
> Your agents work inside house rules they cannot change. They never move money, sign anything, accept terms, file anything under your name, delete anything for good or change security settings. Unless you choose otherwise, anything that reaches another person waits for your yes. One button stops every agent at once.

> ## What it costs
>
> Starting is free, and the free plan does not expire. You never enter a card.
>
> Your project gets {INCLUDED} of agent work every month. If it runs out before the month ends, your team pauses until the next month starts. Your page stays live and nothing you made is lost.
>
> Free on every plan: your page at a Foundmill address, and as many cofounders and collaborators as you like.

> ## On your own, or with someone
>
> You can do all of this by yourself. Your team covers the work. If you would like someone to build it with, invite them to your project. Adding people is free.

> ## Questions
>
> **When can I get in?** We let new people in a few at a time so every project gets real agent work. Sign in to hold your place, and we email you the day it opens. Your card is kept for 90 days.
>
> **Does it cost anything?** Starting is free and you never enter a card. Your free plan includes {INCLUDED} of agent work every month. If that runs out, your team pauses until the next month starts and your page stays live.
>
> **I do not have an idea yet.** Tap Surprise me and pick something you like. You get one honest idea to react to.
>
> **I have never done this. Will I know what to do?** Yes. Your Chief of Staff plans the work, explains a new term the first time it appears and tells you which decision is yours.
>
> **Can the agents do something in my name without asking?** No. They cannot move money, sign, accept terms, file under your identity, delete for good or change security settings.
>
> **Is my idea private?** Yes, until you publish your page. You choose what the page says and you can take it down whenever you like.
>
> **Do I need a company, a bank account or a website?** No. Foundmill hosts your page at a Foundmill address for free. You can connect your own accounts later.
>
> **Does it work on a phone?** You can shape and keep your card on a phone, and answer what needs you. Publishing your page needs a computer for now, and we can email you the link.
>
> **Can I do this on my own?** Yes, all of it.
>
> **What can it not do yet?** Take a payment, send email to a list for you, or check facts on the live web. Building an app needs your own GitHub account. Your team says so when a step needs one of these.
>
> **Who can use Foundmill?** Anyone 18 or older.

> ## Start with one sentence.
>
> Your first card is free and needs no sign-up. Button: **Shape my idea**

**After the card lands** (`IDEA_BOX_WORDS`): headline "{name} is yours to keep." (kept); group heading "Keep my card"; `keepLead` as T2 leaves it; buttons unchanged; `freeLine` as T1; the three lines "A researched version of this card, with sources" / "More directions to compare side by side" / "A team of agents to build it" → "A page for {name} at its own link" / "One decision at a time, each with a recommendation" / "A team of agents for the work you have not learned yet"; "Not now? This card waits on this device for 7 days." (kept).

**Placeholder ideas** (`PLACEHOLDER_IDEAS`, all eight replaced; each can be started with $0 and no code): "Sneaker cleaning for people at my school" · "A weekly email about cheap eats in Houston" · "Coding lessons for kids, online, two evenings a week" · "Candles that smell like places I have lived" · "Vintage band tees, found and resold" · "Meal prep for people who work nights" · "Dog walking in my neighborhood, booked by text" · "Study notes for my nursing class".

**Metadata (T6 wires it):** title "Foundmill | Start your first project with one sentence"; description "Say your idea in a sentence. A team of AI agents shapes it, rates it honestly and drafts a page you can publish. Free to start, no card."

**Removed claims (a test fails if any returns to `/` or `/tour`):**

| String today | File | Why | On `/tour` it becomes |
| --- | --- | --- | --- |
| "Agents open real pull requests on your GitHub, send email from your own accounts and reconcile your Stripe and bank data." | `Thesis.tsx` pillar 2 | a11 §4: Stripe, bank and own-account mail are not live | "With your GitHub connected, agents open real pull requests there. Every project gets a public page at a Foundmill address." |
| "Better every cycle. Agents are trained against real tests between cycles…" | `Thesis.tsx` pillar 3 | s2 §1.3 row 7: `skill_tests` has 0 rows | pillar removed (three pillars) |
| "Six departments work at once every cycle" | `Thesis.tsx` pillar 1 | free plan runs 4 agents at once | "Departments work side by side each round." |
| "Fifteen channels. The right few first." | `LiveSessions.tsx` | a11 §4: three channels can act | "Channels on one board. The few that can act for you come first." |
| "You do not need to know how to incorporate, price, run ads or keep books." | `Control.tsx` | a11 §4: none of the four is done for a founder | "Never started anything? You do not need to know the steps. Your team plans them and tells you which decision is yours." |
| "Nothing is spent until you approve it." | `HowItWorks.tsx` | s2 §1.3 row 11: the allowance is spent as agents work | "Your project's money is never spent without your approval. Agent work uses your monthly allowance." |
| "checks it against real sources", "checks every number against real sources" | `IdeaBox.tsx`, `CardKeptView.tsx` | AR-01: research is simulated | removed in T1 and T3 |
| "For founders · First company or fifth, the team comes with it", "Start your business", "Or watch an example run", the 1280 px note | `Hero.tsx`, `LandingPage.tsx` | s2 §1.3 rows 2, 4, 13 | `/tour` keeps the deck without the label |

**What each later package switches (strings stay in `words.ts`):**

| When recorded done in `docs/DEPLOY.md` | Change |
| --- | --- |
| WP-04's publish at 390 px | The phone answer → "Yes. Your idea, your page and your daily decisions all work on a phone. The full workspace, with every department's detail, is built for a computer." |
| WP-08's first email to followers | Add to the company question: "It also gives your project an address to send email from." Remove "send email to a list for you" from the limits answer. Add to Sole Revival: "Day 5. First email to the followers, sent from the project's own Foundmill address." |
| WP-07's pay button; WP-00 S6 (web research) | Remove "Take a payment" and "check facts on the live web" from the limits answer. |
| WP-09's cost report | In "What it costs", after the allowance sentence: "That covers shaping your idea, drafting your page and about N rounds of work a month (Estimate)." with the measured N. |
| WP-00 S5 with no waiting list for a week | Delete the "When can I get in?" question and the door line. |
| First real project pages, with consent (`showcase_consents`) | Replace the examples one by one; add "See a real page". |

**Steps:**
1. Rewrite `LandingPage.test.tsx` first: the `h1` is `LANDING_WORDS.hero.title`; no link named "Start your business"; the eleven section ids exist in order; at a mocked 390 px the same sections render and `landing-phone-note` is gone; `removed-claims.test.ts` (new, in `__tests__`) renders `LandingPage` and `TourPage` and fails on any left-column string above; every example block carries the Example chip and `data-nosnippet`. verify: the tests fail on `main`.
2. `words.ts`, then the sections, reusing `Container`, `Section`, `SectionHeading`, `Glass` from `parts.tsx` and design-system components only. The visible label replaces the `sr-only` one. verify: step 1's tests pass; Storybook renders `FirstWeek` and `Questions` at 390 px.
3. `TourPage`, `/tour`, `/examples/[id]`, the string fixes in the table. `app/tour/page.tsx` exports `robots: { index: false, follow: true }`. verify: the existing landing component tests (`cycle-deck-motion`, `picker`, `live-sessions`, `story-day`, `journey-story`) pass when pointed at `TourPage`.
4. Copy checks from the copywriting skill, on `words.ts`: no dash in a headline or subhead; no "not X, it's Y"; no list of negations; each claim maps to a row of the capability table in step 5. verify: `node scripts/banned-terms.mjs && node scripts/us-english.mjs && node scripts/plain-language.mjs`; `rg -n "—|–" apps/web/components/landing/words.ts` prints nothing.
5. In the pull request, a table: each sentence of the First week and Questions sections, and the code that makes it true (`IdeaCard` stars; `page.publish`; `publicPage.follow` with its confirmation; `tap-to-post.spec.ts`; the story's milestones; `PAGE_READY_NOTE`; invitations in Settings › People). A sentence with no row is cut. verify: reviewer reads it.
6. `landing.spec.ts`: at 390 × 844 and 1440 × 900 no horizontal scroll, the field and button are above the fold with the keyboard closed, the sticky button returns focus to the field, "Shape my idea" in the top bar focuses the field, `/tour` renders at 1440 and shows the note with controls at 390. verify: the spec passes.
7. `docs/DESIGN.md` §9a rewritten to the section table; one sentence that the page is written for one reader, the first-timer, and the second reader has `/tour`. verify: `node scripts/banned-terms.mjs` (it scans DESIGN.md).

**Tests and evals:** as listed. `evals/src/idea-box.ts` is unchanged (the card's prompt is untouched).
**Done when:** Done-when 4.
**Needs setup:** the Follow lines in the examples assume a follower gets the confirmation email: WP-00 S1 recorded done. If it is not, ship with "leave an email address on the page" cut from Day 2 and restore it later.

