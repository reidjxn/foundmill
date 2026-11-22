/**
 * The signed-out read behind the public waitlist page (app/waitlist; WP-14 T15): `waitlist.batch` on the API with no
 * bearer, bounded like every server read (`SERVER_LIMITS`). The answer is kept for a minute (`WAITLIST_BATCH_SECONDS`)
 * so a crawler or a burst of visitors asks the API once: the numbers are live to the minute and always real.
 * `unavailable` is the API not answering, which the page says as itself and never as "no batch".
 */
import { createApiClient, SERVER_LIMITS, type RouterOutputs } from "./trpc";
import { retryDroppedRead } from "./trpc-server";

export type WaitlistBatch = NonNullable<RouterOutputs["waitlist"]["batch"]>;
export type WaitlistBatchRead = { status: "batch"; batch: WaitlistBatch } | { status: "none" } | { status: "unavailable" };

export const WAITLIST_BATCH_SECONDS = 60;

export async function waitlistBatch(): Promise<WaitlistBatchRead> {
  try {
    const api = createApiClient({ getToken: () => null, fetch: retryDroppedRead((input, init) => fetch(input, { ...init, next: { revalidate: WAITLIST_BATCH_SECONDS } })), limits: SERVER_LIMITS });
    const batch = await api.waitlist.batch.query();
    return batch ? { status: "batch", batch } : { status: "none" };
  } catch {
    return { status: "unavailable" };
  }
}
