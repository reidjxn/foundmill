---
date: 2026-11-19
branch: claude/clever-faraday-sg90zg
title: The streak shows only the days opened (WP-10 decision 6)
areas: [shared, web, dugout, docs]
---

## What changed

- The founder answered WP-10 decision 6 on Nov 19, 2026: the streak shows only the days opened, with no "Not opened" days and no at-risk line.
- `StreakStrip` already drew only the days opened (WP-04 T7), and its story, unit test and the Playwright specs (`return-loop.spec.ts`, `today.spec.ts`, `phone-today.spec.ts`) already assert that. They are unchanged apart from a comment citing the answer.
- `streakWords` (packages/shared `streak.ts`) loses its at-risk branch ("Open your business today to make it N days."), so the words that feed the strip cannot produce it. `streakStripProps` no longer overrides `atRisk`. The `streakWords` test now expects the ordinary line for a streak that reached yesterday.
- docs/DESIGN.md (Today line) and WP-10's audit table now cite the Nov 19 answer and say it is built.

## Decisions

### Keep `atRisk` on the `Streak` data
`dailyStreak` still returns `atRisk`, because `today.streak` is an API answer the mobile app reads and the api test asserts it. Only the words are gone; nothing on Today reads the flag.

## Not done

- The morning brief's streak line in `apps/gateway/src/notify-email.ts` ("Open Today to make it N") is not Today and not this session's files. It is a nudge in an email rather than a grade on a screen; whether it stays is for the founder or the brief's owner.
