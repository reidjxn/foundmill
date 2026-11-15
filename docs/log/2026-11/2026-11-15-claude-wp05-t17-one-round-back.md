---
date: 2026-11-15
branch: claude/wp05-t17-one-round-back
title: A reviewer's "request changes" goes back to the author once
areas: [orchestrator, agents, evals]
supersedes: []
---
## What changed
WP-05 T17 (A4-12), on the founder's D2 answer of Nov 15, 2026. When the second read of a code change is fresh and
asks for changes, `mergeReview` hands the task back to its author (`handBack`, why `review`) instead of asking the
founder, once per task. After that round the founder is asked as before and the review never blocks.

- `MergeHoldReason` gains `"review"`. The workflow change sits behind `patched("merge-review-hand-back")`
  (`MERGE_REVIEW_HAND_BACK_PATCH`); a history recorded before it (`fixtures/legacy-merge-review-changes.json`, a
  `request_changes` review that went on to ask the founder) replays on the new code.
- `secondReadMerge` returns, on a fresh review, `handedBackBefore` (a `merge.handed_back` row with `why: "review"`
  for the task exists) and `handBackDetail` (the author's instruction, when the verdict is `request_changes`).
- `codeReviewHandBack` (packages/agents) writes that instruction: our two sentences first, then the findings as data
  inside `<untrusted_content kind="code_review_findings">`, without links, addresses or numbers, cut by whole findings
  so the text fits the 2,000 characters of `task.blocked.detail` with the block closed.
- `handBackDetail("review", …)` uses the instruction as written, or our sentences alone when there is none.
- Eval: `runCodeHandBackCase` in `evals/src/second-read.ts` (a branch that logs a key, with an instruction and contacts
  planted in a comment); its mock unit test passes, also with a reviewer that repeats the planted text.

## Decisions
- The "was it sent back before" check runs in `secondReadMerge`, which already reads the audit log, and comes back in
  its result; the workflow stays pure and decides on `cached`, `verdict` and `handedBackBefore !== true`. That last
  test reads a missing field as "not before", so the legacy fixture really proves the patch guard: without
  `patched(...)` the replay fails with a non-determinism error (checked once by hand).
- The spec has the workflow build the detail; the workflow only has a findings count, so the activity builds it.
  Trusting the code over the spec here.
- The count is per task, not per pull request or head: one round, whatever the author pushes next.
- First sentence, read by the founder: "Another agent read this change and asked for changes, so it went back to the
  agent who made it before the founder is asked." The rest is for the author and avoids "send" and "post" outside the
  ban sentence, which the eval checks.
- `cached` reviews (the cycle's sweep reading the same head again) never send work back.

## Not done
- No change to T16's founder path, `session.ts` or `cycle.ts`.
- The live eval case runs only with `pnpm evals` and a key.
