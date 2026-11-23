---
date: 2026-11-22
branch: claude/youthful-dirac-n0j80h
title: Booking writes take a per-project slot lock, so overlapping visitors get "slot taken" instead of a deadlock
areas: [db, booking, tests]
supersedes: []
---
## What changed
- `packages/db/src/repos/booking.ts`: `hold`, `confirm` and `reschedule` take one transaction-scoped advisory lock per project (`lockSlots`, key `hashtext('fm.booking_slots'), hashtext(business_id)`) before they write. `confirm` now runs in its own transaction (a savepoint inside the api's) so the lock has one to live in.
- The cause: Postgres checks an exclusion constraint after it has added the new index entry. Two overlapping writes in flight at once can each find the other's uncommitted row and wait on the other's transaction, and the deadlock detector kills one with `40P01 deadlock detected ... while checking exclusion constraint` (CI runs 45035664820 and 45038774187).
- Only `23P01` was caught, so a visitor got an error. A unique index does not do this; an exclusion constraint does.
- With the lock the writers take turns, the second one sees the first's committed row and gets `23P01` (null, "slot taken"). `bookings_no_overlap` still decides; nothing reads before the write.
- `packages/db/src/__tests__/rls/site-address-holds.test.ts`: the "at most 2 holds" test moves the project's earlier holds back one second before each rename. PGlite's `now()` moves in whole milliseconds, so quick renames shared `released_at` and the trigger's `id desc` tie-break (a random uuid) chose which hold survived (main at d8268669 got `loop-2, loop-4`).
- The assertion and the trigger are unchanged.
- Evidence, real Postgres 16 with `scripts/ci/supabase-like.sql`, four test processes at once: before the fix the unchanged race test deadlocked in 1 of 32 runs and a 50-round copy in 2 of 16; after it the unchanged test passed 60 of 60 and the 50-round copy 60 of 60 (3,000 rounds), each with exactly one winner, and the reschedule race passed every time.
- The 50-round copy was a scratch file and is not committed.

## Decisions
### Which writes take the lock
Only writes that put a row into the constraint's partial index can deadlock this way: an insert (`hold`), or an update that changes an indexed or predicate column (`confirm` changes `status`, `reschedule` changes `busy`).

`cancel`, `markNoShow` and `releaseHold` move a row out of the index or delete it, so they never check the constraint and take no lock. `markTest` runs inside the api's confirm transaction, after `confirm` has taken the lock. No seed writes bookings.

### Lock order
The api's confirm transaction takes the customer lock (`customerEntity`) and then the slot lock; nothing takes them the other way round.

The api's confirm and reschedule transactions take the audit lock after the slot lock; no path holds the audit lock and then asks for the slot lock. So the lock adds no new cycle.

### The site-address test, not the trigger
On real Postgres `now()` has microseconds and each rename is its own transaction, so two renames never share a time. A tie needs two renames of one site inside one transaction, which no code does. So this is test determinism only, and the brief said no migration and no trigger change.

## Not done
- Updates that change `reminder_sent_at` (`claimReminder`, `releaseReminder`; it is in the predicate of `bookings_reminder_due_idx`, so the update cannot be HOT) or that happen to go non-HOT (`setCalendarEvent`) also add an entry to the constraint's index and could, in theory, deadlock with an overlapping hold arriving at the same moment.
- They take no lock here: not reproduced, and they take a booking id without the project. Listed in the pull request under "Found, not fixed".
- CI runs Postgres 17 (pgvector image); this session had no Docker and ran Postgres 16.
