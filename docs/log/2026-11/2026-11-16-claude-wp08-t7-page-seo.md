---
date: 2026-11-16
branch: claude/wp08-t7-page-seo
title: The project page for search engines and AI readers (WP-08 T7)
areas: [shared, db, api, web, agents, modules, evals]
supersedes: []
---
## What changed
- Migration 0119: `project_pages.content_published_at`, set on each publish whose copy differs from what was public
  (backfilled to `published_at`). For a client role the database writes it (0090's guard, one rule added), like the two
  dates of 0090. `public_project_pages` gains the column at its end.
- `pageIsListed` (`packages/shared/src/project-page.ts`): listed when "about" has at least `PAGE_LISTED_ABOUT_MIN = 400`
  characters (an Estimate) and the pitch is more than the name. The public view carries `listed` and `updatedAt`; the
  page sends `robots: { index: listed, follow: true }`. A page that is not listed is still public.
- `projectPageJsonLd` and `storyJsonLd` (`packages/shared/src/page-structured-data.ts`): a `ProfilePage` about a
  `Project` (an idea or being built) or an `Organization` (live), founders only when the page names them, a two-item
  `BreadcrumbList`; the story is a `WebPage` modified at its newest milestone. No offer, rating, review or FAQ markup.
  `apps/web/components/public/JsonLd.tsx` renders one block with "<" escaped.
- `projectPageMarkdown` (`packages/shared/src/page-markdown.ts`), served at `/p/<slug>/index.md` and `/p/<slug>/llms.txt`
  by the key-file route before the key check: `text/markdown`, `x-robots-tag: noindex`, the page as canonical,
  `no-store`; a page that is not public is the same 404. A founder paragraph that would read as a heading, quote or list
  item starts with a backslash.
- Metadata: `openGraph.locale: "en_US"`, `googleBot` `max-image-preview: large` and `max-snippet: -1`,
  `alternates.types["text/markdown"]`.
- `publicPage.listed({ cursor, limit })`: listed pages for the sitemap, paged by address, rate-limited per caller.
- The page prompt's `about` rule gains: "The first sentence names the project and says what it is and who it is for, in
  plain words, so it makes sense when quoted on its own." (version 2). The live page eval checks it.
- Product › Public page says, while a live page is not listed: "Search engines can show this page once it says a little
  more about the project."

## Decisions
- D5, as the founder answered it (Nov 16, 2026; recorded in `2026-11-16-claude-wp08-founder-decisions.md`): a page with
  less than 400 characters of "about" is public and not listed in search until it says more. The number is one constant.
- The first-sentence check runs on the live eval only: the mock page keeps the founder's words as written, which never
  start with the project's name, and the mock belongs to packages/models.
- No `Offer` in the markup: T6 (price and button) is not built.

## Not done
- `apps/web/app/sitemap.ts` does not exist on main (WP-03 owns it): `publicPage.listed` is the read it will call.
- The visible "Updated Nov 12, 2026" `<time>` on the page is left out: it lives in `packages/dugout` `ProjectPage`, which
  `claude/blissful-fermat-q03yq1` edits. `dateModified` carries the date in the markup.
- The Rich Results Test check of `Project` (step 5) needs a preview deployment; not run.
- The task is not ticked in the work package file here, because the T1 pull request edits that file; it is ticked after
  both merge.
