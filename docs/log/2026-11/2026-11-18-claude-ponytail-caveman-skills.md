---
date: 2026-11-18
branch: claude/brave-ptolemy-5nq5wq
title: The ponytail and caveman skills, for every session
areas: [skills, docs]
supersedes: []
---
## What changed
- `.claude/skills/ponytail`: the smallest complete change, from github.com/dietrichgebert/ponytail at 96608e07 (MIT).
- `.claude/skills/caveman`, `ultracave`, `megacave`: terse replies, from github.com/JuliusBrussee/caveman at a1928947 (Apache-2.0). The last two are the modes `caveman` hands off to (`/caveman ultra`, `/caveman wenyan`).
- `THIRD_PARTY_NOTICES.md` lists them. CLAUDE.md's Always list gains the founder's rule of Nov 18: both skills before any code or change, in every session, and no code from a session that cannot load them.

## Decisions
- **Only the core skills.** Ponytail's help, audit, debt, gain and review add-ons, and Caveman's 18 other skills, hooks, CLI and runtime were left out. All four folders are plain Markdown, read before copying: no scripts, no network calls.
- **Cloud and desktop:** project skills in `.claude/skills/` load in both, once the change is on the branch a session starts from.

## Not done
- **Foundmill's own coding agents:** giving them these skills pre-installed is product work (the agents' sandbox and skill library), left for the coordinating session to schedule.
