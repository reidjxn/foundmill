"use client";
/**
 * Saved table views for the app's own screens (audit #204): the same store as the module tables'
 * `useSavedViews` (founder.tableViews, saved_table_views 0041), called through tRPC because these screens are not
 * widgets. Spread the result onto the DataTable:
 *
 *   const savedViews = useTableViews("crm.list", CRM_VIEWS, { businessId, defaultViewId: "all" });
 *   <DataTable {...savedViews} … />
 *
 * `businessId` scopes the views to one business; leave it out for an account-wide table.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback } from "react";
import type { SavedView } from "@foundmill/dugout";
import { useSavedViewsState, type SavedViewsProps, type StoredTableViews } from "@foundmill/widgets/shared/saved-views";
import type { RouterOutputs } from "./trpc";
import { useTRPC } from "./trpc-react";

export interface TableViewsOptions {
  businessId?: string | null;
  /** The view the screen opens on before the person picked one. */
  defaultViewId?: string;
}

export function useTableViews(tableKey: string, defaults: readonly SavedView[], opts: TableViewsOptions = {}): SavedViewsProps {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const businessId = opts.businessId ?? null;
  const input = { tableKey, businessId };
  const stored = useQuery(trpc.founder.tableViews.get.queryOptions(input, { staleTime: Infinity, retry: false }));
  const { mutate } = useMutation(trpc.founder.tableViews.save.mutationOptions());
  // The cached answer follows every change at once, so the screen shows the change when it is opened again in this
  // visit too; a failed save keeps it on screen for this visit, and the next change tries again.
  const save = useCallback(
    (next: StoredTableViews) => {
      // The store keeps what the DataTable gave it, so the cache holds the same shape a fetch would return.
      queryClient.setQueryData(trpc.founder.tableViews.get.queryKey({ tableKey, businessId }), next as unknown as RouterOutputs["founder"]["tableViews"]["get"]);
      mutate({ tableKey, businessId, views: next.views, activeViewId: next.activeViewId });
    },
    [trpc, queryClient, mutate, tableKey, businessId],
  );
  // The store keeps what the DataTable gave it (validated on the way in), so its rows are SavedViews again.
  const answer = stored.isError ? null : (stored.data as StoredTableViews | null | undefined);
  return useSavedViewsState(defaults, answer, save, opts.defaultViewId);
}
