# Prompt for the cloud session that executes the plan

Paste everything inside the block into a cloud session on the "Foundmill build" environment, model Opus 5.5.

```
You are executing Foundmill's holistic plan end to end, in the repository reidjxn/foundmill. The plan was written on Nov 15, 2026 against commit 04a0a509. Nothing in it has been built yet. Your job is to build it, one small pull request at a time, in the order below.

## Why this work exists

Foundmill is for a young first-time founder with little money who wants something that is theirs. Measured on the live product on Nov 15: 13 real projects, none new in three weeks, zero public pages, 67% of agent sessions ending blocked, 14 of 127 approval requests answered, zero real outside outcomes. The product gives a first-timer a 25-agent company on day one and no way to reach the outside world. The plan reverses that: one real person reaches one real outside outcome in one sitting, free, on any screen, and the numbers show it. When you have to choose between two ways of doing a task, choose the one that gets a first-timer to a real outcome sooner.

## Step 0: make sure you have the materials

The plan and the skills must be in the checkout before you start. Check for all of these:

- docs/HOLISTIC_REVIEW.md and docs/HOLISTIC_PLAN.md
- docs/holistic-plan/README.md, OUTLINE.md, WP-00 to WP-12, audits/ and skills/
- .claude/skills/karpathy-guidelines/SKILL.md and .claude/skills/THIRD_PARTY_NOTICES.md

If they are in the checkout (the branch claude/holistic-review-plan was pushed or merged), carry on. If they were uploaded to this session instead, put each file at the path above, unchanged, and make that your first pull request, titled "Docs: holistic review, plan and session skills", together with the FOUNDMILL.md change it describes (the outside-skills rule replaced, the Karpathy guidelines added). If any of them is missing and was not uploaded, stop and say which, because every later step cites them.

## Step 1: read before you build

Read in this order, in full:

1. FOUNDMILL.md. It wins over everything else here, including this prompt, except where the founder says otherwise in this session.
2. .claude/skills/karpathy-guidelines/SKILL.md. It governs every change you make.
3. docs/HOLISTIC_PLAN.md, then docs/holistic-plan/README.md and docs/holistic-plan/OUTLINE.md. The outline settles which package owns a change when two files disagree.
4. docs/HOLISTIC_REVIEW.md for the reasons.
5. docs/ARCHITECTURE.md, docs/DESIGN.md, and the CLAUDE.md of each package as you come to touch it.

Read a work package file in full when you start that package, along with the audit sections it cites in docs/holistic-plan/audits/. Do not read all thirteen up front.

## The skills you have and when to use them

They are in .claude/skills/ and load by plain name.

- Every change: karpathy-guidelines. State your assumptions, make the smallest change that fixes the finding, touch only what the task needs, define the check that proves it and loop until it passes.
- Every task: plan-change before code (it finds overlap with other branches and gives the next free migration number), test-driven-development, verify-done before you call a task finished, ship-change to open the pull request.
- Running a package: executing-plans. Use subagent-driven-development and dispatching-parallel-agents only for tasks the package marks as independent.
- When something fails: systematic-debugging. When a review comes back: receiving-code-review.
- Repo skills for their cases: new-event, new-connector, new-screen, new-agent-template, rls-test, gate.
- Copy and pages: copywriting, copy-editing, humanizer, onboarding, signup, cro, emails, launch, pricing, product-marketing. Public pages: schema, ai-seo, seo-technical, seo-schema, seo-geo, seo-agentic, seo-page. UI: frontend-design and design-taste-frontend, always under docs/DESIGN.md.

Where a copied skill disagrees with FOUNDMILL.md, docs/DESIGN.md or docs/DECISIONS.md, the repo's documents win. In particular, no skill's merge step applies here: you never merge.

## The order

Work through the stages in order. Inside a package, do tasks in the order written.

Stage 1, faster delivery and the production switches:
- WP-01 Fast lane for delivery. Do T4 (per-service watch paths) early: Railway stops reading railway.toml on Dec 1, 2026.
- WP-00 Setup and switches, the parts marked for a cloud session only: scripts, checks and documentation. You have no access to production. For every step marked Desktop or Founder, do not attempt it; list it in your report with the exact value or action needed, so the founder or a Desktop session can do it.

Stage 2, honest claims and measurement, agents that finish, an open door:
- WP-02 Truth and measurement
- WP-05 Agents that finish. Its tasks that edit apps/orchestrator/src/activities/session.ts run strictly one after another, in the chain order the package gives.
- WP-03 The door

Stage 3, the first session, skills and cost:
- WP-04 The first session
- WP-06 Skills for every role. It moves the 64 drafts in docs/holistic-plan/skills/ into packages/agents.
- WP-09 Models and money

Stage 4, sites, go-to-market and the console:
- WP-07 Foundmill Sites. Only T1, T11 and T12 may start without the two founder go-aheads the package names. Check docs/DECISIONS.md and docs/DEPLOY.md for them first.
- WP-08 Go to market in week one
- WP-10 The console, re-cut and legible

WP-11 (data, API and security hygiene) and WP-12 (people side gaps) are independent. Do WP-11 T1 and T2 during stage 1, since real Postgres in CI and a failing health check on a failed migration protect everything after. Fit the rest in whenever the current stage is waiting on a merge or a decision.

## How each task goes

1. Re-find every function, string and file the task cites in the code as it is now. The plan's line numbers are from 04a0a509 and will have drifted. If the code changed so a step no longer applies, say what changed and make the smallest change that still meets the task's "Done when".
2. Run plan-change. State your assumptions in a few lines.
3. Write the failing test the task names, see it fail, then make it pass. New agent behavior gets an eval. A new business-scoped table gets business_id, an RLS policy and a cross-tenant test in the same change. A new event is declared in packages/events and written through the outbox. A new gateway tool has real and mock implementations.
4. Run verify-done: typecheck, lint, unit tests, Playwright for any screen touched, a Storybook story for any new component, and the three copy linters (node scripts/us-english.mjs, banned-terms.mjs, plain-language.mjs).
5. Run ship-change. One task is one pull request on a branch named claude/wp<NN>-t<n>-<short-name>. Commits are authored as 40631036+reidjxn@users.noreply.github.com, or Vercel blocks the deployment. Never push to main and never merge: the founder merges.
6. In the same pull request, tick the task in its package file and record progress and any judgment call the way the repo does at that moment (docs/PROGRESS.md and docs/DECISIONS.md until WP-01 T6 lands, the per-change files after).

If a task turns out larger than its finding needs, build the smaller change and say so in the pull request. If a task looks wrong against the code, trust the code, say what you found, and do not build the wrong thing to match the plan.

## Working without waiting

The founder merges on their own schedule, so do not stop at the first open pull request.

- A task that does not depend on an unmerged one branches from main.
- A task that needs an unmerged earlier task branches from that task's branch. Say so in the first line of the pull request ("Stacked on #<n>") and keep the stack shallow: at most three deep, then move to independent work.
- When a merge lands, rebase what was stacked on it. Renumber migrations on rebase: take the next free number, never reserve one.
- Respect other sessions' branches. claude/blissful-fermat-q03yq1 touches .github/workflows/ci.yml and the design system's shell and public components: rebase WP-01 and WP-10 work on it or wait for it. claude/zealous-rubin-8q52gr owns docs/mobile.

## What you must not do

- Change anything in production, or read, print or commit a secret.
- Start a task marked as waiting for a WP-00 step, a go-ahead or a founder decision. Build the code path behind its switch with the mock passing, and stop there. Each package's "Decisions for the founder" section says what each decision blocks and gives a recommended default; where the package says the default may be built, build the default and flag it.
- Re-decide anything recorded in docs/DECISIONS.md. Find entries with node scripts/decisions-index.mjs <words> and cite them by date and title.
- Break the product rules in FOUNDMILL.md: solo is complete, people are an offer, the subtext rule, the product vocabulary, US English and US dates, no vendor call outside apps/gateway, no simulated result reported as done, every non-real number labeled Forecast or Estimate.

## Keeping track across a long session

Keep docs/holistic-plan/STATUS.md current and commit it with each pull request. One row per task: package, task, state (not started, in progress, pull request open with its number, merged, waiting), and what it waits on. Update it before you start a task and when you open its pull request. After any context summary, read STATUS.md and the current package file before continuing, so no task is repeated or skipped.

## Reporting

At the end of each stage, and whenever you run out of work that is not waiting on someone, report in plain prose:

- pull requests opened, by package and task, with their numbers and what each one changes for a founder
- checks run and their results, and what the checks do not cover
- what is waiting on the founder: merges, decisions (with the package's recommendation), and production steps from WP-00 with the exact action
- anything in the plan you found to be wrong against the code, and what you did instead
- the numbers, once WP-02's nightly script exists: funnel, north star, share of sessions ending blocked, cost of a first session

Then carry on with the next stage unless everything left is waiting.

Begin with step 0, then step 1, then WP-01 T1.
```
