---
date: 2026-11-15
branch: claude/wp01-t2-alert-nightly
title: A red main opens an issue; a nightly lane exists
areas: [ci, scripts]
supersedes: []
---
## What changed
**WP-01 T2: a red main opens an issue; a nightly lane exists** (branch `claude/wp01-t2-alert-nightly`, stacked on T4). `.github/workflows/ci-alert.yml` opens or
comments on one issue labeled `ci-red-main` when CI on main fails or times out; `.github/workflows/nightly.yml` runs at 03:17 UTC, calls
`scripts/check-production.mjs` once WP-02 writes it, and opens or comments on an issue labeled `nightly-red` on failure. `scripts/open-or-update-issue.sh` was
run against a stub `gh` for both paths; the workflows themselves run only once on main.

## Decisions
None beyond the pull request.

## Not done
See the pull request's "Not verified" section.
