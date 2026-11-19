---
date: 2026-11-19
branch: claude/foundmill-md-mcp-cli-hub
title: The rules file is FOUNDMILL.md; SaaS tools come in through MCP; agents run software through CLI-Anything; the launch plan
areas: [docs, skills]
supersedes: []
---
## What changed
The founder's decisions of Nov 19, 2026. The root rules file is renamed from CLAUDE.md to FOUNDMILL.md. Two rules
change: SaaS tools that sign in with OAuth come in through the vendor's own MCP server, with the gateway as the only MCP
client (this replaces "vendors' own MCP servers are not plugged in"); and agents run open-source software through
CLI-Anything (CLI-Hub packages) inside the project's sandbox, as gateway tools. The launch plan is in
docs/holistic-plan/LAUNCH_EVALUATION.md, checked against main to #330. No product code changed.

## Decisions
### A one-line CLAUDE.md stays
Claude Code loads only files named CLAUDE.md. The root CLAUDE.md holds `@FOUNDMILL.md`, so every session, cloud or
desktop, still loads the rules. The rename is its own commit, so `git log --follow FOUNDMILL.md` keeps the history.

### What was repointed and what was not
Repointed: the skills, the workflows in .claude/workflows, docs/ARCHITECTURE.md, docs/DESIGN.md, docs/NETWORK.md,
docs/HOLISTIC_PLAN.md, the holistic-plan prompts and package files, STATUS.md and the package guides. Left as they
are: the package guides' own names (apps/*/CLAUDE.md, packages/*/CLAUDE.md), the audits and WP-01 (records of their
day), docs/log, docs/BUILD.md, and the code comments that cite "CLAUDE.md": they still lead to the rules through the
one-line file, and changing about 45 source files would collide with the parallel sessions.

### The orchestrator's CLAUDE.md is a founder's file, not ours
apps/orchestrator leaves CLAUDE.md out of a founder's repository checkout as a start-up file. That is about the
founder's repository and stays as it is.

### A developer app for an MCP server's sign-in is allowed, with the founder
Some vendors' MCP servers need an OAuth client registered by Foundmill. The rule allows it, one vendor at a time,
with the founder.

### The policy of a remote tool is Foundmill's
A remote server's annotations are a hint. Foundmill's own list per server decides; a tool on no list asks first, and a
hard-gate tool is denied.

### The plan adds two sessions
CLI-Anything (Session 4b) and MCP (Session 5b) are their own sessions, each owning the files it would otherwise share:
4b owns infra/e2b and packages/sandbox, 5b owns the gateway's pipeline and MCP files.

## Not done
- The CLI-Anything and MCP work itself (Sessions 4b and 5b).
- STATUS.md is not rebuilt yet (Session 1, next).
- Gmail's restricted scopes need Google's verification and a yearly security assessment: the founder decides whether
  Gmail waits until after the launch.
- The source, version and license of each CLI-Hub package are not checked yet; Session 4b checks them first.
