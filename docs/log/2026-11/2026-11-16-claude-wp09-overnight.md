---
date: 2026-11-16
branch: claude/wp09-zero-credits
title: The overnight shift runs every third night at $0.45 (WP-09 T12, founder D7 option B)
areas: [shared, db, web, api]
supersedes: []
---
## What changed
- New Autopilot cadence `every_3_days` ("Every third day"): it runs at the founder's chosen hour. The first run is
  the next one; each later run is two days after the next one. Migration 0139 widens the cadence check.
  `isHourlyScheduledCadence` shows the hour picker for both `daily` and this cadence.
- `OVERNIGHT_SHIFT.cadence` is now `every_3_days` and `ownSpendCeilingMinor` 45: three nights' cap in one night
  (founder, Nov 16), enough for one finished session (about $0.14 on Sonnet, measured Nov 15). About $4.50 a month,
  an Estimate, as before.
- The Commit screen and the Autopilot hint now say "every third night" instead of "each night / news every morning".

## Decisions
- The floor (`MIN_SESSION_CAP_MINOR`, 10 cents) stays until the report has a production run (T1 step 6).
- Projects that already have the daily overnight preset keep it. New projects get the new cadence at commit. No
  migration rewrites a founder's settings.

## Not done
- MIN_SESSION_CAP_MINOR and the cap per night wait for the cost report run on production (T1 step 6) and the founder.
