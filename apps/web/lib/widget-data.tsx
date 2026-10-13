"use client";
/**
 * The host's `WidgetDataSource` for @foundmill/widgets and @foundmill/modules (docs/ARCHITECTURE.md §18): dotted
 * tRPC paths over the untyped client, cached by the same QueryClient (and the same query keys) as the typed hooks,
 * mutations that invalidate their router's queries, the Next.js router for `navigate`, the tab's stream client for
 * `subscribe`, and the business glossary/game mode/currency from `business.get`.
 */
import { useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { useMemo, type ReactNode } from "react";
import type { GameMode } from "@foundmill/shared";
import { WidgetDataProvider, type QueryOptions, type QueryState, type WidgetDataSource } from "@foundmill/widgets/data";
import { getStreamClient } from "@/lib/stream-client";
import { useBusinessLive } from "@/lib/stream-status";
import { trpcPathPrefix, trpcQueryKey, type UntypedApiClient } from "@/lib/trpc";
import { useUntypedApi } from "@/components/providers/AppProviders";

export interface WidgetSourceOptions {
  businessId: string;
  glossary: Record<string, string>;
  gameMode: GameMode;
  currency: string;
  client: UntypedApiClient;
  queryClient: QueryClient;
  navigate: (href: string) => void;
  subscribe?: WidgetDataSource["subscribe"];
}

/** Every procedure the widgets call takes `businessId`; it is merged into the input so widgets never pass it. */
export function withBusiness(businessId: string, input: Record<string, unknown> | undefined): Record<string, unknown> {
  return { businessId, ...(input ?? {}) };
}

/** Routers whose reads change after a mutation on `path` (e.g. inbox.decide → inbox.*, plan.*, dev.*). */
export const INVALIDATION_MAP: Record<string, readonly string[]> = {
  inbox: ["inbox", "plan", "business", "dev", "journey"],
  plan: ["plan", "inbox", "dev", "distribution"],
  dev: ["dev", "team", "department"],
  distribution: ["distribution", "journey"],
  department: ["department", "screen", "business"],
  screen: ["screen", "department"],
  dashboard: ["dashboard"],
  business: ["business", "department", "inbox"],
  team: ["team", "department", "agent"],
  agent: ["agent", "team"],
  product: ["product"],
  finance: ["finance"],
  legal: ["legal"],
  crm: ["crm"],
  integrations: ["integrations", "keys"],
  keys: ["keys", "integrations", "team"],
  billing: ["billing"],
  live: ["live"],
};

export function routersToInvalidate(path: string): readonly string[] {
  const root = path.split(".")[0] ?? path;
  return INVALIDATION_MAP[root] ?? [root];
}

/** Build the data source outside React (tests, stories). The `useQuery` member is a hook and must be called in render. */
export function createWidgetSource(opts: WidgetSourceOptions): WidgetDataSource {
  const { businessId, client, queryClient } = opts;
  return {
    businessId,
    glossary: opts.glossary,
    gameMode: opts.gameMode,
    currency: opts.currency,
    navigate: opts.navigate,
    subscribe: opts.subscribe ?? ((channel, handler) => getStreamClient().subscribe(channel, handler)),
    // While this business's event channel is live the shell refetches on events (INVALIDATE_ON_EVENT); screens poll
    // otherwise. A hook by contract (widgets call it in render).
    useStreamOpen: () => useBusinessLive(businessId),
    // This member is a hook by contract (widgets call it in render).
    useQuery: <T,>(path: string, input: Record<string, unknown> | undefined, qo?: QueryOptions): QueryState<T> => {
      const full = withBusiness(businessId, input);
      const q = useQuery<T, Error>(
        {
          queryKey: trpcQueryKey(path, full) as unknown[],
          queryFn: () => client.query(path, full) as Promise<T>,
          enabled: qo?.enabled ?? true,
          refetchInterval: qo?.refetchIntervalMs,
        },
        queryClient,
      );
      return { data: q.data, isLoading: q.isLoading, error: q.error ?? null, refetch: () => void q.refetch() };
    },
    mutate: async <T,>(path: string, input: Record<string, unknown>): Promise<T> => {
      const result = (await client.mutation(path, withBusiness(businessId, input))) as T;
      await Promise.all(routersToInvalidate(path).map((r) => queryClient.invalidateQueries({ queryKey: trpcPathPrefix(r) as unknown[] })));
      return result;
    },
  };
}

export interface WidgetDataHostProps {
  businessId: string;
  glossary: Record<string, string>;
  gameMode: GameMode;
  /** The business's own currency (`businesses.currency`, 0025): every widget formats business money with it. */
  currency: string;
  children: ReactNode;
}

/** Wraps every business page (ARCHITECTURE §18). */
export function WidgetDataHost({ businessId, glossary, gameMode, currency, children }: WidgetDataHostProps) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const client = useUntypedApi();
  const source = useMemo(
    () => createWidgetSource({ businessId, glossary, gameMode, currency, client, queryClient, navigate: (href) => router.push(href) }),
    [businessId, glossary, gameMode, currency, client, queryClient, router],
  );
  return <WidgetDataProvider source={source}>{children}</WidgetDataProvider>;
}
