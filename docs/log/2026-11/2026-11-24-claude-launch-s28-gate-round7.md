---
date: 2026-11-24
branch: claude/launch-s28-gate-round7
title: Launch gate run 45441963491 - 54 of 55 sessions; a simulated result is called simulated in the sentence that states it, in the house rules
areas: [orchestrator]
supersedes: []
---
## What changed
- Read pass 1 of run 45441963491: 54 of 55 sessions and 5 of 5 utility golden tasks passed. Pass 2 did not run.
- The one failure was `channel_social.buffer_connected_queues_post`. Its report opened with "The post was queued through Buffer's queue_post for Mon, Nov 30, 2026 at 8:00 AM Pacific", and only the next sentence said the Buffer results were simulated.
- House rule 4 (`packages/agents/src/prompts/club-rules.ts`, in front of every agent call in every environment) now says a simulated result is called simulated and not done in the same sentence that states it, and adds "queued" to what it may never be reported as.
- `ACCEPTANCE_BRIEF_SAMPLE` (`session.ts`) also asks for each simulated result to be called simulated in the sentence that states it ("Simulated: the post was queued for Monday"), never written as something that really happened.

## Decisions
### The check was right
A founder who reads only the first sentence, or a summary cut after it, reads that a post was queued. The house rule is that a simulated result is never reported as an action, so the agent's wording changes and the check stays as it is.

### In the house rules, not only the sample brief
A founder's own project gets the same guarantee from the house rule. On a real project in staging or production, simulated results are already refused before the agent (WP-05 T1), and a report built on them ends blocked (T2). The house rule covers development, test and any path that still hands an agent a simulated result.

## Not done
- The two-pass rerun is for the coordinating session to dispatch.
