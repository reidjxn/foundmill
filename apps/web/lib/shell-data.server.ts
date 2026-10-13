/**
 * Everything the business shell needs from the server (the /b/[bid] and LIVE layouts): `business.get` (shared with
 * `generateMetadata` through lib/trpc-server.ts) and the sidebar's `department.list`, asked together with the profile;
 * then the shell's first-screen queries (inbox, finance, cycle), which are not awaited: `<Prefetched>` hands them to
 * the browser, pending or done, under the keys BusinessShell's hooks use.
 *
 * The first-screen queries start only once the layout's own data is in: they arrive long before the browser hydrates
 * either way, and starting them earlier would make them compete with what the first byte of the page waits for.
 *
 * Imported by Server Components only (no "use client").
 */
import type { QueryClient } from "@tanstack/react-query";
import { createServerPrefetch } from "./hydrate.server";
import { shellQueryInputs } from "./shell-queries";
import type { RouterOutputs } from "./trpc";
import { createServerClient, serverBusiness, serverDepartments, type ServerApi } from "./trpc-server";

export interface BusinessShellStart {
  businessId: string;
  /** The business and its departments; rejects as the API does (NOT_FOUND / FORBIDDEN / unreachable). */
  data: Promise<[RouterOutputs["business"]["get"], RouterOutputs["department"]["list"]]>;
  /** Starts the shell's first-screen queries and returns the query cache to hand over with `<Prefetched>`. */
  prefetch(): QueryClient;
}

export function startBusinessShell(server: ServerApi, businessId: string): BusinessShellStart {
  const inputs = shellQueryInputs(businessId);
  const business = serverBusiness(businessId).then((b) => {
    if (!b) throw new Error("Signed out");
    return b;
  });
  // `serverDepartments` is the same request-cached call the department and agent pages' browser titles read.
  const departments = serverDepartments(businessId).then((d) => {
    if (!d) throw new Error("Signed out");
    return d;
  });
  const data = Promise.all([business, departments]);
  // The caller may leave before awaiting (a redirect, a different business); it handles the outcome when it does await.
  data.catch(() => undefined);
  return {
    businessId,
    data,
    prefetch() {
      // Its own client: these answer whenever they are ready, in their own batch.
      const { queryClient, trpc } = createServerPrefetch(createServerClient(server.auth));
      void queryClient.prefetchQuery(trpc.inbox.list.queryOptions(inputs.inbox));
      void queryClient.prefetchQuery(trpc.finance.overview.queryOptions(inputs.finance));
      void queryClient.prefetchQuery(trpc.cycle.status.queryOptions(inputs.cycle));
      return queryClient;
    },
  };
}
