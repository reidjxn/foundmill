"use client";
/**
 * Root providers: TanStack Query, tRPC (typed hooks + the untyped path client for widgets, over one set of links so
 * their reads made in the same tick share a request), Dugout toasts and tooltips. Mounted once in app/layout.tsx;
 * everything below can call useTRPC()/useQuery()/useToast(). Reads go to this origin (`browserQueryUrl`), changes and
 * streams to the API (lib/trpc.ts).
 */
import { QueryClientProvider } from "@tanstack/react-query";
import { createContext, useContext, useState, type ReactNode } from "react";
import { ToastProvider, TooltipProvider } from "@foundmill/dugout";
import { getQueryClient } from "@/lib/query-client";
import { getRequestAccessToken } from "@/lib/supabase/client";
import { browserQueryUrl, createApiClient, untypedClientOf, type UntypedApiClient } from "@/lib/trpc";
import { TRPCProvider } from "@/lib/trpc-react";
import { AuthLossWatcher } from "./AuthLossWatcher";

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
              {children}
            </ToastProvider>
          </TooltipProvider>
        </UntypedCtx.Provider>
      </TRPCProvider>
    </QueryClientProvider>
  );
}
