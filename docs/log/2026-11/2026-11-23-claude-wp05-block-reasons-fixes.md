---
date: 2026-11-23
branch: claude/wp05-block-reasons-fixes
title: WP-05 T19, the next reasons sessions block, fixed in code
areas: [orchestrator, sandbox, docs]
---
## What changed
Launch Session 27 checked each top block text from docs/holistic-plan/audits/e0-production-evidence.md ("Blocked sessions by reason, Nov 23, 2026") against the code. Production was not read: the Supabase connector failed to connect in this session, so the before numbers are the Nov 23 measurement and the after is from code and tests.

Before (304 `task.blocked` events on real projects, newest Nov 17), and what this change does:
- E2B "Timeout cannot be greater than 1 hours" (23, Oct 9 to 14 only). Already fixed: sessions ask for `SANDBOX_TTL_MINUTES = 30`, and session-live.test.ts asserts it is at most 60.
  New: the E2B provider caps every lifetime at `E2B_MAX_TTL_MINUTES = 60`, on create and on `setTtl`, so no other caller (the spec allows up to 24 hours) can hit the refusal again. Test in packages/sandbox e2b.test.ts.
- "no changes" (11). Cause: WP-05 T2's report turn skips code tasks, so a code agent that ended its first turn without touching a file was blocked at once, with no turn back.
  New: such a session gets one turn (`NO_CHANGES_TURN`): make the change, or call block_task with what stops it or where the change already is. After that turn the acceptance tests and their fix turns run as usual.
  Two tests in session-live.test.ts: a change made on the extra turn ends done; a second empty turn is blocked after exactly one extra turn.
- "acceptance tests failed" (55). Real failures already go back to the author twice with the output (T9).
  Environment failures: "Dependency install failed" (6) and pnpm's ERR_PNPM (2, the Oct 27 config.yaml error, fixed then).
  New: the sandbox's dependency install is tried once more after 5 seconds, so a dropped registry connection no longer blocks the task. Test in acceptance-toolchain.test.ts.
- "clashes with newer work" (9). Already handled: the merge first tries GitHub's update_branch, and only a real conflict hands the task back (`needs_update`); the next session starts from the newest files with the change on top (T8, T16). That block is a step of the retry, not a dead end. No change.
- "No run_checks tool" (2 + 1). Already fixed: the Planner no longer plans platform duties such as running CI (`PLATFORM_DUTIES`, packages/agents planner.ts). No change.
- "model budget exhausted: the business's own Anthropic key refused the call" (5). Honest: the founder's own key refused for billing; no platform key is ever used instead. No change.
- Ops and research "dependency" (70 and 29 sessions). The details spread over waiting on another agent, a missing input and a missing tool, each under 2% of blocks; T5, T12 and T18 cover them. Added T20 to WP-05 to measure them again on sessions after Nov 17.

## Decisions
### The E2B cap is Hobby's, for every account
Production runs on E2B Hobby, whose limit is 1 hour. The cap is a constant, marked as a shortcut to raise when production moves to Pro (24 hours), rather than a setting nobody needs yet.

### One extra turn, not two
The no-changes turn is sent once per session, like T2's report turn. An agent that still changes nothing is blocked with the same honest reason as before.

### No fix turn for a failed install
A failed install has no exit code from the agent's tests, so it does not take one of the two fix turns. The retry covers the transient case; a project whose install really fails fails twice and is blocked as before, with the output.

## Not done
Production was not re-read (no Supabase connection here). The after numbers come when sessions run on this code; T20 holds the re-measure.
