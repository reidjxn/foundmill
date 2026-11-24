/**
 * Leaving a live call ends it (founder, Nov 23, 2026: calls left by closing the tab stayed "In progress" for good). A
 * closing tab cannot wait for a token or a React mutation, so this is one `keepalive` POST of `teamCall.end` with
 * `via: "left"`, sent with a token read beforehand, to the page's own origin (the same-origin tRPC path: no CORS
 * preflight, which a keepalive request may not get). The browser finishes it after the page is gone; the api writes
 * the call up as if End were pressed. If it never arrives, the api's sweep ends the call after 15 quiet minutes.
 */
import { SAME_ORIGIN_TRPC_PATH } from "@/lib/same-origin-api";

export function endCallOnLeave(input: { businessId: string; callId: string }, bearer: string | null, fetchImpl: typeof fetch = fetch): void {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (bearer) headers.authorization = `Bearer ${bearer}`;
  // tRPC's own body for one mutation, with superjson's wrapper (`{ json: input }`).
  void fetchImpl(`${SAME_ORIGIN_TRPC_PATH}/teamCall.end`, { method: "POST", keepalive: true, headers, body: JSON.stringify({ json: { ...input, via: "left" } }) }).catch(() => undefined);
}
