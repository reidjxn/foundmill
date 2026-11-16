---
date: 2026-11-16
branch: claude/wp07-t2-sites-tables
title: Site tables, the SITES_DOMAIN switch, the site events and apps/sites (WP-07 T2 and T4)
areas: [db, shared, events, sites, ci, docs]
supersedes: []
---
## The founder's answers this stands on (Nov 16, 2026, session "Foundmill build status and blockers")
docs/DECISIONS.md is frozen, so they are recorded here.
- **D1, go-ahead A: yes.** T2 to T7 may be built now behind the unset `SITES_DOMAIN` switch. Only switching it on waits
  for "pages and email are proven".
- **D2, the domain: foundmill.app**, already bought (docs/DEPLOY.md §6, DNS on Vercel, attached to nothing). Wiring it
  is WP-00 S9, not this change: nothing was set in Railway, Vercel or DNS, and `SITES_DOMAIN` stays unset everywhere.
- **Preview links (asked in #240, answered Nov 16): only the newest 3 previews of a site are served.** Built here
  (`site_resolve`, and `site_report` for preview links; `SITE_LIMITS.previewsServed`). The live release is served by
  its slug whatever its age.
- **D6 (answered Nov 16):** until a review queue exists, the nightly check prints the count of `site.reported` rows and
  the founder reads it (the nightly line itself is T10's, with WP-02's script).
- D4 and D5 are not answered: T7 and T8 build to the package's defaults (buy.stripe.com only; the finance lead, asking
  first).
- D3 is not answered; built to the package's recommendation: the report link shows on every site on every plan (a
  safety control), only the "Built on Foundmill" mark follows `tierShowsBuiltOnMark`.

## What changed
- Migration 0119 (`sites`, `site_releases`, role `sites_reader`, `site_resolve`, `site_file`, `site_report`, the
  collaborator event list with the three site events), schema mirror, `repos.sites`, `rls/sites.test.ts`; both tables
  are exported (`site_releases` without `previewToken`).
- `packages/shared/src/sites.ts`: `SITE_LIMITS`, `SITE_FILE_TYPES`/`siteFileType`, `SITE_RESERVED_SLUGS`,
  `siteSlugProblem`, `siteUrl`, `sitePreviewUrl`, `sitesEnabled`, `sitesDomainProblem`. `SITES_DOMAIN` in `env.ts`
  and `.env.example`.
- Events `site.release_created`, `site.published` (counted by the north star, like `page.published`; the pinned list
  in `catalogue.test.ts` gains it), `site.unpublished`; walls under Product.
- `apps/sites`: `createSitesApp(deps)` (hosts, paths, header set, footer, `/_fm/report`, 404/405/410), boot as
  `sites_reader`, `railway/sites.toml`, the Railway watch and config tests, the CI "services" unit job and image
  check, the copy linters' roots, docs/DEPLOY.md "Foundmill Sites: setup", docs/ARCHITECTURE.md.

## Decisions
- **T2 and T4 in one pull request.** T4 cannot be built without T2's functions and the rules forbid stacking; one
  CI run instead of two (CLAUDE.md, GitHub Actions minutes).
- **`sites_reader` is created in 0119**, not in a second migration: the grants sit beside the functions they grant.
  It is `nologin` until the founder sets a password (DEPLOY step 3).
- **Reports are limited in the database**, not with Redis: `site_report` counts the project's `site.reported` audit
  rows under the audit chain's own lock. The service needs no Redis and the limit holds across replicas. The function
  is a third one beside the two the package named, because `sites_reader` can write no table.
- **`site_resolve` also returns `plan_tier`**, so the mark needs no table read; an unknown tier reads as free (the mark
  shows rather than disappearing by mistake). A taken-down slug answers a row of kind `taken_down` (the server sends
  410); the package said only "nothing".
- **A preview may be framed by the product's own origin** (`frame-ancestors <APP_URL origin>`), because T5's Site
  tab shows previews in frames; a live site keeps `frame-ancestors 'none'`. This departs from T4's header list.
- **Publishing is written by the founder under RLS**: `site_releases_publish` lets an owner or admin stamp only
  `published_by = auth.uid()` and `published_at` on a preview release (no trigger: under the service role there is no
  user to check).
- Collaborators read sites and releases: the site is what the project shows publicly.
- `SITES_DOMAIN` must not be APP_URL's host, a subdomain or a parent of it outside development and test
  (`sites.localhost` beside `localhost` is allowed locally).
- `/about` falls back to `about/index.html`; an ETag is answered with 304 for live non-HTML files.
- **Security review (security-reviewer agent), fixed here:** every security definer function pins
  `search_path = pg_catalog, public, pg_temp` (a temporary table could otherwise shadow `site_releases` for a stolen
  `sites_reader` login; a test proves it fails without the pin); `site_file` serves only a `preview` release of a site
  that is not taken down, and a live site whose release was later held stops resolving; preview links can be reported
  (they can be passed around); the reserved words are in the slug check; errors answer with the header set; every
  footer property is `!important` so site CSS cannot hide it.
- **Review findings left for later, named in the pull request:** markup that swallows the footer (an unclosed comment,
  `<plaintext>`) and `meta refresh` redirects are T5 screening's; a per-visitor report limit (a site can use up its own
  30 a day) needs Redis or Turnstile (T6); `SITES_DOMAIN` is not
  compared by registrable domain (foundmill.app beside foundmill.com is fine); `PUBLIC` keeps execute on older helper
  functions such as `is_public(uuid)` (yes or no answers about a known id); a founder could write their own
  `published_at` only if the Data API were turned back on.
- `scripts/vercel-ignore.sh` exits 1 (build) when the branch's previous deployed commit is gone, as after a force-push;
  git's 128 made Vercel mark the deployment failed on this branch twice.

## Not done
- T3, T5 to T10. Nothing is deployed and `SITES_DOMAIN` is set nowhere (WP-00 S9).
- The `sites_reader` login tests on the real-Postgres lane grant the test connection membership in the role first
  (Postgres 16 gives a role's creator ADMIN but not SET); where even that is refused they skip.
