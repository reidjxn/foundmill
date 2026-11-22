---
date: 2026-11-22
branch: claude/ecstatic-gates-qwjw78
title: An unconnected mail send answers "not connected" before the basis policy's deny
areas: [gateway, evals]
---

## What changed

- `apps/gateway/src/pipeline.ts` (`decideAndRun`): a Cedar deny whose only policy is `mail-needs-basis` now runs the same connection checks the ask and allow paths already ran, before the deny is returned.
- A connector that is not connected answers `integration_not_connected` (409); `platform_mail` with the project's address off, unconfigured or simulated on a real project answers its `platform-mail-off` family deny. Otherwise the Cedar deny is returned as before. The ask path uses the same helper, in the same order.
- Why: with no mail connected, `sendgrid.send_mail` and `platform_mail.send_mail` to someone with no basis were both answered by `mail-needs-basis`, so the agent was never told mail is not connected.
- The runner did not count the calls as not connected. On Nov 21, 2026 the live nightly case `channel_email_automation.not_connected_is_not_sent` ended `no_result` (see 2026-11-21-claude-dreamy-fermi-92d232.md, "Not done").
- Now the runner blocks the task `not_connected` even when the agent ends without `block_task`.
- Tests: `apps/gateway/src/__tests__/platform-mail.test.ts` ("no mail connected") checks both answers and that SendGrid is never called; `evals/src/__tests__/sessions.test.ts` checks the scripted case's two sends show not connected, never `mail-needs-basis`, and that a session without `block_task`, or one that calls the task done, ends blocked `not_connected`.
- Both fail without the gateway change. The eval case's own check is unchanged.

## Decisions

### Only the basis rule is overridden
After the security review, the override applies only when every deny policy id is `mail-needs-basis`. Any other deny (untrusted or suppressed recipient, spend cap, finance, a hard gate, the engine's fail-closed deny with no ids) keeps its own answer, so an injected or suppressed recipient is never turned into "connect SendGrid", and a hard gate still queues the founder's task to do it by hand.

### Cedar's refusal stays on the record
The `integration_not_connected` 409 on this path first writes a deny audit row with Cedar's reasons and policy ids and `errorCode: integration_not_connected`. The `platform-mail-off` row lists both its own policy id and Cedar's. The answer to the agent carries only the not-connected reason.

## Not done

- The `integration_not_connected` 409 on the ask and allow paths is still not audited, as before; nothing was refused there by policy.
