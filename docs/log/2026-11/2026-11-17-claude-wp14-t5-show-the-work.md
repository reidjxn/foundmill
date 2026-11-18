---
date: 2026-11-17
branch: claude/wp14-t5-show-the-work
title: WP-14 T5, show the work on Today, in the day's digest and in the weekly review
areas: [web, api, shared, dugout, db, gateway, docs]
supersedes: []
---
## What changed
Stacked on `claude/wp14-t4-outcomes-today` (WP-14 T4).

- **Working now on Today.** `today.get` answers `workingNow`: one entry for each agent with a running task, by the task's founder-facing title, oldest work first, six at most. Today draws it with the new `WorkingNowStrip` (packages/dugout) right under the headline, named as the reader names agents, with a link to the Working now tab.
- **Absent otherwise.** With no running task the strip is not drawn. It is empty while the founder has stopped the agents, and null for a reader walled from Development.
- **Effort counts** (`packages/shared/src/effort.ts`): `effortCounts` counts events the services wrote and `effortSentence` says them, "Your team ran 14 quality checks, read 3 sources and finished 5 pieces of work." A zero is left out, and with nothing counted there is no sentence.
- **What is counted:** design checks that looked at real screenshots, sources read and scored, posts drafted, tasks completed, pull requests merged, production deploys. Nothing simulated, no design check that was simulated or never saw the pages, no preview deploy.
- **The day's digest** ("What your team did today", `digestBody`, written in `packages/db/src/repos/inbox.ts`) opens with the effort sentence for the business's day.
- **The steps behind a result.** Under the digest's notes, a finished piece of work that took two minutes or more shows its steps from its own last progress record: "“Booking form” took 12 minutes: 4 of 4 plan steps, 6 of 6 checks passed, reviewed." Three at most, longest first; a result with no recorded step shows none.
- **The weekly review and the morning brief** (`morningBrief`, the gateway's `briefExtrasFor`): the effort sentence follows "Behind the scenes", for a reader of Development, over the brief's own window.
- **Tests:** shared `effort.test.ts`, `morning-brief.test.ts`; db `inbox-note-budget.test.ts` asserts the digest's counts against the events on record; gateway `notify-email.test.ts`; api `today.test.ts`; dugout `WorkingNowStrip.test.tsx` and its story; `e2e/today.spec.ts` (the strip on a business with work in hand, absent on a new project).

## Decisions
### The day's digest and the weekly round-up, as they are in the code now
WP-14 names `DayDigest.tsx` and `packages/journey/src/roundup.ts`. `DayDigest.tsx` is the Journey's card for one day and already shows hours and tasks; `roundup.ts` is the volume rule that rolls wins into a daily results table. Neither is the report a founder reads about the team's day or week.

Those are the Chief of Staff's "What your team did today" (WP-04 T8) and the weekly review email, so the effort went there. Both named files are unchanged.

### No "drafts set aside"
The brief's example counts drafts set aside. Nothing records the team setting a draft aside (only the founder's "Not this one" on a post), so that count does not exist and is not shown. It can be added when a record exists.

### "Quality checks" are design checks
The one check the platform records as its own event is the design check of a UI change. Acceptance tests are shown as "checks passed" in the steps behind a result, not added to this count, so one number is one kind of record.

### The brief leaves finished tasks to its own line
"Behind the scenes" already says rounds and tasks done from the cycle records. The effort sentence in the brief leaves tasks out so the email never says one number twice from two sources.

### One line an agent, and no fallback line
An agent with two running tasks shows the older one. When a round is running but no task is in hand at that moment the strip is absent: "This week and next" already says the team is working, and a made-up "planning" line would not come from a record.

### Two minutes is the floor for showing steps
`RESULT_STEPS_MIN_MS`. The brief says "minutes of real work"; under two minutes the steps add nothing.

## Not done
- The digest is only written in a project's first week (the note budget of WP-04 T8). After that, effort reaches the founder through the brief and the weekly review.
- The steps behind a result are in the digest only, not on the task's own note or in the email.
- The Journey's day card (`DayDigest.tsx`) is unchanged.
