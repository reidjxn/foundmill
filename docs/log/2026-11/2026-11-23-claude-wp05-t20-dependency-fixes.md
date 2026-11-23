---
date: 2026-11-23
branch: claude/wp05-t20-dependency-fixes
title: WP-05 T20, the first fixes from the dependency blocks
areas: [gateway, orchestrator, docs]
---
## What changed
The coordinating session read the last 60 agent-written "dependency" blocks on real projects from production (read-only, Nov 23, 2026; the newest is from Nov 17) and grouped them into five themes. Launch Session 27 checked each against the code.

1. `read_product` came back empty (about 12 blocks: "returned an empty quarantined payload", "no specification content").
  Cause: `read_product` is untrusted content, so an agent that holds outbound tools got the quarantined reader's digest: at most 600 characters of summary, with every section and block id gone.
  New: the gateway treats `read_product` as the business's own records (`FIRST_PARTY_PLATFORM_TOOLS` in apps/gateway/src/pipeline.ts), like the Code tab's repository.
  The content arrives raw, still inside the untrusted envelope and its notice, and addresses in it are still recorded as first seen in untrusted content. Test in builtins.test.ts; it fails without the change.
2. No web search or fetch (about 8).
  Not code: `web` is in the research and legal templates, and it went live on production's gateway, api and orchestrator on Nov 17, 2026 at 08:36 UTC (docs/DEPLOY.md).
  Before that, WP-05 T1 refused the mock as not connected. The blocks came before or on that day.
3. Missing tools (about 15).
  save_report (T3), create_entity (WP-07 T1) and run_checks (a platform duty the Planner drops) are covered.
  A task that blocks for a tool nobody has is parked after one attempt and its dependents freed (T18, `stopToollessTasks`).
  One production phrase slipped its matcher: "I can't register a business source. My tools are the task board, …". `lacksTool` now matches "my tools are"; there is a case in dispatch.test.ts.
4. Cascades (waiting on a peer agent, a task id "not part of this business"). Not changed; kept in T20 below.
5. Missing data (Eurostat volumes, a page the demo could not see). With web live the research agent can fetch public data; T12 already tells an agent what is not connected. Not changed.

## Decisions
### The specification is first-party
Spec blocks are written in Foundmill: by the founder, by an accepted proposal, by an agent's plan or by the project's foundations. That is the same footing as the Code tab's repository, which agents also write. The digest made the tool useless to every agent with outbound tools, and propose_spec_change needs the block ids. Outbound actions stay gated by policy as before.

### Source titles stay out
A security review of the change found that a source's title is the outside page's own `<title>`, copied verbatim (the Source Watcher, research citations). The first-party `read_product` lists sources by id and address only; the test seeds a hostile title and checks it never reaches the agent. A custom MCP server cannot pose as `platform`: every one has the key `mcp_custom`.

### Cascades wait for data
Parking a task that waits on another agent would be a new rule about when a team gives up on a peer. The newest block is from Nov 17, before most of WP-05 was live, so this waits for the re-measure.

## Not done
T20 stays open: the re-measure needs new sessions on this code. Cascades and missing data are listed there.
