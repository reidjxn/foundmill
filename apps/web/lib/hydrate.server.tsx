/**
 * Server-started queries handed to the browser's query cache (Next.js guide "TanStack Query" › "Provide initial data
 * from a Server Component"; TanStack Query 5.40+ dehydrates pending queries). A Server Component starts a screen's
 * first queries without awaiting them, renders `<Prefetched>` around the client screen, and the browser's tRPC hooks
 * find the data (or the request in flight) under the same key instead of asking after hydration.
 *
 * Keys come from `createTRPCOptionsProxy` over the request's server client, which builds exactly the keys the browser's
 * `useTRPC()` hooks and lib/trpc.ts `trpcQueryKey` build; inputs come from shared helpers (lib/shell-queries.ts).
 * lib/trpc.ts (the browser client and links) is not touched: the server only needs the vanilla client it already has.
 *
 * Imported by Server Components only (no "use client").
 */
import { QueryClient, defaultShouldDehydrateQuery, dehydrate } from "@tanstack/react-query";
import { createTRPCOptionsProxy } from "@trpc/tanstack-react-query";
import type { ReactNode } from "react";
import { PrefetchBoundary } from "./hydrate-boundary";
import type { ApiClient, AppRouter } from "./trpc";

/**
 * A query cache for one server render and the typed options proxy over the request's API client. Queries never retry on
 * the server: a failure is handed over at once and the browser fetches again itself (`<Prefetched>`).
 */
export function createServerPrefetch(api: ApiClient) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const trpc = createTRPCOptionsProxy<AppRouter>({ client: api, queryClient });
  return { queryClient, trpc };
}

/** Successful and still-pending queries are handed over; a pending one resolves in the browser when its data streams in. */
export function shouldHandOver(query: Parameters<typeof defaultShouldDehydrateQuery>[0]): boolean {
  return defaultShouldDehydrateQuery(query) || query.state.status === "pending";
}

/**
 * Hands every query started on `queryClient` to the browser cache. A query that fails on the server is retried once,
 * straight away, by the browser with its own client (as if it had never been prefetched). Queries still pending when
 * the page is rendered resolve in the browser only after hydration (lib/hydrate-boundary.tsx), so the first client
 * render matches the server's HTML.
 */
export function Prefetched({ queryClient, children }: { queryClient: QueryClient; children: ReactNode }) {
  return (
    <PrefetchBoundary state={dehydrate(queryClient, { shouldDehydrateQuery: shouldHandOver })} options={{ defaultOptions: { queries: { retry: 1, retryDelay: 0 } } }}>
      {children}
    </PrefetchBoundary>
  );
}
