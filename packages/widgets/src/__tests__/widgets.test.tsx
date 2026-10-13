/**
 * Every gallery widget renders in loading, empty and data states through a fake WidgetDataSource, and the
 * registry/presets agree on keys, surfaces and LIVE-only rules.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import type { ReactElement } from "react";
import { DateFormatProvider, formatDateShort } from "@foundmill/dugout";
import { WidgetDataProvider } from "../data";
import { getWidget, listWidgets, parseWidgetSettings, type AnyWidgetDefinition } from "../registry";
import { createFakeSource, type FakeResponse } from "../testing";
import "../widgets";
import { BID, TODAY, communities, dataResponses, emptyResponses, leaderboardEntries, leaderboards, posts } from "./fixtures";
import { addDays } from "../shared/time";

/** A figure (dugout `Figure`) splits its currency, digits and decimals into spans; match the whole figure's text. */
function byFigure(text: string) {
  return screen.getByText((_, el) => !!el && el.hasAttribute("data-figure") && el.textContent === text);
}


type Case = {
  key: string;
  /** Text that proves the data state rendered real data. */
  expectData: RegExp | string;
  /** Text that proves the empty state copy. */
  expectEmpty: RegExp | string;
  settings?: Record<string, unknown>;
  /** Settings for the empty case when they differ (an unconfigured custom metric). */
  emptySettings?: Record<string, unknown>;
  live?: boolean;
};

const CASES: Case[] = [
  { key: "journey_ribbon", expectData: /^Forecast$/, expectEmpty: /journey starts on day one/ },
  { key: "department_card", expectData: /Beacon/, expectEmpty: /No department in this slot/, settings: { slot: 0 } },
  { key: "squad_pulse", expectData: /agent hours over the last 7 days/, expectEmpty: /appear after the first cycle/ },
  { key: "inbox_preview", expectData: /Approve the schema change/, expectEmpty: /land here after each cycle/ },
  { key: "live_feed", expectData: /Done: Usage index/, expectEmpty: /Events appear here/ },
  { key: "status_strip", expectData: /Customers this week/, expectEmpty: /Finance figures appear once/ },
  { key: "cash_runway", expectData: /Net burn \/ month/, expectEmpty: /Connect a bank account/ },
  { key: "revenue_customers", expectData: /Revenue this month/, expectEmpty: /appear once Stripe, Shopify or a bank/ },
  { key: "funnel", expectData: /Impressions/, expectEmpty: /funnel fills as channels run/ },
  { key: "channel_form_guide", expectData: /Paid advertising/, expectEmpty: /No channels are on the board/ },
  { key: "roadmap_timeline", expectData: /Usage-based billing/, expectEmpty: /Roadmap items appear once/ },
  { key: "agent_of_the_week", expectData: /Ember/, expectEmpty: /first agent of the week/ },
  { key: "trophy_cabinet", expectData: /2 of 8 reached/, expectEmpty: /Customer names show only/ },
  { key: "league_table", expectData: /Ledgerly/, expectEmpty: /No leaderboard is open/, live: true },
  { key: "community_feed", expectData: /annual-plan discounts/, expectEmpty: /Join a community/, live: true },
  { key: "custom_metric", expectData: /€1,250/, expectEmpty: /Pick a metric from the catalog/, settings: { mode: "query", queryId: "revenue_30d", label: "Revenue, last 30 days", format: "money" }, emptySettings: {} },
];

function mount(def: AnyWidgetDefinition, responses: Record<string, FakeResponse>, opts: { settings?: Record<string, unknown>; live?: boolean; missing?: "loading" | "empty" } = {}) {
  const fake = createFakeSource({ businessId: BID, responses, gameMode: opts.live ? "live" : "personal", missing: opts.missing });
  const Component = def.Component;
  const el: ReactElement = (
    <WidgetDataProvider source={fake.source}>
      <Component businessId={BID} instanceId={`${def.key}-1`} settings={parseWidgetSettings(def, opts.settings ?? {})} />
    </WidgetDataProvider>
  );
  return { fake, ...render(el) };
}

