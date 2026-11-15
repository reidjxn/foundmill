---
date: 2026-11-15
branch: claude/adoring-mccarthy-44jiph
title: The onboarding gate test waits out the first Home visit and is safe to retry
areas: [web, e2e, ci]
supersedes: []
---
## What changed
`apps/web/e2e/onboarding.spec.ts` "AC-11.1.1" failed shard 1 on PRs #154, #158 and #161 (Nov 15). Cause, from the trace of run 43733623925: right after the profile was saved the test opened Northwind Home and left at once for /new/ideate. That first owner visit claims the business time zone (`business.setTimeZone`, which rebuilds `journey_daily` for every business) and runs `goal.ensure`.
On PGlite the api runs every query in its own Node process, one at a time, and blocks its event loop while it does (measured: 0 timer ticks during `refresh_journey_daily()`, a concurrent `select 1` waits for it).
With the Home's other first-load queries (still run after the browser aborts them), /new/ideate's server read of `founder.profile.get` passed its 8 s `SERVER_LIMITS` deadline and the page rendered "Can't reach the server", which never turns into `prompt-box`.
The test now waits for network idle after the Home loads (as `openBusiness` in e2e/helpers.ts does) before going to /new/ideate.
Retries: the first attempt writes a marker (`.onboarding-gate-met` in the project's output dir, cleared with test-results each run) once it has seen the dev founder held at /onboarding.
A retry that finds the marker and the dev founder's profile already saved meets the gate with a new account (`signInAs` with a random id; the api's dev bootstrap gives it no profile), saves that profile, then signs back in as the dev founder for the second half. Without the marker a missing gate still fails.
Checked locally against the CI stack (PGlite seed with SEED_OWNER_PROFILE=0, `next start`, api on :4000, E2E_EXPECT_PROFILE_GATE=1): the spec passed 5 of 5 times from a fresh seed, and with a temporary forced failure on attempt 0 after the profile save, retry #1 passed by the fresh-account path.

## Decisions
### Fix the test's pacing, not the api
In production the journey rebuild runs on Postgres and does not block the api, so the stall is a PGlite stack effect. Deferring or skipping the rebuild on PGlite would change product code for a test, so the test waits for the Home's requests to answer, the pattern the other specs already use.
### A fresh account on retry instead of a profile reset endpoint
No dev/test reset of a profile exists, and adding an api route that deletes a profile widens the surface for one test. The dev bootstrap already creates profile-less accounts on PGlite in development and test only, so a retry exercises the same gate on one of those. The marker keeps a gate that never held from passing on a retry.

## Not done
The same run (43739849214) also failed the golden path's "Take charge" step after 1.1 min on shard 1; that is a different test and is not looked at here.
I did not reproduce the 8 s stall itself on this machine (the api's first-visit work took about 0.9 s here); the fix follows the CI trace's timeline.
