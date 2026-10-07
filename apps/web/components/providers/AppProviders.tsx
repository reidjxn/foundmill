"use client";
/**
 * Root providers: TanStack Query, tRPC (typed hooks + the untyped path client for widgets), Dugout toasts and
 * tooltips. Mounted once in app/layout.tsx; everything below can call useTRPC()/useQuery()/useToast().
 */
import { QueryClientProvider } from "@tanstack/react-query";
import { createContext, useContext, useState, type ReactNode } from "react";
import { ToastProvider, TooltipProvider } from "@foundmill/dugout";
import { getQueryClient } from "@/lib/query-client";
import { getBrowserAccessToken } from "@/lib/supabase/client";
import { createApiClient, createUntypedApiClient, type UntypedApiClient } from "@/lib/trpc";
import { TRPCProvider } from "@/lib/trpc-react";

const UntypedCtx = createContext<UntypedApiClient | null>(null);

/** The path-addressed tRPC client (for WidgetDataSource and ad-hoc calls such as `business.continue`). */
export function useUntypedApi(): UntypedApiClient {
  const c = useContext(UntypedCtx);
  if (!c) throw new Error("useUntypedApi must be used inside <AppProviders>");
  return c;
}

export function AppProviders({ children }: { children: ReactNode }) {
  const queryClient = getQueryClient();
  const [trpcClient] = useState(() => createApiClient({ getToken: getBrowserAccessToken }));
  const [untyped] = useState(() => createUntypedApiClient({ getToken: getBrowserAccessToken }));
  return (
    <QueryClientProvider client={queryClient}>
      <TRPCProvider trpcClient={trpcClient} queryClient={queryClient}>
        <UntypedCtx.Provider value={untyped}>
          <TooltipProvider delayDuration={400} skipDelayDuration={300}>
            <ToastProvider>{children}</ToastProvider>
          </TooltipProvider>
        </UntypedCtx.Provider>
      </TRPCProvider>
    </QueryClientProvider>
  );
}
