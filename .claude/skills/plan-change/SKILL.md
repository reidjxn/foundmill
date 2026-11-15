---
name: plan-change
description: Plan a Foundmill change before writing code — read the right docs, check other sessions' branches for overlap, and write a short plan with the definition of done. Use at the start of any feature, fix or refactor that touches more than one file.
---

# Plan a change

1. **Read only what applies.** CLAUDE.md always. Then the sections the change touches: `docs/ARCHITECTURE.md` (ownership and contracts), `docs/DESIGN.md` (UI), `docs/THESIS_REVIEW.md` §13 (roadmap), and the decisions on the topic: `node scripts/decisions-index.mjs <words>` prints the matching decisions with their line ranges in `docs/DECISIONS.md` (add `--sub` for their parts), so you read those ranges instead of the whole file. Do not re-decide a recorded decision.
2. **Check for overlap with other work.** `git fetch origin --prune`, then for each recent unmerged branch: `git diff --name-only origin/main...<branch>`. If another branch changes the same files, the same migration range or the same feature, stop and agree the split with its owner before writing code.
3. **Migrations.** Take the next free number after every open branch's migrations, not just main's.
4. **Write the plan** (in the conversation, not a file): the files to change, the tests and evals to add, what a founder will see, and which items of the definition of done apply (`verify-done`).
5. **Judgment calls** go in the branch's file under `docs/log/` (skill `log-entry`), in the same change.
