/**
 * The Message Batches API (WP-09 T8; BUILD §10.4): requests that can wait up to a day run at half price
 * (`BATCH_DISCOUNT`). Three steps, each a call on the client:
 *
 * 1. `submitBatch(client, items)`: every item is the same request body `complete()` would send, without what a batch
 *    cannot carry (no stream, no fast mode, no server-side fallback). A gated client asks its gate once per item before
 *    anything is sent. All items of one batch belong to one business (or to none), so one key pays for it.
 * 2. `batchEnded(client, batchId)`: whether the batch has finished (the caller sleeps between looks).
 * 3. `collectBatch(client, batchId, items)`: one result per item, matched by `customId` whatever order they arrive in.
 *    Each answer is metered at half price and reaches `onUsage` with `batch: { id, customId }`, so a sink books it once
 *    however often the batch is collected. A refusal, a cut-off answer or an answer that does not fit the schema is
 *    `ok: false`: a batch is single-shot, with no repair call.
 *
 * The mock client answers at submit and reports the batch ended at once, so `MODEL_MODE=mock` runs the whole path.
 */
import type { BatchItem, BatchItemResult, ModelClient } from "./types";

/** Letters, digits, "_" and "-", at most 64 characters (the API's rule for `custom_id`). */
export const BATCH_CUSTOM_ID = /^[A-Za-z0-9_-]{1,64}$/;

/** Throws on an item list the API (or the one-payer rule) would refuse; returns the business they belong to. */
export function assertBatchItems(items: readonly BatchItem[]): string | null {
  if (items.length === 0) throw new Error("A batch needs at least one item");
  const seen = new Set<string>();
  for (const item of items) {
    if (!BATCH_CUSTOM_ID.test(item.customId)) throw new Error(`Batch custom id "${item.customId}" must be letters, digits, "_" or "-", at most 64 characters`);
    if (seen.has(item.customId)) throw new Error(`Batch custom id "${item.customId}" is used twice`);
    seen.add(item.customId);
  }
  const owners = new Set(items.map((i) => i.request.attribution?.businessId ?? null));
  if (owners.size > 1) throw new Error("Every item of a batch belongs to the same business, so one key pays for it");
  return [...owners][0] ?? null;
}

const unsupported = (what: string) => new Error(`This model client cannot ${what} (no batch support)`);

export function submitBatch(client: ModelClient, items: readonly BatchItem[]): Promise<{ batchId: string; count: number }> {
  if (!client.submitBatch) throw unsupported("submit a batch");
  assertBatchItems(items);
  return client.submitBatch(items);
}

export function batchEnded(client: ModelClient, batchId: string, businessId?: string): Promise<boolean> {
  if (!client.batchEnded) throw unsupported("read a batch");
  return client.batchEnded(batchId, businessId);
}

export function collectBatch<T>(client: ModelClient, batchId: string, items: readonly BatchItem<T>[]): Promise<BatchItemResult<T>[]> {
  if (!client.collectBatch) throw unsupported("collect a batch");
  return client.collectBatch(batchId, items);
}
