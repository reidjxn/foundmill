"use client";
/**
 * "Pin to Home" (BUILD §11.2: every panel's caret menu offers it; audit #394). A panel that shows a gallery widget
 * appends that widget, with its settings, to the founder's active Home dashboard through `dashboard.update`; pressed
 * again ("Unpin from Home") it takes it off. Widgets on a department screen get the item from WidgetFrame through the
 * instance the host provides (`WidgetInstanceProvider`); a module screen's own panel asks for it with
 * `usePinToHomeMenu({ key })` naming the gallery widget it matches. Home itself provides no instance: its widgets are
 * already there.
 */
import { createContext, createElement, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import type { PanelMenu } from "@foundmill/dugout";
import { useWidgetData, useWidgetQuery } from "../data";
import { appendWidget, migrateLayout, toScreenLayout, type DashboardLayout } from "../layout";
import { getWidget, parseWidgetSettings, type AnyWidgetDefinition } from "../registry";

/** The gallery widget a panel shows, and the settings it shows it with. */
export interface WidgetInstance {
  key: string;
  settings?: Record<string, unknown>;
}

const WidgetInstanceContext = createContext<WidgetInstance | null>(null);

/** Wraps a widget rendered away from Home, so its frame offers Pin to Home. */
export function WidgetInstanceProvider({ value, children }: { value: WidgetInstance; children?: ReactNode }) {
  return createElement(WidgetInstanceContext.Provider, { value }, children);
}

export function useWidgetInstance(): WidgetInstance | null {
  return useContext(WidgetInstanceContext);
}

const sameSettings = (a: Record<string, unknown>, b: Record<string, unknown>): boolean => JSON.stringify(sortKeys(a)) === JSON.stringify(sortKeys(b));
function sortKeys(v: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(v).sort(([x], [y]) => x.localeCompare(y)));
}

/** Where the dashboard already shows this widget (a `single` widget by key alone), or -1. */
export function pinnedIndex(layout: DashboardLayout, def: AnyWidgetDefinition, settings: Record<string, unknown> = {}): number {
  const wanted = parseWidgetSettings(def, settings) as Record<string, unknown>;
  return layout.widgets.findIndex((w) => w.key === def.key && (def.single || sameSettings(parseWidgetSettings(def, w.settings) as Record<string, unknown>, wanted)));
}

/** The layout with the widget added at the bottom, or taken off when it is already there. */
export function togglePinned(layout: DashboardLayout, def: AnyWidgetDefinition, settings: Record<string, unknown> = {}): DashboardLayout {
  const at = pinnedIndex(layout, def, settings);
  if (at >= 0) return { ...layout, widgets: layout.widgets.filter((_, i) => i !== at) };
  return appendWidget(layout, def, settings);
}

interface HomeDashboard {
  id: string;
  layout: unknown;
}

/**
 * The caret menu for a panel showing `target` (null: no menu). Reads the active Home dashboard (`dashboard.get`, the
 * query Home itself makes) and writes the whole layout back, so Home shows the change when it is next opened.
 */
export function usePinToHomeMenu(target: WidgetInstance | null): PanelMenu | undefined {
  const { mutate } = useWidgetData();
  const def = target ? getWidget(target.key) : undefined;
  const unregistered = !!target && !def;
  const [, setGalleryLoaded] = useState(false);
  // A module screen can render before any gallery widget registered (department tabs no longer import the gallery
  // up front, audit WEB-8): load it on demand, then read the definition again.
  useEffect(() => {
    if (!unregistered) return;
    let live = true;
    void import("../widgets").then(
      () => {
        if (live) setGalleryLoaded(true);
      },
      () => undefined,
    );
    return () => {
      live = false;
    };
  }, [unregistered]);
  const home = useWidgetQuery<HomeDashboard>("dashboard.get", {}, { enabled: !!def });
  const settings = target?.settings;
  const stored = home.data?.layout;
  const layout = useMemo(() => (stored === undefined ? null : migrateLayout(stored).layout), [stored]);
  const pinned = !!def && !!layout && pinnedIndex(layout, def, settings) >= 0;
  const dashboardId = home.data?.id;
  const onPinToHome = useCallback(() => {
    if (!def || !layout || !dashboardId) return;
    // A failed write leaves Home as it was; the item keeps its label and can be pressed again.
    void mutate("dashboard.update", { dashboardId, layout: toScreenLayout(togglePinned(layout, def, settings)) }).catch(() => undefined);
  }, [def, layout, dashboardId, settings, mutate]);
  if (!def || !layout) return undefined;
  return { onPinToHome, pinned };
}
