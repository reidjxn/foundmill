---
date: 2026-11-15
branch: claude/wp02-t7-follow-only-when-mail
title: The Follow form is offered only when a confirmation can be sent
areas: [api, modules]
supersedes: []
---
## What changed
`followAvailable(env)` (apps/api services/pages.ts) is true when platform mail is live, or on a development or test
stack, where the mock answers. Without it:
- the public page has no Follow form;
- `followPage` answers the existing "not accepting followers" refusal;
- `page.get` returns `followAvailable: false`, and the Public page screen shows the switch off and disabled with
  "Following opens when email is switched on for Foundmill. Your page works without it."
The api's `/health` gains `platformMail: "live" | "off"`, for T12's production check.

## Decisions
- Development and test keep Follow, because their confirmations are simulated by design. The plan's condition
  (`platformMailLive` alone) would have taken the form off every local and e2e stack.
- An older api without the field reads as available, so the screen never hides a working form.

## Not done
- Playwright at 390 and 1440 px: the e2e stack is a test environment, where Follow is always available. A component
  test covers the disabled switch.
