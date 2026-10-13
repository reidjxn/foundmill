// @vitest-environment happy-dom
/** Saved table views come back after a reload (audit #204): the store answers the person's list and open view. */
import { act, cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import type { SavedView } from "@foundmill/dugout";
import { WidgetDataProvider } from "../data";
import { mergeSavedViews, resolveActiveViewId, useSavedViews, type SavedViewsProps } from "../shared/saved-views";
import { createFakeSource } from "../testing";

const DEFAULTS: SavedView[] = [
  { id: "all", name: "All", builtIn: true, columns: ["name", "status"], sort: [], filters: [] },
  { id: "open", name: "Open", builtIn: true, columns: ["name", "status"], sort: [], filters: [{ id: "f1", field: "status", op: "eq", value: "open" }] },
];
const MINE: SavedView = { id: "mine-1", name: "Overdue first", columns: ["status", "name"], sort: [{ id: "status", desc: true }], filters: [] };

afterEach(cleanup);

describe("mergeSavedViews", () => {
  it("keeps the person's order and own views, and every built-in view as the code defines it today", () => {
    const stale = { ...DEFAULTS[0]!, name: "Everything", columns: ["name"] };
    const merged = mergeSavedViews(DEFAULTS, { views: [MINE, stale], activeViewId: "mine-1" });
    expect(merged.map((v) => v.id)).toEqual(["mine-1", "all", "open"]);
    expect(merged[1]).toBe(DEFAULTS[0]);
  });

  it("is the code's views when nothing was saved", () => {
    expect(mergeSavedViews(DEFAULTS, null)).toEqual(DEFAULTS);
  });
});

describe("resolveActiveViewId", () => {
  it("opens the stored view while it exists, else the screen's default, else the first", () => {
    expect(resolveActiveViewId(DEFAULTS, "open", "all")).toBe("open");
    expect(resolveActiveViewId(DEFAULTS, "deleted", "open")).toBe("open");
    expect(resolveActiveViewId(DEFAULTS, null)).toBe("all");
  });
});

function Probe({ onRender }: { onRender: (p: SavedViewsProps) => void }) {
  onRender(useSavedViews("team.agents", DEFAULTS, { defaultViewId: "all" }));
  return null;
}

describe("useSavedViews", () => {
  it("reads the person's views for the table and reopens the view they left open", () => {
    const fake = createFakeSource({ responses: { "founder.tableViews.get": { views: [...DEFAULTS, MINE], activeViewId: "mine-1" } } });
    let last: SavedViewsProps | null = null;
    render(
      <WidgetDataProvider source={fake.source}>
        <Probe onRender={(p) => (last = p)} />
      </WidgetDataProvider>,
    );
    expect(fake.queried.get("founder.tableViews.get")).toEqual({ tableKey: "team.agents" });
    expect(last!.views.map((v) => v.id)).toEqual(["all", "open", "mine-1"]);
    expect(last!.activeViewId).toBe("mine-1");
  });

  it("writes every change to the store and shows it before the store answers", () => {
    const fake = createFakeSource({ responses: { "founder.tableViews.get": null } });
    let last: SavedViewsProps | null = null;
    render(
      <WidgetDataProvider source={fake.source}>
        <Probe onRender={(p) => (last = p)} />
      </WidgetDataProvider>,
    );
    expect(last!.activeViewId).toBe("all");
    act(() => last!.onViewsChange([...DEFAULTS, MINE]));
    act(() => last!.onActiveViewChange("mine-1"));
    expect(last!.activeViewId).toBe("mine-1");
    expect(fake.mutations).toEqual([
      { path: "founder.tableViews.save", input: { tableKey: "team.agents", views: [...DEFAULTS, MINE], activeViewId: "all" } },
      { path: "founder.tableViews.save", input: { tableKey: "team.agents", views: [...DEFAULTS, MINE], activeViewId: "mine-1" } },
    ]);
  });

  it("falls back to the built-in views when the store cannot answer", () => {
    const fake = createFakeSource({ responses: { "founder.tableViews.get": new Error("down") } });
    let last: SavedViewsProps | null = null;
    render(
      <WidgetDataProvider source={fake.source}>
        <Probe onRender={(p) => (last = p)} />
      </WidgetDataProvider>,
    );
    expect(last!.views).toEqual(DEFAULTS);
    expect(last!.activeViewId).toBe("all");
  });
});
