/**
 * Dashboard layouts (BUILD §11.2 "Layout edits persist, version, and can be reset", AC-11.2.4).
 *
 * A layout is `{ version, widgets: [{ i, key, x, y, w, h, settings }] }` on the 12-column, 8 px-row grid of
 * Dugout's WidgetGrid. `migrateLayout` upgrades whatever the database holds (the version-less `screen_definitions`
 * shape included) and `validateLayout` normalises a layout against the registry: unknown widgets are dropped,
 * LIVE-only widgets are dropped in Personal mode, sizes are clamped, settings are parsed against each widget's
 * schema, and `single` widgets keep their first instance.
 */
import { z } from "zod";
import type { WidgetLayout, WidgetLayoutItem } from "@foundmill/dugout";
import { getWidget, parseWidgetSettings, type AnyWidgetDefinition } from "./registry";

export const LAYOUT_VERSION = 1 as const;
export const GRID_COLS = 12;
export const GRID_ROW_PX = 8;
export const GRID_GUTTER_PX = 16;

export const LayoutWidget = z.object({
  /** Instance id, unique in the layout. */
  i: z.string().min(1),
  /** Registry key. */
  key: z.string().min(1),
  x: z.number().int().min(0),
  y: z.number().int().min(0),
  w: z.number().int().min(1),
  h: z.number().int().min(1),
  settings: z.record(z.string(), z.unknown()).default({}),
});
export type LayoutWidget = z.infer<typeof LayoutWidget>;

export const DashboardLayout = z.object({
  version: z.literal(LAYOUT_VERSION),
  widgets: z.array(LayoutWidget),
});
export type DashboardLayout = z.infer<typeof DashboardLayout>;

/** The shape `screen_definitions.layout` / `dashboards.layout` hold today (apps/api `ScreenLayout`): no version, no ids. */
export const ScreenLayoutV0 = z.object({
  widgets: z.array(
    z.object({
      key: z.string().min(1),
      x: z.number().int().min(0),
      y: z.number().int().min(0),
      w: z.number().int().min(1),
      h: z.number().int().min(1),
      settings: z.record(z.string(), z.unknown()).default({}),
      i: z.string().min(1).optional(),
    }),
  ),
});
export type ScreenLayoutV0 = z.infer<typeof ScreenLayoutV0>;

/** Pixel height of `h` rows on the grid: rows plus the gutters between them (react-grid-layout's formula). */
export function pxForRows(h: number, rowPx = GRID_ROW_PX, gutter = GRID_GUTTER_PX): number {
  return h * rowPx + Math.max(0, h - 1) * gutter;
}
/** Smallest `h` whose pixel height covers `px`. A 300 px Ribbon plus a 32 px panel header → 15 rows. */
export function rowsForPx(px: number, rowPx = GRID_ROW_PX, gutter = GRID_GUTTER_PX): number {
  return Math.max(1, Math.ceil((px + gutter) / (rowPx + gutter)));
}

export interface LayoutIssue {
  code: "unknown_widget" | "live_only" | "duplicate_single" | "duplicate_id" | "clamped" | "settings_reset" | "out_of_bounds" | "migrated";
  instanceId?: string;
  key?: string;
  message: string;
}

export interface MigrateResult {
  layout: DashboardLayout;
  migrated: boolean;
  issues: LayoutIssue[];
}

/** Deterministic instance id for a version-less placement: `<key>-<n>` by order of appearance. */
export function instanceIdFor(key: string, index: number): string {
  return `${key}-${index + 1}`;
}

/** Upgrade any stored layout to the current version. Garbage becomes an empty layout rather than a crash. */
export function migrateLayout(raw: unknown): MigrateResult {
  const current = DashboardLayout.safeParse(raw);
  if (current.success) return { layout: current.data, migrated: false, issues: [] };
  const v0 = ScreenLayoutV0.safeParse(raw);
  if (v0.success) {
    const counts = new Map<string, number>();
    const widgets = v0.data.widgets.map((w) => {
      const n = counts.get(w.key) ?? 0;
      counts.set(w.key, n + 1);
      return { i: w.i ?? instanceIdFor(w.key, n), key: w.key, x: w.x, y: w.y, w: w.w, h: w.h, settings: w.settings };
    });
    return { layout: { version: LAYOUT_VERSION, widgets }, migrated: true, issues: [{ code: "migrated", message: "Layout upgraded from the version-less screen layout" }] };
  }
  return { layout: { version: LAYOUT_VERSION, widgets: [] }, migrated: true, issues: [{ code: "migrated", message: "Unreadable layout replaced with an empty one" }] };
}

export interface ValidateOptions {
  /** LIVE game mode keeps LIVE-only widgets. Default false. */
  live?: boolean;
  cols?: number;
  /** Registry lookup; defaults to the global registry. */
  resolve?: (key: string) => AnyWidgetDefinition | undefined;
}

