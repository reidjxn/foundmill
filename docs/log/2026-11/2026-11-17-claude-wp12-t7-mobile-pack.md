---
date: 2026-11-17
branch: claude/wp12-t7-mobile-pack
title: The mobile pack carries the mobile session's work and a contract test keeps it true
areas: [docs, api, ci]
supersedes: []
---
## What changed
WP-12 T7. `docs/mobile/skills/foundmill-backend/SKILL.md` and `docs/mobile/PROMPTS.md` now carry the mobile session's work (the start flow's shapes, the retention procedures, the batch cap of 4, the Google sign-in rule), and `BACKEND_CHANGES.md` section 13 its resolved notes.
The skill's People section is rewritten from "coming" to what is live: `invitation.byToken|accept|decline` with `hasProfile`, `founder.adult.get|confirm` and the refusals, `publicPage.storyBySlug|cardById`, `publicPerson.byHandle`, `share.opened`, `arrived` on `today.sinceLastVisit`, and the full role enum.
`apps/api/src/__tests__/mobile-contract.test.ts` fails when the skill names a procedure, prefix or event the api lacks, and holds the product skill's "Solo is complete" rule.
Eight stale names were corrected. `ship-change` step 7 tells a session to update the skill with the procedure.
`scripts/ci-affected.mjs` lists the skills as a read of the api's tests, so a change to them runs the api unit job.

## Decisions
### A port, not a merge
`origin/claude/zealous-rubin-8q52gr` shares no history with main any more (no merge base) and carries 20 commits where the plan said 11, so a merge was impossible and step 1's stop condition applied.
A file diff showed the branch is behind main in one place (`BACKEND_CHANGES.md` section 12, where main records "18 or older" as built) and ahead in the rest.
So the skill and the prompts are taken from the branch whole, and only section 13 of `BACKEND_CHANGES.md` is taken from it.
### The "round of work" wording is not ported
The branch also changed the Continue run line from "cycles" to "rounds of work" (`RUN_UNTIL_DONE`, a hard-stop line, and three tests).
Main still says "cycles" in `ContinueButton` and other places the branch never touched, so porting part of it would leave the product inconsistent.
It is a product copy change for its own pull request.
### Report and block shapes wait
`report.create` and Find people are not on main (#208, #217), so the skill says they are not there yet.

## Not done
After the merge the founder pastes the skill into the Newly project again (BACKEND_CHANGES §11). The remote branch can be deleted once nobody needs it.
