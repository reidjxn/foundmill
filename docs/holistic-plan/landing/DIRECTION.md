# The landing page: direction

Status: proposed, Nov 15, 2026. Pull request 1 of the landing session (`docs/holistic-plan/landing/PROMPT.md` on the plan branch). Nothing here is built yet; pull requests 2 to 5 build it, and every choice below is held in one constant or one words file so the founder can change course cheaply.

## 1. What today's page does

Rendered at 390 × 844 and 1440 × 900 on Nov 15 (`shots/today-390.png`, `shots/today-1440-fold.png`).

- **390 px.** The pill "For founders · The team comes with it", the tagline, a lede, the idea box, two of the three assurances (the third, "Nothing moves money or signs in your name without you", is dropped on phones), then "The rest of Foundmill, and the example business running, is built for screens 1280 px wide or more. Your card works here." and the legal links. 975 px tall. The phone never sees what a card looks like, never hears about people, and ends at a note about screen widths.
- **1440 px.** Ten sections, 10,519 px tall: hero, ticker, Why now, How it works, Your team, Live sessions, The journey, Channels, You decide, closing call. Above the fold there are nine actions (Shape my idea, Surprise me, three example tabs, Pause, Stop, Sign in, Start your business) and an example business at "Cycle 215 · Chapter 9 · 14 mo". "Start your business" in the top bar skips the idea box and goes to sign-in. The anxiety answer ("You decide") is section nine.
- **Both.** The page wears an example business's brand colors. No filled main button anywhere (the main action is outlined glass at 1.6 : 1 against the page, s1 §2). The field's label is screen-reader only. No word about cofounders, collaborators or building with anyone. Production sends `noindex, nofollow`; title "Foundmill"; no canonical, no structured data (s3).
- **Checks.** axe (WCAG 2.2 A/AA rules) at 1440: one serious failure, `aria-hidden-focus` (a focusable element inside the decorative orbit). At 390: none. s3 measured production at 38 script files, about 604 KB Brotli of JavaScript for `/`; LCP, INP and CLS have never been measured.

### The critique (impeccable's method, run by hand)

Assessment A ran as an isolated reviewer with impeccable's rubric. Assessment B (impeccable's detector) did not run: its launcher downloads a binary, which this session's brief rules out, so the detector's place was taken by the Playwright and axe measurements above.

Nielsen, Persuade mode, 7 and 10 not applicable: **21 / 32**. Visibility of status 3 · match with the real world 2 · user control 3 · consistency 2 · error prevention 3 · recognition 3 · minimalist design 2 · error recovery 3.

Specificity: specific on a desktop (the real deck, Estimate chips, "Asks before spending over each agent's limit"), generic on a phone (dark gradient, eyebrow pill, one lit phrase, input, reassurance list). s1 §1.2 lists the same tells.

Priority issues, merged with s1, s2 and a1:

| # | Severity | Issue | What the direction does |
| --- | --- | --- | --- |
| 1 | P0 | The phone is a cut-down page that ends at a note about 1280 px (s1 §1.4 problem 1, a1 FR-03). | One page for every width. The server's HTML is the page a phone keeps. |
| 2 | P0 | Claims a stranger cannot meet today: "checks it against real sources", "reconcile your Stripe and bank data", "Better every cycle", "Six departments work at once", "Nothing is spent until you approve it", "Start your business" leading to an invite wall (s2 §1.3, a1 FR-06). | Every sentence maps to code (section 6); a test fails if a removed claim returns. |
| 3 | P1 | The phone drops the third assurance, which answers "behind my back". | All three at every width. |
| 4 | P1 | The prize is never shown before typing. | A real example card, labeled Example, right under the hero, replaced by the visitor's own. |
| 5 | P1 | People appear nowhere. | Section 3, in the first half of the page. |
| 6 | P1 | Written for two readers (DESIGN §9a). The first-timer meets cycles, chapters, runway and a channel board. | One reader. Today's page moves to `/tour` for investors and experienced founders. |
| 7 | P2 | No filled main action; nine actions at the fold. | One main action per screen: the idea box. The top bar has Sign in and nothing that competes. |
| 8 | P2 | Body text 13 px, helper 12 px on the darkest surface; the field input zooms an iPhone below 16 px (s1 §2). | A landing type scale from 16 px body (section 7). |

## 2. The reader and the one job

