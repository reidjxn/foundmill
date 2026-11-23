---
date: 2026-11-18
branch: claude/wp06-t13-coding-skills
title: Coding agents start with the smallest-change and terse-notes skills, and a ledger test decides preloading
areas: [agents, db, orchestrator, evals, scripts]
supersedes: []
---
## What changed
WP-06 T13 (founder, Nov 18, 2026). Every role that writes code now comes with two more library skills:
- `smallest_change` ("Smallest complete change"), adapted from ponytail (MIT).
- `terse_working_notes` ("Terse working notes"), adapted from caveman (Apache-2.0 and MIT).

Both are rewritten in Foundmill's words to the authoring spec, credited in `packages/agents/skills/THIRD_PARTY_NOTICES.md`, and pass the same screen as an upload.
The terse skill says in its first section that it is never for anything a person reads, and that founder notes, reports, Needs you items, replies, email, the public page, code, comments, commits and pull request text stay in plain full sentences. A test checks that sentence.

- **Defaults.** Both skills are defaults for the eleven templates with "code" in `taskKinds`, from release 4
  (`default_since: 4`; main took releases 2 and 3 for the tool scout and the CLI-Anything skills first). T6's
  mechanism attaches them at hire and at commit. The boot backfill gives existing coding agents only these two,
  once, and never re-adds one a founder removed. A role that writes no code gets nothing new.
- **Generator.** `scripts/build-skill-library.mjs` reads two optional front matter fields: `default_since` (a whole number, 1 when absent) and `load: always`. The catalog carries `loadAlways: true` on the two new skills only.
- **Preloading.** `selectSkills` takes `preloadAlways`. On a code task, it loads the `loadAlways` bodies first, outside `maxBodies` but within the 24,000-character preload budget. The cached prefix through the Skills index does not change.
- **The test switch.** `SKILLS_PRELOAD` (orchestrator, "off" by default, or "split") and `SKILLS_PRELOAD_FROM` (an ISO date). With "split", `skillsPreloadHalf` puts each business in a stable half by the last hex digit of its id. A code session in the "on" half loads both bodies.
  Every code session in the test, on or off, records `skills_preload` on its token rows: the partial rows `SessionCredits` books as it goes, and the closing row.
- **The verdict.** `repos.metrics.skillsPreloadComparison` averages each half's code sessions on real projects over the window. It reports how many, average input tokens, average output tokens and average cost per code task, counting every token row of a session.
  On the night that closes the seventh day from `SKILLS_PRELOAD_FROM`, the nightly numbers raise one operator note: an error log `{ alert: "skills_preload_verdict" }`, the same path as `first_plan_slow`. It says "keep on" only when both halves ran and the "on" half cost less per code task, otherwise "turn off".
- **Tests.** Agents: library counts, release 4, the coding defaults, the terse skill's full-sentence rule, preload
  on, off and non-code, the char budget, the stable split. Db: the comparison on PGlite, and the backfill to the
  next release. Orchestrator: the prompt with and without the preload, partial rows tagged, the note raised on
  exactly one night, the verdict.
  Evals: a coding hire carries both, and its code task loads both only with the preload on.

## Decisions
### The founder's test, not a live eval (Nov 18, 2026)
The founder replaced the planned live eval with a test on real use. The switch is off by default. When on, it applies to half of coding sessions, split stably by business id and recorded on each session's usage ledger rows as `skills_preload: on|off`. The comparison counts from the day sign-up opens publicly.
Seven days after that, one note goes to the operator with average input, output and total cost per code task for each half, and says "keep on" only if the "on" half is cheaper. It uses the ledger and makes no new paid calls.

### No migration
`usage_ledger.details` is already a JSON column, so `skills_preload` lives there. Input and output tokens come from `agent_sessions`, which keeps them apart. The ledger keeps one total.

### The start date is a setting
Nothing stores the day `SIGNUP_OPEN` was turned on, so the comparison starts at `SKILLS_PRELOAD_FROM`, set on the same day as `SIGNUP_OPEN`. Rows booked before it are recorded and not counted.

### The note uses the existing alert path
The coordinator asked for an existing operator-only path. The nightly platform numbers already raise operator alerts as error logs an alert rule can match (`first_plan_slow`). The verdict uses the same, once, on the night that closes day seven. No mail flow was built.

### Both skills also load as usual
With the switch off, the two skills behave like any other: an index line in every prompt, and the body through `read_skill` when a task calls for it. The note decides whether loading them up front is worth its input tokens.

### Two lines the house-rules screen refused
The first draft's "the code that never had to be written" and "cheaper to write, to review" matched the screen's invention rule ("write" within 20 characters of "review"). Both were reworded, and the screen was not changed.

## Not done
- The verdict needs real use: nothing is measured until `SKILLS_PRELOAD=split` and `SKILLS_PRELOAD_FROM` are set on the day sign-up opens. Both are deploy settings (docs/DEPLOY.md is not changed here).
- `preloadDetail` on the closing token row is a one-line wrapper around the tested `skillsPreloadFor`, and has no test of its own.
- The live default-skills eval from T6 still needs a model key.

## CI fixes (Nov 23)
- `.env.example` now lists `SKILLS_PRELOAD` and `SKILLS_PRELOAD_FROM`, which the env check requires of every variable the
  code reads.
- The library listing test caps the payload without bodies. Two more skills took it from under 60 KiB to 61,742 bytes, so
  the cap is 64 KiB. The bodies still come one at a time.
