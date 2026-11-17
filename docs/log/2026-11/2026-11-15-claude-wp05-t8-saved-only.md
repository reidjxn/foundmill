---
date: 2026-11-15
branch: claude/wp05-t8-saved-only
title: A code task with nowhere to push ends done, saved only, and a refused send counts as not connected
areas: [orchestrator, events, modules, api, web]
supersedes: []
---
## What changed
- WP-05 T8 (founder decision D3). In `finishSession` (apps/orchestrator session.ts), a code task that would wait in
  `review` ends `done` with no merge when the project has no repository or pushing is off (`writeEnabled` false). Its
  `task.completed` carries the new field `landed: "saved_only"` (packages/events, nullable, default null). The tasks
  after it can start. A session held for a look at the test setup (`result.review`) still waits in review.
- `pendingMerges` (merge.ts) skips a completion with `landed: "saved_only"`, even once a repository is connected:
  that branch was never pushed.
- `dev.prs.list` (apps/api) marks a merge-queue row `landed: "saved_only"` when the task's latest completion says so.
- The screens. Environments' `no_artifact` state now reads "Saved, not live anywhere", with the line "The work is kept
  with this task. It goes live once the project has a place to publish." as the pill's tooltip and in the panel footer.
  The counts read "N saved, not live anywhere". The builder's Merged table uses the same words. With Builder view off,
  What changed lists saved-only changes in their own "Saved, not live anywhere" panel, never under "Gone live".
- The T6 eval gap. The SessionRecorder's `trackOutside` now counts a gateway deny as not connected when every policy id
  on it is `platform-mail-off`, `platform-mail-unconfigured` or `platform-mail-simulated` (`NOT_SWITCHED_ON_POLICY_IDS`,
  the ids of `platformMailSwitchRefusal`). So an email task whose every send was refused because sending is not
  switched on ends blocked `not_connected`, not done. Other denies (`untrusted-recipient`, `platform-mail-daily-cap`,
  `platform-mail-suppressed`, spend caps) are not counted.
- Tests: session-live (no repository, pushing off, push-enabled, the refused sends both ways), merge (`pendingMerges`
  after a repository is connected), dev-prs, the module tests, and team-development.spec.ts reads the new words.

## Decisions
- Northwind has a mock GitHub row, so none of its seeded tasks is saved only. Rather than change the seed, the
  Playwright case marks the first merge-queue row of the real `dev.prs.list` answer `saved_only` (`page.route`) and
  checks that Environments reads "Saved, not live anywhere" with the line.
- The spec named only modules files for the views. A task still marked saved after a repository is connected needs a
  fact for each task, so `dev.prs.list` carries `landed` from the latest `task.completed`. That is a small api change.
- The dependents check is in the orchestrator test (`repos.tasks.dispatchable` after the finish). The packages/db
  dispatchable test already covers `done` releasing dependents, so it is run unchanged.
- `platform-mail-paused` and `platform-mail-own-sender` are left out of the not-connected list. The founder paused
  sending, or the project's own sender should be used. Both are choices, not a switch that is off.
  `connectionRefusal` already answers `integration_not_connected`, which was counted before.
- An existing test expected a code task with no repository to wait in review. It now expects done.

## Not done
- With Builder view off, a done task with no repository and no `landed` field (older rows, the Northwind seed) still
  reads "Put live" under Gone live. Environments reads those rows as saved. That mismatch was there before this change.
- Bringing saved work into a repository connected later is WP-07's.
