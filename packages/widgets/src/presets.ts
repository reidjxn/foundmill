/**
 * Dashboard presets (BUILD §11.2 "presets: Founder's view default, Builder, Seller, Investor update"), built from the
 * one preset table in @foundmill/config that apps/api also stores layouts from, so a preview here is what New, a
 * preset choice and Reset save. Heights follow the WidgetGrid formula (8 px rows + 16 px gutters, see layout.ts): the
 * Ribbon's 300 px plus its panel header is 15 rows, department cards 12, the status strip 6, and every other widget at
 * least its registry default height (sized to its content), so no preset draws a footer over a widget's content.
 * Custom metrics use catalog ids only (apps/api services/metrics.ts METRICS, listed by `dashboard.customMetric.list`).
 */
import { DASHBOARD_PRESET_IDS, DASHBOARD_PRESET_INFO, DEFAULT_DASHBOARD_PRESET, isDashboardPresetId, presetWidgets, type DashboardPresetId, type PresetOptions } from "@foundmill/config";
import { instanceIdFor, LAYOUT_VERSION, type DashboardLayout } from "./layout";

export { DASHBOARD_PRESET_IDS, DEFAULT_DASHBOARD_PRESET, isDashboardPresetId, type DashboardPresetId, type PresetOptions };

export interface DashboardPreset {
  id: DashboardPresetId;
  name: string;
  description: string;
  layout: DashboardLayout;
}

/** A fresh copy of a preset layout (safe to mutate); instance ids are `<key>-<n>`, as `migrateLayout` derives them. */
export function presetLayout(id: DashboardPresetId = DEFAULT_DASHBOARD_PRESET, options: PresetOptions = {}): DashboardLayout {
  const counts = new Map<string, number>();
  const widgets = presetWidgets(id, options).map((w) => {
    const n = counts.get(w.key) ?? 0;
    counts.set(w.key, n + 1);
    return { i: instanceIdFor(w.key, n), ...w, settings: { ...w.settings } };
  });
  return { version: LAYOUT_VERSION, widgets };
}

/** Every preset with its name, description and layout (the Founder's view sized by `options.departments`). */
export function dashboardPresets(options: PresetOptions = {}): Record<DashboardPresetId, DashboardPreset> {
  return Object.fromEntries(DASHBOARD_PRESET_IDS.map((id) => [id, { id, ...DASHBOARD_PRESET_INFO[id], layout: presetLayout(id, options) }])) as Record<DashboardPresetId, DashboardPreset>;
}

export const DASHBOARD_PRESETS: Record<DashboardPresetId, DashboardPreset> = dashboardPresets();

export const DASHBOARD_PRESET_LIST: DashboardPreset[] = DASHBOARD_PRESET_IDS.map((id) => DASHBOARD_PRESETS[id]);
