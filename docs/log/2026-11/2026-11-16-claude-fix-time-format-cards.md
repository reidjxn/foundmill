---
date: 2026-11-16
branch: claude/fix-time-format-cards
title: Settings › Preferences, the time-format cards no longer clip after 10 PM
areas: [dugout]
supersedes: []
---
## What changed
- `DateFormatPicker`: the Time format row lays out its two cards in two columns instead of three.

## Decisions
- The cause:
  - The cards show the current moment, and from 10 PM to 12:59 AM the hour has two digits ("Nov 16, 2026, 10:12 PM").
  - That made the 12-hour card's example 4 px wider than a third of the row at 1280 and 1440 px with comfortable text.
  - `no-clip.spec.ts` failed in those hours on every pull request (#255, shard 3).
- Two columns fit the row's two choices, so the cards get half the row instead of a third. The Date format row keeps three columns for its three choices.
- A smaller font or wrapping the example would have hidden the moment the person picks by, so neither was used.

## Not done
- Nothing.
