---
date: 2026-11-16
branch: claude/wp05-t12-not-connected
title: The agent is told what is not connected, and a hopeless session does not start
areas: [connectors, gateway, orchestrator]
supersedes: []
---
## What changed
WP-05 T12 (A7-01 step 2).
- packages/connectors `channel-availability.ts`: `connectionRefused(connectorKey, facts)` is the gateway's connection
  refusal as one pure rule. It refuses an account-free connector in mock mode on a real project (but not
  `SELF_REFUSING_MOCK_CONNECTORS`), a sign-in connector with no row when live, and one with no row or only a `mock` row
  in mock mode on a real project. `unusableConnectors(servers, facts)` applies that rule to an agent's MCP servers from
  `ChannelAvailabilityFacts`. It never lists `platform` or `quarantine` (`ALWAYS_LIVE_CONNECTORS`), skips keys no
  connector serves and follows `modeKeyOf` (so `platform_mail` follows `sendgrid`).
- apps/gateway `connectionRefusal` now asks `connectionRefused` and keeps its three messages unchanged. The gateway
  tests are unchanged and pass.
- apps/orchestrator `runLiveSession`: on a real project (`mockResultsAllowed` false), right after the grants resolve, it
  computes the unusable connectors.
  - When some are unusable, the task prompt gains "Not connected for this project: <names>. Calls to them are refused.
    If the task cannot be done without one, call block_task now and name it."
  - A `research` or `channel` task whose agent holds outside connectors, all of them unusable, returns `blocked` /
    `not_connected` before the budget read, the SDK import, the workspace and the token. Cost is 0. The reason (the
    `task.blocked` detail) is `not connected: <keys>` and the summary is T2's ("Blocked: <names> not connected for this
    project, so nothing real was read or sent.").
- Tests: `packages/connectors/src/__tests__/unusable-connectors.test.ts` (10). session-live has four new cases: research
  and channel tasks with only an unusable `web` (no SDK call, no token minted, no workspace, detail `not connected:
  web`), a lead's `ops` task with the same grants (starts, and the prompt has the line), and a sample business (starts,
  no line). The three behavior cases failed on main. The sample-business case is a guard and passed on main too.

## Decisions
- The spec signature takes no auth kinds, so `unusableConnectors` reads each connector's `auth.kind` from the catalog
  factories, once per key. The orchestrator already does this for display names.
- The facts only know connected and degraded rows (`connectedConnectors`). An expired or disconnected row therefore
  counts as no row here, while the gateway's `connectionRefusal` lets such a row through, to fail later at the
  credential check (live) or run the mock (mock mode). This is the one place the two can differ, and the difference is
  small.
- `platform_mail` is never listed: the gateway leaves it to its own refusal (`SELF_REFUSING_MOCK_CONNECTORS`), and the
  spec asks for the 409 branches only. The T8 policy denies still count after the session.
- Both the line and the early block are off where simulated results are allowed (a sample business, development, test),
  the same gate as T2's check after the session. That also covers a sample business on a live deployment, where the
  gateway would refuse an unconnected sign-in connector: "demo businesses are unaffected" wins there.
- The check sits after the platform-credit check and before the budget read. Both earlier steps are reads, and an early
  return after them already existed (the budget block), so nothing is held open.
- The prompt names display names, the same names as the summary. The reason keeps the keys, as T2 does.
- T2's staging cases in session-live used the harness worker, whose only outside connector is GitHub, with no row. They
  would now stop before the SDK. That describe now connects GitHub around its cases, so they still test the check after
  the session.
- No workflow changed, so no `patched()`.

## Not done
- The classifier triage call (A7-01 step 3), cut by the plan until T0's numbers.
- No session.test.ts case: the replay path (mock sandbox) is untouched, and every case runs on the live runner.
- "Query 2 shows `not_connected` blocks at zero cost" needs production data to check.
- The orchestrator reads `INTEGRATIONS_MODE` and `LIVE_CONNECTORS` for this rule, so they must match the gateway's
  (docs/DEPLOY.md §2, the orchestrator row). CI found that the outcome-eval harness had given `web` as live to the
  gateway only, so its research cases stopped before the session. The harness now gives the orchestrator the same
  value. Production's orchestrator variables were not read from here: a Desktop session checks that they match the
  gateway's before this deploys.
