---
date: 2026-11-19
branch: claude/landing-number-redirect
title: A numbered landing link shows only the domain in the address bar
areas: [web]
supersedes: []
---
## What changed
A signed-out visitor who opens `foundmill.com/1` to `/20` (from an ad or a reel) is now redirected to `foundmill.com`.
The redirect carries the `fm_lp` cookie that proxy.ts already set for a numbered page, and `/` serves the page from
that cookie, so the visitor sees the chosen page while the address bar shows only the domain (founder, Nov 19, 2026).
A signed-in person still sees the page in place, because `/` sends them to their project.

## Decisions
### The link's query is dropped
`?via=` is already kept in its cookie on the redirect, and nothing on the site reads `utm_*` today, so the redirect goes
to a bare `/`. Keeping the query would also let `utm_source` pick a channel's page over the numbered one at `/`.
A code comment marks the limit: an ad pixel added later needs `gclid` and `fbclid` kept on the redirect.

### Sharing gives the default page
A visitor who copies the address shares `foundmill.com`, so a friend gets the default page unless their own link names
one.

## Not done
- The web typecheck ran out of memory on the laptop; CI runs it. The unit tests and eslint for the two files pass.
