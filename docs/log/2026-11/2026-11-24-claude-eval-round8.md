---
date: 2026-11-24
branch: claude/eval-round8
title: Round 8 toward 100% twice - the component check failed a plan that denied hex colors
areas: [evals]
supersedes: []
---
## What changed
- Read live run 45418123696 (after #409): golden 59/60, Source Watcher 3/3.
  - Both round 6 flips pass (hosted_page, logistics.freight).
- frontend_engineer.component 0.00. The plan said "Reuse Dugout components and tokens only; no ad-hoc styling or hex values." The check forbade the bare term "hex" anywhere, so the plan's own denial of hex colors failed it.
  - The check now uses `claims` ("hex" and "tailwind config" fail only where they are not denied in the same clause), as own_buffer_account and merge_queue already do.

## Decisions
### One check corrected, with the reason
- The case measures whether the plan uses raw colors. It does not measure whether the plan mentions that it avoids them.
- Saying "hex" without a negation still fails, and the rubric line on tokens only is unchanged.

## Not done
- No live run.
