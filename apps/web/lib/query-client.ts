/**
 * One QueryClient per browser tab, a fresh one per server render (TanStack Query's SSR guidance).
 *
 * Freshness: 30 s by default. Routers the event stream keeps current (the shell refetches them on every event that
 * changes them, BusinessShell `INVALIDATE_ON_EVENT`) stay fresh for 5 minutes, but only while their business's
 * channel has been live since they were fetched (lib/stream-status.ts): data fetched before the channel went live, or
 * while it was down or unsubscribed (another business on screen), may have missed an event and keeps the short default.
 * When a channel comes back after a gap, `resyncBusiness` refetches that business's queries (the stream does not
 * replay), and a tab that becomes visible again refetches the stale queries of the business on screen.
 *
 * Kept: in the browser a screen's data stays in memory for `BROWSER_GC_MS` after the screen is left (TanStack's default
 * is 5 minutes), so coming back to it paints what it showed at once and refreshes behind it (audit WEB-10).
 */
import { MutationCache, QueryCache, QueryClient } from "@tanstack/react-query";
import { reportApiError } from "./auth/session-end";
import { trpcPathPrefix } from "./trpc";
import { businessOfKey, routerOfKey } from "./query-keys";
import { businessLiveSince } from "./stream-status";

export { businessOfKey, routerOfKey };

export const DEFAULT_STALE_MS = 30_000;
/** How long the browser keeps the data of a screen nobody shows (a server render keeps TanStack's own default). */
export const BROWSER_GC_MS = 60 * 60_000;
/** Freshness of stream-kept data while its business's channel stays live. */
export const STREAM_KEPT_STALE_MS = 5 * 60_000;
/**
 * Routers whose every change arrives as an event the shell invalidates on (and as mutations that invalidate them).
 * Not `department`: `department.list` carries the team roster and the tabs, which hires, agent edits and tab or
 * department settings change without an event (audit RUI-09), so it keeps the short default and refetches on the next
 * mount or focus.
 */
export const STREAM_KEPT_ROUTERS: readonly string[] = ["inbox", "cycle", "finance"];

interface StaleTimeQuery {
  queryKey: readonly unknown[];
  state: { dataUpdatedAt: number };
}

/**
 * A `staleTime` that is `STREAM_KEPT_STALE_MS` for a stream-kept router's query whose business channel has been live
 * since the data was fetched, else `fallbackMs`.
 */
export function streamAwareStaleTime(fallbackMs: number = DEFAULT_STALE_MS, liveSince: (businessId: string) => number | null = businessLiveSince): (query: StaleTimeQuery) => number {
  return (query) => {
    const router = routerOfKey(query.queryKey);
    if (router === null || !STREAM_KEPT_ROUTERS.includes(router)) return fallbackMs;
    const businessId = businessOfKey(query.queryKey);
    const since = businessId === null ? null : liveSince(businessId);
    return since !== null && since <= query.state.dataUpdatedAt ? STREAM_KEPT_STALE_MS : fallbackMs;
  };
}

/**
 * The business's channel is live again after a gap (a reconnect, a refusal retried, a return to the business): events
 * sent meanwhile are not replayed, so refetch every query of that business. Mounted queries refetch now; the others
 * are marked stale and refetch when a screen shows them again.
 */
export function resyncBusiness(queryClient: QueryClient, businessId: string): Promise<void> {
  return queryClient.invalidateQueries({ predicate: (query) => businessOfKey(query.queryKey) === businessId });
}

/**
 * An event says routers changed (BusinessShell `INVALIDATE_ON_EVENT`): refetch their queries. A read already on its way
 * is kept (`cancelRefetch: false`), so what it brings paints instead of being thrown away and asked again, as it was
 * when a change's own refetch and its event crossed (audit WEB-6). It may have been read before this change was saved,
 * though, so each read that was on its way is asked once more after it lands: the screen still ends on the change.
 */
export async function invalidateForEvent(queryClient: QueryClient, routers: readonly string[]): Promise<void> {
  await Promise.all(
    routers.map(async (router) => {
      const filters = { queryKey: trpcPathPrefix(router) as unknown[] };
      const onTheirWay = queryClient.getQueryCache().findAll({ ...filters, fetchStatus: "fetching" }).map((q) => q.queryKey);
      await queryClient.invalidateQueries(filters, { cancelRefetch: false });
      await Promise.all(onTheirWay.map((queryKey) => queryClient.invalidateQueries({ queryKey, exact: true }, { cancelRefetch: false })));
    }),
  );
}

/** The business a mutation's variables name (`{ businessId, ... }`); null for account-level writes. */
function businessOfVariables(variables: unknown): string | null {
  const id = variables && typeof variables === "object" ? (variables as { businessId?: unknown }).businessId : undefined;
  return typeof id === "string" ? id : null;
}

export function makeQueryClient(): QueryClient {
  return new QueryClient({
    // Every failed read and write is reported: an UNAUTHORIZED answer ends the session and a "not a member" FORBIDDEN ends
    // the membership, whichever screen made the call (lib/auth/session-end.ts; nothing listens on the server).
    queryCache: new QueryCache({ onError: (err, query) => reportApiError(err, businessOfKey(query.queryKey)) }),
    mutationCache: new MutationCache({ onError: (err, variables) => reportApiError(err, businessOfVariables(variables)) }),
    defaultOptions: {
      queries: {
        staleTime: streamAwareStaleTime(DEFAULT_STALE_MS),
        // Only in the browser: on the server every render has its own client, and a timer per query would keep it alive.
        gcTime: typeof window === "undefined" ? undefined : BROWSER_GC_MS,
        // Back to a hidden tab: the business's stale reads refetch (a stream-kept one stays fresh only while its
        // channel stayed live). Account-level reads (the studio, profile) keep what they have.
        refetchOnWindowFocus: (query) => businessOfKey(query.queryKey) !== null,
        retry: (count, err) => {
          const code = (err as { data?: { code?: string } } | undefined)?.data?.code;
          // A rate limit is not a blip: retrying spends the allowance again and is refused again. A malformed input (an
          // address that is not an id) is refused the same way every time.
          // Nor is a model account that cannot pay (PAYMENT_REQUIRED, `model_billing`): it lasts until someone adds credit. Nor are used-up credits.
          if (code === "UNAUTHORIZED" || code === "FORBIDDEN" || code === "NOT_FOUND" || code === "TOO_MANY_REQUESTS" || code === "BAD_REQUEST" || code === "PAYMENT_REQUIRED") return false;
          return count < 2;
        },
      },
    },
  });
}

let browserQueryClient: QueryClient | undefined;

export function getQueryClient(): QueryClient {
  if (typeof window === "undefined") return makeQueryClient();
  if (!browserQueryClient) browserQueryClient = makeQueryClient();
  return browserQueryClient;
}
