/**
 * Dashboard presets (BUILD §11.2 "presets: Founder's view default, Builder, Seller, Investor update").
 * Heights follow the WidgetGrid formula (8 px rows + 16 px gutters, see layout.ts): the Ribbon's 300 px plus its
 * panel header is 15 rows, department cards 12, the status strip 6, and every other widget at least its registry
 * default height (sized to its content), so no preset draws a footer over a widget's content. Custom metrics use
 * catalog ids only (apps/api services/metrics.ts METRICS, listed by `dashboard.customMetric.list`).
 */
import { LAYOUT_VERSION, type DashboardLayout, type LayoutWidget } from "./layout";

export const DASHBOARD_PRESET_IDS = ["founder", "builder", "seller", "investor"] as const;
export type DashboardPresetId = (typeof DASHBOARD_PRESET_IDS)[number];

export interface DashboardPreset {
  id: DashboardPresetId;
  name: string;
  description: string;
  layout: DashboardLayout;
}

const w = (i: string, key: string, x: number, y: number, width: number, h: number, settings: Record<string, unknown> = {}): LayoutWidget => ({ i, key, x, y, w: width, h, settings });

const RIBBON_H = 15;
const STRIP_H = 6;
const CARD_H = 12;

const founder: DashboardLayout = {
  version: LAYOUT_VERSION,
  widgets: [
    w("journey_ribbon-1", "journey_ribbon", 0, 0, 12, RIBBON_H),
    w("status_strip-1", "status_strip", 0, RIBBON_H, 12, STRIP_H),
    ...[0, 1, 2, 3, 4, 5].map((slot) => w(`department_card-${slot + 1}`, "department_card", (slot % 3) * 4, RIBBON_H + STRIP_H + Math.floor(slot / 3) * CARD_H, 4, CARD_H, { slot })),
    w("squad_pulse-1", "squad_pulse", 0, RIBBON_H + STRIP_H + 2 * CARD_H, 8, 12),
    w("inbox_preview-1", "inbox_preview", 8, RIBBON_H + STRIP_H + 2 * CARD_H, 4, 12, { rows: 4 }),
  ],
};

const AGENT_H = 14;
const FEED_H = 14;
const MONEY_H = 16;

const builder: DashboardLayout = {
  version: LAYOUT_VERSION,
  widgets: [
    w("status_strip-1", "status_strip", 0, 0, 12, STRIP_H),
    w("roadmap_timeline-1", "roadmap_timeline", 0, STRIP_H, 8, FEED_H),
    w("live_feed-1", "live_feed", 8, STRIP_H, 4, FEED_H),
    w("department_card-1", "department_card", 0, STRIP_H + FEED_H, 4, CARD_H, { module: "development" }),
    w("department_card-2", "department_card", 4, STRIP_H + FEED_H, 4, CARD_H, { module: "product" }),
    w("agent_of_the_week-1", "agent_of_the_week", 8, STRIP_H + FEED_H, 4, AGENT_H),
    w("inbox_preview-1", "inbox_preview", 0, STRIP_H + FEED_H + AGENT_H, 12, 12, { rows: 4 }),
  ],
};

const seller: DashboardLayout = {
  version: LAYOUT_VERSION,
  widgets: [
    w("status_strip-1", "status_strip", 0, 0, 12, STRIP_H),
    w("funnel-1", "funnel", 0, STRIP_H, 6, 12),
    w("channel_form_guide-1", "channel_form_guide", 6, STRIP_H, 6, 12),
    w("revenue_customers-1", "revenue_customers", 0, STRIP_H + 12, 8, MONEY_H),
    w("inbox_preview-1", "inbox_preview", 8, STRIP_H + 12, 4, MONEY_H, { rows: 4, requiredOnly: false }),
    w("department_card-1", "department_card", 0, STRIP_H + 12 + MONEY_H, 4, CARD_H, { module: "distribution" }),
    w("live_feed-1", "live_feed", 4, STRIP_H + 12 + MONEY_H, 8, FEED_H),
  ],
};

const investor: DashboardLayout = {
  version: LAYOUT_VERSION,
  widgets: [
    w("journey_ribbon-1", "journey_ribbon", 0, 0, 12, RIBBON_H, { zoom: "all", horizonMonths: 12 }),
    w("cash_runway-1", "cash_runway", 0, RIBBON_H, 6, MONEY_H),
    w("revenue_customers-1", "revenue_customers", 6, RIBBON_H, 6, MONEY_H),
    // Milestones in two rows of four, Agent of the week and two catalog metrics side by side, one row high.
    w("trophy_cabinet-1", "trophy_cabinet", 0, RIBBON_H + MONEY_H, 6, MONEY_H, { columns: 4 }),
    w("agent_of_the_week-1", "agent_of_the_week", 6, RIBBON_H + MONEY_H, 3, MONEY_H),
    w("custom_metric-1", "custom_metric", 9, RIBBON_H + MONEY_H, 3, MONEY_H / 2, { mode: "query", queryId: "revenue_30d", label: "Revenue, last 30 days", format: "money" }),
    w("custom_metric-2", "custom_metric", 9, RIBBON_H + MONEY_H + MONEY_H / 2, 3, MONEY_H / 2, { mode: "query", queryId: "customers_30d", label: "Customers won, last 30 days", format: "integer" }),
  ],
};

export const DASHBOARD_PRESETS: Record<DashboardPresetId, DashboardPreset> = {
  founder: { id: "founder", name: "Founder's view", description: "The default: Journey Ribbon, status strip, department cards, team pulse and inbox.", layout: founder },
  builder: { id: "builder", name: "Builder", description: "Roadmap, live feed, Development and Product up close.", layout: builder },
  seller: { id: "seller", name: "Seller", description: "Funnel, channel performance, revenue and customers.", layout: seller },
  investor: { id: "investor", name: "Investor update", description: "The story so far: ribbon, cash and runway, revenue, milestones.", layout: investor },
};

export const DASHBOARD_PRESET_LIST: DashboardPreset[] = DASHBOARD_PRESET_IDS.map((id) => DASHBOARD_PRESETS[id]);

export const DEFAULT_DASHBOARD_PRESET: DashboardPresetId = "founder";

/** A fresh copy of a preset layout (safe to mutate). */
export function presetLayout(id: DashboardPresetId = DEFAULT_DASHBOARD_PRESET): DashboardLayout {
  const p = DASHBOARD_PRESETS[id];
  return { version: LAYOUT_VERSION, widgets: p.layout.widgets.map((x) => ({ ...x, settings: { ...x.settings } })) };
}

export const isDashboardPresetId = (v: unknown): v is DashboardPresetId => typeof v === "string" && (DASHBOARD_PRESET_IDS as readonly string[]).includes(v);
