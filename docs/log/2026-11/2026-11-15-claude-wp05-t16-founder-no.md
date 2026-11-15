---
date: 2026-11-15
branch: claude/wp05-t16-founder-no
title: A founder's "no" to a change going live has a next step (WP-05 T16)
areas: [api, orchestrator, db]
supersedes: []
---
## What changed
- Rejecting a change going live with words (the Inbox's optional reason) hands it back at once: the task is
  blocked `needs_update` with the founder's words first as the instruction, audited `merge.handed_back`
  (`why: "founder"`). The founder reads "Nothing goes live. <Agent> gets your note and reworks it."
- Rejecting with no words writes one follow-up decision, "What should happen to this change?", with
  "Tell the team what to change" (free text) and "Drop this change". Drop stops and archives the task, removes
  its outgoing edges and audits `merge.dropped`. The founder's words hand it back as above.
- `pendingMerges`: a founder's `decision` row settles only the completion it answered; a rework finished after it
  is offered to go live again. Before this, a rejected task was never reviewed again.
- `MergeHoldReason` gains `"founder"`; `handBackDetail("founder", …)` and the api share `founderReworkDetail` (db).

## Decisions
- Step 2's check: a release approval's reject can carry free text today. The ApprovalPanel's "Reason (optional)"
  shows on a release too and goes to `inbox.decide` as `freeText`, which becomes the approval's note. So both
  paths are built, as the spec asks.
- The hand-back happens in the api when the founder answers, not in the orchestrator's `recordMergeDecision`. The
  mergeReview workflow passes the activity only the outcome, so the activity cannot see the words; the api has
  them inside the answer's transaction, and the same call already blocks a rejected non-release task. No workflow
  change, so nothing needs `patched()`. `recordMergeDecision` still only audits, unchanged.
- The follow-up's link to its approval rides in `decision.key` (`release.follow_up:<approvalId>`): the stored
  decision schema strips any other field, and a key needs no migration. The task comes from the approval.
- A follow-up answered after the change moved on (reworked, live, put away) changes nothing and says so.
- The founder's words are not wrapped as untrusted: they are the founder's own instruction.
- The api's `task.blocked` for a founder's hand-back is marked narrated: the founder asked for it.

## Not done
- Drop leaves the pull request and the branch open on GitHub: closing them is a gateway call, out of this task.
- No Playwright spec: no screen changed (the follow-up renders as any decision with options and free text).
