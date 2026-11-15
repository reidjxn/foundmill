---
date: 2026-11-15
branch: claude/wp01-t6-log-files
title: The two logs are frozen; entries go in docs/log
areas: [docs, scripts, ci]
supersedes: []
---
## What changed
`docs/DECISIONS.md` and `docs/PROGRESS.md` are frozen (their banners landed just before). CI's static and banned-terms
jobs refuse a pull request that edits either. Each change adds one file under `docs/log/` (`docs/log/README.md`, skill
`log-entry`). `node scripts/decisions-index.mjs <words>` reads the frozen DECISIONS.md and then every file here;
`--since` and `--area` narrow to this folder. Tests: `scripts/decisions-index.test.mjs` (a fixture entry is indexed,
filtered and rendered by path) and `scripts/log-entries.test.mjs` (every entry's front matter, file name, sections and
line length).

## Decisions
### Instructions changed with the freeze
CLAUDE.md, the `plan-change` and `verify-done` skills, ARCHITECTURE §16, the agent pack and the holistic plan's README now point at docs/log; the product's own agents write their record in their final report instead of in any docs file (the platform puts it in the pull request).

## Not done
Open branches of other sessions that still edit the two files get a one-line note to move their lines here.
