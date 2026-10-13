// @vitest-environment happy-dom
/** Pin to Home (audit #394): a widget away from Home, or a module panel naming one, can be put on the active Home dashboard. */
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";
import { TooltipProvider } from "@foundmill/dugout";
import { WidgetDataProvider } from "../data";
import "../widgets";
import { LAYOUT_VERSION, type DashboardLayout } from "../layout";
import { getWidget } from "../registry";
import { WidgetFrame } from "../shared/frame";
import { WidgetInstanceProvider, pinnedIndex, togglePinned, usePinToHomeMenu } from "../shared/pin";
import { createFakeSource } from "../testing";

afterEach(cleanup);

const empty: DashboardLayout = { version: LAYOUT_VERSION, widgets: [] };

describe("togglePinned", () => {
  it("adds the widget with its settings under everything on Home, and takes it off when pressed again", () => {
    const def = getWidget("custom_metric")!;
    const settings = { mode: "query", queryId: "revenue_30d" };
    const withRibbon: DashboardLayout = { version: LAYOUT_VERSION, widgets: [{ i: "journey_ribbon-1", key: "journey_ribbon", x: 0, y: 0, w: 12, h: 20, settings: {} }] };
    const pinned = togglePinned(withRibbon, def, settings);
    expect(pinned.widgets).toHaveLength(2);
    expect(pinned.widgets[1]).toMatchObject({ key: "custom_metric", x: 0, y: 20, settings: expect.objectContaining(settings) });
    expect(pinnedIndex(pinned, def, settings)).toBe(1);
    // The same widget with other settings is another panel: it is not the one pinned.
    expect(pinnedIndex(pinned, def, { mode: "query", queryId: "customers_30d" })).toBe(-1);
    expect(togglePinned(pinned, def, settings).widgets.map((w) => w.key)).toEqual(["journey_ribbon"]);
  });

  it("treats a single widget as pinned whatever its settings", () => {
    const def = getWidget("journey_ribbon")!;
    const home = togglePinned(empty, def, {});
    expect(pinnedIndex(home, def, { zoom: "week" })).toBe(0);
  });
});

function Probe({ widgetKey }: { widgetKey: string }) {
  const menu = usePinToHomeMenu({ key: widgetKey });
  return <span data-testid="pin">{menu ? (menu.pinned ? "pinned" : "pin") : "none"}</span>;
}

describe("Pin to Home", () => {
  it("offers Pin to Home in a department widget's caret menu and writes the active dashboard", async () => {
    const user = userEvent.setup();
    const fake = createFakeSource({ responses: { "dashboard.get": { id: "dash-1", layout: { widgets: [] } } } });
    render(
      <TooltipProvider>
        <WidgetDataProvider source={fake.source}>
          <WidgetInstanceProvider value={{ key: "cash_runway", settings: {} }}>
            <WidgetFrame title="Cash and runway">Body</WidgetFrame>
          </WidgetInstanceProvider>
        </WidgetDataProvider>
      </TooltipProvider>,
    );
    screen.getByRole("button", { name: "Panel menu" }).focus();
    await user.keyboard("{Enter}");
    await user.click(await screen.findByRole("menuitem", { name: "Pin to Home" }));
    expect(fake.mutations).toHaveLength(1);
    expect(fake.mutations[0]).toMatchObject({ path: "dashboard.update", input: { dashboardId: "dash-1", layout: { widgets: [expect.objectContaining({ key: "cash_runway", x: 0, y: 0 })] } } });
  });

  it("reads Unpin from Home when the widget is already on Home, and offers nothing on Home itself", () => {
    const fake = createFakeSource({ responses: { "dashboard.get": { id: "dash-1", layout: { widgets: [{ key: "funnel", x: 0, y: 0, w: 6, h: 12, settings: {} }] } } } });
    render(
      <WidgetDataProvider source={fake.source}>
        <Probe widgetKey="funnel" />
        <Probe widgetKey="squad_pulse" />
        <Probe widgetKey="not_a_widget" />
      </WidgetDataProvider>,
    );
    expect(screen.getAllByTestId("pin").map((n) => n.textContent)).toEqual(["pinned", "pin", "none"]);
    // Without an instance (Home) the frame asks for no dashboard and draws no caret.
    cleanup();
    const home = createFakeSource({ responses: { "dashboard.get": { id: "dash-1", layout: { widgets: [] } } } });
    render(
      <WidgetDataProvider source={home.source}>
        <WidgetFrame title="Funnel">Body</WidgetFrame>
      </WidgetDataProvider>,
    );
    expect(screen.queryByRole("button", { name: "Panel menu" })).toBeNull();
    expect(home.queried.has("dashboard.get")).toBe(false);
  });
});
