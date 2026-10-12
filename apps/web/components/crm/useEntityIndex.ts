"use client";
/**
 * The CRM list's data: `crm.search` when the box has text, otherwise `crm.entity.list`. Both return each record with
 * its active roles (role, stage, owner) and apply the chips server-side (`chipFilters`), so chips and natural-language
 * filters match every record, not one loaded page. The list loads CRM_LIST_LIMIT records at a time (`loadMore` fetches
 * the next ones) and knows how many match in all. Chips the API cannot take (an owner name that resolves to no id) are
 * applied to the returned rows.
 */
import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import type { FilterChipValue } from "@foundmill/dugout";
import { useTRPC } from "@/lib/trpc-react";
import { applyChipFilters, rowFromEntity, rowsFromSearch, type CrmRow, type RowResolvers } from "./logic";
import { chipFilters, toListFilter, toSearchInput, type SearchResolvers } from "./search";

/** Records the list loads at a time (the API's page maximum). */
export const CRM_LIST_LIMIT = 500;

export interface EntityIndex {
  rows: CrmRow[];
  mode: "search" | "list";
  loading: boolean;
  error: unknown;
  refetch: () => void;
  /** Roles seen in the data (feeds the role filter options). */
  roles: string[];
  /** List mode: every record the filters match, loaded or not; null in search mode or when a chip is applied to the rows. */
  total: number | null;
  /** More records match than are loaded; `loadMore` fetches the next CRM_LIST_LIMIT. */
  hasMore: boolean;
  loadMore: () => void;
  loadingMore: boolean;
}

export function useEntityIndex(businessId: string, text: string, chips: readonly FilterChipValue[], resolvers: SearchResolvers & RowResolvers = {}): EntityIndex {
  const trpc = useTRPC();
  const searchInput = useMemo(() => toSearchInput(text, chips, resolvers), [text, chips, resolvers]);
  const { filters, unresolved } = useMemo(() => chipFilters(chips, resolvers), [chips, resolvers]);

  const searchQ = useQuery(trpc.crm.search.queryOptions({ businessId, ...(searchInput ?? { q: "-" }) }, { enabled: searchInput !== null, staleTime: 15_000, retry: false, placeholderData: (prev) => prev }));
  const listQ = useInfiniteQuery(
    trpc.crm.entity.list.infiniteQueryOptions(
      { businessId, limit: CRM_LIST_LIMIT, ...toListFilter(filters) },
      { enabled: searchInput === null, getNextPageParam: (last) => last.nextCursor ?? undefined, initialCursor: null, staleTime: 30_000, retry: false, placeholderData: (prev) => prev },
    ),
  );

  return useMemo<EntityIndex>(() => {
    // A row filtered by role or stage shows that role's stage and owner.
    const focus = { role: filters.role, stage: filters.stage };
    const finish = (rows: CrmRow[]) => applyChipFilters(rows, unresolved, resolvers);
    if (searchInput !== null) {
      const rows = searchQ.data ? finish(rowsFromSearch(searchQ.data.hits, focus)) : [];
      return { rows, mode: "search", loading: searchQ.isLoading, error: searchQ.error, refetch: () => void searchQ.refetch(), roles: [...new Set(rows.flatMap((r) => r.roles))], total: null, hasMore: false, loadMore: () => undefined, loadingMore: false };
    }
    const pages = listQ.data?.pages ?? [];
    const rows = finish(pages.flatMap((p) => p.items.map((e) => rowFromEntity(e, e.roles, focus))));
    return {
      rows,
      mode: "list",
      loading: listQ.isLoading,
      error: listQ.error,
      refetch: () => void listQ.refetch(),
      roles: [...new Set(rows.flatMap((r) => r.roles))],
      total: pages.length && !unresolved.length ? pages[0]!.total : null,
      hasMore: !!listQ.hasNextPage,
      loadMore: () => void listQ.fetchNextPage(),
      loadingMore: listQ.isFetchingNextPage,
    };
  }, [searchInput, searchQ, listQ, filters, unresolved, resolvers]);
}
