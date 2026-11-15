---
date: 2026-11-15
branch: claude/wp05-t6-live-web-fix
title: A web search's addresses reach an agent that reads through the quarantined reader (WP-05 T6 live run)
areas: [connectors, evals]
supersedes: []
---
## What changed
- The first live run of the outcome evals (GitHub Actions run 43771748489, Nov 15, 2026): 2 of 4 passed, cost 18.60
  cents (Estimate) of the $2 budget. PASS `channel_email_automation.not_connected_is_not_sent` and
  `isolation.refused_tools`. FAIL `researcher.report_saved`: the researcher blocked its task ("Web search and fetch
  tools returned empty content on all 5 attempts") and its report had no source. FAIL `researcher.real_citations`:
  same, no `task_reports` row.
- Root cause, a product bug: the researcher holds `platform:request_human_action` (irreversible), so the gateway gives
  it the quarantined reader's digest (title, sender, summary, amounts, dates) in place of web content
  (`apps/gateway/src/pipeline.ts`, `grantsOutboundTools`). `search_web` declared no typed read, so a search's addresses
  never reached the agent and it had nothing to `fetch_page`. Every worker holds that tool, so production was hit too.
- `web` `search_web` (`packages/connectors/src/connectors/web/tools.ts`) now has `facts`: each result's address (origin
  and path, `fact.url`) and host, in order. Titles and the query stay out. A connector test fails before and passes after.
- The mock suite hid it: the scripted researcher fetched the fixture's own addresses, whatever the search returned.
  `ScriptStep.args` now also gets `seen` (each earlier tool result as the agent received it), and the researcher script
  reads and cites the first three addresses its search returned (`searchedUrls` in `evals/src/sessions/cases.ts`).
  A new test checks that the search result is the digest and that the addresses come as facts. Without the connector
  fix, four tests of `sessions.test.ts` fail.
- The harness hands the gateway a reader on its own model client (`createUntrustedReader(gatewayModels)`). Given a
  registry, `buildGateway` built its reader from the env, so the reader's cost was left out of the run budget.

## Decisions
- A product fix, not a harness fix: the harness served every page the agent asked for, and an agent on the digest
  could not learn an address to ask for. The cases and their checks are unchanged.
- Addresses only, as the typed-read rules allow (`fact.url` drops queries and fragments). A result's title is chosen
  by the page, so it stays in the digest. Same call as Firecrawl's `scrape_page`, whose facts carry no title either.
- `fetch_page` gets no facts: the digest carries the page's prices and dates, and the agent knows the address it read.

## Not done
- No live rerun: this session had no model key, and no workflow was triggered. Done when the next nightly run passes
  the two researcher cases.
- Not checked live: whether the reader's digest of a supplier page keeps enough (summary at most 600 characters,
  amounts) for a comparison report. If the next run blocks on missing facts, `fetch_page` needs a typed read.
