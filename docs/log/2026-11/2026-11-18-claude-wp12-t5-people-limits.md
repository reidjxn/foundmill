---
date: 2026-11-18
branch: claude/wp12-t5-people-limits
title: Every people-side limit is counted in the shared store
areas: [api, config]
supersedes: []
---
## What changed
WP-12 T5. New communities (3 a day), community invitations (50 a day) and post reports (30 an hour) are counted in the shared rate-limit store (`takeCommunity`, `takeCommunityInvite`, `takePostReport` in `live-limits.ts`), so every replica counts together. Messages gain 200 an hour on top of the per-minute and per-thread limits.
`takeLive`, `liveLimiter`, the in-process `LIVE_LIMITS` and `WHAT` are deleted from `services/live.ts`; the seven calls in `routers/live.ts` are gone or replaced. The limits live in `packages/config/src/limits.ts`.
Tests: four cases on one store shared by two callers (4th community, 51st invitation, 31st report, 201st message).

## Decisions
### Posts an hour: 40, not 60
The in-process limit of 40 an hour was the one that bound; the shared one said 60. `livePostsPerUserPerHour` is now 40, so no limit is looser than before. Requests keep the shared 20 an hour, the stricter of the two.
### A refused community name still spends one of the three
The community limit is taken before the screening model call, as before. The existing test now expects two creations after one refused name.
### No migration, no screen change
Nothing in the web app changes; the solo-guard suites pass unchanged.

## Not done
- Nobody is told when a report arrives (T4's follow-up, not this change).
