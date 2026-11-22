---
date: 2026-11-22
branch: claude/hopeful-lovelace-b3bi14
title: The team works in the founder's own accounts through a hosted browser (Part D, D1 and D2)
areas: [rules, connectors, gateway, policy, db, api, web, dugout, modules, config]
supersedes: ["Never solve CAPTCHAs, evade logins, or scrape against a site's terms."]
---
## What changed
Founder, Nov 22, 2026: when the right tool has no MCP server and no API, the team can still set it up and work in it, in a hosted browser, in the account the founder signed in to. This is the brief's D1 (the rules) and D2 (the browser). D3 (the scout's route) and D4 (evals) follow in their own pull requests.

- **The rules (FOUNDMILL.md).** The Never line on CAPTCHAs is replaced as the brief wrote it (never solve a CAPTCHA, get around a bot check or get past a login; never work in a site whose terms forbid automated use of an account), and an Always rule for the hosted browser is added.
- **The site list** (`packages/connectors/src/browser-sites.ts`): each site's exact admin hosts, the terms line it relies on and the day it was read, and a never list (banks, brokerages, government identity, health records, password managers, and sites whose terms forbid it). Three entries, all `ask_first`: Carrd, Linktree, Wave.
- **The connector** (`packages/connectors/src/connectors/browser/`): one connector per site, `browser_<site>`, so a saved sign-in is one sealed credential per project per site. Eight typed tools, one JSON call per action. Every write is classified from the page before it runs (`classify.ts`).
  The live side runs in an E2B desktop sandbox driven by the gateway (`apps/gateway/src/browser-e2b.ts`); the mock replays recorded pages (`mock.ts`).
- **The gateway** (`apps/gateway/src/browser.ts`, a small change in `pipeline.ts`): `Connector.stepHints` gives the policy the step's own hints, and a website hard stop opens one Inbox item.
- `/v1/browser/sessions|takeover|handback|stop` serve the founder's screens for the api alone. Stop all agents ends a project's sessions.
- **The policy:** a new `unclassified` attribute and `47-unclassified-step.cedar`: a step the gateway cannot classify asks first in every mode, automated included.
- **The record:** migration 0162, `browser_steps`, one row per write and per held step with a PNG of the page before it (`repos.browserSteps`).
- **The founder's screens:** Settings › Integrations, "Add a website the team can work in", with the connect dialog (the plain words, then the live view the founder signs in to); "Working in <site>" cards in Development › Live sessions with Watch, Take over, Hand back and Stop; and the hard-stop note in the Inbox with the page before the press, its address and any amount.
  Components in `packages/dugout/src/components/browser` with stories.
