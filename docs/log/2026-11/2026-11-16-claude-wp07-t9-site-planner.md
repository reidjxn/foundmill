---
date: 2026-11-16
branch: claude/wp07-t3-site-sessions
title: The Planner builds for a site; the offer page first; the demo only of something to open (WP-07 T9)
areas: [agents, api, orchestrator, models, evals]
supersedes: []
---
## What changed
- `PlannerDestination` gains `site` (`plannerDestination(repository, { sites })`: no repository and Sites on, not a
  sample). The Planner's system prompt carries `PLANNER_SITE_RULE`: code tasks only for pages of the static site,
  worker types frontend_engineer and docs_writer, and what needs a server, a database or sign-in is planned as
  nothing and named in the goal of the closest task. The api's `planTaskGraph` and the cycle's `planRoadmap` pass it.
- The first build of a site project is `SITE_FIRST_BUILD` ("Build the offer page"), whatever its archetype
  (`startBuilding`).
- The frontend engineer's playbook no longer tells a session with no shell to run tests or capture a screenshot: "Write
  the change and the tests it needs; the platform runs the checks after your session."
- The demo task after "shipped" is created only where there is something to open: the site's live address, else its
  newest preview, named in its goal (A4-18). Otherwise `demoTaskId` is null.
- The mock `planner` route plans a site page for `destination: "site"`; eval case `pl03_site` and its rubric.

## Decisions
- **`questions_for_founder` does not exist in `TaskGraphOutput`**, so the package's "say so in questions_for_founder"
  became "say so once in the goal of the closest task", as the no-destination rule does.
- **No demo for a project with nothing to open**, a repository project included: an agent with no browser cannot
  record a demo of a product it cannot open (A4-18, the package's rule).

## Not done
- The live eval (`pnpm evals`, needs a key) was not run.
- T10, the Playwright proof.
