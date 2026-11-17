---
date: 2026-11-17
branch: claude/wp09-entry-plan-answers
title: The $5 entry plan's credits, models, mark and the test users' switch (founder, Nov 17)
areas: [config, web, api, db, docs]
supersedes: []
---
## What changed
Docs only. This entry records the founder's answers to the four open questions in
docs/log/2026-11/2026-11-17-claude-wp09-paid-entry-plan.md (#273), and updates that entry's inventory. CLAUDE.md's one
plan exception (the "Built on Foundmill" mark) now says what is true today and what changes at opening. Nothing is
built here.

## Decisions
The founder, Nov 17, 2026, on each open question. Everything below applies from the day sign-up opens; until then,
the invite-only free plan and today's rules stand.
1. **Credits in the $5 plan.** "yes exactly, so we still don't plan to make money on that plan but hopefully we
   don't lose money on it either". The $5 a month includes $5.00 of credits, as the free plan does today.
2. **Models.** The $5 plan gets the models the free plan has today: Haiku 5.5 and GLM-5.3 Flash. "They will have to
   buy credits on top of the $5 plan to unlock Claude models (which we should sell in minimum $20 increments, and
   users pay less per credit the more they buy)". Opus and Sonnet on Foundmill's key unlock with a credit pack, not
   with the subscription.
3. **The "Built on Foundmill" mark.** "Yes it stays on the $5 plan, users can remove it when they buy a credit pack".
   Today the free plan shows it and a paid plan removes it (`tierShowsBuiltOnMark`). From opening, the $5 plan
   shows it, and a project whose owner has bought a credit pack does not. It remains the only thing besides agent
   work that differs by plan.
4. **Test users at the switch.** "They become real projects, users will have to convert to the paid $5 monthly plan
   on the day of the switch". Nothing is deleted. A project whose owner has not converted cannot start an AI run until
   they do, and everything before the first run stays usable.

**Credit packs supersede WP-09 D4's top-up sizes ($5, $10, $25, $50) from opening.** The minimum is $20, and the
price per credit falls as the pack gets bigger. Until opening, today's top-up rule stands, and nothing new is offered
before Stripe is live (D5).

**Still my reading, not answered:** Commit's own drafting (the page, the plan, the foundations) stays free. The gate
sits on Continue, an approval's cycle, cycle 1 at commit and the overnight shift.

### What these answers change in #273's inventory
- **The upgrade prompt on grayed models** (WP-13 T7: Opus and Sonnet shown grayed, choosing one asks to upgrade or
  connect a key).
  - Changes at opening: the way to unlock them is "buy a credit pack" (or the founder's own key), not "upgrade the
    plan".
  - Copy that says "until the plan is upgraded" must say a credit pack instead:
    `apps/web/components/agents/logic.ts:428`, `packages/modules/src/team/ModelChangeDialog.tsx:20`,
    `packages/dugout/src/components/agents/mock.ts:727`.
  - The server check on which models each plan may choose (WP-13 T7) reads "has bought a credit pack" as well as the
    tier.
- **The mark's rule** (`packages/config/src/pricing.ts:131` `tierShowsBuiltOnMark`, read by
  `apps/api/src/services/pages.ts` and `milestones.ts`).
  - Changes at opening: the rule takes whether the owner has bought a credit pack, not only the tier.
  - `docs/NETWORK.md` F2's wording follows.
- **Top-up copy** (`apps/web/components/settings/BillingTab.tsx` "Top up" and the amounts, `TOP_UP_OPTIONS_MINOR`).
  - Changes at opening: "credit packs", from $20, each with its price per credit (Estimate until set), and a line
    that a pack unlocks Claude models and removes the mark.
  - Before opening: the amounts stay $5, $10, $25 and $50 (D4), offered only where top-ups can be bought.
- **WP-09 T13's zero-credits wording.**
  - At opening, the ways on are: a credit pack in Settings › Billing, the founder's own Anthropic key, or next
    month's included $5.00.
  - The plan's name and the pack minimum come from config. The copy never says a credit pack is needed for more
    Haiku 5.5 or GLM work: a pack buys more credits on any model, and also unlocks Claude models.
- **WP-09 T16** (the checkout). Before opening it needs two Stripe products:
  - the $5 monthly subscription;
  - one-time credit packs, from $20, at a falling price per credit.

  The ingest webhook grants the period's $5.00 and the pack's credits. "Has bought a pack" is recorded on the
  account, for the models and the mark.
- **Test users' projects** (the switch). On the day sign-up opens:
  - every project of an owner without the $5 subscription keeps all its data and screens;
  - the gate at the first AI run refuses with the way to subscribe;
  - invited users are told before the day (an email and an Inbox note, worded then).

## Not done
- Built nothing. Before opening, see #273's list, plus credit packs, the "has bought a pack" record and the mark rule.
- **Open founder question: pack sizes and prices.** A proposal, all Estimates:
  - $20 for $20.00 of credits (the base rate);
  - $50 for $55.00 (10% more);
  - $100 for $120.00 (20% more).

  Credits last 12 months, as today's top-ups do. The founder sets the sizes and the curve.
