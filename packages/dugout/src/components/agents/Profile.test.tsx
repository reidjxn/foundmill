import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { DevelopmentChart, chartDomain } from "./DevelopmentChart";
import { HealthBadge, healthSummary } from "./HealthBadge";
import { HierarchyChart, layoutHierarchy } from "./HierarchyChart";
import { mockDevelopmentSeries, mockHierarchy, mockPositionRoles, mockTraits } from "./mock";
import { PositionMap, positionLevelFor } from "./PositionMap";
import { TraitChips } from "./TraitChips";

describe("PositionMap", () => {
  it("tints by level with the word, sorts Natural first and marks the current role", () => {
    const onSelect = vi.fn();
    render(<PositionMap roles={mockPositionRoles()} currentRoleId="frontend" onSelect={onSelect} />);
    const items = within(screen.getByRole("list", { name: "Position map" })).getAllByRole("listitem");
    expect(items[0]!.dataset.level).toBe("natural");
    expect(items[items.length - 1]!.dataset.level).toBe("unconvincing");
    expect(items[0]!.getAttribute("aria-current")).toBe("true");
    fireEvent.click(screen.getByRole("button", { name: "Data engineer: Unconvincing, 5 of 20" }));
    expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({ id: "data" }));
    expect(positionLevelFor(16)).toBe("natural");
    expect(positionLevelFor(11)).toBe("accomplished");
    expect(positionLevelFor(6)).toBe("competent");
    expect(positionLevelFor(5)).toBe("unconvincing");
  });
});

describe("TraitChips", () => {
  it("renders traits and a +N chip", () => {
    render(<TraitChips traits={mockTraits()} max={3} />);
    expect(within(screen.getByRole("list", { name: "Traits" })).getAllByRole("listitem")).toHaveLength(4);
    expect(screen.getByText("+2 more")).toBeTruthy();
    expect(screen.getByText("Writes tests first")).toBeTruthy();
  });
});

describe("DevelopmentChart", () => {
  it("draws one path per series, diamonds per session and a data table", () => {
    const { series, sessions } = mockDevelopmentSeries();
    const { container } = render(<DevelopmentChart series={series} sessions={sessions} dept="dept-2" />);
    expect(container.querySelectorAll("[data-series]")).toHaveLength(3);
    expect(container.querySelectorAll('[data-session="promoted"]')).toHaveLength(2);
    expect(container.querySelectorAll('[data-session="discarded"]')).toHaveLength(1);
    expect(screen.getByRole("table").querySelectorAll("tbody tr")).toHaveLength(3 * 14);
    const [lo, hi] = chartDomain(series, sessions);
    expect(hi.getTime()).toBeGreaterThan(lo.getTime());
    expect(chartDomain([], [])[0].getTime()).toBe(0);
  });
});

describe("HealthBadge", () => {
  it("summarises the expected return when down, loops and error rate", () => {
    const now = new Date("2026-10-07T09:00:00Z");
    expect(healthSummary("injured", { expectedReturnAt: "2026-10-07T12:00:00Z" }, now)).toContain("Expected back in 3 hr");
    expect(healthSummary("injured", {}, now)).toContain("Reconnect");
    expect(healthSummary("degraded", { loopDetected: true, errorRate: 0.123, lastHeartbeatAt: "2026-10-07T08:59:00Z" }, now)).toBe("Loop detected on the last session · Error rate 12.3% over 24 h · Last heartbeat 1 min ago");
    render(<HealthBadge status="injured" details={{ expectedReturnAt: "2026-10-07T12:00:00Z" }} now={now} inline />);
    expect(screen.getByText("Down")).toBeTruthy();
    // Once beside the pill, once in the inline summary.
    expect(screen.getAllByText(/back in 3 hr/)).toHaveLength(2);
  });
});

describe("HierarchyChart", () => {
  it("lays out parents centred over children without overlap per depth", () => {
    const l = layoutHierarchy(mockHierarchy(), { nodeWidth: 100, nodeHeight: 40, gapX: 10, gapY: 20, padding: 0 });
    const byId = new Map(l.nodes.map((n) => [n.id, n]));
    const cos = byId.get("cos")!;
    const kids = cos.childIds.map((k) => byId.get(k)!);
    const left = Math.min(...kids.map((k) => k.x));
    const right = Math.max(...kids.map((k) => k.x + 100));
    expect(cos.x + 50).toBeCloseTo((left + right) / 2, 5);
    for (const depth of new Set(l.nodes.map((n) => n.depth))) {
      const row = l.nodes.filter((n) => n.depth === depth).sort((a, b) => a.x - b.x);
      for (let i = 1; i < row.length; i++) expect(row[i]!.x).toBeGreaterThanOrEqual(row[i - 1]!.x + 100);
    }
    expect(byId.get("founder")!.depth).toBe(0);
    expect(byId.get("w-0")!.depth).toBe(3);
    expect(l.edges).toHaveLength(l.nodes.length - 1);
  });

  it("walks the tree with arrow keys and selects on click", () => {
    const onSelect = vi.fn();
    render(<HierarchyChart nodes={mockHierarchy()} onSelect={onSelect} />);
    const founder = screen.getByRole("treeitem", { name: /Reid Jackson/ });
    founder.focus();
    fireEvent.keyDown(founder, { key: "ArrowDown" });
    expect(document.activeElement).toBe(screen.getByRole("treeitem", { name: /Marlow, Chief of Staff/ }));
    fireEvent.keyDown(document.activeElement as HTMLElement, { key: "ArrowDown" });
    expect(document.activeElement).toBe(screen.getByRole("treeitem", { name: /Isolde, Product lead/ }));
    fireEvent.keyDown(document.activeElement as HTMLElement, { key: "ArrowRight" });
    expect(document.activeElement).toBe(screen.getByRole("treeitem", { name: /Pike, Engineering lead/ }));
    fireEvent.keyDown(document.activeElement as HTMLElement, { key: "ArrowUp" });
    expect(document.activeElement).toBe(screen.getByRole("treeitem", { name: /Marlow/ }));
    fireEvent.click(document.activeElement as HTMLElement);
    expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({ id: "cos" }));
    expect(screen.getByRole("treeitem", { name: /Marlow/ }).getAttribute("aria-level")).toBe("2");
  });
});
