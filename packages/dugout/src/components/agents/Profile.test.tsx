import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { DevelopmentChart, chartDomain } from "./DevelopmentChart";
import { HealthBadge, healthSummary } from "./HealthBadge";
import { HIERARCHY_LAYOUT, HIERARCHY_MIN_NODE_WIDTH, HierarchyChart, fitHierarchyLayout, layoutHierarchy } from "./HierarchyChart";
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
    const l = layoutHierarchy(mockHierarchy(), { nodeWidth: 100, nodeHeight: 40, gapX: 10, gapY: 20, padding: 0, stackLeaves: false });
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

  it("stacks leaf children in one column under their parent, so a big team reads in one window", () => {
    const opts = { nodeWidth: 100, nodeHeight: 40, gapX: 10, gapY: 20, padding: 0, stackIndent: 20, stackGap: 8 };
    const stacked = layoutHierarchy(mockHierarchy(), opts);
    const tidy = layoutHierarchy(mockHierarchy(), { ...opts, stackLeaves: false });
    expect(stacked.width).toBeLessThan(tidy.width);
    expect(stacked.nodes).toHaveLength(tidy.nodes.length);
    expect(stacked.edges).toHaveLength(stacked.nodes.length - 1);
    const byId = new Map(stacked.nodes.map((n) => [n.id, n]));
    for (const parent of stacked.nodes) {
      const leaves = parent.childIds.map((k) => byId.get(k)!).filter((k) => k.childIds.length === 0);
      if (leaves.length < 2) continue;
      // One column: the same x, below the parent, never overlapping one another.
      expect(new Set(leaves.map((l) => l.x)).size).toBe(1);
      const ys = leaves.map((l) => l.y).sort((a, b) => a - b);
      for (let i = 1; i < ys.length; i++) expect(ys[i]!).toBeGreaterThanOrEqual(ys[i - 1]! + 40);
      expect(ys[0]!).toBeGreaterThan(parent.y);
    }
    // No two nodes overlap anywhere.
    for (const a of stacked.nodes)
      for (const b of stacked.nodes) {
        if (a === b) continue;
        const overlap = a.x < b.x + 100 && b.x < a.x + 100 && a.y < b.y + 40 && b.y < a.y + 40;
        expect(overlap, `${a.id} overlaps ${b.id}`).toBe(false);
      }
  });

  it("puts a founder's staff beside the Chief of Staff, in its row, instead of a column of their own", () => {
    const nodes = mockHierarchy();
    const l = layoutHierarchy(nodes);
    const byId = new Map(l.nodes.map((n) => [n.id, n]));
    const cos = byId.get("cos")!;
    const staff = byId.get("h-1")!;
    expect(staff.y).toBe(cos.y);
    expect(staff.x).toBeGreaterThanOrEqual(cos.x + HIERARCHY_LAYOUT.nodeWidth + HIERARCHY_LAYOUT.gapX);
    // The chart is no wider than it is without the staff member.
    expect(l.width).toBe(layoutHierarchy(nodes.filter((n) => n.id !== "h-1")).width);
    expect(l.edges.find((e) => e.to === "h-1")?.from).toBe("founder");
    // More staff than the row has room for go back to a stacked column beside the tree.
    const many = [...nodes, ...Array.from({ length: 9 }, (_, i) => ({ id: `h-x${i}`, name: `Staff ${i}`, role: "Advisor", kind: "human" as const, parentId: "founder" }))];
    const crowded = layoutHierarchy(many);
    const stacked = crowded.nodes.filter((n) => n.parentId === "founder" && n.id !== "cos");
    expect(new Set(stacked.map((n) => n.x)).size).toBe(1);
    expect(crowded.width).toBeGreaterThan(l.width);
  });

  it("fits the tree to the panel's width: tighter gaps, then narrower nodes, never below the floor", () => {
    const nodes = mockHierarchy();
    const natural = layoutHierarchy(nodes).width;
    expect(fitHierarchyLayout(nodes, natural + 40)).toEqual(HIERARCHY_LAYOUT);
    expect(fitHierarchyLayout(nodes, null)).toEqual(HIERARCHY_LAYOUT);
    const avail = natural - 120;
    const fitted = fitHierarchyLayout(nodes, avail);
    expect(fitted.gapX).toBeLessThan(HIERARCHY_LAYOUT.gapX);
    expect(fitted.nodeWidth).toBeLessThan(HIERARCHY_LAYOUT.nodeWidth);
    expect(fitted.nodeWidth).toBeGreaterThanOrEqual(HIERARCHY_MIN_NODE_WIDTH);
    expect(layoutHierarchy(nodes, fitted).width).toBeLessThanOrEqual(avail);
    // The widest node that fits: one pixel more would not.
    expect(layoutHierarchy(nodes, { ...fitted, nodeWidth: fitted.nodeWidth + 1 }).width).toBeGreaterThan(avail);
    // Node heights never change, so the screen's height for the chart stays right.
    expect(layoutHierarchy(nodes, fitted).height).toBe(layoutHierarchy(nodes).height);
    // Too narrow even at the floor: the floor, and the chart scrolls.
    expect(fitHierarchyLayout(nodes, 300).nodeWidth).toBe(HIERARCHY_MIN_NODE_WIDTH);
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
