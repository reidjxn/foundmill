/**
 * Dashboard presets (BUILD §11.2 "presets: Founder's view default, Builder, Seller, Investor update"). Widgets are
 * referenced by registry key (packages/widgets); the grid is 12 columns, 8 px rows (Dugout WidgetGrid).
 */
import type { ScreenLayout } from "@foundmill/db";

export const DASHBOARD_PRESETS = ["founder", "builder", "seller", "investor"] as const;
export type DashboardPreset = (typeof DASHBOARD_PRESETS)[number];

const w = (key: string, x: number, y: number, w: number, h: number, settings: Record<string, unknown> = {}) => ({ key, x, y, w, h, settings });

export const PRESET_LAYOUTS: Record<DashboardPreset, ScreenLayout> = {
  founder: {
    widgets: [
      w("journey_ribbon", 0, 0, 12, 38),
      w("status_strip", 0, 38, 12, 12),
      w("department_card", 0, 50, 4, 30, { slot: 0 }),
      w("department_card", 4, 50, 4, 30, { slot: 1 }),
      w("department_card", 8, 50, 4, 30, { slot: 2 }),
      w("department_card", 0, 80, 4, 30, { slot: 3 }),
      w("department_card", 4, 80, 4, 30, { slot: 4 }),
      w("department_card", 8, 80, 4, 30, { slot: 5 }),
      w("squad_pulse", 0, 110, 8, 32),
      w("inbox_preview", 8, 110, 4, 32),
    ],
  },
  builder: {
    widgets: [w("status_strip", 0, 0, 12, 12), w("roadmap_timeline", 0, 12, 8, 36), w("live_feed", 8, 12, 4, 36), w("department_card", 0, 48, 6, 30, { module: "development" }), w("department_card", 6, 48, 6, 30, { module: "product" }), w("inbox_preview", 0, 78, 12, 28)],
  },
  seller: {
    widgets: [w("status_strip", 0, 0, 12, 12), w("funnel", 0, 12, 6, 36), w("channel_form_guide", 6, 12, 6, 36), w("revenue_customers", 0, 48, 8, 32), w("inbox_preview", 8, 48, 4, 32), w("department_card", 0, 80, 6, 30, { module: "distribution" })],
  },
  investor: {
    widgets: [w("journey_ribbon", 0, 0, 12, 38), w("cash_runway", 0, 38, 6, 30), w("revenue_customers", 6, 38, 6, 30), w("trophy_cabinet", 0, 68, 6, 28), w("agent_of_the_week", 6, 68, 6, 28)],
  },
};

export const isDashboardPreset = (v: unknown): v is DashboardPreset => typeof v === "string" && (DASHBOARD_PRESETS as readonly string[]).includes(v);
