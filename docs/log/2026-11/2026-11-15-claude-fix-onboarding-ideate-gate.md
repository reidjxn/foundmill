---
date: 2026-11-15
branch: claude/fix-onboarding-ideate-gate
title: The onboarding gate test waits for a business's first open before it leaves
areas: [web, e2e]
supersedes: []
---
## What changed
`apps/web/e2e/onboarding.spec.ts` (AC-11.1.1) now waits for network idle after Northwind's Home shows the app shell,
before it opens /new/ideate, the same wait `openBusiness` in e2e/helpers.ts already makes.

Why it failed on CI shard 1 (#166, #168, #175 and main): the CI traces show /new/ideate answered after 8.1 s with
"Can't reach the server" ("The server took too long to answer"), so `prompt-box` never rendered. The first open of a
business starts work in the browser: the time zone claim with goal.ensure, the Chief of Staff batch, and Today's
journey.ribbon batch with nine dev.tasks.list calls and goal.ensure again. The test left the page as those were sent. The
api keeps running a batch after its client leaves: locally an aborted batch still answered 200 after a full second. On
the test stack PGlite runs inside the api's one Node thread, so /new/ideate's server reads (`founder.profile.get` and the
layout's reads) queued behind that work, past the 8 s `SERVER_LIMITS`. A profile read sent just behind an aborted batch
waited 1.9 s locally while its handler took 5 ms. Production runs on a Postgres pool and does not queue this way.

## Decisions
- Fixed the test, not the app. The product renders the unreachable page by design when the api does not answer in
  8 s, and the stall comes from the single-threaded test database. The assertion on `prompt-box` is unchanged.
- The retries were left as they are. A retry meets a saved profile, because no api call removes a founder profile.
  Adding a test-only delete only to reset retries was more than this fix needs. With the race gone, the first attempt
  passes.

## Not done
- Did not reproduce the 8 s stall locally. It passed on a single core with CPU contention, and with the navigation
  forced right after Today's batch was sent: the local api answered the studio's read first. The cause rests on the CI
  traces and on the local measurements above.
- Did not find which merge made this frequent. The first failure is on Nov 14 (run 43627896467), after the Next.js
  16.4.3 upgrade (#133). That timing is not proof of cause.
- The api still runs a batch whose client has left. The transaction gate's `signal` cannot stop it on PGlite, because
  the close event waits for the busy thread. That is a separate change if it matters beyond the test stack.