**The reader.** Eighteen to late twenties, first project, little money, no business experience, on a phone, arrived from a link in a group chat or a search. Has never heard of Foundmill. Carries three fears: it will cost money, it will do something behind my back, it will make me look stupid. Has seen AI app builders burn credits on failed runs and post things without asking (s6 §2).

**The one job.** Get them to type one sentence, see it come back as a card, and want to keep it. Everything on the page either moves them toward that, answers one of the three fears, or goes. The second most important thing the page does is say plainly that they can build this alone or with people, and that people are one step away.

**Who it is not for.** The investor, the press and the experienced founder get `/tour` (today's page, unchanged in layout, its false claims fixed), linked from the footer on wide screens.

## 3. The page, section by section

One idea per section. Eight blocks plus the top bar and the footer, the same at every width from 390 px. About 700 words a visitor reads, against 2,302 today.

| # | id | Heading | The one idea | Real screen |
| --- | --- | --- | --- | --- |
| 0 | top bar | | Who this is, and a way back in. | |
| 1 | `hero` | h1 | Type one sentence; it is free and safe to try. | The idea box, then the visitor's own card when it lands. |
| 2 | `card` | What comes back | This is the prize, and it is yours. | `IdeaCard`, Example |
| 3 | `people` | On your own, or with people | Solo is complete; people are one step away if you want them. | `PersonPage` at phone width, Example |
| 4 | `first-week` | A first week, from $0 | What a first week can look like, with only things that work today. | `ProjectPage` at phone width, Example |
| 5 | `control` | You stay in charge | Nothing happens behind your back. | |
| 6 | `cost` | What it costs | It will not cost you money to start. | |
| 7 | `questions` | Questions | The rest of the doubts, short. | |
| 8 | `start` | Start with one sentence. | Back to the box. | |
| 9 | footer | What Foundmill is | A paragraph an answer engine can quote, then links. | |

Order rationale: the prize before the explanation (s1's question "why does anyone see the hero before a single card?"), people third so they sit in the first half on every width (they would sit fifth in s2's order), and the two fear sections before the questions so a reader who scrolls finds them without opening anything.

## 4. The copy

All strings live in one file, `apps/web/components/landing/words.ts` (`LANDING_WORDS`). `{INCLUDED}` is `formatMoney(includedCreditsMinor("free"))`, "$5.00" today, never typed. Lines marked **[switch]** appear only when their switch is on (section 6). The copy was put through the copywriting, copy-editing and humanizer passes: no dash in a heading, no "not X, it's Y", no list of negations in a heading, no invented numbers, US English.

### 0. Top bar
Wordmark (link home). **[people layer]** "Find people" (link to `/network`). "Sign in" (ghost, to `/login`).

The top bar carries no second "start" button: the hero's box is the one main action, and s1 counted the old "Start your business" as a competing path to the invite wall.

### 1. Hero
> # Start something of your own, with a team of AI agents.
>
> Type your idea in one sentence. Your team gives it a name, a pitch and ten honest ratings, free and before you sign up. **[sign-up closed]** Keep it, and once your place opens the team drafts a page for it and plans what comes next. **[sign-up open]** Keep it, and the team drafts a page for it and plans what comes next.
>
> Label (visible): **What do you want to make?** · Placeholder once focused: "One sentence is enough. Rough is fine." · Button: **Shape my idea** · "No idea yet? **Surprise me**"
>
> Assurances, all three at every width: "Your first card is free and needs no sign-up" · "Your idea stays private until you choose to share it" · "Nothing spends money or signs in your name without you"
>
> **[sign-up closed]** "Foundmill lets new people in a few at a time. Signing in puts you on the list and keeps your card for 90 days."

When the card lands the h1 becomes "{name} is yours to keep." (kept from today; the strongest moment on the page) and the card sits under the field with the ways to keep it. Under it, the existing "Keep my card" panel, with s2's corrected lines (owned by WP-03 T1/T2 where they touch the keep flow; this page uses whatever `IDEA_BOX_WORDS` holds).

The typed placeholder ideas (the founder's 2026-11-13 typing placeholder, kept) change from eight business-software ideas to eight a first-timer can start with $0 and no code (s2 §3.4): "Sneaker cleaning for people at my school" · "A weekly email about cheap eats in Houston" · "Coding lessons for kids, online, two evenings a week" · "Candles that smell like places I have lived" · "Vintage band tees, found and resold" · "Meal prep for people who work nights" · "Dog walking in my neighborhood, booked by text" · "Study notes for my nursing class".

### 2. What comes back
> ## What comes back
>
> One card for your idea, and it is yours to keep.
>
> - **A name and a one-line pitch**, written from your words.
> - **Ten ratings out of 20**, each with the reason behind it. Founder fit waits until you have answered a few questions about yourself.
> - **The one thing that would raise it most**, so you know where to start.
>
> *Example* card: **Sole Revival**, sneaker cleaning for students at one college.

The example card is hidden once the visitor's own card has landed above it.

### 3. On your own, or with people
> ## On your own, or with people
>
> You can build all of it by yourself. Your team of agents covers the work, and nothing waits on a second person.
>
> If you want people to build it with, they are one step away.
>
> - **Invite anyone.** Send an invitation link. They join your project as a cofounder, with the same standing as you, or as a collaborator who helps with the product and customers and sees nothing of the money or settings.
> - **People are free.** Add as many cofounders and collaborators as you like, on every plan.
> - **A page of your own.** At foundmill.com/u/your-name, say what you are good at and, if you like, that you are open to building with people, looking for a cofounder or looking to join a project.
>
> **[people layer]** ### Find people to build with
> Meet other founders, connect, send a message and join communities. **Find people** (link to `/network`)
>
> *Example* profile beside it: a person page at phone width with "Open to building with people".

Solo guard (docs/NETWORK.md §10, the person-profile decision of Nov 12): the first sentence says one person is complete; nothing counts, ranks or rates by team size; nothing says a cofounder is needed; the find block is an offer with no badge and no count. There is no "coming soon" anywhere: when the people layer is off, the find block is simply absent.

### 4. A first week, from $0
> ## A first week, from $0
>
> An example of how a first project can go, using only what works today.
>
> *Example project* · **Sole Revival** · Sneaker cleaning for students at one college
> - **Day 1.** The idea is shaped and rated: 3 stars, with room to reach 4.
> - **Day 2.** The team drafts the project's page. The founder changes two lines and publishes it at its own Foundmill address.
> - **Day 3.** The founder sends the link to two group chats. **[platform mail]** Four people follow the page.
> - **Day 4.** The team drafts a short post with a before-and-after photo idea. The founder posts it.
> - **Day 5.** The project's story shows its first milestone: page live.
> - **Day 7.** One decision is waiting, with the team's recommendation: clean the first pair free, or charge $5. Money the founder has spent: $0.
>
> "See another example" (native `<details>`):
>
> *Example project* · **Cheap Eats Houston** · A weekly list of meals under $10
> - **Day 1.** Card rated. Its weakest rating is standing out from other food lists.
> - **Day 2.** Page published.
> - **Day 4.** The founder posts the link in two neighborhood groups.
> - **Day 6.** The team drafts the first list. The founder decides what goes on the page.
> - **Day 7.** Money the founder has spent: $0.

The section carries `data-nosnippet` so a search engine never quotes the example as a fact.

### 5. You stay in charge
> ## You stay in charge
>
> Your agents work inside house rules they cannot change. They never move money, sign anything, accept terms, file anything in your name, delete anything for good or change security settings.
>
> Anything that reaches another person waits for your yes, unless you choose otherwise. One button stops every agent at once.

### 6. What it costs
> ## What it costs
>
> Starting is free, the free plan does not expire, and you never enter a card.
>
> The free plan includes {INCLUDED} of agent work a month for one project. If it runs out, your team pauses until the next month starts. Your page stays live and nothing you made is lost.
>
> Your page's Foundmill address and every person you add are free on every plan.

### 7. Questions
Native `<details>`, so it works without script; on a phone they start closed, on a wide screen too (one rule).

- **When can I get in?** **[sign-up closed]** Foundmill lets new people in a few at a time, so every project gets real agent work. Sign in to join the list, and your card is kept for 90 days. If someone invites you to their project, you can join it right away.
- **Does it cost anything?** Starting is free and you never enter a card. The free plan includes {INCLUDED} of agent work a month. If that runs out, your team pauses until the next month starts and your page stays live.
- **I don't have an idea yet.** Tap Surprise me and pick something you like. You get one idea to react to.
- **I have never done this. Will I know what to do?** Yes. Your Chief of Staff, the agent that runs your team, plans the work, explains a new word the first time it comes up and tells you which decisions are yours.
- **Can the agents do something in my name without asking?** No. They cannot move money, sign, accept terms, file anything in your name, delete anything for good or change security settings.
- **Is my idea private?** Yes, until you publish your page. You choose what the page says, and you can take it down whenever you like.
- **Do I need a company, a bank account or a website?** No. Foundmill hosts your page at a Foundmill address for free.
- **Does it work on a phone?** You can shape and keep your card on a phone, and answer what needs you. Publishing your page and the full workspace need a computer for now.
- **Can I do this on my own?** Yes, all of it.
- **Can I build it with someone?** Yes. Invite as many cofounders and collaborators as you like, free on every plan.
- **What can it not do yet?** Take a payment or check facts on the live web. **[platform mail off]** Send email for your project. Building an app needs your own GitHub account. Your team says so when a step needs one of these.
- **Who can use Foundmill?** Anyone 18 or older.

### 8. Start
> ## Start with one sentence.
> Your first card is free and needs no sign-up. **Shape my idea** (scrolls to the box and focuses the field; one idea box per page, so one bot check).

### 9. Footer
> **What Foundmill is.** Foundmill is a web app where one person, or a few people together, work with a team of AI agents to start a project of their own. The team shapes the idea, rates it honestly, drafts a public page for it and plans the next steps, and it asks before anything that spends money or acts in your name. It is free to start and for people 18 or older.
>
> Tagline (`APP_TAGLINE`) · Terms · Privacy · from 1280 px **[tour]** "How the team works" (to `/tour`) · © {year} Foundmill

### Metadata (pull request 4)
Title "Foundmill | Start your first project with one sentence". Description "Say your idea in a sentence. A team of AI agents shapes it and rates it honestly, free and before you sign up. Build it alone or with people." Canonical `/`. Open Graph with a share image drawn from the hero. One JSON-LD block (Organization, WebSite, SoftwareApplication with a free Offer; no FAQPage). `robots` stays `noindex` behind `HOME_INDEXED = false`.

### Removed claims (a test fails if any returns to `/`)
"checks it against real sources" · "reconcile your Stripe and bank data" · "Better every cycle" · "Six departments work at once" · "Nothing is spent until you approve it" · "Start your business" · "First company or fifth" · "Or watch an example run" · "built for screens 1280 px wide or more" · "Desktop only" · "We will email you" · "cofounders' credits pool" (true only once package 3.9 ships) · "in one tap" (Share exists only in the desktop console, a9 A9-P1-5).

## 5. The people side

What a stranger meets, in order: the h1 says "of your own" without saying "alone"; section 3 says one person is complete before it says anything about others; the three people facts are the three that work today with no switch (invitations, free people, a person page); the find block and the top-bar link exist only with the people layer on; the questions answer both "Can I do this on my own?" and "Can I build it with someone?" with a plain yes.

Why this and not more: NETWORK.md §15 rules out counts, rankings, sample people and anything that pushes toward a partner. a9 §1.2 shows that `/network`, `/communities` and `/profiles` sit behind `liveGate`, that Find people (F16), open roles, trials, join requests and pooled credits are not built, and that the person page is not linked from a person's home. The page therefore offers only what a stranger can do today, and grows by switch.

What this needs elsewhere (not this session's files): nothing for the true lines. The find block needs `LIVE_MODE` decided (founder decision 4).

## 6. Claims and switches

### Claims table
Every sentence a visitor reads, and the code that makes it true for a stranger on the free plan today. A sentence with no row is cut. Pull request 3 repeats this table with its tests.

| Claim | Code that makes it true |
| --- | --- |
| A card with a name, a pitch and ten ratings, free, before sign-up | `apps/api/src/idea-box-routes.ts` (`/idea-box/draft`, public, Turnstile); `IdeaCard` (`packages/dugout/src/components/public/IdeaCard.tsx`) |
| Founder fit waits for your answers | `IdeaCard` `founderFitKnown=false` shows "–"; DECISIONS 2026-11-13 "Founder fit is shown unmeasured" |
| The one thing that would raise it most | `lowestRating` in `IdeaCard.tsx`, "What would raise it most" |
| Your idea stays private until you share it | `idea_drafts` read only by its cookie's owner (`/idea-box/mine`); pages publish only by a person's press (`apps/api/src/routers/page.ts` `page.publish`) |
| Nothing spends money or signs in your name without you; the six house rules | `packages/agents/src/prompts/club-rules.ts` (the "House rules" block); hard gates in `packages/policy` (`hardGate`) |
| Anything that reaches another person waits for your yes, unless you choose otherwise | policy approvals in augmented and assisted modes (`packages/policy/src/evaluate.ts`); assisted is the default at commit |
| One button stops every agent | `StopAllAgents` (`packages/dugout/src/components/shell/KitBar.tsx`) |
| Free plan, no card, does not expire | `TIERS.free.priceMonthly: null` (`packages/config/src/pricing.ts`); no payment provider is configured anywhere (e0) |
| {INCLUDED} of agent work a month for one project | `includedCreditsMinor("free")` = 500; `includedCreditBusinesses: 1` (`pricing.ts`) |
| If it runs out, the team pauses; the page stays live | `bookUsage` pauses the team on the last credit and files "Credits used up: team paused" (`packages/db/src/billing.ts`, `CREDITS_EXHAUSTED_SUBJECT`); the month's grant resumes it; public pages read no credits (`apps/api/src/services/pages.ts`) |
| The team drafts a page; you publish it at a Foundmill address | the `project_page` task kind (THESIS_REVIEW 1.2, done); `page.publish`; `/p/[slug]` |
| Hosting the page is free | CLAUDE.md "Always" (founder 2026-11-11); `/p/[slug]` on every plan |
| Invite anyone; they join as a cofounder or collaborator | `invitation.create` / `accept` (`apps/api/src/routers/people.ts`, `services/invitations.ts`); `/i/[token]`; `INVITATION_ROLES` (`packages/shared/src/people.ts`) |
| A cofounder has the same standing; a collaborator works on product and customers and sees nothing of money or settings | `MEMBERSHIP_ROLES` doc and `COLLABORATOR_SECTIONS` (`packages/shared/src/constants.ts`, `permissions.ts`) |
| If someone invites you, you can join right away | `admitThroughInvitation` (`apps/api/src/services/access.ts`): up to three admissions per inviter per day |
| People are free, any number, every plan | `seats: "unlimited"`, `tierSeatLimit` → null (`pricing.ts`) |
| A page of your own at /u/your-name, saying what you are good at and whether you are open to people | `founder.publicProfile.*` (`apps/api/src/routers/founder.ts`); `/u/[handle]`; `PersonPage`; `LOOKING_FOR_OPTIONS` (`packages/shared/src/person-profile.ts`) |
| Your Chief of Staff plans the work and explains new words | Chief of Staff planner (`packages/agents/src/prompts/chief-of-staff-planner.ts`); `Term` (DESIGN §8 Guidance) |
| Shape and keep the card on a phone; answer what needs you | `/` and `/new/card/*` small-screen; Today and Needs you in phone mode (`phone-today.spec.ts`) |
| Publishing and the workspace need a computer | `NeedsLargerWindow` on every other route (`DesktopOnly.tsx`) |
| 18 or older | the adult confirmation at sign-up (`services/adults.ts`) |
| Example timeline days 1, 2, 4, 5, 7 | card stars (`stars_current`, `stars_potential`); `page.publish`; post drafts (`post-drafts.spec.ts`); the "Page live" milestone (`/p/<slug>/story`); a decision note with a recommendation (`DecisionBar`) |

### Switch table
The page is prerendered (`force-static`), so a switch is read once at build time from the web deployment's environment, in `app/page.tsx`, and passed down. Unset means off, which is what production has today (e0: no `SIGNUP_OPEN`, `LIVE_MODE` unset, platform mail unconfirmed). Vercel's web project needs the same variable as the api for a switch to turn on.

| String | Switch | File |
| --- | --- | --- |
| Lede "once your place opens"; door line; "When can I get in?" | `SIGNUP_OPEN` (off: closed) | `components/landing/words.ts` `hero.ledeClosed`, `hero.door`, `questions.getIn` |
| "Find people" in the top bar; the find block | `LIVE_MODE` through `liveModeOpen` (`packages/config/src/flags.ts`) | `words.ts` `people.find*`, `topBar.findPeople` |
| "Four people follow the page."; "Send email for your project" leaves the limits answer | `PLATFORM_MAIL_DOMAIN` set | `words.ts` `firstWeek.day3Follow`, `questions.limitsMail` |
| "How the team works" link and `/tour` itself | `TOUR_ENABLED` constant (true) | `components/landing/flags.ts` |
| Idea-box button look | `IDEA_BUTTON = "recorded"` (`"filled"` the alternative) | `components/landing/flags.ts` |
| `noindex` | `HOME_INDEXED = false` | `components/landing/flags.ts` |

Later edits with no switch yet (strings stay in `words.ts`): the phone answer once publishing works on a phone (WP-04); "Take a payment" leaves the limits answer once Stripe is live; "check facts on the live web" leaves it once web research is live; a pooled-credits line once package 3.9 ships; real project pages replace the examples once their founders consent (`showcase_consents`).

## 7. Design direction, in Dugout terms

**Register.** The calm of the public project page at 390 px (s1 §1.1), not the control room. Foundmill's own look: the default kit tokens (Foundmill steel, `--kit-primary` #3570CC, `--kit-lift` #7CC4FF), no example business's colors, no `kitStyle` on the page.

**Type.** The three faces stay (Barlow Semi Condensed 600 for headings, Inter for reading, JetBrains Mono nowhere on this page). A landing-scoped scale in `tokens.css`, new tokens only, so nothing the console reads moves:

| Token | Value | Use |
| --- | --- | --- |
| `--fs-landing-h1` / `--lh-landing-h1` | clamp(36px, 4.6vw + 18px, 72px) / 1.04 | the h1 |
| `--fs-landing-h2` / `--lh-landing-h2` | clamp(26px, 1.8vw + 19px, 40px) / 1.12 | section headings |
| `--fs-landing-lede` / `--lh-landing-lede` | clamp(17px, 0.3vw + 16px, 19px) / 1.55 | the lede under a heading |
| `--fs-landing-body` / `--lh-landing-body` | 16px / 26px | everything else a visitor reads (iOS no-zoom threshold, s1 §2) |
| `--fs-landing-small` / `--lh-landing-small` | 14px / 20px | assurances, chips, footer |

**Color.** Text on `--canvas` in `text-1` (17.4 : 1) and `text-2` (9.4 : 1); `text-3` only for the footer's fine print (6.5 : 1). One faint steel light from the top center under the hero (the existing `canvas-lit` idea), no dot grid, no side washes, no violet. Status green only on the assurance icons. Gold only on the example week's milestone line (DESIGN §5 reserves gold for milestones). The filled alternative of the main button is flat `--kit-primary` with white text (4.84 : 1, s1 §2) and a 3 : 1 edge against the canvas from `--kit-hi`.

**Spacing and layout.** One column with a 16 px gutter under 640 px; a centered 640 px reading column from 640 to 1023 px; from 1024 px sections 2 to 4 become two columns (words left at the 640 px measure, the real screen right), the rest stays one centered column. Section rhythm `--landing-section-y`: clamp(56px, 7vw, 112px). Every tap target 44 px (`min-h-tap`). The page lays itself out from its own width (`@container`), like the public pages.

**The main action.** One per screen: the hero's "Shape my idea", then the closing "Shape my idea". Built in the recorded look (dark, white 1 px outline, `idea-gen`, founder 2026-11-13) behind `IDEA_BUTTON`; the flat filled primary is the alternative shown next to it in Storybook (`Landing/Direction`, stories "Hero, recorded button" and "Hero, filled button"). s1 recommends the filled one: its fill reads 4.1 : 1 against the page where the recorded one reads 1.6 : 1, and it is the only filled thing on the page. Founder decision 2.

**Motion.** The hero's entrance (the h1, lede and box rise 8 px and fade in once, 320 ms, `view` duration), the founder's typed placeholder, and a landed card's existing `landed` rise and edge flash. Nothing else moves: no ticker, no reveal on scroll, no auto-advancing tabs, no deck running by itself. Under `prefers-reduced-motion` all three are instant (the placeholder shows its first idea, still).

**Imagery.** Only real components with real props, each in a `ScreenFrame` (a 1 px `line` frame at phone width with an "Example" chip on its top edge): `IdeaCard`, `PersonPage`, `ProjectPage`. No illustrations, no stock photos, no fake app chrome.

**New design-system pieces (pull request 2), each with a story and a test:** `ScreenFrame` (a real screen at phone width, labeled Example), `LandingSection` (the section frame: h2, lede, words and an optional screen, the two-column rule), `DayList` (an example week: day, line, optional gold milestone), `AssuranceList` (icon and words, three at every width), `QuestionList` (native `<details>`), and the `idea-gen-filled` utility beside `idea-gen`. All are server-safe: none needs the browser.

## 8. Measures

**Page (Estimates to measure against, a mid-range phone on 4G, Lighthouse mobile):** LCP under 2.5 s, CLS under 0.1, INP under 200 ms, and first-load JavaScript for `/` well under today's (s3: about 604 KB Brotli in production). The new page is server components except the idea box, so the JavaScript a phone downloads is Next's runtime, React and the idea box. Pull request 5 records the numbers from a production build.

**Behavior (named now, wired when analytics exist).** Nothing is wired today: no analytics package is installed and the root layout (outside this session's files) would need it. Events the page will fire, named in the repo's dot style:

| Event | When | Properties |
| --- | --- | --- |
| `landing.viewed` | page load | `width_bucket` (390 / 768 / 1280+), `via` |
| `landing.idea_focused` | the field takes focus the first time | |
| `landing.surprise_opened` | Surprise me opened | |
| `idea.shaped` | a card lands (s2 §2.5, already proposed) | `source`, `interest`, `device`, `ms_to_card`, `sample` |
| `landing.keep_clicked` | a keep button pressed | `method` (google / email) |
| `landing.people_clicked` | Find people pressed (people layer on) | `from` (top bar / section) |
| `landing.example_opened` | "See another example" opened | |

The rate that matters: cards landed per visitor (`idea.shaped` / `landing.viewed`), then keeps per card. Everything else is diagnosis.

**Experiments (hypotheses only; s2 §9: below about 1,500 visitors a week none can be read).**
1. A filled "Shape my idea" raises cards per visitor over the recorded outlined button, because it is the only filled thing on the page (founder decision 2 can be settled by this once traffic exists).
2. Showing the example card above the fold on a phone (a cropped peek under the assurances) raises cards per visitor, because the reader sees the prize before typing.
3. A sticky "Shape my idea" on a phone once the hero scrolls away raises cards per visitor from people who read to the questions.

## 9. Recorded decisions this direction changes

Each is built in its recorded form behind a constant where it is a look, and proposed for the founder here.

| Recorded | What this direction does | Why |
| --- | --- | --- |
| DESIGN §9a: written for two readers, the first-timer and an investor | First-timer only; today's page at `/tour` (`TOUR_ENABLED`) | The brief (founder, Nov 15) and s1 §3.1. Founder decision 1. |
| 2026-11-13 idea box: "a phone gets the hero and the box, and a line that the rest is built for a larger window" | One page for every width, no note | The brief's design rule (founder, Nov 15): "No separate phone page and no wide-screen note". |
| 2026-11-13 idea box: Generate is dark with a white outline | Built as recorded behind `IDEA_BUTTON`; filled shown beside it | s1 §2.8; founder decision 2. |
| 2026-11-13 "less dense: keep every word and concept" | Every word and concept is kept on `/tour`; `/` is a new, shorter page | The brief replaces `/`'s purpose; `/tour` honors the recorded call for the second reader. |
| 2026-10-10 three example businesses with a picker; the page wears the example's colors | Moves to `/tour`; `/` wears Foundmill's own look | The brief: "the page wears Foundmill's own look". |

## 10. Decisions for the founder

| # | Question | Default built | Recommendation |
| --- | --- | --- | --- |
| 1 | Is `/` for the first-timer alone, with today's page at `/tour`? | Yes | Yes. |
| 2 | The idea box button: recorded (dark, white outline) or flat filled primary? | Recorded, both shown | Filled: it is the one main action and should read as one (4.1 : 1 against 1.6 : 1). |
| 3 | Index the home page once the new page merges? | No (`HOME_INDEXED = false`) | Yes once sign-up is open; an indexed page that ends at a waitlist spends the one first impression a search gives. |
| 4 | Open the people layer (`LIVE_MODE`)? | Closed; the find block stays hidden | Keep closed until reporting exists (WP-12 D2), as the main plan recommends. |
| 5 | Keep `/tour` after a month if nobody opens it? | Keep | Decide with a month of numbers. |
| 6 | (new) The pooled-credits line and "share in one tap" from the brief are held back: neither is true for a free stranger today (a9 §1.3, A9-P1-5). | Held back | Add each when its code ships. |
