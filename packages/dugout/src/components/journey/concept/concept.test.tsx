import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { GuidanceProvider } from "../../guidance/GuidanceProvider";
import { conceptFixtures } from "../fixtures";
import { CONCEPT_ATTRIBUTE_HINTS, CONCEPT_ATTRIBUTE_KEYS, CONCEPT_ATTRIBUTE_LABELS } from "../types";
import { AttributeBar } from "./AttributeBar";
import { ConceptCard, conceptOverall } from "./ConceptCard";
import { compareLeaders, ConceptCompare } from "./ConceptCompare";
import { RadarChart, radarPoint } from "./RadarChart";

const concepts = conceptFixtures();

describe("AttributeBar", () => {
  it("exposes a meter with the value and band, fills the ramp cells and shows evidence on hover", async () => {
    const user = userEvent.setup();
    const { container } = render(<AttributeBar label="Market pull" value={15} evidence={[{ text: "Search volume up 22%", source: "Statista" }]} />);
    const meter = screen.getByRole("meter", { name: "Market pull" });
    expect(meter.getAttribute("aria-valuenow")).toBe("15");
    expect(meter.getAttribute("aria-valuetext")).toContain("Good");
    expect(container.querySelectorAll(".bg-rating-3").length).toBe(15);
    expect(container.querySelectorAll(".cell-empty").length).toBe(5);
    await user.hover(screen.getByText("15"));
    expect(await screen.findByText("Search volume up 22%")).toBeTruthy();
  });
  it("clamps and draws ghost cells for a comparison value", () => {
    const { container } = render(<AttributeBar label="x" value={25} ghost={8} />);
    expect(screen.getByRole("meter").getAttribute("aria-valuenow")).toBe("20");
    expect(container.querySelectorAll(".bg-rating-4").length).toBe(20);
    const { container: c2 } = render(<AttributeBar label="y" value={4} ghost={9} />);
    expect(c2.querySelectorAll(".border-rating-2").length).toBe(5);
  });
  it("explains the attribute and its direction on the label, reachable by keyboard, with or without evidence (A6)", async () => {
    const user = userEvent.setup();
    render(<AttributeBar label="Competition" value={12} hint="How crowded the market is. Higher means less crowded." />);
    // No evidence attached: the label is still a focusable trigger for the definition.
    const label = screen.getByRole("button", { name: "Competition" });
    expect(label.hasAttribute("title")).toBe(false);
    await user.tab();
    expect(document.activeElement).toBe(label);
    expect((await screen.findAllByText("How crowded the market is. Higher means less crowded.")).length).toBeGreaterThan(0);
  });
  it("keeps the label's Term outside the meter and outside the evidence trigger (one focusable control each)", async () => {
    const user = userEvent.setup();
    render(<AttributeBar label="Competition" value={12} hint="How crowded the market is. Higher means less crowded." evidence={[{ text: "Six direct rivals", source: "G2" }]} />);
    const meter = screen.getByRole("meter", { name: "Competition" });
    const label = screen.getByRole("button", { name: "Competition" });
    // Meter children are presentational: the Term must be a sibling, not a descendant.
    expect(meter.contains(label)).toBe(false);
    expect(meter.querySelector("button, a, [tabindex]")).toBeNull();
    // The meter itself opens the evidence; it is the only evidence trigger and it does not wrap the Term.
    const trigger = document.querySelector("[data-evidence-trigger]");
    expect(trigger).toBe(meter);
    expect(meter.getAttribute("tabindex")).toBe("0");
    await user.tab();
    expect(document.activeElement).toBe(label);
    await user.tab();
    expect(document.activeElement).toBe(meter);
    await user.hover(meter);
    expect(await screen.findByText("Six direct rivals")).toBeTruthy();
  });
  it("leaves the meter out of the tab order when no evidence is attached", () => {
    render(<AttributeBar label="Competition" value={12} hint="How crowded the market is. Higher means less crowded." />);
    const meter = screen.getByRole("meter", { name: "Competition" });
    expect(meter.hasAttribute("tabindex")).toBe(false);
    expect(meter.contains(screen.getByRole("button", { name: "Competition" }))).toBe(false);
  });
  it("keeps a plain label when nothing defines the attribute", () => {
    render(<AttributeBar label="Timing" value={12} />);
    expect(screen.queryByRole("button")).toBeNull();
    expect(screen.getByTitle("Timing")).toBeTruthy();
  });
});

