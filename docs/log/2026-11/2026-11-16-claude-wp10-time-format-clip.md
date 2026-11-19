---
date: 2026-11-16
branch: claude/wp10-time-format-clip
title: The 12-hour example fits at any time, and no-clip no longer depends on the clock
areas: [dugout, web]
supersedes: []
---
## What changed
A regression from #246 (WP-10 T5), reported by the landing session through the plan-execution session: with comfortable
text, Settings › Preferences' "12-hour" card overflowed (`time-format-12h`, 209 < 213 px, "10:06 PM"). The cards show
the current time, so `no-clip.spec.ts` failed only on runs between 10 and 12, AM or PM, UTC.

- `DateFormatPicker`: an example line may now wrap inside its card (`break-words` in place of `whitespace-nowrap`),
  and `exampleLine` puts a no-break space before AM or PM so "12:59 PM" stays whole. `DateFormat.test.tsx` checks the
  widest time, 12:59 PM.
- `no-clip.spec.ts`: Settings › Preferences is measured in its own tab at the same size with `clock.setFixedTime` at
  12:59 PM, so the result never depends on when CI runs. Every other screen keeps the real clock.

## Decisions
- Wrap rather than shrink: DESIGN §2 says rows wrap before anything truncates, and a date beside a time is two words a
  reader can take on two lines.
- The fixed clock applies to the one screen whose content is the clock, so seeded data elsewhere is not read against a
  frozen day.

## Not done
- Nothing else in the picker changed.
