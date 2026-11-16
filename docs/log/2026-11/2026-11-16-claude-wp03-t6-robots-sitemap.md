---
date: 2026-11-16
branch: claude/wp03-t6-robots-sitemap
title: robots.txt, sitemap.xml, /llms.txt and the 404 rule
areas: [web, seo]
supersedes: []
---
## What changed
- `apps/web/lib/seo.ts`: `indexable()` (production origin and `SIGNUP_OPEN`), the static sitemap paths, `listedPublicPaths()` (the seam), `sitemapEntries()`, the AI training crawler list and the text of `/llms.txt`.
- `app/robots.ts`: open, it allows `/`, keeps `/api/` and `/b/` out, names the sitemap, and has a second group that keeps AI training crawlers off `/p/` and `/u/`. Closed, it disallows everything and names no sitemap.
- `app/sitemap.ts` (hourly): the home page, `/terms` and `/privacy`, no priority or change frequency.
- `app/llms.txt/route.ts`: static plain text. `/llms.txt` joins `PUBLIC_PREFIXES` and the proxy matcher's exclusions.
- The 404 rule in `decideRedirect`: a signed-out address that is no app route reaches Next's 404 instead of a sign-in. App routes still go to sign-in. `app/not-found.tsx` no longer says "business".
- Terms, "People, sharing and public pages": one sentence on training crawlers (D2). Terms date moved to Nov 16, 2026.
- Tests: `app/__tests__/seo.test.ts`, `lib/__tests__/redirects.test.ts`, and `e2e/search-files.spec.ts` against a production build.

## Decisions
### Indexing follows SIGNUP_OPEN, not a new constant
Founder, Nov 15 (landing-seo entry, D1). The plan's `HOME_INDEXED` constant is not used; the home page already reads `SIGNUP_OPEN`. `indexable()` adds the production-origin check so a preview is never open.
### Project pages are not in the sitemap yet
Pull request #244 (WP-08 T7) adds `publicPage.listed` and has not merged. `listedPublicPaths()` returns `[]` and `sitemapEntries()` is tested with a fake source. When #244 merges, one function body changes. The sitemap is the only place a page with under 400 characters of "about" must stay out of.
### No JsonLd component here
The plan lists `components/public/JsonLd.tsx`; #244 creates it. The home page keeps its own block from the landing-seo entry.
### Search and answer crawlers use the general group
Only training tokens are in the named group. OAI-SearchBot, Claude-SearchBot, PerplexityBot and assistants fetching for a person can read `/p/` so listed pages can be cited.
### llms.txt example line
The plan names three home examples that are no longer the home page's. The line now says "The projects shown on the home page and on /tour are examples, not customers", so it stays true.
### Closed sitemap
`sitemap.xml` still lists the three static pages when closed; robots.txt is the gate and names no sitemap then.

### The founder's answers (Nov 16, 2026)
Search and answer bots stay allowed on `/p/` and `/u/`, with only training crawlers blocked. The new Terms sentence and date: "Reviewed and approved". Robots stays closed to everything while sign-up is closed.

### An old end-to-end check changed
`project-story.spec.ts` expected the bare address `/milestones` to ask for a sign-in. It is no route (the screen is `/b/<id>/milestones`), so signed out it now answers 404 under the new rule. The spec now checks both.

## Not done
- `docs/DEPLOY.md` curl lines for WP-00 S7 (step 5), and ticking T6 in the work package file.
- Project pages in the sitemap (waits on #244).
- `Content-Signal` lines (Next's robots helper cannot write them).
