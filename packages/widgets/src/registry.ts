/** Widget registry shared by Home dashboards and department screens (BUILD §11.2 "Widget gallery", §6.1). */
import type { ComponentType } from "react";
import type { z } from "zod";

export type WidgetSize = { w: number; h: number; minW?: number; minH?: number; maxW?: number; maxH?: number };

export type WidgetSurface = "home" | "department";

export type WidgetProps<S = Record<string, unknown>> = {
  businessId: string;
  settings: S;
  /** Instance id inside a layout. */
  instanceId: string;
  /** True while the dashboard is in Edit mode (widgets may render lighter). */
  editing?: boolean;
  /** Persist a settings change the widget itself made (zoom level, chosen tab). Optional: hosts without
   *  persistence simply keep the change in memory. */
  updateSettings?: (patch: Partial<S>) => void;
};

/** Props of a widget's settings editor (rendered by the host inside the per-widget settings dialog). */
export type WidgetSettingsProps<S = Record<string, unknown>> = {
  businessId: string;
  value: S;
  onChange: (next: S) => void;
};

export type WidgetDefinition<S = Record<string, unknown>> = {
  key: string;
  title: string;
  description: string;
  /** Lucide icon name used in the add-widget drawer. */
  icon: string;
  /** Which surfaces may use it. */
  surfaces: WidgetSurface[];
  /** Grid units: 12 columns, 8 px rows (see WidgetGrid). */
  defaultSize: WidgetSize;
  settingsSchema?: z.ZodType<S>;
  defaultSettings?: S;
  /** LIVE-only widgets (the community feed). */
  liveOnly?: boolean;
  /** At most one instance per dashboard (Journey Ribbon, status strip). */
  single?: boolean;
  Component: ComponentType<WidgetProps<S>>;
  /** Custom settings editor; widgets without one get the host's generic form from `settingsSchema`. */
  SettingsComponent?: ComponentType<WidgetSettingsProps<S>>;
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type AnyWidgetDefinition = WidgetDefinition<any>;

const registry = new Map<string, AnyWidgetDefinition>();

/**
 * Registers a widget definition. Registering the same key again replaces the earlier definition: under `next dev`
 * (Turbopack hot reload, or a definition module reached through two import paths) a widget module can evaluate twice,
 * and throwing there left Home's Journey on its skeleton. Keys are unique by construction; a unit test checks the
 * source so a real collision still fails CI.
 */
export function registerWidget<S>(def: WidgetDefinition<S>): WidgetDefinition<S> {
  registry.set(def.key, def);
  return def;
}
export function getWidget(key: string): AnyWidgetDefinition | undefined {
  return registry.get(key);
}
export function listWidgets(surface?: WidgetSurface, live = false): AnyWidgetDefinition[] {
  return [...registry.values()].filter((w) => (!surface || w.surfaces.includes(surface)) && (live || !w.liveOnly));
}
export function clearWidgetRegistry(): void {
  registry.clear();
}

/**
 * Parse unknown settings against the widget's schema. Invalid or missing settings fall back to the defaults
 * (then to `{}`), so a stale layout never crashes a widget.
 */
export function parseWidgetSettings<S>(def: WidgetDefinition<S>, raw: unknown): S {
  const fallback = (def.defaultSettings ?? {}) as S;
  if (!def.settingsSchema) return { ...(fallback as object), ...((raw as object) ?? {}) } as S;
  const merged = { ...(fallback as object), ...((typeof raw === "object" && raw ? raw : {}) as object) };
  const parsed = def.settingsSchema.safeParse(merged);
  if (parsed.success) return parsed.data;
  const defaults = def.settingsSchema.safeParse(fallback);
  return defaults.success ? defaults.data : fallback;
}
