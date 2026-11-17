---
date: 2026-11-17
branch: claude/wp09-paid-entry-plan-record
title: Sign-up stays invite-only on a free plan; at opening the entry plan is $5 a month (founder, Nov 17)
areas: [config, web, api, db, agents, docs]
supersedes: []
---
## What changed
Docs only. This entry records a founder decision, lists the copy and behavior that must change when sign-up opens,
and lists what must be built before then. CLAUDE.md gains one paragraph under "What Foundmill is for". No code
changes here.

The founder's words (Nov 17, 2026): "A big decision I have made is that we will not open sign ups publicly with a
free plan. We should keep the free plan today with sign ups restricted so I can onboard test users over the coming
weeks and solicit feedback. I'm happy to pay for their AI usage. Once we open sign ups broadly and actually GTM with
Foundmill, what we today call the free plan will become $5 per month, and users can add credits on top of that of
course to consume more AI. Users should still be able to shape their idea on the landing page, onboard their own
profile and enter the ideation studio and 'take charge' and see what their company looks like in Foundmill, but they
will have to sign up to the $5 plan before they can click continue and do their first AI run. Again, we will only do
this when we open sign up, but make sure to note that this is the plan, and the copy that will have to change".

## Decisions
**Today, until sign-up opens:** sign-up stays invite-only, and invited test users stay on the free plan. The founder
pays for their AI use, on Haiku 5.5 and GLM-5.3 Flash under the $600 monthly cap.

**At opening:** the plan called "free" today becomes a $5-a-month entry plan, and credits can be added on top. These
steps stay free of charge: shaping an idea on the landing page, the profile, the Studio, taking charge, and seeing
the project. The first AI run (Continue) needs the $5 plan.

