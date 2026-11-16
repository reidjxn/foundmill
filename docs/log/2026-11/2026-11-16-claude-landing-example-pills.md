---
date: 2026-11-16
branch: claude/landing-example-pills
title: The hero's example pills fit on one line on a desktop
areas: [web, landing]
supersedes: []
---
## What changed
- `ExampleIdeas`: smaller pills (12 px label, 16 px logo, tighter padding and gaps), 28 px tall from 1280 px and 44 px tap targets below; Northwind Skincare's pill says "Northwind" (the card keeps the full name).
- Measured on a production build: the four pills take 366 px of the hero's 380 px example column, one line from 768 px up (1024, 1280, 1366, 1440); two rows at 390 px. axe clean at 390 and 1280 px; first-timer and proof specs pass.

## Decisions
### "Northwind" on the pill
At 12 px the full "Northwind Skincare" alone pushed the four past 380 px; the short name fits and the card under the pills still names the business in full.

## Not done
On a 390 px phone the pills wrap to two rows, as asked only for desktop.
