---
date: 2026-11-15
branch: claude/wp02-t8-shell-vocabulary
title: One vocabulary in the shell
areas: [shared, dugout, web, widgets]
supersedes: []
---
## What changed
What a first-timer reads in the shell with Builder view off now uses one vocabulary: a round of work (not a cycle),
the team (not the orchestrator), Needs you (not the Inbox as a place), a project (not a business). This covers the
plan's table: the processing strip, the Inbox empty text and refresh hint, Continue's caveat, cost line, pause toasts
and aria label, the Autopilot note, the reading pane's toast, the first-week checklist, Today's Needs you list, the
email answer page, the stopped-Autopilot notice, the Needs you page title, the project switcher and command palette,
the sample marker and the example note, and the "Give agents names and faces" switch.
New helpers in packages/shared founder-words.ts: `roundWords(builder)` and `ventureNoun(hadFirstSale?)`. The
processing strip and the shell's status line use `roundWords`, so Builder view keeps "No cycle running" and
"on cycle 3". docs/DESIGN.md §10 gains the four-row "Engine word → founder word" table.

## Decisions
- Fixed sentences change for everyone. Only the strip's sentence, which is built from a flag and a number, switches
  with Builder view. Plumbing a flag into every constant would have added props for no founder-visible gain.
- Left alone, beyond the plan's own list: the reading pane's "Holds Continue" chip (the table names only Today's), the
  /new page title "Create a new business", the foundations status "Open the Inbox" button, and the names-and-faces
  toast text. None of them are in the table.
- The Needs you title comes from the `tab` query parameter, which BusinessTitle now reads.

## Not done
- Playwright specs were updated to the new strings but not run locally; CI runs them.
