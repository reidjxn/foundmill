"use client";
/**
 * Root providers: TanStack Query, tRPC (typed hooks + the untyped path client for widgets, over one set of links so
 * their reads made in the same tick share a request), Dugout toasts and tooltips, and the guided layer's host
 * (GuidanceHost: the account's guidance preferences and the definitions map, read only on signed-in pages). Mounted
 * once in app/layout.tsx; everything below can call useTRPC()/useQuery()/useToast()/useGuidance(). Reads go to this
 * origin (`browserQueryUrl`), changes and streams to the API (lib/trpc.ts). The date format has its own host in each
 * signed-in layout (DateFormatHost), seeded from the server render.
 */
import { QueryClientProvider } from "@tanstack/react-query";
import { createContext, useContext, useState, type ReactNode } from "react";
import { ToastProvider, TooltipProvider } from "@foundmill/dugout";
import { getQueryClient } from "@/lib/query-client";
import { getRequestAccessToken } from "@/lib/supabase/client";
import { browserQueryUrl, createApiClient, untypedClientOf, type UntypedApiClient } from "@/lib/trpc";
import { TRPCProvider } from "@/lib/trpc-react";
import { AuthLossWatcher } from "./AuthLossWatcher";
import { GuidanceHost } from "./GuidanceHost";

const UntypedCtx = createContext<UntypedApiClient | null>(null);

/** The path-addressed tRPC client (for WidgetDataSource and ad-hoc calls such as `business.continue`). */
export function useUntypedApi(): UntypedApiClient {
  const c = useContext(UntypedCtx);
  if (!c) throw new Error("useUntypedApi must be used inside <AppProviders>");
  return c;
}

export function AppProviders({ children }: { children: ReactNode }) {
  const queryClient = getQueryClient();
  const [trpcClient] = useState(() => createApiClient({ getToken: getRequestAccessToken, queryUrl: browserQueryUrl() }));
  const [untyped] = useState(() => untypedClientOf(trpcClient));
  return (
    <QueryClientProvider client={queryClient}>
      <TRPCProvider trpcClient={trpcClient} queryClient={queryClient}>
        <UntypedCtx.Provider value={untyped}>
          <TooltipProvider delayDuration={400} skipDelayDuration={300}>
            <ToastProvider>
              <AuthLossWatcher />
              <GuidanceHost>{children}</GuidanceHost>
            </ToastProvider>
          </TooltipProvider>
        </UntypedCtx.Provider>
      </TRPCProvider>
    </QueryClientProvider>
  );
}
