---
name: log-entry
description: Record what a Foundmill change did and its judgment calls in its own file under docs/log/. Use in every change instead of editing docs/PROGRESS.md or docs/DECISIONS.md, which are frozen.
---

# Write the change's log entry

1. File: `docs/log/YYYY-MM/YYYY-MM-DD-<branch>.md`, the branch from `git branch --show-current` with `/` as `-`, the date the branch started. One file per branch; later pushes edit it.
2. Copy the template in `docs/log/README.md`: front matter (`date`, `branch`, `title`, `areas`, optional `pr`, `supersedes`), then `## What changed`, `## Decisions` (one `###` per judgment call), `## Not done`. Lines under 400 characters.
3. Never edit `docs/DECISIONS.md` or `docs/PROGRESS.md`: CI fails the pull request.
4. Check it: `node --test scripts/log-entries.test.mjs`. Find earlier decisions with `node scripts/decisions-index.mjs <words>`.
