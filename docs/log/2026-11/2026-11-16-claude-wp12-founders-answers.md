---
date: 2026-11-16
branch: claude/wp12-t1-page-catch-up
title: The founder's answers to WP-12's decisions, and two of WP-10's
areas: [docs]
supersedes: []
---
## What changed
The founder answered the decisions of WP-12 (docs/holistic-plan/WP-12-people-side-gaps.md) on Nov 16, 2026, relayed by the build-status session: yes to every recommendation in the table. This entry records them, since docs/DECISIONS.md is frozen. It also records two answers to WP-10's decisions.

## Decisions
### D1: a founder may see that someone arrived through their page
One private line with a count ("3 people arrived through your page"), nothing about who. T3 builds it; `FLAGS.referralLine` may be on.
### D2: the people layer stays closed until T6's five conditions hold
T6 writes the test, the DEPLOY section and the record.
### D3: the operator is the founder's own Foundmill account; the response target is two days
In the founder's words: "reports should go to my Foundmill account on Foundmill". Setting `OPERATOR_USER_IDS` in Railway is still to be done by the founder or the Desktop session.
### D4: remove `apps/social` (T9)
### D5: the mobile session is finished
Its branch may be merged and the pack updated (T7), stopping if the branch has more commits than the task says.
### D6: the page note may email each founder whose page T1 drafts
`PAGE_CATCH_UP_EMAIL` defaults on; `off` keeps the note without an email.

## WP-10's decisions (nobody is building WP-10 yet)
### Decision 3: yes
Between 640 and 1279 px the console may render at a minimum width of 1280 px in a sideways-scrolling shell with a dismissible note. CLAUDE.md's rule reads as "never lay it out narrower than 1280 px".
### Decision 7: yes
DESIGN.md §1 is replaced for the default view, and the control room becomes Builder view.
### Not answered
Decisions 5 (rating figure) and 6 (streak days).

## Not done
T3, T6, T9 and T7 follow, within the limit of two open pull requests.
