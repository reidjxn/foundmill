---
name: new-event
description: Add an event type to packages/events with a Zod schema, an outbox write helper and a consumer test. Use whenever code needs to emit a new kind of event.
argument-hint: "<event.name>"
---

# Add an event

1. Read `docs/ARCHITECTURE.md` §5 and the catalogue in `packages/events/src/`.
2. Declare the event with a Zod schema. Name it `noun.verb_past` like its neighbors (`post.drafted`). Business-scoped events carry `business_id`; person-level ones go to the account event store.
3. Write it only through the outbox helper, inside the same transaction as the change it reports.
4. Add a consumer test that parses a real payload and rejects a malformed one.
5. Finish with `verify-done`.
