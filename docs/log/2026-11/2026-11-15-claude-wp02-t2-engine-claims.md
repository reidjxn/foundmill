---
date: 2026-11-15
branch: claude/wp02-t2-engine-claims
title: The channel engine stops claiming launches on a real project
areas: [shared, orchestrator, api, composer, models, web, evals]
supersedes: []
---
## What changed
`channelEngineMayRun` no longer runs the weekly engine for a channel whose reason is `acts`: its launch step sends
nothing for any channel yet, so on a real project an engine now runs only in offline tracking, for sample projects and
development (`simulated_allowed`), or when availability is unknown. The reconciler starts no engine for an `acts`
channel, and a running one stops with "<Channel> has nothing the weekly engine can send yet; the team works on it
through tasks", ending its campaigns and expiring its approval with T1's event.
The api refuses a launch on an `acts` channel with "The team works on <Channel> through tasks. There is no weekly
campaign to launch yet." and refuses a hand-set `live` on an offline-tracking channel of a real project
(`campaign_nothing_to_send`, 409). Sample projects behave as before.
Offline tracking asks once: when the channel's latest `launch_campaign` approval expired and its campaign never moved,
the engine drafts nothing and asks nothing ("Waiting for you: the materials are on Creative.") until the founder
approves the materials or puts the channel on the board again (`repos.campaigns.lastLaunchApproval`).
Copy: the approval summary reads "<agent> has <Channel> materials ready for you to check" and the Needs you line
"<who> has materials ready for you to check and submit yourself" in offline tracking on a real project.
The Composer gets a note with a narrated offline-tracking `campaign.launched` (`OFFLINE_TRACKING_NOTE`): the materials
are ready for the founder to submit, never "launched". The mock Composer says so too. New eval
`channel_engine.reports_prepared_not_launched` (evals/src/channel-engine-notes.ts): six cases, a deterministic gate on
subject and body.

## Decisions
- The Composer note was needed for the eval to be honest: the mock said "<Channel> is live" for every
  `campaign.launched`, and the live prompt had no way to know the campaign was offline tracking. The event and the
  campaign status `live` stay as they are; new statuses and renamed engine step notes are WP-08.
- The ask-once check is in the `create` step as well as `approve`, so a week waiting on the founder costs no creative
  model call.

## Not done
- Playwright "no Live chip on a real-project fixture": the e2e stack runs `APP_ENV=test`, where every project may show
  mock results by design, so a real project cannot be shown there. The api and orchestrator tests cover it.
- The live eval run: no model key in this session. It runs in `pnpm evals`.
