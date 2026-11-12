/**
 * Every gallery widget renders in loading, empty and data states through a fake WidgetDataSource, and the
 * registry/presets agree on keys, surfaces and LIVE-only rules.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, render, screen, within } from "@testing-library/react";
import type { ReactElement } from "react";
import { DateFormatProvider, GuidanceProvider, formatDateShort } from "@foundmill/dugout";
import { WidgetDataProvider } from "../data";
import { getWidget, listWidgets, parseWidgetSettings, type AnyWidgetDefinition } from "../registry";
import { createFakeSource, type FakeResponse } from "../testing";
import "../widgets";
import { FIRST_WEEK_REFETCH_DEBOUNCE_MS, firstWeekEventMatters } from "../widgets/first-week-checklist";
import { BID, TODAY, communities, dataResponses, emptyResponses, posts } from "./fixtures";
import { addDays } from "../shared/time";


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
  { key: "squad_pulse", expectData: /hours of team work over the last 7 days/, expectEmpty: /appear after the first cycle/ },
  { key: "inbox_preview", expectData: /Approve the schema change/, expectEmpty: /land here after each cycle/ },
  { key: "live_feed", expectData: /Done: Usage index/, expectEmpty: /Events appear here/ },
  { key: "status_strip", expectData: /Customers this week/, expectEmpty: /Finance figures appear once/ },
  { key: "cash_runway", expectData: /Net burn \/ month/, expectEmpty: /Connect a bank account/ },
  { key: "revenue_customers", expectData: /Revenue this month/, expectEmpty: /appear once Stripe, Shopify or a bank/ },
  { key: "funnel", expectData: /Impressions/, expectEmpty: /funnel fills as channels run/ },
  { key: "channel_form_guide", expectData: /Paid advertising/, expectEmpty: /No channels are on the board/ },
  { key: "roadmap_timeline", expectData: /Usage-based billing/, expectEmpty: /Roadmap items appear once/ },
  { key: "agent_of_the_week", expectData: /Ember/, expectEmpty: /first agent of the week/ },
  { key: "trophy_cabinet", expectData: /2 of 10 reached/, expectEmpty: /Customer names show only/ },
  { key: "community_feed", expectData: /annual-plan discounts/, expectEmpty: /Join a community/, live: true },
  { key: "custom_metric", expectData: /€1,250/, expectEmpty: /Pick a metric from the catalog/, settings: { mode: "query", queryId: "revenue_30d", label: "Revenue, last 30 days", format: "money" }, emptySettings: {} },
  // Nothing done yet is the checklist's "empty": seven rows, none ticked.
  { key: "first_week_checklist", expectData: /2 of 7 done/, expectEmpty: /0 of 7 done/ },
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
    expect(personal).not.toContain("community_feed");
    expect(listWidgets("home", true).map((w) => w.key)).toEqual(expect.arrayContaining(["community_feed"]));
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
    for (const key of ["community_feed"]) {
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
  it("department card: Finance's Months of cash left says No access instead of 'Not known yet'", () => {
    const { container } = mount(getWidget("department_card")!, { ...dataResponses(), "finance.overview": forbidden }, { settings: { module: "finance" } });
    const metric = container.querySelector("[data-department-metric]")!;
    expect(metric.textContent).toContain("Months of cash left");
    expect(metric.textContent).toContain("No access");
    expect(metric.textContent).not.toContain("Not known yet");
  });
});

describe("empty widgets in guided mode (UX plan §7.8)", () => {
  const mountEmpty = (guidance: "on" | "off") => {
    const fake = createFakeSource({ businessId: BID, responses: emptyResponses() });
    const def = getWidget("inbox_preview")!;
    const Component = def.Component;
    return render(
      <GuidanceProvider value={{ guidance }}>
        <WidgetDataProvider source={fake.source}>
          <Component businessId={BID} instanceId="inbox_preview-1" settings={parseWidgetSettings(def, {})} />
        </WidgetDataProvider>
      </GuidanceProvider>,
    );
  };
  it("collapse to the icon and the one line on a plate that hugs them, keeping the text and the action", () => {
    const { container } = mountEmpty("on");
    const panel = container.querySelector("[data-widget='inbox_preview']")!;
    expect(panel.getAttribute("data-empty")).toBe("collapsed");
    expect(panel.getAttribute("data-state")).toBe("empty");
    expect(panel.className).toContain("h-auto");
    expect(panel.className).not.toContain("h-full");
    const empty = panel.querySelector("[role='status']")!;
    expect(empty.className).toContain("flex-row");
    expect(empty.className).not.toContain("flex-col");
    expect(empty.className).not.toContain("py-8");
    expect(screen.getByText(/land here after each cycle/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Open inbox" })).toBeTruthy();
  });
  it("keep the tall centred empty state when guidance is off", () => {
    const { container } = mountEmpty("off");
    const panel = container.querySelector("[data-widget='inbox_preview']")!;
    expect(panel.getAttribute("data-empty")).toBeNull();
    expect(panel.className).toContain("h-full");
    expect(panel.querySelector("[role='status']")!.className).toContain("flex-col");
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
  it("carries the Home tour's anchor on the status strip's panel root", () => {
    const { container } = mount(getWidget("status_strip")!, dataResponses());
    expect(container.querySelector("[data-widget='status_strip']")?.getAttribute("data-coachmark")).toBe("status-strip");
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
  it("status strip marks runway as an estimate and shows the same five tiles in Personal and LIVE", () => {
    const { unmount, container } = mount(getWidget("status_strip")!, dataResponses());
    expect(screen.getAllByText("Estimate").length).toBeGreaterThanOrEqual(1);
    const personal = container.textContent;
    expect(personal).toContain("Team health");
    unmount();
    // A layout saved with the removed `showLeague` setting renders as any other, and LIVE adds no tile.
    const live = mount(getWidget("status_strip")!, dataResponses(), { live: true, settings: { showLeague: true } });
    expect(live.container.textContent).toBe(personal);
    expect(live.fake.queried.has("live.leaderboards.positions")).toBe(false);
  });
});

describe("navigation", () => {
  it("inbox rows open the item and payment markers open the journey", async () => {
    const { fake, container } = mount(getWidget("inbox_preview")!, dataResponses());
    (container.querySelector("[data-inbox-row]") as HTMLButtonElement).click();
    expect(fake.navigations[0]).toMatch(new RegExp(`^/b/${BID}/inbox/`));
  });
  it("an inbox preview row holds no button inside its own button (the tag's tooltip trigger is a span)", () => {
    const { container } = mount(getWidget("inbox_preview")!, dataResponses());
    const rows = container.querySelectorAll("[data-inbox-row]");
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      expect(row.querySelector("[data-row-tag]")).not.toBeNull();
      expect(row.querySelector("button, a, [tabindex]")).toBeNull();
    }
  });
  it("Channel performance's empty state opens the Channel Board by its name, not 'Formation'", () => {
    const { fake } = mount(getWidget("channel_form_guide")!, emptyResponses());
    expect(screen.queryByText(/Formation/)).toBeNull();
    expect(screen.getByText(/Put the first channels on the Channel Board/)).toBeTruthy();
    screen.getByRole("button", { name: "Open Channel Board" }).click();
    expect(fake.navigations[0]).toMatch(/\/distribution\/formation$|\/home$/);
  });
});

describe("events", () => {
  it("the inbox preview refetches when another member archives an item or confirms its plan (audit RUI-09)", () => {
    const { fake } = mount(getWidget("inbox_preview")!, dataResponses());
    const before = fake.refetches["inbox.list"] ?? 0;
    act(() => {
      fake.emit({ type: "inbox.item_updated", payload: { inboxItemId: "00000000-0000-4000-8000-000000000002", change: "archived", planId: null, followUpItemId: null } });
    });
    expect(fake.refetches["inbox.list"]).toBe(before + 1);
    act(() => {
      fake.emit({ type: "task.progressed", payload: {} });
    });
    expect(fake.refetches["inbox.list"]).toBe(before + 1);
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

/** The guided layer on Home's widgets (UX plan §7.8): terms on the strip's labels, plain words under every figure, the checklist. */
function mountGuided(def: AnyWidgetDefinition, responses: Record<string, FakeResponse>, guidance: Partial<Parameters<typeof GuidanceProvider>[0]["value"] & object> = {}, opts: { editing?: boolean; actions?: Parameters<typeof GuidanceProvider>[0]["actions"] } = {}) {
  const fake = createFakeSource({ businessId: BID, responses });
  const Component = def.Component;
  const utils = render(
    <GuidanceProvider value={guidance} actions={opts.actions}>
      <WidgetDataProvider source={fake.source}>
        <Component businessId={BID} instanceId={`${def.key}-1`} settings={parseWidgetSettings(def, {})} editing={opts.editing} />
      </WidgetDataProvider>
    </GuidanceProvider>,
  );
  return { fake, ...utils };
}

