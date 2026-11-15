---
date: 2026-11-15
branch: claude/wp02-t3-no-dead-approvals
title: Never ask the founder to approve a call that cannot run
areas: [gateway, api, web]
supersedes: []
---
## What changed
The gateway's credential-free connection checks moved into `connectionRefusal(deps, loaded, mode)` (pipeline.ts),
called at the top of `allow` and right before `ask`. On a person's project on staging or production, a call to a
connector with no row, or with only a `mock` row, is refused with `integration_not_connected` before any approval or
Inbox item is written. Before, only a missing row was refused, and only after the founder had approved.
The project's Foundmill address is checked the same way before asking: `platformMailSwitchRefusal` (guard 1 of
platform-mail.ts, which reads config only and takes no ticket) refuses with the existing `platform-mail-off` /
`-unconfigured` / `-simulated` reasons.
Api: `integrations.connect` on a person's project for a connector that is not live throws `connector_not_live` (409,
"<Connector> is not available yet. Nothing was connected.") and writes nothing. `integrations.list` adds `available`
per catalog entry. Settings › Integrations shows "Not available yet" with no Connect button for such a connector, and
drops the section's "Test mode" chip there.

## Decisions
- A row with a usable status but no credential is still caught in `allow` after the vault, as before: the refusal
  function must not load a credential.
- "Test mode" hides when any mock connector is unavailable, since availability depends on the deployment and the
  project, not on the connector.

## Not done
- Playwright: the e2e stack runs `APP_ENV=test`, where every connector is available by design. A component test
  (github-install.test.tsx) renders the unavailable state instead.
