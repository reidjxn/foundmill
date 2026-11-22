---
date: 2026-11-17
branch: claude/wp11-account-portability
title: Backups, the restore drill and spend limits written down for the founder
areas: [docs]
supersedes: []
---
## What changed
DEPLOY §4 gains two parts, for the founder's session on Nov 18, 2026 after the Stripe setup:
- **Backups and restore** (WP-11 T3, the founder's step F2). It covers what is backed up (Pro, daily, 8 kept,
  point-in-time recovery off, as the founder read it on Nov 17), what is not and why (Redis streams, Temporal's
  Postgres), and retention today. It also gives the drill: restore the newest backup into a new project, run three
  read-only checks there (the migration count, the business count, `audit_log_verify` on three businesses), and delete
  the drill project the same day.
- **Spend limits** (WP-00 S13). It lists where each platform key's vendor takes a monthly limit, plus Railway, Vercel
  and Redis `maxmemory`.

§6 gains the two rows "Restore drill" and "Spend limits", both open, to be filled with the date and the amounts.

## Decisions
- **Folded into #264.** It already edits DEPLOY §4 and is a docs-only change in the same package, so it needs no run of
  its own (coordinator, Nov 17).
- **30 days at most.** Backups, a manual dump and the drill project are kept 30 days at most: the Privacy Policy's
  promise. A failed drill keeps the drill project only until it is understood, never past that.
- **Read-only checks.** The checks run in the drill project's SQL editor, never production's. They change nothing.
- **Founder's choices.** Nothing here picks a plan or an amount for the founder; each is a blank they fill.

## Not done
The drill itself and the amounts: the founder's steps, scheduled for Nov 18, 2026.
