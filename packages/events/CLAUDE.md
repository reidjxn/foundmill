# packages/events (`@foundmill/events`)

Owns the event catalog (Zod, business-scoped and account-scoped types), the transactional outbox writers, the Redis relays, the consumer helpers and the session and person streams. It holds no product decisions: services decide what happened, this package records and delivers it.

## Invariants
- **Every event is declared here with a Zod payload schema** and written **through the outbox** in the same transaction as the change it reports. Unknown types fail at write time.
- A business event (a fact about a project): append the type to `EVENT_TYPES` (`packages/shared/src/constants.ts`), `declareEvent(type, schema)` in `src/catalogue.ts`, add its payload to `src/testing/fixtures.ts`, write it with `writeEvent(tx, { businessId, type, actor, entityIds, payload })`.
- An account event (a fact about one person, never written to a business): the four steps in ARCHITECTURE §5 "Account events": `EVENT_TYPES` and `ACCOUNT_EVENT_TYPES`, a migration redefining `fm_account_event_types()`, `declareAccountEvent(type, schema, { doc, consumers, recordIds? })`, its fixture. Write with `writeAccountEvent`.
- The two-person rule: an account payload names another person only by something already public (a handle), never by account id, email or a private field. Closed objects of plain fields; UUIDs only under `recordIds`.
- Errors say which rule and how deep, never a key or a value of the payload.
- Names follow `noun.verb_past` like their neighbors (`post.drafted`).
- Consumers are at-least-once: de-duplicate on the event `id`. A simulated result (`simulated: true`) is never a real outcome for the north star.
- Stream keys: `ev:{businessId}` (business), `as:{sessionId}` (agent session), `u:{userId}` (content-free LIVE signals), `ae:{userId}` (account events). Keep them apart.

## Read when needed
- docs/ARCHITECTURE.md §5 Events (lines 83–106; "Account events" from line 94), §4 Database (63–82) for `account_events` and the outbox tables. Lines are very long: read a range or grep.
- docs/BUILD.md §8.1 Event catalog, §8.2 Streams.
- Decisions: `node scripts/decisions-index.mjs outbox` or `node scripts/decisions-index.mjs account events`, then read only the printed range.
- Skill: `new-event`.

## Commands
- `pnpm --filter @foundmill/events typecheck` | `lint` | `test`
- A new account type also needs `pnpm test:rls` (packages/db `rls/account-events.test.ts` compares the SQL list with `ACCOUNT_EVENT_TYPES`).

## Key files
- `src/catalogue.ts`: every declaration; `EventType` is derived from it
- `src/outbox/writer.ts`: `writeEvent`, `buildEvent` (business-scoped only)
- `src/outbox/account-writer.ts`, `src/account-payload.ts`: account events and their payload checks
- `src/outbox/relay.ts`, `src/outbox/account-relay.ts`, `src/outbox/relay-loop.ts`: outbox to Redis
- `src/consume.ts`: `consume` / `consumeAccountEvents` (consumer groups, dead letter after 5 failures)
- `src/testing/fixtures.ts`: one valid payload per type; `src/testing/memory-redis.ts` for tests
