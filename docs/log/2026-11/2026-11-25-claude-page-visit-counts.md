---
date: 2026-11-25
branch: claude/page-visit-counts
title: Foundmill counts visits to every project's public page
areas: [db, api, web, modules, orchestrator, shared]
supersedes: []
---
## What changed
Founder decision (Nov 25, 2026): Foundmill counts visits to every project's public page itself, free on every plan. Reason: the team needs page numbers to see what is working and propose the next change, and today it can read them only through PostHog on the founder's own key, which a first-time founder will not have.

The gap was real. Before this change nothing counted page visits.

The public page's beacon (`components/public/PostVisitBeacon.tsx`, item 8) only stamped the first visit of a shared post's link, and the network decision of Nov 13, 2026 said "visits stay private: nothing anywhere shows a count of them". This founder decision supersedes that rule for the founders' own view. Visitors still see no count anywhere.

- Migration 0175 `page_visit_days`: one row per business, UTC day and source, holding a count. Members read it (the default tenant policy). Only the service connection writes it.
- The table is in the generated cross-tenant suite (`rls/tables.ts`, write mode `service`) and in the export (`page_visit_days`, Product).
- packages/shared `page-visits.ts`: the source buckets and their labels, the bot user-agent check, `summarizePageVisits` (the last 7 and 28 days, by source, per day) and the team's line.
- The beacon on `/p/<slug>` sends the page's slug, the address's query and the referrer, once per tab, page and day, from a browser that does not say it is automated. `publicPage.visited` takes the new optional fields; `services/page-visits.ts` counts one visit with one upsert. The post-link stamping is unchanged.
- Product › Public page shows "N visits in the last 7 days, M in the last 28 days. Estimate", the sources, and one line on how they are counted. It shows once the page is live, or when visits were counted.
- The team: `aboutBusiness` (the "## About" block every session gets) has one more line once the page is live: "Public page visits (Estimate, counted by Foundmill; a visit alone is not an outside result): …, by source: …". So conversion_review, experiments and every other skill read real numbers with no new tool or grant.

## Decisions
### The public page is `/p/<slug>` in apps/web, not apps/sites
The brief named apps/sites, but the page every project gets, and the one Product › Public page manages, is `/p/<slug>` in apps/web. apps/sites serves the optional static Foundmill Sites.

This change counts visits only on `/p/<slug>`. Counting a Site is left for later because the sites login (`sites_reader`) may run only three functions, and apps/sites must stay script-free. A site would need a new security definer function that counts on the server, plus a security review.

### What is filtered, and why the number is labeled Estimate
These are left out:
- Browsers that run no scripts, which covers most crawlers.
- Browsers that report `navigator.webdriver`, or whose user agent matches a short bot list (`PAGE_VISIT_BOT_UA`).
- Signed-in members of the project, checked by the api with the visitor's own token.
- Addresses that are not a published page. Samples have no published page.
- Any address over 30 beacons a minute.

A tab counts a page once a day (`sessionStorage`, not a cookie). These still count: bots that run scripts and pose as a browser, and one person in two tabs or two browsers. So the founder's screen and the team's line both say "Estimate".

### Privacy
- No cookie is set.
- Nothing about the visitor is stored. The referrer and query only pick a source bucket and are dropped.
- The IP address is used only, hashed, as the limiter's key, as for the other public beacons.
- The day is UTC. `shortcut`: a business's local day would need its time zone. Upgrade when the screen shows days.

### Sources
- `post`: a team post's link (`s.<code>`).
- `foundmill`: a `p.`/`u.` link, or a referrer on the app's own host.
- Otherwise the journey's own rules (`parseTouchSource`) map UTM tags and the referrer to search, ai, social, email, paid, referral or direct. `via` is removed first, because that parser would read it as an affiliate code.

### No event, and no change to the north star
A visit writes no event: it is a counter and nothing consumes it. A visit is not a real outcome, and the north star metric is unchanged (`visit.attributed` keeps its rule). Seeds write no visits, and the table holds only counted beacons, so no mock or seeded number can be shown as real.

### The team reads it in the brief, not through a tool
The brief already reaches every session. One line costs a few tokens and needs no grant. A `read_page_traffic` tool on the `page.read` grant would have meant editing agent templates, which a sibling session is changing. The line has totals and sources only. A per-day breakdown for the team can be a tool later.

## Not done
- Counting visits to Foundmill Sites (apps/sites); see above.
- A chart on the screen. Dugout's Sparkline is not exported from the package index, and text is enough for now.
