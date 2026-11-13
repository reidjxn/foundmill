import { describe, expect, it, vi } from "vitest";
import { fireEvent, render as rtlRender, screen, within } from "@testing-library/react";
import type { ReactElement } from "react";
import { BuilderViewProvider } from "../guidance/BuilderView";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { GuidanceProvider } from "../guidance/GuidanceProvider";
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

/** Builder view on for every render here (the engine these tests read); BuilderView.test.tsx covers it off. */
const render = (ui: ReactElement, opts?: Parameters<typeof rtlRender>[1]) => rtlRender(ui, { wrapper: ({ children }) => <BuilderViewProvider on>{children}</BuilderViewProvider>, ...opts });

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
    // Read as words beside the glyphs (screen-reader text), not as aria-labels on role-less spans.
    const deltas = Array.from(document.querySelectorAll("[data-skill-delta]")).map((d) => d.textContent);
    expect(deltas.filter((t) => t === "▲Up 2")).toHaveLength(2); // API design, Reliability
    expect(deltas).toContain("▼Down 3");
    expect(document.querySelectorAll("[data-skill-delta][aria-label]")).toHaveLength(0);
    expect(screen.getAllByText("Drop")).toHaveLength(2); // drops > 1 point: Debugging −2, Cost efficiency −3
    expect(skillHoverText(BACKEND_SKILLS[0]!)).toBe(
      "Tested 14 · Proven 16 · 45 tasks · Potential 18",
    );
    // Every figure carries its band word as a ScaleLabel pill (comfortable), on the 1–20 scale.
    const bands = Array.from(document.querySelectorAll("[data-skill-band]"));
    expect(bands).toHaveLength(BACKEND_SKILLS.length);
    expect(bands.every((b) => b.hasAttribute("data-scale-label") && b.getAttribute("data-scale") === "20" && b.className.includes("chip-plate"))).toBe(true);
    expect(document.querySelector("[data-skill='comm'] [data-skill-band]")?.textContent).toBe("Poor");
  });

  it("compact density folds the band word into the figure's tooltip and accessible name", () => {
    render(<SkillGrid skills={BACKEND_SKILLS} density="compact" />);
    expect(document.querySelectorAll("[data-skill-band]")).toHaveLength(0);
    const figure = document.querySelector("[data-skill='comm'] [data-rating-figure]") as HTMLElement;
    expect(figure.getAttribute("title")).toBe("4 of 20 · Poor");
    expect(figure.getAttribute("aria-label")).toBe("4 of 20, Poor");
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
  it("renders every attribute with a bar, figure, band word and provenance chip where the evidence is not real", () => {
    render(<AttributeBars attributes={CONCEPT_ATTRIBUTES} columns={2} />);
    expect(screen.getAllByRole("img")).toHaveLength(CONCEPT_ATTRIBUTES.length);
    expect(screen.getAllByText("Estimate")).toHaveLength(2);
    expect(screen.getAllByText("Forecast")).toHaveLength(1);
    expect(
      screen.getByRole("img", { name: /Founder fit: 18 of 20, Excellent, compared with 9/ }),
    ).toBeTruthy();
    // Every figure carries its word (ScaleLabel, compact): 18 reads Excellent, 6 reads Average.
    const bands = Array.from(document.querySelectorAll("[data-scale-label]"));
    expect(bands).toHaveLength(CONCEPT_ATTRIBUTES.length);
    expect(bands.every((b) => !b.className.includes("chip-plate"))).toBe(true);
    expect(document.querySelector("[data-attribute='fit'] [data-scale-label]")?.textContent).toBe("Excellent");
    expect(document.querySelector("[data-attribute='moat'] [data-scale-label]")?.textContent).toBe("Average");
    const { container: bare } = render(<AttributeBars attributes={CONCEPT_ATTRIBUTES.slice(0, 2)} showBand={false} />);
    expect(bare.querySelectorAll("[data-scale-label]")).toHaveLength(0);
  });

  it("defines a labelled attribute as a Term on its label (the definition card on focus, kept with guidance off), with or without evidence (A6)", async () => {
    const user = userEvent.setup();
    render(
      <GuidanceProvider value={{ guidance: "off" }}>
        <AttributeBars attributes={CONCEPT_ATTRIBUTES} />
      </GuidanceProvider>,
    );
    const hinted = CONCEPT_ATTRIBUTES.filter((a) => a.hint);
    const terms = document.querySelectorAll("[data-term^='attribute:']");
    expect(terms).toHaveLength(hinted.length);
    // The definition is information, so the dotted learn underline stays even with guidance off (`always`).
    expect(Array.from(terms).every((t) => t.className.includes("term-link"))).toBe(true);
    // "Channel access" carries a hint and no evidence: the label is still a focusable trigger. The card opens when a
    // key brings focus to it (the Tab, then the focus it causes), never on a script's focus (guidance/keyboardFocus.ts).
    const channel = screen.getByRole("button", { name: "Channel access" });
    fireEvent.keyDown(document.body, { key: "Tab" });
    channel.focus();
    expect(document.activeElement).toBe(channel);
    const short = (await screen.findAllByText(/How clear the path to the first customers is/, {}, { timeout: 2000 }))[0]!;
    expect(short.closest("[data-definition-card]")).not.toBeNull();
    expect(screen.getByText("Channel access", { selector: "[data-definition-card] p" }).className).toContain("t-display-sm");
    // A row without a hint keeps its plain label and its title.
    expect(screen.queryByRole("button", { name: "Timing" })).toBeNull();
    expect(screen.getByTitle("Timing")).toBeTruthy();
    await user.keyboard("{Escape}");
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
    const hunks = screen.getAllByRole("region", { name: /^Change \d+$/ });
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
    const editor = screen.getByRole("textbox", { name: "Edit this change" });
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
    // The change is read as words and figure, never as an aria-label on a role-less span (which readers ignore).
    const delta = screen.getByText("vs last month").closest("[data-delta]")!;
    expect(delta.getAttribute("data-tone")).toBe("bad");
    expect(delta.textContent).toBe("down 0.6vs last month");
    expect(delta.querySelector(".sr-only")?.textContent).toBe("down ");
    expect(delta.hasAttribute("aria-label")).toBe(false);
    expect(delta.querySelectorAll("[aria-hidden=true]:not(svg)")).toHaveLength(0);
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
  it("StatusStrip keeps its single row, and wraps two to a row below `page-wide` only when asked (phone mode)", () => {
    const tiles = Array.from({ length: 3 }, (_, i) => ({ label: `Tile ${i}`, value: i }));
    const { container, rerender } = render(<StatusStrip tiles={tiles} />);
    const strip = () => container.querySelector("[data-status-strip]") as HTMLElement;
    expect(strip().style.gridTemplateColumns).toBe("repeat(3, minmax(0, 1fr))");
    expect(strip().className).not.toContain("grid-cols-2");
    expect(strip().hasAttribute("data-wrap")).toBe(false);
    rerender(<StatusStrip tiles={tiles} wrap />);
    expect(strip().className).toContain("grid-cols-2");
    expect(strip().className).toContain("@page-wide:");
    expect(strip().style.getPropertyValue("--strip-columns")).toBe("repeat(3, minmax(0, 1fr))");
    expect(strip().hasAttribute("data-wrap")).toBe(true);
    // The odd last tile takes the whole row; the third starts a new row under a hairline.
    const items = screen.getAllByRole("listitem");
    expect(items[2]!.className).toContain("@max-page-wide:col-span-2");
    expect(items[2]!.className).toContain("@max-page-wide:border-t");
    expect(items[1]!.className).not.toContain("col-span-2");
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
    // Two tile buttons, the provenance button, and the Estimate chip (a focusable word with its definition, guidance D3).
    expect(screen.getAllByRole("button")).toHaveLength(4);
    fireEvent.click(screen.getByRole("button", { name: "Estimate" }));
    expect(opened).toEqual(["cash", "runway"]);
  });
  it("a clickable tile's name carries its change, and its info button is a 24 px target", () => {
    render(<StatusStrip tiles={[{ label: "Customers this week", value: 55, delta: { value: 19, label: "vs last week" }, provenance: { source: "Payments" }, onClick: () => {} }]} />);
    expect(screen.getByRole("button", { name: "Customers this week 55, up 19 vs last week" })).toBeTruthy();
    const info = screen.getByRole("button", { name: /Where this number comes from/ });
    expect(info.className).toContain("size-target");
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