describe("ConceptCard", () => {
  it("says under Founder fit what it rests on while that is the quick profile (WP-14 T2)", () => {
    const c = concepts[0]!;
    const fit = c.attributes.find((a) => a.key === "founder_fit")!.value;
    const { rerender } = render(<ConceptCard concept={c} fitBasis="quick" />);
    expect(document.querySelector("[data-concept-fit-basis=quick]")!.textContent).toBe(`Fit: ${fit} (quick profile)`);
    rerender(<ConceptCard concept={c} fitBasis="full" />);
    expect(document.querySelector("[data-concept-fit-basis]")).toBeNull();
    rerender(<ConceptCard concept={c} />);
    expect(document.querySelector("[data-concept-fit-basis]")).toBeNull();
  });

  it("renders logo, stars, ten attributes and fires every action", async () => {
    const user = userEvent.setup();
    const onAction = vi.fn();
    const c = concepts[0]!;
    render(<ConceptCard concept={c} onAction={onAction} />);
    expect(screen.getByRole("article", { name: `${c.name}: concept card` })).toBeTruthy();
    // The name steps down, then wraps to two lines before it is ever cut.
    expect(document.querySelector("h3 [data-fit-box]")?.getAttribute("data-lines")).toBe("2");
    expect(screen.getByRole("img", { name: `${c.name} logo` })).toBeTruthy();
    expect(screen.getByRole("img", { name: /Current ability: 3 of 5, could reach 4.5/ })).toBeTruthy();
    expect(screen.getAllByRole("meter").length).toBe(10);
    expect(conceptOverall(c)).toBe(12);
    // Shortlist, "More like this" (fork) and Ask are on the card; Merge and Discard are in the More menu.
    for (const action of ["shortlist", "fork", "ask"] as const) {
      await user.click(document.querySelector(`[data-concept-action='${action}']`) as HTMLElement);
      expect(onAction).toHaveBeenLastCalledWith(action, c.id);
    }
    expect(screen.getByRole("button", { name: "More like this" })).toBeTruthy();
    for (const action of ["edit", "merge", "discard"] as const) {
      expect(document.querySelector(`[data-concept-action='${action}']`)).toBeNull();
      await user.click(screen.getByRole("button", { name: `More actions for ${c.name}` }));
      await user.click(await screen.findByRole("menuitem", { name: action === "merge" ? "Merge with another" : action === "edit" ? "Edit" : "Discard" }));
      expect(onAction).toHaveBeenLastCalledWith(action, c.id);
    }
  });
  it("says whose words the pitch is: the founder's own, or the sample model's, and nothing when neither applies", () => {
    const c = concepts[0]!;
    const { rerender } = render(<ConceptCard concept={c} />);
    expect(document.querySelector("[data-concept-your-words]")).toBeNull();
    expect(document.querySelector("[data-concept-sample]")).toBeNull();
    rerender(<ConceptCard concept={{ ...c, yourWords: true, sample: true }} />);
    expect(screen.getByText("Your words")).toBeTruthy();
    expect(screen.getByText("Sample")).toBeTruthy();
  });
  it("defines every attribute label with its direction and says 'Version n' in words", () => {
    render(<ConceptCard concept={{ ...concepts[0]!, version: 3 }} />);
    const labels = document.querySelectorAll("[data-attribute-hint]");
    expect(labels).toHaveLength(10);
    for (const key of CONCEPT_ATTRIBUTE_KEYS) expect(screen.getByRole("button", { name: CONCEPT_ATTRIBUTE_LABELS[key] })).toBeTruthy();
    expect(CONCEPT_ATTRIBUTE_HINTS.competition).toMatch(/Higher means less crowded/);
    for (const key of CONCEPT_ATTRIBUTE_KEYS) expect(CONCEPT_ATTRIBUTE_HINTS[key]).toMatch(/Higher means/);
    expect(screen.getByText("Version 3")).toBeTruthy();
    expect(screen.queryByText("v3")).toBeNull();
  });
  it("each attribute label is a dotted Term with its attr_ id, kept with guidance off (the direction is information)", async () => {
    const user = userEvent.setup();
    render(
      <GuidanceProvider value={{ guidance: "off" }}>
        <ConceptCard concept={concepts[0]!} />
      </GuidanceProvider>,
    );
    for (const key of CONCEPT_ATTRIBUTE_KEYS) {
      const trigger = document.querySelector(`[data-attribute-hint] [data-term='attr_${key}']`);
      expect(trigger, key).toBeTruthy();
      expect(trigger!.className).toContain("term-link");
    }
    await user.click(screen.getByRole("button", { name: CONCEPT_ATTRIBUTE_LABELS.competition }));
    expect((await screen.findByText(CONCEPT_ATTRIBUTE_HINTS.competition)).closest("[data-definition-card]")).toBeTruthy();
  });
  it("shows the shortlisted state and the compare toggle", async () => {
    const user = userEvent.setup();
    const onToggle = vi.fn();
    render(<ConceptCard concept={concepts[1]!} shortlisted selected onToggleSelect={onToggle} />);
    expect(screen.getByRole("button", { name: "Shortlisted" }).getAttribute("aria-pressed")).toBe("true");
    await user.click(screen.getByRole("button", { name: `Compare ${concepts[1]!.name}` }));
    expect(onToggle).toHaveBeenCalledWith(concepts[1]!.id);
  });
});

