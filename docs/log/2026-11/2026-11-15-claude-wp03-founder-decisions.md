---
date: 2026-11-15
branch: claude/wp03-founder-decisions
title: The founder's answers to WP-03's eight decisions
areas: [web, api, landing]
supersedes: []
---
## What changed
The founder answered WP-03's "Decisions for the founder" on Nov 15, 2026, in the execution session. Recorded here
because docs/DECISIONS.md is frozen; the work package file points to this entry.

## Decisions
- D1: yes. The home page is indexed once the rewritten landing page and its search work (T5, T6; the landing session's
  #172 and #182) merge: `HOME_INDEXED` flips in a one-line pull request then.
- D2: B. AI training crawlers are allowed on Foundmill's own pages and disallowed on `/p/` and `/u/`; one sentence
  goes in the Terms.
- D3: yes. The idea box allows up to 2 redraws a day per browser, replacing the card in place, inside the existing
  limits (about 5 per address a day, $20 a day). This narrows the Nov 13, 2026 "one card per browser" answer: still one
  card held, now redrawable. T7 step 3 may be built.
- D4: no. Opening sign-up needs T8's guards and WP-09's per-account ceiling; reporting of people, profiles and
  messages (WP-12) becomes the condition for opening `liveMode` instead. This narrows the Nov 11, 2026 answer 4.
- D5: this package builds the referral-ordered waitlist (T10) after T2; the network session is told. This moves item 3
  of "Working beside the other sessions" (Nov 12, 2026) from the network session to WP-03.
- D6: Supabase's bot check is turned on only once the native app sends a token.
- D7: the starting numbers as written, all Estimates: 5 to 10 hand admissions a day now; `SIGNUP_DAILY_CEILING=25` and
  `SIGNUP_PER_DOMAIN_PER_DAY=5` when sign-up opens. WP-09's cost report replaces them.
- D8: keep `/tour` for now, unlinked on phones; delete it if nobody opens it in a month.

## Not done
- Telling the network session about D5 and the landing session about D1, D2 and D8 (said in the pull request).
