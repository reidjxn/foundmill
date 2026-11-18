---
date: 2026-11-17
branch: claude/wp09-zero-credits
title: WP-09 T16, the $5 entry plan and credit packs on Foundmill's own Stripe, behind PAID_ENTRY
areas: [config, shared, db, gateway, ingest, api, orchestrator, web]
supersedes: []
---
## What changed
- **Config and env.** `ENTRY_PLAN` ($5.00 a month, $5.00 of AI included) and `CREDIT_PACKS_MINOR` ($20 to $500) are
  in packages/config. `CREDIT_PACK_CREDITS_MINOR` says what team budget each pack adds, set by the founder (decision 8).
  - `PAID_ENTRY` is the one switch from invitation-only and free to paid entry. It is off by default.
  - `STRIPE_ENTRY_PRICE_ID` (gateway only) names the plan's recurring Stripe price.
- **Database, migration 0140 (placeholder number until the coordinator assigns one).**
  - `billing_checkouts.kind` gains `subscription`. Two columns are added:
    - `credits_minor`, for a pack that carries more than its price;
    - `resume`, what the checkout unblocks: `continue` means its confirmed payment starts the next round of work.
  - New table `account_plans`, one row per account, written by the services only. It holds the status (active, past
    due, canceled), the mode (live or mock), the Stripe ids, the paid period's end and `status_at`.
    - A person reads only their own row (RLS), and only its state: a column grant keeps the Stripe ids from them.
    - `status_at` is when the event that last set the status was created. An older event delivered late changes
      nothing, and a canceled subscription never comes back on a newer one.
  - Repos: `accountPlans.forUser`, `activate`, `setStatusBySubscription`, `ownerHasActivePlan`, `boughtPack` (the check
    WP-13 T7 reads for Claude models on Foundmill's key) and `ownerBoughtPack`.
- **Settlement.** `settleCreditCheckout` handles a subscription checkout. It marks the checkout paid, activates the
  plan of the account that opened it, grants no credits and audits `billing.entry_plan_started`. A pack grants its
  `credits_minor`.
- **Gateway.** A subscription checkout is a Stripe Checkout in subscription mode on the entry plan's price. Live without
  the price id answers 503 `payments_unconfigured`.
- **The pay-and-resume loop (founder, Nov 17, 2026, relayed by the coordinator).** When work needs something paid for,
  the request says in plain words what is bought, why the team needs it now and what it costs. One press goes to
  Stripe's checkout, and the confirmed payment starts the paused work by itself.
  - Continue without the plan writes one Chief of Staff note, "Your team is ready to start", which never holds
    Continue. The 402 carries the request, and the shell shows it with a Subscribe button that opens Stripe (in mock
    mode, the simulated checkout).
  - The checkout is opened with `resume: "continue"`. Its settlement starts the next `businessCycle` and audits it as
    the founder's Continue with trigger `payment`:
    - ingest does this for a real payment (`followups.continueAfterPayment`);
    - the api's `completeMock` does it for a simulated one.

    It starts only when Continue would start one: the team is not stopped or on vacation, nothing in Needs you blocks
    it, and no cycle is open or queued.
  - Paying archives the note. A canceled or failed checkout leaves the work paused and the note in place, said once.
  - A replayed delivery (409) or the same payment under another event (a duplicate) starts nothing more.
  - The zero-credits exit (T13) is the first instance of the loop. A pack bought from the Billing tab while credits are
    at zero carries `resume: "continue"`.
- **Ingest.** `POST /billing/stripe` handles four kinds of event:
  - a paid subscription-mode session settles the plan;
  - `invoice.paid` and `customer.subscription.updated` move the plan to active (both Stripe API shapes are read);
  - `invoice.payment_failed` moves it to past due;
  - `customer.subscription.deleted` moves it to canceled.

  Each checkout kind is accepted only in its own session mode.
- **Api.**
  - `billing.subscribe` (owner only, only while `PAID_ENTRY` is on). In mock mode it opens the simulated checkout,
    completed with `checkout.completeMock`.
  - `billing.plan.entryPlan` reports the price, what is included, whether the project's AI runs are open, this
    person's plan and the packs.
  - With the switch on, `billing.topUp` sells the packs only.
  - The gate: 402 `entry_plan_required` with the way to subscribe. It applies to Continue, turning Autopilot on,
    Automated mode, a vacation, a task started by hand, a training run and Start distribution. An approval starts no
    cycle without the plan. Commit creates the project with its drafts but starts no cycle and no Autopilot. Without
    its environment, commit fails closed.
  - Subscribe sends a second press back to the checkout that is still open. It refuses while a plan is active or has
    a payment due, so a second subscription never bills alongside the first.
- **Orchestrator.** The same rule applies where the work begins (`src/entry-plan.ts`), so every path is covered,
  whatever started it:
  - the cycle's brief reads a closed plan as a stopped team, so it plans and dispatches nothing;
  - the dispatch guard refuses a session (`entry_plan`);
  - `autopilotEvaluate` waits (`entry_plan`) and a Continue run ends.

  This also covers invited test users on the day of the switch: their projects stay, and AI runs wait.
- **Env.** `paidEntryLive` (shared): a simulated plan or pack counts only on a fully simulated stack. Wherever
  billing, model calls or integrations run live, or simulated payments are off, only Stripe's count. Production
  refuses to boot with `PAID_ENTRY` on unless the platform's billing is live.
- **The "Built on" mark.** `showsBuiltOnMark` (packages/db) keeps the free plan's rule, and with `PAID_ENTRY` on an
  owner's paid pack removes the mark. The page, the public page, the milestone card, the follow confirmation email
  (gateway) and the follow confirmation page (ingest) all read it.
- **Web.** Settings › Billing leads with the entry plan when it is offered (Subscribe, status, Stripe's page or the mock
  checkout) and sells credits as the packs. The checkout panel speaks of a subscription when that is what was paid.
- **Tests.**
  - db: payments and the account_plans RLS suite.
  - gateway: billing.
  - ingest: billing, now with entry-plan events.
  - api: entry-plan.test.ts, with the switch off and on, the gate, subscribe, packs, the mark and commit.
  - shared and orchestrator: autopilot, for the new fact and wait reason.
  - web: settings-logic for the notices, and billing.spec, which checks that nothing is offered with the switch off.

## Decisions
1. **The plan's $5 of AI is the month's included credits; the webhook grants nothing more.** Every business on credits
   already gets $5.00 a month through the period row (`TIERS.free.includedCreditsMinor`). Granting $5 more on each
   paid invoice would pay twice. The plan's status is what opens AI runs. A canceled plan or a failed renewal shuts
   the gate, so no further month is spent. Nothing already granted is taken back. WP-09 T16 said "the webhook grants
   each paid period's $5.00 of credits"; this reading avoids the double grant. It needs the founder's yes.
2. **Conversations, Refresh and planning still use the included credits without the plan.** The gate covers what T16
   names: Continue, an approval's cycle, cycle 1 at commit, Autopilot and the overnight shift. Closing the platform-key
   calls too would reach the composer's and models' credit checks. That is a wider change, so I left it for the
   founder's answer.
3. **A pack bought by an owner removes the mark automatically.** I added no per-project setting. This follows the
   2026-11-12 rule that a paid plan removes the mark completely. If the founder wants the owner to choose, it needs a
   column and a switch.
4. **The founders' plan.** The plan is per account. It opens the projects where that person is a founder (an owner or a
   cofounder, `OWNER_ROLES`), so a collaborator's or an admin's plan does not open someone else's project. One founder's
   plan opens a shared project for all of them.
