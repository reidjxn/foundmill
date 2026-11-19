import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Flag } from "lucide-react";
import { Chip, DeptChip, ESTIMATE_LEGEND, EstimateLegend, ProvenanceChip, hasFixedHeight } from "./Chip";

const chipOf = (text: string) => screen.getByText(text).closest("[data-tone]") as HTMLElement;

describe("Chip", () => {
  it("is 22 px, 6 px round, sentence-case Inter 500 12 on a 3.5 % plate with a hairline ring", () => {
    render(<Chip>Organisations</Chip>);
    const c = chipOf("Organisations");
    expect(c.className).toContain("min-h-chip");
    expect(c.className).toContain("rounded-sm");
    expect(c.className).toContain("chip-plate");
    expect(c.className).toContain("text-label");
    expect(c.className).not.toMatch(/\buppercase\b/);
  });
  it("never truncates by default: the words wrap and the chip grows", () => {
    render(<Chip>Retail Partnerships</Chip>);
    const label = screen.getByText("Retail Partnerships");
    expect(label.className).toContain("break-words");
    expect(label.className).not.toContain("truncate");
  });
  it("fits a tight cell with fit", () => {
    render(<Chip fit>Organisations</Chip>);
    expect(chipOf("Organisations").querySelector("[data-fit-box]")).not.toBeNull();
  });
  it("tints a tone: the 12 % fill and 30 % ring read --tone, with an icon and the word", () => {
    render(
      <Chip tone="dept-3" icon={Flag}>
        Milestone
      </Chip>,
    );
    const c = chipOf("Milestone");
    expect(c.className).toContain("chip-tone");
    expect(c.className).toContain("tone-dept-3");
    expect(c.className).toContain("text-dept-3");
    expect(c.querySelector("svg")).not.toBeNull();
  });
  it("keeps a caller's fixed height (dense charts)", () => {
    render(<Chip className="h-badge px-1 text-micro">claude-sonnet</Chip>);
    const c = chipOf("claude-sonnet");
    expect(c.className).toContain("h-badge");
    expect(c.className).not.toContain("min-h-chip");
    expect(hasFixedHeight("h-badge")).toBe(true);
    expect(hasFixedHeight("h-auto w-4")).toBe(false);
  });
  it("is a toggle button when interactive, and shows selection with aria-pressed", async () => {
    const onClick = vi.fn();
    render(
      <Chip onClick={onClick} selected>
        This week
      </Chip>,
    );
    const b = screen.getByRole("button", { name: "This week" });
    expect(b.getAttribute("aria-pressed")).toBe("true");
    await userEvent.click(b);
    expect(onClick).toHaveBeenCalledTimes(1);
  });
  it("has a labelled remove control", async () => {
    const onRemove = vi.fn();
    render(
      <Chip onRemove={onRemove} removeLabel="Remove Nordics">
        Nordics
      </Chip>,
    );
    await userEvent.click(screen.getByRole("button", { name: "Remove Nordics" }));
    expect(onRemove).toHaveBeenCalledTimes(1);
  });
  it("a pressable chip is at least 24 px tall, and its remove glyph reaches 24 px (WCAG 2.5.8, WP-10 T7)", () => {
    render(
      <>
        <Chip onClick={() => undefined}>This week</Chip>
        <Chip onRemove={() => undefined} removeLabel="Remove Nordics">
          Nordics
        </Chip>
      </>,
    );
    expect(screen.getByRole("button", { name: "This week" }).className).toContain("min-h-target");
    expect(screen.getByRole("button", { name: "Remove Nordics" }).className).toContain("hit-target");
    // The chip holding a remove glyph is 24 px tall too, so the glyph's hit area stays inside it (no-clip).
    expect(screen.getByRole("button", { name: "Remove Nordics" }).parentElement!.className).toContain("min-h-target");
  });
});

describe("DeptChip", () => {
  it("is a neutral chip with the department's glowing dot", () => {
    render(<DeptChip dept="dept-4">Finance</DeptChip>);
    const c = chipOf("Finance");
    expect(c.getAttribute("data-dept")).toBe("dept-4");
    expect(c.className).toContain("chip-plate");
    expect(c.className).toContain("tone-dept-4");
    expect(c.querySelector("[data-chip-dot]")?.className).toContain("chip-dot");
  });
});

