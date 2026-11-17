# A1. The first run: from stranger to first real outcome

Audit of `/Users/reidjackson/code/founder-manager` at `04a0a509` (main, 2026-11-15). Read-only: nothing was run, built or tested. Every behavior below is from reading the code that runs each step. Paths are relative to the repo root.

**What I could not verify from the repo, and where it matters:**
- Production's environment values (Railway, Vercel, Supabase dashboard). I take them from `docs/DEPLOY.md`: `APP_ENV=staging` on the deployment that serves foundmill.com (§3, line 43), `MODEL_MODE=live` on api, composer and orchestrator, `INTEGRATIONS_MODE=mock` with `LIVE_CONNECTORS=github,domains`, `SANDBOX_MODE=e2b` on the orchestrator, `SIGNUP_ALLOWLIST` set and `SIGNUP_OPEN` unset ("Production stays invite-only", line 148). Whether `PLATFORM_MAIL_DOMAIN` + live SendGrid, `TURNSTILE_SECRET_KEY`, `NEXT_PUBLIC_AUTH_GOOGLE=on`, `MODEL_FAST_MODE`, `stripe_billing` are set is not recorded as done anywhere I found.
- The Supabase hosted email templates (only the Magic Link template is in the repo).
- Latency and cost: no measurement of either exists in `docs/PROGRESS.md` or `docs/DECISIONS.md` for the first session (THESIS 7.1 is open). All dollar and second figures below are my Estimates from route settings and list prices in `packages/models/src/pricing.ts`, and are labeled.

---

## 1. How it works today (in the founder's order)

### 1.1 Landing `/`

- `apps/web/app/page.tsx:14-22`: prerendered (`force-static`, `revalidate = 3600`), renders `LandingPage`. The proxy never serves it to a signed-in person (`apps/web/lib/auth/redirects.ts:101-108`: signed in on `/` goes to the last project, else is rewritten to `/start`).
- **Metadata:** the root layout sets `robots: { index: false, follow: false }` for every route (`apps/web/app/layout.tsx:18`). `app/page.tsx` exports no metadata, so **the landing page is noindex**. Only `/p/[slug]`, `/p/[slug]/story` and `/u/[handle]` override it to index (`app/p/[slug]/page.tsx:52`, `app/u/[handle]/page.tsx:32`). There is no `robots.ts` or `sitemap.ts` in `apps/web/app/` although the proxy and `PUBLIC_PREFIXES` reserve `/robots.txt` and `/sitemap.xml` (`apps/web/proxy.ts:54`, `redirects.ts:26`). Title is "Foundmill", description `APP_TAGLINE` = "Build a real business with a team of AI agents." (`packages/config/src/brand.ts:3`).
- **Desktop (>= 1280 px)** `apps/web/components/landing/LandingPage.tsx:62-80`: top bar (Sign in, "Start your business", both to `/login`, `:148-153`), `Hero` with the idea box, "Or watch an example run" with the picker and `CycleDeck`, then Ticker, Thesis, HowItWorks, TeamSection, LiveSessions, Journey, Channels, YourCall, FinalCall, Footer ("Desktop only · 1280 px and wider", `:168`).
- **Phone (< 1280 px)** `LandingPage.tsx:84-118` (`PhoneLanding`): the wordmark, Sign in, the hero with the idea box, and one line: "The rest of Foundmill, and the example business running, is built for screens 1280 px wide or more. Your card works here." (`:103`).
- **Hero** `components/landing/Hero.tsx:53-74`: pill "For founders · First company or fifth, the team comes with it" (`:57-58`), h1 = the tagline, lede "Start with one line. Your team of AI agents shapes it, builds it and runs it, in the open. You set the direction and make the calls only a founder should make." (`:66-68`). After a card lands the h1 becomes "{name} is yours to keep." (`:34-37`).
- **Idea box** `components/landing/idea-box/IdeaBox.tsx`:
  - One field ("Your idea, in a sentence", 3 to 500 characters, `packages/shared/src/idea-box.ts` `IDEA_BOX_PROMPT_MIN/MAX`), button "Shape my idea" (Enter). Or "No idea yet? Say what you are good at, or **Surprise me**", which opens 12 interests (`IDEA_BOX_INTERESTS`); one tap drafts from that interest (`IdeaBox.tsx:248-280`).
  - Assurances at rest (`:42-62`, `:281-285`): "Your first card is free · no sign-up", "Your idea stays private until you choose to share it", "Nothing moves money or signs in your name without you".
  - `draft()` (`:116-143`): gets an invisible Cloudflare Turnstile token (`turnstile.ts:46-66`, 15 s timeout; failure reads "We could not check this browser. Reload the page and try again."), then `streamIdeaDraft` posts to `${apiUrl}/idea-box/draft` with credentials (`client.ts:11-47`) and applies NDJSON events `partial`, `rating`, `card`, `error`.
  - While waiting: button reads "Shaping" with a spinning fan, the `IdeaCard` fills in (name, pitch, stars first, then each of ten ratings), and a polite live region says "Your team is shaping {name}" (`:315-317`). **No client timeout** on the stream.
  - Landed (`:289-314`): the card, "Sign in and it is saved to your account. From there your team checks it against real sources, drafts the plan, and starts building when you say so.", Continue with Google (only when `NEXT_PUBLIC_AUTH_GOOGLE=on`), "Continue with email" (to `keepHref` = `/login?next=/start?claim=<token>`, `:65-68`), "Free to start · $5.00 of included credits · no card", three "unlocks" (researched version with sources, more directions to compare, a team to build it), and "Not now? This card waits on this device for 7 days."
  - **Once a card has landed the field is replaced by the visitor's words (`:233-240`) and there is no control to try another idea.** A browser that already holds a card lands on it at load (`fetchMine`, `:101-110`) with "This is the card this device already holds. Sign in to keep it and draft more with your team."
- **Api side** `apps/api/src/idea-box-routes.ts:54-77`, `apps/api/src/services/idea-box.ts`:
  - `planIdeaBoxDraft` (`:123-175`), in order: body shape and honeypot; one card per browser (cookie `fm_idea`: returns the held card, no model call); Turnstile through the gateway (`gateway.verifyTurnstile`; fails closed outside development, `:139-150`); limits `IDEA_BOX_LIMITS` (`:31-35`: 3 an hour and 5 a day per address, 400 an hour overall); the day's ceiling `IDEA_BOX_DAILY_CEILING_CENTS` (default 2000 = $20, about 100 cards at the reserved worst case, `:43-52`, `:162-171`).
  - One model call: `buildIdeaBoxCardRequest` (`packages/agents/src/ideation.ts:196-215`) on route `ideation` (`IDEATION_CARD_ROUTE`, `:28`) = Opus 5.5, `effort: "low"`, `speed: "fast"` only when `MODEL_FAST_MODE` is on, `maxTokens` 4,000 (`packages/models/src/routing.ts:165`, `ideation.ts:33`). Streamed with `streamStructured` (`idea-box.ts:212-229`). No founder profile is sent; the visitor's line goes inside an untrusted block.
  - The card is stored in `idea_drafts` with `cost_micro` and a claim hash (`:231-242`); the browser gets `fm_idea` (httpOnly, 7 days, `Domain=IDEA_COOKIE_DOMAIN`).
  - Refusals are one fixed sentence each (`packages/shared/src/idea-box.ts:85-93`): `limit` "That is all the cards from this connection today. Sign in to keep going with your team."; `resting` "The idea box is resting until tomorrow. Sign in and your team can shape it with you."; `unavailable` "The idea box is not open right now. Try again in a minute."; `refused` "That one cannot become a card. Try another idea."; `failed` "The card could not be finished. Try again."
  - Server-side the only deadline on the model call is the client default `REQUEST_TIMEOUT_MS = 600_000` (`packages/models/src/client.ts:86`): a slow call can hold "Shaping" for up to ten minutes. The design target is "first words within 2 s, the whole card within 10 s" (`docs/IDEA_BOX.md` table); `firstTextMs` is logged (`idea-box.ts:241`) but I found no recorded measurement.
- **`/examples/[id]`** `apps/web/app/examples/[id]/page.tsx`: the same landing page prerendered for Glitchwick and Northwind; `/?example=<id>` is rewritten to it for signed-out visitors (`redirects.ts:94-98`).
- **What the page promises versus the product** (see FR-06): Thesis pillar "Agents open real pull requests on your GitHub, send email from your own accounts and reconcile your Stripe and bank data." (`components/landing/Thesis.tsx:20`); HowItWorks "The team drafts; you sign off; then they build. Nothing is spent until you approve it." (`HowItWorks.tsx:21`), step 04 shows the two sign-off notes, not the page; "Bring your own Anthropic key, or stay on the included credits." (`Control.tsx:26-30`); closing "Never started a company? You do not need to know how to incorporate, price, run ads or keep books." (`Control.tsx:149`). The public page a new project gets in its first session (the actual first real outcome) is not mentioned anywhere on the landing page. Nothing says sign-up is invite-only.

### 1.2 Getting in: `/login`, `/auth/*`

- `apps/web/app/login/LoginForm.tsx`: works from 390 px (`BrandFrame smallScreen`, `:99`). One field (Email) and "Send sign-in link" (`supabase.auth.signInWithOtp` with `emailRedirectTo` = the canonical `/auth/callback?next=…`, `:55-75`). Under it: "No password, no card. We email you a link." (`:156-158`) and "Foundmill is for people 18 or older: a new account confirms it once. By continuing, you agree to the Terms…" (`:163-173`). Footer: "Sign-in works on any screen. The workspace itself is built for screens 1280 px wide or more." Continue with Google sits above the form when `NEXT_PUBLIC_AUTH_GOOGLE=on` (`:124-140`).
- After sending (`:101-113`): "Link sent. Check {email} for a sign-in link and open it in this browser… Reading it on another device? Type the code from the email below." plus `SignInCode` (`SignInCode.tsx`: six digits, `verifyOtp({ email, token, type: "email" })`, errors "That code did not work. Check the newest email, or send a new link.").
- Email: `supabase/templates/magic_link.html` (subject "Sign in to Foundmill"; link + six-digit code; "work once and expire in 15 minutes"). `supabase/config.toml:28-30` declares **only** `[auth.email.template.magic_link]`; `docs/DEPLOY.md:255` lists pushing even that as "⬜ in the repo; the founder runs `supabase config push`". Sender is Supabase custom SMTP through Resend, `no-reply@foundmill.com` (`DEPLOY.md:270`).
- `apps/web/app/auth/callback/route.ts:37-53`: exchanges the PKCE code (or verifies a `token_hash`), then redirects to `signedInDestination(next, lastBusinessCookie)`. Failures go back to `/login?error=<reason>` with plain copy from `apps/web/lib/auth/sign-in-errors.ts:61-84` ("Link expired", "Link opened on a different address… open it in this browser", "New sign-ups are closed", Google variants). Send failures map to `sendLinkErrorMessage` (`:112-131`), including "We can't send sign-in emails to this address right now. Please contact support." (no support address is given anywhere on the page).

### 1.3 The gate: allow-list, admissions, waitlist, 18 or older, `/i/[token]`

- Every signed-in procedure is `protectedProcedure` (`apps/api/src/trpc.ts:300-305`), which calls `admitOrWait` (`apps/api/src/services/access.ts:188-233`). Decision `decideAdmission` (`:100-109`): `unrestricted` (no `SIGNUP_ALLOWLIST`, `SIGNUP_OPEN` off) admits everyone; `invite_only` (`SIGNUP_ALLOWLIST` set) admits listed addresses and accounts with an `account_admissions` row (invitation), else refuses `not_invited`; `open` (`SIGNUP_OPEN` on) admits until `SIGNUP_DAILY_CEILING` (default 200 per UTC day), else `on_waitlist`.
- **Production is invite-only** (`docs/DEPLOY.md:148`, conditions: the P2-1 fix, done, and "per-domain caps with a captcha for the many-addresses problem… not built yet"; `docs/IDEA_BOX.md` also names "per-account spend ceilings and reporting").
- A refused person sees `NotInvitedPage` (`apps/web/components/shell/NotInvitedPage.tsx:16-31`): panel title "Invite only for now", "{email} is not on the list", body `NOT_INVITED_MESSAGE` = "This address is not on the invite list yet. Ask the person who invited you to add it, or sign in with an address that is on it." (`access.ts:46`), footer "Foundmill is open to invited founders while it is in preview.", a Sign out button, and **Join the waitlist**: "Join the waitlist and we will let you in as soon as there is room. If you made a card on the home page, it is kept for you." After joining: "You are on the waitlist, and your card is kept for 90 days." or "You are on the waitlist. We will email you when there is room." (`:34-40`).
- `waitlist.join` (`apps/api/src/routers/idea-box.ts:48-59`) writes `waitlist_entries` and extends the draft's `held_until` 90 days. **Nothing ever admits from the waitlist or emails anyone**: `waitlist_entries.admitted_at` (`packages/db/src/schema/idea-box.ts:58`) is never written; no code reads the table except `waitlist.status` and the keep lookup (`services/idea-box.ts:299`). `docs/DECISIONS.md:3889`: "Admitting is still adding the address to SIGNUP_ALLOWLIST" (an env edit by the operator).
- Open mode's refusal is `OnWaitlistPage` (`components/shell/OnWaitlistPage.tsx`): "You're on the list. We'll let you in as soon as there is room. Come back tomorrow to check." (`packages/shared/src/allowlist.ts:99`), Sign out, "Look around an example" (to `/examples/<id>`).
- **18 or older**: asked once, on the profile form for a new account (`OnboardingScreen.tsx:750-757`, `AdultCheck` label "I am 18 or older", hint "You confirm this once."), sent as `confirmAdult: true` with the save; `founder.profile.update` calls `requireAdult` before creating the profile (`apps/api/src/routers/founder.ts:191-204`, `services/adults.ts:46-52`, table `adult_confirmations`). A person with a profile and no record sees `AdultStep` instead (`components/onboarding/AdultStep.tsx`, works from 390 px). `idea.commit` checks it again (`routers/idea.ts:367-368`).
- `/i/[token]` (`apps/web/app/i/[token]/page.tsx`): public, noindex, 390 px; `InvitationScreen` reads `invitation.byToken`, "Sign in to accept" returns with `next`; `invitation.accept` admits the account when the inviter may (`access.ts:306-337`, 3 new accounts per inviter per UTC day).

