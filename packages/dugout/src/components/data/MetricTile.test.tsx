import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { GuidanceProvider } from "../guidance/GuidanceProvider";
import { FIXTURE_TERMS } from "../guidance/fixtures";
import { MetricTile } from "./MetricTile";

describe("MetricTile plain line (PlainFigure)", () => {
  it("adds the plain-words line under the figure and keeps the caption and provenance tooltip", () => {
    render(
      <MetricTile
        label="Runway"
        value="7 mo"
        plain="How many months your cash lasts at today's spending."
        caption="Cash-flow positive since May"
        estimate="estimate"
        provenance={{ source: "Bank balance and the last 90 days of spending" }}
      />,
    );
    const line = document.querySelector("[data-plain-line]") as HTMLElement;
    expect(line.textContent).toBe("How many months your cash lasts at today's spending.");
    const figure = document.querySelector("[data-value='7 mo']") as HTMLElement;
    expect(line.compareDocumentPosition(figure) & Node.DOCUMENT_POSITION_PRECEDING).toBeTruthy();
    const caption = document.querySelector("[data-metric-caption]") as HTMLElement;
    expect(line.compareDocumentPosition(caption) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.getByRole("button", { name: /Where this number comes from/ })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Estimate" })).toBeTruthy();
  });

  it("reads the line from the definitions map by metricId, and shows the figure alone with guidance off", () => {
    const { rerender } = render(
      <GuidanceProvider value={{ terms: FIXTURE_TERMS }}>
        <MetricTile label="Runway" value="7 mo" metricId="runway" />
      </GuidanceProvider>,
    );
    expect(document.querySelector("[data-plain-line]")?.textContent).toBe(FIXTURE_TERMS.runway!.short);
    rerender(
      <GuidanceProvider value={{ guidance: "off", terms: FIXTURE_TERMS }}>
        <MetricTile label="Runway" value="7 mo" metricId="runway" plain="Months of cash left." />
      </GuidanceProvider>,
    );
    expect(document.querySelector("[data-plain-line]")).toBeNull();
    expect(document.querySelector("[data-value='7 mo']")).not.toBeNull();
  });
});
