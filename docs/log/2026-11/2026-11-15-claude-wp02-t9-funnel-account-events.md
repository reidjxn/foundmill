---
date: 2026-11-15
branch: claude/wp02-t9-funnel-account-events
title: Four funnel facts in the account event store
areas: [shared, events, db, api]
supersedes: []
---
## What changed
Four account-scoped events, each written once per account by its idempotency key:
- `account.admitted` `{ how }`, from `account_admissions` ("list" when there is no row);
- `profile.created` `{ client: "web" | "app" }`, from `x-foundmill-client` through the new `ctx.clientKind`;
- `idea.kept` `{ from: "idea_box" }`, on a first `ideaBox.claim`;
- `idea.drafted` `{ source, cards }`, on the account's first cards from a set, a written idea or a kept idea-box card.
The first two are steps 4 and 5 of `PERSON_CREATED_STEPS`; the other two are written by apps/api
`services/funnel-facts.ts` after the change they record. Migration 0108 redefines `fm_account_event_types()` with
the nine types and removes any row planted under the new names in `events`. ARCHITECTURE §5 lists the four.

## Decisions
- `consumers: ["metrics"]` instead of the plan's `[]`: the catalogue test requires a consumer for every event, and
  "metrics" already names the nightly reader (`signup.attributed` uses it). packages/events/CLAUDE.md now says so.
- The router facts are written in their own short transaction after the claim or the cards, not inside them:
  `claimIdeaBoxDraft` and the ideation batch writer each own their transaction, and a fact must never fail the
  request. The idempotency key makes a repeat write nothing.
- `client` is "app" only when the header starts with `mobile/` (what the app sends); anything else is "web".

## Not done
- No backfill for accounts created before today; T10 reads `auth.users` and `idea_drafts` for those.
