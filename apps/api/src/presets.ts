/**
 * Dashboard presets (BUILD §11.2 "presets: Founder's view default, Builder, Seller, Investor update"): the stored
 * layouts, built from the one preset table in @foundmill/config that the widgets package previews from (Edit ›
 * Presets), so New, a preset choice, Reset and the first Home at commit store what the preview shows. Widgets are
 * referenced by registry key (packages/widgets) on the 12-column, 8 px-row grid (Dugout WidgetGrid).
 */
import { DASHBOARD_PRESET_IDS, isDashboardPresetId, presetWidgets, type DashboardPresetId, type PresetOptions } from "@foundmill/config";
import type { ScreenLayout } from "@foundmill/db";

export const DASHBOARD_PRESETS = DASHBOARD_PRESET_IDS;
export type DashboardPreset = DashboardPresetId;

/** The layout a preset stores. The Founder's view gets one department card per visible department (`departments`). */
export function presetLayout(preset: DashboardPreset, options: PresetOptions = {}): ScreenLayout {
  return { widgets: presetWidgets(preset, options) };
}

/** Every preset at its default size (the Founder's view with six department cards), for `dashboard.presets`. */
export const PRESET_LAYOUTS: Record<DashboardPreset, ScreenLayout> = Object.fromEntries(DASHBOARD_PRESETS.map((id) => [id, presetLayout(id)])) as Record<DashboardPreset, ScreenLayout>;

export const isDashboardPreset = isDashboardPresetId;
