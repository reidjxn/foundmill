---
date: 2026-11-16
branch: claude/wp07-t7-pay-button
title: Pay buttons on a site, with a link the founder pastes (WP-07 T7)
areas: [db, api, sites, modules, connectors, gateway, agents, shared]
supersedes: []
---
## What changed
- Migration `pay_links`: a project's payment links (key, label, optional price, URL, `pasted` or `stripe`, `simulated`,
  archived). Members read; an owner or an admin writes (`fm_tenant_table` with owner and admin; the generated
  cross-tenant suite covers it). An app role may only add a pasted link and archive one: no update of a URL, a key or
  `simulated`, no delete, no `source = 'stripe'`. The URL must `https://buy.stripe.com/<path>` in the database too (Decision D4).
- Function `site_pay_link(label, key)`, executable by `sites_reader`: the URL of a live site's own link, or of the site
  of one of its newest 3 previews; never an archived, simulated, draft-site, taken-down or other business's link.
- `packages/shared/src/pay-links.ts`: `PAY_LINK_HOSTS`, `payLinkUrlProblem` (https, host exactly on the list, no
  sign-in, no port, no query or fragment, ≤ 500 characters, and the text itself in the form the database stores), the
  key rule and a key from a label.
- `payLink.list | add | archive` (apps/api `routers/pay-link.ts`): reading is Product's, writing an owner's or an admin's;
  a sample business is refused; at most 20 links at a time and 100 ever; the key comes from the label (numbered when
  used before); audited.
- apps/sites `GET /_fm/pay/<key>`: a 302 to the stored link with `Referrer-Policy: no-referrer` and `no-store`, on a live
  site and on a preview (so the founder can try the button); anything else is 404, a taken-down site 410. The URL is
  checked again before redirecting.
- Platform tool `list_pay_links` (capability `payments.links.read`, granted to frontend_engineer and docs_writer): each
  link's key, label and price, never the URL, never a simulated link.
- Product › Site gains a "Pay buttons" panel: Dugout's `PayLinkList` (with Storybook stories: empty, with pay buttons,
  with a simulated link, read-only, with an error), wired to the procedures by packages/modules `PayLinksPanel`: the list, a simulated link marked "Simulated link: not
  shown on your site", "Add a payment link" for an owner or an admin, with the help line from the package.

## Decisions
- **The site's HTML never holds the payment URL** (the package's design): a release cannot change where a payment goes.
- **The founder enters a name and the link only.** The price lives on the Stripe page the visitor lands on; the
  procedure takes an optional price for T8 and WP-08, but the panel does not ask for one.
- **A preview's button redirects too**, as the package says; a preview link can be passed around, and it only sends a
  visitor to the founder's own checkout.
- **The panel's look is a Dugout component** (`PayLinkList`), so it has a Storybook story in the one Storybook the repo
  builds; the module keeps only the data wiring.
- **No Playwright case here:** the e2e stack runs with `SITES_DOMAIN` unset, so the Site tab is not reachable; the
  existing `site.spec.ts` case (no Site tab) still holds. "Add a link, the button on the preview redirects" belongs to
  T10's golden path, with `SITES_DOMAIN` set.

- **Security review (security-reviewer agent), fixed here:** an admin could change a live link's URL, fake a team-made
  or simulated link, or delete one on the RLS connection (now only insert a pasted link and archive one); the URL check
  now also tests the stored text, so a capital host, a backslash, `..` or a tab is refused in words, not by the
  database; `site_pay_link` checks the live release as `site_resolve` does; a cap on links ever added. For the address
  hold (its own log entry): only a published address is held, at most 2 per business, a taken-down address for good,
  and a per-address lock between a rename and a claim.
- **Founder's answers (Nov 16, 2026, through the coordinating session):** keep the 30-day hold; no price field next to
  the pasted link; collaborators may see a project's payment links.

## Not done
- **Screening of a direct checkout link in a release** (the review's M3) was added by the other WP-07 session to T5's
  `site-screen.ts` (rule `payment_link`).
- To do at rebase, once T3 and T5 are on main (agreed with the other WP-07 session): add "A pay button is
  `<a href=\"/_fm/pay/<key>\">` for a key that `list_pay_links` returns; never write a payment address into a page." to
  `siteTaskNote` (apps/orchestrator `site-workspace.ts`), and switch T5's `payment_link` screening rule's hard-coded
  hosts to `PAY_LINK_HOSTS` (keeping `checkout.stripe.com`).
- `create_payment_link` (T8) is a separate change, after WP-11's payment powers merge.