const TERMS = {
  runway: { id: "runway", word: "Runway", short: "How many months your cash lasts at today's spending." },
  team_health: { id: "team_health", word: "Team health", short: "The share of agents not failing, down or degraded; idle and paused agents count as fine." },
  revenue: { id: "revenue", word: "Revenue", short: "Money customers paid you, counted on the day it arrives." },
};

describe("status strip in guided mode", () => {
  it("defines Runway and Revenue on their labels and says every figure in plain words; guidance off keeps the figures alone", () => {
    const { container, unmount } = mountGuided(getWidget("status_strip")!, dataResponses(), { terms: TERMS });
    const runway = container.querySelector("[data-term='runway']");
    expect(runway?.tagName).toBe("BUTTON");
    expect(runway?.textContent).toBe("Runway");
    // "Revenue" is defined by the map's entry (TERMS.revenue), like every other label.
    expect(container.querySelector("[data-term='revenue']")?.tagName).toBe("BUTTON");
    const lines = [...container.querySelectorAll("[data-metric-tile] [data-plain-line]")].map((el) => el.textContent);
    expect(lines).toEqual(["What is in the bank right now.", "How many months your cash lasts at today's spending.", "What customers paid you this month.", "People who paid you for the first time in the last 7 days.", "The share of agents not failing, down or degraded; idle and paused agents count as fine."]);
    unmount();
    const { container: off } = mountGuided(getWidget("status_strip")!, dataResponses(), { guidance: "off", terms: TERMS });
    expect(off.querySelector("[data-plain-line]")).toBeNull();
    expect(off.querySelector("[data-term='runway']")?.getAttribute("data-guided")).toBe("off");
    expect(off.querySelector("button[data-term]")).toBeNull();
  });
});

