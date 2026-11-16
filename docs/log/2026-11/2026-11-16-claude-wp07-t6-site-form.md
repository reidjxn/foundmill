---
date: 2026-11-16
branch: claude/wp07-t6-site-form
title: A site's sign-up form on the existing follow path (WP-07 T6)
areas: [api, db, sites, shared]
supersedes: []
---
## What changed
- `publicPage.follow` takes `via: "site"`: the target is the live site at that address (`repos.followers.siteTarget`:
  committed, not archived, not a sample, `status = 'live'`), the consent record keeps `source_ref = site:<slug>` and the
  project page's id or null (`RecordFollowerInput.pageId` is nullable, `sourceRef` new), and the bot check expects the
  site's own host on staging and production. Everything else in `followPage` is unchanged: the same limits, the same
  answer, the same confirmation email, `page.followed` only on confirmation (ingest).
- `publicPage.siteConsent({ slug })`: the consent sentence a site's sign-up page shows, the one the record keeps.
- apps/sites: `POST /_fm/follow` shows the platform's own page (the address escaped, `followConsentText` with an
  unticked box, the hidden field, the bot check); `POST /_fm/follow/confirm` calls the api server to server
  (`src/api-client.ts`, the tRPC wire format) and shows "Check your inbox" or the refusal in plain words. 4 KB bodies,
  GET is 405, a preview says "Sign-ups open when the site is published." and never posts onward. Only the address, the
  box, the hidden field and the bot check's token are read: anything else a site's form sends is ignored (the T5
  review's note). Turnstile's script is allowed on this page only, and only with a site key.
- Env `SITES_API_URL`, `SITES_TURNSTILE_SITE_KEY` (apps/sites); docs/DEPLOY.md step 4.

## Decisions
- **The consent sentence comes from the api** (`publicPage.siteConsent`) rather than from `site_resolve`: the
  `sites_reader` login reads no business name, and changing 0119's function would need another migration. One cheap
  public read that answers only for a live site, whose name it shows anyway.
- **A project's page and site share one set of caps** (the per-page hour and day windows are keyed by the page, or by
  the business when the project has no page): one budget per project, whichever form a visitor used.
- **No new form pipeline**, as the package says: the follow path's double opt-in, consent record, limits, bot check
  and CRM lead are reused unchanged.

## Not done
- The starter's form block and the sentence in `siteTaskNote` come with T3, which adds the starter and the note.
- The Playwright steps (submit, confirm, the contact in Customers, the followers count on the tab) are T10's.
- Switched on only after WP-00 S2 (ingest hears SendGrid), and the Turnstile widget must list the sites domain (DEPLOY
  step 5), else every site sign-up fails closed.
- The api sees apps/sites' address, not the visitor's, so the per-caller follow limit counts all site visitors
  together (as the web's Server Action does for the page form).
