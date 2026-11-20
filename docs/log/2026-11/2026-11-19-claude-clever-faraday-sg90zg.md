---
date: 2026-11-19
branch: claude/clever-faraday-sg90zg
title: The streak shows only the days opened (WP-10 decision 6)
areas: [shared, web, dugout, gateway, docs]
---

## What changed

- The founder answered WP-10 decision 6 on Nov 19, 2026: the streak shows only the days opened, with no "Not opened" days and no at-risk line.
- `StreakStrip` already drew only the days opened (WP-04 T7), and its story, unit test and the Playwright specs (`return-loop.spec.ts`, `today.spec.ts`, `phone-today.spec.ts`) already assert that. They are unchanged apart from a comment citing the answer.
- `streakWords` (packages/shared `streak.ts`) loses its at-risk branch ("Open your business today to make it N days."), so the words that feed the strip cannot produce it. `streakStripProps` no longer overrides `atRisk`. The `streakWords` test now expects the ordinary line for a streak that reached yesterday.
- The morning and weekly emails lose their streak line ("You are on a 4-day streak. Open Today to make it 5." and "You have opened X N days in a row."), by the founder's answer relayed by the coordinator on Nov 20, 2026, to match the Today streak. `streakBlocks` and the `streak` context field leave `packages/shared/src/notify-words.ts`, and the gateway's `streakOf` reads leave `apps/gateway/src/notify-email.ts`. The `notify-words` test now checks the brief has no streak line.
- docs/DESIGN.md (Today line) and WP-10's audit table now cite the Nov 19 answer and say it is built.

## Decisions

### Keep `atRisk` on the `Streak` data
`dailyStreak` still returns `atRisk`, because `today.streak` is an API answer the mobile app reads and the api test asserts it. Only the words are gone; nothing on Today reads the flag.

### Drop the whole email line, not only its nudge
The founder's answer was to drop the email's streak line. The brief now has no streak sentence at all, so the gateway no longer reads visit days and vacations for each brief.

## Not done

- Nothing left from this answer.
