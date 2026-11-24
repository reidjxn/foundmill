---
date: 2026-11-24
branch: claude/launch-s28-nightly-fixes
title: Tonight's red nightly evals - a self-blocked task names its unmet lines, a post holds to two sentences, two checks that misread honest answers
areas: [evals, orchestrator, agents]
supersedes: []
---
## What changed
- Outcome eval `researcher.unmet_line_is_not_done` (run 45204369829): the live researcher did not claim the send; it blocked the task itself and paraphrased line 2 ("Criterion 2 is not met"). The founder saw no quoted line.
- `session.ts` now builds an agent's block summary with `agentBlockSummary`: the agent's reason, then each acceptance line not marked met, quoted once ("Not counted as met yet: “…”"). A line the reason already quotes is not repeated.
- `ACCEPTANCE_BRIEF` adds one sentence: an agent that blocks instead names each line not met.
- Go-to-market run 45166145671, post draft pd07 and pd08: the drafts had three sentences, but the product's check had no sentence rule, so its one retry never fired. `checkPostDraft` now refuses a draft with more than two sentences (`too_many_sentences`, with its retry note). `postSentences` does not split after a short title ("Dr.", "St.") and does not count a trailing hashtag.
- Post draft pd04: the eval's own word check left out the page's stage, which the request gives the model. It also counted "Ember's" as a word that was not in the inputs. The check now counts the stage and strips the possessive.
- `channel_creative.print_offline`: "Nothing has been booked, bought or signed" tripped the banned phrase "has been booked". A `mustNotContain` phrase now does not match right after "nothing", "not", "never" or "no".

## Decisions
### Fix the summary, keep the check
The check is right: a founder should read which line waits. The agent's honest paraphrase was not enough, so the platform quotes the lines, which is deterministic. Without a `complete_task`, no line was claimed met, so all unmet lines are listed as "not counted as met yet". That wording is true even when the agent believes line 1 is done.
### Two checks were wrong, and why
The pd04 check graded a fact given as input (the stage) as invented. The print check graded a denial as the claim it denies. Neither change lets a claimed booking or an invented word through.
### Not S22's or S27's files
`session.ts` changes only the summary of the agent-block path; `blockedReason` stays `dependency` (S27's T20 measures those). The golden suite is untouched.

## Not done
- No live run from this session: the coordinating session dispatches `evals-outcomes.yml` and `evals-go-to-market.yml`.
