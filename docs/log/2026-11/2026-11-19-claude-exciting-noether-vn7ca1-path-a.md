---
date: 2026-11-19
branch: claude/exciting-noether-vn7ca1
title: Get a domain through Foundmill on OpenSRS (Path A of the domain plan), mock-first
areas: [db, connectors, gateway, api, web]
supersedes: []
---
## What changed
- Session 14, Path A of docs/log/2026-11/2026-11-17-claude-wp08-domain-plan.md, after Path B (`2026-11-19-claude-exciting-noether-vn7ca1.md`): a founder can register a new domain for the project, in their own name.
- `opensrs`, a service-only connector (real and mock) on Foundmill's reseller account: XCP over HTTPS signed `md5(md5(xml + key) + key)`, test host by default (`OPENSRS_ENV=live` for the live one). Tools: `lookup_domain` (LOOKUP and GET_PRICE), `register_domain` (SW_REGISTER), `set_dns_zone` (CREATE_DNS_ZONE, then SET_DNS_ZONE). Gateway env: `OPENSRS_USERNAME`, `OPENSRS_API_KEY`, `OPENSRS_ENV`.
- The founder is the owner, admin and billing contact with the details they enter; the tech contact is the reseller's default. A connector test asserts the request carries the founder's contact and nothing of Foundmill's.
- Migration 0148 adds to `project_domains`: `source` (`own` or `registered`), the order id, registration and expiry dates, the price the founder was shown (`price_minor`, `currency` USD), and forwarding (`forwarding_user_id`, `forwarding_opted_in_at`). `sendgrid_domain_id` may be null while a registered domain's setup has not reached SendGrid.
- The flow (`packages/connectors/src/connectors/opensrs/flow.ts`), run by the gateway at `POST /v1/domains/register` when OpenSRS is live and by the api on the mocks:
  - Quote: OpenSRS's cost plus $3 (`DOMAIN_REGISTRATION_MARKUP_MINOR`), shown labeled Estimate.
  - Register: the price must be the one the founder saw. The row is written as soon as OpenSRS answers, so a registration that went through is never lost.
  - Setup: SendGrid's domain authentication, then the whole zone: the ownership TXT, SendGrid's CNAMEs, the site's `www`, MX to `mx.sendgrid.net` (SendGrid Inbound Parse into Foundmill) and DMARC `v=DMARC1; p=none;`. "Finish setup" runs it again.
- Settings › Integrations, under "Send from your own domain": "Get a domain" looks a name up and shows the price as an Estimate.
- Register opens a dialog that says the founder is the owner, asks for their details, shows Tucows' registration agreement to accept, and names the 15-day verification email. A registered domain shows its records, its paid-until date and "Forward mail to my inbox", and has no Remove.
- The api audits each press (`integrations.domain_registered` with the price and the agreement acceptance, `domain_setup`, `domain_forwarding_on` and `_off`).

## Decisions
### OpenSRS's owner contact is the registrant of record
The plan asked for OpenSRS's own words before any Path A code. Its .CA policy page says "the registrant contact (known as the Owner contact in OpenSRS)" (support.opensrs.com article 201000063505), and `sw_register` takes a `contact_set` of owner, admin, billing and tech (domains.opensrs.guide `sw_register`). So the founder fills owner, admin and billing.

### A live registration is refused until the founder can pay for it
The founder's answer is that a domain is paid through Foundmill's Stripe. No domain checkout exists yet, and registering live would spend the reseller balance with nothing charged. So the gateway and the api refuse a live `register` with a plain sentence. Quote and setup run live.

`canRegister` is true only where the mock may run (development, test, a sample business). The next step is a domain checkout whose paid webhook calls `register`.

### Forwarding is recorded now, delivered in the next change
The opt-in is the founder's own click in Settings, recorded per founder (their sign-in email at delivery time, never stored). Receiving mail at a registered domain needs a SendGrid Inbound Parse host per domain and ingest resolving the project by domain; forwarding needs a send from ingest through the gateway. Both are the next change on this branch.

### Security review (no blockers; fixed or noted)
- A domain registered on the mocks is never set up on the live vendors (`domain_simulated`).
- The XCP parser builds objects with no prototype, caps nesting at 20 and the sender drops control characters; OpenSRS calls time out after 30 seconds.
- Settings says whose inbox gets the copy (`forwardingMine`); turning it on moves it to the founder who pressed. The delivery must check the person is still a founder before each copy.
- Check-then-register is not atomic. Harmless while a live registration is refused; the domain checkout registers from its paid webhook, idempotent on the checkout.

### WHOIS privacy left off
`f_whois_privacy` is not set: whether OpenSRS charges for it on every ending is unverified, and ICANN's redaction already hides most registrant data. Raised for the founder.

### The zone is Foundmill's whole zone
On a registered domain Foundmill writes the full record set (`set_dns_zone`), with no apex A record: the site answers at `www` once sites serves custom hosts (Path B's note).

## Not done
- The domain checkout and paid registration (above); renewal and the low-balance alert.
- Receiving at a registered domain (the Inbound Parse host, ingest) and delivering forwards.
- "Move my domain away" (the auth code) and the 15-day verification reminders in the product.
- The complaints inbox the plan names, as one config value.
