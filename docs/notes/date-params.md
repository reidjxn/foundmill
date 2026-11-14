# A `Date` in a raw `sql` template on postgres.js (Nov 14, 2026)

Branch `claude/date-params`. No migration.

## The problem

Drizzle's postgres-js driver (drizzle-orm 0.45, `postgres-js/driver.js`) sets postgres.js's serializers for the date and
time types (1184, 1082, 1083, 1114, 1182, 1185, 1115, 1231) to pass values through unchanged, because a value Drizzle maps
from a column is already text. A `Date` interpolated into a raw template, as in `sql\`${t.expiresAt} > ${now}\``, gets no
column mapping. postgres.js infers timestamptz for it, the pass-through hands the `Date` itself to the wire writer, and the
query throws: `The "string" argument must be of type string … Received an instance of Date`. PGlite accepts a `Date`, so
only the real-Postgres run (`RLS_TEST_DATABASE_URL`) caught it.

It surfaced on #132's real-Postgres check, in code from other branches:
- `repos.founderCancelLinks.use` (#124): the link in a removed founder's email would fail when they press it;
- `usage.ts` credit lots (`lockLiveLots` and the two lot queries after it, 0098);
- `repos.postAttributions.weekSummary` (#128, still in review);
- a raw update in `founder-departures.test.ts`.

## The fix

`withDateParams(client, db)` in `packages/db/src/client.ts` wraps those serializers: a `Date` goes as its ISO string, and
text goes through as before. `createDb` and the real-Postgres test harness both call it after `drizzle({ client })`,
which is the call that installs the pass-through. This fixes every call site at once, including future ones, rather than
asking each one to write `.toISOString()`.

## Tests

`packages/db/src/__tests__/date-params.test.ts`:
- a unit test (runs everywhere): `createDb`'s client writes a `Date` as its ISO string for every date and time type and
  leaves text unchanged;
- against a real Postgres (when `RLS_TEST_DATABASE_URL` is set), through `createDb` itself with prepared statements on
  and off: a `Date` compared, cast and mixed with strings and numbers. Without the fix both fail with the error above.

The real-Postgres RLS suite on main with the fix: 32 files, 1,844 tests, all pass (founder-departures included).

## DECISIONS entry

> **2026-11-14 — A `Date` in a raw `sql` template is written as its ISO string (`withDateParams`).** Drizzle's
> postgres-js driver makes the date and time serializers pass values through, so a `Date` with no column mapping reached
> postgres.js's wire writer and threw; PGlite hid it. We wrap the serializers once, in `createDb` and in the
> real-Postgres harness, rather than ask every call site to convert. Rejected: a lint rule against Dates in templates
> (it would miss values typed `unknown` and still leave the driver wrong).

## PROGRESS entry

> **Dates in raw SQL on Postgres (2026-11-14).** `createDb` now writes a `Date` in a raw `sql` template as its ISO
> string, which fixes the former founder's cancel link (#124), the credit lot queries and #128's week summary on a real
> Postgres. A real-Postgres test runs through `createDb` with prepared statements on and off.
