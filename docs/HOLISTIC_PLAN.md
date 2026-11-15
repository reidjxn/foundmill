# Holistic plan for Foundmill (Nov 15, 2026)

What to change, in what order, so that one real first-time founder reaches one real outside outcome in one sitting, free, on any screen, and the numbers show it. The findings behind it are in `docs/HOLISTIC_REVIEW.md`. The working detail is in `docs/holistic-plan/`: one file per work package, written for a cloud session that has no other context.

Written at `04a0a509`. Nothing here has been built. Nothing in production was changed.

## 1. The measures

| Measure | Today (Nov 15) | Target for this plan |
| --- | --- | --- |
| North star: weekly active projects with a real outside outcome | 0 | above 0, then counted nightly |
| Kept idea card to published public page | never happened | under 10 minutes, at most 6 screens and 2 required inputs, at 390 px and 1440 px |
| Share of agent sessions that end blocked | 67% | under 25% (Estimate of what is reachable; WP-05 measures weekly) |
| Approval requests answered | 14 of 127 | no request for something that cannot run; open ones resolved |
| Agents shown on day one; notes sent on day one | 25 to 27; up to 17 | a first-week set; at most 3 |
| Agents hired with skills for their role | 0 | every agent |
| CI answer on a pull request | 63 to 89 minutes | under 15 minutes |
| Cost of a first session | unknown | reported nightly, inside the free allowance |

## 2. The principles every package follows

1. Ordered by distance from a first real outcome. Work that does not move a first-timer toward one waits.
2. Karpathy guidelines on every change: state assumptions, the smallest change that fixes the finding, touch only what the task needs, a check that proves it. A task that grows beyond its finding is a mistake in the plan: say so in the pull request.
3. Tell the truth first. No screen, note or agent says something happened or can happen when it cannot.
4. Recorded decisions stand. Cite `docs/DECISIONS.md`; never re-decide.
5. Solo is complete; people are an offer. US English, plain words, the product vocabulary, the subtext rule.

## 3. The work packages

| Package | Goal | File |
| --- | --- | --- |
| WP-00 Setup and switches | Every switch a real outcome needs is on, recorded and checked by a script | `docs/holistic-plan/WP-00-setup-and-switches.md` |
| WP-01 Fast lane for delivery | A pull request gets a trustworthy answer in under 15 minutes; a push redeploys only what changed; the two log files stop conflicting | `docs/holistic-plan/WP-01-fast-lane.md` |
| WP-02 Truth and measurement | Nothing claims what did not happen; the funnel, the north star and cost are computed nightly | `docs/holistic-plan/WP-02-truth-and-measurement.md` |
| WP-03 The door | A stranger on a phone gets in, or is told honestly when and how; the landing page is true and findable | `docs/holistic-plan/WP-03-the-door.md` |
| WP-04 The first session | Kept card to a live public page in one sitting, with a small team, one plan to approve and a reason to return | `docs/holistic-plan/WP-04-the-first-session.md` |
| WP-05 Agents that finish | A task ends with a readable result, an honest status, and no repeated or lost work | `docs/holistic-plan/WP-05-agents-that-finish.md` |
| WP-06 Skills for every role | Every agent starts with skills that fit its role, loads them on demand, and the founder sees what a skill changed | `docs/holistic-plan/WP-06-skills-for-every-role.md` |
| WP-07 Foundmill Sites | A founder with no GitHub gets a site with a form and a pay button at an address they can share | `docs/holistic-plan/WP-07-foundmill-sites.md` |
| WP-08 Go to market in week one | Positioning every marketing agent reads; a first email, post, conversation and payment | `docs/holistic-plan/WP-08-go-to-market.md` |
| WP-09 Models and money | The cheapest model and effort that holds quality on each route; the free allowance reaches a first outcome | `docs/holistic-plan/WP-09-models-and-money.md` |
| WP-10 The console, re-cut and legible | Week one shows a dozen surfaces, explains each, reads comfortably and passes machine accessibility checks | `docs/holistic-plan/WP-10-console-and-design.md` |
| WP-11 Data, API and security hygiene | Advisor findings, open security items and leftovers closed | `docs/holistic-plan/WP-11-data-api-security.md` |
| WP-12 People side: gaps only | The unowned pieces of the people plan that the door and the loop need | `docs/holistic-plan/WP-12-people-side-gaps.md` |

Boundaries between packages are in `docs/holistic-plan/OUTLINE.md`. Where two package files disagree on who owns a change, the outline wins.

## 4. The order

| Stage | Packages | Why now |
| --- | --- | --- |
| 1 | WP-01, and WP-00 beside it | Every later change ships through CI and deploys. Railway stops reading `railway.toml` on Dec 1, 2026, so the watch patterns go in first. |
| 2 | WP-02, WP-05, WP-03 in parallel | Stop the false claims, see the funnel, make agents finish, open an honest door. |
| 3 | WP-04, WP-06, WP-09 | The first session, the skills behind it, and what it costs. |
| 4 | WP-07, WP-08, WP-10 | A site and a pay button, the first week of market work, and the console re-cut. |
| Any time | WP-11, WP-12 | Independent of the path above. |

