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
  const worker = async () => {
    for (;;) {
      // Check the stop before taking a source: one taken and then dropped would never be reported as not read.
      if (stopped) return;
      const sourceId = queue.shift();
      if (!sourceId) return;
      try {
        results.push(await acts.importSource({ businessId: input.businessId, sourceId }));
      } catch (err) {
        results.push({ sourceId, ok: false, summary: `failed: ${(err as Error).message}`.slice(0, 300) });
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(3, Math.max(1, queue.length)) }, worker));
  // A stop leaves the rest unread: they finish as not read (finishImport records it), never "not read yet" forever.
  for (const sourceId of queue.splice(0)) results.push({ sourceId, ok: false, summary: "failed: the import was stopped before this source was read" });
  const { inboxItemId } = await acts.finishImport({ businessId: input.businessId, results });
  await condition(allHandlersFinished);
  return { results, inboxItemId };
}