What this supersedes or narrows, each from the day sign-up opens unless noted:
- **Oct 18, "The first days are about the product"** (what commit starts), and **WP-04 D1** (commit with no budget
  starts no cycle; round 1 starts on the plan's approval, Continue or the first overnight shift). Narrowed: on the
  entry plan, all three of those starts wait for the subscription.
  - Commit's own drafting stays free of charge: the page, the plan and the foundations. That is "see what their
    company looks like". This entry reads the founder's words that way; the founder can correct it.
- **WP-04 D4** (the spend line starts at $0 for a profile with no budget): unchanged. It is about the founder's own
  spending, not the plan.
- **WP-09 D1** ("keep $5.00 a month" of free credits): the $5.00 of included credits stays for invited users. At
  opening, $5 becomes the plan's price. How many credits the $5 plan includes is open (below).
- **WP-09 D4 and D5** (top-ups of $5, $10, $25 and $50; offer nothing new before Stripe is live): the amounts stand.
  Top-ups need the same Stripe setup (S8) as the subscription.
- **WP-09 D8** (Pro's price waits for T14's numbers): unchanged. The entry plan is now priced before Pro.
- **WP-09 T13** (zero-credits wording): its sentences must name the plan by a config value, never the word "free".
  It must also not call a top-up "free-tier work". On the entry plan, the ways on are credits, the founder's own key
  and next month's included credits.
- **WP-09 T16** (Pro checkout, deferred): becomes a **$5 entry-plan subscription** checkout, needed before opening.
  Pro can follow on the same path.
- **Nov 16, "free users run on GLM-5.3 Flash"** and the **$600 monthly cap**: they hold for invited users until
  opening. After opening, which models the $5 plan runs on is open (below). "Foundmill never pays Anthropic on a free
  user's behalf beyond Haiku 5.5" then applies to nobody, because every user has paid.
- **CLAUDE.md "People are free on every plan"**: **not changed**. Cofounders and collaborators cost nothing on every
  plan. Plans differ by agent work only. The "Built on Foundmill" mark rule (`tierShowsBuiltOnMark`) needs a
  decision on whether the $5 plan keeps the mark (below).

### Copy and behavior to change on the day sign-up opens
Line numbers are at main `b9ba1ab6`. "Changes" means the line must change at opening; "stays true" means it remains
correct.

Landing page:
- `apps/web/components/landing/words.ts:191` "Starting is free, the free plan does not expire, and you never enter
  payment details." **Changes.**
- `words.ts:192` "The free plan includes … of agent work a month for one project." **Changes**: name the $5 plan and
  its credits.
- `words.ts:204` FAQ "Does it cost anything? Starting is free and you never enter payment details. …" **Changes.**
- `words.ts:210` "hosts your page at a Foundmill address for free." **Stays true** (CLAUDE.md, Nov 11).
- `words.ts:221` "Shaping your first idea is free and needs no sign-up." **Stays true.**
- `apps/web/components/landing/idea-box/IdeaBox.tsx:58` "free and needs no sign-up". **Stays true.**
- `IdeaBox.tsx:66` "Free to start. Your plan includes … every month. You never enter payment details." **Changes.**
- `apps/web/components/landing/Hero.tsx:27` "Starts with … of included credits · no card". **Changes.**
- `apps/web/components/landing/Control.tsx:158` "No password, no card." **Changes** ("no card" until the first run).
- `apps/web/lib/seo.ts:69` (llms.txt) "free to start … and no card. Paid plans are not open yet." **Changes.**

Sign-in, onboarding and Commit:
- `apps/web/app/login/LoginForm.tsx:189` "No password, no card." **Changes**, or "no card to start".
- `apps/web/components/new/commit/CommitScreen.tsx:241-243` `includedCreditsLine` "Starts with … of included credits
  this month. No card." **Changes.**
- `CommitScreen.tsx:898` the line under the team: it shows that line. **Changes** with it.
- The overnight-shift copy on the Commit screen (`CommitScreen.tsx`, the Autopilot row). **Changes**: no night runs
  before the subscription.
- `apps/web/components/new/commit/credits-notice.ts:25` (the included credits went to another business).
  **Stays true** if the entry plan keeps one pool per founder.
- The profile, the Studio, taking charge and the project's screens: **stay free of charge.**

The Continue press and the first run:
- `apps/api/src/services/cycle.ts:302` `startCycle` (Continue), `apps/api/src/services/approvals.ts`
  `cycleForApprovedTask` and `apps/api/src/services/commit.ts:453` (cycle 1 with a budget). **Change**: at opening,
  each is refused without the subscription, with a way to subscribe.
- The overnight shift that commit turns on (`commit.ts`, `OVERNIGHT_SHIFT`). **Changes**: the first night needs the
  subscription too.
- `packages/config/src/pricing.ts:92` `firstCycleInput` (the free plan's 75-cent first round) and
  `includedCreditsMinor("free")`. **Change** with the plan's config.
- `apps/web/components/inbox/InboxScreen.tsx:47` "Continue is free to run." **Changes.**

Zero credits, top-ups, pricing and plan names in Settings:
- `packages/db/src/billing.ts:352` "The free plan includes … of model use a month". **Changes.** WP-09 T13 rewrites
  this sentence; it must name the plan through config.
- `apps/web/components/settings/BillingTab.tsx:37` the tier label "Free". **Changes** to the entry plan's name and
  price.
- `BillingTab.tsx:280` "Your plan includes … a month, used first …". **Stays true** once the plan name follows config.
- `packages/config/src/pricing.ts:19` `TIERS.free` (`priceMonthly: null`). **Changes**: the entry plan's price.
- `apps/web/components/agents/logic.ts:428` and `packages/dugout/src/components/agents/mock.ts:727` "The free
  plan's model". **Change** if the $5 plan's models change.
- `apps/api/src/routers/agent.ts:21` "GLM-5.3 Flash is the free plan's …". **Changes** with the model rule.

Emails and notices:
- `packages/shared/src/notify-words.ts:309` (agents stopped, credits) and `packages/shared/src/autopilot.ts:285`.
  **Stay true.** They name top-ups, which the entry plan keeps, but WP-09 T13 makes them conditional on top-ups being
  on sale.
- The day-3 and win-back letters (WP-04 T16) must not promise a free plan. **To check when they are written.**

Terms and Privacy:
- `apps/web/content/legal/terms.ts:214` "Foundmill has a free plan. People are free on every plan …". **Changes**
  (the first sentence). The second sentence **stays true.**
- `terms.ts:215` "The free plan includes credits for one project each month. …". **Changes.**
- `apps/web/content/legal/privacy.ts:136` "Z.ai … when your project is on the free plan." **Changes** with the
  model rule.
- A subscription needs billing terms: renewal, cancellation and refunds. **New text before opening.**

Skills and agent prompts:
- `packages/agents/src/templates/chief_of_staff.ts:20` and `packages/agents/src/prompts/inbox-composer.ts:78` say
  "recommend the free option first". **Stay true**: this is about the founder's spending, not Foundmill's plan.
- The skills library (`packages/agents/skills/**`, for example `finance/first_budget.md`) uses "free" for the
  founder's own tools and offers. **Stays true.**

## Not done
What must exist before opening, and does not today (build none of it now):
- **A $5-a-month subscription checkout on Foundmill's own Stripe.** Owner: WP-09 T16, after WP-00 setup S8 (Stripe
  keys on gateway, ingest and api), which the founder had deferred. It needs a subscription `kind` on
  `billing_checkouts`, the ingest webhook granting the period's credits, cancellation, and failed-payment handling.
- **The gate at the first AI run.** Owner: WP-09, with WP-04 for the screens. It covers Continue, an approval's
  cycle, cycle 1 at commit and the overnight shift. It refuses with a sentence and a way to subscribe, and the
  project, profile and Studio stay open.
- **What happens to invited test users' projects at the switch.** Owner: the founder decides, WP-09 builds. The
  options: they keep the free plan (grandfathered), they move to $5 with a grace period, or the founder keeps paying
  for a named list.
- **One config value that flips it.** Owner: WP-09 T14. For example, an entry-plan record in `packages/config`
  (`ENTRY_PLAN = { opensSignUp: false, priceMonthlyMinor: 500, includedCreditsMinor: … }`) that copy, the gate and
  billing all read. Opening sign-up and setting it to true are the same step. Invite-only sign-up (the admission
  cutover) is a separate switch today, and the two should flip together.
- Open questions for the founder: how many credits the $5 plan includes, which models it runs on, whether it keeps
  the "Built on Foundmill" mark, and how test users move over.
