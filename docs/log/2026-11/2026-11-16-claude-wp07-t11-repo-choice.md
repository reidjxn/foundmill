---
date: 2026-11-16
branch: claude/wp07-t11-repo-choice
title: A founder with a repository chooses it from Settings, without Builder view
areas: [web, settings]
supersedes: []
---
## What changed
Settings › Integrations shows a "Code repository" panel once GitHub is connected: the repository field, the switch "Let the team push its work to this repository" (off unless turned on), Save and Forget, and the empty-repository sentence. It uses the existing `dev.code.repository` and `dev.code.setRepository`; no new procedure.
The "Finish connecting GitHub" hint now says "choose the repository below" instead of naming the Code tab, which Builder view hides.
Tests: `github-install.test.tsx` (panel renders, saves with and without the switch, forgets, absent when disconnected), `code.spec.ts` (reachable with Builder view off).

## Decisions
### A text field, not a select
The work package says "repository select", but no procedure lists the installation's repositories. The Code tab's dialog takes `owner/name` or an address; the panel does the same. A list needs a new gateway read; left for later.
### The panel is a component of its own, not the Code tab's dialog
The dialog lives in packages/modules and is not exported to apps/web; copying its fields into a small panel was less code than a new export path. The Code tab is unchanged.

## Not done
Choosing from a list of the installation's repositories. T12 (previews) is separate.
