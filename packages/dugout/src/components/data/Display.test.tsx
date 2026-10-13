import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { AttributeBars } from "./AttributeBars";
import { DiffView } from "./DiffView";
import { KeyValueList, MiniTable, Timeline } from "./Lists";
import { deltaTone, formatMetricValue, MetricTile, StatusStrip } from "./MetricTile";
import { RatingBar } from "./RatingBar";
import { SkillGrid, skillHoverText, toggleFocus } from "./SkillGrid";
import {
  BACKEND_SKILLS,
  CONCEPT_ATTRIBUTES,
  FIXTURE_NOW,
  SPEC_BASE,
  SPEC_ORIGINAL,
  SPEC_PROPOSED,
} from "./fixtures";
import type { HunkDecisions } from "./diff";

describe("RatingBar", () => {
  it("draws 20 cells, fills the value in the ramp tone and names the band", () => {
    render(<RatingBar value={14} name="Planning" />);
    const bar = screen.getByRole("img", { name: "Planning: 14 of 20, Good" });
    expect(bar.getAttribute("data-tone")).toBe("rating-3");
    const cells = bar.querySelectorAll("span");
    expect(cells).toHaveLength(20);
    expect(Array.from(cells).filter((c) => c.className.includes("bg-rating-3"))).toHaveLength(14);
    expect(Array.from(cells).filter((c) => c.className.includes("cell-lit"))).toHaveLength(14);
    expect(Array.from(cells).filter((c) => c.className.includes("cell-empty"))).toHaveLength(6);
  });
  it("outlines the comparison cells beyond the value", () => {
    render(<RatingBar value={10} compare={15} />);
    const cells = screen.getByRole("img").querySelectorAll("span");
    expect(Array.from(cells).filter((c) => c.className.includes("border-rating-3"))).toHaveLength(
      5,
    );
  });
});

describe("SkillGrid", () => {
  it("lays skills out in Craft / Judgement / Execution with values, bars and deltas", () => {
    render(<SkillGrid skills={BACKEND_SKILLS} />);
    expect(screen.getByRole("heading", { name: "Craft" })).toBeTruthy();
    expect(
      within(screen.getByRole("region", { name: "Craft" })).getAllByRole("listitem"),
    ).toHaveLength(6);
    expect(
      within(screen.getByRole("region", { name: "Execution" })).getAllByRole("listitem"),
    ).toHaveLength(5);
    expect(screen.getAllByLabelText("Up 2")).toHaveLength(2); // API design, Reliability
    expect(screen.getByLabelText("Down 3")).toBeTruthy();
    expect(screen.getAllByText("Drop")).toHaveLength(2); // drops > 1 point: Debugging −2, Cost efficiency −3
    expect(skillHoverText(BACKEND_SKILLS[0]!)).toBe(
      "Tested 14 · Proven 16 · 45 tasks · Potential 18",
    );
  });
  it("focus mode allows at most three skills", async () => {
    const user = userEvent.setup();
    function Harness() {
      const [sel, setSel] = useState<string[]>([]);
      return <SkillGrid skills={BACKEND_SKILLS} focus={{ selected: sel, onChange: setSel }} />;
    }
    render(<Harness />);
    for (const name of ["API design", "Testing", "Planning"])
      await user.click(screen.getByRole("checkbox", { name: `Focus on ${name}` }));
    expect(screen.getByText(/Focus: 3 of 3/)).toBeTruthy();
    const fourth = screen.getByRole("checkbox", { name: "Focus on Speed" });
    expect(fourth.hasAttribute("disabled")).toBe(true);
    await user.click(screen.getByRole("checkbox", { name: "Focus on Testing" }));
    expect(screen.getByText(/Focus: 2 of 3/)).toBeTruthy();
    expect(toggleFocus(["a", "b", "c"], "d")).toEqual(["a", "b", "c"]);
    expect(toggleFocus(["a", "b", "c"], "b")).toEqual(["a", "c"]);
  });
});

describe("AttributeBars", () => {
  it("renders every attribute with a bar, figure and provenance chip where the evidence is not real", () => {
    render(<AttributeBars attributes={CONCEPT_ATTRIBUTES} columns={2} />);
    expect(screen.getAllByRole("img")).toHaveLength(CONCEPT_ATTRIBUTES.length);
    expect(screen.getAllByText("Estimate")).toHaveLength(2);
    expect(screen.getAllByText("Forecast")).toHaveLength(1);
    expect(
      screen.getByRole("img", { name: /Founder fit: 18 of 20, Excellent, compared with 9/ }),
    ).toBeTruthy();
  });
});

