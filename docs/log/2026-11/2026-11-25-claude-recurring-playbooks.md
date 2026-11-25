---
date: 2026-11-25
branch: claude/recurring-playbooks
title: Playbooks can run on a schedule, at most once a day, and a run that would not fit the budget is skipped
areas: [shared, models, api, orchestrator, modules, docs]
supersedes: []
---
## What changed
- A playbook's `trigger` is either an event (as before) or a `schedule`: `{ every: "day" | "week" | "month", weekday?, day_of_month?, time: "HH:MM" }` (packages/shared `PlaybookSchedule`). No migration: the schedule rides in `playbooks.compiled`.
- It reads back in US English with US times: "Every Monday at 9:00 AM", "Every day at 5:30 PM", "On the 2nd of every month at 12:15 AM" (`describeSchedule`, `usTime` in playbook-words).
- The founder writes it in words. The mock rule compiler reads "Every Monday at 9am, …", "Every day at 5:30 pm, …", "On the 1st of every month, …" (`detectSchedule`); the model route's param hint names the shape.
- Anything more often than daily ("every hour", "twice a day") gets one kind answer with what is allowed (`PLAYBOOK_TOO_OFTEN_ANSWER`), in the rule compiler and before any model call in `compilePlaybookText`.
- The orchestrator's new `playbook-schedule-sweep` (every 15 minutes) lists due playbooks (`listDueScheduledPlaybooks`, `dueSlot`) and starts each due time once as `playbook:<id>:at:<time>` (abandoned child, `REJECT_DUPLICATE`).
- A scheduled run first calls `playbookRunFits`; one that would not fit writes `team.playbook.skip` to the activity feed and a warning in the Inbox with the reason and how to continue (`playbookRunSkipped`), and runs no step. A run that starts finishes. Event-started runs are unchanged.
- Team › Playbooks' hint names the schedule option. Tests: shared schema and due-time tests, the rule compiler's schedule and too-often cases, `playbookSchedule.test.ts` (due list on PGlite, budget skip, the note, the sweep starting a time once, a skipped and a finished run), and the PlaybooksPanel test.

## Decisions
### Founder decisions (Nov 25, 2026), in the founder's words as given
- A founder may set a playbook that runs on a schedule ("every Monday, do X"). Until now playbooks start only from an event.
- Once a day is the most frequent a playbook may run (this keeps the read, decide, press, wait cycle; never a continuous stream).
- Budget: before each scheduled run starts, check BOTH the project's credit balance and the founder's spend cap. A run that would not fit is skipped and the founder is told in plain words (inbox note); a run already in progress finishes.
  This is the existing rule "never stop a team mid-task because a balance ran out: stop before the task that would not fit" (docs/holistic-plan/WP-14-behavior-brief.md T1). Reuse whatever the event-driven playbooks and Autopilot already use for that check rather than writing a new one.
- Nothing about this may block the founder from doing anything else.

### What this replaces
`packages/shared/src/playbook.test.ts` asserted that a `{ cron: ... }` trigger is not a playbook. `node scripts/decisions-index.mjs playbook` finds no written reason for that beyond the audit AC-07 contract (one trigger shape: an event) and WP-08 T11, which removed agent templates' unused cron schedules because nothing ran them.
A cron string is still refused; the new schedule shape is the only way to write a time, and it cannot express anything more often than daily.

### The schedule shape, not cron
A cron string can say "every minute", so the daily limit would need a parser to enforce it. `every` day, week or month with one time cannot be more frequent by construction, and reads back in words directly. The day of the month stops at 28 so every month has it.

### Time zone
The project's stored time zone, else the time zone of the person who wrote the playbook (their email preferences), else UTC, read when the sweep runs. The schedule stores no zone, so a project that changes its zone moves its playbooks with it.

### One sweep, not one Temporal schedule per playbook
Fifteen-minute sweep in `SCHEDULES`, like the booking reminders, rather than a Temporal Schedule per playbook kept in sync with every edit. A time is due for one hour after it (the same catch-up window as the platform schedules); the per-time workflow id with `REJECT_DUPLICATE` makes the four sweeps that see it start it once. A time before the playbook was created is not due.
Runs are abandoned children, so the sweep never waits on one and nothing holds up the founder.

### The budget check reuses the existing limits
Credits: `creditsState`, the balance a round of work reads before it starts a task (`<= 0` stops it); a business on its own key has none. The monthly model budget: `modelBudgetState`, which dispatch refuses a session on. The founder's spend cap: `businesses.spendCapMinor` against each `set_budget` or `approve_spend` step's `amount_minor`.
Each session a step starts is still bounded by `sessionBudget` as before. The check runs inside the `playbook` workflow only when it carries `scheduledFor`, which runs recorded before this never do, so no `patched()` marker is needed.

### The skip note
A warning from the Chief of Staff that never holds up Continue, with the reason and the next step ("Top up or add your own Anthropic key, and it runs at its next time"; "Raise the cap in Settings › What the team can do, or lower the amount in the playbook"), plus an audit entry `team.playbook.skip` with the time and the reason.

## Not done
- No Playwright run: the screen's only change is the field's hint text; the PlaybooksPanel unit test covers the schedule read-back and the too-often answer.
- The sweep queries each running business's playbooks every 15 minutes (a `shortcut:` comment in `listDueScheduledPlaybooks`); an index on the compiled trigger can come when it grows slow.
- No weekday-only ("every weekday") or several-days-a-week schedule: not asked for.
