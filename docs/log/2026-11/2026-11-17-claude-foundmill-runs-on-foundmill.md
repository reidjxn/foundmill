---
date: 2026-11-17
branch: claude/trusting-goldberg-28k3rx
title: Foundmill runs on Foundmill, and one operator
areas: [docs]
supersedes: []
---
## What changed
- CLAUDE.md, "What Foundmill is for": a paragraph, "Foundmill runs on Foundmill", and under "Always" a bullet, "One operator".
- No code. `OPERATOR_USER_IDS` was set on the Railway api service to the founder's one account on Nov 17, 2026; the
  reports queue that reads it arrives with pull request #208.

## Decisions
### Where the build is heading (founder, Nov 17, 2026)
The founder: "the most important goal we have once foundmill is working end to end will be to make sure I can run all
future product updates and changes, the entire Foundmill finances, the entire go-to-market for Foundmill, all with agents
in Foundmill itself on my account". It comes after the product works end to end, not before.
### The handover is onboarding, not a document (founder, Nov 17, 2026)
The founder: "rather than writing any kind of handover plan, I want you to make sure all agents on my account ... are
onboarded into their specific roles, given the proper skills, and most importantly all the project history holistically
to take over running it completely". So what sessions know has to live where those agents can read it: docs/log, the
package guides and the agent skills.
### One operator (founder, Nov 17, 2026)
The founder named their own Foundmill account and said: "Only this account should have special operator privileges."
The response target for a report is two days (Nov 16, 2026).

## Not done
- The onboarding itself: it starts when the founder says the product works end to end.
- The test that operator access comes from the list alone is asked of pull request #208.
