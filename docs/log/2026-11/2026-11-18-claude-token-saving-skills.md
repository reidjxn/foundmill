---
date: 2026-11-18
branch: claude/token-saving-skills
title: Ponytail and Caveman on every code change, for sessions and for the product's coding agents
areas: [docs, skills]
supersedes: []
---
## What changed
The founder's rule of Nov 18, 2026: no session writes code without the `ponytail` and `caveman` skills, to lower token
use, and the product's own coding agents come with both. CLAUDE.md has the rule. The two skills are copied into
`.claude/skills/` with their licenses, so cloud sessions can load them. WP-06 has a new task, T13, for the product.
No product code changed.

## Decisions
### Caveman shapes chat only
Caveman's own text exempts anything kept outside the chat. The rule says so in CLAUDE.md: code, comments, commits,
pull requests, docs and every string a user reads stay in plain full sentences, so the copy rules still hold.

### Only the two main skills were copied
The plugins switch on through session hooks that a cloud session does not run. The rule tells a session to load both
by name. The plugins' other commands and sub-agents were left out.

### The product side is a task, with an eval before default-on
T13 uses T6's default-skills mechanism and ships default-on only if the eval shows fewer tokens with acceptance
unchanged.

## Not done
- WP-06 T13 itself.
- The upstream commit of each copied skill is not recorded: they were copied from the installed plugins.