describe("ProvenanceChip", () => {
  it("draws a figure in the one estimate style, with the word as its tooltip and the end of its name (WP-14 T7)", async () => {
    render(<ProvenanceChip kind="forecast">£48,200</ProvenanceChip>);
    const figure = screen.getByRole("button", { name: "£48,200 Forecast" });
    expect(figure.className).toContain("est-fig");
    expect(figure.className).not.toContain("est-chip");
    expect(figure.getAttribute("data-provenance")).toBe("forecast");
    expect(figure.getAttribute("data-appearance")).toBe("figure");
    expect(figure.getAttribute("title")).toBeNull();
    // The word is not drawn beside the figure: it is there for a screen reader, and on hover and focus.
    expect(screen.getByText("Forecast").className).toContain("sr-only");
    fireEvent.keyDown(document.body, { key: "Tab" });
    figure.focus();
    expect((await screen.findByRole("tooltip")).textContent).toBe("Forecast: a projected value, not a measurement.");
  });
  it("with no figure, is the word in full in the same style, its meaning a real tooltip (no native title)", async () => {
    render(<ProvenanceChip kind="estimate" />);
    const word = screen.getByText("Estimate");
    const chip = word.closest("[data-provenance]") as HTMLElement;
    expect(chip.className).toContain("est-chip");
    expect(word.className).not.toContain("sr-only");
    expect(chip.getAttribute("data-provenance")).toBe("estimate");
    expect(chip.getAttribute("title")).toBeNull();
    expect(chip.tagName).toBe("BUTTON");
    expect(chip.querySelector("svg")).toBeNull();
    // Focus opens the tip only when a key brought it (guidance/keyboardFocus.ts): the Tab, then the focus it causes.
    fireEvent.keyDown(document.body, { key: "Tab" });
    chip.focus();
    expect((await screen.findByRole("tooltip")).textContent).toMatch(/^Estimate: .*not a measurement/);
    render(<ProvenanceChip kind="forecast" showIcon />);
    expect(screen.getByText("Forecast").closest("[data-provenance]")?.querySelector("svg")).not.toBeNull();
  });
  it("is the word alone in text-3 inside reading prose", () => {
    render(<ProvenanceChip kind="forecast" appearance="word" />);
    const el = screen.getByRole("button", { name: "Forecast" });
    expect(el.className).toContain("text-tertiary");
    expect(el.className).toContain("est-fig");
    expect(el.className).not.toContain("est-chip");
  });
  it("every form names its word for a screen reader", () => {
    render(
      <>
        <ProvenanceChip kind="estimate">11.4 mo</ProvenanceChip>
        <ProvenanceChip kind="forecast">
          <span>£48,200</span>
        </ProvenanceChip>
        <ProvenanceChip kind="estimate" />
        <ProvenanceChip kind="forecast" appearance="word" />
      </>,
    );
    const all = [...document.querySelectorAll("[data-provenance]")];
    expect(all).toHaveLength(4);
    for (const el of all) expect(el.textContent).toMatch(/Estimate|Forecast/);
    expect(screen.getAllByRole("button").map((b) => b.textContent)).toEqual(["11.4 mo Estimate", "£48,200 Forecast", "Estimate", "Forecast"]);
  });
});

describe("EstimateLegend", () => {
  it("is the one legend sentence, its first words drawn in the estimate style", () => {
    render(<EstimateLegend />);
    const line = document.querySelector("[data-estimate-legend]") as HTMLElement;
    expect(line.textContent).toBe("Numbers in this style are your team's estimates. Everything else is measured.");
    expect(line.textContent).toBe(ESTIMATE_LEGEND);
    expect(screen.getByText("Numbers in this style").className).toContain("est-fig");
    // The sample is not an estimate itself: it must not make the shell's legend show.
    expect(line.querySelector("[data-provenance]")).toBeNull();
  });
});
