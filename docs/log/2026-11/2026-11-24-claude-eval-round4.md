---
date: 2026-11-24
branch: claude/eval-round4
title: Round 4 toward 100% twice - a negation check that missed a denial, and three prompts that left out what their rubrics grade
areas: [evals, agents]
supersedes: []
---
## What changed
- Read live run 45385411524 (after #399): golden 56/60 (#372 added `channel_seo.hosted_page`), Source Watcher 3/3 for the first time.
- channel_social.own_buffer_account 0.00: the agent opened with "Nothing from pr_buf_4 (milestone mil_12) has been published yet." That is a correct denial, but `claims` looked only three words back for the negation.
  - The negation now counts anywhere earlier in the same clause, within 60 characters; clause punctuation (, . ; : ! ?) ends it.
  - "No problem, the post is published." is still a claim and still fails. Tests cover both.
- channel_paid_ads.kill_switch 0.68: the rubric grades a shift toward cmp_8 within its caps with the arithmetic, but the prompt never said what cmp_8 spends a day. The agent assumed it was at its cap.
  - The prompt now gives the spend (about £40 of its £60 a day).
  - It also asks for the arithmetic in the same founder task as the pause.
- channel_direct_mail.audience 0.00 (344 words for 330): the prompt asks for eight parts under 300 words. It now says each part takes at most two sentences; the limit is unchanged.
- channel_seo.hosted_page 0.00 (new in #372): the rubric grades a pitch under 55 characters, which the prompt never stated.
  - The check wanted "not connected", but the prompt said "there is no search data tool". It wanted "waits", but the agent wrote "should wait for the founder".
  - The reply ran to 296 words, and the prompt had no length at all.
  - The prompt now states the 55-character pitch, that search data is not connected, that it should say what waits for the founders, and a 200-word length.
  - The check term is "wait", which covers waits and waiting.

## Decisions
### Two checks corrected, with the reason
- The negation window: the old three-word window missed a denial with ids in between. Clause punctuation keeps a claim after "No problem," a claim.
- "waits" to "wait": the word's inflection is not what the case measures; whether the proposal waits for the founders is.

## Not done
- No live run.
