/**
 * Dashboard presets (BUILD §11.2 "presets: Founder's view default, Builder, Seller, Investor update"): the one table
 * both the api (every stored layout: the first Home at commit, New › <preset>, a preset choice and Reset) and
 * @foundmill/widgets (the Edit › Presets previews) build from, so what a preset promises is what it stores.
 *
 * Widgets are referenced by registry key on the 12-column grid of 8 px rows (Dugout's WidgetGrid; DECISIONS "Heights
 * are honest WidgetGrid rows"): the Ribbon's 300 px plus its panel header is 15 rows, department cards 12, the status
 * strip 6. Settings are the widget's own (parsed against its schema by the widgets package).
 */

export const DASHBOARD_PRESET_IDS = ["founder", "builder", "seller", "investor"] as const;
export type DashboardPresetId = (typeof DASHBOARD_PRESET_IDS)[number];

export const DEFAULT_DASHBOARD_PRESET: DashboardPresetId = "founder";

/** One widget of a preset: version-less, without an instance id (the widgets package derives `<key>-<n>`). */
export interface PresetWidget {
  key: string;
  x: number;
  y: number;
  w: number;
  h: number;
  settings: Record<string, unknown>;
}

export const DASHBOARD_PRESET_INFO: Record<DashboardPresetId, { name: string; description: string }> = {
  founder: { name: "Founder's view", description: "The default: Journey Ribbon, status strip, a card for every department, team pulse and inbox." },
  builder: { name: "Builder", description: "Roadmap, live feed, Development and Product up close." },
  seller: { name: "Seller", description: "Funnel, channel performance, revenue and customers." },
  investor: { name: "Investor update", description: "The story so far: ribbon, cash and runway, revenue, milestones." },
};

/**
 * Custom metric query ids the widget's settings suggest. Every one is an entry of the api's metric catalog (apps/api
 * services/metrics.ts `METRICS`; a test there holds them to it), like the ids the Investor update preset stores.
 */
export const CUSTOM_METRIC_EXAMPLE_IDS = ["cash", "revenue_30d", "customers_30d"] as const;

export const PRESET_ROWS = { ribbon: 15, strip: 6, card: 12 } as const;
/**
 * Every other widget is at least its registry default height (sized to its content), so no preset draws a footer over
 * a widget's content: the agent card, the feeds, and the money widgets (cash, revenue, milestones).
 */
const AGENT_ROWS = 14;
const FEED_ROWS = 14;
const MONEY_ROWS = 16;

/** Department cards on the Founder's view when the number of departments is not known (a preview without a business). */
export const DEFAULT_DEPARTMENT_CARDS = 6;
/** Department cards per row on the Founder's view (three cards of four columns). */
const CARDS_PER_ROW = 3;

export interface PresetOptions {
  /**
   * The business's visible departments (Founder's view only): one department card per department, three to a row, so
   * a business with seven departments gets seven cards. Defaults to six.
   */
  departments?: number;
}

const w = (key: string, x: number, y: number, width: number, h: number, settings: Record<string, unknown> = {}): PresetWidget => ({ key, x, y, w: width, h, settings });

/** The first-week checklist (UX plan §7.8): the header plus seven 34 px rows. */
const CHECKLIST_ROWS = 12;

function founder(departments: number): PresetWidget[] {
  const { ribbon, strip, card } = PRESET_ROWS;
  const cards = Math.max(0, Math.floor(departments));
  const top = ribbon + strip;
  const below = top + Math.ceil(cards / CARDS_PER_ROW) * card;
  return [
    w("journey_ribbon", 0, 0, 12, ribbon),
    w("status_strip", 0, ribbon, 12, strip),
    // Slot N is the Nth visible department by position (packages/widgets resolveDepartment).
    ...Array.from({ length: cards }, (_, slot) => w("department_card", (slot % CARDS_PER_ROW) * 4, top + Math.floor(slot / CARDS_PER_ROW) * card, 4, card, { slot })),
    w("squad_pulse", 0, below, 8, 12),
    w("inbox_preview", 8, below, 4, 12, { rows: 4 }),
    // "Your first week" in the Inbox preview's column, right under it (UX plan §7.8): the widget hides itself once the
    // week's items are done or the founder closes it, and a cell at the foot of the page leaves no hole when it does.
    w("first_week_checklist", 8, below + 12, 4, CHECKLIST_ROWS),
  ];
}

function builder(): PresetWidget[] {
  const { strip, card } = PRESET_ROWS;
  return [
    w("status_strip", 0, 0, 12, strip),
    w("roadmap_timeline", 0, strip, 8, FEED_ROWS),
    w("live_feed", 8, strip, 4, FEED_ROWS),
    w("department_card", 0, strip + FEED_ROWS, 4, card, { module: "development" }),
    w("department_card", 4, strip + FEED_ROWS, 4, card, { module: "product" }),
    w("agent_of_the_week", 8, strip + FEED_ROWS, 4, AGENT_ROWS),
    w("inbox_preview", 0, strip + FEED_ROWS + AGENT_ROWS, 12, 12, { rows: 4 }),
  ];
}

function seller(): PresetWidget[] {
  const { strip, card } = PRESET_ROWS;
  return [
    w("status_strip", 0, 0, 12, strip),
    w("funnel", 0, strip, 6, 12),
    w("channel_form_guide", 6, strip, 6, 12),
    w("revenue_customers", 0, strip + 12, 8, MONEY_ROWS),
    w("inbox_preview", 8, strip + 12, 4, MONEY_ROWS, { rows: 4, requiredOnly: false }),
    w("department_card", 0, strip + 12 + MONEY_ROWS, 4, card, { module: "distribution" }),
    w("live_feed", 4, strip + 12 + MONEY_ROWS, 8, FEED_ROWS),
  ];
}

function investor(): PresetWidget[] {
  const { ribbon } = PRESET_ROWS;
  return [
    w("journey_ribbon", 0, 0, 12, ribbon, { zoom: "all", horizonMonths: 12 }),
    w("cash_runway", 0, ribbon, 6, MONEY_ROWS),
    w("revenue_customers", 6, ribbon, 6, MONEY_ROWS),
    // Milestones in two rows of four, Agent of the week and two catalog metrics side by side, one row high.
    w("trophy_cabinet", 0, ribbon + MONEY_ROWS, 6, MONEY_ROWS, { columns: 4 }),
    w("agent_of_the_week", 6, ribbon + MONEY_ROWS, 3, MONEY_ROWS),
    // Catalog metrics only (apps/api services/metrics.ts METRICS): a query id the api does not know renders an error tile.
    w("custom_metric", 9, ribbon + MONEY_ROWS, 3, MONEY_ROWS / 2, { mode: "query", queryId: "revenue_30d", label: "Revenue, last 30 days", format: "money" }),
    w("custom_metric", 9, ribbon + MONEY_ROWS + MONEY_ROWS / 2, 3, MONEY_ROWS / 2, { mode: "query", queryId: "customers_30d", label: "Customers won, last 30 days", format: "integer" }),
  ];
}

/** A fresh copy of a preset's widgets (safe to mutate). */
export function presetWidgets(id: DashboardPresetId, options: PresetOptions = {}): PresetWidget[] {
  switch (id) {
    case "founder":
      return founder(options.departments ?? DEFAULT_DEPARTMENT_CARDS);
    case "builder":
      return builder();
    case "seller":
      return seller();
    case "investor":
      return investor();
  }
}

export const isDashboardPresetId = (v: unknown): v is DashboardPresetId => typeof v === "string" && (DASHBOARD_PRESET_IDS as readonly string[]).includes(v);
