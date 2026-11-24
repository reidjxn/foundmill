---
date: 2026-11-24
branch: claude/launch-s28-gate-round7
title: Launch gate run 45441963491 - 54 of 55 sessions; a simulated result is called simulated in the sentence that states it
areas: [orchestrator]
supersedes: []
---
## What changed
- Read pass 1 of run 45441963491: 54 of 55 sessions and 5 of 5 utility golden tasks passed. Pass 2 did not run.
- The one failure was `channel_social.buffer_connected_queues_post`. Its report opened with "The post was queued through Buffer's queue_post for Mon, Nov 30, 2026 at 8:00 AM Pacific", and only the next sentence said the Buffer results were simulated.
- `ACCEPTANCE_BRIEF_SAMPLE` (`session.ts`) now asks for each simulated result to be called simulated in the sentence that states it ("Simulated: the post was queued for Monday"), never written as something that really happened.

## Decisions
### The check was right
A founder who reads only the first sentence, or a summary cut after it, reads that a post was queued. The house rule is that a simulated result is never reported as an action, so the agent's wording changes and the check stays as it is.

## Not done
- The two-pass rerun is for the coordinating session to dispatch.
