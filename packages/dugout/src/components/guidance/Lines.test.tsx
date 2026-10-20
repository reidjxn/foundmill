import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { renderToStaticMarkup } from "react-dom/server";
import { scaleCaption, toRating20 } from "../../lib/rating";
import { ConsequenceLine, consequenceParts, consequenceText } from "./ConsequenceLine";
import { GuidanceProvider } from "./GuidanceProvider";
import { PlainFigure } from "./PlainFigure";
import { ReassuranceLine } from "./ReassuranceLine";
import { FormKey, ScaleLabel, formKeySentence, scaleWord } from "./ScaleLabel";
import { FIXTURE_TERMS } from "./fixtures";

describe("ConsequenceLine", () => {
  it("joins the known parts and leaves the unknown out, never writing unknown", () => {
    expect(consequenceText({ cost: "€500.00 (Estimate)", reversible: false, consequence: "Stock-out risk in November." })).toBe("Stock-out risk in November. · €500.00 (Estimate) · Not reversible");
    expect(consequenceText({ cost: "No cost", reversible: true })).toBe("No cost · Reversible");
    expect(consequenceText({ consequence: "Pauses every agent." })).toBe("Pauses every agent.");
    expect(consequenceText({})).toBeUndefined();
    expect(consequenceParts({ cost: null, reversible: null, consequence: "" })).toEqual([]);
    expect(consequenceText({ reversible: undefined, cost: undefined, consequence: "Pauses every agent." })).not.toMatch(/unknown/i);
  });

  it("is a small secondary line with the warning triangle only when not reversible, and is always shown", () => {
    const { rerender } = render(
      <GuidanceProvider value={{ guidance: "off" }}>
        <ConsequenceLine cost="€500.00 (Estimate)" reversible={false} consequence="Stock-out risk in November." />
      </GuidanceProvider>,
    );
    const line = document.querySelector("[data-consequence]") as HTMLElement;
    expect(line.className).toContain("text-small");
    expect(line.className).toContain("text-secondary");
    expect(line.textContent).toContain("Stock-out risk in November.");
    expect(line.textContent).toContain("€500.00 (Estimate)");
    expect(line.textContent).toContain("Not reversible");
    expect(line.querySelector("[data-consequence-reversible='false'] svg")).not.toBeNull();
    rerender(<ConsequenceLine cost="No cost" reversible />);
    expect(screen.getByText("Reversible").querySelector("svg")).toBeNull();
    rerender(<ConsequenceLine />);
    expect(document.querySelector("[data-consequence]")).toBeNull();
  });

  it("renders on the server", () => {
    expect(renderToStaticMarkup(<ConsequenceLine cost="No cost" reversible />)).toContain("Reversible");
  });
});

describe("ReassuranceLine", () => {
  it("is small tertiary text with a 14 px Undo2 or Settings icon, hidden when guidance is off", () => {
    const { rerender } = render(<ReassuranceLine>You can change this later in Settings › Business.</ReassuranceLine>);
    let line = document.querySelector("[data-reassurance]") as HTMLElement;
    expect(line.className).toContain("text-small");
    expect(line.className).toContain("text-tertiary");
    expect(line.getAttribute("data-reassurance")).toBe("undo");
    expect(line.querySelector("svg")?.getAttribute("width")).toBe("14");
    rerender(<ReassuranceLine icon="settings">Change it any time in Settings › Preferences.</ReassuranceLine>);
    line = document.querySelector("[data-reassurance]") as HTMLElement;
    expect(line.getAttribute("data-reassurance")).toBe("settings");
    rerender(
      <GuidanceProvider value={{ guidance: "off" }}>
        <ReassuranceLine>You can change this later.</ReassuranceLine>
      </GuidanceProvider>,
    );
    expect(document.querySelector("[data-reassurance]")).toBeNull();
  });
});

