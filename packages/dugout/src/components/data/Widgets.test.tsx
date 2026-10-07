import { describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import {
  addWidget,
  mergeRglLayout,
  nextRow,
  nudgeItem,
  toRglLayout,
  WidgetGrid,
} from "./WidgetGrid";
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
    await user.click(screen.getByRole("button", { name: "Remove Squad pulse" }));
    expect(onChange).toHaveBeenCalled();
    expect(onChange.mock.calls.at(-1)?.[0].some((it: { i: string }) => it.i === "pulse")).toBe(
      false,
    );
    expect(screen.queryByRole("region", { name: "Squad pulse" })).toBeNull();
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
    expect(within(dialog).queryByText("League table")).toBeNull();
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
});
