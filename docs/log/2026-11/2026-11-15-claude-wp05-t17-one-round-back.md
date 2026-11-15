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

## Security review
- The block could be cut open: lengths were measured before `untrustedBlock` escapes `<`, `>` and backticks six-fold,
  and `handBackDetail` sliced at 2,000. `codeReviewHandBack` now measures the escaped block, drops findings first and
  then clips the summary until it fits; `handBackDetail` never slices a review detail and falls back to our sentences
  alone when one is over 2,000 characters or does not end with `</untrusted_content>`.
- `withoutContacts` folds look-alikes (NFKC, so `＠` and `＜` become ASCII and are escaped) and drops `\p{Cf}`
  (zero-width spaces), then also catches bare hosts, `host:port` and runs of seven or more digits. A finding's
  `file` passes through it too. Judgment call: a bare host counts only under TLDs that are not also file extensions
  or common property names (com, net, org, io, ai, xyz, biz, example, invalid, onion, some country codes), plus
  `localhost` and IPv4; `merge.ts:145`, `README.md`, `log.info(`, `re.test(` and `this.app` stay. A host under any
  other TLD is still caught with a scheme or a path. `host:port` with no path is caught only for those hosts, since
  `file.ts:145` is a file and line. A plain number of seven or more digits ("1000000 ms") is removed as a phone.
- The one-round check reads the task's own `merge.handed_back` row (`repos.audit.latestForTarget`: target id and
  `details @> {"why":"review"}`, limit 1) instead of the business's newest 200 rows.
- `handBack` blocks the task, writes `task.blocked` and the audit row in one transaction, keyed
  `task.blocked:merge:<sessionId>:<prNumber>:<why>` instead of the clock: a session's change goes back at most once,
  since its rework is a new session.

## Not done
- No change to T16's founder path, `session.ts` or `cycle.ts`.
- An activity retry after the hand-back committed still appends a second audit row (the event is deduplicated).
- The live eval case runs only with `pnpm evals` and a key.
