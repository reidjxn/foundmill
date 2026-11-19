---
date: 2026-11-18
branch: claude/wp14-test-mode-payments
title: A payment from a provider's test mode is never a real outcome
areas: [events, connectors, ingest, docs]
supersedes: []
---
## What changed
`payment.received` has a new field, `simulated` (default false). The Stripe webhook normaliser sets it when the event
says `livemode: false`, for `invoice.paid` and one-off `checkout.session.completed`. The Shopify normaliser sets it
when the order says `test: true`. Every reader of the flag already existed: `isRealOutcome` and the north star's
real-outcome queries (`packages/shared`, `repos.metrics`) and the post-outcome credit (`apps/ingest`). So a test-mode
payment now counts toward no weekly outcome, credits no post, and cannot back a shared Customer Update card.
Tests: the two connector suites, and a delivery through ingest that writes one test-mode and one live payment and reads
back `isRealOutcome` for each.

## Decisions
### A flag in the payload, not the Simulate panel's actor
The Simulate panel marks its events with the actor `system:simulate`. A test payment is delivered by the provider, so
its actor stays the webhook and the payload says why it is not real, as `mail.sent` already does. Both are read the same.

### Only an explicit `livemode: false` is test mode
Stripe sends `livemode` on every event. A body without it is read as live, because guessing would also turn a genuine
but odd event into a simulated one, and anyone who can sign a body can also write `livemode: true`.

### The conversion and the Customer Update are still recorded
In `INTEGRATIONS_MODE=mock` every Stripe delivery is `livemode: false`, and the golden path needs its Customer Update.
A simulated payment records its conversion exactly as the Simulate panel's does. What changes is that nothing treats it
as real, and the share action of WP-14 T9 refuses it.

## Not done
- A founder who connects their own Stripe knows the webhook signing secret, so they can still sign a body of their own
  with `livemode: true`. Closing that needs a check the signature cannot give: before a card is made, the gateway reads
  the payment from the founder's own Stripe account and requires it live and paid. That is a gateway route and a change
  to WP-14 T9's share action, and is left for the founder to place.
- `events` is writable by owner, admin and member through RLS (0099). Payment events are written only by ingest, so this
  is not reachable for payments; a guard on `actor` and `payload` would close it.
- WP-14 T9 (#303) says "Foundmill recorded this when the project's payment provider reported the payment". Once this
  merges, that card can say what it used to: "Foundmill recorded this payment when it arrived."
