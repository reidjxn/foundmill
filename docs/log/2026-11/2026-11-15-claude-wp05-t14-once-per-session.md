---
date: 2026-11-15
branch: claude/wp05-t14-once-per-session
title: The same outward call runs once per session
areas: [gateway]
supersedes: []
---
## What changed
WP-05 T14 (AR-12). In `apps/gateway/src/pipeline.ts`, an outward call that went through writes a `doneKey` on its
`tool.call` audit row. Outward means the tool's hints say `contactsThirdParty`, `spendsMoney` or `irreversible`, or
the tool is `platform:request_human_action` or `platform:create_task`. The key covers the agent, the connector, the
tool, and a hash of the args and the call's context.

When the same session repeats the same call within 8 hours, the gateway does not call it. It answers `allow` with
`data: { replayed: true, firstRanAt, note }` at cost 0 and writes an audit row with outcome `replayed` and `replayOf`.

A repeat that arrives while the first call is still running gets `stillRunning: true` and is not sent. It is held off
by a set of the outward calls running in this process.

A token with no session is never deduplicated. Tests: `once-per-session.test.ts` (10 cases). The harness gained
`sendHold`, which keeps a send waiting.

## Decisions
- The replay comes after the state re-check and before Cedar.
  - A stopped team or a paused agent is still refused.
  - A repeat neither asks the founder again nor uses up an approval.
  - It also skips the later refusals: not connected, the platform mail switch, untrusted recipients. That is
    truthful, because the call did go through earlier and nothing runs now.
  - The guard tests that sent the same message twice in one session now use a fresh session or different words, so
    each one still tests its guard.
- The security review raised two medium points, both fixed:
  - The key now includes `req.context`. Otherwise two sends with the same args and a different context recipient or
    amount would count as one call.
  - Two identical calls at once both ran. They are now held off within one process. With several gateway replicas, a
    repeat that lands on another replica while the first is still running can still run. Calls are only recorded as
    done when they finish, and a lock held across a vendor call was not worth it at today's single replica.
- Also from the review:
  - The key includes the agent, so two agents on one session id never answer for each other.
  - A replay is marked simulated if its first run was (the audit row's `mode`), whatever the mode is now.

## Not done
- A replayed `create_task` does not return the first task's id. Storing part of a result on the audit row is a larger
  change than the finding needs.
- No new index. The lookup filters `audit_log` by business, action and an 8-hour window, which the existing
  `(business_id, created_at)` index covers.
- Calls are held off only within one process (see Decisions).
