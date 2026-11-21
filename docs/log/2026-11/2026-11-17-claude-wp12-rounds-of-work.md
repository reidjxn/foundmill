---
date: 2026-11-17
branch: claude/wp12-rounds-of-work
title: The product says "round of work" wherever a person reads "cycle"
areas: [web, api, orchestrator, agents, shared, docs]
supersedes: []
---
## What changed
Founder, Nov 17: "rounds of work" across the product. Every string a person reads that said "cycle" or "cycles" now says "round of work" or "rounds of work": the Continue button and tooltips, Autopilot settings, Inbox notes, the away report, the live feed, landing and example copy, agent prompts and templates, and the glossary term.
The glossary entry keeps its key `cycle` but its word is "Round of work", and its short line no longer defines the word by itself ("A stretch where the team works for a while, then reports back in the Inbox").
Plurals read "N round(s) of work". The Builder view says the same words; it differs only in that it shows the round's number.
The jargon filter and the plan-failure parser accept "round of work N" and "This round of work's plan" as well as the old forms.
The mobile voice and backend skills agree: the number is Builder-only, the word "cycle" stays in code.

## Decisions
### Identifiers stay
Event types (`cycle.started`), router names (`cycle.status`), table and column names, SQL aliases, workflow ids, file names and log keys keep "cycle". A graph cycle ("Edge would create a cycle") is not a round of work and is unchanged.
### CLAUDE.md is untouched
"Never turn the cycle into a continuous stream" is a rule about the engine; it stays.

## Not done
- Operator-only output (metrics report, Temporal logs) still says cycles.
- Third-party skills under `.claude/skills/` use "cycle" in their own sense and are not changed.