### 1.4 The signed-in index `/start`

- `apps/web/app/start/page.tsx:20-39`: `founder.profile.get`; on a refusal renders `ApiErrorPage` (`components/shell/ApiErrorPage.tsx`: `on_waitlist` → `OnWaitlistPage`, `not_invited` → `NotInvitedPage`, else `UnreachablePage`). Otherwise `ideaBox.preview` then `startDestination` (`apps/web/lib/auth/start-destination.ts:30-36`): a waiting card → `/new/card/keep`; no profile or no 18+ record → `/onboarding`; a project → its Today; else `/home`.

### 1.5 The kept card: `/new/card/keep`, `/new/card/[ideaId]`

- `app/new/card/keep/page.tsx` + `components/new/card/CardKeepView.tsx`: "Keep {name}?", the card, "Drafted from: "{their words}"", buttons **Keep this card** (Server Action `keepCard` → `ideaBox.claim` → `/new/card/<ideaId>`, `actions.ts:20-28`) and **Not mine**. Works from 390 px.
- `claimIdeaBoxDraft` (`apps/api/src/services/idea-box.ts:320-339`) creates an `ideas` row with `ideaFromCard(card, { brief: prompt, idea_box: true })`. The `brief` is what later steps treat as the founder's own words (the page draft and the foundations read it). The `idea_box` flag is written and never read.
- `app/new/card/[ideaId]/page.tsx` + `CardKeptView.tsx`: "{name} is yours", "It is saved in your deck. Your team starts from your words and checks every number against real sources." Next button: no profile → **"Answer three questions about you"** to `/onboarding`, with "Founder fit, and the plan your team drafts, come from what you can put in: your time, your money and what you are good at."; profile complete → **"Start building it"** to `/new/commit/<ideaId>` (`:26`). Secondary: "See more directions" to `/new/ideate`.

### 1.6 "Before you start": `/onboarding`

- `apps/web/app/onboarding/page.tsx`, `components/onboarding/OnboardingScreen.tsx`, `profile-form.ts`. Desktop only (`StudioFrame` without `smallScreen`, and `/onboarding` is not in `SMALL_SCREEN_PREFIXES`).
- Title "Before you start", lede "Foundmill drafts concepts, hires the team and runs the business within your constraints. Four quick answers are enough to start; add detail when you have it." (`OnboardingScreen.tsx:309-313`). Step trail: Your profile · Start · Ideas · Compare (optional) · Launch (`components/new/StudioFrame.tsx:27-33`).
- **Asked on the first pass** (`:411-519`):
  | Field | Required | Default | Validation (`profile-form.ts:356-378`) |
  | --- | --- | --- | --- |
  | "What the team calls you" (`displayName`) | yes | from the email's local part (`displayNameFromEmail`) | 1 to 120 chars; api also refuses reserved names and bidi controls |
  | Experience: First-time founder / Exited founder / Operator / Domain expert | yes | none | "Pick the one that fits best." |
  | Time: Full time / Part time / Evenings and weekends / A few hours a week | yes | none | "How much of your week does this get?" |
  | Residence, Citizenship | no | empty | max 80 chars; a partial country name is refused |
  | "I am 18 or older" | yes (new account) | unticked | "Confirm that you are 18 or older to continue." |
- **"Add detail (optional, improves the ideas)"** (collapsed for a first-timer; open by default for Exited founder and Operator, `profile-form.ts:479`): five skills 1 to 20 (Engineering "Can you ship, review and run software?", Sales, Design, Finance "Cash, pricing, forecasts, fundraising.", Domain; default 10), "Budget you can commit: Your own money for the first year, before any revenue. A number like 25,000 or 25k." with placeholder `25000` (`OnboardingScreen.tsx:621-632`) or "I have no budget yet", Currency (derived from residence, then browser locale, then USD), Target markets (chips "EU, UK, US, Nordics, DACH…"; default derived from residence), Constraints (chips; "every one is a hard limit"), Risk appetite Low / Medium / High (default medium).
- Side rail: "Sections · N of 5 done", "How the team reads you" (a one-line brief), "Your profile is private. Agents read it as context; it is never shown on the network, even when a business goes live." (`:384-388`), "Your account ID" disclosure.
- Stored by `founder.profile.update` → `repos.founders.upsert` in `founder_profiles` (`displayName, experience, skills, timeCommitment, budgetMinor, currency, citizenship, residence, targetMarkets, constraints, riskAppetite`); **the api only requires `displayName`** (`packages/db/src/repos/founders.ts:14-36`: every other field is nullable or optional). Then `onPersonCreated` (`apps/api/src/services/person-created.ts:62-73`): invitation attribution, sign-up attribution from the `fm_via` cookie (account events `signup.attributed`, `referral.arrived`), the adult record. Exited founders and Operators get guidance off and Builder view on (`founder.ts:50`, `:201-202`).
- After the save: toast "Welcome aboard. Next: ideate a concept or import what already exists." and **`router.push("/new")` unconditionally** (`OnboardingScreen.tsx:178-187`), whether or not the person just kept a card.

### 1.7 `/home` and `/new` (the doors)

- `/home` (`apps/web/app/home/page.tsx`, `components/person-home/PersonHome.tsx`): for a person with a profile and no project; works from 390 px. "Welcome, {name}", "Build something that is yours, with a team of agents doing the work beside you." Two cards: **Start something** (to `/new`, `:143`) and **Find a project or people** (to `/network` when `features.liveMode`, else a chip "Opening soon"; `LIVE_MODE` is unset in production per `DEPLOY.md:72`). Then "Waiting for you" and "Pick up where you left off" (three newest concepts, "Continue" to `/new/commit/<id>`, `:229`) when there is something.
- `/new` (`app/new/page.tsx`, `components/new/Doors.tsx`): desktop only. Title "Your first business", lede "Your profile: First-time founder · evenings and weekends · …". Doors (`:75-109`): **Door A** "I have an idea, or none yet" ("Recommended for you" for a first-timer; cta "Open the Ideation Studio"), **Door B** "I already run something" (cta "Choose sources": GitHub, Drive, Notion, Linear, Jira, Stripe, Shopify, a bank, the company registry), and **Example** "Explore an example: Walk around a business two years in, with paying customers and a team at full stretch…" when the deployment has a demo business (`business.example.get` / `.open`). Below: "Concepts in progress" (up to 12, each with a **Commit** button, `:254-286`): this is where a kept idea-box card reappears after the profile step.

### 1.8 `/new/ideate`, `/new/compare`, `/new/import`

