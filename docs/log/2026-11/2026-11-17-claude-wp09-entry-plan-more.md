---
date: 2026-11-17
branch: claude/wp09-zero-credits
title: The first drafts are shown before the ask, credit-pack sizes, and the personal zero-credits message (founder, Nov 17)
areas: [docs, config, web, api, db]
supersedes: []
---
## What changed
Docs only, in this entry. It records three more founder answers of Nov 17, 2026 for the entry-plan record. They add
to docs/log/2026-11/2026-11-17-claude-wp09-paid-entry-plan.md (#273) and
docs/log/2026-11/2026-11-17-claude-wp09-entry-plan-answers.md (#274).

## Decisions
1. **The free line at Commit is confirmed, and it becomes a design requirement at opening.** The founder: "Yes, and we
   should try to ensure that users see the team's first drafts (page, plan, foundations) before they hit continue and
   we ask them to pay". This was #273's "my reading". From opening:
   - commit's drafting stays free;
   - the page, the plan and the foundations are drafted **and shown** before the first press that asks for payment;
   - the ask comes at Continue.
2. **Credit-pack sizes are set: $20, $50, $100, $250 and $500.** The price per credit falls as the pack gets bigger
   ("users pay less per credit the more they buy"). Two things are **not set**:
   - the discount at each size;
   - the markup on a credit.

   They stay an open question. This list replaces #274's three-pack proposal.
3. **The personal zero-credits message (WP-09 T13), in the founder's words:** "You've used all your included AI! It
   is back on Dec 1. To keep going now, connect your own Anthropic key."
   - The plan's name, its price and the reset date come from config. The date is the next month's first day, written
     in US form.
   - The platform-cap message ("Foundmill's included AI is used up for this month! …") belongs to WP-13's session.
     The two must never both show: the WP-13 session tells this package which one wins when both hold.

4. **Foundmill's own Stripe is a launch requirement.** The founder: "the point was that WE need Stripe from when WE
   launch! So we will get that done." Launch means opening sign-up with the $5 entry plan. WP-09 T16 is no longer
   deferred. It is rewritten for the decided plan and built behind its switch, with the mock passing, after T12 to T14:
   - a $5.00-a-month subscription that carries $5.00 of credits on Haiku 5.5 and GLM-5.3 Flash;
   - credit packs of $20, $50, $100, $250 and $500, whose price per credit and markup are config (a placeholder
     marked Estimate until the founder sets them);
   - buying a pack unlocks Claude models on Foundmill's key and removes the "Built on Foundmill" mark;
   - the gate sits at the first AI run (Continue), after the page, the plan and the foundations have been drafted and
     shown;
   - test users convert on the day of the switch;
   - one config value flips invite-only-free to paid entry.

   Checkout is always the person's own press on Stripe's page; agent code never moves money. Nothing is offered to a
   user before Stripe is live, and nothing new appears in production from this work until the switch.
5. **A founder's own Stripe** (for their customers' payments) is optional, not a launch gate.
6. **Stripe is the first exception to "Foundmill registers no developer apps".** The founder: "We will have to make
   certain exceptions from the no developer apps rule, Stripe being one of them." CLAUDE.md's bullet now says so;
   each further exception needs the founder.

### What must exist before opening (adds to #273's list)
- **The team's first drafts are shown before the payment ask.** Owner: WP-04, where Commit and the first day's screens
  live, with WP-09 for the gate.
  - The page, the plan and the foundations are drafted at commit and visible on the first day before Continue.
  - Continue is the first press that asks for the $5 plan.
  - A test checks that a founder who has not subscribed sees all three, and that Continue asks.

## Not done
- **Open founder question: the discount and markup at each pack size.** A proposal, every figure an Estimate. Credits
  are spent at list prices, so a pack's credits cost Foundmill their face value in model spend. Stripe's fee (about
  2.9% + $0.30, Estimate) is shown apart.

  | Pack price | Credits (proposal) | Price per $1.00 of credits | Model spend at list | Before Stripe's fee | Stripe's fee |
  | --- | --- | --- | --- | --- | --- |
  | $20 | $20.00 | $1.000 | $20.00 | $0.00 | about $0.88 |
  | $50 | $52.50 | $0.952 | $52.50 | −$2.50 | about $1.75 |
  | $100 | $110.00 | $0.909 | $110.00 | −$10.00 | about $3.20 |
  | $250 | $287.50 | $0.870 | $287.50 | −$37.50 | about $7.55 |
  | $500 | $600.00 | $0.833 | $600.00 | −$100.00 | about $14.80 |

  At list prices, every bonus is a loss. A falling price per credit leaves Foundmill a margin only if a credit carries
  a markup. One example (Estimate): credits are sold at 1.25 times list, so $20 buys $16.00 of model spend at list.
  The bonus then comes out of that markup. The founder sets the markup and the curve.
- The personal zero-credits wording above replaces T13's "To keep going, add credits …, add your own Anthropic key …,
  or wait …" sentence in the Inbox note.
  - It is applied in this branch's T13 code before the push.
  - The 402 refusal and the Billing tab keep the ways-on list, with credits named only where they can be bought.