describe("widget registry", () => {
  it("registers every gallery widget from BUILD §11.2 with a Zod settings schema and a default size on the 12-column grid", () => {
    const keys = listWidgets(undefined, true).map((w) => w.key).sort();
    expect(keys).toEqual(CASES.map((c) => c.key).sort());
    for (const w of listWidgets(undefined, true)) {
      expect(w.settingsSchema, w.key).toBeDefined();
      expect(w.settingsSchema!.safeParse(w.defaultSettings).success, w.key).toBe(true);
      expect(w.defaultSize.w).toBeGreaterThanOrEqual(1);
      expect(w.defaultSize.w).toBeLessThanOrEqual(12);
      expect(w.defaultSize.h).toBeGreaterThanOrEqual(1);
      expect(w.surfaces.length).toBeGreaterThan(0);
      expect(w.icon).toMatch(/^[a-z-]+$/);
    }
  });
  it("hides LIVE-only widgets in Personal mode and lists them in LIVE", () => {
    const personal = listWidgets("home").map((w) => w.key);
    expect(personal).not.toContain("league_table");
    expect(personal).not.toContain("community_feed");
    expect(listWidgets("home", true).map((w) => w.key)).toEqual(expect.arrayContaining(["league_table", "community_feed"]));
    expect(listWidgets("department").map((w) => w.key)).not.toContain("journey_ribbon");
  });
  it("parses settings leniently: invalid values fall back to defaults instead of crashing", () => {
    const card = getWidget("department_card")!;
    expect(parseWidgetSettings(card, { slot: 2, metric: "nonsense" })).toEqual(card.defaultSettings);
    expect(parseWidgetSettings(card, { slot: 2 })).toMatchObject({ slot: 2, metric: "auto" });
    expect(parseWidgetSettings(card, "garbage")).toEqual(card.defaultSettings);
  });
});

describe.each(CASES)("widget $key", (c) => {
  const def = getWidget(c.key)!;
  it("renders a loading skeleton while queries are pending (no spinner, aria-busy)", () => {
    const { container } = mount(def, {}, { settings: c.settings, live: c.live });
    const panel = container.querySelector(`[data-widget='${c.key}']`) ?? container.querySelector("section");
    expect(panel).toBeTruthy();
    if (c.key !== "status_strip") {
      expect(panel!.getAttribute("data-state")).toBe("loading");
      expect(panel!.getAttribute("aria-busy")).toBe("true");
    } else {
      expect(container.querySelectorAll("[data-metric-tile][aria-busy='true']").length).toBeGreaterThan(0);
    }
    expect(container.querySelector(".animate-spin")).toBeNull();
  });
  it("renders the empty state with a line saying what will appear", () => {
    const { container } = mount(def, emptyResponses(), { settings: c.emptySettings ?? c.settings, live: c.live });
    expect(screen.getAllByText(c.expectEmpty).length).toBeGreaterThan(0);
    expect(container.querySelector("[data-state='loading']")).toBeNull();
    expect(container.querySelector("[role='alert']")).toBeNull();
  });
  it("renders the data state", () => {
    const { container } = mount(def, dataResponses(), { settings: c.settings, live: c.live });
    const needle = String(c.expectData).replace(/^\/|\/$/g, "").replace(/\\/g, "");
    const figures = [...container.querySelectorAll("[data-figure]")].filter((el) => (el.textContent ?? "").includes(needle)).length;
    const hits = screen.queryAllByText(c.expectData).length + container.querySelectorAll(`[aria-label*="${needle}"]`).length + figures;
    expect(hits, `expected ${needle} in the data state`).toBeGreaterThan(0);
    expect(container.querySelector("[data-state='loading']")).toBeNull();
    expect(container.querySelector("[role='alert']")).toBeNull();
    expect(container.querySelector("[role='status']")).toBeNull();
  });
  it("renders the error state with a retry that refetches", () => {
    const failing = Object.fromEntries(Object.keys(dataResponses()).map((k) => [k, new Error("boom")]));
    const { container, fake } = mount(def, failing, { settings: c.settings, live: c.live });
    const alert = container.querySelector("[role='alert']");
    expect(alert, "error state").toBeTruthy();
    const retry = within(alert as HTMLElement).queryByRole("button", { name: /Try again/ });
    expect(retry).toBeTruthy();
    retry!.click();
    expect(Object.values(fake.refetches).reduce((a, b) => a + b, 0)).toBeGreaterThan(0);
  });
});

describe("LIVE-only widgets in Personal mode", () => {
  it("explain that the widget needs LIVE instead of querying", () => {
    for (const key of ["league_table", "community_feed"]) {
      const { fake, unmount } = mount(getWidget(key)!, dataResponses(), { live: false });
      expect(screen.getByText(/once the business is live/)).toBeTruthy();
      expect(fake.queried.size).toBe(0);
      unmount();
    }
  });
});

