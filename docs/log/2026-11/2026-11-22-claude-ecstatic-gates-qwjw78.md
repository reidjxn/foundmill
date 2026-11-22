---
date: 2026-11-22
branch: claude/ecstatic-gates-qwjw78
title: An unconnected mail send answers "not connected" before the basis policy's deny
areas: [gateway, evals]
---

## What changed

- `apps/gateway/src/pipeline.ts` (`decideAndRun`): a Cedar deny that is not a hard gate now runs the same connection checks the ask and allow paths already ran, before the deny is returned.
- A connector that is not connected answers `integration_not_connected` (409); `platform_mail` with the project's address off, unconfigured or simulated on a real project answers its `platform-mail-off` family deny. Otherwise the Cedar deny is returned as before. The ask path uses the same helper, in the same order.
- Why: with no mail connected, `sendgrid.send_mail` and `platform_mail.send_mail` to someone with no basis were both answered by `mail-needs-basis`, so the agent was never told mail is not connected.
- The runner did not count the calls as not connected. On Nov 21, 2026 the live nightly case `channel_email_automation.not_connected_is_not_sent` ended `no_result` (see 2026-11-21-claude-dreamy-fermi-92d232.md, "Not done").
- Now the runner blocks the task `not_connected` even when the agent ends without `block_task`.
- Tests: `apps/gateway/src/__tests__/platform-mail.test.ts` ("no mail connected") checks both answers and that SendGrid is never called; `evals/src/__tests__/sessions.test.ts` checks the scripted case's two sends show not connected, never `mail-needs-basis`, and that a session without `block_task`, or one that calls the task done, ends blocked `not_connected`.
- Both fail without the gateway change. The eval case's own check is unchanged.

## Decisions

### After Cedar, not before it
The checks run once Cedar has answered deny, not before Cedar. A hard-gate deny (`hard-gate`, `hard-gate-security-settings`) keeps its answer, because it queues the founder's task to do the action by hand; answering "not connected" there would drop that task. For every other deny the outcome is the same (nothing runs), only the reason the agent reads changes.

### Not connected wins over other deny reasons
On an unconnected connector, a suppressed recipient, a spend cap or an untrusted recipient is now answered "not connected" too. Nothing can be sent either way, and connecting the tool first is the founder's real next step; once it is connected, Cedar's deny reason comes back unchanged.

## Not done

- The `integration_not_connected` 409 is not written to the audit log, as on the existing ask and allow paths. Unchanged here.