describe("RadarChart", () => {
  it("places the first axis at the top and renders one polygon per series", () => {
    expect(radarPoint(0, 4, 10)).toEqual({ x: expect.closeTo(0, 6), y: -10 });
    expect(radarPoint(1, 4, 10)).toEqual({ x: 10, y: expect.closeTo(0, 6) });
    const { container } = render(<RadarChart label="Radar" axes={[{ key: "a", label: "A" }, { key: "b", label: "B" }, { key: "c", label: "C" }]} series={[{ id: "s1", label: "One", tone: "dept-1", values: [10, 15, 5] }, { id: "s2", label: "Two", tone: "dept-3", values: [20, 2, 12] }]} />);
    expect(container.querySelectorAll("[data-radar-series]").length).toBe(2);
    expect(screen.getByRole("img", { name: /One: A 10, B 15, C 5/ })).toBeTruthy();
    expect(screen.getByRole("list", { name: "Legend" }).textContent).toContain("Two");
    // The top ring's value sits inside the ring (below its line), never up among the first axis's label.
    const max = container.querySelector("[data-radar-max]") as Element;
    const firstLabel = container.querySelector("[data-radar] text title")?.parentNode as Element;
    expect(max.getAttribute("dominant-baseline")).toBe("hanging");
    expect(Number(max.getAttribute("y"))).toBeGreaterThan(Number(firstLabel.getAttribute("y")) + 13);
  });
});

describe("ConceptCompare", () => {
  it("renders for 2, 3 and 4 concepts (AC-11.1.4), marks leaders and refuses fewer than 2", () => {
    for (const n of [2, 3, 4]) {
      const { container, unmount } = render(<ConceptCompare concepts={concepts.slice(0, n)} />);
      expect(container.querySelector("[data-concept-compare]")?.getAttribute("data-concept-compare")).toBe(String(n));
      expect(container.querySelectorAll("[data-compare-row]").length).toBe(10);
      expect(container.querySelectorAll("[data-compare-row='market_pull'] [data-leader]").length).toBe(1);
      expect(container.querySelectorAll("[data-radar-series]").length).toBe(n);
      // The row header defines the attribute too (one focusable label per row).
      expect(container.querySelectorAll("[role='rowheader'] [data-attribute-hint]").length).toBe(10);
      expect(container.querySelectorAll("[role='rowheader'] [data-term^='attr_']").length).toBe(10);
      unmount();
    }
    const leaders = compareLeaders(concepts.slice(0, 2));
    expect(leaders.market_pull).toBe(0);
    expect(leaders.agent_executability).toBe(1);
    render(<ConceptCompare concepts={concepts.slice(0, 1)} />);
    expect(screen.getByRole("status").textContent).toContain("Pick 2 to 4 concepts");
  });
});
