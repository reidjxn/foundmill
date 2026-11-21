---
date: 2026-11-19
branch: claude/sleepy-goldberg-6fwey0
title: Launch session 1: #238's conflict, #319's red checks, landing-daylight, and STATUS.md rebuilt
areas: [db, docs, evals]
supersedes: ["docs/holistic-plan/STATUS.md as rebuilt on Nov 17"]
---
## What changed
- **#238 (WP-11 T4, T5, T7).** Main took migration numbers 0117 to 0142 while the pull request waited.
  The three advisor migrations are now `0143_function_search_path`, `0144_rls_initplan` and `0145_fk_indexes` (journal idx 120 to 122, each `when` later than 0142's), and the pull request's own log entry says so.
  Main also added four tables with row-level security and no policy (`account_usage`, `project_update_deliveries`, `reports`, `site_address_holds`); the advisor test failed until they joined `SERVICE_ONLY_TABLES`, each with its migration number.
  The whole db package passes locally (2,892 tests), with typecheck and lint. The branch was merged with main, not rebased, to keep its history.
- **#319.** Two failures, both stale words in tests the rename missed: `evals/src/__tests__/mentor.test.ts` still expected the Chief of Staff's role text with "the cycle", and `scripts/plain-language.test.mjs` still expected the glossary word "Cycle" (now "Round of work").
  The evals package, `node --test scripts/*.test.mjs`, banned-terms and us-english pass locally. The "Typecheck, lint, unit tests" check on that pull request is only the roll-up of the two failures above.
- **`claude/landing-daylight`: no pull request.** Its three commits are the daylight hero, the five variants and their end-to-end fixes, which landed on main as #218 (same log file, `world-day`, `landing-variant.ts`); main has since changed the same files (#281, #304), and a merge conflicts in 12 of them. Nothing in the branch is missing from main.
- **STATUS.md** is rebuilt from main to #331, the six open pull requests and docs/log. 68 rows changed state. A table lists the open pull requests and the branches with none, and a second table gives each launch session, with rows for 4b (CLI-Anything) and 5b (MCP and Gmail's scopes).

- **Nov 20 update.** #244 and #300 merged and took migrations 0143 and 0144, so #238's three migrations moved again, to 0145 to 0147, and `owner_plans` joined the service-only list. Rows changed for #244, #300, #337, WP-00 S9, S14 and S17, and WP-06 T11; the sessions table gained Sessions 12 to 15. A log line over 400 characters failed the log-entries test and was split.

## Decisions
### One judgment: LAUNCH_EVALUATION.md is stale on WP-04
It lists WP-04 T2, T4, T7, T9 and T15 as not started. They merged in #277 (log entries `wp04-t2-commit-name-go`, `t4`, `t7`, `t9`, `t15`). STATUS.md says merged and says why it differs; LAUNCH_EVALUATION.md is not edited here, since the founder owns it. Session 6's "company before customer" should drop those five tasks.
### Row states I could not check
States for tasks merged inside a larger pull request (WP-12 T6, T8, T9 in #235; WP-09 T12 to T14 in #251) come from the pull request titles and log entries, not from reading each diff. WP-12 T3 and T8 stay for Session 7 to check against the plan, as it says.
### Commit footer
The commits carry the `Claude-Session` line only. FOUNDMILL.md's session rules keep model names out of anything pushed to the repository, so the `Co-Authored-By` model line was left off.

## Not done
- CI on #238 and #319 after the pushes is not read here; the pull requests' checks are the proof.
- The Unknown section's items (WP-01 T2, WP-05, WP-09 T4's suites, WP-11 T18 step 1) are unchanged: nothing since Nov 17 answers them.
