---
date: 2026-11-16
branch: claude/wp08-t7-page-seo
title: The founder's answers to WP-08's decisions D1 to D6
areas: [docs]
supersedes: []
---
## What changed
- Nothing in code: this entry records the founder's answers so the WP-08 tasks build to them.

## Decisions
The founder answered on Nov 16, 2026 (relayed by the session "Foundmill build status and blockers"): yes to every
recommendation at the end of `docs/holistic-plan/WP-08-go-to-market.md`. They are answers, not changeable defaults.
Recorded here because docs/DECISIONS.md is frozen.

- **D1.** A post counts toward the north star only when the founder said "I posted it" and a first visit came back
  through that post's own link (`REAL_OUTCOME_POST_RULE = "visited"`, WP-08 T4).
- **D2.** Follower email carries the footer line "Written with help from AI and checked by ‹founder first name›."
  (WP-08 T3.)
- **D3.** Reply text is stored as plain text, 20,000 characters at most, and deleted with the person's record (WP-08 T2).
- **D4.** A person the founder added by hand can be emailed by an agent only after the founder approves each first
  message, in every mode (WP-08 T10 as written).
- **D5.** A page with under 400 characters of "about" is public and not listed in search until it says more (WP-08 T7,
  `PAGE_LISTED_ABOUT_MIN`).
- **D6.** "Ask a question" shows the project's Foundmill address as a mail link, not a web form (WP-08 T6).

## Not done
- D1 to D4 and D6 are used by WP-08 T2, T3, T4, T6 and T10, which are not built yet.
