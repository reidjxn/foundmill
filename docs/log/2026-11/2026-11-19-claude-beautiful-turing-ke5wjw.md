---
date: 2026-11-19
branch: claude/beautiful-turing-ke5wjw
title: Go to market in week one, session 5 (WP-08 T4, T5, T12 in part; WP-07 T8 mock-first)
areas: [agents, events, api, modules, shared, connectors, evals, docs]
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
`REAL_OUTCOME_POST_RULE` is `"visited"`, the founder's answer D1 of Nov 16, 2026 (docs/log/2026-11/2026-11-16-claude-wp08-founder-decisions.md): a `post.published` with `visited: true` is a real outcome.

WP-08 T5, the first ten conversations. Distribution gets a first tab, "First ten": ten slots, add a person the founder
knows, "Copy a message" (written by code from the project's one line, nothing sent), a stage from "To ask" to "Not for
them", and "What did they say?", which saves a note beginning "Said: " and moves "To ask" or "Asked" to "Talked". It is
`crm.firstTen.*` over the existing CRM repos (source `first_ten`, role `lead`): no table, no event, no model call.
`repos.positioning.heard` now returns those notes, so `read_positioning` hands agents what real people said.
`DEFAULT_TABS.distribution` is now First ten and Creative (Leads and Campaigns sit under More detail).

WP-08 T12, in part: `evals/src/specificity.ts`, the list `GO_TO_MARKET_EVALS` and the nightly workflow
`evals-go-to-market.yml` (03:00 UTC, live model, the four live suites that exist).

WP-07 T8, mock-first: the Stripe tool `create_payment_link` (real: a price and a payment link on the founder's own
account, idempotent by key; mock: a labeled simulated `buy.stripe.com/test_sim…` link), the capability
`payments.links.create` and the finance lead's grant.

## Decisions
### "Posted" is read from events, not stored
The plan adds no column. `repos.teamPosts.published` reads `post.published` events for the Creative list, so no migration
number was taken. The two events per post are told apart by the idempotency key, which includes `visited`.

### D1 is wired everywhere a real outcome is counted
The coordinating session pointed to the Nov 16 answer, which is on main. The type is in `REAL_OUTCOME_EVENT_TYPES`,
`realOutcomes` returns a `post_visited` kind (behind the Distribution wall, one line in the brief and the week's headline),
and the same clause is in the three outcome places of `repos.metrics`. The clause accepts the second event only: the
one the public page writes when the first visit arrives (or the founder's own, when the visit came first).

### Removing the board gate removes the founder's "yes, write posts for me"
The plan says to. Caps (2 a day, 5 a week), one waiting draft per subject and the trigger-once rule still bound it. The
draft is an offer, never a send.

### First ten: no Today line, no share panel, no `problem` input
WP-04's founder task already asks the founder to talk to people, and the plan says to raise it as that task instead of a
line, so Today is untouched. "Copy a message" copies; it does not open the share panel. `firstTenMessage` takes a name and
the one line only: the plan's `problem` input had nothing to say that a fixed question does not. The board takes at most
50 people so one account cannot fill the CRM.

### A payment link asks first, like a checkout session
The plan says `contactsThirdParty`; the founder's Nov 16 decision made a payment page ask with `irreversible`, so the
link uses that, and the existing pinned test says so. `stripe:create_payment_link` is not in `PAYMENT_RECORD_TOOLS`
(`apps/gateway/src/pipeline.ts`, not mine to edit): until the owner of that file adds it, automated mode treats it as any
irreversible tool and not as the inbound payment power's tool.

### `post.published` is filed under Settings, like `share.opened`
Filed under Distribution, a collaborator would receive it, and the database's `fm_collaborator_event_types()` would need a
new migration. Filed under Settings it is never sent to a collaborator and needs none. A collaborator therefore does not see
"Posted on X" on a card; they cannot answer the question either.

## Not done
- T5: the tab reaches projects created from now on. A project that already exists has no "First ten" tab until a
  migration backfills its department screens; that needs a migration number I was not given (asked).
- T5: the Playwright spec runs at 1280 px; the 390 px journey is not possible, because department tabs are desktop only.
- T12: the other suites (T2, T3, T6, T8, T10), and applying `specificityProblems` inside the live channel creative, post
  draft and follower update cases. The $2 a night cap is the plan's Estimate.
- WP-07 T8: the gateway write of a `pay_links` row after a successful call, the gateway test for the same key, and the
  live run (needs WP-00 S8). I did not find a seam for the write outside `pipeline.ts`, which is not mine to edit.
- T6 (price, pay and ask on the page) and T8 (page tools for the SEO and GEO agents; needs a migration number).
- The two new post subjects (`who_it_is_for`, `what_i_learned`), the weekly trigger and the daily-brief check for it.
- Prompt v3 and the eval cases per subject.
