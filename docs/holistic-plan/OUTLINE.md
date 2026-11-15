# Master outline for the work packages (planner's decisions; Nov 15, 2026)

Read with: docs/holistic-plan/README.md (the shape of a work package file and the rules for executing sessions).

## The diagnosis the plan answers

Measured on the live product on Nov 15 (reports/e0-production-evidence.md): 19 accounts, 1 new in 14 days; 13 real projects, none created since Oct 25; 11 of them ran 1 to 3 rounds of work on day one and were never opened again; 0 public pages; 319 real agent sessions of which 67% ended blocked; 127 approval requests, 14 answered (79 of them `launch_campaign`); every project was given 25 to 27 agents and up to 17 notes on day one; nobody added a library skill; 1 real training run ($12.78) against a $5.00 monthly free allowance; sign-up closed to a list; the landing page is `noindex` and promises things the product cannot do for a new free user.

The code audits explain it:
1. The door is shut and the phone path dead-ends (FR-01, FR-02, FR-03, A2-01).
2. The first session asks a lot, creates a 26-agent company, and ends without anything outside the product (FR-04..FR-09, A4-16).
3. Agents cannot finish: code has nowhere to land without GitHub (A4-01, A4-02, A4-03), research is simulated (AR-01), work that is not code leaves no result (AR-02) and is booked done regardless (AR-03), there is no agent path to a payment link, an email or a post (AR-04).
4. Skills and training are decoration: no agent is hired with a skill (TS-04), the library is 20 short checklists that miss week one (TS-05), skills never reach the calls that make the page, the post or the plan (TS-01), ratings are constants (TS-02), one training run costs more than a month of free credits (TS-03).
5. Money: nothing is measured (AR-14), two thirds of spend is on sessions that end blocked (A7-01), pre-commit model calls are unbooked (A7-02), the cheapest model route is ten times dearer than it needs to be (A7-04).
6. Delivery is slow: CI takes an hour, every push redeploys six services and restarts agent sessions, the two log files conflict on most merges.

## Principles (apply to every work package)

- One real first-timer reaches one real outside outcome in one sitting, free, on a phone or a laptop, and we can see it in the numbers. Everything is ordered by its distance from that.
- Karpathy guidelines: the smallest change that fixes the finding; nothing speculative; touch only what the task needs; a check that proves it.
- Tell the truth first: a screen, note or agent never says something happened or can happen when it cannot.
- Do not re-decide recorded decisions (docs/DECISIONS.md). Cite them.
- Solo is complete; people are an offer. US English; plain words; no sports terms; the subtext rule.

## Work packages

