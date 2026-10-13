import { describe, expect, it } from "vitest";
import "../widgets";
import { appendWidget, fromGridLayout, LAYOUT_VERSION, layoutsEqual, migrateLayout, prepareLayout, pxForRows, rowsForPx, toGridLayout, toScreenLayout, validateLayout, type DashboardLayout } from "../layout";
import { DASHBOARD_PRESET_IDS, DASHBOARD_PRESETS, presetLayout } from "../presets";
import { getWidget } from "../registry";

describe("grid arithmetic", () => {
  it("follows react-grid-layout: rows plus the gutters between them", () => {
    expect(pxForRows(1)).toBe(8);
    expect(pxForRows(2)).toBe(32);
    expect(pxForRows(15)).toBe(344);
    expect(rowsForPx(300 + 32)).toBe(15);
    expect(rowsForPx(1)).toBe(1);
  });
});

describe("presets", () => {
  it.each(DASHBOARD_PRESET_IDS)("%s validates against the registry with nothing dropped or clamped", (id) => {
    const result = validateLayout(DASHBOARD_PRESETS[id].layout, { live: false });
    expect(result.issues).toEqual([]);
    expect(result.ok).toBe(true);
  });
  it.each(DASHBOARD_PRESET_IDS)("%s keeps every widget inside 12 columns with no overlaps", (id) => {
    const { widgets } = DASHBOARD_PRESETS[id].layout;
    for (const w of widgets) expect(w.x + w.w, w.i).toBeLessThanOrEqual(12);
    for (let i = 0; i < widgets.length; i++)
      for (let j = i + 1; j < widgets.length; j++) {
        const a = widgets[i]!;
        const b = widgets[j]!;
        const overlap = a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
        expect(overlap, `${a.i} overlaps ${b.i}`).toBe(false);
      }
    expect(new Set(widgets.map((w) => w.i)).size).toBe(widgets.length);
  });
  it("Founder's view is the BUILD §11.2 default layout", () => {
    const f = presetLayout("founder");
    const keys = f.widgets.map((w) => w.key);
    expect(keys.filter((k) => k === "department_card").length).toBe(6);
    expect(keys).toEqual(expect.arrayContaining(["journey_ribbon", "status_strip", "squad_pulse", "inbox_preview"]));
    const ribbon = f.widgets.find((w) => w.key === "journey_ribbon")!;
    expect(ribbon).toMatchObject({ x: 0, y: 0, w: 12 });
    expect(pxForRows(ribbon.h)).toBeGreaterThanOrEqual(300 + 32);
    expect(f.widgets.find((w) => w.key === "squad_pulse")!.w).toBe(8);
    expect(f.widgets.find((w) => w.key === "inbox_preview")).toMatchObject({ w: 4, settings: { rows: 4 } });
  });
  it.each(DASHBOARD_PRESET_IDS)("%s gives every widget at least its content height, so no footer is drawn over content", (id) => {
    for (const w of DASHBOARD_PRESETS[id].layout.widgets) {
      // The Ribbon's 15 rows are its designed 300 px plus the header (DECISIONS 2026-10-07); every other widget's
      // registry default is sized to its content.
      if (w.key === "journey_ribbon") continue;
      expect(w.h, w.i).toBeGreaterThanOrEqual(getWidget(w.key)!.defaultSize.h);
    }
  });
  it("custom metrics in presets name only queries the API catalog has", () => {
    // apps/api services/metrics.ts METRICS (dashboard.customMetric.list); "mrr" and "active_customers" are not in it.
    const catalog = ["cash", "net_burn", "runway_months", "revenue_30d", "customers_30d", "signups_30d", "activation_rate_30d", "tasks_running", "tasks_done", "agents_active", "spend_30d", "cpa_blended", "channels_enabled"];
    const ids = DASHBOARD_PRESET_IDS.flatMap((id) => DASHBOARD_PRESETS[id].layout.widgets.filter((w) => w.key === "custom_metric").map((w) => w.settings.queryId));
    expect(ids.length).toBeGreaterThan(0);
    for (const q of ids) expect(catalog).toContain(q);
  });
  it.each([1, 3, 7, 8, 10])("Founder's view with %i departments has a card for each, in order, with nothing on top of anything", (n) => {
    const f = presetLayout("founder", { departments: n });
    expect(validateLayout(f, { live: false }).ok).toBe(true);
    const cards = f.widgets.filter((w) => w.key === "department_card");
    expect(cards.map((c) => c.settings.slot)).toEqual(Array.from({ length: n }, (_, i) => i));
    const below = Math.max(...cards.map((c) => c.y + c.h));
    expect(f.widgets.find((w) => w.key === "squad_pulse")!.y).toBeGreaterThanOrEqual(below);
    for (const [i, a] of f.widgets.entries())
      for (const b of f.widgets.slice(i + 1)) expect(a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h, `${a.i} overlaps ${b.i}`).toBe(false);
  });
  it("the Investor update's metric widgets name catalogue ids (the api's METRICS), not made-up ones", () => {
    const ids = presetLayout("investor").widgets.filter((w) => w.key === "custom_metric").map((w) => w.settings.queryId);
    expect(ids).toEqual(["revenue_30d", "customers_30d"]);
  });
  it("presetLayout returns a fresh copy", () => {
    const a = presetLayout("builder");
    a.widgets[0]!.x = 99;
    expect(presetLayout("builder").widgets[0]!.x).toBe(0);
  });
});

