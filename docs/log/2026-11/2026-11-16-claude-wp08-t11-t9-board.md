---
date: 2026-11-16
branch: claude/wp08-t11-t9-board
title: No schedule nothing runs, and the Channel Board a real project sees (WP-08 T11, T9)
areas: [agents, shared, modules, web, orchestrator, api, connectors]
supersedes: []
---
## What changed
- T11: no agent template carries a `schedule` any more (the channels' Monday cron and their `triggers`, and the leads'
  and workers' event lists): nothing in the platform reads them. `Schedule` stays optional in `types.ts`, so stored rows
  still parse. The agent profile's "Schedule" row is gone (before: a cron string such as `0 8 * * 1`, "3 triggers" or "On
  demand"; after: nothing). The email channel's playbook line "Plan: map the lifecycle (signup → activation → payment →
  retention) and pick the one flow with the biggest measured gap." becomes "Plan: I draft updates to the people who
  follow the project; the founders send them."
- T9: `channelEngineMayRun` lets a weekly engine run only where simulated results are allowed (sample projects,
  development, tests). Offline tracking no longer starts one for a real project. `CHANNEL_META.print` and `.broadcast`
  are `kitModeByDefault: false`, and the print, broadcast and outdoor templates follow the constant.
- T9: the Board's and the Channels table's list of channels that cannot run is titled "Not now", shown to everyone (it
  was Builder view only) and collapsed behind "Show N channels for later". Each row gives the week-one sentence
  (`CHANNEL_NOT_NOW` in `packages/shared/src/channel-availability.ts`), except where connecting a tool is the founder's
  own step now, which keeps the API's sentence and its "Open Integrations" button.

## Decisions
- WP-02's change (the engine runs only for `simulated_allowed`) already did most of T9 step 1. The one gap was offline
  tracking, so that is the only change to the rule: no new `mockAllowed` argument; `kitMode` stays in the signature
  for the callers and decides nothing.
- Every template schedule is removed, not only the channels': the profile row is gone, so a schedule nothing runs would
  be stored and never shown.
- Lead generation's "Not now" line says "Start with ten people you can reach yourself." without naming "First ten": that
  board (WP-08 T5) is not built yet.

## Not done
- The Board's group "The team works on your page" (SEO, GEO) waits for WP-08 T8, which gives those channels their
  page tools. "You do it, the team prepares it" is the Board as it is today (social by tap); email joins it with T3.