| WP | Name | Goal | Audits it draws on | Depends on |
| --- | --- | --- | --- | --- |
| WP-00 | Setup and switches | Every switch a real outcome needs is on, recorded, and checked by a script | a11 §5, e0 | none; runs beside everything |
| WP-01 | Fast lane for delivery | A pull request gets a trustworthy answer in under 15 minutes; a push redeploys only what changed; the two log files stop conflicting | a10 | none; do first |
| WP-02 | Truth and measurement | No screen, note or agent claims what did not or cannot happen; the funnel and the north star are computed nightly; cost per first session is known | a1 (FR-06, FR-07, FR-10, FR-11, FR-12), a3a (AR-03, AR-13, AR-14), a4 (A4-03, A4-06, A4-10), a5, a7 (A7-02, A7-03), a2 (A2-09, A2-11) | none |
| WP-03 | The door | A stranger on a phone can get in, or is told honestly when and how; the landing page is true and findable | a1 (FR-01, FR-02, FR-03, FR-13, FR-14), a2 (A2-01, A2-02), a9, s2, s3, s1 | WP-00 (mail), WP-02 (funnel events) |
| WP-04 | The first session | From kept idea card to a live public page in one sitting on any screen, with a small team, one plan to approve, and a reason to come back tomorrow | a1 (FR-04, FR-05, FR-08, FR-09), a2 (A2-03..A2-06, A2-10, A2-12), a3b (TS-06, TS-13, TS-14), a4 (A4-16), s2, s1 | WP-02 |
| WP-05 | Agents that finish | A task ends with a result a person can read, an honest status, and no repeated or lost work | a3a (AR-01, AR-02, AR-05..AR-13, AR-15), a4 (A4-01 short-term fix, A4-05, A4-06, A4-12, A4-13), a7 (A7-01) | none; AR-01 needs WP-00 |
| WP-06 | Skills for every role | Every agent starts with skills that fit its role, loads them when a task calls for them, and the founder can see what a skill changed | a3b (TS-01..TS-05, TS-07..TS-12, TS-15), a3a (AR-10), docs/holistic-plan/skills/** | WP-05 task "platform tools" pattern |
| WP-07 | Foundmill Sites | A founder with no GitHub gets a site with a form and a pay button at an address they can send to people | a4 (§8, A4-02, A4-03, A4-04, A4-07, A4-14, A4-17, A4-18) | WP-05 (A4-01 fix, planner destination) |
| WP-08 | Go to market in week one | Positioning every marketing agent reads, a first email to followers, a first post, a first conversation, a first payment | a5, s2, s3, a3a (AR-04) | WP-00 (mail, Stripe), WP-06 (skills), WP-07 (pay button) |
| WP-09 | Models and money | Each route runs on the cheapest model and effort that holds quality; the free allowance reaches a first outcome and a first week; a founder at zero credits has an exit | a7 (all), a3b (TS-03), a3a (AR-06, AR-14) | WP-02 (cost report) |
| WP-10 | The console, re-cut and legible | Week one shows a dozen surfaces, explains each, reads comfortably, and passes machine accessibility checks | a2 (A2-04..A2-27), s1, a3b (TS-02 display side, TS-09, §3.2) | WP-04 |
| WP-11 | Data, API and security hygiene | The advisor findings, the open security items and the leftovers are closed | a8, a7 (N2, N3, N4 items), e0 | none |
| WP-12 | People side: gaps only | The unowned pieces of the people plan that the door and the loop need | a9, a11 §2 | coordinate with the network session |

Order: WP-01 and WP-00 at once. Then WP-02, WP-05, WP-03 in parallel. Then WP-04, WP-06, WP-09. Then WP-07, WP-08, WP-10. WP-11 and WP-12 fit anywhere.

## Boundaries between packages (so two writers do not plan the same change)

- Landing page copy and structure, robots, sitemap, sign-up gate, waitlist, the invite-only page, the small-screen wall's exits, sign-in email template: WP-03. Truthfulness of individual claims on the landing page is fixed inside WP-03's rewrite; WP-02 only removes false claims elsewhere in the product.
- Funnel events, north-star query, cost report, per-account dollar ceiling before commit, booking of pre-commit model calls and gateway reader and web search: WP-02 (events and reports) and WP-09 (ceilings and booking). WP-02 owns `packages/events` additions for the funnel; WP-09 owns `usage_ledger` changes.
- Profile form, doors, idea card thread, Commit, what commit starts, the starting team size, the plan sign-off, first notes, first-week checklist, Today's first-run guidance, founder tasks, the Chief of Staff's mentor voice and founder context in prompts, re-engagement email content: WP-04. The platform email sender itself already exists; its setup is WP-00.
- Session runtime, reports, briefs, retries, reconcilers, planner inputs, acceptance verdicts, second read hand-back, outcome evals: WP-05. The `read_skill` tool and skill index are WP-06, built after WP-05's first platform tools so the pattern is shared.
- `site_*` tables, `apps/sites`, forms, pay button, download, starters, specialists' document and CRM tools: WP-07. The payment link tool lives in WP-07; WP-08 uses it.
- Channel Board honesty, the `launch_campaign` approval loop, positioning notes as a record, follower email flow, post flow, founder outreach tasks, public page SEO (metadata, structured data, sitemap entries for project pages, per-project AI text file): WP-08. Site-level robots and sitemap: WP-03.
- Model ids, pricing table, effort, fallbacks, caching, batches, session token diet, allowances, top-ups, plan checkout, training price: WP-09. Training's scoped runs and measured ratings are designed in WP-06 and priced in WP-09: WP-06 owns the migration and workflow change, WP-09 owns the batch route and the affordability check.
- Sidebar by stage, Builder view defaults, guided layer, type and contrast tokens, DESIGN.md amendment, keyboard safety, accessibility automation, the skills picker's visual design, ratings legibility in the UI: WP-10. WP-06 owns the skills picker's data and behavior; WP-10 owns its look.
- Migrations: 0108 is the next free number at 04a0a509. Never reserve ranges: take the next free number when the branch is cut and renumber on rebase (the repo's rule).

## In-flight work to respect

- `claude/blissful-fermat-q03yq1` (1 commit, no PR): follower privacy notice and axe accessibility checks in CI; touches `.github/workflows/ci.yml`, `packages/dugout/src/components/shell/{AppShell,KitBar,Panel,PhoneBar}.tsx`, `packages/dugout/src/components/public/*`, `ProjectFollowForm`. WP-01 (CI) and WP-10 (accessibility checks, shell) rebase on it or wait for it.
- `claude/zealous-rubin-8q52gr` (mobile session, 11 commits): owns `docs/mobile`.
- Seven agent pull requests open since Oct 27 to Nov 6 (#24, #30, #38, #39, #45, #49, #52): WP-01 proposes what to do with each; the founder decides.
- This plan's own branch `claude/holistic-review-plan`: docs/HOLISTIC_REVIEW.md, docs/HOLISTIC_PLAN.md, docs/holistic-plan/**, 30 skills copied into `.claude/skills/`, CLAUDE.md (the outside-skills rule replaced; Karpathy guidelines added).
