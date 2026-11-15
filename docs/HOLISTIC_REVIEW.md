# Holistic review of Foundmill (Nov 15, 2026)

What the product does today for the person it is built for, measured on the live product and read from the code at `04a0a509`. The plan that answers it is `docs/HOLISTIC_PLAN.md`. The evidence is in `docs/holistic-plan/audits/` (eleven code audits, four reviews made with the copied skills, one set of production facts); finding ids below (`FR-02`, `AR-01`, …) point into those files.

The person: a young first-time founder with little money, likely on a phone first, who wants something that is theirs. The measure: weekly active projects with at least one real outside outcome.

## 1. The short answer

The parts are well made and well tested. The path through them does not yet reach the outside world. Nobody on the live product has had a real outside outcome, and the reasons are specific and fixable:

| What we measured (production, Nov 15) | Number |
| --- | --- |
| Accounts; new in the last 14 days | 19; 1 |
| Real projects; created since Oct 25 | 13; 0 |
| Projects opened again after day one | 2 of 13 |
| Public project pages published | 0 |
| Real agent sessions; share that ended blocked | 319; 67% |
| Approval requests; answered | 127; 14 |
| Agents created for each project on day one | 25 to 27 |
| Notes sent to a founder on day one | up to 17 |
| Library skills ever added to an agent | 0 |
| North star (projects with a real outcome this week) | 0 |

## 2. What it is like for the founder, step by step

**Arriving.** The landing page cannot be found by a search engine (`noindex`, no robots or sitemap file) and sign-up is closed to a list without saying so. On a phone the idea box works, and the kept card then leads to a wall that says to come back on a wide screen (FR-01, FR-02, FR-03, A2-01). Several claims on the page are not true for a new free project today (FR-06, s2).

**The first session.** The idea box is the best moment in the product: one line in, a named business card out. After it the founder fills a profile, picks a door, commits, and receives a company of 25 to 27 agents, six departments, a specification of 10 to 15 sections and up to 17 notes. The one thing a stranger could open, the public page, is drafted quietly and nothing asks the founder to publish it (FR-04 to FR-09, GTM-07, A4-16). The session ends inside the product.

**Building a product.** Defining the product works: page, vision, specification and roadmap are drafted by live models and signed off by the founder. Building it works only for a founder who already has a GitHub repository with commits and a CI workflow. For everyone else a code task writes files nobody can see, can never be marked done, and blocks what depends on it (A4-01, A4-02, A4-03).

**Agents doing the work.** Two thirds of sessions end blocked. Research is simulated in production (AR-01). Work that is not code leaves no readable result (AR-02) and is booked as done anyway (AR-03). There is no agent path to a payment link, a sent email or a published post (AR-04). The same work is retried and paid for again (A7-01).

**Going to market.** The channel engine drafts creative, asks for approval to "launch", and marks a campaign live without calling anything outside (GTM-02, GTM-09). That one approval type is 79 of the 127 requests. The 19 leads recorded on real projects were written by a demo generator (GTM-10). Project email is built end to end and its DNS is now set; a founder still has no way to write to followers (GTM-01), read a reply (GTM-04) or take a payment (GTM-05).

**Departments, agents and skills.** Templates, screening and storage are solid. No agent is hired with a skill (TS-04). The library is 20 short checklists with nothing for a first email, post, conversation or launch (TS-05). An added skill reaches agent sessions, the desk conversation and training, and none of the calls that make the page, the post or the plan (TS-01). Ratings out of 20 are a constant per family (TS-02). One training run costs more than a month of free credits (TS-03).

**The console.** Twelve sidebar items and about sixty tabs meet a person on day one, written in small low-contrast type, with single-key shortcuts on (A2-03, A2-04, A2-08, s1). The guided layer exists and is missing where a first-timer lands (A2-05, A2-06).

**Money.** Nothing reports cost per first session (AR-14). Calls before commit are not booked (A7-02). The cheapest route uses an old model id at ten times the current price of its replacement (A7-04). A free founder at zero credits has one exit, pasting an API key (A7-05).

**Finding people.** The people side is designed and partly built, and is correctly optional. Two gaps touch the door: an invited person does not land in the project they were invited to, and the 13 existing projects have no page to share (a9).

## 3. The platform underneath

- **Delivery is the slowest part.** CI's main job runs 63 to 89 minutes against a 90 minute limit; every push redeploys all six services and restarts agent sessions; `docs/PROGRESS.md` and `docs/DECISIONS.md` conflict on most merges and were wiped on main for seven hours on Nov 15 without CI noticing; no agent pull request has ever merged; nothing alerts anyone (a10).
- **Production is half switched on.** Health reports environment "staging", integrations in mock mode with models live; the ingest service accepts no vendor webhook through its connector mounts (platform mail has its own route, unconfirmed on SendGrid's side); Stripe is not connected; sign-up is closed. `docs/holistic-plan/WP-00-setup-and-switches.md` has the table.
- **Data and security.** Row-level security is thorough and tested against an in-memory database only; the suites that need real Postgres and Redis never run in CI (A8-01). The database advisors list fixable items and a leftover backup schema (a8).
- **Architecture.** The package boundaries hold: vendors only through the gateway, events through the outbox, model ids in one file. The plan changes no boundary. It adds one small service (Foundmill Sites) behind two founder go-aheads.

## 4. What is good and should not be touched

The idea box and the card. The Needs you queue and the one-click answer by email. The honesty rule for simulated results (it needs enforcing, not rewriting). Templates and skill screening. The tenant isolation model. The design system's components. The solo-is-complete stance throughout the copy.

## 5. The diagnosis in one paragraph

Foundmill built the company before the first customer. It gives a first-timer a full organization on day one and no way out of the building. The plan reverses the order: one real person reaches one real outside outcome in one sitting, free, on any screen, with a small team that has the skills for that week, and the numbers show it. Everything else waits behind that.

## 6. How the review was done

Read-only throughout: no build, test or install ran on the laptop, and nothing in production was changed. Production facts came through the Vercel, Railway and Supabase connectors. Code audits read `main` at `04a0a509`. The copied skills were used as follows: `karpathy-guidelines` set the plan's rule (smallest change, nothing speculative, a check per step); `writing-plans`, `dispatching-parallel-agents` shaped the work packages; `copywriting`, `copy-editing`, `humanizer`, `onboarding`, `signup`, `cro`, `emails`, `launch`, `pricing`, `product-marketing` produced the door and first-session reviews and copy; `ai-seo`, `schema` and the five SEO skills produced the search and AI-visibility review; `frontend-design`, `design-taste-frontend` and the design plugins produced the design critique; `last30days` (method followed by hand) produced the market scan. The marketing, SEO, social, engineering and design skills were also the source for the agent skills drafted in `docs/holistic-plan/skills/`.

Not verified: runner size and which CI checks are required; the Vercel plan; live latency and cost per first session (no measurement exists yet; WP-02 adds it).