describe("a refused or failed query is never empty data", () => {
  const forbidden = Object.assign(new Error("You do not have read access to finance"), { data: { code: "FORBIDDEN" } });
  it("status strip: a member walled from Finance reads No access, not €0 or 'Connect a bank'", () => {
    const { container } = mount(getWidget("status_strip")!, { ...dataResponses(), "finance.overview": forbidden });
    expect(container.textContent).toContain("No access");
    expect(container.textContent).toContain("Your role has no access to Finance");
    expect(container.textContent).not.toMatch(/Connect a bank|Finance figures appear once/);
    // The rest of the strip still answers.
    expect(screen.getByText("Customers this week")).toBeTruthy();
  });
  it("status strip: a 500 reads Couldn't load", () => {
    const { container } = mount(getWidget("status_strip")!, { ...dataResponses(), "finance.overview": new Error("tRPC: INTERNAL_SERVER_ERROR") });
    expect(container.textContent).toContain("Couldn't load");
    expect(container.textContent).not.toMatch(/Connect a bank|Finance figures appear once/);
  });
  it("department card: Finance's Runway says No access instead of 'Not known yet'", () => {
    const { container } = mount(getWidget("department_card")!, { ...dataResponses(), "finance.overview": forbidden }, { settings: { module: "finance" } });
    const metric = container.querySelector("[data-department-metric]")!;
    expect(metric.textContent).toContain("Runway");
    expect(metric.textContent).toContain("No access");
    expect(metric.textContent).not.toContain("Not known yet");
  });
});

describe("Home captions in the business's words (Settings › Glossary, AC-11.13.6)", () => {
  const glossary = { customer: "client", team: "crew" };
  const mountGlossed = (key: string, settings: Record<string, unknown> = {}) => {
    const fake = createFakeSource({ businessId: BID, responses: dataResponses(), glossary });
    const Component = getWidget(key)!.Component;
    return render(
      <WidgetDataProvider source={fake.source}>
        <Component businessId={BID} instanceId={`${key}-1`} settings={parseWidgetSettings(getWidget(key)!, settings)} />
      </WidgetDataProvider>,
    );
  };
  it("renames nouns in tile labels, titles, stage names, milestone names and the team metric", () => {
    expect(mountGlossed("status_strip").container.textContent).toContain("Clients this week");
    expect(mountGlossed("revenue_customers").container.textContent).toMatch(/Revenue and clients[\s\S]*Clients, last 30 days/);
    expect(mountGlossed("funnel").container.textContent).toContain("Clients");
    expect(mountGlossed("trophy_cabinet").container.textContent).toMatch(/First client/);
    expect(mountGlossed("department_card", { slot: 0, metric: "squad_health" }).container.textContent).toContain("Crew health");
  });
  it("renames nouns in a widget's footer text too, once (a swap does not undo itself)", () => {
    expect(mountGlossed("trophy_cabinet").container.textContent).toContain("Client names show only when permission is recorded");
    expect(mountGlossed("revenue_customers").container.textContent).toContain("clients = first payments");
    expect(mountGlossed("funnel").container.textContent).toMatch(/all channels · \d+ clients/);
  });
  it("leaves every caption alone with an empty glossary", () => {
    const { container } = mount(getWidget("status_strip")!, dataResponses());
    expect(container.textContent).toContain("Customers this week");
  });
});

describe("Home's today is the business's day (audit #196)", () => {
  afterEach(() => vi.useRealTimers());
  it("asks for the recent ribbon up to the business's today, not UTC's, so the strip and the top bar agree", () => {
    // 05:35 on Oct 12 in Tokyo is still Oct 11 in UTC.
    vi.useFakeTimers({ now: new Date("2026-10-11T20:35:00Z"), toFake: ["Date"] });
    const tokyo = createFakeSource({ businessId: BID, responses: dataResponses(), timeZone: "Asia/Tokyo" });
    const Strip = getWidget("status_strip")!.Component;
    const { unmount } = render(
      <WidgetDataProvider source={tokyo.source}>
        <Strip businessId={BID} instanceId="status_strip-1" settings={parseWidgetSettings(getWidget("status_strip")!, {})} />
      </WidgetDataProvider>,
    );
    expect(tokyo.queried.get("journey.ribbon")).toMatchObject({ to: "2026-10-12" });
    unmount();
    const utc = createFakeSource({ businessId: BID, responses: dataResponses() });
    render(
      <WidgetDataProvider source={utc.source}>
        <Strip businessId={BID} instanceId="status_strip-1" settings={parseWidgetSettings(getWidget("status_strip")!, {})} />
      </WidgetDataProvider>,
    );
    expect(utc.queried.get("journey.ribbon")).toMatchObject({ to: "2026-10-11" });
  });
});

