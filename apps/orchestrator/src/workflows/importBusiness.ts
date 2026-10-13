/** importBusiness (BUILD §9.4, Door B): import sources (GitHub, Drive, site, Stripe, registry) through the gateway, then report. */
import { allHandlersFinished, condition, proxyActivities, setHandler } from "@temporalio/workflow";
import type { Activities, ImportBusinessInput, ImportSourceResult } from "../activities";
import { stopSignal } from "./signals";

const acts = proxyActivities<Activities>({ startToCloseTimeout: "10 minutes", retry: { maximumAttempts: 3, initialInterval: "5 seconds" } });

export interface ImportBusinessResult {
  results: ImportSourceResult[];
  inboxItemId: string | null;
}

export async function importBusiness(input: ImportBusinessInput): Promise<ImportBusinessResult> {
  let stopped = false;
  setHandler(stopSignal, () => {
    stopped = true;
  });
  const results: ImportSourceResult[] = [];
  // Sources import a few at a time (each is a gateway round-trip with rate limits behind it).
  const queue = [...input.sourceIds];
  // A source the run could not read is written as failed on its row (the import job reads the rows), so the Import screen
  // always reaches its report; the row is only marked when the activity could not write it itself.
  const fail = async (sourceId: string, reason: string) => {
    results.push({ sourceId, ok: false, summary: reason });
    try {
      await acts.failImportSource({ businessId: input.businessId, sourceId, reason });
    } catch {
      /* the import job's deadline reports a row that could not be written */
    }
  };
  const worker = async () => {
    for (;;) {
      const sourceId = queue.shift();
      if (!sourceId || stopped) return;
      try {
        results.push(await acts.importSource({ businessId: input.businessId, sourceId }));
      } catch (err) {
        await fail(sourceId, `failed: ${(err as Error).message}`.slice(0, 300));
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(3, Math.max(1, queue.length)) }, worker));
  // Stopped before every source was read: the rest are reported as not read.
  for (const sourceId of queue.splice(0)) await fail(sourceId, "stopped before this source was read");
  const { inboxItemId } = await acts.finishImport({ businessId: input.businessId, results });
  await condition(allHandlersFinished);
  return { results, inboxItemId };
}
