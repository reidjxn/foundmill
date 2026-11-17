---
date: 2026-11-17
branch: claude/wp14-behavior-brief
pr: 287
title: WP-14, the behavior brief of Nov 17 with the founder's answers (the plan)
areas: [docs]
supersedes:
  - "Plans differ by agent work only (2026-11-11, CLAUDE.md)"
  - "No admission in weekly cohorts; no public counts, for the waitlist (2026-11-12, answers 4 and 7)"
  - "No invite passes (2026-11-12, answer 7)"
  - "Both sides of an invitation get credits (docs/NETWORK.md)"
  - "The spend line starts at $0 (WP-04 D4, 2026-11-16), as a default"
  - "The overnight shift is on by default (WP-09 D7), as a default"
  - "The charge that empties a balance pauses the team (2026-10-12)"
  - "Test users convert to the paid $5 monthly plan on the day of the switch (wp09-entry-plan-answers, answer 4)"
  - "Businesses are unlimited on every plan (2026-10-16)"
---
## What changed
Added docs/holistic-plan/WP-14-behavior-brief.md and its rows in docs/holistic-plan/STATUS.md, and changed two lines
of CLAUDE.md. The founder handed over a change brief on Nov 17, 2026, written from an outside report against an older
copy of the repository. Three read-only checks compared every item with main at 5b6541d6 and found twelve points where
it disagreed with a recorded decision. The founder answered eleven the same afternoon, in the Desktop session that
wrote this package. The package lists what main already does, fifteen tasks, the amendments to other packages' tasks,
the founder's fifteen answers and two open points. No code changed.

## Decisions
### The founder's answers of Nov 17, 2026 (afternoon), which win over #273 and #274 where they differ
- The entry plan is named Try. It is free today and becomes $5 a month on the day sign-up opens to the public.
- Plans are Try, Founder, Studio and Partner. The Founder price is tested at $15 and $25 a month.
- "Plans differ by agent work only" is dropped. Plans differ by the features the brief lists (WP-14 T14).
- A founder can always bring their own Anthropic key, on every plan; it stays offered wherever a way on is offered.
- Commit opens with a spend cap for each action of 5.00 and Autopilot off selected; the founder can change both.
- Time and where you live are asked with the first profile and must be known before a person takes charge.
- "Built for a big screen" is used as copy. The outer product still works from 390 px.
- The waitlist opens in batches with a real count of places; each active founder has three named invitations;
  inviting earns no reward; the waitlist page is public and indexable now.
- Leaderboards stay removed. The mobile web view, the day-job description of the first user and "Customer #1" on
  shared cards are deleted from the brief.

### The founder's further answers, evening of Nov 17, 2026
- People invited while sign-up is invite-only never pay the Founder plan's monthly fee; credit packages as normal.
- Studio's test prices are $50 with Founder at $15 and $100 with Founder at $25.
- Plans limit companies, not people: Try 1, Founder up to 5, Studio any number; a deleted company does not count.
- Founder carries $10.00 of budget a month in both price sets, Studio $50.00, Try $5.00. Founder and Studio reach
  Opus and Sonnet without a credit pack. Try is limited to Haiku 5.5 and GLM-5.3 Flash, or the founder's own key.

### The brief's reversals that clash with nothing newer are taken as the founder's word
"The last task always finishes" replaces pausing on the charge that empties a balance, and one style for estimates
with one legend replaces DESIGN §10's chip beside every figure (T1, T7).

### Readings this session made, flagged for the founder
- "Built for a big screen" changes words only; the small-screens build rule in CLAUDE.md is untouched.
- Plan feature checks take effect when sign-up opens; while it is invite-only every tester keeps what they have.
- The indexable waitlist page is an exception for that one page; everything else still follows `SIGNUP_OPEN`.
- Three named invitations in total replaces three admissions a day for this kind of invitation.

### Work goes to the session that owns the area
A task that changes another package's task is marked "amends" and travels with that task. The landing copy (T10)
was sent to the Desktop landing session directly; the cloud sessions learn of the rest from STATUS.md.

## Not done
- O1 and O2 in the package: the four never-list lines, and whether a credit pack still unlocks Opus and Sonnet on
  Try (#274) now that the founder said Try "has to bring their own Anthropic key".
- docs/NETWORK.md, docs/DESIGN.md §10 and docs/foundmill-plan are changed by the tasks that own them (T15, T7, T13).
- STATUS.md's WP-04 rows are behind main and were not rebuilt.