5. **Live means live.** A simulated plan never opens work on a stack where anything runs live (`paidEntryLive`).
6. **Subscribing from the Billing tab also starts the team.** Subscribe there carries `resume: "continue"` as well:
   subscribing is the founder saying "start my team". A pack bought there resumes work only when credits were at zero.
7. **The security review (security-reviewer agent) on this change.** It found no bypass of a hard gate. I fixed its
   findings:
   - the gate was missing on other paths (now the orchestrator's brief and dispatch, plus the api presses);
   - cofounders were left out;
   - out-of-order events could reactivate a plan;
   - a live plan could be active without its subscription id;
   - settlement did not check the session's kind;
   - a second subscription could bill alongside the first;
   - simulated plans counted on a partly live stack;
   - commit failed open without its environment;
   - the Stripe ids were readable by the client role.

   Left as they are:
   - the gateway does not refuse a subscription checkout while `PAID_ENTRY` is off (only the api calls it, and the api
     refuses);
   - ingest playbooks still start without the plan check (they are founder-built automations; the dispatch guard still
     stops any session they would open).

8. **Credit packs (founder, about 17:40 UTC, Nov 17, 2026, relayed by the coordinator).** A pack adds a bonus budget, not
   a discount on its price: $20 adds $20.00, $50 adds $52.50 (5%), $100 adds $110.00 (10%), $250 adds $287.50 (15%) and
   $500 adds $600.00 (20%). This replaces the face-value placeholder, so the Estimate label on what a pack carries is
   gone. The WP-14 money session reuses this table for its T14 rather than defining a second one.

## Not done
- Migration number and the push wait for the coordinator's slot (0140 is a placeholder).
- Stripe setup S8 (the entry product and price, the webhook events, the customer portal) is the founder's.
- The customer portal link (manage or cancel) is not on the Billing tab yet; Stripe's emails carry it.
- A named one-off charge (domains later) fits the same loop: a checkout with a named line and `resume`. Neither it nor
  agents' virtual cards (dropped by the founder, Nov 17) is built.
- No Playwright spec runs with `PAID_ENTRY` on: the e2e stack runs with it off, as production does until the switch.
- **Decided by the founder at about 17:50 UTC, Nov 17, 2026 (relayed by the coordinator):**
  - **Expiry:** packs expire after 12 months, as main has it (0098, `CREDIT_LOT_MONTHS = 12`); nothing changes.
  - **Markup:** cost plus 30%, from day one, on every plan and pack, the invited testers and the included monthly
    budgets too; a founder's own key is not marked up. It is its own pull request right after this one.
