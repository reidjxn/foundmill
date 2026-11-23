---
date: 2026-11-22
branch: claude/hopeful-lovelace-b3bi14
title: The tool scout uses the hosted browser route (Part D, D3)
areas: [shared, connectors, agents, api, orchestrator, sandbox]
supersedes: []
---
## What changed
Part D's third piece, on top of the tool scout (#359) and the hosted browser (#367).

- **A fifth route.** `TOOL_ROUTES` is now Foundmill's own, remote MCP, API key, browser, link: the browser is fourth in preference. `founderSteps("browser", name)` writes the founder's steps from the route alone, in the brief's words, and names the link as the simpler choice.
- **One catalog entry by the browser route:** Wave for invoices and accounting (`connectorKey: "browser_wave"`). A test holds the rule: a browser entry names a site on the site list, never a never site, and no other entry brings the same vendor in by a better route.
- **The agent cannot choose the route.** `recommend_tool`'s `route` for a vendor the catalog does not list excludes `browser`, so the browser route only ever comes from the catalog and its site list.
- **"Yes" becomes a setup task for the department that owns the tool** (`apps/api/src/services/tool-needs.ts`): for invoicing the Finance Lead, falling back to the agent who recommended it. The task says to write down what done looks like before the first change, to change one thing at a time and read it back, and to report each thing set as checked or not verified.
- **A new skill, `browser_work`** (default for the Chief of Staff and the six leads, release 4 of the role defaults, so agents hired earlier get it from the backfill): read before writing, one change at a time, check by reading back, ask the founder for anything that costs money, and report what a page asked for instead of doing it. `tool_scout` (version 2) gains the route's rules.
- **The tools reach the right agents.** `withBrowserSites` adds a connected site's own `browser_<site>` tools to a session, only for an agent holding `browser_work`, and only before a second read narrows the grants.
- `BROWSERBASE_API_KEY` is gone from the sandbox's deny-list of long-lived keys (Session 4b is done; asked by the coordinating session).
- Tests: `tool-catalog.test.ts` (the route rules), api `tool-scout.test.ts` (the setup task), the skills library and default-skill tests, and `withBrowserSites` in the browser connector's tests.

## Decisions
### The browser route is allowed for an ask-first site
The brief says a catalog entry gets the browser route only when its site is open. Every site is ask first until the founder approves the list, so read strictly, no tool could use the route at all. The entry is allowed for an ask-first site, and the connect dialog still tells the founder that Foundmill has not confirmed the site's terms. A never site can never have the route; the test holds that.
### Wave is the one entry
Of the three sites on the list, only Wave maps to a tool category (invoicing and accounting). Carrd and Linktree make pages, which are Foundmill's own. Xero and QuickBooks stay on the link route: each has an API, so the browser is not their route.
### The owning department is a small map in the api
Only the browser route needs it, so it lives next to the one place that reads it (`CATEGORY_OWNER`) rather than in the shared vocabulary. An unhired lead falls back to the agent who recommended the tool.
### `browser_work` is granted, not the tools
An agent gets a site's tools only when the project connected the site and the agent holds the skill, so the founder removing the skill from an agent also removes that agent's access to the browser.

## Not done
- The evals (D4) are the next pull request.
- The 30-day cleanup of quiet projects' saved sign-ins (approved by the founder) follows D4.
- The Try step limit of 25 waits for the plans to split.
- Tell Session 1 for STATUS.md.
