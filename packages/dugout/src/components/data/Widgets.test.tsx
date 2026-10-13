import { describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import {
  addWidget,
  mergeRglLayout,
  nextRow,
  nudgeAnnouncement,
  nudgeItem,
  toRglLayout,
  useWidgetInstanceLabel,
  WidgetGrid,
  widgetInstanceName,
} from "./WidgetGrid";
import { Panel } from "../shell/Panel";
import { DEMO_WIDGET_REGISTRY, FOUNDERS_VIEW_LAYOUT, WIDGET_PRESETS } from "./fixtures";
import type { WidgetLayout } from "./types";

const registry = DEMO_WIDGET_REGISTRY.map((e) => ({
  ...e,
  render: ({ settings }: { settings: Record<string, unknown> }) => (
    <div data-testid={`body-${e.key}`}>{JSON.stringify(settings)}</div>
  ),
}));

function Harness({
  initial = FOUNDERS_VIEW_LAYOUT,
  editing = true,
  onChange,
}: {
  initial?: WidgetLayout;
  editing?: boolean;
  onChange?: (l: WidgetLayout) => void;
}) {
  const [layout, setLayout] = useState<WidgetLayout>(initial);
  return (
    <WidgetGrid
      layout={layout}
      registry={registry}
      width={1200}
      defaultEditing={editing}
      presets={WIDGET_PRESETS}
      defaultLayout={FOUNDERS_VIEW_LAYOUT}
      onChange={(l) => {
        setLayout(l);
        onChange?.(l);
      }}
    />
  );
}

describe("WidgetGrid helpers", () => {
  it("converts to and from the react-grid-layout shape without losing widget keys or settings", () => {
    const rgl = toRglLayout(FOUNDERS_VIEW_LAYOUT, registry);
    expect(rgl[0]).toMatchObject({ i: "ribbon", x: 0, y: 0, w: 12, h: 38, minW: 6, minH: 20 });
    const moved = rgl.map((l) => (l.i === "inbox" ? { ...l, x: 0, y: 110 } : l));
    const merged = mergeRglLayout(FOUNDERS_VIEW_LAYOUT, moved);
    expect(merged.find((it) => it.i === "inbox")).toMatchObject({
      x: 0,
      y: 110,
      widget: "inbox_preview",
      settings: { rows: 4 },
    });
  });
  it("adds a widget at the bottom with the registry defaults", () => {
    const next = addWidget(FOUNDERS_VIEW_LAYOUT, registry[5]!);
    expect(next).toHaveLength(FOUNDERS_VIEW_LAYOUT.length + 1);
    expect(next[next.length - 1]).toMatchObject({
      widget: "custom_metric",
      x: 0,
      y: nextRow(FOUNDERS_VIEW_LAYOUT),
      w: 3,
      h: 12,
    });
  });
  it("nudges within bounds and limits", () => {
    const l: WidgetLayout = [{ i: "a", widget: "inbox_preview", x: 10, y: 0, w: 2, h: 4, minW: 2 }];
    expect(nudgeItem(l, "a", "right")[0]?.x).toBe(10);
    expect(nudgeItem(l, "a", "wider")[0]?.w).toBe(2);
    expect(nudgeItem(l, "a", "narrower")[0]?.w).toBe(2);
    expect(nudgeItem(l, "a", "left")[0]?.x).toBe(9);
    expect(nudgeItem(l, "a", "up")[0]?.y).toBe(0);
    expect(nudgeItem(l, "a", "taller")[0]?.h).toBe(5);
    expect(nudgeItem(l, "a", "shorter")[0]?.h).toBe(3);
  });
});

describe("WidgetGrid", () => {
  it("renders every widget with its registry title and settings", () => {
    render(<Harness editing={false} />);
    expect(screen.getByRole("region", { name: "Journey Ribbon" })).toBeTruthy();
    expect(screen.getAllByRole("region", { name: "Department card" })).toHaveLength(3);
    expect(screen.getByTestId("body-inbox_preview").textContent).toContain('"rows":4');
    expect(screen.queryByRole("button", { name: /Remove/ })).toBeNull();
    expect(screen.getByRole("button", { name: "Edit layout" })).toBeTruthy();
  });

  it("in edit mode shows drag handles, remove and settings; removing calls onChange", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);
    expect(document.querySelector("[data-widget-grid]")?.getAttribute("data-editing")).toBe("true");
    expect(screen.getAllByRole("button", { name: /^Move / }).length).toBe(
      FOUNDERS_VIEW_LAYOUT.length,
    );
    await user.click(screen.getByRole("button", { name: "Remove Team pulse" }));
    expect(onChange).toHaveBeenCalled();
    expect(onChange.mock.calls.at(-1)?.[0].some((it: { i: string }) => it.i === "pulse")).toBe(
      false,
    );
    expect(screen.queryByRole("region", { name: "Team pulse" })).toBeNull();
  });

  it("adds a widget from the drawer and respects single-instance widgets", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);
    await user.click(screen.getByRole("button", { name: "Add widget" }));
    const dialog = await screen.findByRole("dialog", { name: "Add widget" });
    expect(
      within(dialog).getByRole("button", { name: "Add Journey Ribbon" }).hasAttribute("disabled"),
    ).toBe(true);
    expect(within(dialog).queryByText("Leaderboard")).toBeNull();
    await user.click(within(dialog).getByRole("button", { name: "Add Custom metric" }));
    const last = onChange.mock.calls.at(-1)?.[0].at(-1);
    expect(last).toMatchObject({ widget: "custom_metric", y: nextRow(FOUNDERS_VIEW_LAYOUT) });
  });

  it("edits widget settings through the dialog", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);
    await user.click(screen.getByRole("button", { name: "Inbox preview settings" }));
    const dialog = await screen.findByRole("dialog", { name: "Inbox preview settings" });
    const rows = within(dialog).getByLabelText("Rows") as HTMLInputElement;
    await user.clear(rows);
    await user.type(rows, "6");
    await user.click(within(dialog).getByRole("checkbox", { name: "Unread only" }));
    await user.click(within(dialog).getByRole("button", { name: "Save" }));
    const inbox = onChange.mock.calls.at(-1)?.[0].find((it: { i: string }) => it.i === "inbox");
    expect(inbox.settings).toEqual({ rows: 6, unreadOnly: true });
    expect(screen.getByTestId("body-inbox_preview").textContent).toContain('"rows":6');
  });

  it("moves and resizes a widget from the keyboard on its drag handle", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);
    const handle = screen.getByRole("button", { name: /^Move Inbox preview/ });
    handle.focus();
    await user.keyboard("{ArrowLeft}");
    expect(onChange.mock.calls.at(-1)?.[0].find((it: { i: string }) => it.i === "inbox").x).toBe(7);
    await user.keyboard("{Shift>}{ArrowDown}{/Shift}");
    expect(onChange.mock.calls.at(-1)?.[0].find((it: { i: string }) => it.i === "inbox").h).toBe(
      31,
    );
  });

  it("names each control after its instance and reads out keyboard moves and resizes (A11Y-18)", async () => {
    const user = userEvent.setup();
    function Labelled({ name }: { name: string }) {
      useWidgetInstanceLabel(name);
      return <div>{name}</div>;
    }
    const cardRegistry = [
      ...registry,
      { key: "dept", title: "Department card", defaultSize: { w: 4, h: 20 }, settings: [{ key: "slot", label: "Slot", kind: "number" as const }], render: ({ settings }: { settings: Record<string, unknown> }) => (settings.named ? <Labelled name={String(settings.named)} /> : <div>unnamed</div>) },
    ];
    const layout: WidgetLayout = [
      { i: "d1", widget: "dept", x: 0, y: 0, w: 4, h: 20, settings: { named: "Product" } },
      { i: "d2", widget: "dept", x: 4, y: 0, w: 4, h: 20, settings: { named: "Finance" } },
      { i: "d3", widget: "dept", x: 8, y: 0, w: 4, h: 20, settings: {} },
    ];
    function Grid() {
      const [l, setL] = useState<WidgetLayout>(layout);
      return <WidgetGrid layout={l} registry={cardRegistry} width={1200} defaultEditing onChange={setL} />;
    }
    render(<Grid />);
    // Told apart by department, or by order when a card has no name yet; never six identical names.
    const handle = await screen.findByRole("button", { name: /^Move Department card: Product\./ });
    expect(screen.getByRole("button", { name: /^Move Department card: Finance\./ })).toBeTruthy();
    expect(screen.getByRole("button", { name: /^Move Department card 3 of 3\./ })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Department card: Finance settings" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Remove Department card: Product" })).toBeTruthy();
    handle.focus();
    await user.keyboard("{ArrowDown}");
    const status = document.querySelector("[data-widget-grid-status]")!;
    expect(status.getAttribute("aria-live")).toBe("polite");
    expect(status.textContent).toBe("Department card: Product moved to column 1, row 2");
    await user.keyboard("{Shift>}{ArrowLeft}{/Shift}");
    expect(status.textContent).toBe("Department card: Product resized to 3 columns by 20 rows");
  });

  it("builds instance names and move announcements", () => {
    expect(widgetInstanceName("Department card", "Product", 0, 6)).toBe("Department card: Product");
    expect(widgetInstanceName("Department card", undefined, 1, 6)).toBe("Department card 2 of 6");
    expect(widgetInstanceName("Journey Ribbon", undefined, 0, 1)).toBe("Journey Ribbon");
    expect(nudgeAnnouncement("Inbox preview", "right", { i: "x", widget: "inbox", x: 2, y: 4, w: 4, h: 10 })).toBe("Inbox preview moved to column 3, row 5");
    expect(nudgeAnnouncement("Inbox preview", "taller", { i: "x", widget: "inbox", x: 2, y: 4, w: 4, h: 11 })).toBe("Inbox preview resized to 4 columns by 11 rows");
  });

  it("applies presets and resets to the default layout", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);
    await user.click(screen.getByRole("button", { name: "Presets" }));
    await user.click(await screen.findByRole("menuitem", { name: /Builder/ }));
    expect(onChange.mock.calls.at(-1)?.[0].map((it: { i: string }) => it.i)).toEqual([
      "strip",
      "dept-product",
      "pulse",
    ]);
    expect(screen.queryByRole("region", { name: "Journey Ribbon" })).toBeNull();
    await user.click(screen.getByRole("button", { name: "Reset" }));
    expect(screen.getByRole("region", { name: "Journey Ribbon" })).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Done" }));
    expect(screen.getByRole("button", { name: "Edit layout" })).toBeTruthy();
  });

  it("forwards data-* and aria-* attributes to the root element (e2e selectors hook onto the grid)", () => {
    render(
      <WidgetGrid
        layout={FOUNDERS_VIEW_LAYOUT}
        registry={registry}
        width={1200}
        onChange={() => {}}
        aria-label="Home widgets"
        aria-describedby="home-hint"
        data-testid="home-grid"
        data-dashboard="founder"
        id="home-grid-root"
      />,
    );
    const root = screen.getByTestId("home-grid");
    expect(root.hasAttribute("data-widget-grid")).toBe(true);
    expect(root.getAttribute("aria-label")).toBe("Home widgets");
    expect(root.getAttribute("aria-describedby")).toBe("home-hint");
    expect(root.getAttribute("data-dashboard")).toBe("founder");
    expect(root.id).toBe("home-grid-root");
    // The grid's own attributes and classes are not overridden by the forwarded ones.
    expect(root.className).toContain("flex");
    expect(root.getAttribute("data-editing")).toBeNull();
    expect(screen.getByRole("region", { name: "Journey Ribbon" })).toBeTruthy();
  });

  it("draws one header per framed widget: the widget's own panel, with the grid's controls only in edit mode", async () => {
    const user = userEvent.setup();
    const framedRegistry = registry.map((e) => ({
      ...e,
      framed: true,
      render: () => (
        <Panel title={`${e.title} panel`} actions={<span>Forecast</span>}>
          <div data-testid={`body-${e.key}`} />
        </Panel>
      ),
    }));
    const { container } = render(<WidgetGrid layout={FOUNDERS_VIEW_LAYOUT} registry={framedRegistry} width={1200} onChange={() => {}} />);
    const item = container.querySelector("[data-widget-id='ribbon']") as HTMLElement;
    expect(item.getAttribute("data-framed")).toBe("true");
    // One title (the widget's), no grid header and no second panel surface.
    expect(within(item).getAllByRole("heading").map((h) => h.textContent)).toEqual(["Journey Ribbon panel"]);
    expect(item.querySelectorAll(".surface-panel").length).toBe(1);
    expect(item.querySelector("[data-widget-controls]")).toBeNull();
    await user.click(screen.getByRole("button", { name: "Edit layout" }));
    const controls = item.querySelector("[data-widget-controls]") as HTMLElement;
    expect(within(controls).getByRole("button", { name: /^Move Journey Ribbon/ })).toBeTruthy();
    expect(within(controls).getByRole("button", { name: "Remove Journey Ribbon" })).toBeTruthy();
    expect(within(item).getAllByRole("heading").length).toBe(1);
  });
});
