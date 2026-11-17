---
date: 2026-11-17
branch: claude/wp03-status-sitemap
title: The holistic plan's status file, rebuilt from the truth
areas: [docs]
supersedes: []
---
## What changed
- `docs/holistic-plan/STATUS.md` is rebuilt for every task of WP-00 to WP-13 (189 rows) from the merged pull requests on main (to #274), the open pull requests, the package files' ticks and the docs/log entries. It also lists the founder's Nov 16 and 17 decisions that changed tasks, and what is unknown.
- `WP-03-the-door.md`: T6 is ticked (it merged as #245).

## Decisions
### "Not started" has a definition
It means no merged or open pull request, log entry or tick names the task. A session that built something locally and wrote nothing down shows as not started; the file says so.
### Matching a pull request to a task uses its title
Pull requests that name tasks in their titles are matched exactly. #208 (Network safety) is WP-12 T4, confirmed by the coordinating session.
### The sitemap follow-up waits
`listedPublicPaths()` is filled only after #244 merges. #244 is still open, so this change ships the status file alone.

## Not done
- Production changes since Nov 15 are listed from the coordinating session's report, not checked.
- The `listedPublicPaths()` follow-up (waits on #244).