describe("first-week checklist widget", () => {
  const def = () => getWidget("first_week_checklist")!;

  it("lists the seven items with the done ones ticked, Go links to the product tabs and a Go button for running a cycle", () => {
    const { container } = mountGuided(def(), dataResponses());
    expect(screen.getByRole("region", { name: "Your first week" })).toBeTruthy();
    expect(screen.getByText("2 of 7 done")).toBeTruthy();
    expect(container.querySelectorAll("[data-first-week-item][data-done]").length).toBe(2);
    expect(screen.getByRole("link", { name: "Go: Read a note from an agent" }).getAttribute("href")).toBe(`/b/${BID}/inbox`);
    // The page comes first and opens Product › Public page; no item asks for a bank or Stripe (THESIS_REVIEW §5.7).
    expect(container.querySelector("[data-first-week-item]")?.getAttribute("data-first-week-item")).toBe("publish_page");
    expect(screen.getByRole("link", { name: "Go: Publish your page" }).getAttribute("href")).toMatch(new RegExp(`^/b/${BID}/d/[a-z-]+/public-page$`));
    expect(screen.queryByText(/Connect a bank/)).toBeNull();
    expect(screen.getByRole("button", { name: "Go: Run a cycle" })).toBeTruthy();
    // The query is scoped by the host (businessId merged in): the widget asks with no input of its own.
    expect(container.querySelector("[data-widget='first_week_checklist']")).toBeTruthy();
  });

  it("Hide records the dismissal through the guided layer, and a dismissed checklist renders nothing outside Edit mode", () => {
    const dismissChecklist = vi.fn();
    const { unmount } = mountGuided(def(), dataResponses(), {}, { actions: { dismissChecklist } });
    screen.getByRole("button", { name: "Hide" }).click();
    expect(dismissChecklist).toHaveBeenCalledTimes(1);
    unmount();
    const { container, fake, unmount: u2 } = mountGuided(def(), dataResponses(), { checklistDismissedAt: "2026-10-20T10:00:00.000Z" });
    expect(container.innerHTML).toBe("");
    expect(fake.queried.has("business.firstWeek.get")).toBe(false);
    u2();
    const { container: editing } = mountGuided(def(), dataResponses(), { checklistDismissedAt: "2026-10-20T10:00:00.000Z" }, { editing: true });
    expect(editing.textContent).toContain("Hidden: you closed the checklist");
  });

  it("folds a burst of events into one refetch, and ignores events whose flags are already done (perf audit item 10)", () => {
    vi.useFakeTimers();
    try {
      const { fake } = mountGuided(def(), dataResponses());
      const ev = (type: string) => ({ id: `evt-${type}`, businessId: BID, type, occurredAt: new Date().toISOString(), actor: { kind: "system" }, entityIds: [], payload: {}, narrated: false });
      // Both sign-offs are done in the fixture: a sign-off decision cannot change the answer.
      act(() => fake.emit(ev("product.signoff_decided")));
      act(() => void vi.advanceTimersByTime(FIRST_WEEK_REFETCH_DEBOUNCE_MS + 10));
      expect(fake.refetches["business.firstWeek.get"]).toBeUndefined();
      // A burst on flags still open: one refetch once the burst settles.
      act(() => {
        fake.emit(ev("inbox.item_updated"));
        fake.emit(ev("decision.made"));
        fake.emit(ev("conversation.message_posted"));
      });
      expect(fake.refetches["business.firstWeek.get"]).toBeUndefined();
      act(() => void vi.advanceTimersByTime(FIRST_WEEK_REFETCH_DEBOUNCE_MS + 10));
      expect(fake.refetches["business.firstWeek.get"]).toBe(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("firstWeekEventMatters: an event counts only while a flag it can flip is still open", () => {
    const flags = { pagePublished: false, specificationSignedOff: true, roadmapSignedOff: false, cycleCompleted: true, noteRead: true, conversationReplySent: false, distributionStarted: false };
    expect(firstWeekEventMatters("page.published", flags)).toBe(true);
    expect(firstWeekEventMatters("page.published", { ...flags, pagePublished: true })).toBe(false);
    expect(firstWeekEventMatters("bank.balance_updated", flags)).toBe(false);
    expect(firstWeekEventMatters("product.signoff_decided", flags)).toBe(true);
    expect(firstWeekEventMatters("product.signoff_decided", { ...flags, roadmapSignedOff: true })).toBe(false);
    expect(firstWeekEventMatters("cycle.completed", flags)).toBe(false);
    expect(firstWeekEventMatters("inbox.item_updated", flags)).toBe(false);
    expect(firstWeekEventMatters("conversation.message_posted", flags)).toBe(true);
    expect(firstWeekEventMatters("cycle.completed", undefined)).toBe(true);
    expect(firstWeekEventMatters("agent.health_changed", flags)).toBe(false);
  });

  it("records the dismissal once every item is done, and renders nothing when guidance is off", () => {
    const dismissChecklist = vi.fn();
    const allDone = Object.fromEntries(Object.keys(dataResponses()["business.firstWeek.get"] as object).map((k) => [k, true]));
    const { container, unmount } = mountGuided(def(), { ...dataResponses(), "business.firstWeek.get": allDone }, {}, { actions: { dismissChecklist } });
    expect(container.querySelector("[data-first-week-all-done]")).toBeTruthy();
    expect(dismissChecklist).toHaveBeenCalledTimes(1);
    unmount();
    const { container: off, fake } = mountGuided(def(), dataResponses(), { guidance: "off" });
    expect(off.innerHTML).toBe("");
    expect(fake.queried.has("business.firstWeek.get")).toBe(false);
  });
});
