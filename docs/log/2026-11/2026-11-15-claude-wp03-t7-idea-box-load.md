---
date: 2026-11-15
branch: claude/wp03-t7-idea-box-load
title: The idea box's card call ends at a 30-second deadline
areas: [api, shared]
supersedes: []
---
## What changed
WP-03 T7 step 1. `IDEA_BOX_DEADLINE_MS = 30_000` in `packages/shared/src/idea-box.ts`. The api's drafting stream
(`apps/api/src/services/idea-box.ts`, `draftStream`) starts a timer with the call: past the deadline it aborts the
model call and ends the stream with one `error` line, code `failed` ("The card could not be finished. Try again."),
even when the model ignores the abort. An answer that arrives after the deadline is not stored. The reserved card
is not given back (security review 2026-11-13, P1-1 stands). New test in `apps/api/src/__tests__/idea-box.test.ts`
with a model double that never answers, on fake timers.

## Decisions
- The spec says to pass the deadline as `timeoutMs` on the card request from `buildIdeaBoxCardRequest`. The code has
  no per-request timeout: `timeoutMs` is an option of the live client as a whole (`LiveModelClientOptions`), and
  `CompleteRequest` takes only a `signal`. The code wins: the deadline is a timer in the api that aborts the call's
  existing signal, which the client honors across its retries. `buildIdeaBoxCardRequest` is unchanged, and the model
  package gains no new option.
- The stream does not wait for a call that passed its deadline (it may never settle); the call's own errors are caught
  inside it, so nothing is left unhandled.
- The deadline covers the whole card, not the first words. The design target in docs/IDEA_BOX.md is the whole card in
  10 seconds on the fast route, so 30 seconds leaves room.

## Not done
- Step 2, the page's 35-second timer in `IdeaBox.tsx` (an `AbortController` at `IDEA_BOX_DEADLINE_MS + 5_000` that
  aborts the stream, shows `IDEA_BOX_ERRORS.failed` and puts the visitor's words back in the field), and its web test.
  `IdeaBox.tsx` is being rewritten in open pull requests #172 and #182; it is left for the landing session. Until it
  lands, a stalled model call ends at 30 seconds on the server and today's page already handles that line: it goes
  back to rest with the `failed` line and the visitor's words still in the field. Nothing on the page yet guards a
  stream that stalls on the network after the server's line was sent.
- Step 3 ("Try another idea") waits on WP-03 Decision 3.
- T7 is not ticked: its done-when (the words restored on the page) needs step 2.
