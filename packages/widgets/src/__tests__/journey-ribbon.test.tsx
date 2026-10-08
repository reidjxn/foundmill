/** Journey Ribbon widget: data flow into the Dugout ribbon, zoom persistence, payment bar → Customer Update, live ripples. */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { configure, act, fireEvent, render, screen } from "@testing-library/react";

// The ribbon mounts visx + PixiJS on happy-dom; shared CI runners need more than the 1 s default to settle.
configure({ asyncUtilTimeout: 10_000 });
import { WidgetDataProvider } from "../data";
import { getWidget, parseWidgetSettings } from "../registry";
import { createFakeSource } from "../testing";
import "../widgets";
import { BID, dataResponses } from "./fixtures";

const def = getWidget("journey_ribbon")!;

/** visx ParentSize measures through ResizeObserver; report a 1200 px parent synchronously. */
class MeasuringRO {
  constructor(private cb: (entries: unknown[]) => void) {}
  observe(el: Element) {
    this.cb([{ target: el, contentRect: { width: 1200, height: 300, top: 0, left: 0 } }]);
  }
  unobserve() {}
  disconnect() {}
}
const originalRO = globalThis.ResizeObserver;
beforeAll(() => {
  (globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = MeasuringRO;
});
afterAll(() => {
  (globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = originalRO;
});

function mountRibbon(settings: Record<string, unknown> = {}) {
  const fake = createFakeSource({ businessId: BID, responses: dataResponses() });
  const updateSettings = vi.fn();
  const Component = def.Component;
  const utils = render(
    <WidgetDataProvider source={fake.source}>
      <Component businessId={BID} instanceId="journey_ribbon-1" settings={parseWidgetSettings(def, settings)} updateSettings={updateSettings} />
    </WidgetDataProvider>,
  );
  return { fake, updateSettings, ...utils };
}

describe("journey ribbon widget", () => {
  it("renders the labelled rows, payment bars, the forecast cone, roadmap pins and the runway", async () => {
    const { container } = mountRibbon();
    const root = await screen.findByRole("group", { name: /Journey Ribbon/ });
    expect(root.getAttribute("aria-label")).toContain("3 departments");
    expect(container.querySelector("[data-revenue-line]")).toBeTruthy();
    expect(container.querySelector("[data-track='hours']")?.children.length).toBeGreaterThan(0);
    expect(container.querySelector("[data-ribbon-labels]")?.textContent).toContain("Paying customers");
    expect(container.querySelector("[data-forecast]")).toBeTruthy();
    expect(container.querySelector("[data-runway]")).toBeTruthy();
    expect(container.querySelectorAll("[data-marker='payment']").length).toBeGreaterThan(0);
    expect(root.getAttribute("data-zoom")).toBe("quarter");
  });

  it("starts at the saved zoom and persists zoom changes through updateSettings", async () => {
    const { updateSettings } = mountRibbon({ zoom: "month" });
    const root = await screen.findByRole("group", { name: /Journey Ribbon/ });
    expect(root.getAttribute("data-zoom")).toBe("month");
    fireEvent.click(screen.getByRole("button", { name: "Week" }));
    expect(updateSettings).toHaveBeenCalledWith({ zoom: "week" });
    expect(root.getAttribute("data-zoom")).toBe("week");
  });

  it("opens the Customer Update when a single payment marker is clicked (AC-11.2.2)", async () => {
    const { fake, container } = mountRibbon({ zoom: "all" });
    await screen.findByRole("group", { name: /Journey Ribbon/ });
    const single = container.querySelector("[data-marker='payment'][data-count='1']") as SVGGElement | null;
    expect(single).toBeTruthy();
    fireEvent.click(single!);
    expect(fake.navigations.at(-1)).toMatch(new RegExp(`^/b/${BID}/journey/`));
  });

  it("ripples live events into Today and refetches on payments", async () => {
    const { fake } = mountRibbon();
    await screen.findByRole("group", { name: /Journey Ribbon/ });
    expect(fake.subscriberCount()).toBe(1);
    act(() => {
      fake.emit({ type: "signup.created", payload: { entityId: "x" } });
    });
    expect(fake.refetches["journey.ribbon"]).toBeUndefined();
    act(() => {
      fake.emit({ type: "payment.received", payload: { amount: { amountMinor: 4900, currency: "EUR" }, firstPayment: true } });
    });
    expect(fake.refetches["journey.ribbon"]).toBe(1);
  });

  it("skips the forecast and roadmap queries when the settings turn them off", () => {
    const { fake } = mountRibbon({ showForecast: false, showRoadmap: false });
    expect(fake.queried.has("finance.overview")).toBe(false);
    expect(fake.queried.has("product.roadmap.list")).toBe(false);
    expect(fake.queried.has("journey.ribbon")).toBe(true);
  });
});
