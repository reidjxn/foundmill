---
date: 2026-11-24
branch: claude/hopeful-lovelace-b3bi14
title: Add any website - the team can work in a site the founder types, after an automatic terms check
areas: [connectors, gateway, api, db, dugout, web]
supersedes: []
---
## What changed
The founder's decision (Nov 24, 2026: "isn't the idea that they could figure out basically any website?"): the hosted browser is no longer limited to the static site list.

- **Settings › Integrations › "Add a website the team can work in"** has an "Add any website" field and starter chips (`BrowserAddSite`, dugout).
  - The founder types an address. Foundmill builds the site entry from it: one exact https host, and the sign-in hosts found on its home page (same registrable domain only).
  - The sandbox egress is limited to those hosts (`browserEgress`, unchanged).
- **A terms check before the first connect** (`apps/gateway/src/site-check.ts`, `POST /v1/browser/check-site`, api only).
  - Order: the address, the never list (before any request), the platform-wide cache, then the web: the home page, a terms link or a common path, the terms page.
  - A Haiku call on the existing `classifier` route classifies the terms, booked to the business that asked (`kind: site_terms_check`).
  - The terms text reaches the model as data in an untrusted envelope. Only a typed verdict comes back: `forbids`, `unclear` or `allows`, plus a quote of at most 300 characters.
  - `forbids` is refused with the reason and the quoted line. `unclear` shows the honest "has not confirmed" line and connects only after the founder's own yes. `allows` is open.
- **Always refused, before any fetch:** social networks and payment accounts, added to `NEVER_SITES` beside every existing category.
  - Social: LinkedIn, Instagram, Facebook, Threads, X, TikTok, Pinterest, Snapchat, Reddit, YouTube, Messenger. They moved out of `terms_forbid` into a new `social_network` category.
  - Payment: PayPal, Venmo, Cash App, Wise, Revolut, Stripe, Square, Payoneer, Klarna, Affirm, Zelle.
- **Starter list:** Etsy, Amazon Seller Central, eBay, Gumroad, Alibaba (supplier side) and Google Business Profile.
  - Shown only when the fresh check is not `forbids`; a site not checked yet is not shown.
  - An administrator opening Settings checks the missing ones once (`browser.refreshStarters`). Shopify is never in the list.
- **Storage:** migration 0174 `site_terms_checks`.
  - One row per host for the whole platform, fresh for 30 days, service role only (no `business_id`, RLS on, no policy).
  - A simulated (mock) row is never read as a live answer, and the reverse.
- **Five fixed places** (`browser_web_1` to `browser_web_5`, `WEB_SLOTS`).
  - A typed website lives in its place's integration `config` (`{ siteKey, address, check }`). The slot connector rebuilds the site from it on every call (`webSiteFromConfig`).
  - A running session keeps the site it was opened on, so `stepHints` classifies by it. Sessions stay keyed by project and `web_<n>`.
- **The api** (`services/web-sites.ts`): `browser.checkSite` (settings administration, `modelLimited("siteCheck")`), `browser.starters`, `browser.refreshStarters`.
  - `integrations.connect` for a place rebuilds the site from the cache and the address alone. Whatever else the client sends about the site is dropped.
  - A forbidden, never or unchecked site is refused. An unconfirmed one needs `acceptUnconfirmed`. A place that holds another website refuses.

## Decisions
### Five fixed places, not a connector per host
Connector keys are static (registry, grants, the integrations unique key), so the typed site goes in the integration's config and a place is a generic browser connector.
Limit: five at once. Raise `WEB_SLOTS` (one key in the grants table and the catalogue each) when a plan or a founder needs more.
Agents learn the site from the first page read (`site`, `url`); the tool descriptions say "the website".

### The site is rebuilt on every use, never trusted from storage or the client
`buildWebSite` is the one place a site entry is made. The api uses it to show the founder, the connector at connect, and every call from config.
A config that no longer builds (a host later added to the never list) fails the call with a plain message.

### A quote is shown only if it is in the fetched text
A "forbids" or "allows" with no quote found in the text is answered "unclear" with no line. This favors asking the founder over a refusal or an opening that rests on words the page does not hold.
A page can still write a sentence that reads as permission. The hard stops, founder-only approvals and the never list do not depend on the verdict.

### Sign-in hosts come from the home page's sign-in links
Only hosts on the same registrable domain are kept, at most five. Where the terms cannot be found, the site is `unclear` and the founder decides.
Shortcut: the registrable domain is the last two labels, or three under common two-level suffixes. Upgrade to a public-suffix list when a site needs it.

### The existing `classifier` route, not a new one
No new model id or route was needed: it is a Haiku route with a plain token budget.
The check is metered like the quarantined reader: the business's own key when it has one, else the platform's gated client.

### Mock mode answers from the host's name
A host containing "forbid" answers `forbids`, "allow" answers `allows`, anything else `unclear`. The rows are marked simulated. The mock never reaches the web or a model.

### Security review fixes (Nov 24, 2026)
- **Never categories.** The model also returns a `category` from the home page. Anything but "other" makes the site a never site before it is cached (`site_terms_checks.never_category`).
  - `NEVER_SITES` now names the big US, UK and EU banks and card issuers, brokerages and exchanges, Google and Amazon payment pages, more password managers and more social sites. The government rule catches `.gov`, `.gouv`, `.gob` and `.govt`.
  - A category that cannot be determined (the model fails) is shown as unclear and not kept; a home page with no readable text is refused.
- **Reading cost.** Links come from the first 256 KB (500 at most) and the page text from one `indexOf` pass; a 2 MB page of unclosed tags is read in under 200 ms.
- **What the model reads.** The text around words like bots, scraping, automation and agents, from the whole terms page. A short page with none (a legal index) has its terms links followed once, on the same site. With nothing relevant the answer is never "allows".
- **Links and hops.** Every redirect hop and terms link passes the never list. Terms links stay on the typed site's registrable domain. A home page that lands on another host answers unclear.
- **The site's words.** The founder reads a fixed sentence (`STATE_LINE`); the site's own line appears only as a labeled quote.
- **Shared hosting.** A short explicit list (`SHARED_HOSTING_SUFFIXES`, a shortcut: upgrade to the public suffix list) gives such a site no sibling or sign-in hosts. Sign-in hosts never include the bare registrable domain and get no `*.` egress.
- **Frozen at connect, no longer.** A session about to open re-reads the cached check; a forbidden or never site gets no session and shows in Settings as "No longer allowed" with Disconnect.
- **Smaller items.** The cache key is `(host, simulated)`. One constant (`WEB_CHECK_KEY`) decides mock or live for the check, the re-check and the api's connect. `browser.refreshStarters` and `acceptUnconfirmed` are audited. The browser routes take a body limit.

## Not done
- The live terms check was not run against a real site or a real model: the gateway tests use a fake web and a fake model. Run it once on staging with the starter list.
- The starter hosts are the likeliest admin addresses, not confirmed with real accounts. Each connect still needs the founder's own sign-in.
- The tool descriptions do not name the connected site; an agent reads it from the first page.
- `docs/ARCHITECTURE.md` and the BUILD plan were not changed.
