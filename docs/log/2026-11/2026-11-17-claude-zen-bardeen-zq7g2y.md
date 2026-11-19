---
date: 2026-11-17
branch: claude/zen-bardeen-zq7g2y
title: Plans, prices, projects and what each plan includes are config behind one stage switch (WP-14 T14)
areas: [config, db, api, web, docs]
supersedes: ["Business limits are lifted on every plan until paid plans launch (2026-10-16)", "Plans differ by agent work only (2026-11-11)"]
---
## What changed
WP-14 T14, which amends WP-09 T14 and T16 and WP-13 T7's server check. Everything a plan is lives in
`packages/config/src/pricing.ts`, and one constant, `EARLY_ACCESS_STAGE` (`invite_only` now, `open` later), decides
what applies. A later session can rely on:

- **Names.** `planName(tier)` is the only name a person reads: Try, Founder, Studio (keys `free`, `pro`, `scale`
  unchanged). Partner is `PARTNER_PLAN`, display data that cannot be bought. `PRICE_TBA_LABEL`, `priceMonthly` and
  "Monthly credits to be announced" are gone.
- **The stage.** While `invite_only`: `planPriceLabel` reads "Free while in early access" for every plan,
  `subscriptionChargeMinor` is 0 for everyone, `assertSubscriptionChargingOpen` (apps/api payments.ts) refuses, and no
  plan check applies. `ENTRY_PLAN` is #273's record ($5 a month, $5.00 of credits) with no switch of its own.
- **Prices.** `PRICE_SETS` a (Founder $15, Studio $50) and b ($25, $100), Partner $250 in both, behind
  `PRICE_TEST.enabled = false`. `indicativePricesFor(seed, kept)` gives a visitor a stable half-and-half set marked
  "Indicative", or null while the switch is off. `subscriptionChargeMinor` never returns more than the shown figure,
  and a stored price wins over config.
- **Projects.** `tierBusinessLimit(tier, stage)`: Try 1, Founder 5, Studio any number from `open`, null before.
  Archived projects are not counted. The refusal at commit names the plan with room (`planWithRoomFor`).
- **Budgets and models.** `includedCreditsMinor`: 500, 1000, 5000. `tierIsPaid` now means "reaches Opus and Sonnet by
  the plan alone" (Founder, Studio). `modelFundingFor` takes `creditPack` and `stage`; from `open` a Try project whose
  owner bought a live pack of $20 or more (`repos.checkouts.ownerHasPack`) is funded as `paid_plan`.
- **What each plan includes.** `PLAN_FEATURE_FROM`, read through `planIncludes(tier, feature, stage)`.
- **Migration 0144.** `owner_plans` (account-scoped, service role only): `invited_at`, and the first Founder or Studio
  price paid. `partner_waitlist` (business-scoped, service-written, closed to collaborators). Every account that
  exists when it runs is marked invited; commit marks a new owner while `invite_only`;
  `repos.ownerPlans.markInvitedBefore` is the opening step (docs/DEPLOY.md §4).
- **Billing** lists four plans from config. `billing.plan` returns `stage` and `partner.joinedAt`;
  `billing.partner.join` records owner, project and consent once.

Tests: `packages/config/src/__tests__/pricing.test.ts`, `packages/db` (`tiers.test.ts`, `model-funding.test.ts`,
`rls/owner-plans.test.ts`, the generated cross-tenant suite), `apps/api` `billing-checkout.test.ts` and
`idea-commit.test.ts`, `apps/web` `settings-logic.test.ts` and `e2e/billing.spec.ts`.

## Decisions
### One switch, and it is a constant in code
#273 proposed `ENTRY_PLAN.opensSignUp`; WP-14 asked for `EARLY_ACCESS_STAGE`. There is one value: the stage. It is a
constant, not an environment variable, so a deployment setting cannot start charging or apply plan limits by itself.
`SIGNUP_OPEN` (who may sign in) stays an environment variable; docs/DEPLOY.md §4 says the two change in one step.

### "Everyone has everything" covers features and the number of projects, not agents at once or models
While `invite_only` no feature in `PLAN_FEATURE_FROM` and no project limit applies. Agents at once and the models a
plan reaches stay each plan's own numbers: testers have 4 at once and Haiku 5.5 or GLM today, so they lose nothing, and
the founder is paying for their use under the $600 cap.

### Founder runs as many agents at once as Try
The brief says Studio adds more agents at once and lists nothing of the kind for Founder, so `pro.maxConcurrentAgents`
went from 16 to 4. Studio keeps 64. The seeded Northwind (on `pro`) now runs 4 at once.

