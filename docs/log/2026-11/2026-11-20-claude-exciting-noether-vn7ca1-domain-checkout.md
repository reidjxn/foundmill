---
date: 2026-11-20
branch: claude/exciting-noether-vn7ca1
title: Paying for a domain on Foundmill's Stripe before it is registered
areas: [db, connectors, gateway, api, ingest, web]
supersedes: []
---
## What changed
- A domain registered through Foundmill is now paid for first, on Foundmill's own Stripe (the founder's answer of Nov 17, 2026), and only a paid payment registers it. This lifts the refusal of a live registration that Path A left in place (`2026-11-19-claude-exciting-noether-vn7ca1-path-a.md`).
- Migration 0150 (0149 was taken on main by the explore listing): `billing_checkouts` gains the `domain` kind, `domain_name` (required for that kind, refused for the others) and `fulfilled_at`, the one registration a paid domain checkout allows, claimed atomically and given back if the registry refused.
- `domain_registrants` (0150): the founder's registrant details between paying and registering. Service role only, so no other founder of the project ever reads them; deleted once the domain is registered, and with the checkout. Cross-tenant test: `packages/db/src/__tests__/rls/domain-registrants.test.ts`.
- Settlement (`settleCreditCheckout`): a paid domain checkout grants no credits; it is marked paid once and audited (`billing.domain_paid`). Ingest's platform Stripe webhook accepts a `domain` session in payment mode; the gateway's checkout route accepts the kind.
- The api: `integrations.startDomainCheckout` (Pay) quotes again, refuses a price other than the one the founder saw, opens the checkout through the existing `startCreditCheckout` (Stripe live through the gateway, simulated where payments are), returns to Settings › Integrations, and stores the founder's details apart.
- `integrations.completeDomainCheckout` settles a simulated payment where those are allowed, says "waiting" while Stripe has not confirmed a real one, and then runs the registration once.
- The flow (`opensrs/flow.ts` `registerDomain`) takes a checkout id, not the founder's typed details. It claims the paid order, refuses a simulated payment when OpenSRS is live, checks the name is still free, registers with the founder's stored details, writes the row, deletes the details and sets the records.
- Settings: "Pay $X and register" in the registration dialog. Live, it opens Stripe's page, which returns to Settings › Integrations, where the registration finishes (`DomainCheckoutReturn`, with "Check again" while Stripe confirms). Simulated, it settles and registers in one press. "Get a domain" shows where OpenSRS and Foundmill's Stripe are both live, or where simulated results are allowed.

## Decisions
### The registration runs when the founder comes back, not from the webhook
Ingest calls no vendor and has no gateway client, so the paid webhook only marks the checkout paid. The founder lands back on Settings › Integrations from Stripe, and that visit registers the domain. A founder who closes the tab finds the payment waiting there, with "Check again". A follow-up can let ingest ask the gateway when that proves too slow.

### A name taken between paying and registering is refunded by a person
The claim is given back with why ("registered by someone else in the meantime") and the founder is told the payment will be refunded. Money only goes out by a person at Stripe (FOUNDMILL.md, Never), so the refund is an operator step: the audit row and the checkout's `failure` show which payment.

### The registration uses the paid price
A cost change at OpenSRS between paying and registering does not stop the registration: the founder pays what they were shown, and Foundmill absorbs the difference.

### Security review (no blockers; fixed)
- Pay is refused unless the payment and the registration run in the same mode (never a real payment for a simulated registration, or the reverse); the rule is enforced on the server, not only in Settings.
- One domain payment at a time per project: a paid one waiting for its registration, or one open on Stripe within a day. Settings offers "Finish registration" (or back to Stripe's page) for it.
- The claim is given back only on a definite refusal: the name taken, or the registry's 4xx (OpenSRS's own "no" is now a 409, the gateway keeps it). A timeout or 5xx keeps the claim, because the name may be registered. A recording failure after OpenSRS registered keeps it too, with the order id.
- The failure stored on the checkout is a fixed sentence, never the vendor's text, which could echo the founder's details.
- The return from Stripe registers from an effect, once; the domain's `added_by` is the founder who paid.
- Not done: a sweep of `domain_registrants` rows whose checkout expired or failed, and a per-business lock around two simultaneous presses of Pay (the one-payment rule narrows that to a race between two first presses).

### WHOIS privacy only where it is free (founder, Nov 21, 2026)
The founder's answer: turn WHOIS privacy on only for endings where OpenSRS charges nothing for it; where it costs anything, leave it off and rely on ICANN's redaction.
- Built as a list, `WHOIS_PRIVACY_FREE_TLDS` (packages/shared `domains.ts`), and `whoisPrivacyFor`: `register_domain` sends `f_whois_privacy: 1` only for an ending on the list, and every ending not on it is off.
- The list is empty today. OpenSRS's Contact Privacy guide (support.opensrs.com article 201000063415, read Nov 21, 2026) says "the full subscription cost is due when the service is added" and names no ending as free.
- The one statement that privacy is free is a 2011 OpenSRS blog post about .CO, too old to rely on.
- Per-ending prices are only in the reseller panel and the pricing API's add-on section (support.opensrs.com 201000133083), so an ending is added from there, with the date it was read, once the reseller account exists (Nov 22).

## Not done
- Renewal (yearly, through Foundmill's Stripe) and the low-balance alert on the reseller account.
- Registering from the paid webhook itself.
- Receiving and forwarding mail at a registered domain (a later change).
