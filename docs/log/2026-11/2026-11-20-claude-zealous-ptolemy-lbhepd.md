---
date: 2026-11-20
branch: claude/zealous-ptolemy-lbhepd
title: complete_task refuses a line that cites a tool inside the project, so the nightly supplier eval can end done
areas: [connectors, gateway, evals]
supersedes: []
---
## What changed
The nightly outcome evals (`.github/workflows/evals-outcomes.yml`) failed on main on Nov 18, 19 and 20 (runs 44313629573, 44538055906, 44745753037) on `sourcing_manufacturing.records_suppliers`.
Each time the task ended blocked with "1 of its 2 lines not met: “At least two suppliers recorded in Customers, each with the page it was found on”", although the agent had recorded suppliers with `create_entity` and saved a report.

Root cause: the agent cited the tool that did the work, `tool: "create_entity"`, for line 1. Platform tools never stand behind a line (`unmetAcceptanceLines` sees outside tools only; the security review of 2026-11-16-claude-session-acceptance-check.md).
But `acceptanceRefusal` accepted the citation without a word, so the agent never learned and the session ended blocked. A scripted agent that cites `create_entity` reproduces the nightly's summary word for word in mock mode.

- `acceptanceRefusal` (packages/connectors/src/connectors/platform/acceptance.ts), shared by the gateway's `completeTask` and the in-memory mock host, now refuses a met line whose `tool` is a platform or quarantine tool, however it is written (`create_entity`, `platform:create_entity`, `mcp__platform__create_entity`).
  The refusal tells the agent to cite the report section that shows it, so it can fix the call in the same turn.
- `AcceptanceResult` moved to `acceptance-result.ts`, so acceptance.ts can read the platform tool names from tools.ts without an import cycle. Exports are unchanged.
- Tests: three cases in platform.test.ts (refused names, allowed names, and that `SHARED_WITH_OUTSIDE` matches the real name collisions), and one mock session in evals/src/__tests__/sessions.test.ts: the agent cites `create_entity`, is refused, cites its report section and ends done. That session test fails without the fix.

## Decisions
### Refuse the citation; do not count create_entity as evidence
Counting `create_entity` would reopen the security review's finding 1 (a platform tool standing behind a line). Refusing keeps the rule and closes the gap that made it silent. The eval's acceptance line and check are unchanged.

### Bare names that an outside connector also serves are left to the session
Gmail also serves `send_message` and `list_messages`, so a bare citation of either may mean the outside call. Those two are not refused; the session's verdict still decides by the connector that ran. A test fails if the list drifts from the real collisions.

## Not done
- The live check is the next nightly run; this change did not dispatch the workflow (FOUNDMILL.md).
- `researcher.unmet_line_is_not_done` failed once (Nov 19): the live agent blocked the task itself with `block_task` before claiming it done, and its reason did not quote the unmet line. That is a different path from the supplier case (the agent was honest, and the check expects the runner's own summary). It passed on Nov 18 and 20, and it is left as it is here.
- A `complete_task` the gateway refused still counts as a completed call in the session recorder (`trackCompleteTask` reads the event status, which is `succeeded` with `"ok": false` in the body). A later accepted call replaces its claims, so the outcome here is correct. This is noted and was not changed.
