---
date: 2026-11-20
branch: claude/wp14-owner-budget
title: One included budget per owner, and project limits at every stage (WP-14; founder, Nov 19, 2026)
areas: [db, api, web, orchestrator]
supersedes: []
---
Session 3 of the launch plan (plans and money). Founder's answers of Nov 19, 2026 (night), from the comment on #300:
1. **One month's included budget per owner, shared across all of that owner's projects** (Try $5.00, Founder $10.00,
   Studio $50.00), instead of a budget per project. `includedCreditBusinesses` no longer decides it.
2. **Enforce the project limits per plan**: Try 1, Founder up to 5, Studio any number, deleted (archived) ones not
   counted. Committing one more past the limit is refused with a plain way on (change plan). Nothing limits people.
This closes the open item in the WP-14 T14 log ("A15 read loosely").

## What changed
- **Migration 0151 `owner_credits`** (account-scoped: user, month, granted, balance, spent, USD only). A person's row opens
  on their first charge of the month with their plan's budget and is shared by every project they took charge of
  (`businesses.created_by`, the meaning `includedCreditsFor` already had). Reads: a member who is not a collaborator of one
  of the owner's projects (policy `owner_credits_select`, security-definer helper `fm_shares_owner_budget`, granted to
  `authenticated` and `service_role` only). Writes: the service role only. Cross-tenant and write tests:
  `rls/owner-credits.test.ts`; the helper is in `client-grants.test.ts`'s list.
- **A charge draws on the owner's budget first, then on the project's own balance** (what it bought: credit packs, kept as
  lots and carried as before). `repos.usage.chargeCreditsMicro` takes the owner's advisory lock first
  (`lockIncludedCredits`), so two projects of one owner charging at once never spend the same credits
  (`billing.test.ts`, "two projects of one owner charging at once"). It returns the project's whole balance (its own plus
  what is left of the shared budget), so `exhausted`, the Resting note and the low-credits note read one figure.
- **One reader of the combined figure**: `platformCredits`, `checkPlatformCredits`, `creditsState` and the low line all
  go through `ownerShare` (billing.ts). Commit, the kill switch's resume check and `billing.plan` use them, so the
  session reserve (T1), `teamBudget` (T3) and the Billing tab agree.
- A project with a recorded owner opens its own row with nothing included (`includedCreditsFor` returns 0, as does a
  top-up that opens a month). A business with no recorded owner (old seeds) keeps its own plan's credits as before.
- **Limits**: `tierBusinessLimit(tier)` is the plan's number at every stage; the stage no longer matters to it.
  `assertBusinessAllowance` refuses past it with the T14 sentence ("Try holds 1 project and you have 1. You keep it. Founder
  holds up to 5: change plan in Settings › Billing to take charge of another, or archive one."). An owner over a limit keeps
  what they have.
- Gone: the pool of places (`includedCreditBusinesses`, `tierIncludedCreditPlaces`, `includedCreditPool`,
  `includedCreditPlacesTaken`), the "this month's credits already went to another project" sentences (Billing hint, the
  resting note's pool line, Commit's notice). Commit's notice now reads "This month's team budget ($5.00) is already used
  by your other projects, so this one starts resting. ..." and its pill "Team starts resting". `founder.businesses.allowance`
  returns `includedCredits: { monthlyMinor, remainingMinor, nextGrantAt }`.

## Decisions
- **Existing balances.** Projects already hold included credits for November (granted per project). The migration gives
  every owner who has a balance row this month an `owner_credits` row with nothing in it, so nobody is granted a second
  budget for the month; the shared budget starts with December. Only the founder's invited testers are affected, on
  Foundmill's cost.
- **What "the owner's plan" is.** The budget is the plan of the owner's highest project (`businessAllowance`), fixed when the
  month's row opens. Before the first charge of a month, Billing shows the plan of the project being read (no second
  query); if that differs from the owner's highest plan the figure changes once at the first charge.
- **A project's lots when it has no row yet this month** are not added to the balance shown until its first charge opens the
  row (they were not before either).
- **Test fixtures.** A second project for one owner on Try is now refused, as the founder asked. The dev owner already holds
  a Studio project (Ledgerly), so the end-to-end specs are unaffected; the api tests that commit several projects move their
  owner to Studio first. `spendAllCredits` (`@foundmill/db/testing/credits`) uses up the owner's budget and the project's
  own balance for the tests of the used-up state.
- `billing.plan` and `business.autopilot.get` read one more row (the shared budget): the round-trip ceilings in
  `round-trips.test.ts` are 5.
- The migration number is the next free one at the time of writing (0151, after main's 0150).

## Not done
- A plan change in the middle of a month does not change that month's budget (the row keeps what it opened with).
- The resting note's list of finished tasks and the Billing figure are per project; only the budget is shared.