### The month's budget goes to one project on every plan
`includedCreditBusinesses` was 1, 3 and unlimited. With Founder at $10.00 and Studio at $50.00 that would have granted
$30.00 and an unbounded amount a month. It is 1 on every plan. A Founder with five projects therefore has one that
starts the month with credits. Sharing one budget across an owner's projects needs a per-owner balance: not built.

### The word is "project", not "company"
The founder's answers say companies; the vocabulary rule of 2026-11-11 says project until the first sale, with one
exception on the landing page. Billing and the refusal say "1 project", "Up to 5 projects", "Any number of projects".

### A person shown no figure is charged from set a
`PRICE_TEST.listSet` is `a`, the lower set, so nobody is charged more than a figure they could have seen. The founder
sets it before opening. Nothing reads it while `invite_only`.

### Invited people pay nothing on Try or Founder, and Studio in full
A12 names the Founder fee. `tierForInvited` puts an invited owner on Founder from `open`, and
`subscriptionChargeMinor` is 0 for them on Try and Founder. Studio is charged at its full price, not less the Founder
fee.

### The invited marker is a service-only table, not a column on the profile
A person can write their own profile row, so a column there could be forged. `owner_plans` has no client grant.

### The credit-pack route is read from paid checkouts, only from `open`
"Has bought a pack" is a live, paid `billing_checkouts` row of $20 or more that the person who took charge of the
project paid themselves, on any project they took charge of. A cofounder's purchase on another project does not count
(security review). A simulated payment never counts. A refund does not undo it: checkouts have no refunded state yet. Until `open` a top-up changes no model, as #274 says.

### Terms: two sentences changed
"Foundmill has a free plan" and "Plans differ only in how much agent work they include" were no longer true. The Terms
now point at Settings › Billing for plans and prices, say no plan is charged while sign-up is by invitation, and say
plans differ by projects, agent work and features. No sentence promises that anything stays free.

### Canceling is one press
Going back to Try is "Choose Try", one press, the same as choosing a plan; neither opens a checkout
(`billing-checkout.test.ts`, `e2e/billing.spec.ts`). Pausing a project is the existing Stop all agents: not changed.

### Migration number 0144
The branch first took 0139, leaving 0136 to 0138 for sessions that had not pushed. Rebased onto main on Nov 19, 2026
(Session 3 of the launch plan), main had taken 0135 to 0143, so the file is now `0144_owner_plans.sql`.

### Rebase onto main, Nov 19, 2026
WP-09 T16 (#273) had landed with its own switch and record. What was reconciled:
- **`ENTRY_PLAN`** was declared by both. There is one now, in `pricing.ts`, named Try (it read "Entry") with the tier.
- **Two switches remain.** `PAID_ENTRY` (env, off) still offers the $5 subscription checkout and the gate at the first
  Continue press; `EARLY_ACCESS_STAGE` (constant, `invite_only`) still holds the plan limits and the price labels. The
  task asked for one. Joining them means `PAID_ENTRY` would follow the stage, which breaks #273's tests that turn it on
  in test mode; left for the founder to say, and DEPLOY.md §4 lists both for the opening day. While `PAID_ENTRY` is off
  nothing can be subscribed to, which is what `billing-checkout.test.ts` now asserts. `billing_checkouts.kind` accepts
  `subscription` since 0140, so the old assertion that the table refuses it went.
- **Portability.** `owner_plans.user_id` and `partner_waitlist.user_id` are classified in `ACCOUNT_COLUMNS` (the test
  that every key to `auth.users` is classified failed after the rebase).

### Security review
The `security-reviewer` agent read the change. Two low findings were fixed here: the pack rule now counts only the
owner's own purchases, and `partner_waitlist` is unique on project and person. Its note stands: nothing calls
`assertSubscriptionChargingOpen` yet, so WP-09 T16's checkout, renewal and webhook must.

## Not done
- **No feature is gated yet.** `planIncludes` exists and is inert until `open`. Vacation mode, card sharing, named
  agents and the phone Inbox are being changed by other sessions (#285, WP-14 T6 and T9), so the four checks are for
  those owners or a follow-up before opening.
- **The price test is not shown anywhere.** The waitlist page (WP-14 T15) calls `indicativePricesFor` and stores the
  set with the waitlist entry. `subscriptionChargeMinor` takes that set as `shownSet`.
- **The subscription checkout (WP-09 T16, #273) does not yet call the stage gate.** It must call
  `assertSubscriptionChargingOpen`, charge `subscriptionChargeMinor`, and store the first price with
  `repos.ownerPlans.storePrice`.
- `tierShowsBuiltOnMark` is untouched, as the task says. `packages/dugout` `mock.ts` still describes GLM as "the free
  plan's model" in a story fixture.
- The landing page, Commit's credits line and the zero-credits sentences still say "free plan": WP-14 T10, T11 and T1.
