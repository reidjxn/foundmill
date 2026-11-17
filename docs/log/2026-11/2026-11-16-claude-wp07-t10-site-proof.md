---
date: 2026-11-16
branch: claude/wp07-t10-site-proof
title: The proof: two site tasks to a published site to a sign-up (WP-07 T10)
areas: [orchestrator, api, sites, scripts, docs]
supersedes: []
---
## What changed
- `apps/orchestrator/src/__tests__/site-golden-path.test.ts`, the package's "Done when" 1 in one process on mock integrations
  with SITES_DOMAIN set and no repository:
  - two site tasks finish (each session's save against the site base and its end, as `session.ts` calls them);
  - release 2 holds both tasks' files;
  - "Publish it" in Needs you publishes it, with `site.published` and `deploy.succeeded` in the outbox;
  - apps/sites, on the same database, answers the address with the page, the header set and the footer;
  - a visitor signs up through the site's form (the platform's consent page, then `publicPage.follow` over the api's
    HTTP surface): one pending consent with `source_ref = site:<slug>` and one confirmation email asked for.
- `scripts/check-production.mjs`: check `sites-headers` (`--sites <canary address>`, `--preview <preview address>`):
  200, the site's CSP, no cookie, a preview's `noindex`; skipped while no address is given (SITES_DOMAIN unset). A row
  in docs/DEPLOY.md §6's production record.
- apps/orchestrator gains `@foundmill/api`, `@foundmill/sites` and `drizzle-orm` as dev dependencies (test only).

## Decisions
- **The proof runs in one process, not in Playwright.** The Playwright stack runs the api and the web app on one PGlite
  database, with no orchestrator, gateway, ingest or sites service, so no code session can finish and no site can be
  served there. The in-process test calls the same functions those services call. `apps/web/e2e/site.spec.ts` keeps
  "Done when" 4 (nothing mentions a site while SITES_DOMAIN is unset).
- **Confirmation is ingest's:** the visitor's click on the email link is covered by `apps/ingest`
  `follow-confirm.test.ts`, which writes `page.followed` with a null `pageId` as it does for a site.
- **The test lives in apps/orchestrator, not apps/api.** A dev dependency of the api on the orchestrator would make
  CI count every orchestrator change as reaching a screen and run all of Playwright for it
  (`scripts/ci-affected.test.mjs` caught it). The orchestrator depending on the api costs only its own unit tests.

## Not done
- "Done when" 2 (the pay button) is T7's, in the second WP-07 session.
- "Done when" 3 is production: after the founder's switch (`SITES_DOMAIN=foundmill.app`, WP-00 S9), one real project
  publishing and a stranger's confirmed sign-up; `node scripts/check-production.mjs --only sites-headers --sites …`
  checks the canary.
- No Playwright stage with SITES_DOMAIN set (it would need the stack to run the orchestrator and the sites service).
