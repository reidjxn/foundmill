---
date: 2026-11-17
branch: claude/wp08-t3-follower-updates
title: The plan for email and a site at a founder's own domain, and the founder's answers
areas: [docs, gateway, connectors]
supersedes: []
---
## What changed
- No code. This entry keeps the plan for a project's own domain and the founder's answers (Nov 17, 2026), so the build that follows the Stripe work starts from it. It rides in WP-08 T3's pull request and has no push of its own.
- Order (founder, Nov 17, 2026): all the Stripe work first, then domains. Path B (a domain the founder already owns, size M) comes first; Path A (a domain registered through Foundmill on OpenSRS, size L) follows once Foundmill's billing is live and the reseller account exists. Nothing is built before the coordinating session says Stripe is done.

### Today in the code
- Mail goes from the project's Foundmill address `<local>@mail.foundmill.com` on Foundmill's SendGrid: 50 a project a day, a 2,000 deployment ceiling, signed custom args, the unsubscribe link and the postal address. Replies land at `/mail/inbound` and are kept in Customers (T2). T3 adds the consent rule and the agreed-address hash.
- A founder's own SendGrid or Resend, connected with their own key, replaces the Foundmill address entirely (the own-sender rule).
- The `domains` connector checks availability over RDAP only and registers nothing. The `cloudflare_dns` connector, on the founder's own token, lists zones, edits records and checks SPF, DKIM and DMARC; agents cannot delete NS, MX, CAA or TXT records.
- No table records a project's own domain. A Sites (WP-07) address is `<slug>.foundmill.app`. Settings › Integrations is desktop only.

### Path B: a domain the founder already owns (first, size M)
- One table, `project_domains` (business_id, domain, sendgrid_domain_id, status, checked_at), with RLS and a cross-tenant test; its migration number comes from the coordinating session.
- "Send from your own domain": the founder types the domain, the gateway calls SendGrid `POST /v3/whitelabel/domains` (automatic security, on a subdomain such as `em.<domain>`), and the panel shows the CNAME records SendGrid returns with copy buttons. "Check now" calls SendGrid's validate endpoint and says, line by line, which records are found and which are missing.
- The founder's MX is never touched, so mail they already receive keeps working. From is `name@theirdomain`; Reply-To stays the project's Foundmill address, so replies are still kept in Customers and can be answered (T2).
- Every guard stays: the caps, the unsubscribe link, the postal address, the consent rule (T10 and T3's hash), suppression.
- With Cloudflare DNS connected and the zone theirs, "Add these records for me" adds only the CNAMEs, through the gateway, after an Ask in augmented and assisted mode (+S).
- SendGrid allows 3,000 authenticated domains per user, with no per-domain fee documented. One shared account means one sender reputation; a subuser per busy project is the later mitigation.

### Path A: a domain registered through Foundmill, on OpenSRS (after Stripe, size L)
OpenSRS, from its own documentation:
- XML over HTTPS (live `rr-n1-tor.opensrs.net:55443`, test `horizon.opensrs.net:55443`), signed with the reseller username and an API key. The live API needs the caller's IP on an allowlist, so only the gateway calls it, from Railway's static outbound IPs (that they stay stable across a region move is unverified).
- Transfer away: possible after 60 days; the owner contact approves by emailed link, and silence counts as approval after 5 days. The auth code comes from `get domain` (type `domain_auth_info`) or `send_authcode_domain`. A change of registrant brings ICANN's 60-day trade lock, which a reseller may let owners opt out of (`modify_trade_lock_setting`).
- Registrant verification on registration, transfer and any change of name or email: 15 days, with reminders on days 1, 5, 10 and 13; unverified, the domain goes on ClientHold and the site and mail stop until they click.
- Expiry (gTLDs): 40 days of grace (nameservers move to OpenSRS's expired page after 3 days), 30 days of redemption, then possibly an auction. Auto-renew needs funds in the reseller balance.
- Abuse: OpenSRS may suspend a domain on a report, the reseller carries user support and answers for its users, and Tucows may suspend reseller access at its discretion. An older email AUP bills the reseller at least $500 per spam complaint (unverified as current).
- Mail forwards cost $0.02 per address a month. Verisign's .com wholesale is $10.26, rising to $10.97 on Nov 1, 2026; OpenSRS's own price list is behind the reseller panel (unverified).

The design:
- Registering is a purchase, an acceptance of Tucows' registrant agreement and a use of the founder's identity, so it is always the founder's own press with the terms shown, never an agent's. Agents may suggest names and check availability.
- The founder is the owner contact and can move the domain away after 60 days ("Move my domain away" in Settings shows the auth code).
- Paid through Foundmill's Stripe, renewed yearly; Foundmill's reseller balance pays OpenSRS, with a float and an alert when it runs low. A failed renewal is retried, the founder is told, and the screen says plainly that the site and mail stop once the nameservers move on day 3 of grace.
- Set up automatically: the SendGrid CNAMEs, the Sites record, MX to OpenSRS forwarding (name@ forwards to the founder's own inbox after their opt-in click) and DMARC `p=none`. A Sites custom domain needs its own certificate (Railway's per-service limit is unverified). OpenSRS's DNS-zone API is read before building.
- Abuse limits: one domain per project, Commit's name screen, registrant verification, and a complaints inbox.

Sources: support.opensrs.com articles 201000063132, 201000063409, 201000063315, 201000063393, 201000063050 and 201000063410; domains.opensrs.guide/docs/overview; opensrs.com/contract; opensrs.com/email/overview; twilio.com/docs/sendgrid/api-reference/domain-authentication; openprovider.com/blog/best-domain-registrars (the third-party .com price).

## Decisions
### The founder's answers (Nov 17, 2026)
1. A domain needs a payment method, not the $5 plan. A domain is a pass-through purchase, not agent work, so "plans differ by agent work only" holds and there is no second plan exception.
2. Replies to mail from a founder's own domain come back through the Foundmill address and stay in Customers.
3. A flat price per ending, shown before the press, at cost plus about $3 (Estimate).
4. The owner is always the end user. In the founder's words: "It should always be our end user. We should always ensure the end user who registers the domain is listed as the owner of the domain with their contact details, that's why we're using opensrs not cloudflare for this". So in Path A:
   - the person who registers is the owner contact and registrant of record, with their own name, address, email and phone;
   - Foundmill is never the owner contact;
   - a test asserts the registration request carries the founder's contact and never a Foundmill default.
5. Forwarding only, no mailboxes.

### Complaints come to an inbox that passes them on
OpenSRS's agreement makes the reseller the first point of contact for complaints, so Foundmill needs an inbox that receives them and passes them to the domain's owner. The build designs for that inbox as one config value; who reads it is the founder's decision, raised with them by the coordinating session.

## Not done
- Everything: no code until the Stripe work is done.
- Before any Path A code: confirm from OpenSRS's reseller agreement and documentation, in their own words, that the owner contact is the registrant of record, and report the sentence. The documentation read so far does not say it in those words.
- Unverified and to check before building: OpenSRS's price list and sign-up terms, its DNS-zone API, the current email AUP, Railway's static IPs across regions and its custom-domain certificate limits.
- Path A's two things to get right before it ships: the 15-day registrant verification and the complaints path.
