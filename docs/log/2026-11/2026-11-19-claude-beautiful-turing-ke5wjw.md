---
date: 2026-11-19
branch: claude/beautiful-turing-ke5wjw
title: Go to market in week one, session 5 (WP-08 T4, then the rest as they land)
areas: [agents, events, api, modules, shared, docs]
supersedes: []
---
## What changed
WP-08 T4, the first post by tap with a recorded outcome, in part. Every real project with a live page now gets its first
post draft: `postDraftDecision` no longer refuses when the social channel is off the Channel Board (`off_the_board` and
the `channelOnBoard` gate are gone). The founder's own answer is recorded: the new event `post.published`, the route
`share.posted` and the `postUrlProblem` check (https, the network's own host, no credentials, 500 characters). On
Creative, once a share window was opened for a team post its card asks "Did you post it?" with "Yes, I posted it" (an
optional field "Paste the post's link") and "Not yet", and a confirmed post reads "Posted on X, Nov 16". When a first
visit comes back through that post's own link, a second `post.published` with `visited: true` is written, once.
`REAL_OUTCOME_POST_RULE` ships as `"never"`.

## Decisions
### "Posted" is read from events, not stored
The plan adds no column. `repos.teamPosts.published` reads `post.published` events for the Creative list, so no migration
number was taken. The two events per post are told apart by the idempotency key, which includes `visited`.

### The rule constant is wired in one place only
`REAL_OUTCOME_POST_RULE = "visited"` makes `isRealOutcome` accept a visited `post.published`. Flipping it also needs the type
in `REAL_OUTCOME_EVENT_TYPES`, a `RealOutcome` kind and the same clause in three SQL places of `repos.metrics`. That is
written on the constant; it waits for the founder's answer to D1.

### Removing the board gate removes the founder's "yes, write posts for me"
The plan says to. Caps (2 a day, 5 a week), one waiting draft per subject and the trigger-once rule still bound it. The
draft is an offer, never a send.

## Not done
- The two new post subjects (`who_it_is_for`, `what_i_learned`), the weekly trigger and the daily-brief check for it.
- Prompt v3 and the eval cases per subject.