- **Ideation Studio** (`components/new/ideate/IdeationStudio.tsx`; desktop only). Panel header "Brief for the Ideation agent" (`:400`), hero "What should exist that does not yet?" and "A concept, a problem, a market, or nothing at all. The Ideation agent drafts six to twelve cards and rates each on ten attributes…" (`:406-407`). One textarea (0 to 4,000 chars, placeholder "A problem you have seen, a market you know, or nothing at all."), an optional "Kind of business" select, three example-brief chips while the deck is empty. The brief is seeded from the browser's own `lastPrompt` (`:165-168`), **not** from the landing idea box (that idea is already a card in the deck).
  - **Draft concepts / "Draft 6–12 ideas for me"** → `idea.draft` (`apps/api/src/routers/idea.ts:175`, `modelLimited("ideation")`): one slate call (route `ideationSlate`, Opus low effort) plus one card call per slate item (route `ideation`), 6 at a time, each retried once (`apps/api/src/services/ideation.ts:1-27`). So **7 to 13 Opus calls**, up to 25 with retries. The founder watches a live run panel (steps, one bar segment per concept, elapsed and time left, names as the slate arrives, cards landing with "Just in"; `DraftStatus.tsx`, `draft-run.ts`), with Stop. Allowance `IDEATION_LIMITS` 20 drafts an hour, 60 a day per person (`ideation.ts:41-45`), plus the shared ceiling (`services/model-limits.ts:34-37`).
  - **Use my idea as written** (shown when the brief holds the founder's own words, `:74-76`) → `WriteDialog` (`dialogs.tsx:507-560`: "Working name" (required, 60), "Your idea, in your words" (required, 4,000), "Kind of business"), button "Rate it and go to Commit" → `idea.write` (one `ideation` card call via `buildFounderCardRequest`; the pitch stays the founder's words) → straight to `/new/commit/<id>` (`IdeationStudio.tsx:213-221`).
  - Per card: Shortlist, Edit, Merge, More like this, Ask (the Research agent's desk; `idea.ask`, route `conversation`, Sonnet low effort), Discard / Restore, History. Steering chips "Cheaper to start", "B2B instead", "More defensible" (`:104-108`).
- **Compare** (`components/new/compare/CompareScreen.tsx`, optional): pick 2 to 4 cards → `idea.compare` (one `ideation` Opus call).
- **Import** (`components/new/import/ImportScreen.tsx`): Door B, for someone who already runs something; not on the target user's path.
- **Pre-commit model calls are not booked anywhere**: "Calls with no business (Ideation drafting, Ask on a concept, a logo before commit) are not booked: there is no ledger to book them to yet" (`apps/api/src/services/models.ts:8-9`). They cost the founder no credits and Foundmill has no per-account record of them.

### 1.9 `/new/commit/[ideaId]`

- `components/new/commit/CommitScreen.tsx`, `naming.ts`; desktop only. Title "Commit to {name}", lede "Name it, give it a logo, choose how it is run. Taking charge hires the team, which starts by drafting your vision, specification and roadmap." (`:514-524`), primary button **Take charge** (`:531`).
- Fields and defaults (`naming.ts:325-340` `initialCommitForm`):
  | Control | Required | Default |
  | --- | --- | --- |
  | Business name | yes | the card's title; suggestions offered |
  | "Check the name (domains and trademarks)" | automatic | `idea.domainCheck` runs on every name change after a debounce (up to eight registry lookups through the gateway, real RDAP when `LIVE_CONNECTORS` names `domains`); trademark quick screen is local and labeled Estimate |
  | Logo and two brand colors | no | initials mark; colors from the idea's seed; "generate marks" is `idea.logo.stream` (route `logoDesigner`, Opus, 4 marks) only if pressed |
  | "How it runs" (one line of chips with "Change"; collapsed while guidance is on, `:505`) | | Personal · Assisted · {kind} · "Asks you above €250" · Autopilot on |
  | Personal or Live | | Personal (Live offered only when `features.liveMode`) |
  | Kind of business (7 archetypes) | yes | the card's archetype |
  | Mode Augmented / Assisted / Automated | | Assisted |
  | Spend cap per action | | `DEFAULT_SPEND_CAP_MINOR.assisted` (from `LIMITS.approvalThresholdMinorDefault` = 25000) |
  | Overnight shift (Autopilot) | | on: one round a night at about 2 AM, own ceiling 15 cents (`packages/shared/src/autopilot.ts:397`) |
  | Anthropomorphic agents + style | | the account preference (off) |
- The rail shows the team the archetype seeds (`idea.preview`), "What happens next" (`WHAT_HAPPENS_NEXT`, `:238-243`: "Your team is hired", "The Product lead drafts vision, specification and roadmap (a minute or two)", "Two notes ask you to sign them off", "Then building starts. Nothing is spent until you approve it.") and "Starts with $5.00 of included credits this month. No card." (`includedCreditsLine`, `:246-248`).
- While committing the header reads "Setting up your business: departments, team and the first cycle. This takes a few seconds." (`:231`). On success: toast "{name} is yours. Your team is drafting the vision, specification and roadmap; two notes will ask you to sign them off." and `router.push(routes.today(id))` with a 4 s hard-navigation fallback (`:120-138`).
- States: loading skeleton; "No such concept" with "Back to your concepts"; "This concept already became a business" with "Open the business"; a refused commit shows a toast "Not committed" plus the message.

### 1.10 What `idea.commit` creates

`apps/api/src/routers/idea.ts:328-372` → `commitIdea` (`apps/api/src/services/commit.ts:171-441`), one transaction:
- claims the idea (`repos.ideas.claimForCommit`, `:192`; a second press returns the first business, `committedIdeaResult`), `assertBusinessAllowance` (unlimited today), `planTier = "free"`, `modelBilling = "credits"` (`:197-198`);
- `businesses` row (slug `<slugified name>-<6 random chars>`, so a duplicate name never conflicts, `:161-164`), owner `memberships` row, Autopilot settings when chosen (`autopilot.changed` event), the month's `credit_balances` grant (`repos.usage.ensurePeriodCredits`, `:228`: $5.00 from `TIERS.free.includedCreditsMinor`, one pool a month per founder);
- departments from the archetype seed, every agent hired from templates (`hireMany`), leads set, module screens, all channels (only starters that can really act are enabled), empty specification blocks, the `business_foundations` row (`pending`, `seedFoundations`, `:326`), concept sources;
- **the first cycle's groundwork tasks** (`seed.firstCycleTasks`, `:332-345`; for the software archetypes: "Answer the specification's open questions" (Product lead), "Set up the first runway forecast" (Finance lead), "Where to incorporate, and the rules that apply" (Legal lead); `packages/agents/src/archetypes.ts:124-156`, `:201-209`);
- the founder's Home dashboard; **the first note**, from the Chief of Staff (`welcomeNote`, `:147-159`): subject "Your team is drafting the product foundations", body "I'm your Chief of Staff. I run the team so you only read and decide. Some things are always yours: money, signatures, contracts, deleting things." / "The team is hired: N agents in M departments." / "{Product lead} is drafting the vision, the specification and the roadmap from your idea and your founder profile; you will get two notes asking you to sign off each. Building starts when both are approved." / "Nothing is spent on distribution until you start it from Customers › Board.";
- event `idea.committed` and an audit row `idea.commit`.
After the transaction: `temporal.start(WORKFLOWS.businessCycle, cycle 1)` (`:436`) and the Autopilot workflow.

### 1.11 After commit: the page first, then the foundations

- The business shell calls `product.foundations.ensure` on load while the foundations are pending (`docs/ARCHITECTURE.md` §19 "Trigger"), which starts `businessFoundations` on Temporal, or runs the same steps in the api when Temporal does not answer.
- `apps/orchestrator/src/workflows/businessFoundations.ts:81-132`:
  0. `draftProjectPage` (`:92-98`): one call on route `projectPage` (Sonnet 5.5, low effort; `routing.ts:200`) from the founder's words; any failure falls back to the deterministic `starterProjectPage`. `repos.pages.writeTeamDraft` writes a `project_pages` row (never published), an audit row, and the Product lead's note **"Your project's page is ready"** with **Check it and publish** / **Later** (`packages/shared/src/project-page.ts:261-267`). Timeout 2 minutes, retried once.
  1. `draftFoundationsPlan`: one call, route `foundationsSkeleton` (Opus, low effort): the vision, one thesis per section, roadmap titles.
  2. `draftFoundationsSections` in parallel batches (at most six calls) plus `draftFoundationsRoadmap`: route `foundations` (Opus, low effort).
  3. `applyFoundations`: writes the vision, `spec_blocks`, `roadmap_items`, and the two sign-off notes.
  4. `secondReadDocument` (at most two calls on route `documentReview`, Opus default effort, plus a few web lookups), after the foundations are ready.
- In parallel, cycle 1 (`apps/orchestrator/src/workflows/businessCycle.ts`): the Chief of Staff's plan (route `chiefOfStaff`, Opus), then agent sessions for the groundwork tasks (before sign-off the planner is told "plan research, finance, legal and specialist groundwork only", `apps/orchestrator/src/activities/brief.ts:31`), then composer notes (route `inboxComposer`, Opus, locked).
- Publishing (`apps/api/src/services/pages.ts:218-255` `publishPage`): owner or admin only (`sectionAdmin("product")`), content limits, a local screen for markup and personal data (`pageHoldReason`, no model call), then `repos.pages.publish`, event **`page.published`**, the "page live" milestone, the note closed, an audit row. The page is served at `/p/<slug>` (`apps/web/app/p/[slug]/page.tsx`, indexable, 390 px). No model credits are needed to publish.

### 1.12 `/b/[bid]/today`, the checklist, tours, the example

- Today (`apps/web/components/today/TodayScreen.tsx:109-153`), in order: blockers, the foundations banner (drafting progress), since-last-visit, streak, **Your first week** (`FirstWeekTimeline` from `packages/shared/src/first-week.ts:90-141`: Day 1 "Your team drafts your page, your specification and your roadmap." / "You are asked to publish your page and sign off the specification and the roadmap."; Days 2–3; Week 1), **Your goal**, **Needs you** (up to three notes; the page note's one tap opens Product › Public page, `components/inbox/ReadingPane.tsx:350-353`), the quiet public-page line, This week and next, Health (Cash, Runway, Customers this week, spend).
- Needs-you empty text in the first days: "Nothing needs you yet. Your first notes, the specification and the roadmap to sign off, arrive once the team finishes drafting them, usually on day 1." (`packages/shared/src/empty-why.ts:55-57`): no mention of the page.
- Product › Public page (`packages/modules/src/product/PublicPageScreen.tsx`): pitch, about, who it is for, stage, "Name the people building it", "Let people follow this project" (on by default), a phone-width preview, the address, **Publish** with a confirm dialog "Publish your public page?", then Copy link / Share your page / Open. Desktop only (it is a department tab).
- First-week checklist (`packages/dugout/src/components/firstrun/FirstWeekChecklist.tsx:34-42`, on Home/Details): Publish your page; Sign off the specification; Sign off the roadmap; Run a cycle; Read a note from an agent; Talk to an agent; Start distribution.
- Tours (`apps/web/components/tours/definitions.ts`): Home (5 steps), Inbox (4), first department tab (3). None on Today (where a new founder lands) or on the Public page tab. The Inbox tour does not start on a phone.
- Example project: the third door on `/new` (`business.example.open` adds a viewer membership on the seeded demo), and "Look around an example" on the open-mode waitlist page.

### 1.13 The first emails

1. The Supabase sign-in email (1.2). For a brand-new address Supabase sends its "Confirm signup" template, which is not in the repo (FR-13).
2. Nothing at sign-up, nothing for a person with no project, nothing from the waitlist.
3. After commit, only if platform mail is live (`platformMailLive`, `packages/shared/src/env.ts:325`: `PLATFORM_MAIL_DOMAIN` set and SendGrid live): "a decision is waiting" 30 minutes after the founder left when the note holds up work, else 24 hours; the morning brief at their hour; the weekly review; wins, milestones, used-up credits (`packages/shared/src/notify-words.ts`, gateway `POST /v1/notify/email`, at most 4 event emails a day). `docs/THESIS_REVIEW.md` §13 status: "off until its DNS and SendGrid setup".

### 1.14 Credits and keys in the first session

- Free tier: `TIERS.free.includedCreditsMinor = 500` ($5.00 a month, `packages/config/src/pricing.ts:19`), one pool per founder per month (`includedCreditBusinesses: 1`), 4 concurrent agents. Pro and Scale are "TBD" and cannot be chosen (`PRICE_TBA_LABEL`).
- Before commit nothing is charged (1.8). After commit every platform-key call for the business passes `assertPlatformCredits` (`packages/db/src/billing.ts`) and is booked in `usage_ledger`.
- An agent session's budget is the smallest of the task budget (default `DEFAULT_TASK_RESERVE_MINOR = 2_000` = $20, `apps/orchestrator/src/cycle-contract.ts:66`), **the credits left**, the agent's wage cap ($400 for a lead, `packages/agents/src/templates/_shared.ts:41-48`) and the monthly model budget (`apps/orchestrator/src/activities/session-budget.ts:60-107`). On a $5 balance each of the three day-one lead sessions (route `departmentLead`, Opus) is bounded only by what is left.
- Low credits (below $1): routine routes move down a model (`lowCreditsThresholdMinor`, `pricing.ts:75-82`); finance and legal sessions keep Opus (`routing.ts:125-128`).
- At zero: "This month's credits are used up, so every agent is paused. Top up in Settings → Billing, or bring your own Anthropic key in Settings → Keys, and the team resumes by itself; tasks pick up where they stopped." (`packages/db/src/billing.ts:358`). Top-ups need `LIVE_CONNECTORS=stripe_billing`; otherwise "Top-ups are not available on this server yet: payments are not set up, and simulated payments are off here. Use your own Anthropic key in Settings › Keys meanwhile." (`apps/api/src/services/payments.ts:47`).
- A bring-your-own key is never required to start, publish a page or use Today. It becomes the only exit when credits run out and top-ups are off.
- Ceilings per account: request-count windows only (`SHARED_MODEL_LIMITS` 60 a minute, 600 an hour, 3,000 a day per person; `commit` 10 an hour, 30 a day; `ideation` 20 an hour, 60 a day). There is no dollar ceiling per account, and pre-commit spend is not recorded.

### 1.15 The eight questions, answered

**Q1. Steps, required fields, model calls, minutes.**

Path A, desktop, starting in the idea box, account admitted:

| # | Screen | The person does | Required input | Model / vendor calls |
| --- | --- | --- | --- | --- |
| 1 | `/` | types one line, Enter | idea (3 to 500 chars) | Turnstile; **1 Opus call** (`ideation`) |
| 2 | `/` | "Continue with email" | | |
| 3 | `/login` | types email, "Send sign-in link" | email | Supabase email |
| 4 | inbox | opens the link in the same browser, or types the code | | |
| 5 | `/new/card/keep` | "Keep this card" | | |
| 6 | `/new/card/<id>` | "Answer three questions about you" | | |
| 7 | `/onboarding` | confirms name, picks experience and time, ticks 18+, Continue | experience, time, 18+ (name prefilled) | |
| 8 | `/new` | finds the card under "Concepts in progress", "Commit" | | |
| 9 | `/new/commit/<id>` | "Take charge" | (name and kind prefilled) | up to 8 RDAP lookups, automatic |
| | **(a) committed project** | 9 screens, about 8 presses, 5 required inputs | | **1 model call** |
| 10 | `/b/<id>/today` | waits for "Your project's page is ready" | | 1 Sonnet call (`projectPage`) |
| 11 | Needs you | "Check it and publish" | | |
| 12 | Product › Public page | reads the draft, "Publish", confirms | (draft prefilled) | none |
| | **(b) live page** | 12 screens, about 11 presses, 5 required inputs | | **2 model calls on the critical path** |

Running behind steps 10 to 12 and not needed for the page: 1 + up to 6 + 1 Opus calls (foundations), up to 2 Opus calls (second read), the Chief of Staff's cycle plan, three Opus lead sessions, composer notes, a goal proposal.

Path B, no idea box ("Start your business"): login → `/onboarding` → `/new` → Door A → `/new/ideate` → either "Use my idea as written" (1 Opus call, 2 fields prefilled from the brief) or "Draft concepts" (7 to 13 Opus calls) → Commit. One or two screens more than path A.

Wall clock for a first-timer on a desktop, my Estimate (nothing is measured): 10 to 15 minutes to a live page. Slowest steps: the email round trip (1 to 3 minutes, longer when the link opens in another browser and fails with "Link opened on a different address"); reading "Before you start" (1 to 2 minutes); finding the card again on the doors screen; the Commit screen (1 to 3 minutes of reading); waiting for the page note (one Sonnet call after a Temporal workflow start; unmeasured, likely 15 to 60 s); reading and publishing the page (2 to 3 minutes). "Draft concepts" adds 30 to 90 s (Estimate) of visible streaming.

**Q2. Where a person with no idea, money, company or technical account stalls.** See FR-01 to FR-05, FR-08, FR-09, FR-12 to FR-15 in section 3; each quotes the copy.

**Q3. Asked up front that could be inferred or deferred** (THESIS 2.3, 2.6); all still asked today:
- Experience (4 operator categories): only switches guidance and Builder view and feeds prompts. Default "first_time"; ask later or never.
- Time commitment: used in prompts only. Defer to the first goal conversation.
- Residence and citizenship: optional, but on the first screen; only needed when Legal recommends where to register. Infer currency from locale (already done) and ask when Legal first needs it.
- Skills 1 to 20, budget (placeholder 25000), target markets, constraints, risk appetite: collapsed, still present, operator vocabulary. THESIS 2.3 asks for three plain questions (what should we call you; what are you good at or enjoy; what are you here for); not built.
- Commit: kind of business (inferable from the card; already prefilled), domain and trademark check, logo and colors, Personal/Live, mode, spend cap, Overnight shift, agent faces. THESIS 2.6 "Name and go" is not built; guidance collapses five of them into one line.
- The api already accepts a profile with only a name and the 18+ confirmation (`FounderProfileInput`), so deferring is a web change plus prompt defaults.

**Q4. Live versus simulated in production, and cost.** Section 2. Measured cost per first session: **none exists** (THESIS 7.1 open; pre-commit calls are not even booked). My Estimates from list prices (Opus $4 / $20 per million tokens in / out, Sonnet $2 / $10; doubled for Opus when `MODEL_FAST_MODE` is on): idea-box card about $0.05 to $0.10 (reserved at about $0.19 worst case); a 6 to 12 card set about $0.40 to $1.30; "Use my idea as written" about $0.05 to $0.10; page draft 0.6 to 1.5 cents (`docs/PROGRESS.md:1950`, itself an Estimate); foundations about $0.30 to $0.60; second read about $0.10 to $0.30; cycle plan and notes about $0.15 to $0.40; the three lead sessions unknown and bounded only by the balance. So a new project plausibly spends $0.60 to $1.30 of its $5 before any agent session, and the sessions can take the rest on day one (FR-04).

**Q5. Small screens (390 px).** `apps/web/components/providers/DesktopOnly.tsx:29-61`.
- Work: `/` (hero and idea box only), `/login`, `/new/card/keep`, `/new/card/<id>`, `/home`, `/p/*`, `/u/*`, `/m/*`, `/a/*`, `/i/*`, `/email/pause`, `/terms`, `/privacy`, `/public-profile`, `/network`, `/communities`, `/profiles/*`, `/b/<id>/today`, `/b/<id>/inbox[/<item>]`, the 18+ `AdultStep`, the open-mode `OnWaitlistPage`.
- Hit the wall: `/start` when it renders the invite-only page (FR-02), `/onboarding` (the new-account form), `/new`, `/new/ideate`, `/new/compare`, `/new/import`, `/new/commit/*`, every department tab including Product › Public page, Home/Details, Settings, `/examples/*` opened directly.
- The wall (`packages/dugout/src/components/shell/NeedsLargerWindow.tsx:31-39`): "This needs a larger window" / "Foundmill is built for desktop screens at least 1280 px wide. Widen the window or move to a larger display." / "Current width: 390 px". No link, no "email me the link", no sign-out, no way back.
- Result: on a phone a new person can make a card, sign in and keep the card, and then cannot answer the profile questions, start a project or publish a page.

**Q6. Error, empty, loading, timeout states.**

| Step | Loading | Failure | Timeout | Notes |
| --- | --- | --- | --- | --- |
| Idea box | "Shaping", card streams | seven fixed sentences (1.1); stream cut → "not open right now" | Turnstile 15 s; model call none below 10 minutes | a second card is impossible; `limit` and `resting` tell the visitor to sign in, which is closed |
| Send link | button spinner | 8 mapped reasons (`sign-in-errors.ts:112-131`) | Supabase default | "Please contact support." names no contact |
| Callback | | `/login?error=` with title and next step; expired link "Send a new link and use the newest email." | | good |
| Closed sign-up | | invite-only page or "New sign-ups are closed" | | waitlist promise has no code (FR-01) |
| Profile | button spinner | inline per field; toast "Profile not saved" + named answers | | good |
| Draft concepts | live run panel with elapsed and time left, Stop | per-card retry; "…ran out of room…"; "Drafting limit reached. Try again in N minutes." | no overall deadline | cards already drafted are kept |
| Commit | skeleton; "Setting up…" | toast "Not committed"; "No such concept"; "already became a business" | 4 s navigation fallback | duplicate names cannot conflict (random slug suffix) |
| Foundations | banner with live progress | "The drafting did not finish. Try again." | failed after 10 minutes (local) or 45 minutes (Temporal) with Try again | page draft failure falls back to a starter draft silently |
| Publish | button spinner | field errors; held for markup or personal data with a sentence; address taken → conflict | | no model needed |
| Credits used up | | note + banner (1.14) | | exits need a card or an Anthropic key |

**Q7. Voice.** FR-16 has the five weakest strings with rewrites.

**Q8. Activation instrumentation.** FR-10. Short answer: no. There is no event for sign-up, profile completed or idea drafted; `idea.committed` and `page.published` exist; the only report (`pnpm --filter @foundmill/db report:retention`) defines activation as "both sign-offs and a first Continue within 24 hours" (`packages/shared/src/founder-return.ts:8-9`), which predates the page; nothing computes the north star.

---

## 2. Real, simulated, not connected in production

"Production" is the deployment serving foundmill.com (`APP_ENV=staging`). Source for modes: `docs/DEPLOY.md` §3, §5, §6; I did not read live env values.

| First-session step | State | How I know |
| --- | --- | --- |
| Landing page, example business, deck, ticker | Real page, scripted example data labeled Example | `components/landing/examples/*.ts` (static), `DESIGN.md` §9a |
| Idea-box card | **Live model** (Opus, platform key), if `TURNSTILE_SECRET_KEY` (gateway) and `NEXT_PUBLIC_TURNSTILE_SITE_KEY` (Vercel) are set; otherwise every draft answers "not open right now" | `services/idea-box.ts:139-150`; `DEPLOY.md:128-138` (setup steps, no "done" mark found) |
| "checks it against real sources" (landing and kept-card copy) | **Not true by default**: the `web` connector is mock unless named in `LIVE_CONNECTORS`; THESIS 1.4 ("Real web research") is listed as next, not done | `THESIS_REVIEW.md:395` status; `DEPLOY.md` §6 "every service runs mock except GitHub" |
| Sign-in email | Real (Supabase + Resend SMTP) | `DEPLOY.md:270` |
| Continue with Google | Built; shown only with `NEXT_PUBLIC_AUTH_GOOGLE=on` ("off until set up") | `LoginForm.tsx:41`, `THESIS_REVIEW.md:417` |
| Admission | Real: invite-only | `access.ts`, `DEPLOY.md:148` |
| Waitlist | Row written; **no admission, no email** | section 1.3 |
| Profile, 18+ | Real (database) | `founder.ts:191-204` |
| Ideation set, Use my idea, Ask, Compare, logo marks | **Live models** on the platform key, free to the person, **not booked** | `services/models.ts:8-9` |
| Domain availability on Commit | Real registry lookups (RDAP) when `LIVE_CONNECTORS` has `domains` (DEPLOY says yes) | `DEPLOY.md` §6 row "Real domain availability" |
| Trademark quick screen | Local heuristic, labeled Estimate | `commit/naming.ts` `trademarkScreen` |
| Commit (business, team, tasks, first note) | Real (database) | `services/commit.ts` |
| Project page draft | **Live model** (Sonnet), falls back to a deterministic starter | `businessFoundations.ts:92-98`, `ARCHITECTURE.md` §19 "Step 0" |
| Publish to `/p/<slug>` | **Real outside outcome** (Foundmill-hosted, indexable, share image) | `services/pages.ts:218-255`, `app/p/[slug]/page.tsx:52` |
| Follow form on the page | Form is real; the confirmation email goes out **only if platform mail is live**. Otherwise the visitor reads "Check your email to confirm" and nothing is sent, the record stays pending and `page.followed` never fires | `services/pages.ts:608-622`; `packages/dugout/src/components/public/ProjectFollowForm.tsx:11` |
| Vision, specification, roadmap | **Live models** (Opus) | `businessFoundations.ts`, routes `foundationsSkeleton`, `foundations` |
| Second read | Live model (Opus); its web lookups hit the mock or "not connected" unless `web` is live | `activities/second-read.ts` |
| Cycle 1 plan, Inbox notes, goal proposal | **Live models** (Opus; goal Sonnet) | `routing.ts:151-153`, `:192` |
| Day-one agent sessions (open questions, runway forecast, where to incorporate) | **Live** Claude Agent SDK sessions on the orchestrator (`SANDBOX_MODE=e2b`), gateway tools only; web research mock or not connected, so "dated sources" cannot be real | `DEPLOY.md` §5.3 and §6; `THESIS_REVIEW.md` 7.1, 7.3 |
| Email to the founder ("a decision is waiting", morning brief) | Real only with `PLATFORM_MAIL_DOMAIN` + live SendGrid; otherwise nothing | `env.ts:325`; `THESIS_REVIEW.md:395` |
| Email from the project to a stranger | Same condition; founder approval required | `DEPLOY.md` §5.7 |
| Channels | Only channels that can really act are enabled; social is "post by tap" (the founder posts); no engine before "Ready to start selling?" | `services/channel-availability.ts`, `commit.ts:304-318` |
| Payment link | **Not built** (THESIS 1.6 second half) | `THESIS_REVIEW.md:395` |
| Code repository for a project with no GitHub | **Not built** (THESIS 1.7); code tasks need the founder's own GitHub | `THESIS_REVIEW.md:412` |
| Credit top-up | Real only with `stripe_billing` live; otherwise "Top-ups are not available on this server yet" | `services/payments.ts:47` |
| Paid plans | Not on sale ("Price to be announced") | `pricing.ts:20-21`, `:27` |

So, with platform mail off, the **only real outside outcome a brand-new solo founder can reach in session one is the published page** (and sharing its link by hand or by tap-to-post). That one is solid. A stranger's follow, an email sent and a payment taken all depend on configuration or code that is not confirmed live.

---

## 3. Findings

Severity: P0 stops the target user reaching a real outcome or breaks trust; P1 major friction or risk; P2; P3.

### FR-01 (P0) A stranger cannot get in, the landing page does not say so, and the waitlist is a dead letter

- **Evidence.** Production is invite-only (`docs/DEPLOY.md:148`). The landing page's every call to action goes to `/login` with "Free to start · $5.00 of included credits · no card" (`IdeaBox.tsx:55`) and "Sign in and it is saved to your account… starts building when you say so" (`:53`); nothing on `/` or `/login` mentions invitations. After making a card and signing in, the visitor reads "Invite only for now" / "{email} is not on the list" / "This address is not on the invite list yet. Ask the person who invited you to add it, or sign in with an address that is on it." (`NotInvitedPage.tsx:17-19`, `access.ts:46`). "Join the waitlist" then answers "We will email you when there is room." (`NotInvitedPage.tsx:38`), but no code sends that email, sets `waitlist_entries.admitted_at`, or admits an entry; admission is an operator editing `SIGNUP_ALLOWLIST` (`docs/DECISIONS.md:3889`). The idea box's `limit` and `resting` errors also tell a visitor to "Sign in to keep going with your team" (`packages/shared/src/idea-box.ts:88-89`).
- **Impact.** The target user spends their first minutes on a card, gives an email address, and is told to ask "the person who invited you" (there is none). The one promise made in return has no implementation. The north star cannot move for anyone outside the list.
- **Fix.**
  1. *Tell the truth before sign-in.* When the deployment is invite-only, the landed idea box and `/login` say so and offer the waitlist as the action: add a public tRPC query `access.mode` (returns `"open" | "invite_only" | "unrestricted"` from `signupMode(env)`, `packages/shared/src/allowlist.ts`) or a `NEXT_PUBLIC_SIGNUP_MODE` build value; change `IDEA_BOX_WORDS.keepLead/freeLine` (`IdeaBox.tsx:53-55`) and the `limit`/`resting` sentences accordingly.
  2. *Make the waitlist real.* In `apps/api/src/services/access.ts` add `admitFromWaitlist(db, { limit })`: inside the advisory lock (`repos.admissions.lockOpenCount`), take the oldest `waitlist_entries` rows with `admitted_at is null`, write `account_admissions` with `how = 'waitlist'` (add `"waitlist"` to `ADMISSION_KINDS`, `packages/db/src/schema/people.ts:20`, with a migration for the column's check, and teach `inviterStanding` that such an account's standing is `open`), set `admitted_at`, and ask the gateway for one email (`POST /v1/notify/email`, new kind `waitlist_admitted` in `EMAIL_NOTIFICATION_KINDS`, words in `packages/shared/src/notify-words.ts`, link `APP_URL/start`). Run it from the orchestrator's `SCHEDULES` (`apps/orchestrator/src/schedules.ts`) under a daily number (`WAITLIST_ADMISSIONS_PER_DAY` env) and expose an operator command (`pnpm --filter @foundmill/db waitlist:admit -- --count N`). Declare an account event `waitlist.admitted` (four steps in `packages/events/CLAUDE.md`). `waitlist_entries` already has RLS on with no `authenticated` policy; keep it.
  3. *Open sign-up.* The two stated blockers are per-domain caps with a captcha and per-account spend ceilings (FR-11). Build both, then set `SIGNUP_OPEN=1`.
  4. Until email exists, change `WAITLIST_WORDS.joined` to what is true ("You are on the waitlist. Come back to check; we cannot email you yet.").
- **Tests.** a new `apps/api/src/__tests__/waitlist-admission.test.ts` beside `signup-allowlist.test.ts` and `invitations-admission.test.ts` (admission order, daily number, idempotence, lock), RLS test that `waitlist_entries` stays closed, `apps/web/e2e/idea-box.spec.ts` (invite-only copy on the landed card), a notify-email test for the new kind.

### FR-02 (P0) On a phone the invite-only page and its waitlist are hidden behind "This needs a larger window"

- **Evidence.** The idea box sends everyone to `/login?next=/start…` (`IdeaBox.tsx:65-68`), so after sign-in the browser's path is `/start`. `/start` is not in `SMALL_SCREEN_PREFIXES` (`DesktopOnly.tsx:29-51`). When the api refuses with `not_invited`, `start/page.tsx:28-30` renders `ApiErrorPage` → `NotInvitedPage`, which uses `BrandFrame` without `smallScreen` and does not render `<WorksOnSmallScreens />` (`NotInvitedPage.tsx:19`), unlike `OnWaitlistPage.tsx:28-29`. Both the root `DesktopOnly` (`:83-84`) and `BrandFrame` (`:48-49`) therefore return `NeedsLargerWindow` below 1280 px. (A plain sign-in with no `next` lands on `/`, which is on the list; I expect that case to render, since the proxy rewrites rather than redirects, but did not run it.)
- **Impact.** The landing page's phone hero is the product's stated hook. A phone visitor who makes a card and signs in gets a dead-end wall with no explanation, no waitlist and no sign-out. In the current production mode this is every uninvited phone visitor.
- **Fix.** In `apps/web/components/shell/NotInvitedPage.tsx` pass `smallScreen` to `BrandFrame` and render `<WorksOnSmallScreens />` first (copy `OnWaitlistPage`); give its buttons `min-h-tap`. Do the same for `UnreachablePage`. Add `"/start"` to `SMALL_SCREEN_PREFIXES` so the landing fallback it can render (`start/page.tsx:24`) is not walled either.
- **Tests.** `apps/web/components/providers/__tests__/desktop-only.test.tsx` (add `/start`), `apps/web/components/shell/__tests__/api-error-page.test.tsx` (the invite-only page renders `WorksOnSmallScreens`), a 390 px case in `apps/web/e2e/idea-box.spec.ts` with the api in invite-only mode asserting `[data-testid="not-invited"]` and the waitlist button are visible and at least 44 px tall.

### FR-03 (P0) The phone path stops at "Answer three questions about you", and the wall has no exit

- **Evidence.** `CardKeptView.tsx:26` sends a new person to `/onboarding`; `/onboarding`, `/new`, `/new/ideate`, `/new/commit/*` are desktop only (`StudioFrame.tsx:69`, `DesktopOnly.tsx:29-51`). `/home`'s primary button goes to `/new` (`PersonHome.tsx:143`) and its "Continue" to `/new/commit/<id>` (`:229`), both walled. On Today, "Check it and publish" pushes to the Product › Public page tab (`ReadingPane.tsx:350-353`), walled. The wall (`NeedsLargerWindow.tsx:31-39`) offers nothing to do. CLAUDE.md: "never leave a small screen at a dead end… says so kindly with a way to continue later"; THESIS 2.1 lists "profile, the doors" among the 390 px routes and a "kinder note with 'email me the link'".
- **Impact.** A person who arrives on a phone (the likely device for the target user) can make and keep a card and then can do nothing else: no profile, no project, no page. Two of the small-screen routes that do work (`/new/card/<id>`, `/home`) lead only into walls.
- **Fix (in this order).**
  1. *The profile form at 390 px.* Rebuild the first pass of `OnboardingForm` as one column inside `StudioFrame smallScreen` (name, the two choices or their replacement per FR-08, the 18+ box, Continue); keep "Add detail" desktop only or drop it from first run. Add `"/onboarding"` to `SMALL_SCREEN_PREFIXES`.
  2. *A phone-sized start.* Either make `/new/commit/[ideaId]` work from 390 px in its shortest form (name, Take charge; see FR-09) and add a pattern to `SMALL_SCREEN_PATTERNS`, or add a small-screen "Start building it" on `/new/card/<id>` that commits with defaults (`idea.commit` already defaults every field except `ideaId`, `name`, `archetype`, all of which the card has).
  3. *Publish from a phone.* A small-screen publish step: add `/b/<id>/page` (or let the page note's reading pane show the draft with the public `ProjectPage` component and a Publish button calling `page.publish`), listed in `SMALL_SCREEN_PATTERNS`.
  4. *A kind wall.* Give `NeedsLargerWindow` (`packages/dugout`) optional `actions`: "Email me a link to open on a computer" (new `protectedProcedure` `founder.continueLater({ path })` → gateway `POST /v1/notify/email` kind `continue_on_desktop`; needs platform mail), "Back" and, signed in, "Go to Today" / "Go to your home". `DesktopOnly` passes them from the session.
  5. Until 1 to 3 ship: on `/new/card/<id>` and `/home`, detect a small viewport and say what is true ("The next steps need a computer for now. We can email you the link.") instead of linking into the wall.
- **Tests.** Playwright phone project: landing → card → sign in (developer bypass) → keep → profile → start → Today → publish, all at 390 px, asserting `needs-larger-window` never appears; Storybook stories at 390 px for the new variants; `desktop-only.test.tsx`.

### FR-04 (P1, P0 if measurement confirms) Day-one agent work can spend the whole $5 on a runway forecast and "where to incorporate"

- **Evidence.** `commitIdea` creates three groundwork tasks (`commit.ts:332-345`; `archetypes.ts:124-156`) and starts cycle 1 at once (`:436`). Before sign-off the planner is told to plan exactly that groundwork (`activities/brief.ts:31`). Each runs as a live Agent SDK session on route `departmentLead` (Opus; `templates/leads/*.ts:13`). `sessionBudget` caps a session at min(task budget $20, credits left, wage cap $400, model budget) (`session-budget.ts:60-107`), so on a $5 grant each is bounded only by the balance; the credit saver keeps finance and legal work on Opus (`routing.ts:125-128`). Foundations, the second read, the plan and the notes draw from the same $5. No cost per first session has been measured (THESIS 7.1; pre-commit calls are not booked at all, `services/models.ts:8-9`). When the balance reaches zero the exits are a top-up (needs a card, and `stripe_billing` live), "bring your own Anthropic key" or next month (`billing.ts:358`, `payments.ts:47`); paid plans are not on sale.
- **Impact.** A founder with no money can find the team "paused" within the first hour, before they have done anything except publish a page, and is offered exits that need a card or a developer account. The work that used the credits (incorporation options with "dated sources" from a mock web connector, a cash forecast from a budget they do not have) is not what a first-timer asked for.
- **Fix.**
  1. *Measure first.* Add `scripts/first-session-cost.mjs` (or `packages/db/src/first-session-report.ts`, run as `pnpm --filter @foundmill/db report:first-session`): for businesses committed in a range, sum `usage_ledger.cost_micro_minor` by `kind`/route for the first 1 hour, 24 hours and 7 days after `businesses.committed_at`, plus credits left at each mark. Record the numbers in `docs/DECISIONS.md` and set `includedCreditsMinor` from them (THESIS 7.1).
  2. *Do not start groundwork sessions at commit.* In `packages/agents/src/archetypes.ts` move `FINANCE_TASK` and `LEGAL_TASK` out of `firstCycleTasks` into tasks created when they become relevant (Legal when the founder first asks about registering or takes a first payment; Finance on first revenue or a connected account); keep `OPEN_QUESTIONS_TASK` but create it at sign-off (`apps/api/src/services/signoff.ts` `startBuilding`). In `commit.ts` start cycle 1 only when there is a dispatchable task; otherwise let the first cycle start from the founder's first Continue or from the page being published.
  3. *A first-session budget.* Give seed tasks an explicit `budgetMinor` in `CREDITS_CURRENCY` (for example 50 cents) so `taskBudgetMinor` (`session-budget.ts:53-56`) bounds them, and reserve a share of the first grant for founder-facing calls (notes, conversations) in `assertPlatformCredits`.
  4. *An exit that needs no card.* Decide (founder) what a free account does at zero before the month ends: a one-time first-month top-up grant, or the outcome-critical routes (`projectPage`, `inboxComposer` for a decision note) staying available at zero. THESIS 7.2.
- **Tests.** Orchestrator test: a new business with a $5 grant dispatches no lead session before the page is published; `apps/api/src/__tests__/idea-commit.test.ts` for the changed seed; a unit test for the report's arithmetic; an eval that the first cycle's note for a first-timer names no incorporation task.

### FR-05 (P1) The kept card loses its thread after the profile step

- **Evidence.** `/new/card/<id>` → `/onboarding` → on save `router.push("/new")` always (`OnboardingScreen.tsx:186`; acknowledged "Onboarding still continues to /new" in `docs/PROGRESS.md:1744`). The person lands on "Your first business" with Door A, Door B and an example; their card is a small row under "Concepts in progress" with a button labeled "Commit" (`Doors.tsx:254-286`). `docs/IDEA_BOX.md` promises "the profile questions come at the next step" and the landing says "starts building when you say so".
- **Impact.** The one continuous story the hook sets up (your idea → yours → build it) breaks at the fourth screen into a choice the person already made, in vocabulary they have not met (doors, Ideation Studio, concept, commit).
- **Fix.** `apps/web/app/onboarding/page.tsx` reads `?next=` (through `safeNextPath`, allow only `/new/commit/<uuid>` and `/new/card/<uuid>`) and passes it to `OnboardingScreen`; `CardKeptView.tsx:26` links to `/onboarding?next=/new/commit/<ideaId>`; `OnboardingScreen` `onSuccess` pushes `next ?? "/new"`. With no `next` and exactly one idea in the deck, go to that idea's commit screen. Change the toast ("Welcome aboard. Next: ideate a concept or import what already exists.", `:179-183`) to name the idea.
- **Tests.** `apps/web/e2e/idea-box.spec.ts`: after keeping a card and saving the profile the URL is `/new/commit/<id>`; unit test that an off-site or unknown `next` falls back to `/new`.

### FR-06 (P1) The landing page still promises things that are not true, hides the true first outcome, and is not indexed

- **Evidence.** "Agents open real pull requests on your GitHub, send email from your own accounts and reconcile your Stripe and bank data." (`Thesis.tsx:20`): Stripe and bank connectors are mock in production; email is from a Foundmill address and off until set up (THESIS 5.1 flagged this on Nov 11; unchanged). "checks it against real sources" (`IdeaBox.tsx:53`, `CardKeptView.tsx:18`, `CardKeepView.tsx`) while `web` is not live. HowItWorks step 04 and `FIRST_DAY_SENTENCE` (`HowItWorks.tsx:19-21`) show the pre-Nov-11 first day (two sign-offs), not the page. The pill "First company or fifth" and the lede "make the calls only a founder should make" speak to an experienced operator. Root `robots: { index: false, follow: false }` (`layout.tsx:18`) with no override on `/`, no `robots.ts`, no `sitemap.ts`. `docs/DESIGN.md` §9a still describes a desktop-only page with two hero buttons.
- **Impact.** Breaks R9 (honest) at the first contact and wastes the strongest true claim: "you will have a page of your own, live, in your first session". Search engines and AI assistants are told not to index the home page while project pages are indexable.
- **Fix.** Rewrite `Thesis.tsx` pillar 2 to what is live (a public page at a Foundmill address, followers with double opt-in, code on your GitHub if you have one) and move the rest behind "coming"; replace HowItWorks step 04 with the page-first day (reuse `ProjectPage` from `packages/dugout` on the example); change the kept-card and idea-box "real sources" lines until `web` is live; add `export const metadata = { robots: { index: true, follow: true }, alternates: { canonical: "/" } }` to `app/page.tsx` and `app/examples/[id]/page.tsx`, add `app/robots.ts` (allow `/`, `/p/`, `/u/`, `/terms`, `/privacy`; disallow the app) and `app/sitemap.ts` (static pages plus public project and person pages from a new public query `publicPage.sitemap` reading the views `public_project_pages` and `public_person_profiles`, paged and rate-limited). Update `DESIGN.md` §9a. THESIS 2.7.
- **Tests.** `apps/web/app/__tests__` metadata test for `/`; `LandingPage.test.tsx` string assertions; a banned-claims list in `scripts/plain-language.mjs` or a small test that fails on "reconcile your Stripe" while the connector is not in `LIVE_CONNECTORS` docs.

### FR-07 (P1) First-session copy still tells the old story; the page is not the first thing on Today

- **Evidence.** Stale after package 1.3: the first note (`commit.ts:151-156`), the commit toast (`CommitScreen.tsx:126`), `WHAT_HAPPENS_NEXT` (`:238-243`), the Commit lede (`:519-523`), the Needs-you empty text (`empty-why.ts:55-57`) and the landing's first day all say "vision, specification and roadmap… two notes ask you to sign them off" and never mention the page. On Today the page note sits in the fourth or fifth panel, under the foundations banner, the first-week timeline and the goal panel (`TodayScreen.tsx:109-141`; PROGRESS admits "Today's Goal panel stays above Needs you"). The two sign-off notes are still two (PROGRESS 1.3 "Not done").
- **Impact.** The founder is primed four times to expect documents to approve, then has to notice a different note. "The first session ends on the link" is true in the data and not in the telling.
- **Fix.** One shared constant for the first-day promise in `packages/shared/src/first-week.ts` (for example `FIRST_DAY_PROMISE = ["Your page is drafted first: check it and publish it", "Then your plan arrives as two notes to sign off", …]`) used by `welcomeNote`, the toast, `WHAT_HAPPENS_NEXT`, `emptyWhy("today_needs_you")` and the landing. On Today, while `pageReady` or the page note is open and nothing is published, render the page call to action as the first panel (a new `FirstOutcomePanel` in `packages/dugout` with the preview's first lines and "Check it and publish"), above the timeline.
- **Tests.** Unit tests on the shared words; `apps/web/e2e/first-days.spec.ts` and `today.spec.ts` (order of panels on a new business); a Storybook story for the panel.

### FR-08 (P1) "Before you start" still asks an operator's questions

- **Evidence.** Section 1.6. Required: experience from "First-time founder / Exited founder / Operator / Domain expert" and time commitment; on the same screen residence and citizenship; behind "Add detail": five skills 1 to 20 with hints such as "Cash, pricing, forecasts, fundraising.", "Budget you can commit" with placeholder `25000` (`OnboardingScreen.tsx:621-632`), target markets "EU, UK, US, Nordics, DACH", risk appetite. The kept card calls this "three questions" (`CardKeptView.tsx:19`); the screen says "Four quick answers" (`:313`) and shows a rail "N of 5 done". THESIS 2.3 (three plain questions; remove the 25,000 placeholder and operator vocabulary) is not built. The api needs only a name (`founders.ts:14-36`).
- **Impact.** The first form after the hook asks a young first-timer to classify themselves against exited founders and operators and shows a 25,000 budget as the example number. It is also the screen that walls phones (FR-03).
- **Fix.** New first pass in `components/onboarding/`: (1) "What should we call you?" (prefilled); (2) "What are you good at or enjoy?" as tags (store in `founder_profiles.strengths text[]`, new nullable column, migration + the existing own-row RLS policy; cross-tenant test in `packages/db/src/__tests__/rls/`); (3) "What are you here for?" start something of my own / join something / not sure yet (`founder_profiles.looking_for`, same migration); plus the 18+ box. Default `experience = "first_time"` server-side when absent (`founder.profile.update`), keep time, place, budget, skills and risk in Settings › Profile and ask each when an agent first needs it (a Chief of Staff note with a one-tap answer). Update `ideationSystem` and the foundations brief (`packages/agents`) to read `strengths` and to treat a missing budget as "little or none" (the prompt already has "I have no budget yet"). Remove the `25000` placeholder.
- **Tests.** `apps/web/e2e/onboarding.spec.ts` rewritten; `profile-form` unit tests; RLS test for the new columns; ideation eval with a strengths-only profile.

### FR-09 (P1) Commit still shows a first-timer about eight concepts and a company-shaped name check

- **Evidence.** Section 1.9: title "Commit to {name}", button "Take charge", a domain-and-trademark panel that runs by itself, logo and colors, and the "How it runs" line ("Personal · Assisted · B2B SaaS · Asks you above €250 · Autopilot on"). THESIS 2.6 "Name and go" and 2.5 (retire Personal/Live) are open.
- **Impact.** Reading time and vocabulary at the moment of commitment; the €250 spend line and a trademark screen imply money and a company the person does not have.
- **Fix.** A short form by default (name, "Start my project"); move the name checks, logo, colors and "How it runs" behind one "More options" disclosure for everyone (not only while guidance is on: `runsOpen`, `CommitScreen.tsx:505`); rename the title to "Start {name}" and the button to "Start my project" (keep `data-testid="take-charge"`). Make this form the 390 px variant (FR-03). Keep `idea.commit`'s input unchanged.
- **Tests.** `components/new/__tests__/CommitForm.test.tsx`, `apps/web/e2e/commit.spec.ts`, golden path.

### FR-10 (P1) The funnel and the north star cannot be measured

- **Evidence.** Account events are only `profile.published`, `profile.unpublished`, `signup.attributed`, `referral.arrived`, `founder_notice.sent` (`packages/shared/src/constants.ts:532`); `signup.attributed` is written only for a referred sign-up. No event exists for sign-up, admission, profile created, idea-box card drafted or kept, idea drafted, or follower confirmed at the person level. Business events `idea.committed` and `page.published` exist. The catalogue names a `"metrics"` consumer on 77 types and no such consumer exists (`grep` finds `consume(` only in the package itself). The only report, `packages/db/src/retention-report.ts`, prints "Activated (both sign-offs and a first Continue within 24 hours)" (`founder-return.ts:8-9`, `:55-67`) and "Habit". `founder_visit_days` and `founder_presence` are per business, so a person with no project is never seen. `REAL_OUTCOME_EVENT_TYPES` and `realOutcomes()` exist (`packages/shared/src/morning-brief.ts:44-110`) but are used only by the morning brief. THESIS §15: "All of these need events declared in `packages/events`; none exists today."
- **Impact.** Nobody can say what share of visitors make a card, sign in, finish the profile, commit, publish, or get a first outside outcome, or how long each takes; the north star (weekly active projects with a real outcome) has no number. Decisions about the allowance, the form and the phone work are being made blind.
- **Fix.**
  1. Declare account events (each needs the four steps in `packages/events/CLAUDE.md`, including a migration redefining `fm_account_event_types()`): `account.admitted` (`{ how }`, written in `admitOrWait` where it records, and in `admitThroughInvitation`), `profile.created` (in `founder.profile.update`'s create branch, via a new `PERSON_CREATED_STEPS` entry), `idea.kept` (`ideaBox.claim`), `idea.drafted` (`idea.draft`/`idea.write` done; payload `{ source: "set" | "written" | "idea_box", cards }`). Payloads carry no free text.
  2. A funnel report `packages/db/src/funnel-report.ts` (`pnpm --filter @foundmill/db report:funnel -- --from --to`), service role: per day, counts and medians for `idea_drafts.created_at` → `auth.users.created_at` → `account_admissions.created_at` → `founder_profiles.created_at` → first `ideas.created_at` → `businesses.committed_at` → `project_pages.published_at` → first real outcome other than the page (`events` of `REAL_OUTCOME_EVENT_TYPES` with `isSimulatedEvent` false), plus device class if a `client` column is added to `account_admissions` (optional).
  3. A north-star query `packages/db/src/north-star.ts` `weeklyActiveProjectsWithOutcome(db, weekStart)`: businesses (not `is_demo`) with at least one non-simulated event of `REAL_OUTCOME_EVENT_TYPES` in the ISO week, split solo versus two or more memberships; move `REAL_OUTCOME_EVENT_TYPES`/`isSimulatedEvent` to a shared module both the brief and the report import. Decide and record whether a tap-to-post share counts as "a post published" (`share.opened` only records the panel opening).
  4. Redefine `founderActivation` as "page published within 24 hours of commit" (keep the old fields for comparison) and add "minutes from commit to `page.published`".
- **Tests.** `packages/events` catalogue and fixtures; `packages/db` `rls/account-events.test.ts`; report unit tests on a PGlite fixture; `packages/shared/src/founder-return.test.ts`.

### FR-11 (P1) No per-account dollar ceiling, and pre-commit model spend is invisible

- **Evidence.** Ideation, Ask, Compare and logo marks before commit run on the platform key, cost the person nothing and are "not booked" (`services/models.ts:8-9`). The only bounds are request counts: 20 drafts an hour and 60 a day per person (`ideation.ts:41-45`), each draft 7 to 13 Opus calls. My Estimate: up to roughly $25 to $80 a day per account at list prices if someone used the whole allowance. Per-account ceilings are named as a condition for opening sign-up (`docs/IDEA_BOX.md` "Sign-up" row; THESIS 2.2) and are not built.
- **Impact.** Blocks FR-01's real fix (open sign-up) and hides a large part of first-session cost from any measurement.
- **Fix.** New table `account_usage` (`id`, `user_id` → `auth.users`, `route`, `kind`, `model`, `input_tokens`, `output_tokens`, `cost_micro_minor`, `created_at`; RLS on, own-row select policy, service-role insert; test in `packages/db/src/__tests__/rls/`). In `apps/api/src/services/models.ts` book calls that carry `attribution.userId` and no `businessId` there (add `userId` to the attribution the ideation, ask, compare and logo services pass). Add `ACCOUNT_DAILY_SPEND_CEILING_CENTS` and `ACCOUNT_PRECOMMIT_SPEND_CEILING_CENTS` (env, `packages/shared/src/env.ts`) checked in `apiCreditsGate` for calls without a business, refusing with a plain sentence ("That is all the drafting for today. Start building one of your ideas, or come back tomorrow."). Add per-email-domain admission caps to `decideAdmission` (count `account_admissions` joined to `auth.users` by domain, under the same lock).
- **Tests.** `apps/api/src/__tests__/idea-generate.test.ts` and `model-limits.test.ts` (ceiling refusal, refund when no call was made), `signup-allowlist.test.ts` (domain cap), an RLS test for `account_usage`.

### FR-12 (P1) The page's Follow form can tell a visitor to check an inbox that will stay empty

- **Evidence.** `followForm` defaults to on (`routers/page.ts:45`, `project-page.ts:213`) and is served to the public page as is (`pages.ts:375-389`). `followPage` returns the same `{ ok: true }` when the confirmation could not be sent because platform mail is off (`pages.ts:608-622`, comment at `:541-544`); the form then shows "Check your email to confirm." (`ProjectFollowForm.tsx:11`). Without the confirmation `page.followed` never fires.
- **Impact.** On a deployment without live platform mail (the documented state on Nov 11), a founder's first visitor does the one thing the page asks and nothing happens for either of them; the founder's "first follower" never arrives.
- **Fix.** In `publicPageBySlug` return `followForm: followForm && platformMailLive(ctx.env)`; in `pageView` add `followAvailable: boolean` so `PublicPageScreen` shows "Following opens when email is switched on here" beside the switch. Also add a startup check in the api that logs one error when pages can be published while platform mail is off. Then switch platform mail on (DEPLOY §5.7): it is the dependency of the second real outcome.
- **Tests.** `apps/api/src/__tests__/pages.test.ts` (form hidden when mail is off), `apps/web/e2e/public-page.spec.ts`.

### FR-13 (P1) A brand-new address may get a sign-in email without the code, and the link only works in the same browser

- **Evidence.** The login screen and `docs/IDEA_BOX.md` promise "Type the code from the email" for another device. `supabase/config.toml:28-30` defines only the Magic Link template. To my knowledge Supabase sends its **Confirm signup** template, not Magic Link, when `signInWithOtp` creates a new user with "Confirm email" on (which DEPLOY requires); that template is not in the repo, and `DEPLOY.md:270` describes it as carrying `{{ .ConfirmationURL }}` only. The link uses PKCE, so it fails with "Link opened on a different address" when a mail app opens it in its own browser (`sign-in-errors.ts:21-25`, `:63-67`).
- **Impact.** The first-time visitor (exactly the person who needs it) may have no code to type, and on a phone the link often opens in the mail app's browser. They see an error on their first sign-in.
- **Fix.** Add `[auth.email.template.confirmation]` to `supabase/config.toml` pointing at a new `supabase/templates/confirm_signup.html` with the same body as `magic_link.html` (link, `{{ .Token }}`, 15 minutes); extend `scripts/supabase-config.test.mjs` to require both templates to contain `{{ .Token }}`; run `supabase config push` (founder). Verify by signing up with a fresh address. Consider making the code the primary instruction on phones ("Type this code where you asked for it").
- **Tests.** The config test above; `apps/web/e2e/login.spec.ts` already covers the code field.

### FR-14 (P1) The idea box gives one try, and its failure lines point at a closed door

- **Evidence.** One card per browser for 7 days; the landed state has no "try another idea" (`IdeaBox.tsx:233-240`); a returning browser is shown its old card (`:101-110`). A typo, a joke first line or a weak "Surprise me" result is permanent until sign-in. `limit` and `resting` say "Sign in…" (`idea-box.ts:88-89`). No deadline shorter than ten minutes on the model call (`client.ts:86`); no client timeout.
- **Impact.** The hook punishes exploration, which is what a person with no idea needs most, and under load tells people to sign in to a product that will refuse them.
- **Fix.** Allow up to 3 cards per browser per day inside the existing per-address limit: in `planIdeaBoxDraft` return the held card only when the request sets `again: false` (new optional field in `IdeaBoxDraftRequest`), else replace the draft (`repos.ideaDrafts.replace(tokenHash, …)`, keeping the same cookie; count per token in the limit store). Add "Try another idea" to the landed state. Pass `timeoutMs: 30_000` to the idea-box request (`buildIdeaBoxCardRequest` → `streamStructured`) and a 35 s client timer that shows the `failed` line with the field restored. Reword `limit`/`resting` per FR-01.
- **Tests.** `apps/api/src/__tests__/idea-box.test.ts`, `IdeaBox.test.tsx`, `evals/src/idea-box.ts` unchanged.

### FR-15 (P2) "Founder fit" is promised after the profile and never measured

- **Evidence.** The landing and kept card show Founder fit as "–" (`IdeaCard.tsx:68-74`, `CardKeptView.tsx:30`), and the copy says it comes from the profile answers (`CardKeptView.tsx:20`; `docs/IDEA_BOX.md` "measured after the three profile questions"). Nothing re-rates the idea after the profile is saved: the `idea_box: true` marker (`services/idea-box.ts:336`) is read nowhere, and the studio's `ConceptCard` on `/new` and Commit shows the stored `founder_fit` value, which the model wrote with no profile.
- **Fix.** After the profile is created (or on first open of the commit screen) for an idea whose meta has `idea_box: true`, run one `ideation` call that re-scores `founder_fit` (and the stars) with the profile and writes a new idea version (`repos.ideas.addVersion`, action `"rerated"`), then clear the marker; until then have `toConcept` hide `founder_fit` for such ideas. Booked under FR-11.
- **Tests.** api test for the re-rate and its idempotence; component test that the bar is absent before it.

### FR-16 (P2) Voice: the five weakest first-run strings

Target (THESIS §12.6): someone a few years ahead of you, on your side; the person by name; free first; "you can do this".

| # | Today (file:line) | Why it misses | Rewrite |
| --- | --- | --- | --- |
| 1 | "This address is not on the invite list yet. Ask the person who invited you to add it, or sign in with an address that is on it." (`apps/api/src/services/access.ts:46`, under "Invite only for now", `NotInvitedPage.tsx:19`) | Speaks to someone who was invited; a stranger has nobody to ask | "We are letting people in a few at a time, and it is not your turn yet. Join the waitlist and your idea is kept for you. We will tell you the moment you are in." (only once FR-01 makes the last sentence true) |
| 2 | "I'm your Chief of Staff. I run the team so you only read and decide. Some things are always yours: money, signatures, contracts, deleting things." + "The team is hired: 14 agents in 6 departments." + "…you will get two notes asking you to sign off each. Building starts when both are approved." (`packages/agents/src/prompts/club-rules.ts:67`, `apps/api/src/services/commit.ts:151-156`) | Staff to a boss who "only reads and decides"; no name; counts headcount; stale order | "Hi {name}. {Project} is real now, and it is yours. First, {Product lead} is drafting its public page from your own words: a minute or two, then you check it and put it live. After that your plan arrives for you to read. Nothing costs money or goes out in your name unless you say so." |
| 3 | "This needs a larger window" / "Foundmill is built for desktop screens at least 1280 px wide. Widen the window or move to a larger display." (`packages/dugout/src/components/shell/NeedsLargerWindow.tsx:31-33`) | Blames the device; no way on | "This part works on a computer for now" / "Your project is safe. Want the link by email so you can pick it up on a laptop? Today and your notes work right here on your phone." with the two actions |
| 4 | "Foundmill drafts concepts, hires the team and runs the business within your constraints. Four quick answers are enough to start; add detail when you have it." and "Budget you can commit: Your own money for the first year, before any revenue. A number like 25,000 or 25k." (`apps/web/components/onboarding/OnboardingScreen.tsx:313`, `:621-622`) | Product as subject; "constraints"; a 25,000 example for a person with little money | "Three quick things about you, so your team works the way you do. You can change any of it later." and (in Settings, later) "Money you could put in, if any. Zero is a fine answer: most first projects here start with none." |
| 5 | "Write your idea in your own words and use it as written, or describe a problem, a market or nothing at all and the Ideation agent drafts six to twelve concept cards for you to compare." under "Door A", cta "Open the Ideation Studio"; and "Brief for the Ideation agent" / "What should exist that does not yet?" (`apps/web/components/new/Doors.tsx:80-84`, `components/new/ideate/IdeationStudio.tsx:400-407`) | Internal names (door, studio, concept card, brief, agent) at the moment of starting | Door: "Start from an idea, or from nothing" / "Say it in a sentence and keep it exactly as you wrote it, or let your team suggest a few directions that fit you." / "Start". Studio: "What do you want to build?" / "One sentence is enough. No idea yet? Leave it empty and your team suggests a few to choose from." |

Also weak, same pattern: "Commit to {name}" / "Take charge" (`CommitScreen.tsx:514`, `:531`); "Welcome aboard. Next: ideate a concept or import what already exists." (`OnboardingScreen.tsx:179-183`); "For founders · First company or fifth, the team comes with it" (`Hero.tsx:57-58`); "Nothing needs you yet. Your first notes, the specification and the roadmap to sign off…" (`empty-why.ts:57`); experience option "Operator: You have run teams, budgets or a business unit inside someone else's company." (`profile-form.ts:29`); steering chips "B2B instead", "More defensible" (`IdeationStudio.tsx:104-108`). The best existing lines to copy the tone from: `/home` ("Build something that is yours, with a team of agents doing the work beside you.", "Only if you want to: you can do all of it on your own.", `PersonHome.tsx:127`, `:159`) and the kept card ("{name} is yours").
- **Fix mechanics.** These are string changes plus test updates; run `node scripts/banned-terms.mjs`, `us-english.mjs`, `plain-language.mjs`. Where a note needs the person's name, pass `displayName` into `welcomeNote` (`commit.ts:147`; the profile is already loaded at `routers/idea.ts:362`).

### FR-17 (P2) No first email, and nothing for a person without a project

- **Evidence.** Section 1.13: the notifier is per business; nothing is sent at sign-up, after a kept card with no commit, or from the waitlist.
- **Fix.** Two account-level emails through the existing sender (`POST /v1/notify/email`): "Your idea is saved" (one hour after `idea.kept` with no commit; link to `/new/commit/<id>`; this is also the natural "continue on a computer" email for phones, FR-03) and the waitlist admission (FR-01). Needs account-scoped rows in `founder_notifications` (it has `business_id`; make it nullable in a migration with the RLS policy adjusted to own rows, plus the test) and a schedule entry.

### FR-18 (P2) Smaller dead ends

- `/examples/<id>` opened directly (the "Look around an example" link on `OnWaitlistPage`, `apps/web/lib/people.ts:15`) is not in `SMALL_SCREEN_PREFIXES`, so on a phone it shows the wall although `LandingPage` has a phone layout. Add `"/examples/"`.
- "Please contact support." (`sign-in-errors.ts:119`) with no address on `/login`; the only contact addresses in the web app are `privacy@` and `copyright@` (`apps/web/content/legal/facts.ts:22-25`). Add a support address to `packages/config` and print it here and on the invite-only page.
- `/home` on a deployment with LIVE closed shows a second card whose only content is "Opening soon" (`PersonHome.tsx:160`, `:174`): half the first screen is a closed door. Hide the card while `liveMode` is false.
- The example door leads to a business "two years in" (`Doors.tsx:106`); THESIS 5.3 asked for an example in week one. Seed a day-3 solo example (or open the example at its Day one) and make it the default.
- No tour on Today or on the Public page tab; the Home tour explains "Continue" and "the status strip" on a screen the new founder does not land on. Add a three-step Today tour (your page, Needs you, what the team is doing) to `apps/web/components/tours/definitions.ts`.

### FR-19 (P3) Loose ends a planner should know

- `founder.profile.update` accepts `ideaDraftToken` and no step reads it (`person-created.ts:15-16`, `:48-49`): remove it or use it for FR-05.
- The idea-box prompt for a typed line says "a business a team of AI agents can run" and drops "a first-time founder with little money could start this month", which only the interest path has (`ideation.ts:199-200`). Use the same frame for both.
- `docs/DESIGN.md` §9a contradicts the code (desktop only, two hero buttons).
- The Commit screen reads `live.summary` for the 18+ record (`CommitScreen.tsx:106`) while the canonical source is `founder.profile.get.adultConfirmed`.

---

## 4. Roadmap items in this area

Status as of `04a0a509`, checked against the code, not against the status notes.

| Item | Status | Evidence |
| --- | --- | --- |
| THESIS 1.1 Project pages at `/p/<slug>` | **Done** | `app/p/[slug]/page.tsx` (indexable, 390 px), `services/pages.ts`, view `public_project_pages` |
| THESIS 1.2 Agents write the page | **Done**, "under ten minutes on live models" unmeasured | `businessFoundations.ts:92-98`, route `projectPage`; eval `evals/src/project-page.ts` exists and is skipped without a key ("not run", `PROGRESS.md:1550`) |
| THESIS 1.3 First session ends on the link | **Partial** | Done: the page note, Day 1 words, checklist item 1. Open: the first note, commit toast, `WHAT_HAPPENS_NEXT`, Needs-you empty text and the landing still tell the sign-off story (FR-07); the two sign-off notes are still two; the page is not the first panel on Today |
| THESIS 1.4 Real web research | **Open** (configuration) | status line `THESIS_REVIEW.md:395`; copy already claims "real sources" (FR-06) |
| THESIS 1.5 Platform email | **Built**, live state unknown | `platformMailLive`; DEPLOY §5.7 steps; status "off until its DNS and SendGrid setup" |
| THESIS 1.6 Follow form / payment link | Follow form **done** (but see FR-12); payment link **open** | `services/pages.ts` `followPage`; no `create_payment_link` |
| THESIS 1.7 Platform-owned repository | **Open** | no code |
| THESIS 1.8 Outcome evals in CI | **Open** | `.github/workflows/` has `ci.yml`, `e2b-template.yml`, `evals-typed-reads.yml`, `security.yml` only |
| THESIS 2.1 Small screens for the outer product | **Partial** | Done: `/` hero, `/login`, `/home`, card pages, people pages, Today, Needs you, public pages. Open: profile (`/onboarding`), the doors (`/new`), any start or publish step, the kinder note with "email me the link" (FR-02, FR-03) |
| THESIS 2.2 Open the door | **Partial** | Done: 18+ once (`adult_confirmations`, 0100), typed code, Google (behind a flag), open-mode machinery (`SIGNUP_OPEN`, `SIGNUP_DAILY_CEILING`). Open: sign-up is closed; the waitlist records but never admits, has no referral order and no email; Apple sign-in; per-account ceilings; per-domain caps (FR-01, FR-11) |
| THESIS 2.3 The person profile | **Partial** | Done: a public profile `/u/<handle>` (`founder.publicProfile.*`). Open: "Before you start" as three plain questions, the 25,000 placeholder, operator vocabulary (FR-08) |
| THESIS 2.4 Home for a person | **Done**, with one gap | `/home`; "Onboarding still continues to /new" (`PROGRESS.md:1744`, FR-05) |
| THESIS 2.5 Retire "game mode" | **Open** | Commit still has Personal / Live (`naming.ts:242-245`); Live hidden while LIVE is closed |
| THESIS 2.6 Shrink Commit | **Open** (guidance collapses five controls) | FR-09 |
| THESIS 2.7 Landing and metadata | **Partial** | Done: the idea box, a quieter page, a phone hero. Open: the promise per §12.1, untrue claims, examples that start in week one, indexing (FR-06) |
| THESIS 5.1 Email "a decision is waiting" | **Built**; needs platform mail live | `POST /v1/notify/email`, `notify-words.ts` |
| THESIS 7.1 Prices and credits from measured cost | **Open** | no measurement anywhere; pre-commit calls not booked (FR-04, FR-11) |
| THESIS 7.2 Working top-ups and paid plans | **Open** | `PRICE_TBA_LABEL`; `MOCK_PAYMENTS_OFF_MESSAGE` |
| THESIS §15 measures (arrive, first outcome, north star) | **Open** | FR-10 |
| NETWORK wave 1 sign-up attribution | **Done** | `fm_via` cookie (`apps/web/proxy.ts`), `recordSignupAttribution`, account events `signup.attributed`, `referral.arrived` |
| NETWORK F5 waitlist ordered by who brought whom | **Open** | `waitlist_entries` has no order or referral column |
| IDEA_BOX "Not in this PR": the 200-a-day ceiling and opening sign-up; per-account spend ceilings; sharing a card (`ideaShare.publish`) | **Open** | `docs/IDEA_BOX.md` last section |
| UX plan (Oct 20) first-run items (two-pass profile, doors with "Recommended for you", example toggle, Commit collapse, checklist, tours, explainers) | **Done**, and now the baseline the thesis asks to go past | `DECISIONS.md` "Building the UX plan" |

---

## 5. Interfaces a planner must know

### HTTP (api, plain Hono, `apps/api/src/idea-box-routes.ts`)
- `POST /idea-box/draft` body `IdeaBoxDraftRequest` `{ prompt: string (<=500), interest: IdeaBoxInterest | null, turnstile: string, website: string }` → NDJSON of `IdeaBoxEvent`: `{type:"started"}` | `{type:"partial", card: IdeaBoxPartialCard}` | `{type:"rating", index, rating: {key, value, evidence}}` | `{type:"card", card: IdeaBoxCard, prompt, interest, sample, again, claim}` | `{type:"error", code: "invalid"|"bot"|"limit"|"resting"|"unavailable"|"refused"|"failed", message}`. Sets cookie `fm_idea`.
- `GET /idea-box/mine` → the `card` event or 204.
- Types and constants: `packages/shared/src/idea-box.ts` (`IDEA_COOKIE`, `IDEA_CLAIM_PARAM = "claim"`, `IDEA_BOX_INTERESTS`, `IDEA_BOX_ERRORS`, `IdeaToken`).
- Service: `planIdeaBoxDraft(deps: IdeaBoxDeps, input: IdeaBoxDraftInput, signal?) → Promise<IdeaBoxDraftPlan>`, `mineIdeaBox`, `previewIdeaBoxDraft`, `claimIdeaBoxDraft(db, userId, { token?, claim? }) → { ideaId, again } | null`, `startIdeaBoxSweep`, `IDEA_BOX_LIMITS`, `IDEA_BOX_CARD_RESERVE_MICRO` (`apps/api/src/services/idea-box.ts`).

### tRPC (`apps/api/src/routers/`)
- `founder.profile.get` (protected) → `{ userId, profile: FounderProfile | null, complete: boolean, adultConfirmed: boolean, email, memberships, businesses, features: { liveMode: boolean } }`.
- `founder.profile.update` (protected) input `FounderProfileUpdateInput` = `FounderProfilePatch` (`displayName, experience, skills, timeCommitment, budgetMinor, currency, citizenship, residence, targetMarkets, constraints, riskAppetite`, all optional on the wire) + `{ via?: string, ideaDraftToken?: string, confirmAdult?: true }` → the profile + `{ guidanceTurnedOff: boolean }`. Refuses a new profile without the 18+ record: `FORBIDDEN`, `appCode: "adult_unconfirmed"`.
- `founder.adult.get` → `{ confirmed, confirmedAt }`; `founder.adult.confirm({ confirm: true })` (both `signedInProcedure`).
- `founder.businesses.allowance` (the Commit screen's credit pool notice; web type `PoolView` in `components/new/commit/credits-notice.ts`).
- `ideaBox.preview({ token?, claim? })` → `{ card, prompt, interest, sample, source: "browser"|"link"|"waitlist" } | null`; `ideaBox.claim(same)` → `{ ideaId, again } | null`. The link's claim counts only within `CLAIM_FRESH_MS` (30 minutes) of sign-in.
- `waitlist.join({ token? })` → `{ joined: true, cardKept }`; `waitlist.status` → `{ joined, cardKept }` (signed in with a confirmed address; not gated by the list).
- `idea.list({ limit?, cursor? })`, `idea.get({ ideaId })`, `idea.listByIds`, `idea.draft(GenerateInput)` (async generator of `DraftEvent`, `services/ideation.ts:108-123`), `idea.generate(GenerateInput)`, `idea.write({ title (<=60), pitch (<=4000), archetype: Archetype | null })`, `idea.edit`, `idea.compare({ ideaIds: 2..4 })`, `idea.merge`, `idea.fork`, `idea.askDesk`, `idea.ask` / `idea.askStream` (`{ ideaId, question? | quickReplyId? }`), `idea.discard`, `idea.restore`, `idea.domainCheck({ name } | { domains })`, `idea.preview({ archetype })`, `idea.logo.prepare` / `idea.logo.stream`. `GenerateInput = { prompt (<=4000, default ""), archetypeHint?, single (false), importJobId? }`.
- `idea.commit` input `{ ideaId, name (1..120), gameMode ("personal"), archetype (required), businessMode ("assisted"), kit?, logo?, currency?, spendCapMinor (null), confirmAdult?, autopilot (false), overnight?: { timeZone }, anthropomorphicAgents?, agentStyle? }` → `CommitIdeaResult` (`services/commit.ts:70-88`: `business, departmentIds, agentIds, chiefOfStaffId, firstItem, taskIds, cycle, import, engines, autopilot, foundations, alreadyCommitted`).
- `product.foundations.ensure` (any member; claims and starts the drafting), `.get`, `.retry`; `product.signoff.*` (`services/signoff.ts`).
- `page.get` → `PageView` (`slug, url, saved, draft, published, live, publishedAt, unpublishedAt, changed, canEdit, canPublish, isSample, preview, followers, mark`); `page.saveDraft({ draft })`, `page.setSlug({ slug, draft? })`, `page.publish({ content })` → `{ outcome: "published", page } | { outcome: "held", reason: "markup"|"personal_data", message, page }`, `page.unpublish`. `ProjectPageContent = { pitch (1..140), about (1..1500), forWhom (0..300), stage, showFounders, followForm }` (`packages/shared/src/project-page.ts:39-56`).
- `publicPage.bySlug({ slug })`, `publicPage.follow`, `publicPage.visited`.
- `today.get({ businessId })` → `TodayView` (`needsYou, firstWeek: FirstWeekWords | null, pageReady: boolean, postsReady, …`, `services/today.ts:64-90`); `inbox.decide`.
- `business.example.get` / `business.example.open`; `invitation.byToken`, `invitation.accept`.
- Procedure builders (`apps/api/src/trpc.ts`): `publicProcedure`, `signedInProcedure` (confirmed address, not admitted), `protectedProcedure` (runs `admitOrWait`), `businessProcedure`, `writeProcedure`, `sectionRead/Write/Admin(section)`; `modelLimited(name)` (`services/model-limits.ts`, names in `MODEL_LIMITS`).

### Admission (`apps/api/src/services/access.ts`)
- `decideAdmission(f: AdmissionFacts): AdmissionDecision`; `admitOrWait(ctx: AdmissionContext, user: AdmissionUser): Promise<void>`; `isAdmittedNow`; `admitThroughInvitation(ctx, tx, accepter, invitation, now)`; `inviterStanding` → `"trusted" | "open" | "none"`; `assertConfirmedSignIn`.
- Error codes: `not_invited` (details `reason: "not_listed" | "email_unconfirmed"`), `on_waitlist` (`reason: "ceiling"`), `invitation_cannot_admit`, `invitation_admissions_limit`, `adult_unconfirmed`, `credits_exhausted` (402).
- `signupMode(env)`, `allowlisted`, `parseSignupAllowlist`, `ON_WAITLIST_WORDS`, `ON_WAITLIST_EMAIL_PROMISE` (`packages/shared/src/allowlist.ts`).

### Web routing
- `SMALL_SCREEN_PREFIXES`, `SMALL_SCREEN_PATTERNS`, `worksOnSmallScreens(pathname)`, `DesktopOnly`, `WorksOnSmallScreens` (`apps/web/components/providers/DesktopOnly.tsx`); `NeedsLargerWindow`, `isViewportTooSmall`, `useViewportWidth`, `MIN_VIEWPORT_WIDTH` (`packages/dugout`); `BrandFrame({ smallScreen })`, `StudioFrame({ step, steps, smallScreen, width })`.
- `decideRedirect`, `safeNextPath`, `signedInDestination`, `isPublicPath`, `SIGNED_IN_INDEX = "/start"` (`apps/web/lib/auth/redirects.ts`); `startDestination(input: StartInput)` (`lib/auth/start-destination.ts`); `keepHref(claim)` (`IdeaBox.tsx:65`); `NEXT_PARAM`, `LAST_BUSINESS_COOKIE` (`lib/auth/constants`); cookies `fm_idea`, `fm_via`, `fm_post`, `fm_last_business`.
- `loadStudioViewer(): StudioViewerResult` and `StudioViewer` (`components/new/viewer.server.ts`).

### First-week and words
- `firstWeekTimeline(f: FirstWeekFacts): FirstWeekWords | null`, `firstWeekVisible`, `FIRST_WEEK_DAYS = 10` (`packages/shared/src/first-week.ts`); `DEFAULT_FIRST_WEEK_ITEMS`, `FirstWeekItemId` (`packages/dugout/.../FirstWeekChecklist.tsx`); `PAGE_READY_NOTE` (`key: "project_page.ready"`, options `page_check` / `page_later`), `isPageReadyDecision`, `starterPageDraft` (`packages/shared/src/project-page.ts`); `emptyWhy(key, facts)` (`packages/shared/src/empty-why.ts`); `welcomeNote(input)` (`apps/api/src/services/commit.ts:147`); `HOUSE_RULES_FOUNDER_LINE` (`packages/agents/src/prompts/club-rules.ts:67`).

### Models and money
- Routes used in the first run (`packages/models/src/routing.ts`): `ideation`, `ideationSlate`, `logoDesigner`, `projectPage`, `foundationsSkeleton`, `foundations`, `documentReview`, `chiefOfStaff`, `departmentLead`, `inboxComposer`, `conversation`, `goalProposal`. `resolveModel(route, override?, { lowCredits? })`.
- `TIERS`, `includedCreditsMinor(tier)`, `CREDITS_CURRENCY`, `lowCreditsThresholdMinor`, `creditsAreLow`, `tierShowsBuiltOnMark` (`packages/config/src/pricing.ts`); `LIMITS` (`limits.ts`); `FLAGS.liveMode`, `liveModeOpen(env)` (`flags.ts`).
- `assertPlatformCredits`, `bookUsage`, `creditsState`, `includedCreditsFor`, `periodOf` (`packages/db`); `apiCreditsGate` (`apps/api/src/services/models.ts:82`); `sessionBudget`, `taskBudgetMinor`, `boundSpend` (`apps/orchestrator/src/activities/session-budget.ts`); `DEFAULT_TASK_RESERVE_MINOR` (`cycle-contract.ts:66`); `IDEATION_LIMITS`, `SHARED_MODEL_LIMITS`, `MODEL_LIMITS`.

### Events
- Business: `idea.committed` (`{ ideaId, ideaVersionId, businessName, archetype, gameMode, businessMode, departmentIds, agentIds }`), `foundations.progressed`, `inbox.item_created`, `product.signoff_decided`, `page.published` / `page.unpublished` (`PageFacts { pageId, slug, url }`), `page.followed`, `mail.sent` (`simulated` flag), `payment.received`, `lead.replied`, `founder.session_started`, `share.opened`, `guidance.*`, `autopilot.changed`, `cycle.*`.
- Account (`ACCOUNT_EVENT_TYPES`, `packages/shared/src/constants.ts:532`): `profile.published`, `profile.unpublished`, `signup.attributed`, `referral.arrived`, `founder_notice.sent`.
- Real outcomes: `REAL_OUTCOME_EVENT_TYPES = ["page.published", "mail.sent", "page.followed", "payment.received", "lead.replied"]`, `isSimulatedEvent`, `realOutcomes(events, since, now, viaPosts?)` (`packages/shared/src/morning-brief.ts`).
- Retention: `PRESENCE`, `ACTIVATION`, `HABIT`, `founderActivation(f: ActivationFacts)` (`packages/shared/src/founder-return.ts`); `presenceRepo.retentionReport(db, { from, to })`.

### Tables (names as in `packages/db/src/schema/`)
`founder_profiles`, `adult_confirmations` (`user_id` unique, `confirmed_at`), `account_admissions` (`user_id`, `how` in `ADMISSION_KINDS = ["invitation","open","existing"]`, `invitation_id`), `idea_drafts` (`token_hash`, `claim_hash`, `prompt`, `interest`, `card`, `weak_line`, `model_mode`, `cost_micro`, `expires_at`, `held_until`, `claimed_by`, `claimed_at`, `idea_id`), `waitlist_entries` (`user_id`, `email`, `idea_draft_id`, `admitted_at`), `attributions`, `ideas`, `idea_versions`, `idea_comparisons`, `businesses` (`committed_at`, `is_demo`, `plan_tier`, `model_billing`, `spend_cap_minor`), `memberships`, `business_foundations`, `project_pages` (`slug`, `draft`, `published`, `published_at`), views `public_project_pages`, `public_person_profiles`, `inbox_items`, `tasks`, `agent_sessions`, `usage_ledger` (`cost_minor`, `cost_micro_minor`), `credit_balances`, `credit_lots`, `founder_presence`, `founder_visit_days`, `founder_notifications` (has `business_id`), `account_preferences` (`guidance`, `tours_done`, `explainers_seen`, `checklist_dismissed_at`), `events`, `outbox`, `account_events`, `account_outbox`.

### Env and flags
- api: `SIGNUP_ALLOWLIST`, `SIGNUP_OPEN`, `SIGNUP_DAILY_CEILING` (200), `SIGNUP_EXISTING_BEFORE`, `IDEA_COOKIE_DOMAIN`, `IDEA_BOX_DAILY_CEILING_CENTS` (2000), `MODEL_MODE`, `MODEL_FAST_MODE`, `MODEL_LIMIT_SCALE` (development and test only), `LIVE_MODE`, `LIVE_CONNECTORS`, `INTEGRATIONS_MODE`, `ALLOW_MOCK_PAYMENTS`, `PLATFORM_MAIL_DOMAIN`, `TEMPORAL_ADDRESS`, `DEV_AUTH_USER_ID` (development and test).
- gateway: `TURNSTILE_SECRET_KEY`, `SENDGRID_API_KEY`, `PLATFORM_MAIL_*`, `PLATFORM_NOTIFY_*`.
- web: `NEXT_PUBLIC_TURNSTILE_SITE_KEY`, `NEXT_PUBLIC_AUTH_GOOGLE`, `NEXT_PUBLIC_API_URL`, `NEXT_PUBLIC_APP_URL`, `NEXT_PUBLIC_APP_ENV`, `IDEA_COOKIE_DOMAIN` (server actions clear the cookie with it).
- Supabase: `supabase/config.toml` (`otp_length = 6`, `otp_expiry = 900`, one template).

---

## 6. Tests and evals covering this area, and the gaps

**Unit and component**
- Landing: `apps/web/components/landing/__tests__/{LandingPage,cycle-deck-motion,live-sessions,picker}.test.tsx`, `{cycle,examples,journey-story,story-day}.test.ts`; `components/landing/idea-box/__tests__/IdeaBox.test.tsx`; `app/__tests__/landing-deep-link.test.tsx`.
- Sign-in: `app/__tests__/{login-form,sign-in-code}.test.tsx`, `auth-callback.test.ts`; `lib/__tests__/{redirects,canonical-origin,via}.test.ts`; `lib/auth/__tests__/start-destination.test.ts`.
- Gate: `apps/api/src/__tests__/{signup-allowlist,invitations-admission,people-races,adult-signup,adult-before-save,person-created,grant-access}.test.ts`; `components/shell/__tests__/api-error-page.test.tsx`; `packages/db/src/__tests__/rls/adult-confirmations.test.ts`.
- Profile: `components/onboarding/__tests__/{OnboardingForm,OnboardingScreen.adult,OnboardingScreen.via}.test.tsx`, `profile-form.test.ts`; api `founder-profile-guidance.test.ts`.
- Home and doors: `components/person-home/__tests__/PersonHome.test.tsx`; `components/new/__tests__/{doors,StudioFrame}.test.*`.
- Ideation and commit: `components/new/__tests__/{IdeationStudio,DraftRun,AskSheet,CommitForm,ImportFlow}.test.tsx`, `{concepts,draft-run,naming,credits-notice,import-job}.test.ts`; api `idea-{box,generate,write,ask,compare-reason,deck,domain-check,commit}.test.ts`, `model-limits.test.ts`, `typed-spend-commit.test.ts`; `packages/agents/src/__tests__/ideation.test.ts`.
- After commit: api `foundations.test.ts`, `pages.test.ts`, `page-follow.test.ts`, `today.test.ts`, `business-first-week.test.ts`, `founder-presence.test.ts`; orchestrator `foundations.test.ts`, `session-budget.test.ts`; `packages/shared/src/{first-week,empty-why,founder-return,morning-brief}.test.ts`; `packages/agents/src/__tests__/{project-page,foundations,foundations-staged}.test.ts`; dugout `firstrun/*.test.tsx`, `public/IdeaCard.test.tsx`; `components/providers/__tests__/desktop-only.test.tsx`.

**Playwright** (`apps/web/e2e/`, PGlite stack, mock models, developer sign-in): `landing`, `idea-box` (desktop keep flow; 390 px hero), `login` (several widths), `adult-signup`, `onboarding`, `person-home` (390 px), `ideation`, `commit`, `import`, `first-days`, `foundations`, `today`, `phone-today`, `public-page`, `tours`, `example-business`, `invitations`, `return-loop`, `billing`; root `e2e/tests/golden-path.spec.ts` (profile → ideate → compare → commit → Continue → decide).

**Evals** (`evals/src/`, live models, skipped without a key): `idea-box.ts`, `ideation.ts`, `project-page.ts`, `foundations/`, `composer.ts`, `goal-proposal.ts`, `second-read.ts`, `founder-strings.ts`, `injection/`.

**Gaps**
1. No test walks the whole first run in one session at 390 px (card → sign in → keep → profile → start → publish); the two phone specs stop at the hero and at `/home`.
2. No test renders the invite-only page at 390 px or on `/start` (FR-02); `api-error-page.test.tsx` checks which page is picked, not that it shows.
3. No test that the profile save returns a card-holder to their card (FR-05).
4. Nothing asserts the first note, the toast, `WHAT_HAPPENS_NEXT` and the empty text agree with `first-week.ts` (FR-07).
5. No test of the Follow form's behavior with platform mail off (FR-12).
6. No test of a waitlist entry ever being admitted (there is no code to test, FR-01).
7. No end-to-end run on live models: `docs/GATES.md`'s live smoke and THESIS 1.8's nightly outcome evals do not exist in CI; first-card latency (2 s / 10 s target) and "commit to live page in under ten minutes" are unmeasured.
8. No test or report of first-session cost; `session-budget.test.ts` covers the arithmetic, not what a new $5 project actually spends (FR-04).
9. `scripts/supabase-config.test.mjs` pins the redirect list and the one template; nothing checks the Confirm signup template (FR-13).
10. No metadata test for `/` (it would have caught noindex once indexing is wanted, FR-06).

---

## 7. Anything surprising

1. **The best first-run asset is real and nearly unreachable.** Publishing a page is a true outside outcome with no dependency on a vendor or on credits, and the code path from commit to "live" is short and well guarded. But production admits nobody new, and a phone cannot get past the kept card.
2. **The waitlist promises an email that no code can send**, and admission from it is an environment-variable edit.
3. **The phone bug in the invite-only path** is a one-line difference between two sibling pages (`OnWaitlistPage` has `WorksOnSmallScreens`; `NotInvitedPage` does not), and it sits on the exact route the idea box sends every phone visitor to.
4. **Pre-commit model spend is not recorded anywhere.** The largest burst of Opus calls a new person can cause (a 12-card set) leaves no row in any ledger, so "cost per first session" cannot be computed from the database today even in principle.
5. **Day one starts three Opus agent sessions on finance and legal groundwork** for a person who may have no money and no company, each allowed to spend whatever credits remain. The $20 default task reserve is four times the whole free grant.
6. **"Activated" still means two sign-offs and a Continue**, a definition from before the page existed; the north star has a list of qualifying events (`REAL_OUTCOME_EVENT_TYPES`) and no query.
7. **The landing page is noindex** while every project and person page is indexable, and there is no robots or sitemap route although the proxy reserves both paths.
8. **"Founder fit" is shown as unmeasured, promised after the profile, and never re-measured**; the marker written for it (`idea_box: true`) is read by nothing.
9. **`founder.profile.update` already accepts a name-only profile**, and `idea.commit` already defaults everything except the name and kind, so the shortest possible first run (one sentence, an email, a name, an 18+ tick, "Start") needs no api change: it is a web and copy change.
10. **`/home`, the screen built to be the kind landing for a person with no project, shows a half-screen "Opening soon" card in production** (LIVE closed), and both of its working buttons lead a phone into the wall.
11. The Supabase template in the repo is the one existing users get; a first-time address most likely gets a different template that the repo does not manage.
12. `docs/DESIGN.md` §9a and the landing's "How it works" still describe the product as it was before Nov 11; the code moved, the story on the front page did not.