describe("DiffView", () => {
  it("renders hunks inline with controls, and accept / reject / edit report merged text", async () => {
    const user = userEvent.setup();
    const onDecision = vi.fn();
    function Harness() {
      const [d, setD] = useState<HunkDecisions>({});
      return (
        <DiffView
          original={SPEC_ORIGINAL}
          proposed={SPEC_PROPOSED}
          contextLines={1}
          decisions={d}
          onDecision={(id, s, merged) => {
            setD((prev) => ({ ...prev, [id]: s }));
            onDecision(id, s, merged);
          }}
        />
      );
    }
    render(<Harness />);
    const hunks = screen.getAllByRole("region", { name: /^Hunk/ });
    expect(hunks).toHaveLength(2);
    expect(screen.getByText("+5")).toBeTruthy();
    expect(screen.getByText("−3")).toBeTruthy();
    await user.click(within(hunks[0]!).getByRole("button", { name: "Accept" }));
    expect(onDecision).toHaveBeenLastCalledWith(
      "h0",
      { decision: "accepted" },
      expect.stringContaining("Retail price €42"),
    );
    expect(hunks[0]?.getAttribute("data-decision")).toBe("accepted");
    await user.click(within(hunks[1]!).getByRole("button", { name: "Reject" }));
    const merged = onDecision.mock.calls.at(-1)?.[2] as string;
    expect(merged).toContain("Retail price €42");
    expect(merged).not.toContain("CPNP");
    expect(screen.getByText(/1 accepted, 1 rejected, 0 pending/)).toBeTruthy();
    await user.click(within(hunks[1]!).getByRole("button", { name: "Edit" }));
    const editor = screen.getByRole("textbox", { name: "Edit this hunk" });
    await user.clear(editor);
    await user.type(
      editor,
      "Glass bottle with pump, recyclable carton.{enter}Label printed in Sweden.{enter}Carton carries a QR code.",
    );
    await user.click(screen.getByRole("button", { name: "Use this text" }));
    expect(onDecision.mock.calls.at(-1)?.[1]).toMatchObject({ decision: "edited" });
    expect(onDecision.mock.calls.at(-1)?.[2]).toContain("QR code");
    expect(hunks[1]?.getAttribute("data-decision")).toBe("edited");
  });
  it("switches to side by side and shows a three-way view with conflicts when a base is given", async () => {
    const user = userEvent.setup();
    const { rerender } = render(<DiffView original={SPEC_ORIGINAL} proposed={SPEC_PROPOSED} />);
    await user.click(screen.getByRole("radio", { name: "Side by side" }));
    expect(document.querySelector("[data-diff-view]")?.getAttribute("data-mode")).toBe(
      "side-by-side",
    );
    expect(screen.getAllByText("Current").length).toBeGreaterThan(0);
    rerender(<DiffView original="a\nB1\nc" proposed="a\nB2\nc" base="a\nb\nc" />);
    expect(screen.getByText("Conflict")).toBeTruthy();
    expect(screen.getByText("Base")).toBeTruthy();
    rerender(<DiffView original={SPEC_ORIGINAL} proposed={SPEC_PROPOSED} base={SPEC_BASE} />);
    expect(screen.queryByText("Conflict")).toBeNull();
    expect(screen.getAllByText(/changed/).length).toBeGreaterThan(0);
  });
});

