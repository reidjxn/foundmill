import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { AreaChart } from "./AreaChart";
import { BarChart } from "./BarChart";
import { extent, nearestIndex, toneVar } from "./common";
import { FunnelChart, funnelRates, funnelRateText, funnelStepText } from "./FunnelChart";
import { Heatmap } from "./Heatmap";
import { LineChart } from "./LineChart";

const days = (n: number) => Array.from({ length: n }, (_, i) => ({ x: new Date(Date.UTC(2026, 8, 1 + i)), y: 100 + i * 7 }));

describe("chart helpers", () => {
  it("maps tones to tokens, finds the nearest index and pads extents", () => {
    expect(toneVar("kit")).toBe("var(--kit-lift)");
    expect(toneVar("dept-3")).toBe("var(--dept-3)");
    expect(nearestIndex([0, 10, 20], 13)).toBe(1);
    expect(extent([])).toEqual([0, 1]);
    expect(extent([5, 5])).toEqual([4.5, 5.5]);
    expect(extent([0, 10], 0.1)).toEqual([-1, 11]);
    expect(funnelRates([{ label: "a", value: 100 }, { label: "b", value: 40 }, { label: "c", value: 10 }])).toEqual([
      { ofPrevious: null, ofFirst: null },
      { ofPrevious: 0.4, ofFirst: 0.4 },
      { ofPrevious: 0.25, ofFirst: 0.1 },
    ]);
  });
});

describe("LineChart", () => {
  it("renders a path per series, a legend with Forecast for dashed series and a tooltip on hover", () => {
    const { container } = render(
      <LineChart
        label="Revenue"
        width={600}
        height={160}
        series={[
          { id: "actual", label: "Revenue", tone: "kit", data: days(10), area: true },
          { id: "fc", label: "Forecast", tone: "kit", data: days(10).map((d) => ({ ...d, y: d.y * 1.2 })), dashed: true },
        ]}
        provenance="forecast"
        markX={new Date(Date.UTC(2026, 8, 5))}
        markLabel="Today"
      />,
    );
    expect(screen.getByRole("img", { name: /Revenue\./ })).toBeTruthy();
    expect(container.querySelectorAll("path[data-series]").length).toBe(2);
    expect(container.querySelector("path[data-series='fc']")?.getAttribute("stroke-dasharray")).toBe("4 4");
    expect(container.querySelector("[data-mark] text")?.textContent).toBe("TODAY");
    // The dashed series is labelled "Forecast" already; the chart's provenance chip says Forecast once.
    expect(container.querySelector("[data-provenance='forecast']")?.textContent).toBe("Forecast");
    const hit = container.querySelector("rect[fill='transparent']") as SVGRectElement;
    hit.getBoundingClientRect = () => ({ left: 40, top: 8, width: 548, height: 128, right: 588, bottom: 136, x: 40, y: 8, toJSON: () => ({}) }) as DOMRect;
    fireEvent.pointerMove(hit, { clientX: 40, clientY: 50 });
    const tip = container.querySelector("[data-chart-tooltip]");
    expect(tip?.textContent).toContain("1 Sep 2026");
    expect(tip?.textContent).toContain("100");
    fireEvent.pointerLeave(hit);
    expect(container.querySelector("[data-chart-tooltip]")).toBeNull();
  });
});

describe("AreaChart", () => {
  it("stacks aligned series", () => {
    const { container } = render(<AreaChart label="Hours" width={500} stacked series={[{ id: "a", label: "A", tone: "dept-1", data: days(5) }, { id: "b", label: "B", tone: "dept-2", data: days(5) }]} />);
    expect(container.querySelectorAll("g[data-series]").length).toBe(2);
    expect(screen.getByRole("img", { name: /stacked/ })).toBeTruthy();
  });
});

