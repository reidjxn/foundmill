---
date: 2026-11-22
branch: claude/hopeful-lovelace-b3bi14
title: The hosted browser's evals and tests, and quiet saved sign-ins deleted after 30 days (Part D, D4)
areas: [evals, gateway, api, orchestrator, connectors, shared, web]
supersedes: []
---
## What changed
Part D's last piece. The brief's D4 list, case by case, and where each is proved:

- **A website-only pick, end to end:** the tool scout's live case `tool_scout.website_only.browser_route` (Wave, by the browser route) and its offline twin; gateway `browser.test.ts` "a website-only pick": the note's route, the founder's sign-in in two steps (nothing saved before Done), a three-step setup with each change read back.
  The agent's report of what was set and checked is the live case `browser_work.report.marks_unchecked`.
- **A pick with an MCP server or an API never gets the browser route:** `tool_scout.has_mcp.never_by_browser` (HubSpot stays on its own sign-in), and the catalog test that no vendor with a better route has a browser entry.
- **A never site:** never in the catalog (catalog test), and `open_page` on it is refused whatever the token says (gateway, #367).
- **"Buy now", and the same step labeled "Continue":** held in every mode with one founder note, the screenshot and the amount (gateway and connector, #367); the agent itself does not press it (`browser_work.paying_button.not_pressed`).
- **A page that tells the agent what to do:** reported and not followed (`browser_work.injection.reported_not_followed`; the page's sentences reach the agent as `pageAskedMeTo`, #367).
- **A bot check or a sign-in wall mid-task:** `request_founder`, never an attempt (`browser_work.bot_check.hands_to_founder`; gateway, #367).
- **A redirect off the site, a signed-out saved session, disconnecting:** gateway and connector tests (#367).
- **Stop all agents ends a running session within seconds:** gateway, under 5 seconds.
- **Cross-tenant:** a second project with its own saved sign-in. Each session opens on its own project's sign-in, and one project's stop leaves the other's session running.
- **Playwright at 1280 px:** the connect dialog (#367), and now the live view with Take over and Hand back and the hard-stop note in the Inbox, with the api's answers stubbed in the spec.

**Quiet saved sign-ins are deleted** (founder, Nov 22, 2026). A new saved sign-in is stored with a date 30 days out, and every use moves the date to 30 days from then, at most once an hour (`BrowserHost.used`).
The nightly credential scan sends the founder one decision note 7 days before the date, "Keep your saved sign-in to <site>?", which the founder also gets by email as a waiting decision. "Keep it" gives another 30 days; "Let it go" changes nothing.
On the date the scan deletes the sealed sign-in, marks the site "Sign in again" and writes an audit row (`browser.sign_in_deleted`). Tests: orchestrator `activities.test.ts`, api `browser.test.ts`, gateway `browser.test.ts`.

## Decisions
### The live evals check single decisions, not a whole session
Each `browser_work` case gives the agent the page it just read (the mock's recordings) and asks for its next step as JSON. One decision per case is cheap, repeatable and says exactly what went wrong. The whole three-step setup is proved offline through the gateway, where the result does not depend on a model.
### The cleanup rides on the credential's own expiry
A saved sign-in is a credential, and credentials already carry an expiry that the nightly scan reads. Setting it to the last use plus 30 days needed no new table and no new schedule. The scan's existing 14-day `credential.expiring` event is still written, as for any credential.
### The warning is a decision note
The founder notification job emails waiting decisions, so one note is both the in-product question and the one email the founder asked for. A note already waiting is not written again.
### This rides with D4 in one pull request
Both are small and in the same area, and one pull request spends one CI run.

## Not done
- The live evals were not run here: no model key in this session. Their offline twins pass.
- The Try step limit of 25 waits for the plans to split.
- Tell Session 1 for STATUS.md.
