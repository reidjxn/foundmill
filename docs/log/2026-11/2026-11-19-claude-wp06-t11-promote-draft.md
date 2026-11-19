---
date: 2026-11-19
branch: claude/sharp-shannon-0a434k
title: Make an edit live without a run (WP-06 T11)
areas: [api, web]
supersedes: []
---
## What changed
- `agent.training.promoteDraft({ agentId, versionId })` makes a draft the live version with no training run, so changing one line costs no model call. It refuses a version that is not a draft of that agent, a draft that breaks a house rule (the message names the rule number), and a draft with a run still active (409). A draft that widens the live tools needs an owner or admin. It promotes with `keepAgentModel`, emits `agent.promoted` (no run, not a rollback) and writes the audit row `agent.version.promote_untested`.
- `agent.profile.get` returns `untestedSinceChange`: the live version is above 1 and no promoted run has it as its target. It reads the 20 most recent runs, as the profile already does.
- The Training tab shows a secondary button "Make it live without testing" once a draft is saved and unchanged. Its dialog says: "This version goes live now. Its ratings stay as they were and are marked not tested since the change."
- Tests: `apps/api/src/__tests__/agent-promote-draft.test.ts` (live at once with event, a non-draft, a rule-breaking draft, tool widening for a member and an owner); a Playwright step in `agent-profile.spec.ts`.

## Judgment calls
- The plan says the founder decides whether T11 is wanted (Decisions for the founder, 5: it changes the rule that a change goes live only after a run). It was assigned to this session, so it is built; the alternative is to drop the button.
- The ratings are not touched, so they keep their old values. Only the flag says they are older than the live text. Showing the mark on the ratings is WP-10's.
- The run-active check is the existing `activeForVersion`, so a queued retest copy blocks it as well.

## Not done
- Playwright was not run locally; CI runs it.
- The 7-day rollback watch starts as for a promoted run, because the event requires `watchUntil`; nothing else reads it for a run-less promotion.