describe("BarChart", () => {
  it("renders bars, prints values, marks provenance and selects with the keyboard", () => {
    const onSelect = vi.fn();
    const { container } = render(<BarChart label="Spend by month" width={500} showValues onSelect={onSelect} data={[{ label: "Jul", value: 120 }, { label: "Aug", value: 80 }, { label: "Sep", value: 95, provenance: "forecast" }]} />);
    expect(container.querySelectorAll("[data-bar]").length).toBe(3);
    expect(container.querySelector("[data-bar='Sep'] rect")?.getAttribute("stroke-dasharray")).toBe("3 2");
    expect(screen.getByRole("img", { name: /Sep 95 \(forecast\)/ })).toBeTruthy();
    const aug = screen.getByRole("button", { name: "Aug: 80" });
    fireEvent.keyDown(aug, { key: "Enter" });
    expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({ label: "Aug" }), 1);
    const { container: horizontal } = render(<BarChart label="Channels" width={500} horizontal data={[{ label: "SEO", value: 40 }, { label: "Paid", value: -10 }]} />);
    expect(horizontal.querySelectorAll("[data-bar]").length).toBe(2);
  });

  it("prints values on every bar or on none", () => {
    const tight = (labelled: boolean) => [{ label: "Jan", value: labelled ? 1 : 1_234_567 }, { label: "Feb", value: 2 }];
    const { container, rerender } = render(<BarChart label="Spend" width={120} height={120} showValues format={(v) => String(v)} data={tight(true)} />);
    expect(container.querySelectorAll("[data-bar] text").length).toBe(2);
    rerender(<BarChart label="Spend" width={120} height={120} showValues format={(v) => String(v)} data={tight(false)} />);
    expect(container.querySelectorAll("[data-bar] text").length).toBe(0);
  });

  it("keeps the printed value under a negative bar clear of the month labels", () => {
    const { container } = render(<BarChart label="Net cash" width={500} height={160} showValues data={[{ label: "Jul", value: 1200 }, { label: "Aug", value: -900 }, { label: "Sep", value: 300 }]} />);
    const axisTop = Number(/translate\(0 ([\d.]+)\)/.exec(container.querySelector("[data-axis='x']")?.getAttribute("transform") ?? "")?.[1]);
    const label = [...container.querySelectorAll("[data-bar='Aug'] text")].find((t) => t.textContent?.includes("900"));
    // The value's baseline (plus a descender) sits above the month labels' cap height (17 px baseline, 11 px text).
    expect(Number(label?.getAttribute("y")) + 3).toBeLessThanOrEqual(axisTop + 17 - 11);
  });
});

describe("FunnelChart", () => {
  it("prints every stage with its rates", () => {
    const { container } = render(<FunnelChart label="Acquisition funnel" width={600} stages={[{ label: "Visits", value: 12000 }, { label: "Signups", value: 840 }, { label: "Activated", value: 410 }, { label: "Paid", value: 96 }]} provenance="estimate" />);
    expect(container.querySelectorAll("[data-funnel-stage]").length).toBe(4);
    expect(screen.getByRole("img", { name: /Signups 840 \(7% of previous\)/ })).toBeTruthy();
    expect(screen.getByText("Estimate")).toBeTruthy();
    // Rates in words, in a column as wide as the longest one.
    const rates = [...container.querySelectorAll("[data-funnel-rate]")].map((t) => t.textContent);
    expect(rates).toEqual(["7% to signups", "49% to activated", "23% to paid"]);
  });

  it("never rounds a real rate to 0% and never prints a count over a hairline bar", () => {
    expect(funnelRateText(0)).toBe("0%");
    expect(funnelRateText(0.004)).toBe("<1%");
    expect(funnelRateText(0.067)).toBe("6.7%");
    expect(funnelRateText(0.123)).toBe("12%");
    expect(funnelStepText({ label: "MQL", value: 3 }, { ofPrevious: 0.5 })).toBe("50% to MQL");
    expect(funnelStepText({ label: "Visits", value: 3 }, { ofPrevious: null })).toBe("");
    const { container } = render(<FunnelChart label="Touch funnel" width={600} stages={[{ label: "Impressions", value: 1_200_000 }, { label: "Clicks", value: 900 }, { label: "Customers", value: 12 }]} />);
    const counts = [...container.querySelectorAll("[data-funnel-count]")].map((t) => t.getAttribute("data-funnel-count"));
    expect(counts).toEqual(["inside", "beside", "beside"]);
    expect([...container.querySelectorAll("[data-funnel-rate]")].map((t) => t.textContent)).toEqual(["<1% to clicks", "1.3% to customers"]);
  });
});

describe("Heatmap", () => {
  it("renders rows × cols cells with alpha by value and selectable cells", () => {
    const onSelect = vi.fn();
    const { container } = render(<Heatmap label="Activity" width={400} rows={["Mon", "Tue"]} cols={["0", "1", "2"]} values={[[0, 2, 4], [1, 0, 3]]} onSelect={onSelect} />);
    expect(container.querySelectorAll("[data-heat-cell]").length).toBe(6);
    const peak = container.querySelector("[data-heat-cell='0:2']") as SVGRectElement;
    expect(Number(peak.getAttribute("fill-opacity"))).toBeCloseTo(0.95);
    expect(container.querySelector("[data-heat-cell='0:0']")?.getAttribute("fill")).toBe("var(--bg-panel-alt)");
    fireEvent.click(screen.getByRole("button", { name: "Tue, 2: 3" }));
    expect(onSelect).toHaveBeenCalledWith(1, 2, 3);
  });
});