Within a package, tasks run in the order written. WP-05's tasks that edit the session activity run one after another, never in parallel.

## 5. How a cloud session runs a package

- **Environment:** "Foundmill build" in claude.ai/code. The laptop runs no builds or tests.
- **Skills:** the cloud session loads only what is in the repository. The thirty skills this plan relies on are in `.claude/skills/` with their sources and licenses in `.claude/skills/THIRD_PARTY_NOTICES.md`. The full plugins can be installed by the environment's setup script; WP-00 step S11 has the lines. Nothing in the plan needs them.
- **Per task:** `plan-change`, then tests first (`test-driven-development`), then the change, then `verify-done`, then `ship-change`. One task, one pull request, the founder merges. `executing-plans` or `subagent-driven-development` runs a package task by task.
- **Copy and pages:** `copywriting`, `copy-editing`, `humanizer`, `onboarding`, `signup`, `cro`, `emails`; for public pages `schema`, `ai-seo` and the five SEO skills; for UI `frontend-design` and `design-taste-frontend`, under `docs/DESIGN.md`.
- **Setup-dependent tasks:** build behind the switch with the mock passing, and stop. The switch itself is a WP-00 step done by a Desktop session with the connectors on the founder's go-ahead.

### Starting prompt for a cloud session

```
You are executing one work package of docs/HOLISTIC_PLAN.md for Foundmill.

Package: docs/holistic-plan/WP-<NN>-<name>.md

Read, in this order: CLAUDE.md; docs/holistic-plan/README.md (the rules for executing a package); docs/holistic-plan/OUTLINE.md (boundaries between packages); the package file in full; the audit sections it cites in docs/holistic-plan/audits/; the CLAUDE.md of each package you will touch.

Follow the karpathy-guidelines skill on every change. Use the executing-plans skill to work through the package's tasks in the order written. For each task: run plan-change, write the failing test the task names, make the smallest change that passes it, run verify-done, then ship-change. One task is one pull request on a branch named claude/wp<NN>-t<n>-<slug>. Never push to main and never merge.

The package was written at commit 04a0a509. Before each task, re-find every cited function or string in the code as it is now. If the code has changed so that a step no longer applies, say what changed and adapt with the smallest change that still meets the task's "Done when". If a task turns out larger than its finding needs, build the smaller change and say so in the pull request.

Do not start a task marked as waiting for a WP-00 step or for the founder until docs/DEPLOY.md records that step as done: build the code path behind its switch with the mock passing, and stop there. Do not change anything in production.

After each merged task, tick it in the package file, add its line to the progress log and any judgment call to the decisions log. When you finish or are blocked, report: tasks done with their pull requests, checks run with results, what the checks do not cover, and what is waiting on the founder.

Start with task T1.
```

## 6. What only the founder can do

The full list with steps is section 3 of `docs/holistic-plan/WP-00-setup-and-switches.md`. In short: one two-minute live test, reading three Railway values aloud, saying who to admit and when to open sign-up, the Stripe account, a domain for sites, the Supabase auth settings, spend limits at Anthropic and E2B, the Vercel plan, and merging pull requests. Everything else is done by a cloud session in code or by a Desktop session through the connectors on a go-ahead.

## 7. The tasks, at a glance

Sizes: S under a day, M one to three days, L up to a week (all Estimates). Each package file has the full list with files, interfaces, tests and checks.

