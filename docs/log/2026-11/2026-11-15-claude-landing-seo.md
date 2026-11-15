---
date: 2026-11-15
branch: claude/landing-seo
pr: 182
title: Search and share for the home page
areas: [web, seo, landing]
supersedes: []
---
## What changed
- `apps/web/components/landing/seo.tsx` `homeMetadata`, exported from `app/page.tsx`: the first-timer's title and description, canonical `/`, Open Graph and a large Twitter card on the home's own image, and `robots` that follows `SIGNUP_OPEN`.
- One JSON-LD block (`HomeJsonLd`): Organization, WebSite and SoftwareApplication with a free Offer; no FAQ, how-to or rating markup; `<` escaped.
- The share image (`app/examples/home-share/route.tsx`, static, 1200 × 630): the wordmark, the headline and "Your first card is free and needs no sign-up."
- Tests: `seo.test.tsx`; Playwright `first-timer.spec.ts` checks the head, the JSON-LD, the image route and the quotable paragraph against a production build.

## Decisions
### Indexing follows SIGNUP_OPEN
Founder, Nov 15: index once sign-up opens, so opening sign-up is the one change.
### The home's share image is its own route under /examples/
A root `opengraph-image` would change the share image of every page without one, outside the landing session's files.
### JSON-LD lives in the page for now
WP-03 T6, which brings a shared `JsonLd` component, has not merged.

## Not done
robots.ts, sitemap.ts, /llms.txt and the 404 rule (WP-03 T6). The share image uses the renderer's default face.
