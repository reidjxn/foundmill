# apps/sites (`@foundmill/sites`)

Serves Foundmill Sites (docs/holistic-plan/WP-07-foundmill-sites.md): each project's static site at `<slug>.<SITES_DOMAIN>` and release previews at `p-<token>.<SITES_DOMAIN>`, plus the platform's own `/_fm/*` pages (report, the sign-up form). The most exposed process in the product: it serves text agents wrote for strangers.

## Invariants
- **Static only.** It reads release files and answers fixed `/_fm/*` routes. Nothing from a release runs on the server, and the response headers (`src/headers.ts`) forbid scripts in the browser: `default-src 'none'`, no `script-src`. The one exception: the platform's own sign-up page (`/_fm/follow`, T6) may load Cloudflare Turnstile's script, on live sites only.
- **No secrets, no tables.** Its `DATABASE_URL` is the `sites_reader` login (migration 0124), which can execute `site_resolve`, `site_file`, `site_report`, `site_pay_link` (0131) and `site_visit` (0176) and nothing else; it reads no table, and its one write besides a report is adding one visit to a live site's count through `site_visit`. Never give it the service-role string, `SESSION_TOKEN_SECRET`, a vault key or a vendor key. It calls no vendor; it calls the api (`SITES_API_URL`) only for a site's sign-up form (`src/api-client.ts`).
- **No cookies.** No response sets one. A live site is never framed; a preview only by `APP_URL`'s origin (the Site tab).
- **Content type only from `SITE_FILE_TYPES`** (packages/shared `sites.ts`); anything else is 404, including files a release holds.
- **One fixed footer** on every HTML response: "Report this site" on every plan (a safety control), and "Built on Foundmill" only where `tierShowsBuiltOnMark` says so. No project text goes into it.
- Nothing a visitor types reaches a prompt; reports store the reason and their words, never who sent them.
- **Visit counts (0176):** counted on a live site's HTML page only, never awaited (a page never waits on or fails for a count), capped per site a minute and by writes in flight; nothing about the visitor is stored or logged (`siteVisitCounts`, `countVisit` in `src/app.ts`).
- Off while `SITES_DOMAIN` is unset: every site host answers 404.

## Commands
- `pnpm --filter @foundmill/sites typecheck` | `lint` | `test`

## Key files
- `src/app.ts`: `createSitesApp(deps)`, the HTTP surface (pure; tests use fakes and a test database)
- `src/headers.ts`: the header set
- `src/pages.ts`: the platform pages and the footer
- `src/index.ts`: boot (env, `sites_reader` connection, listen)
- Setup: docs/DEPLOY.md "Foundmill Sites: setup"