describe("migrateLayout", () => {
  it("passes a current layout through unchanged", () => {
    const l = presetLayout("seller");
    expect(migrateLayout(l)).toEqual({ layout: l, migrated: false, issues: [] });
  });
  it("upgrades the version-less screen layout with deterministic instance ids", () => {
    const stored = { widgets: [{ key: "journey_ribbon", x: 0, y: 0, w: 12, h: 38, settings: {} }, { key: "department_card", x: 0, y: 38, w: 4, h: 30, settings: { slot: 0 } }, { key: "department_card", x: 4, y: 38, w: 4, h: 30, settings: { slot: 1 } }] };
    const { layout, migrated, issues } = migrateLayout(stored);
    expect(migrated).toBe(true);
    expect(issues[0]?.code).toBe("migrated");
    expect(layout.version).toBe(LAYOUT_VERSION);
    expect(layout.widgets.map((w) => w.i)).toEqual(["journey_ribbon-1", "department_card-1", "department_card-2"]);
    expect(migrateLayout(stored).layout).toEqual(layout);
  });
  it("turns garbage into an empty layout rather than throwing", () => {
    expect(migrateLayout(null).layout.widgets).toEqual([]);
    expect(migrateLayout({ widgets: "nope" }).layout.widgets).toEqual([]);
  });
});

describe("validateLayout", () => {
  const base = (): DashboardLayout => ({ version: LAYOUT_VERSION, widgets: [{ i: "a", key: "journey_ribbon", x: 0, y: 0, w: 12, h: 15, settings: {} }] });
  it("drops unknown widgets and LIVE-only widgets in Personal mode", () => {
    const l = base();
    l.widgets.push({ i: "b", key: "not_a_widget", x: 0, y: 15, w: 4, h: 4, settings: {} }, { i: "c", key: "league_table", x: 4, y: 15, w: 4, h: 12, settings: {} });
    const r = validateLayout(l, { live: false });
    expect(r.ok).toBe(false);
    expect(r.layout.widgets.map((w) => w.i)).toEqual(["a"]);
    expect(r.issues.map((i) => i.code)).toEqual(["unknown_widget", "live_only"]);
    expect(validateLayout(l, { live: true }).layout.widgets.map((w) => w.i)).toEqual(["a", "c"]);
  });
  it("clamps sizes to the widget's min/max and keeps widgets inside the grid", () => {
    const l = base();
    l.widgets[0] = { ...l.widgets[0]!, w: 20, h: 60, x: 5 };
    l.widgets.push({ i: "d", key: "custom_metric", x: 11, y: 20, w: 1, h: 1, settings: {} });
    const r = validateLayout(l);
    expect(r.layout.widgets[0]).toMatchObject({ x: 0, w: 12, h: 24 });
    expect(r.layout.widgets[1]).toMatchObject({ x: 10, w: 2, h: 5 });
    expect(r.issues.map((i) => i.code)).toEqual(expect.arrayContaining(["clamped", "out_of_bounds"]));
  });
  it("keeps one instance of single widgets, renames duplicate ids and resets invalid settings", () => {
    const l = base();
    l.widgets.push({ i: "a", key: "journey_ribbon", x: 0, y: 15, w: 12, h: 15, settings: {} }, { i: "a", key: "funnel", x: 0, y: 30, w: 6, h: 10, settings: { channelKey: "not-a-channel" } });
    const r = validateLayout(l);
    expect(r.layout.widgets.map((w) => w.i)).toEqual(["a", "a-2"]);
    expect(r.layout.widgets[1]!.settings).toEqual(getWidget("funnel")!.defaultSettings);
    expect(r.issues.map((i) => i.code)).toEqual(["duplicate_single", "duplicate_id", "settings_reset"]);
  });
  it("fills in default settings so widgets always receive a full settings object", () => {
    const r = validateLayout({ version: LAYOUT_VERSION, widgets: [{ i: "x", key: "inbox_preview", x: 0, y: 0, w: 4, h: 12, settings: { rows: 6 } }] });
    expect(r.layout.widgets[0]!.settings).toEqual({ rows: 6, requiredOnly: false });
  });
});

describe("conversions", () => {
  it("round-trips through the Dugout WidgetGrid shape with min/max from the registry", () => {
    const l = presetLayout("investor");
    const grid = toGridLayout(l);
    expect(grid[0]).toMatchObject({ i: "journey_ribbon-1", widget: "journey_ribbon", minW: 6, minH: 12, maxH: 24 });
    expect(layoutsEqual(fromGridLayout(grid), l)).toBe(true);
    const moved = grid.map((g) => (g.i === "cash_runway-1" ? { ...g, x: 6, y: 40 } : g));
    expect(layoutsEqual(fromGridLayout(moved), l)).toBe(false);
  });
  it("produces the apps/api ScreenLayout body and comes back through prepareLayout", () => {
    const l = presetLayout("founder");
    const body = toScreenLayout(l);
    expect(body.widgets[0]).toEqual({ key: "journey_ribbon", x: 0, y: 0, w: 12, h: 15, settings: expect.any(Object), i: "journey_ribbon-1" });
    const stripped = { widgets: body.widgets.map(({ i: _i, ...rest }) => rest) };
    const back = prepareLayout(stripped);
    expect(back.migrated).toBe(true);
    expect(layoutsEqual(back.layout, validateLayout(l).layout)).toBe(true);
  });
  it("appends a widget below everything with its default size and parsed settings", () => {
    const l = presetLayout("seller");
    const next = appendWidget(l, getWidget("custom_metric")!, { mode: "query", queryId: "mrr" });
    const added = next.widgets.at(-1)!;
    expect(added).toMatchObject({ i: "custom_metric-1", key: "custom_metric", x: 0, w: 3, h: 6 });
    expect(added.y).toBe(Math.max(...l.widgets.map((w) => w.y + w.h)));
    expect(added.settings).toMatchObject({ mode: "query", queryId: "mrr", label: null });
    expect(appendWidget(next, getWidget("custom_metric")!).widgets.at(-1)!.i).toBe("custom_metric-2");
  });
});
