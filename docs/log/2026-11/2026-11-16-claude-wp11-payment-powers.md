---
date: 2026-11-16
branch: claude/wp11-payment-powers
title: Invoices and payment pages ask first; an inbound payment power for automated mode and vacation
areas: [policy, gateway, connectors, db, api, web, dugout]
supersedes: []
---
## What changed
**The founder's answers to WP-11's three questions (Nov 16, 2026, relayed by the planning session), and the change the first one asked for.**
- **Policy.**
  - Tools get a new attribute, `paymentRecord`, set by the gateway from `PAYMENT_RECORD_TOOLS` (`stripe:create_invoice`, `stripe:create_checkout_session`), never by the agent.
  - A new Cedar rule, `automated-ask-payment-record`: in automated mode, and so on vacation, such a call asks unless the business has the inbound power.
  - Both tools now carry `irreversible: true`, so they also ask in augmented and assisted mode, as `send_invoice` already did. They left `INTERNAL_WRITE_TOOLS`.
- **The setting.** `businesses.payment_powers text[]`, default empty, with a check that allows only `inbound` (migration 0135, numbered by the coordinator). Owners and admins set it under the existing `businesses_update` policy.
  `repos.businesses.setPaymentPowers`; the api's `business.setPaymentPowers`; and `business.startHoliday` takes `paymentPowers`, which the founder chooses when the vacation starts.
- **Screens.**
  - Settings › What the team can do shows a switch under the automated answer: "Agents may create invoices and payment links without asking". Off, each one waits in Needs you.
  - The vacation dialog (Dugout `HolidayDialog`) has the same choice as a checkbox, which starts from the project's current setting.
- **Tests.**
  - policy: `payment-powers.test.ts`, every mode with the power on and off, on vacation, and a payout denied in every mode.
  - gateway: `payment-powers.test.ts`, Stripe's real tool through the pipeline. A mock invoice is reported as simulated.
  - db: `rls/payment-powers.test.ts`, cross-tenant, plus member and viewer refused and `outbound` refused by the column.
  - api: `payment-powers.test.ts`, the Settings path, the vacation path, and a member refused.
  - Unit tests for the dugout dialog and the web holiday mapping, and a Playwright case in `e2e/team-can-do.spec.ts`.

## Decisions
### The founder's answers
- **Q1, `stripe:create_invoice`:** not left as is. "Since it's immutable on the Stripe account, it should require asking unless the user is on full autopilot mode or on vacation, in which case they should decide when they go on vacation or on autopilot whether or not agents should have inbound and outbound payment powers." This change builds the inbound half.
- **Q2, the cost report and metric facts:** they keep their own `is_demo` filter, with the test-only guard (T9). Left as it is.
- **Q3, WP-00 S2:** S2 must not set `LIVE_CONNECTORS=sendgrid` on ingest. The founder follows the corrected step.
### No outbound power
CLAUDE.md's Never list says agent code never moves money, and no ruling has changed it. The planning session is asking the founder. The column's check allows `inbound` alone, and the policy's input type names `PAYMENT_POWERS = ["inbound"]`, so an outbound power would be one new value and one new rule. Paying out, transferring and refunding stay hard gates, and no tool becomes callable in any mode.
### Confirmed by the founder, Nov 16, 2026
- "No outbound payment powers yet": this change stays inbound only, and CLAUDE.md's rule that agent code never moves money stands.
- On Foundmill Sites, only the finance lead agent may create a payment link, and it asks first. The WP-07 session builds that tool and reads this setting: `businesses.payment_powers` (value `inbound`), with the tool listed in the gateway's `PAYMENT_RECORD_TOOLS`.

### "Full autopilot" is automated mode
The policy's modes are augmented, assisted and automated; Autopilot (the scheduler that starts cycles) does not change what a call may do. The power applies where the team decides on its own: automated mode, and every vacation, which runs as automated (BUILD §9.6). The switch sits where the founder picks automated.
  An agent given automated autonomy of its own in a business on another mode is covered by the same rule.
### Which tools
`create_invoice` creates and finalizes; Stripe then allows only a void. `create_checkout_session` is a payment page a customer can see and pay. `create_customer` (a record, no money) and Shopify's `create_draft_order` (a draft that can be deleted) are not payment records. `send_invoice` already asked in augmented and assisted mode.
  In automated mode it runs like any message, as before; this change does not alter it.
### Plan previews
The orchestrator's plan evaluation (`activities/plan.ts`) does not pass the powers, so a preview in automated mode says an invoice will ask even with the power on. The gateway's decision is the one that counts. Left as it is to stay out of the orchestrator; a one-line follow-up if previews matter.

### Security review (security-reviewer agent)
No hard-gate bypass; outbound tools stay hard gates in every mode, and only owners and admins set the power.
- **Medium, fixed:** an agent could report a large amount on `create_invoice`. That routed the approval as `spend_above_threshold`, which the founder may have handed to an agent in Team › Responsibilities, so the invoice ran without the founder. `decisionTypeFor` now returns no decision type for a payment record, so the founder decides. The gateway test covers it, and fails without the fix.
- **Low, accepted:** an agent the founder set to automated autonomy of its own, in a business on another mode, also uses the power when it is on. Only the founder sets that override, and it is what they chose for that agent.
- **Low, fixed:** the vacation dialog says the choice stays after the founder returns, and where to change it.
- **Plan previews:** no plan action uses a Stripe tool, and the gateway decides when the step runs.

## Not done
- `pnpm evals` was not run.
- The migration number may change when this opens: no new migration merges until #238 is in (the planning session's order).
