"use client";
/**
 * The CRM list's data: `crm.search` when the box has text, otherwise `crm.entity.list`. Both return each record with
 * its active roles (role, stage, owner) and apply the chips server-side (`chipFilters`), so role and stage views,
 * chips and natural-language filters see every record. Chips the API cannot take (an owner name that resolves to no
 * id) are applied to the returned rows.
 *
 * Both are paged: the list by cursor (500 at a time), the search by offset (100 at a time). The hook keeps loading the
 * next page until everything is loaded, so sorting, grouping and the data-duties review cover the whole CRM; past
 * `CRM_AUTO_LOAD_ROWS` rows it stops and hands the next page to the founder (`loadMore`). `total` is the server's count
 * of the records the filters match, so a partial list always says how much is missing.
 */
import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { useEffect, useMemo } from "react";
import type { FilterChipValue } from "@foundmill/dugout";
import { useTRPC, useTRPCClient } from "@/lib/trpc-react";
import { applyChipFilters, rowFromEntity, rowsFromSearch, type CrmRow, type RowResolvers } from "./logic";
import { chipFilters, toListFilter, toSearchInput, type SearchResolvers } from "./search";

/** Records the list loads per request (the API's page maximum). */
export const CRM_LIST_LIMIT = 500;
/** Search hits per request (the API's page maximum). */
export const CRM_SEARCH_LIMIT = 100;
/** Rows loaded without asking; beyond this the founder loads further pages (keeps the table and the requests bounded). */
export const CRM_AUTO_LOAD_ROWS = 5_000;

export interface EntityIndex {
  rows: CrmRow[];
  mode: "search" | "list";
  loading: boolean;
  error: unknown;
  refetch: () => void;
  /** Roles seen in the data (feeds the role filter options). */
  roles: string[];
  /** Records the filters match on the server (list mode); null when it is not known (search, or a chip applied to the rows). */
  total: number | null;
  /** More records match than the rows hold (pages still loading, or waiting for `loadMore`). */
  hasMore: boolean;
  /** A further page is being fetched. */
  loadingMore: boolean;
  /** The next page failed to load. */
  loadMoreFailed: boolean;
  /** Fetch the next page now (the founder asked, or the automatic loading reached its limit). */
  loadMore: () => void;
}

export function useEntityIndex(businessId: string, text: string, chips: readonly FilterChipValue[], resolvers: SearchResolvers & RowResolvers = {}): EntityIndex {
  const trpc = useTRPC();
  const client = useTRPCClient();
  const searchInput = useMemo(() => toSearchInput(text, chips, resolvers, CRM_SEARCH_LIMIT), [text, chips, resolvers]);
  const { filters, unresolved } = useMemo(() => chipFilters(chips, resolvers), [chips, resolvers]);
  const listFilter = useMemo(() => toListFilter(filters), [filters]);

  const searchQ = useInfiniteQuery({
    // The tRPC key plus a marker: crm-wide invalidation (trpcPathPrefix("crm")) still matches it.
    queryKey: [...trpc.crm.search.queryKey({ businessId, ...(searchInput ?? { q: "-" }) }), "pages"],
    queryFn: ({ pageParam }) => client.crm.search.query({ businessId, ...(searchInput ?? { q: "-" }), offset: pageParam }),
    initialPageParam: 0,
    getNextPageParam: (last) => last.nextOffset ?? undefined,
    enabled: searchInput !== null,
    staleTime: 15_000,
    retry: false,
    placeholderData: (prev) => prev,
  });
  const listQ = useInfiniteQuery(
    trpc.crm.entity.list.infiniteQueryOptions({ businessId, limit: CRM_LIST_LIMIT, ...listFilter }, { getNextPageParam: (last) => last.nextCursor ?? undefined, initialCursor: null, enabled: searchInput === null, staleTime: 30_000, retry: false, placeholderData: (prev) => prev }),
  );
  const countQ = useQuery(trpc.crm.entity.count.queryOptions({ businessId, ...listFilter }, { enabled: searchInput === null, staleTime: 30_000, retry: false, placeholderData: (prev) => prev }));

  const searching = searchInput !== null;
  const active = searching ? searchQ : listQ;
  const rows = useMemo<CrmRow[]>(() => {
    // A row filtered by role or stage shows that role's stage and owner.
    const focus = { role: filters.role, stage: filters.stage };
    const finish = (r: CrmRow[]) => applyChipFilters(r, unresolved, resolvers);
    const seen = new Set<string>();
    const unique = <T extends { id: string }>(items: T[]) => items.filter((x) => (seen.has(x.id) ? false : (seen.add(x.id), true)));
    if (searching) return finish(unique(rowsFromSearch((searchQ.data?.pages ?? []).flatMap((p) => p.hits), focus)));
    return finish(unique((listQ.data?.pages ?? []).flatMap((p) => p.items).map((e) => rowFromEntity(e, e.roles, focus))));
  }, [searching, searchQ.data, listQ.data, filters, unresolved, resolvers]);

  // Keep loading until everything is here (or the automatic limit is reached); a failed page stops the loop.
  const { hasNextPage, isFetching, isFetchNextPageError, fetchNextPage } = active;
  const loaded = rows.length;
  useEffect(() => {
    if (hasNextPage && !isFetching && !isFetchNextPageError && loaded < CRM_AUTO_LOAD_ROWS) void fetchNextPage();
  }, [hasNextPage, isFetching, isFetchNextPageError, loaded, fetchNextPage]);

  const roles = useMemo(() => [...new Set(rows.flatMap((r) => r.roles))], [rows]);
  return {
    rows,
    mode: searching ? "search" : "list",
    loading: active.isLoading,
    error: active.error,
    refetch: () => void active.refetch(),
    roles,
    total: searching || unresolved.length > 0 ? null : (countQ.data?.total ?? null),
    hasMore: !!hasNextPage,
    loadingMore: active.isFetchingNextPage,
    loadMoreFailed: isFetchNextPageError,
    loadMore: () => void fetchNextPage(),
  };
}
