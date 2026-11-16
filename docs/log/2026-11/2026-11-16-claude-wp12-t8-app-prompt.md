---
date: 2026-11-16
branch: claude/wp12-t8-app-prompt
title: The app prompt on public pages and the universal-link files
areas: [web, docs]
supersedes: []
---
## What changed
WP-12 T8. `PublicAppPrompt` shows the store links (the `GetTheApp` component from WP-03 T9) under a project page, a card and an invitation on a window narrower than 1280 px. With `NEXT_PUBLIC_STORE_LINKS` unset, which it is today, it renders nothing and those pages read as before.
`/.well-known/apple-app-site-association` and `/.well-known/assetlinks.json` answer from `APP_LINKS_IOS_APP_ID`, `APP_LINKS_ANDROID_PACKAGE` and `APP_LINKS_ANDROID_SHA256`, read at request time, and answer 404 while those are unset. `/.well-known/` joins the public prefixes so the proxy does not send them to sign-in.
Tests: `public-app-prompt.test.tsx`, `well-known.test.ts`, the redirects suite, and the public-page, person-page, milestones and invitations specs unchanged. A 404 without a redirect was checked on the dev stack.

## Decisions
### The person page is not mounted yet
Open pull requests #208 and #217 (the network session) both edit `apps/web/app/u/[handle]/page.tsx`. One line there, `<PublicAppPrompt />` inside the page's fragment, follows when they merge.
### `/.well-known/` added to the public prefixes here
WP-03's own change for unknown signed-out addresses had not merged; this adds the one prefix and WP-03's session should keep it.
### The three server variables are scanned by the env-example check
`scripts/env-example.test.mjs` now reads `APP_LINKS_*` in the web app as well as `NEXT_PUBLIC_*`, so they are listed in `.env.example`.
### Fingerprints and ids are checked in shape
A malformed value gives 404, not a broken file.

## Not done
The values: the founder gives the Team ID and the Android signing fingerprint; the Desktop session sets them at launch (docs/DEPLOY.md, "The app prompt and the universal-link files").
