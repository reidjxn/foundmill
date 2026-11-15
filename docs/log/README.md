# docs/log: one file per change

Since Nov 15, 2026 (WP-01 T6) every change records what it did and its judgment calls in one file of its own here. `docs/DECISIONS.md` and `docs/PROGRESS.md` are frozen history: CI refuses an edit to either. Two branches never touch the same file, so the log never conflicts.

## The file

`docs/log/YYYY-MM/YYYY-MM-DD-<branch with slashes as dashes>.md`, one per branch; later pushes edit the same file. Lines under 400 characters.

```markdown
---
date: 2026-11-15
branch: claude/wp01-t6-log-files
pr: 156            # optional, added when known
title: The two logs are frozen; entries go in docs/log
areas: [docs, scripts, ci]
supersedes: []     # titles of decisions this one replaces
---
## What changed
Three to ten lines: what the next session can rely on, and the tests that prove it.

## Decisions
### <one heading per judgment call>
What was considered, what was chosen, why.

## Not done
What was left out and where it is tracked.
```

## Three rules

1. One file per branch, named from `git branch --show-current` and the day the branch started.
2. Never edit `docs/DECISIONS.md` or `docs/PROGRESS.md`.
3. Find a decision with `node scripts/decisions-index.mjs <words>`: it reads the frozen files and every file here (`--since <date>`, `--area <word>` narrow it to this folder).

`scripts/log-entries.test.mjs` checks the shape of every file.
