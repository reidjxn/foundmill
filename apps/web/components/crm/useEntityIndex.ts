"use client";
/**
 * The CRM list's data: `crm.search` when the box has text; otherwise `crm.entity.list` when the API has it, with a
 * fallback to the union of `crm.roles.byRole` listings over the known roles (there is no list procedure in the API
 * yet, see docs/PROGRESS.md). Chips filter server-side in search mode and client-side in listing mode.
 */
import { useQueries, useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import type { FilterChipValue } from "@foundmill/dugout";
import { trpcErrorCode, trpcQueryKey } from "@/lib/trpc";
import { useTRPC } from "@/lib/trpc-react";
import { useUntypedApi } from "@/components/providers/AppProviders";
import { applyChipFilters, rowFromEntity, rowsFromRoleListings, rowsFromSearch, type CrmRow, type RoleListingRow, type RowResolvers } from "./logic";
import { KNOWN_ROLES, chipValue, toSearchInput, type SearchResolvers } from "./search";

export interface EntityIndex {
  rows: CrmRow[];
  mode: "search" | "list";
  loading: boolean;
  error: unknown;
  refetch: () => void;
  /** Roles seen in the data (feeds the role filter options). */
  roles: string[];
}

type ListEntity = Parameters<typeof rowFromEntity>[0] & { roles?: Parameters<typeof rowFromEntity>[1] };

export function useEntityIndex(businessId: string, text: string, chips: readonly FilterChipValue[], resolvers: SearchResolvers & RowResolvers = {}): EntityIndex {
  const trpc = useTRPC();
  const untyped = useUntypedApi();
  const searchInput = useMemo(() => toSearchInput(text, chips, resolvers), [text, chips, resolvers]);

  const searchQ = useQuery(trpc.crm.search.queryOptions({ businessId, ...(searchInput ?? { q: "-" }) }, { enabled: searchInput !== null, staleTime: 15_000, retry: false, placeholderData: (prev) => prev }));

  // Optional list procedure: present in later API builds; NOT_FOUND here switches to the role union.
  const listQ = useQuery({
    queryKey: trpcQueryKey("crm.entity.list", { businessId, limit: 500 }) as unknown[],
    queryFn: async () => (await untyped.query("crm.entity.list", { businessId, limit: 500 })) as { items: ListEntity[] },
    enabled: searchInput === null,
    staleTime: 30_000,
    retry: false,
  });
  const listMissing = listQ.error ? trpcErrorCode(listQ.error) === "NOT_FOUND" : false;

  const roleChip = chipValue(chips, "role");
  const roles = useMemo(() => [...new Set([...KNOWN_ROLES, ...(roleChip ? [roleChip] : [])])], [roleChip]);
  const roleQs = useQueries({
    queries: roles.map((role) => trpc.crm.roles.byRole.queryOptions({ businessId, role, limit: 500 }, { enabled: searchInput === null && listMissing, staleTime: 30_000, retry: false })),
  });

  return useMemo<EntityIndex>(() => {
    if (searchInput !== null) {
      const rows = searchQ.data ? rowsFromSearch(searchQ.data.hits) : [];
      return { rows, mode: "search", loading: searchQ.isLoading, error: searchQ.error, refetch: () => void searchQ.refetch(), roles: [...new Set(rows.flatMap((r) => r.roles))] };
    }
    if (!listMissing) {
      const rows = listQ.data ? listQ.data.items.map((e) => rowFromEntity(e, e.roles ?? [])) : [];
      return { rows: applyChipFilters(rows, chips, resolvers), mode: "list", loading: listQ.isLoading, error: listQ.error, refetch: () => void listQ.refetch(), roles: [...new Set(rows.flatMap((r) => r.roles))] };
    }
    const listings = roleQs.map((q) => (q.data?.items ?? []) as RoleListingRow[]);
    const rows = rowsFromRoleListings(listings);
    const firstError = roleQs.find((q) => q.error && trpcErrorCode(q.error) !== "NOT_FOUND")?.error ?? null;
    return {
      rows: applyChipFilters(rows, chips, resolvers),
      mode: "list",
      loading: roleQs.some((q) => q.isLoading) && rows.length === 0,
      error: rows.length === 0 ? firstError : null,
      refetch: () => roleQs.forEach((q) => void q.refetch()),
      roles: [...new Set(rows.flatMap((r) => r.roles))],
    };
  }, [searchInput, searchQ, listMissing, listQ, roleQs, chips, resolvers]);
}