export interface ValidateResult {
  ok: boolean;
  layout: DashboardLayout;
  issues: LayoutIssue[];
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** Normalise a layout against the registry (see module doc). `ok` is false when anything was dropped or changed. */
export function validateLayout(input: DashboardLayout, opts: ValidateOptions = {}): ValidateResult {
  const cols = opts.cols ?? GRID_COLS;
  const resolve = opts.resolve ?? getWidget;
  const issues: LayoutIssue[] = [];
  const seenIds = new Set<string>();
  const seenSingle = new Set<string>();
  const widgets: LayoutWidget[] = [];
  for (const w of input.widgets) {
    const def = resolve(w.key);
    if (!def) {
      issues.push({ code: "unknown_widget", instanceId: w.i, key: w.key, message: `Widget "${w.key}" is not in the gallery` });
      continue;
    }
    if (def.liveOnly && !opts.live) {
      issues.push({ code: "live_only", instanceId: w.i, key: w.key, message: `"${def.title}" is LIVE-only` });
      continue;
    }
    if (def.single) {
      if (seenSingle.has(w.key)) {
        issues.push({ code: "duplicate_single", instanceId: w.i, key: w.key, message: `"${def.title}" may appear once; extra instance dropped` });
        continue;
      }
      seenSingle.add(w.key);
    }
    let id = w.i;
    if (seenIds.has(id)) {
      let n = 2;
      while (seenIds.has(`${id}-${n}`)) n += 1;
      id = `${id}-${n}`;
      issues.push({ code: "duplicate_id", instanceId: w.i, key: w.key, message: `Instance id "${w.i}" was duplicated; renamed to "${id}"` });
    }
    seenIds.add(id);
    const s = def.defaultSize;
    const minW = s.minW ?? 1;
    const minH = s.minH ?? 1;
    const maxW = Math.min(s.maxW ?? cols, cols);
    const maxH = s.maxH ?? Number.POSITIVE_INFINITY;
    const width = clamp(w.w, minW, maxW);
    const height = clamp(w.h, minH, maxH);
    const x = clamp(w.x, 0, Math.max(0, cols - width));
    if (width !== w.w || height !== w.h) issues.push({ code: "clamped", instanceId: id, key: w.key, message: `"${def.title}" resized to ${width}×${height}` });
    if (x !== w.x) issues.push({ code: "out_of_bounds", instanceId: id, key: w.key, message: `"${def.title}" moved inside the ${cols}-column grid` });
    const settings = parseWidgetSettings(def, w.settings) as Record<string, unknown>;
    const settingsOk = !def.settingsSchema || def.settingsSchema.safeParse({ ...(def.defaultSettings ?? {}), ...w.settings }).success;
    if (!settingsOk) issues.push({ code: "settings_reset", instanceId: id, key: w.key, message: `Settings for "${def.title}" were invalid and reset to defaults` });
    widgets.push({ i: id, key: w.key, x, y: Math.max(0, w.y), w: width, h: height, settings });
  }
  return { ok: issues.length === 0, layout: { version: LAYOUT_VERSION, widgets }, issues };
}

/** Migrate then validate in one call: what a host does before rendering a stored dashboard. */
export function prepareLayout(raw: unknown, opts: ValidateOptions = {}): ValidateResult & { migrated: boolean } {
  const m = migrateLayout(raw);
  const v = validateLayout(m.layout, opts);
  return { ...v, migrated: m.migrated, issues: [...m.issues, ...v.issues], ok: v.ok && !m.migrated };
}

/** Dugout WidgetGrid shape (`widget` = registry key; min/max from the registry). */
export function toGridLayout(layout: DashboardLayout, resolve: (key: string) => AnyWidgetDefinition | undefined = getWidget): WidgetLayout {
  return layout.widgets.map((w): WidgetLayoutItem => {
    const s = resolve(w.key)?.defaultSize;
    return { i: w.i, widget: w.key, x: w.x, y: w.y, w: w.w, h: w.h, minW: s?.minW, minH: s?.minH, maxW: s?.maxW, maxH: s?.maxH, settings: w.settings };
  });
}

export function fromGridLayout(grid: WidgetLayout): DashboardLayout {
  return { version: LAYOUT_VERSION, widgets: grid.map((it) => ({ i: it.i, key: it.widget, x: it.x, y: it.y, w: it.w, h: it.h, settings: it.settings ?? {} })) };
}

/** The apps/api `ScreenLayout` body for `dashboard.update` / `screen.update` (instance ids travel along as `i`). */
export function toScreenLayout(layout: DashboardLayout): ScreenLayoutV0 {
  return { widgets: layout.widgets.map((w) => ({ key: w.key, x: w.x, y: w.y, w: w.w, h: w.h, settings: w.settings, i: w.i })) };
}

/** Positional equality (ids, keys, geometry and settings), independent of order. */
export function layoutsEqual(a: DashboardLayout, b: DashboardLayout): boolean {
  if (a.widgets.length !== b.widgets.length) return false;
  const key = (w: LayoutWidget) => `${w.i}|${w.key}|${w.x}|${w.y}|${w.w}|${w.h}|${JSON.stringify(w.settings ?? {})}`;
  const sa = a.widgets.map(key).sort();
  const sb = b.widgets.map(key).sort();
  return sa.every((v, i) => v === sb[i]);
}

/** First free row under every widget (where "Add widget" drops a new one). */
export function nextFreeRow(layout: DashboardLayout): number {
  return layout.widgets.reduce((max, w) => Math.max(max, w.y + w.h), 0);
}

/** Append a widget at the bottom-left with its default size and settings. */
export function appendWidget(layout: DashboardLayout, def: AnyWidgetDefinition, settings: Record<string, unknown> = {}): DashboardLayout {
  const used = new Set(layout.widgets.map((w) => w.i));
  let n = layout.widgets.filter((w) => w.key === def.key).length + 1;
  while (used.has(instanceIdFor(def.key, n - 1))) n += 1;
  const item: LayoutWidget = { i: instanceIdFor(def.key, n - 1), key: def.key, x: 0, y: nextFreeRow(layout), w: Math.min(def.defaultSize.w, GRID_COLS), h: def.defaultSize.h, settings: parseWidgetSettings(def, settings) as Record<string, unknown> };
  return { version: LAYOUT_VERSION, widgets: [...layout.widgets, item] };
}
