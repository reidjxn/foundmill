---
date: 2026-11-17
branch: claude/wp09-models-batch-2
title: WP-09 T8, a batch client in packages/models
areas: [models, orchestrator]
supersedes: []
---
## What changed
- `packages/models/src/batch.ts` adds `submitBatch`, `batchEnded` and `collectBatch`, with the types `BatchItem` and
  `BatchItemResult`.
  - Custom ids are checked (letters, digits, "_" and "-", at most 64, unique), and all items must belong to one business.
  - The live client sends `complete()`'s body for each item, without stream, speed or fallbacks.
  - Results are matched by `custom_id`. Each answer is metered at half price and reaches `onUsage` once, carrying
    `batch: { id, customId }`.
  - A refusal, a cut-off answer or an answer that does not fit the schema comes back `ok: false`, with no repair call.
- The gated client asks its gate once per item at submit, and passes the batch methods through.
- The mock client answers at submit and reports the batch ended at once, so the whole path runs in mock mode.
- `apps/orchestrator`:
  - `createBusinessModelClient` runs a batch on the key that pays for its business, with the credits checked once at
    submit.
  - The usage sink books a batch result with the idempotency key `batch:${id}:${customId}`, so collecting twice books it
    once. The ledger row also keeps `servedModel` (T5).

## Decisions
1. **The answer's own `model` prices a batch result.** The credit saver may move an item to a lower-cost model at
   submit, and the items handed to `collect` are the unshaped ones.
2. **The mock meters a batch answer at the normal mock price.** Mock costs are simulated anyway, and the half price is
   tested on the live client.
3. **WP-13's `enforceModelFunding` wrapper (free-plan.ts, WP-13's file) does not pass batches through yet.** A batch
   on a client wrapped that way refuses with "no batch support" instead of running unfunded. WP-13 adds the
   pass-through when T10 needs it.

## Not done
- T9 and T10 (T10 waits for WP-06 T10). No callers yet.
