---
date: 2026-11-18
branch: claude/check-robots-hidden
title: The nightly landing-robots check accepts a hidden robots.txt that disallows everything
areas: [scripts, docs]
supersedes: []
---
## What changed
- `scripts/check-production.mjs`, check `landing-robots`: while sign-up is closed the site counts as hidden when the home page is `noindex` and `/robots.txt` is either a 404 or a 200 whose body disallows everything (`User-Agent: *` followed by `Disallow: /`). Open, it still wants an indexable page and a 200 that does not disallow everything.
- `scripts/check-production.test.mjs`: one test for the 404, the disallow-all 200 and an open 200 that must not pass.
- `docs/DEPLOY.md`, the production table row "Landing indexing": the expected value and the state say what production serves since WP-03 T6 (#245).

## Decisions
### Only the exact disallow-all body counts
A robots.txt that allows pages (the open form) fails the hidden check, so a mistaken open file is still caught.

## Not done
- The next nightly run has not been seen.