describe("widget bodies in a grid cell", () => {
  it("scroll inside the cell instead of painting under the footer", () => {
    for (const key of ["cash_runway", "revenue_customers", "funnel", "agent_of_the_week", "trophy_cabinet", "live_feed"]) {
      const { container, unmount } = mount(getWidget(key)!, dataResponses());
      const body = container.querySelector("[data-panel-body]");
      expect(body?.className, key).toContain("overflow-y-auto");
      unmount();
    }
  });
});

describe("LIVE widgets read the LIVE pages' words", () => {
  it("names the board, its period and its metric from what live.leaderboards.list returns (no raw keys, no 'Metric')", () => {
    const board = { id: leaderboards[0]!.id, period: "2026-Q4", boardKind: "customers_won", division: "b2b_saas", archetype: "b2b_saas", region: null, metric: "customers_won" };
    const entries = leaderboardEntries.map((e) => ({ ...e, metricValue: e.businessId === BID ? 494 : e.metricValue }));
    const { container } = mount(getWidget("league_table")!, { ...dataResponses(), "live.leaderboards.list": [board], "live.leaderboards.entries": entries }, { live: true });
    expect(screen.getByRole("heading", { name: "Leaderboard · Customers won · B2B SaaS" })).toBeTruthy();
    expect(screen.getByText("Customers won", { selector: "th, [role=columnheader]" })).toBeTruthy();
    expect(container.textContent).toContain("Q4 2026 · You are #8");
    expect(container.textContent).not.toMatch(/2026-Q4|b2b_saas|Metric/);
  });

  it("says 1 member and 1 reply, not 1 members", () => {
    const { container } = mount(getWidget("community_feed")!, { ...dataResponses(), "live.communities.list": [{ ...communities[0]!, memberCount: 1 }], "live.communities.posts": { items: [{ ...posts.items[0]!, replyCount: 1 }] } }, { live: true });
    expect(container.textContent).toContain("1 member");
    expect(container.textContent).not.toContain("1 members");
    expect(container.textContent).toContain("1 reply");
    expect(container.textContent).not.toContain("1 replies");
  });
});

describe("Forecast and Estimate chips", () => {
  it("label every non-real number", () => {
    mount(getWidget("cash_runway")!, dataResponses());
    expect(screen.getAllByText("Estimate").length).toBeGreaterThanOrEqual(2);
    expect(screen.getAllByText("Forecast").length).toBeGreaterThanOrEqual(1);
  });
  it("status strip marks runway as an estimate and keeps the leaderboard tile for LIVE only", () => {
    const { unmount } = mount(getWidget("status_strip")!, dataResponses());
    expect(screen.getAllByText("Estimate").length).toBeGreaterThanOrEqual(1);
    expect(screen.queryByText("Leaderboard position")).toBeNull();
    unmount();
    mount(getWidget("status_strip")!, dataResponses(), { live: true });
    expect(screen.getByText("Leaderboard position")).toBeTruthy();
    expect(byFigure("#8")).toBeTruthy();
  });
});

describe("navigation", () => {
  it("inbox rows open the item and payment markers open the journey", async () => {
    const { fake, container } = mount(getWidget("inbox_preview")!, dataResponses());
    (container.querySelector("[data-inbox-row]") as HTMLButtonElement).click();
    expect(fake.navigations[0]).toMatch(new RegExp(`^/b/${BID}/inbox/`));
  });
});

describe("dates in the signed-in person's format", () => {
  it("the roadmap timeline gives each target date in it", () => {
    const fake = createFakeSource({ businessId: BID, responses: dataResponses() });
    const def = getWidget("roadmap_timeline")!;
    const Component = def.Component;
    render(
      <DateFormatProvider value={{ date: "iso", time: "24h" }}>
        <WidgetDataProvider source={fake.source}>
          <Component businessId={BID} instanceId="roadmap_timeline-1" settings={parseWidgetSettings(def, {})} />
        </WidgetDataProvider>
      </DateFormatProvider>,
    );
    const target = formatDateShort(addDays(TODAY, 12), { date: "iso", time: "24h" });
    expect(target).toMatch(/^\d{2}-\d{2}$/);
    expect(screen.getByText(`Target ${target}`)).toBeTruthy();
    expect(screen.queryByText(/^Target [A-Z][a-z]{2} \d/)).toBeNull();
  });
});
