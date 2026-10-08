import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { conceptFixtures } from "../fixtures";
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
    expect(container.querySelectorAll(".bg-panel-alt").length).toBe(5);
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
});

describe("ConceptCard", () => {
  it("renders logo, stars, ten attributes and fires every action", async () => {
    const user = userEvent.setup();
    const onAction = vi.fn();
    const c = concepts[0]!;
    render(<ConceptCard concept={c} onAction={onAction} />);
    expect(screen.getByRole("article", { name: `${c.name}: concept card` })).toBeTruthy();
    expect(screen.getByRole("img", { name: `${c.name} logo` })).toBeTruthy();
    expect(screen.getByRole("img", { name: /Current ability: 3 of 5, potential 4.5/ })).toBeTruthy();
    expect(screen.getAllByRole("meter").length).toBe(10);
    expect(conceptOverall(c)).toBe(12);
    for (const action of ["shortlist", "merge", "fork", "ask", "discard"] as const) {
      await user.click(document.querySelector(`[data-concept-action='${action}']`) as HTMLElement);
      expect(onAction).toHaveBeenLastCalledWith(action, c.id);
    }
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
      unmount();
    }
    const leaders = compareLeaders(concepts.slice(0, 2));
    expect(leaders.market_pull).toBe(0);
    expect(leaders.agent_executability).toBe(1);
    render(<ConceptCompare concepts={concepts.slice(0, 1)} />);
    expect(screen.getByRole("status").textContent).toContain("Pick 2 to 4 concepts");
  });
});
