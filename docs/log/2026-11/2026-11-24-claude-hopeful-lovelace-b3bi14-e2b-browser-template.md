---
date: 2026-11-24
branch: claude/hopeful-lovelace-b3bi14
title: The hosted browser gets its own E2B template, says why it failed, and promises what it does since #382
areas: [gateway, infra, connectors, dugout, web, evals]
supersedes: []
---
## What changed
The founder's first live connect (Linktree, production, Nov 24, 2026, 14:05 UTC) failed within about 9 seconds with "browser_linktree could not be reached", and no log said why.

- **The likely cause.** The driver ran in E2B's public `desktop` template, which E2B's documentation shows with Python but no Node.js and no browser Playwright drives. Its first command, `node --version`, exited non-zero. The E2B SDK throws `CommandExitError` for a non-zero exit, which is not one of Foundmill's errors, so the gateway answered "could not be reached" and dropped the cause.
- **A template of its own:** `infra/e2b/browser.Dockerfile`, built as `foundmill-browser`.
  - It holds Node 22, playwright-core 1.63.0 in `/opt/fm-browser`, and Playwright's Chromium.
  - It also holds what the `@e2b/desktop` SDK starts: Xvfb, Xfce, x11vnc and E2B's noVNC fork in `/opt/noVNC`.
  - The "E2B sandbox template" workflow takes the Dockerfile as an input (`browser.Dockerfile`), from an allow-list.
  - `E2B_BROWSER_TEMPLATE` left empty now means `foundmill-browser`.
- **The driver.** It reads a command's result whatever its exit code. It uses the template's playwright-core, and installs one only when the template has none (with the registry open, before egress narrows). It launches Playwright's Chromium, then Google Chrome if that fails.
- **The cause is said and logged.** A template missing or refused, a key refused, no Node, a failed install, or a browser that did not start each becomes a plain reason. It is logged on the gateway ("hosted browser: the session did not open") and passed to the api. The gateway's integration routes also log any failure's name and message before answering.
- **The connect dialog's promise** matches #382: "It stops and asks you before it buys, pays, agrees to terms or deletes anything." It replaces "It will ask before it sends, posts, buys or agrees to anything". The site list, the session card and the tool scout's note changed the same way.
- Tests: gateway `browser-e2b.test.ts` (the template's library, the no-Node reason when the SDK throws on the exit, E2B's refusals, no key in a log), and the copy in the catalog, eval, dugout, web and Playwright tests.

## Decisions
### A template, not an install on every session
Installing Node and a browser at the start of each session would download about 200 MB with the registry and a CDN open, every time. A template keeps sessions fast, and lets a session's egress be narrowed to the site from the start.
### Playwright's Chromium, not Chrome
The template installs Playwright's own Chromium, at the version the library expects. The driver still falls back to an installed Google Chrome, so a desktop template with Chrome but no Playwright browser still works.

## Not done
- The template was not built here: building it needs the repository's E2B key (the workflow's secret) and a dispatch, which is the founder's call.
- The first live run is still the founder's: connect Linktree once the template is built.
