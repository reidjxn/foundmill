/**
 * Watches Supabase's Data API (PostgREST) stays off (WP-11 T14; A8-11, SEC-8). SEC-8, write policies wider than the
 * api's own roles, is accepted only while no client can reach the tables directly; the switch lives in a dashboard and
 * nothing noticed if it flipped. `GET {SUPABASE_URL}/rest/v1/` with the anon key at boot (never awaited) and every
 * 10 minutes: a 2xx means it is on and logs one error; 503 or 404 means off; anything else keeps the last value.
 * `/health` reports it as `dataApi`; it never fails readiness.
 */
import type { ApiLogger } from "./log";

export const DATA_API_REFRESH_MS = 10 * 60_000;
export const DATA_API_TIMEOUT_MS = 5_000;

export type DataApiState = "off" | "on" | "unknown";

export interface DataApiProbe {
  state(): DataApiState;
  /** Reads now (not awaited at boot) and every `intervalMs` on an unref'd timer. */
  start(options?: { intervalMs?: number }): { ready: Promise<DataApiState>; stop(): void };
  /** One read; never throws. */
  refresh(): Promise<DataApiState>;
}

export interface DataApiProbeOptions {
  supabaseUrl: string;
  anonKey: string | null | undefined;
  log: Pick<ApiLogger, "error" | "warn" | "info">;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

export function createDataApiProbe(opts: DataApiProbeOptions): DataApiProbe {
  let current: DataApiState = "unknown";
  let warnedNoKey = false;
  const fetchImpl = opts.fetchImpl ?? globalThis.fetch;
  const url = new URL("/rest/v1/", opts.supabaseUrl).toString();

  const refresh = async (): Promise<DataApiState> => {
    if (!opts.anonKey) {
      if (!warnedNoKey) opts.log.warn({ url }, "SUPABASE_ANON_KEY is not set on the api: cannot check that Supabase's Data API is off (docs/DEPLOY.md §4)");
      warnedNoKey = true;
      return current;
    }
    let status: number;
    try {
      status = (await fetchImpl(url, { headers: { apikey: opts.anonKey }, signal: AbortSignal.timeout(opts.timeoutMs ?? DATA_API_TIMEOUT_MS) })).status;
    } catch {
      return current;
    }
    if (status >= 200 && status < 300) {
      if (current !== "on") opts.log.error({ url }, "Supabase's Data API answers: clients can reach the tables directly, which SEC-8 accepts only while it is off. Turn it off in the dashboard (docs/DEPLOY.md §4)");
      current = "on";
    } else if (status === 503 || status === 404) {
      if (current === "on") opts.log.info({ url }, "Supabase's Data API is off again");
      current = "off";
    }
    return current;
  };

  return {
    state: () => current,
    refresh,
    start(options = {}) {
      const ready = refresh();
      const timer = setInterval(() => void refresh(), options.intervalMs ?? DATA_API_REFRESH_MS);
      timer.unref?.();
      return { ready, stop: () => clearInterval(timer) };
    },
  };
}
