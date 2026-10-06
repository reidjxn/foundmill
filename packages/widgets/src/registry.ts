/** Widget registry shared by Home dashboards and department screens (BUILD §11.2 "Widget gallery", §6.1). */
import type { ComponentType } from "react";
import type { z } from "zod";

export type WidgetSize = { w: number; h: number; minW?: number; minH?: number; maxW?: number; maxH?: number };

export type WidgetProps<S = Record<string, unknown>> = {
  businessId: string;
  settings: S;
  /** Instance id inside a layout. */
  instanceId: string;
  /** True while the dashboard is in Edit mode (widgets may render lighter). */
  editing?: boolean;
};

export type WidgetDefinition<S = Record<string, unknown>> = {
  key: string;
  title: string;
  description: string;
  /** Lucide icon name used in the add-widget drawer. */
  icon: string;
  /** Which surfaces may use it. */
  surfaces: ("home" | "department")[];
  /** Grid units: 12 columns, 8 px rows (see WidgetGrid). */
  defaultSize: WidgetSize;
  settingsSchema?: z.ZodType<S>;
  defaultSettings?: S;
  /** LIVE-only widgets (league table, community feed). */
  liveOnly?: boolean;
  Component: ComponentType<WidgetProps<S>>;
};

const registry = new Map<string, WidgetDefinition<any>>();

export function registerWidget<S>(def: WidgetDefinition<S>): WidgetDefinition<S> {
  if (registry.has(def.key)) throw new Error(`Widget "${def.key}" is already registered`);
  registry.set(def.key, def);
  return def;
}
export function getWidget(key: string): WidgetDefinition<any> | undefined {
  return registry.get(key);
}
export function listWidgets(surface?: "home" | "department", live = false): WidgetDefinition<any>[] {
  return [...registry.values()].filter((w) => (!surface || w.surfaces.includes(surface)) && (live || !w.liveOnly));
}
export function clearWidgetRegistry(): void {
  registry.clear();
}
