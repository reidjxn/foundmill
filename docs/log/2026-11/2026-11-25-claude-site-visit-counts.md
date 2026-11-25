---
date: 2026-11-25
branch: claude/site-visit-counts
title: Foundmill Sites count their visits too
areas: [db, sites, api, modules, orchestrator, journey, shared]
supersedes: []
---
## What changed
The founder answered both questions from the page visit counts change (#431) on Nov 25, 2026, relayed in their words:
- Asked "the visit count replaces your Nov 13 'visits stay private' rule for the project's own founders only. Is that right?", the founder answered "Yes".
- Asked "visits are not counted on the optional static Sites; that needs a security review. Do you want it?", the founder answered "Yes I want it, they should be counted".

So a project's Foundmill Site (`<slug>.<SITES_DOMAIN>`, apps/sites) now counts its visits the same way the public page does.

- Migration 0176 adds `surface` (`page` or `site`) to `page_visit_days`, and the key becomes (business, day, surface, source).
- 0176 also adds `site_visit(label, source)`, a security definer function. It is apps/sites' one write: one visit for today (UTC) to the live site with that slug. Only `sites_reader` and the service role may execute it.
- apps/sites counts on a 200 HTML response of a live site, without waiting for the write. `siteVisitCounts` decides; `SITE_VISIT_MAX_PER_MINUTE` caps each site per process.
- The source bucket function moved from the api to packages/journey (`page-visit-source.ts`), so the api and apps/sites share it.
- Product › Site shows the Site's own counts, labeled Estimate, with the same block as the public page (`PageVisits.tsx`). `site.get` returns them under RLS.
- The team's brief has one more line for a live Site: "Site visits (Estimate, …)".

## Decisions
### The function is as narrow as it can be
`site_visit` returns nothing and takes no business id. It counts only:
- a live site's slug, never a preview, a draft or a taken-down site;
- a site whose live release is servable;
- a real project (`real_businesses`), never a sample;
- a source from the list. Any other source counts nothing.

It can only add one. `sites_reader` still reads no table, `page_visit_days` included. That is tested as the login in `rls/sites.test.ts` and in apps/sites `db.test.ts`.

### What a Site counts, and why it is still an Estimate
Sites run no scripts and set no cookies, so the count is made on the server when the page is served.

It counts only:
- a GET (not HEAD) of an HTML page with status 200;
- from a user agent that is not empty and not on the bot list;
- that is not a prefetch or prerender, and not a fetch for something other than a document;
- that does not come from another page of the same site. A visit is an arrival, not a page view.

These still count:
- the project's own people, since a site cannot tell who is looking (the Site tab says so);
- bots that pose as a browser;
- one person arriving twice.

The HTML is cached for 60 seconds (`liveCacheHeaders`), so a reload within a minute often never reaches the server. Hence "Estimate".

### Privacy
Nothing about the visitor is stored or logged. The referrer and query only pick the bucket, and the failure log has the error's name only. The per-minute cap is keyed by the site's label, not by an address, so no IP address is kept even in memory.

### The cap is per process and per site
At most 600 counts a minute per site per process. The memory is bounded by the sites seen in one minute, and the map is cleared each minute. `shortcut`: per replica, so more replicas allow more. A shared limiter (Redis, as in the api) would fix that, if Sites ever run on many replicas.

### No Playwright run for the Site tab
The Playwright stack runs with `SITES_DOMAIN` unset, and `e2e/site.spec.ts` asserts that no Site tab exists. The tab is covered by `packages/modules` `site.test.tsx` and the api by `site.test.ts`, as WP-07 already does until T10.

### The security review, and what changed after it
The security-reviewer agent found no P1 issues.

One P2: a referrer with no web address (`android-app://…` from the Gmail app, `about:blank`) made a live Site answer 500, because `originOf` returns the string "null" for it. Fixed: the referrer's host is read inside a try, and the count is wrapped so it can never fail a page. A test covers those referrers.

The P3 issues:
- A slow database could queue count writes ahead of page reads. Fixed: at most 20 writes in flight per process (`SITE_VISIT_MAX_IN_FLIGHT`); past that, counts are dropped.
- A database outage could flood the log. Fixed: failures are logged once a minute as a number.
- apps/sites/CLAUDE.md now lists every function the login may run.
- Kept as is: the `sites_reader` credential can add any number of visits. That is accepted for an estimate, and the credential is already secret.

### Deploy order
Run 0176 before the api and apps/sites roll out. After it, the old key (business, day, source) is gone, so an api still on the old upsert target fails its count quietly until it updates.

## Not done
- A per-day view for the team; the brief has totals and sources.
