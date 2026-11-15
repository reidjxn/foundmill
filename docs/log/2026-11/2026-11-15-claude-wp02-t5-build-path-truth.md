---
date: 2026-11-15
branch: claude/wp02-t5-build-path-truth
title: The build path says what is true without a repository
areas: [shared, db, agents, api, orchestrator, modules]
supersedes: []
---
## What changed
A new fact, where the team's code goes: `BuildDestination = "none" | "github"` (packages/shared), set by
`buildDestinationOf(codeRepository)` ("github" only with a repository chosen and pushing on, which is what
`pushWorkspace` needs). `loadProductStage` carries it in its facts, `business.get` returns it as `buildDestination`,
and `today.get` passes it to the first-week timeline.
Seven lines now say what is true when nothing can go live:
- Development › Live product, with no release recorded: "Nothing is live from here yet. Your public page is the first
  thing people can open: Product › Public page." (a link), and "Previews are not available yet."
- What changed, with no repository: the code is saved in the project, and a GitHub repository can be connected in
  Settings › Integrations.
- First week, with no repository: "the first pieces of work" in place of "the first changes going live".
- The roadmap sign-off note and option: "the team starts on them in its next round of work" (no "cycle").
- Building starts: "the first round of work", plus "The code is kept in your project; nothing goes live from it until
  a repository is connected." when there is none.
- A code session with no repository is told nothing is pushed and no pull request opens, and never to say it was.

## Decisions
- Unknown destination reads as "github" in the web hook and in `codeTaskNote`'s default, so a missing field never adds
  a claim. Only an explicit "none" changes the copy.
- Rows 1 and 2 depend on whether a release was recorded, not on the destination (as the plan says).
- The session reads the repository right where the prompt is built: `SessionLaunch` carries no repository, so the
  plan's "launch knows the repository" did not hold. Six lines in session.ts change.

## Not done
- Playwright (`team-development.spec.ts`): the e2e seed has a release and a repository, so these lines don't show
  there. Component tests in packages/modules cover them.
- No engineer code-summary eval exists to extend, so none was added (the plan's condition).
