---
date: 2026-11-19
branch: claude/sharp-shannon-0a434k
title: Coding agents start with Ponytail and Caveman (WP-06 T13)
areas: [agents, skills, evals]
supersedes: []
---
## What changed
- Two library skills in `packages/agents/skills/engineering/`: `ponytail` ("Smallest complete change", from ponytail, MIT) and `caveman` ("Short working turns", from caveman, Apache-2.0). Both are written in Foundmill's words and follow the authoring spec. Both rate as Execution skills and improve `cost_efficiency`; Caveman also improves `communication`.
- Both have the same `default_for` as `coding_discipline`: the 11 templates whose `taskKinds` include `code`. T6's mechanism attaches them at hire, at commit and by backfill, so there is no second mechanism. They are removable like any default.
- `caveman`'s body says that anything a founder or an outside person reads (notes, reports, hand-backs, pull request text, commit messages, comments, documents, email, the public page) stays in plain, full sentences, and that it applies to working turns only.
- The two sources are in `skills/THIRD_PARTY_NOTICES.md`. The spec asked for a notices file inside `engineering/`, but the generator reads every file in a category folder as a skill, so the one top-level file carries them.
- The tests count 85 skills and check the three defaults lists and the plain-sentences rule in the body.
- New eval: `evals/src/skills/coding-skills.ts` runs three small coding tasks with and without the two skills (the request differs only by the Skills section). It records output tokens and acceptance (the right change, only the allowed files, a test, a plain hand-back). `verdict()` says ship only if tokens fall and acceptance does not.

## What #311 and #327 had done
#311 (Nov 18) added the two skills to `.claude/skills/` for sessions working on the repo, the rule in FOUNDMILL.md, and this task. It changed no product code. #327 (T6) built the default-skills mechanism this task uses. Nothing for the product's coding agents existed before this.

## Judgment calls
- The skill text was not copied from `.claude/skills`: those are written for a person's Claude Code session. These are rewritten for an agent that works alone and cannot ask a person in chat.
- The description of `ponytail` avoids "write ... review" because the house-rules screen reads that as inventing reviews.
- Not wired into `evals-models-live.yml`: that would add live minutes and spend, and the founder asked that workflows not be changed for this. Run it with `MODEL_MODE=live pnpm --filter @foundmill/evals exec vitest run src/skills/coding-skills.eval.test.ts`.

## Not done
- **The live eval has not run** (no model key in this session). The plan says default-on ships only if tokens fall and acceptance does not. Do not merge until it has run. If the verdict is no, empty the `default_for` line of both files, run `pnpm --filter @foundmill/agents skills:build`, and keep the skills as library choices.
- Existing coding agents get the two skills at the next boot backfill only if the release number moves: every skill is `defaultSince: 1` (T6's log), so only new hires receive them until a `default_since` field exists. Done-when "a newly hired coding agent lists both skills" holds; the backfill part does not yet.
