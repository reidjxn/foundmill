---
date: 2026-11-24
branch: claude/eval-round6
title: Round 6 toward 100% twice - two checks that failed correct replies, and the about text the hosted-page rubric grades
areas: [evals, agents]
supersedes: []
---
## What changed
- Read live run 45408633306 (after #404): golden 58/60 and Source Watcher 3/3.
  - The length rewrite fixed all three length failures, and the dieline case passed.
- channel_social.own_buffer_account 0.00. The agent wrote "Nothing from pr_buf_4 (milestone mil_12, the approval workflow launch) has been published yet." That is a correct denial.
  - The `claims` negation window failed on the comma inside the parenthetical, and on its length.
  - Parentheticals are now dropped before the window is read.
  - A claim with a parenthetical is still a claim: "Good news (milestone mil_12, not late) has been published." fails. Tests cover both cases.
- channel_seo.hosted_page 0.00. The agent wrote "search data isn't connected", and the check wanted the exact words "not connected".
  - The check now accepts either form (`any`).
  - The rubric grades a longer about text, which the prompt never asked for. The prompt now asks for one, built only from facts on the page and in the positioning notes.

## Decisions
### Two checks corrected, with the reason
- Both replies said the right thing. The checks failed them on form: a parenthetical in a denial, and a contraction.
- Neither change lets a claim through. The forbidden phrases and the required meaning are unchanged.

## Not done
- No live run.
