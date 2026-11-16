---
date: 2026-11-15
branch: claude/wp03-t9-store-links
title: One value for the native app's store links, and the Get the app prompt
areas: [config, dugout, web]
supersedes: []
---
## What changed
WP-03 T9. `packages/config/src/app-links.ts`: `parseStoreLinks(raw)` and `type StoreLinks = { ios; android }`. The
one value is `NEXT_PUBLIC_STORE_LINKS`: the App Store and Google Play addresses separated by a comma, in either
order, unset until the app launches. `apps/web/lib/env.ts`: `PublicEnv.storeLinks`, parsed from it; `.env.example`
lists it. `packages/dugout/src/components/public/GetTheApp.tsx` (server-safe, with a story at 390 px and a test):
renders nothing without links, otherwise "Get the app for iPhone" and "Get the app for Android", each 44 px tall.
`DesktopOnly.tsx` gains one comment naming where the signed-in small-screen redirect goes at launch.

## Decisions
- Only `https://apps.apple.com/…` and `https://play.google.com/…` with a path are accepted. If any part of the value
  is wrong (another host, `http`, a user name, two links to one store, three parts), the whole value reads as
  unset: a wrong value shows no prompt rather than a link to the wrong place.
- `GetTheApp` takes the parsed links as a prop and reads no environment itself: the design system holds no
  configuration, and the web passes `publicEnv().storeLinks`.
- The links are plain anchors styled like the milestone card's link (`btn-secondary`, `min-h-tap`), because
  `Button` is a client component and the prompt must render on the server. The icon is Lucide's `Smartphone`: no
  store's own mark.
- No fallback in `next.config.ts`: like `NEXT_PUBLIC_TURNSTILE_SITE_KEY`, an unset value already reads as empty.
- `plan-change` was run: `claude/blissful-fermat-q03yq1` changes seven files under `components/public/` and none of
  `GetTheApp.tsx`, `components/public.ts` (the barrel this task adds one line to) or `clientBoundaries.test.ts`. No
  other open branch touches these files.

## Not done
- The two readers the spec names. `apps/web/components/providers/ContinueLater.tsx` does not exist yet (it is T3's);
  T3 renders `<GetTheApp links={publicEnv().storeLinks} />` first among the wall's controls. The landing footer
  under 640 px (`apps/web/components/landing/LandingPage.tsx`) is left for the landing session, which owns that file;
  it renders the same element. Until both land, setting the value shows the prompt nowhere.
- The redirect of a signed-in small screen to the store at launch: a comment in `DesktopOnly.tsx`, nothing built.
- WP-12 (public pages) and WP-10 (phone shell) pass the same links where they need them.
