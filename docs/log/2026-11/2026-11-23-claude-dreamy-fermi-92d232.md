---
date: 2026-11-23
branch: claude/dreamy-fermi-92d232
title: The chapter report test ignores link ids; the production check accepts the waitlist's robots.txt
areas: [composer, scripts, ci]
supersedes: []
---
## What changed
Main's checks of Nov 23, 2026 (`e9898112`) failed twice. Neither was a product regression.

- `apps/composer/src/__tests__/chapter-report.test.ts` (CI run 45204293488, "Unit (services)"): the check that no simulated amount reached the page matched `777` anywhere in the body. The body links agents as `[[ent:<uuid>|Name]]`, and a random uuid can hold "777". Locally, 1 run in 12 failed, on `[[ent:142ef8c4-…-9adb58cd777b|Ines Park]]`.
- The check now runs on the body with the link ids removed. It still fails on "Simulated Co", "made-up", "simulated result", the amount 777 and any "$" in the words. 15 of 15 runs pass.
- `scripts/check-production.mjs` (Nightly production check, "Landing indexing"): live robots.txt opens `/waitlist$`, `/_next/static/` and `/opengraph-image.png` before `Disallow: /`. That is the founder's choice (WP-14 T15, founder 2026-11-17; `apps/web/app/robots.ts`), and the old check read it as not hidden.
- `closedButWaitlist` now accepts one `*` group whose only Disallow is `/` and whose Allows are only those three paths. Sitemap lines are allowed. It fails on any other Allow, any other Disallow, a `/waitlist` without `$`, a second user-agent group or an unknown directive.
- `scripts/check-production.test.mjs` covers each of those cases. The waitlist case fails on the old check, and the live file passes the new one.

## Decisions
### The test is fixed, not the composer
The chapter report links entities by id, as the house rules require. The test asked a question about the words (no amount of money is on the page) and answered it on the ids too. Stripping only the id inside each link keeps every word and the link's display name under the check.

### The allowed paths are listed in the script, not imported
`check-production.mjs` is plain Node and does not load the web app's TypeScript. The three paths are copied from `apps/web/app/robots.ts`, with a comment naming it. If that file opens another path before sign-up, the nightly fails until someone adds the path here on purpose.

## Not done
The Nov 23 "Outcome evals (live, nightly)" and "Go-to-market evals (nightly, live)" runs also failed. They were outside this request and were not investigated here.
