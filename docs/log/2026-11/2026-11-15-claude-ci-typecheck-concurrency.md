---
date: 2026-11-15
branch: claude/ci-typecheck-concurrency
title: The CI typecheck job runs three packages at a time
areas: [ci]
supersedes: []
---
## What changed
The "Typecheck and lint" job in `.github/workflows/ci.yml` now runs turbo with `--concurrency=3` instead of 4. At 4 GB
of heap each, four type checkers at once could take the runner's whole 16 GB. The job was killed for memory (exit 137,
four packages' typecheck reported failed) twice on Nov 15, 2026: run 43743691286 (#167) and run 43752199906 (#178),
both with no type error in their diffs.

## Decisions
- Three at a time rather than a smaller heap: apps/web's tsc already needed more than the 2 GB default (the comment in
  the workflow). The job takes a little longer; it was about 4 to 6 minutes.

## Not done
- No change to the unit or Playwright jobs, which have not run out of memory.
