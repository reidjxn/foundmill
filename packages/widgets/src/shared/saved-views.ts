"use client";
/**
 * Saved table views that survive a reload (audit #204). Every DataTable with saved views takes its `views`,
 * `activeViewId` and change handlers from `useSavedViews(tableKey, builtIns)`: the person's own list and open view are
 * stored per person, business and table (`founder.tableViews`, saved_table_views 0041), and the built-in views stay in
 * code. A table outside a business (the LIVE pages) stores the same shape through the host's own hook.
 */
import { useCallback, useMemo, useRef, useState } from "react";
import type { SavedView } from "@foundmill/dugout";
import { useWidgetData, useWidgetQuery } from "../data";

/** What the store keeps for one table. */
export interface StoredTableViews {
  views: SavedView[];
  activeViewId: string | null;
}

/** The DataTable props the hook provides. */
export interface SavedViewsProps {
  views: SavedView[];
  activeViewId: string | null;
  onViewsChange: (views: SavedView[]) => void;
  onActiveViewChange: (id: string | null) => void;
}

/**
 * The views a table shows: the person's list as they last left it, with every built-in view (`builtIn: true`, which can
 * only be copied) present and as the code defines it today. Without a stored list, the code's views.
 */
export function mergeSavedViews(defaults: readonly SavedView[], stored: StoredTableViews | null | undefined): SavedView[] {
  if (!stored) return [...defaults];
  const builtIn = new Map(defaults.filter((v) => v.builtIn).map((v) => [v.id, v]));
  const list = stored.views.map((v) => builtIn.get(v.id) ?? v);
  for (const v of defaults) if (v.builtIn && !list.some((x) => x.id === v.id)) list.push(v);
  return list;
}

/** The view to open: the stored one when it still exists, else the screen's default, else the first. */
export function resolveActiveViewId(views: readonly SavedView[], wanted: string | null | undefined, fallback?: string): string | null {
  if (wanted && views.some((v) => v.id === wanted)) return wanted;
  if (fallback && views.some((v) => v.id === fallback)) return fallback;
  return views[0]?.id ?? null;
}

/**
 * The view state over any store: `stored` is what the store answered (undefined while loading, null when the person
 * never saved or the store could not answer), `save` writes the whole state. The latest change shows at once, before
 * the store answers. Until it has answered the table shows the screen's default view; the DataTable then applies the
 * person's open view, also one they saved over a default of the same id.
 */
export function useSavedViewsState(defaults: readonly SavedView[], stored: StoredTableViews | null | undefined, save: (next: StoredTableViews) => void, defaultViewId?: string): SavedViewsProps {
  const [local, setLocal] = useState<StoredTableViews | null>(null);
  const current = local ?? stored ?? null;
  const views = useMemo(() => mergeSavedViews(defaults, current), [defaults, current]);
  const activeViewId = resolveActiveViewId(views, current?.activeViewId, defaultViewId);
  // The views as of the latest write, even before the screen re-renders: saving a view as new adds it and then makes it
  // the active one in the same tick, and the second write must carry the first one's views.
  const latestViews = useRef<SavedView[]>(views);
  latestViews.current = views;
  const write = useCallback(
    (next: StoredTableViews) => {
      latestViews.current = next.views;
      setLocal(next);
      save(next);
    },
    [save],
  );
  return {
    views,
    activeViewId,
    onViewsChange: useCallback((next: SavedView[]) => write({ views: next, activeViewId: resolveActiveViewId(next, activeViewId, defaultViewId) }), [write, activeViewId, defaultViewId]),
    onActiveViewChange: useCallback((id: string | null) => write({ views: latestViews.current, activeViewId: id }), [write]),
  };
}

/**
 * A business table's saved views, stored for the signed-in person (`tableKey`: "team.agents", "crm.list", …). Spread
 * the result onto the DataTable: `<DataTable {...useSavedViews("team.agents", TEAM_SQUAD_VIEWS)} … />`. A failed save
 * keeps the change on screen for this visit.
 */
export function useSavedViews(tableKey: string, defaults: readonly SavedView[], opts: { defaultViewId?: string } = {}): SavedViewsProps {
  const { mutate } = useWidgetData();
  const stored = useWidgetQuery<StoredTableViews | null>("founder.tableViews.get", { tableKey });
  const save = useCallback((next: StoredTableViews) => void mutate("founder.tableViews.save", { tableKey, views: next.views, activeViewId: next.activeViewId }).catch(() => undefined), [mutate, tableKey]);
  // A store that cannot answer leaves the table on its built-in views rather than on no view at all.
  return useSavedViewsState(defaults, stored.error ? null : stored.data, save, opts.defaultViewId);
}
