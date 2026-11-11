"use client";
/**
 * The host's `WidgetDataSource` for @foundmill/widgets and @foundmill/modules (docs/ARCHITECTURE.md §18): dotted
 * tRPC paths over the untyped client, cached by the same QueryClient (and the same query keys) as the typed hooks,
 * mutations that invalidate their router's queries, the Next.js router for `navigate`, the tab's stream client for
 * `subscribe`, and the business glossary/game mode/currency from `business.get`.
 *
 * A change resolves as soon as the API has taken it: the reads it makes stale refetch behind it, so a button settles
 * after one round trip instead of two or three (audit WEB-6). A caller that must read the refreshed data awaits the
 * promise's `settled` (`MutationPromise`; the modules' `useAction` does with `fresh`).
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
  /** The business time zone (businesses.time_zone); null reads as UTC, like the Journey's daily rows. */
  timeZone?: string | null;
  client: UntypedApiClient;
  queryClient: QueryClient;
  navigate: (href: string) => void;
  subscribe?: WidgetDataSource["subscribe"];
  setFocus?: WidgetDataSource["setFocus"];
}

/** Every business procedure the widgets call takes `businessId`; it is merged into the input so widgets never pass it. */
export function withBusiness(businessId: string, input: Record<string, unknown> | undefined): Record<string, unknown> {
  return { businessId, ...(input ?? {}) };
}

/**
 * Routers whose reads belong to the person, not to a business (the API's `protectedProcedure`s: the founder's profile
 * and preferences, ideas, imports, the network), apart from `BUSINESS_READS_IN_ACCOUNT_ROUTERS`: a business procedure,
 * or a read scoped by an optional `businessId` (saved table views are kept per business).
 */
const ACCOUNT_ROUTERS: ReadonlySet<string> = new Set(["founder", "idea", "import", "live"]);
const ACCOUNT_READS: ReadonlySet<string> = new Set(["health", "business.listArchived", "business.example.get", "publicPage.bySlug"]);
const BUSINESS_READS_IN_ACCOUNT_ROUTERS: ReadonlySet<string> = new Set(["founder.tableViews.get"]);

/**
 * A read whose input has no `businessId` at all (lib/__tests__/account-reads.test.ts checks this against the API's
 * router). Its input is used as given, so a widget asking `founder.profile.get` shares the shell's cache entry and
 * request instead of asking again under a key of its own (audit WEB-9).
 */
export function isAccountRead(path: string): boolean {
  if (ACCOUNT_READS.has(path)) return true;
  if (BUSINESS_READS_IN_ACCOUNT_ROUTERS.has(path)) return false;
  return ACCOUNT_ROUTERS.has(path.split(".")[0] ?? path);
}

/** The input a widget read is sent (and cached) with: `businessId` merged in, except for an account read. */
export function readInput(businessId: string, path: string, input: Record<string, unknown> | undefined): Record<string, unknown> | undefined {
  return isAccountRead(path) ? input : withBusiness(businessId, input);
}

/** What `mutate` returns: the change's answer, and `settled`, which resolves once the reads it made stale have refetched. */
export type MutationPromise<T> = Promise<T> & { settled: Promise<void> };

/** The host's data source: the widgets' contract, with `mutate` returning a `MutationPromise`. */
export type HostWidgetDataSource = Omit<WidgetDataSource, "mutate"> & { mutate: <T = unknown>(path: string, input: Record<string, unknown>) => MutationPromise<T> };

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
  // A public page published or taken down changes Today's quiet line too.
  page: ["page", "today"],
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
export function createWidgetSource(opts: WidgetSourceOptions): HostWidgetDataSource {
  const { businessId, client, queryClient } = opts;
  return {
    businessId,
    glossary: opts.glossary,
    gameMode: opts.gameMode,
    currency: opts.currency,
    timeZone: opts.timeZone ?? null,
    navigate: opts.navigate,
    // Focus reaches the stream server too, so a watched Live sessions tile is the last to be shed under backpressure.
    subscribe: opts.subscribe ?? ((channel, handler, so) => getStreamClient().subscribe(channel, handler, so)),
    setFocus: opts.setFocus ?? ((channel, focused) => getStreamClient().setFocus(channel, focused)),
    // While this business's event channel is live the shell refetches on events (INVALIDATE_ON_EVENT); screens poll
    // otherwise. A hook by contract (widgets call it in render).
    useStreamOpen: () => useBusinessLive(businessId),
    // This member is a hook by contract (widgets call it in render).
    useQuery: <T,>(path: string, input: Record<string, unknown> | undefined, qo?: QueryOptions): QueryState<T> => {
      const full = readInput(businessId, path, input);
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
    mutate: <T,>(path: string, input: Record<string, unknown>): MutationPromise<T> => {
      let markSettled: () => void = () => undefined;
      const settled = new Promise<void>((resolve) => (markSettled = resolve));
      const answer = (async () => {
        try {
          const result = (await client.mutation(path, withBusiness(businessId, input))) as T;
          // Not awaited: the caller has its answer now; the screens refresh what changed behind it.
          void Promise.all(routersToInvalidate(path).map((r) => queryClient.invalidateQueries({ queryKey: trpcPathPrefix(r) as unknown[] }))).then(markSettled, markSettled);
          return result;
        } catch (err) {
          markSettled();
          throw err;
        }
      })();
      return Object.assign(answer, { settled });
    },
  };
}

export interface WidgetDataHostProps {
  businessId: string;
  glossary: Record<string, string>;
  gameMode: GameMode;
  /** The business's own currency (`businesses.currency`, 0025): every widget formats business money with it. */
  currency: string;
  timeZone?: string | null;
  children: ReactNode;
}

/** Wraps every business page (ARCHITECTURE §18). */
export function WidgetDataHost({ businessId, glossary, gameMode, currency, timeZone = null, children }: WidgetDataHostProps) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const client = useUntypedApi();
  const source = useMemo(
    () => createWidgetSource({ businessId, glossary, gameMode, currency, timeZone, client, queryClient, navigate: (href) => router.push(href) }),
    [businessId, glossary, gameMode, currency, timeZone, client, queryClient, router],
  );
  return <WidgetDataProvider source={source}>{children}</WidgetDataProvider>;
}
