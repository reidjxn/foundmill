---
date: 2026-11-15
branch: claude/wp02-t12-production-record
title: One production record, and a script that checks it
areas: [docs, scripts, ci]
supersedes: []
---
## What changed
docs/DEPLOY.md §6 is now the production record: one table between `production-record` markers (Area, Expected,
State on Nov 15, 2026, Check), seeded from WP-00 §1 and from public reads of production this afternoon. The Oct 2026
staging table moved unchanged to "History: staging status, Oct 2026" at the end; the Nov 15 connector log stays in §6.
`scripts/check-production.mjs` (Node, no dependencies) reads the table and runs each check id with public GETs and
HEADs only (10 s, no credentials, user agent `foundmill-production-check`). It prints ok, differs or manual, and exits
1 on a difference or an unknown check id. Its `node --test` file joins the CI self-tests. WP-00's header says a step's
"record" now means changing its row.

## Decisions
- The first run against production: eight checked rows, seven ok. Platform mail differs because the api deployed at
  6 PM UTC predates T7's `platformMail` field. The Expected cell stays at T7's value, so the check turns ok once it
  deploys.
- Each check reads its expectation from the Expected cell (`key: "value"` pairs, or a keyword such as `noindex`), so
  changing a fact means editing one cell.
- The stream host is checked with api and ingest. Composer has no public host (§3), so that row names the three.
- Supabase's Data API answers 401 at the gateway, not the 503 the plan expected. The row is manual, and its state says
  what was seen.

## Not done
- The nightly workflow does not call the script yet (WP-01 decides how a failure alerts).
