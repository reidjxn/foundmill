/**
 * Bounds on the server's Supabase Auth calls (audit topology F3). Without them a request waits on undici's defaults
 * (300 s), and an expired session's refresh is retried with backoff for up to 30 s (auth-js
 * AUTO_REFRESH_TICK_DURATION_MS) on any network error or 5xx: the founder saw `/` hang for 30 s. Each request is cut at
 * SUPABASE_REQUEST_TIMEOUT_MS, and the whole auth step at AUTH_DEADLINE_MS, after which the request is treated as
 * signed out (the proxy then sends app paths to /login and `/` to the landing page) instead of hanging.
 */

/** One Supabase Auth request (a token refresh, the signing keys). */
export const SUPABASE_REQUEST_TIMEOUT_MS = 3_000;
/** The whole auth step of one request, refresh retries included. */
export const AUTH_DEADLINE_MS = 4_000;
/** One request of a one-off action the founder started (the sign-in code exchange, sign-out): slow beats failed there. */
export const SUPABASE_ACTION_TIMEOUT_MS = 10_000;

/** `fetch` that gives up after `ms` (and still honors the caller's own signal). Reads the global `fetch` per call. */
export function fetchWithTimeout(ms: number = SUPABASE_REQUEST_TIMEOUT_MS): typeof fetch {
  return (input, init) => {
    const timeout = AbortSignal.timeout(ms);
    const signal = init?.signal ? AbortSignal.any([init.signal, timeout]) : timeout;
    return fetch(input, { ...init, signal });
  };
}

/**
 * `work`, or `fallback` once `ms` have passed without an answer. The work is not cancelled (auth-js cannot be), only
 * no longer waited for; a rejection before the deadline still rejects.
 */
export function withDeadline<T, F>(work: Promise<T>, ms: number, fallback: F): Promise<T | F> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<F>((resolve) => {
    timer = setTimeout(() => resolve(fallback), ms);
  });
  return Promise.race([work, deadline]).finally(() => clearTimeout(timer));
}
