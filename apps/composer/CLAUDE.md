# apps/composer (`@foundmill/composer`)

The Inbox Composer service: narrates events into Inbox notes, the Refresh buffer, Customer Update commentary, chapter titles and founder task titles, over HTTP for the api and the orchestrator. It calls no vendor and owns no screens.

## Invariants
- Every note is validated with Zod (the Composer shape, BUILD §11.3) and its links by `@foundmill/entity-linker` (`checkComposerText`): agent text uses `[[ent:<uuid>|Name]]`; an unknown or invisible id gets one re-ask, then is rejected or stripped.
- A note is written in one transaction (`src/persist.ts`): the `inbox_items` row, its source events marked narrated, `inbox.item_created` through the outbox, the entity mentions.
- `/v1/narrate` is idempotent per event set (key `narrate:<hash of the sorted ids>`); a retry returns the same note.
- `src/app.ts` never touches the database directly; data goes through `repos` (`fm/no-raw-db`).
- Model calls use routes (`inboxComposer` and others in `packages/models/src/routing.ts`), wrapped with `gateModelClient` and `assertPlatformCredits`; usage is booked to the business.
- Respect the deadlines: `LIMITS.composerDeadlineMs` here, `LIMITS.composerClientTimeoutMs` for callers (`@foundmill/config`).
- Everything it writes is read by founders: no football words (an event is a **win**, the note "narrates" it), US English and US dates, the subtext rule, plain words. A simulated result is never narrated as done. Label every non-real number "Forecast" or "Estimate". Solo is complete: never frame a one-person project as missing someone.
- Works with `MODEL_MODE=mock`.

## Read when needed
- docs/ARCHITECTURE.md §11 Composer , §5 Events for which events are narrated. Lines are very long: grep for the section heading and read only that section, never the whole file.
- docs/BUILD.md §11.3 Inbox (the note schema, Refresh, the linking pipeline), §11.4 Customer Journey (Customer Update), §12.2 Inbox Composer prompt.
- Decisions: `node scripts/decisions-index.mjs composer` (add words such as `refresh`, `narrate`), then read only the printed range.

## Commands
- `pnpm --filter @foundmill/composer typecheck` | `lint` | `test`
- Copy checks (this app is scanned): `node scripts/banned-terms.mjs`, `node scripts/us-english.mjs`, `node scripts/plain-language.mjs --gate --summary`
- A new behavior gets an eval in `evals/src/` (`pnpm --filter @foundmill/evals test` runs mock mode).

## Key files
- `src/app.ts`: HTTP routes, Zod on every body
- `src/service.ts`: the facade (narrate, refresh, commentary, chapter titles)
- `src/compose.ts`: the narration pipeline (model, schema, entity check, re-ask)
- `src/persist.ts`: the one-transaction write of a note
- `src/refresh.ts`: Refresh and the 3-item buffer
- `src/commentary.ts`, `src/chapter.ts`, `src/chapter-report.ts` (the Chief of Staff's page at the end of a chapter: a template over records, no model call), `src/founder-titles.ts`