| Package | Tasks | What they are |
| --- | --- | --- |
| WP-01 | 8 | CI split into parallel lanes; an issue when main is red and a nightly lane; tests load a migrated database; watch paths per service; fewer web builds; one small log file per change; skipped and flaky tests counted; the seven stale agent pull requests |
| WP-02 | 13 | Expiring approvals say so; the channel engine stops claiming launches; no approval for a call that cannot run; fabricated results removed and generators guarded; true build-path and first-day strings; Follow form only when mail can send; one vocabulary in the shell; four funnel events; nightly numbers; the cost report; the production record and its check script |
| WP-03 | 10 | Honest gate at any width; a waitlist that admits and emails; exits from the small-screen wall; sign-in email with a code; the landing page rewritten with full copy; robots, sitemap, structured data and a text file for AI readers; idea box limits; the guards sign-up needs; the store-links value; waitlist order by referral |
| WP-04 | 16 | Profile as three questions; Commit as name and go; what commit starts on the free plan; three agents shown; one plan note; publish and share on any screen; one first-day story; a note budget; the founder's own task; Chief of Staff as mentor; lifecycle email; shortcuts off by default; the one-click answer page; a phone start; win-back |
| WP-05 | 19 | Measure why sessions block; refuse mock research on real projects; honest task outcomes; saved reports the next agent and the founder can read; a brief that says what the project is; Planner inputs; outcome evals; code that finishes without a repository; failing tests go back to the author; turn limit as a checkpoint; resumed runs with memory; preflight; lost sessions; outward calls run once; an affordable night; a next step after a founder's no |
| WP-06 | 12 | One resolver for every call; the library as Markdown with a generated catalog; the 64 drafts moved in; the skill index and `read_skill`; one hire implementation; default skills at hire and by backfill; picker data; platform measurement; measured ratings; the small per-agent check; edits without a run; honest copy |
| WP-07 | 12 | Supplier and interaction tools for specialists; site tables; site sessions and releases; the sites service; screening and Publish; a waitlist form; a pay button; `create_payment_link`; Planner for sites; the proof spec; repository choice without Builder view; repository previews |
| WP-08 | 12 | The positioning record; replies kept and answerable; writing to followers; a first post with a recorded outcome; the first ten conversations; price, pay and ask on the page; page metadata and structured data; two page tools for SEO and GEO agents; the Channel Board; consent in policy; unread schedules; nightly evals |
| WP-09 | 16 | A ledger that says what happened; pre-commit calls booked and capped; gateway model calls ask first; Haiku routes on the current id and a true price table; refusals and fallbacks; effort per route; sessions told their limits; a batch client; true training prices; training on the batch path; a first cycle inside the allowance; overnight numbers; the zero-credits exit; allowance as config; the fourth-model decision; Pro checkout (deferred) |
| WP-10 | 13 | Tabs, sidebar and top bar by stage; explainers where a first-timer lands; first-word definitions; type, contrast and focus tokens; the DESIGN.md amendment; machine accessibility checks; the skills picker's look; legible ratings; the ask before the evidence; Settings basics; state fixes; bundle weight and a token scanner |
| WP-11 | 20 | Real Postgres in CI; a failed migration fails the health check; a backup runbook; advisor fixes (search path, per-statement `auth.uid()`, split write policies, foreign-key indexes); the leftover backup schema; a real-projects view; a load test; session-token minting rules; an api-only secret; one JWT verifier; a Data API probe; bounded webhook bodies; account export and closing; the Stripe webhook secret |
| WP-12 | 10 | A standing solo-guard test; catch-up page drafts for existing projects; invited people land in the project; a private arrival line; reports and an operator queue; limits out of process memory; the people-layer decision; the mobile branch merged; the app prompt and link files; the fate of `apps/social` |

## 8. Decisions that are yours

Each package ends with "Decisions for the founder", with a recommendation per item and what it blocks. Nothing is blocked today: every package has tasks that need no answer. The ones that change the most:

1. **What commit starts for a profile with no budget** (WP-04 decision 1, WP-09 D6). Recommended: the page and one plan first; agent work starts on the plan's approval. This narrows your Oct 18 choice.
2. **The starting team** (WP-04 decision 2). Recommended: hire everyone as today and show three until work brings in more.
3. **No code planned for a project without a repository until Foundmill Sites exists** (WP-05 D3). Recommended: yes; twelve of thirteen real projects are in that state.
4. **Foundmill Sites' two go-aheads** (WP-07 D1, D2): what "proven" means, and the separate domain.
5. **Indexing the home page and the rule for AI training crawlers** (WP-03 decisions 1 and 2).
6. **Whether reporting still gates open sign-up** while the people layer is closed (WP-03 decision 4, WP-12 D2).
7. **Does a founder-attested post count toward the north star** (WP-08 D1; WP-02 decision 1 for a republished page).
8. **Spend on measuring skills once on the platform**, about $170 to $250 (Estimate), and that existing agents' ratings change (WP-06 decisions 1 and 2).
9. **Top-up sizes and the pre-commit ceilings** (WP-09 D3, D4), and the model moves route by route (D2).
10. **The seven stale agent pull requests** (WP-01 T8): merge one, retry one, close five.
11. **DESIGN.md §1 replaced for the default view**, and whether the console may scroll sideways below 1280 px (WP-10 decisions 3 and 7).
12. **Permanent steps in WP-11:** dropping the `bak_20261013` schema after a fresh backup, a restore drill, and a load run against production.
13. **Reversals of earlier rulings, each one sentence wide:** one clause in the round's note when a task is parked for a missing tool (Nov 7; WP-05 D1), and one round of "request changes" back to the author (Nov 13; WP-05 D2).

## 9. Findings no package builds

Listed so they are not lost: turbo caching of the test tasks (a10 EH-05), slimmer service images (EH-13), cross-session agent memory (AR-16), the shared system-prompt cache prefix beyond what WP-09 does (AR-17), founder-fit measurement (FR-15), and the "not now" lists at the end of WP-08 (paid, influencer, affiliate, offline, cold outreach at scale) and WP-12 (network waves 2 to 4). A failed migration that still serves (EH-08) is assigned to WP-11.

## 10. The agent skills

`docs/holistic-plan/skills/` holds 64 drafted skills for the product's agents: marketing 29, engineering 10, product 7, operations 5, finance 3, legal 3, sales 3, customers 2, design 2. Each keeps the substance of a skill used in this review, rewritten for an agent that works through Foundmill's records and gateway tools. Every draft passed the product's own skill screen in memory and the US English and vocabulary linters. `coding_discipline`, written in Foundmill's own words around the four Karpathy ideas, is a default for every engineering agent. WP-06 moves them into `packages/agents`, attaches defaults per role, and measures what each one changes.
