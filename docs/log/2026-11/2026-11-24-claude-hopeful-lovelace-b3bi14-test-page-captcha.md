---
date: 2026-11-24
branch: claude/hopeful-lovelace-b3bi14
title: Linktree out, Foundmill's own browser test page in, and the founder solves CAPTCHAs in the live view
areas: [rules, connectors, sites, gateway, api, shared, evals, dugout, web]
supersedes: ["Never solve CAPTCHAs, get around a bot check, or get past a login."]
---
## What changed
Founder decisions of Nov 24, 2026, confirmed in this session.

- **Linktree is gone** from the site list, the tests and the stories.
- **Foundmill's own test page** stands in for it: a few static pages the sites app serves at `browser-test.<SITES_DOMAIN>` (`apps/sites/src/browser-test.ts`), on the site list as `foundmill_test` (`testOnly`).
  - The pages are a settings form whose "save" shows the values back, a plan page with a paying button, and a page that looks like a bot check.
  - No script and no cookie; the address `browser-test` is reserved for sites.
  - Only the operator account (`OPERATOR_USER_IDS`) sees it in Settings or can connect it. The browser evals now name it instead of a vendor's site.
- **The founder solves CAPTCHAs** (founder: "ok, user solves captchas, no auto-solving").
  - When a page shows a bot check, or asks for a sign-in mid-task, the session pauses for the founder, and the team's next step waits.
  - The Chief of Staff writes one decision note, "<site> needs you to solve a check", which is emailed and pushed like any waiting decision.
  - "I've done it, carry on" hands the page back to the team; "Stop for now" ends the session.
  - Nothing ever solves a check itself. FOUNDMILL.md's rule is rewritten in the founder's words, and a site that needs a check is no longer refused for that reason.
- Tests: sites `app.test.ts` (the test page), connectors (the pause and the one call to the host), gateway (one note, not repeated while it waits), api (the answer hands back or stops; only an owner, cofounder or admin answers).

## Decisions
### The test page lives on the sites app
It is already the public, static, script-free server Foundmill runs on its own domain, so a test page there adds no new service and nothing that runs. Its "save" uses the address instead of storage, which is enough to read a change back.
### The entry names browser-test.foundmill.app
The site list is data with no environment, and the production sites domain is foundmill.app. A stack on another sites domain needs its own entry to run the live check.
### The pause is the platform's, not the agent's
Before this, the agent had to notice a bot check and call `request_founder`. Now any read that finds one pauses the session and tells the founder, whatever the agent does next.

## Not done
- "Add any website" (the founder types an address, an automatic terms check, a starter list of sites whose check passes) is the next pull request.
- The test page has not been opened on production; it serves once this merges and the sites app deploys.
