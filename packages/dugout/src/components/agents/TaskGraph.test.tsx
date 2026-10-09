import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { mockTaskGraph } from "./mock";
import { READABLE_ZOOM, TaskGraph, fitTransform, layerNodes, layoutTaskGraph, readableTransform, zoomAround } from "./TaskGraph";
import type { TaskGraphNode } from "./types";

const simple: TaskGraphNode[] = [
  { id: "a", title: "A", status: "done", deps: [] },
  { id: "b", title: "B", status: "running", deps: ["a"] },
  { id: "c", title: "C", status: "planned", deps: ["a"] },
  { id: "d", title: "D", status: "planned", deps: ["b", "c"] },
  { id: "e", title: "E", status: "planned", deps: ["missing", "d"] },
];

describe("layoutTaskGraph", () => {
  it("layers by longest dependency path and ignores unknown deps", () => {
    const layers = layerNodes(simple);
    expect([...layers.entries()]).toEqual(
      expect.arrayContaining([
        ["a", 0],
        ["b", 1],
        ["c", 1],
        ["d", 2],
        ["e", 3],
      ]),
    );
  });

  it("survives cycles", () => {
    const cyc: TaskGraphNode[] = [
      { id: "x", title: "X", status: "planned", deps: ["y"] },
      { id: "y", title: "Y", status: "planned", deps: ["x"] },
    ];
    const l = layoutTaskGraph(cyc);
    expect(l.nodes).toHaveLength(2);
    expect(l.edges).toHaveLength(2);
  });

  it("positions layers left to right without overlaps and draws one edge per dependency", () => {
    const l = layoutTaskGraph(simple, { nodeWidth: 100, nodeHeight: 40, gapX: 20, gapY: 10, padding: 0 });
    const byId = new Map(l.nodes.map((n) => [n.id, n]));
    expect(byId.get("a")!.x).toBe(0);
    expect(byId.get("b")!.x).toBe(120);
    expect(byId.get("c")!.x).toBe(120);
    expect(byId.get("d")!.x).toBe(240);
    expect(Math.abs(byId.get("b")!.y - byId.get("c")!.y)).toBeGreaterThanOrEqual(50);
    expect(l.edges).toHaveLength(5);
    expect(l.width).toBe(4 * 100 + 3 * 20);
    expect(l.height).toBe(2 * 40 + 10);
    for (const e of l.edges) expect(e.path.startsWith("M ")).toBe(true);
  });

  it("orders a layer by barycenter to reduce crossings", () => {
    const nodes: TaskGraphNode[] = [
      { id: "p", title: "P", status: "done", deps: [] },
      { id: "q", title: "Q", status: "done", deps: [] },
      { id: "q2", title: "Q2", status: "planned", deps: ["q"] },
      { id: "p2", title: "P2", status: "planned", deps: ["p"] },
    ];
    const l = layoutTaskGraph(nodes);
    const byId = new Map(l.nodes.map((n) => [n.id, n]));
    expect(byId.get("p")!.order < byId.get("q")!.order).toBe(byId.get("p2")!.order < byId.get("q2")!.order);
  });

  it("lays out the mock graph with every node placed", () => {
    const nodes = mockTaskGraph();
    const l = layoutTaskGraph(nodes);
    expect(l.nodes).toHaveLength(nodes.length);
    expect(l.layers.flat().sort()).toEqual(nodes.map((n) => n.id).sort());
  });
});

describe("tall layers", () => {
  it("wraps a layer of many independent tasks into side-by-side columns of at most maxRows", () => {
    const many: TaskGraphNode[] = Array.from({ length: 20 }, (_, i) => ({ id: `t${i}`, title: `Task ${i}`, status: "planned" as const, deps: [] }));
    const l = layoutTaskGraph(many, { maxRows: 8 });
    const xs = new Set(l.nodes.map((n) => n.x));
    expect(xs.size).toBe(3); // 8 + 8 + 4
    const perColumn = [...xs].map((x) => l.nodes.filter((n) => n.x === x).length);
    expect(Math.max(...perColumn)).toBe(8);
    // No two nodes overlap.
    for (const a of l.nodes) for (const b of l.nodes) if (a !== b) expect(a.x === b.x && Math.abs(a.y - b.y) < 64).toBe(false);
  });
  it("opens big graphs at a readable zoom anchored top left, small ones fitted", () => {
    expect(readableTransform(4000, 600, 1000, 480).k).toBe(READABLE_ZOOM);
    expect(readableTransform(4000, 600, 1000, 480).x).toBe(16);
    expect(readableTransform(400, 200, 1000, 480)).toEqual(fitTransform(400, 200, 1000, 480));
  });
});

describe("zoom maths", () => {
  it("zooms around a point and clamps", () => {
    const t = zoomAround({ x: 0, y: 0, k: 1 }, 2, 100, 50);
    expect(t.k).toBe(2);
    expect(t.x).toBe(-100);
    expect(t.y).toBe(-50);
    expect(zoomAround({ x: 0, y: 0, k: 2.4 }, 2, 0, 0).k).toBe(2.5);
    expect(zoomAround({ x: 0, y: 0, k: 0.5 }, 0.1, 0, 0).k).toBe(0.4);
  });

  it("fits a drawing into a viewport and never upsizes", () => {
    expect(fitTransform(1000, 500, 500, 500, 0)).toEqual({ k: 0.5, x: 0, y: 125 });
    expect(fitTransform(100, 100, 500, 500, 0).k).toBe(1);
  });
});

describe("TaskGraph component", () => {
  it("renders nodes with a status word, a legend, and selects on click and Enter", () => {
    const onSelect = vi.fn();
    render(<TaskGraph nodes={simple} onSelect={onSelect} />);
    const nodeB = screen.getByRole("button", { name: /^B, Running/ });
    fireEvent.click(nodeB);
    expect(onSelect).toHaveBeenCalledWith("b");
    fireEvent.keyDown(screen.getByRole("button", { name: /^D, Planned/ }), { key: "Enter" });
    expect(onSelect).toHaveBeenCalledWith("d");
    expect(screen.getAllByText("Running").length).toBeGreaterThanOrEqual(2); // node + legend
    expect(screen.getByText(/E: Planned, after missing, D/)).toBeTruthy();
  });

  it("zooms with buttons and keys", () => {
    const { container } = render(<TaskGraph nodes={simple} />);
    const app = screen.getByRole("application");
    const before = container.querySelector("g[data-transform]")!.getAttribute("data-transform");
    fireEvent.click(screen.getByRole("button", { name: "Zoom in" }));
    const after = container.querySelector("g[data-transform]")!.getAttribute("data-transform");
    expect(after).not.toBe(before);
    expect(screen.getByText(/%$/).textContent).not.toBe("100%");
    fireEvent.keyDown(app, { key: "0" });
    fireEvent.keyDown(app, { key: "ArrowRight" });
    const panned = container.querySelector("g[data-transform]")!.getAttribute("data-transform");
    expect(panned).not.toBe(after);
  });
});
