---
date: 2026-11-23
branch: claude/wp05-t0-block-reasons
title: WP-05 T0, why sessions block, measured on production
areas: [docs]
---
## What changed
The Desktop session ran WP-05's measurement queries 1 to 3 against production, read-only, through the Supabase connector. The three result tables are in docs/holistic-plan/audits/e0-production-evidence.md under "Blocked sessions by reason, Nov 23, 2026". T0 is marked done in WP-05.

## Decisions
### No new task
The rule was to add a task for any cause behind more than 15% of blocks that no WP-05 task covers. The largest cause is "acceptance tests failed": 55 of 304 blocks (18%). T9 covers it. The next is the E2B sandbox timeout error: 23 (7.6%), and none after Oct 14. So the task order stands.

### The check value differs by five
The plan expected query 1 without the date filter to return blocked 215, done 81, failed 23. Today it returns blocked 220. Done and failed are the same, so the five extra rows are sessions that blocked after Nov 15, not a query error.

### Query 3 text is cleaned
Terminal color codes and line breaks inside the agents' block text are removed in the e0 table so that it renders. Nothing else in the text is changed.

## Not done
No code change, and STATUS.md is not edited. Query 2's "dependency" group (149 sessions) is not broken down further than query 3.