describe("PlainFigure", () => {
  it("adds the definition's short line under the figure, or an explicit plain line", () => {
    const { rerender } = render(
      <GuidanceProvider value={{ terms: FIXTURE_TERMS }}>
        <PlainFigure metricId="runway">
          <span data-testid="figure">7 mo</span>
        </PlainFigure>
      </GuidanceProvider>,
    );
    const line = document.querySelector("[data-plain-line]") as HTMLElement;
    expect(line.textContent).toBe(FIXTURE_TERMS.runway!.short);
    expect(line.className).toContain("text-small");
    expect(line.className).toContain("text-secondary");
    expect(line.previousElementSibling?.getAttribute("data-testid")).toBe("figure");
    rerender(
      <GuidanceProvider value={{ terms: FIXTURE_TERMS }}>
        <PlainFigure metricId="runway" plain="Months of cash left.">
          <span>7 mo</span>
        </PlainFigure>
      </GuidanceProvider>,
    );
    expect(document.querySelector("[data-plain-line]")?.textContent).toBe("Months of cash left.");
  });

  it("is the figure alone, unwrapped, with guidance off or nothing to say", () => {
    const { rerender } = render(
      <GuidanceProvider value={{ guidance: "off", terms: FIXTURE_TERMS }}>
        <PlainFigure metricId="runway">
          <span data-testid="figure">7 mo</span>
        </PlainFigure>
      </GuidanceProvider>,
    );
    expect(document.querySelector("[data-plain-figure]")).toBeNull();
    expect(screen.getByTestId("figure").parentElement).toBe(document.body.firstElementChild);
    rerender(
      <PlainFigure metricId="nope">
        <span data-testid="figure">7 mo</span>
      </PlainFigure>,
    );
    expect(document.querySelector("[data-plain-figure]")).toBeNull();
  });
});

describe("ScaleLabel", () => {
  it("maps every scale onto the 1–20 bands and captions them", () => {
    expect(toRating20(13)).toBe(13);
    expect(toRating20(7.5, 10)).toBe(15);
    expect(toRating20(3.5, 5)).toBe(14);
    expect(toRating20(0, 10)).toBe(1);
    expect(toRating20(11, 10)).toBe(20);
    expect(scaleWord(13)).toBe("Good");
    expect(scaleWord(2.4, 10)).toBe("Poor");
    expect(scaleWord(4.5, 5)).toBe("Excellent");
    expect(scaleWord(2.5, 5)).toBe("Average");
    expect(scaleCaption(20)).toBe("/20");
    expect(scaleCaption(10)).toBe("/10");
    expect(scaleCaption(5)).toBe("of 5");
  });

  it.each([
    [3, 20, "Poor", "tone-rating-1"],
    [9, 20, "Average", "tone-rating-2"],
    [6.5, 10, "Good", "tone-rating-3"],
    [4.5, 5, "Excellent", "tone-rating-4"],
  ] as const)("%d on /%d reads %s in a 22 px pill with a dot in the ramp tone", (value, scale, word, tone) => {
    render(<ScaleLabel value={value} scale={scale} />);
    const pill = screen.getByText(word);
    expect(pill.className).toContain(tone);
    expect(pill.className).toContain("min-h-chip");
    expect(pill.className).toContain("rounded-pill");
    expect(pill.getAttribute("data-scale")).toBe(String(scale));
    expect(pill.querySelector(".chip-dot")).not.toBeNull();
  });

  it("drops the plate when compact and stays server-safe", () => {
    render(<ScaleLabel value={17} compact />);
    const word = screen.getByText("Excellent");
    expect(word.className).not.toContain("chip-plate");
    expect(word.className).toContain("text-small");
    expect(word.querySelector(".chip-dot")).not.toBeNull();
    expect(renderToStaticMarkup(<ScaleLabel value={4} />)).toContain("Poor");
  });
});

describe("FormKey", () => {
  it("says the last five tasks in words, fewer when there are fewer, and none when there are none", () => {
    expect(formKeySentence(["success", "success", "partial", "success", "success"])).toBe("Last 5 tasks: 4 went well, 1 partly, 0 failed");
    expect(formKeySentence([null, null, "failure", "success", "partial"])).toBe("Last 3 tasks: 1 went well, 1 partly, 1 failed");
    expect(formKeySentence(["success"])).toBe("Last task: 1 went well, 0 partly, 0 failed");
    expect(formKeySentence([])).toBe("No tasks yet");
    render(<FormKey cells={["success", "failure"]} />);
    expect(screen.getByText("Last 2 tasks: 1 went well, 0 partly, 1 failed").className).toContain("text-small");
  });
});