describe("MetricTile and StatusStrip", () => {
  it("formats values and tones deltas by direction", () => {
    expect(formatMetricValue(1234567)).toBe("1.2M");
    expect(formatMetricValue(0.125, "percent")).toBe("13%");
    expect(formatMetricValue({ amountMinor: 184000, currency: "EUR" })).toBe("€1,840.00");
    expect(formatMetricValue(null)).toBe("—");
    expect(deltaTone({ value: 3 })).toBe("good");
    expect(deltaTone({ value: 3, goodWhen: "down" })).toBe("bad");
    expect(deltaTone({ value: 0 })).toBe("neutral");
  });
  it("renders the label, number, delta with arrow, estimate chip and provenance", () => {
    render(
      <MetricTile
        label="Runway"
        value={11.4}
        format="decimal"
        unit="mo"
        delta={{ value: -0.6, label: "vs last month", goodWhen: "up" }}
        estimate="forecast"
        provenance={{ source: "Finance forecast", query: "runway_months" }}
        spark={[12, 12.4, 11.9, 11.4]}
      />,
    );
    expect(screen.getByText("Runway")).toBeTruthy();
    expect(screen.getByText("11.4")).toBeTruthy();
    expect(screen.getByLabelText("down 0.6 vs last month").getAttribute("data-tone")).toBe("bad");
    expect(screen.getByText("Forecast")).toBeTruthy();
    expect(
      screen.getByRole("button", { name: /Where this number comes from: Finance forecast/ }),
    ).toBeTruthy();
    expect(screen.getByRole("img", { name: /4 points/ })).toBeTruthy();
  });
  it("StatusStrip shows at most six tiles", () => {
    const tiles = Array.from({ length: 8 }, (_, i) => ({ label: `Tile ${i}`, value: i }));
    render(<StatusStrip tiles={tiles} />);
    expect(screen.getAllByRole("listitem")).toHaveLength(6);
  });
  it("a clickable tile is a list item holding one button beside its provenance button, never around it", () => {
    const opened: string[] = [];
    const { container } = render(
      <StatusStrip
        tiles={[
          { label: "Cash", value: { amountMinor: 184000, currency: "EUR" }, provenance: { source: "Bank balances" }, onClick: () => opened.push("cash") },
          { label: "Runway", value: 11.4, format: "decimal", estimate: "estimate", onClick: () => opened.push("runway") },
          { label: "Plain", value: 3 },
        ]}
      />,
    );
    expect(container.querySelectorAll("button button")).toHaveLength(0);
    expect(screen.getAllByRole("listitem")).toHaveLength(3);
    const cash = screen.getByRole("button", { name: "Cash €1,840.00" });
    fireEvent.click(cash);
    fireEvent.click(screen.getByRole("button", { name: "Runway 11.4" }));
    expect(opened).toEqual(["cash", "runway"]);
    // The provenance button is its own control: opening it does not open the tile.
    fireEvent.click(screen.getByRole("button", { name: /Where this number comes from: Bank balances/ }));
    expect(opened).toEqual(["cash", "runway"]);
    expect(screen.getAllByRole("button")).toHaveLength(3);
  });
});

describe("Lists", () => {
  it("Timeline orders newest first by default and formats relative times", () => {
    const events = [
      {
        id: "a",
        at: new Date(FIXTURE_NOW.getTime() - 3_600_000),
        title: "Scout emailed Sara",
        tone: "info" as const,
      },
      {
        id: "b",
        at: new Date(FIXTURE_NOW.getTime() - 60_000),
        title: "Sara replied",
        tone: "good" as const,
        statusWord: "Replied",
      },
    ];
    render(<Timeline events={events} now={FIXTURE_NOW} />);
    const items = screen.getAllByRole("listitem");
    expect(items[0]?.textContent).toContain("Sara replied");
    expect(items[0]?.textContent).toContain("1 min ago");
    expect(items[1]?.textContent).toContain("1 hr ago");
    expect(within(items[0]!).getByText("Replied")).toBeTruthy();
  });
  it("MiniTable caps rows with a +N more line and highlights a row", () => {
    const rows = [
      { n: "A", v: 1 },
      { n: "B", v: 2 },
      { n: "C", v: 3 },
    ];
    render(
      <MiniTable
        aria-label="Exhibit"
        columns={[
          { id: "n", header: "Name", cell: (r) => r.n },
          { id: "v", header: "Value", cell: (r) => r.v, numeric: true },
        ]}
        rows={rows}
        maxRows={2}
        highlight={(r) => r.n === "B"}
        caption="Estimate"
      />,
    );
    const table = screen.getByRole("table", { name: "Exhibit" });
    expect(within(table).getAllByRole("row")).toHaveLength(3);
    expect(screen.getByText("+1 more")).toBeTruthy();
    expect(within(table).getAllByRole("row")[2]?.getAttribute("data-highlight")).toBe("true");
  });
  it("KeyValueList renders label/value pairs", () => {
    render(
      <KeyValueList
        items={[
          { label: "Lead time", value: "12 days" },
          { label: "MOQ", value: 1000, numeric: true, hint: "units" },
        ]}
      />,
    );
    expect(screen.getByText("Lead time")).toBeTruthy();
    expect(screen.getByText("units")).toBeTruthy();
  });
  it("KeyValueList rows put a numeric value's hint on its own wrapping line, outside the nowrap value", () => {
    const hint = "Harbor Angels Syndicate: 697,264 shares at the round price · Beacon Ventures: 1,312,498 shares at the discount";
    render(<KeyValueList layout="rows" items={[{ label: "SAFE shares", value: "2,009,762", numeric: true, hint }]} />);
    const hintEl = screen.getByText(hint);
    expect(hintEl.tagName).toBe("DD");
    expect(hintEl.className).toContain("break-words");
    expect(hintEl.className).not.toContain("whitespace-nowrap");
    expect(hintEl.parentElement?.className).toContain("flex-wrap");
    // the value's own cell stays nowrap and holds only the value
    expect(screen.getByText("2,009,762").closest("dd")?.className).toContain("whitespace-nowrap");
  });
});
