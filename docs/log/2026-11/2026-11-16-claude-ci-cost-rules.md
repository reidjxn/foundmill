---
date: 2026-11-16
branch: claude/ci-cost-rules
title: How every session spends GitHub Actions minutes
areas: [ci, process]
supersedes: []
---
## What changed
CLAUDE.md gains "GitHub Actions minutes (founder, 2026-11-16)": push when ready, no refresh merges of green pull
requests, one re-run of failed jobs only, fewer and non-conflicting pull requests, no hand-dispatched workflows, and
CI runs only what a change can affect (the companion change on `claude/ci-fewer-minutes`).

## Decisions
- Measured on Nov 16, 2026: one full CI run bills about 176 runner minutes; about 40 CI runs in 11 hours (24 on pull
  requests, 16 on pushes to main), roughly 7,000 minutes (Estimate). The founder asked that every session follow these
  rules; CLAUDE.md is where every session reads its rules, and the running sessions were also told directly.

## Not done
- The CI workflow change itself is its own pull request (`claude/ci-fewer-minutes`).
