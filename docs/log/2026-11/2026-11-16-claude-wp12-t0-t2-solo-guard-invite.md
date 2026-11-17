---
date: 2026-11-16
branch: claude/wp12-t0-t2-solo-guard-invite
title: The standing solo guard, and an invited person lands in the project
areas: [shared, api, web, e2e]
supersedes: []
---
## What changed
WP-12 T0 and T2. `soloGuardViolations` (packages/shared) lists the phrases a one-person project must never read. `apps/api/src/__tests__/solo-guard.test.ts` reads Today, the visit view and every note of a freshly committed project, with `LIVE_MODE` unset and set to 1. `apps/web/e2e/solo-guard.spec.ts` reads Today, Needs you and Team › People at 1280 and 390 px.
`invitation.accept` now answers `hasProfile`. After Accept a person without a profile sees one field, "What should we call you?", then goes to Today. `invitations.spec.ts` runs this at 390 px and expects Today, never /onboarding.

## Decisions
### The guard passed on main as it stands
No copy had to change. The api test also covers the project page note the team writes in the first session.
### The name is asked after Accept, on the invitation card
`founder.profile.get` is refused before an account is admitted, so the answer to Accept carries `hasProfile`. The card shows the field only when it is `false`.
### Existing accept tests match on `businessId` and `already`
They used `toEqual` on the whole answer; `toMatchObject` keeps them about what they check.
### Attribution
The existing test covers a live page; the new one covers a project with none, where the `invitations` row is the record and no `attributions` row is written.

## Not done
The mobile skill does not yet name `hasProfile` (WP-12 T7 adds it). Later tasks add their cases to the solo-guard files.
