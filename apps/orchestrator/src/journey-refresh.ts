/**
 * Debounced `refresh_journey_daily()` (DECISIONS "journey_daily is a materialised view"; audit O-17, DB-03).
 *
 * The Ribbon, the Home status strip and the department cards read `journey_daily_mv`, which only changes when it is
 * refreshed. After the writes the orchestrator makes (a cycle's sessions end, a journey is built, a channel's week is
 * measured) the activity asks for a refresh: the first request runs at once, later ones within `minIntervalMs` fold into
 * one trailing refresh, and at most one runs at a time per database. Writes made elsewhere (api decisions, ingest
 * signups) are picked up by the next request or the `journeyMatviewRefresh` schedule (every 15 minutes). A refresh
 * that fails is logged and left to the next one; nothing waits for it.
 */
import { repos, type Db } from "@foundmill/db";
import type { Logger } from "@foundmill/shared/logger";

export const JOURNEY_REFRESH_MIN_INTERVAL_MS = 30_000;

interface Refresher {
  running: Promise<void> | null;
  lastStartedAt: number;
  timer: ReturnType<typeof setTimeout> | null;
}

const refreshers = new WeakMap<Db, Refresher>();

/** Ask for a refresh of the journey matview soon (see the module comment). Returns at once. */
export function requestJourneyDailyRefresh(deps: { db: Db; log: Pick<Logger, "warn"> }, options: { minIntervalMs?: number; now?: () => number } = {}): void {
  const minIntervalMs = options.minIntervalMs ?? JOURNEY_REFRESH_MIN_INTERVAL_MS;
  const now = options.now ?? Date.now;
  let r = refreshers.get(deps.db);
  if (!r) {
    r = { running: null, lastStartedAt: Number.NEGATIVE_INFINITY, timer: null };
    refreshers.set(deps.db, r);
  }
  const state = r;
  if (state.timer) return;
  const run = () => {
    state.timer = null;
    if (state.running) {
      // One is running: one more follows it, so the writes it did not see are picked up.
      state.timer = setTimeout(run, minIntervalMs);
      state.timer.unref?.();
      return;
    }
    state.lastStartedAt = now();
    state.running = repos.journeys
      .refreshDaily(deps.db)
      .catch((err: unknown) => deps.log.warn({ err: (err as Error)?.message }, "journey_daily refresh failed; the next request or the schedule retries"))
      .finally(() => {
        state.running = null;
      });
  };
  const wait = state.lastStartedAt + minIntervalMs - now();
  if (wait <= 0 && !state.running) {
    run();
    return;
  }
  state.timer = setTimeout(run, Math.max(wait, 0) || minIntervalMs);
  state.timer.unref?.();
}

/** Resolves once the refresh in flight (if any) has finished; tests use it. */
export async function journeyDailyRefreshIdle(db: Db): Promise<void> {
  await refreshers.get(db)?.running;
}