- **Limits:** `BROWSER_LIMITS` in packages/config (20 minutes and 80 steps a session, 15 minutes for a sign-in, 10 sessions at once across Foundmill, 2 per project, an Estimate per browser hour).
- Tests:
  `browser.test.ts` in connectors (classifier, site list, recorded pages, sign-in and saved sign-in), gateway `browser-e2b.test.ts` (the E2B driver over a fake sandbox).
  Gateway `browser.test.ts` (the pipeline in every mode, the founder's routes, Stop all agents, the Inbox item), api `browser.test.ts`, the db repo and cross-tenant specs, web and dugout component tests, and the Playwright spec `e2e/browser-sites.spec.ts` at 1280 px.

## Decisions
### E2B in place of Browserbase (founder, Nov 22, 2026)
The founder's decision, in their words: "yes, switch to E2B and drop Browserbase." E2B is already paid for; Foundmill registers no Browserbase account, and every Browserbase name, key and dependency is gone.
The live driver is the gateway's (`apps/gateway/src/browser-e2b.ts`): one E2B desktop sandbox per browser session, its own kind, never the project's CLI-Anything sandbox. It starts able to reach the npm registry only, installs playwright-core 1.63.0, and narrows its egress to the site's hosts and their subdomains before the browser starts.
A small server inside the sandbox drives the visible Chrome on 127.0.0.1; the gateway reaches it only through E2B's command API. The live view, Take over and Hand back are E2B's desktop stream with its generated password, and the console frames only an address on E2B's own sandbox hosts.
A sandbox asks for its session's limit plus a minute and never more than 55 minutes (E2B Hobby caps one at an hour). Nothing solves a CAPTCHA: the page reports a bot check and the agent hands it to the founder.
The backstop on cost is the E2B team's spending limit the founder set (about $100 a month), under `BROWSER_LIMITS` (10 sessions at once, 2 per project, 20 minutes each; the founder confirmed 10).
### The saved sign-in is the browser's own state, sealed by Foundmill
With no provider-side context, the saved sign-in is the browser's cookies and storage, exported when the founder presses Done and sealed in the vault as the integration's credential (at most 512 KB). Nothing stays at E2B: the sandbox is killed when its session ends. Disconnecting revokes the credential.
### Each site is its own connector
A saved sign-in is then an ordinary integration credential: sealed in the vault, one per project per site, listed in Settings › Integrations, health-checked ("Sign in again" when the site signed it out), and revoked on disconnect like any credential. No new credential plumbing.
### The step is read from the page, and the strictest hints are the default
The four write tools declare "may send or publish" and `unclassified`, so a call the gateway cannot read asks first in every mode. `stepHints` lowers them per call from the element behind the ref. A hard gate is refused again inside the handler, so no path presses one.
### The classifier does not trust the page's words
The label is one signal of several: the page's address, a link's address, the fields of the form, money shown next to the element, and look-alike letters. Words that say a charge is coming hold any press, whatever its label. The cost is that some harmless steps wait for the founder (saving a draft invoice whose form shows "Amount due"); that is the fail-closed side.
### Exact hosts, no subdomains
On many sites a subdomain is a page one of the site's users wrote. Sites are matched on their exact admin hosts, with an optional path prefix where a host also serves users' pages (Linktree's `/admin`). That left Squarespace out: each site's admin lives on its own subdomain.
### Every entry starts as ask first
No site's terms, read on Nov 22, 2026, say an agent may work in the owner's account; Carrd's, Linktree's and Wave's do not forbid it and none has an API that covers setup. Moving an entry to `open` is the founder's approval of the list. Read and left out: Xero, QuickBooks, Tally, Wix, Zoho and Google Business Profile have an API or MCP server;
Gumroad and Substack forbid sharing the account; Etsy's and Canva's terms could not be read. LinkedIn, Instagram, Ko-fi, Big Cartel and Typeform forbid it; Facebook, Threads and X are held with them until the founder decides on social networks.
### Refs name one element of one read
A ref is `p<random>e<index>`, new on every read. An approval or a "this already ran" answer for one ref can never be spent on another page or session, and the live driver refuses to press when the element carrying the read's stamp no longer says what was classified.
### Only the founder answers a step on a website
`decisionTypeFor` returns null for a connector with `stepHints`, so no agent named in Team › Responsibilities approves one.
### A website hard stop opens an Inbox item
A hard gate otherwise stays a note with no Inbox item, and the founder sees approvals only through Inbox items, so a stop would have reached nobody. For a website stop only, the gateway opens the item and the approval stores the site, the address, the label, the amount and the step id, never the ref.
Its two answers ("I pressed it myself", "Leave it") press nothing: the gateway refuses the step whatever the answer.
### What a page writes never reaches the founder's task as its own sentence
The task shows only the first few plain words of the label and the address without its query, and the agent's error messages name no page text.
### The live view is never stored
The api's first connect step returns before any database write, so no integrations row or audit detail holds the address. A reader who may not change things gets sessions without it, because whoever holds the address controls the page.
### Retention and export follow the project's other records
Screenshots can hold other people's personal data, so `browser_steps` follows `tool_needs` and `audit_log`: kept as long as the project, deleted with it (business_id cascades), and in Export everything without the PNG bytes, like `post_media.content`.
### Sessions live in the gateway's memory
`BrowserSessions` is one map per process, so the gateway must run as one instance for the browser. shortcut, written in `sessions.ts`: move the provider's session id to Redis before the gateway is scaled out.
### The security review
A review before the pull request found four ways past a hard gate (money ignored next to a reversible word, links treated as reads, unknown steps routed to an agent approver, refs reused across sessions).
It also found seven serious gaps (the page changing between read and press, codes and PINs, labels such as "Disable two-step verification", URL shapes the never rules missed, off-site sign-in pages, users' subdomains, sessions never cleaned up).
All are fixed, each with a test.

## Not done
- The founder answered on Nov 22, 2026: the five social networks stay on the never list (they come in through integrations), 10 sessions at once is enough, and quiet projects' saved sign-ins are deleted after 30 days. That cleanup and the Try limit of 25 steps (once plans split) come as follow-up changes; the pull request merges with the three sites ask-first.
- No Estimate is shown before a long browser task; browser minutes are booked to the usage ledger with each call (Estimate).
- `upload_file` answers "not available" until a project-files source is wired to `BrowserHost.projectFile`.
- Deleting a saved sign-in after 30 quiet days is not built yet (approved by the founder, a follow-up).
- The admin hosts and paths of Carrd, Linktree and Wave are as known on Nov 22, 2026, not checked with a real account.
- The E2B driver is tested over a fake sandbox only. The first live run is a founder step: it needs E2B's `desktop` template (or `E2B_BROWSER_TEMPLATE`) to have Node and Google Chrome, which E2B documents but this session could not check.
- Playwright covers connecting; Take over, Hand back and the hard-stop note are covered by component tests and stories, because the mock stack seeds no running session.
- Hardening the review left for later: a `select` that submits when it changes, and a session that starts in the instant after Stop all agents.
- Tell Session 1 for STATUS.md.
