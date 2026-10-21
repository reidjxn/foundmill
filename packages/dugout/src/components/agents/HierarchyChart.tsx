"use client";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { cn } from "../../lib/cn";
import { Avatar } from "../foundation/Avatar";
import { FitText } from "../foundation/FitText";
import { agentStatusTone } from "../foundation/StatusPill";
import { useTerm } from "../guidance/GuidanceProvider";
import { MODEL_LABELS } from "./SquadCells";
import type { HierarchyKind, HierarchyNode } from "./types";

export interface HierarchyLayoutOptions {
  nodeWidth: number;
  nodeHeight: number;
  gapX: number;
  gapY: number;
  padding: number;
  /**
   * Stack a node's leaf children (the people with no reports) in one column under it, joined by a spine, instead of
   * spreading them across the row. A team of 30 then reads in one window instead of a strip 6,000 px wide.
   */
  stackLeaves: boolean;
  /** Indent of a stacked column from its spine. */
  stackIndent: number;
  /** Vertical gap between stacked nodes. */
  stackGap: number;
}

export const HIERARCHY_LAYOUT: HierarchyLayoutOptions = { nodeWidth: 188, nodeHeight: 64, gapX: 12, gapY: 40, padding: 16, stackLeaves: true, stackIndent: 24, stackGap: 8 };

/** The narrowest node fitting may use: a 28 px avatar leaves the name and role about 100 px, both at 11 px or more. */
export const HIERARCHY_MIN_NODE_WIDTH = 148;
/** Below this width a node is compact: a smaller avatar and padding leave the name and role their room. */
export const HIERARCHY_COMPACT_NODE_WIDTH = 176;
/** Column spacing once fitting starts: tighter gaps and stack indents before any node narrows. */
const HIERARCHY_TIGHT = { gapX: 8, stackIndent: 16 } as const;

/**
 * Layout options that fit the tree into `availWidth` (the panel's inner width) without scrolling sideways (founder,
 * 2026-10-10: the chart scrolled a little at 1280 px). At its default size the tree is left alone; otherwise the gaps
 * and stack indents tighten first, then the nodes narrow to the widest width that fits (a binary search on the real
 * layout), never below HIERARCHY_MIN_NODE_WIDTH: a tree too wide even then scrolls, with its fade cues. Pure.
 */
export function fitHierarchyLayout(nodes: readonly HierarchyNode[], availWidth: number | null | undefined, opts: Partial<HierarchyLayoutOptions> = {}): HierarchyLayoutOptions {
  const base = { ...HIERARCHY_LAYOUT, ...opts };
  if (!availWidth || availWidth <= 0 || layoutHierarchy(nodes, base).width <= availWidth) return base;
  const tight = { ...base, gapX: Math.min(base.gapX, HIERARCHY_TIGHT.gapX), stackIndent: Math.min(base.stackIndent, HIERARCHY_TIGHT.stackIndent) };
  if (layoutHierarchy(nodes, tight).width <= availWidth) return tight;
  const floor = Math.min(base.nodeWidth, HIERARCHY_MIN_NODE_WIDTH);
  let lo = floor;
  let hi = base.nodeWidth;
  if (layoutHierarchy(nodes, { ...tight, nodeWidth: lo }).width > availWidth) return { ...tight, nodeWidth: lo };
  // The widest node width in [lo, hi] that fits (the layout's width grows with the node width).
  while (hi - lo > 1) {
    const mid = Math.floor((lo + hi) / 2);
    if (layoutHierarchy(nodes, { ...tight, nodeWidth: mid }).width <= availWidth) lo = mid;
    else hi = mid;
  }
  return { ...tight, nodeWidth: lo };
}

export interface HierarchyPlaced {
  id: string;
  x: number;
  y: number;
  depth: number;
  parentId: string | null;
  childIds: string[];
}

export interface HierarchyLayout {
  nodes: HierarchyPlaced[];
  edges: Array<{ from: string; to: string; path: string }>;
  width: number;
  height: number;
}

/** An orthogonal path through `points` with rounded corners (radius up to 8, smaller when a leg is short). */
function roundedPath(points: ReadonlyArray<readonly [number, number]>): string {
  if (points.length < 2) return "";
  const [x0, y0] = points[0]!;
  let d = `M ${x0} ${y0}`;
  for (let i = 1; i < points.length - 1; i++) {
    const [px, py] = points[i - 1]!;
    const [cx, cy] = points[i]!;
    const [nx, ny] = points[i + 1]!;
    const r = Math.min(8, Math.hypot(cx - px, cy - py) / 2, Math.hypot(nx - cx, ny - cy) / 2);
    if (r < 0.5) {
      d += ` L ${cx} ${cy}`;
      continue;
    }
    const ax = cx - Math.sign(cx - px) * r;
    const ay = cy - Math.sign(cy - py) * r;
    const bx = cx + Math.sign(nx - cx) * r;
    const by = cy + Math.sign(ny - cy) * r;
    d += ` L ${ax} ${ay} Q ${cx} ${cy} ${bx} ${by}`;
  }
  const [lx, ly] = points[points.length - 1]!;
  return `${d} L ${lx} ${ly}`;
}

/**
 * A top-down org chart: parents centred over their branches, orphans become roots. With `stackLeaves` (the default) a
 * node's leaf children sit in one column after its branches, joined by a spine; a node whose children are all leaves
 * sits at the top left of its column with the spine dropping from it. A node with one branch and a few leaves (the
 * founder's staff beside the Chief of Staff) puts the leaves in that branch's row, either side of it, when the row has
 * room: no extra column for them.
 */
export function layoutHierarchy(nodes: readonly HierarchyNode[], opts: Partial<HierarchyLayoutOptions> = {}): HierarchyLayout {
  const o = { ...HIERARCHY_LAYOUT, ...opts };
  const ids = new Set(nodes.map((n) => n.id));
  const children = new Map<string | null, string[]>();
  for (const n of nodes) {
    const parent = n.parentId && ids.has(n.parentId) && n.parentId !== n.id ? n.parentId : null;
    children.set(parent, [...(children.get(parent) ?? []), n.id]);
  }
  const kidsOf = (id: string) => children.get(id) ?? [];
  const isLeaf = (id: string) => kidsOf(id).length === 0;
  /** A node's children split into branches (spread across the row) and stacked leaves (one column). */
  const split = (id: string) => {
    const kids = kidsOf(id);
    if (!o.stackLeaves) return { branches: kids, leaves: [] as string[] };
    return { branches: kids.filter((k) => !isLeaf(k)), leaves: kids.filter(isLeaf) };
  };
  const stackWidth = o.nodeWidth + o.stackIndent;
  const placed = new Map<string, HierarchyPlaced>();
  const widthOf = new Map<string, number>();
  const onlyLeavesOf = (id: string) => {
    const { branches, leaves } = split(id);
    return leaves.length > 0 && branches.length === 0;
  };
  /** Nodes whose leaves sit beside their only branch, in its row (see the doc above). */
  const beside = new Set<string>();
  /** How many nodes fit on each side of a branch's own node within its subtree's width, one gap clear of it. */
  const besideSlots = (branchId: string, branchWidth: number) => {
    const leftFree = onlyLeavesOf(branchId) ? 0 : (branchWidth - o.nodeWidth) / 2;
    const rightFree = branchWidth - o.nodeWidth - leftFree;
    const slots = (free: number) => Math.max(0, Math.floor((free - o.gapX) / (o.nodeWidth + o.gapX)));
    return { left: slots(leftFree), right: slots(rightFree) };
  };
  const measure = (id: string, seen: Set<string>): number => {
    if (seen.has(id)) return o.nodeWidth;
    seen.add(id);
    const { branches, leaves } = split(id);
    for (const l of leaves) {
      seen.add(l);
      widthOf.set(l, o.nodeWidth);
    }
    const cols = branches.map((k) => measure(k, seen));
    if (leaves.length && branches.length === 1) {
      const room = besideSlots(branches[0]!, cols[0]!);
      // Alternating right, left: the right side takes the extra one.
      if (Math.ceil(leaves.length / 2) <= room.right && Math.floor(leaves.length / 2) <= room.left) beside.add(id);
    }
    if (leaves.length && !beside.has(id)) cols.push(stackWidth);
    const w = cols.length ? cols.reduce((s, c) => s + c, 0) + o.gapX * (cols.length - 1) : o.nodeWidth;
    widthOf.set(id, Math.max(o.nodeWidth, w));
    return widthOf.get(id)!;
  };
  const roots = children.get(null) ?? [];
  const seen = new Set<string>();
  roots.forEach((r) => measure(r, seen));
  const rowY = (depth: number) => o.padding + depth * (o.nodeHeight + o.gapY);
  type Route = { kind: "tree" } | { kind: "spine"; spineX: number; from: "parent" | "sibling"; prevId?: string };
  const route = new Map<string, Route>();
  const place = (id: string, left: number, depth: number, parentId: string | null, y = rowY(depth)) => {
    const w = widthOf.get(id) ?? o.nodeWidth;
    const kids = kidsOf(id);
    const { branches, leaves } = split(id);
    // All leaves: the node sits at the top left of its column and the spine drops from it.
    const onlyLeaves = leaves.length > 0 && branches.length === 0;
    const x = onlyLeaves ? left : left + (w - o.nodeWidth) / 2;
    placed.set(id, { id, x, y, depth, parentId, childIds: kids });
    let cursor = left;
    for (const k of branches) {
      if (placed.has(k)) continue;
      place(k, cursor, depth + 1, id);
      route.set(k, { kind: "tree" });
      cursor += (widthOf.get(k) ?? o.nodeWidth) + o.gapX;
    }
    if (!leaves.length) return;
    if (beside.has(id)) {
      const branch = placed.get(branches[0]!);
      if (!branch) return;
      let right = 0;
      let leftCount = 0;
      leaves.forEach((l, i) => {
        if (placed.has(l)) return;
        const step = o.nodeWidth + o.gapX;
        const lx = i % 2 === 0 ? branch.x + o.nodeWidth + o.gapX * 2 + step * right++ : branch.x - o.gapX * 2 - o.nodeWidth - step * leftCount++;
        placed.set(l, { id: l, x: lx, y: branch.y, depth: depth + 1, parentId: id, childIds: [] });
        route.set(l, { kind: "tree" });
      });
      return;
    }
    const spineX = onlyLeaves ? x + o.stackIndent / 2 : cursor + o.stackIndent / 2;
    const leafX = onlyLeaves ? x + o.stackIndent : cursor + o.stackIndent;
    const firstY = onlyLeaves ? y + o.nodeHeight + o.stackGap * 2 : rowY(depth + 1);
    leaves.forEach((l, i) => {
      if (placed.has(l)) return;
      placed.set(l, { id: l, x: leafX, y: firstY + i * (o.nodeHeight + o.stackGap), depth: depth + 1, parentId: id, childIds: [] });
      route.set(l, i === 0 ? { kind: "spine", spineX, from: "parent" } : { kind: "spine", spineX, from: "sibling", prevId: leaves[i - 1] });
    });
  };
  let cursor = o.padding;
  for (const r of roots) {
    place(r, cursor, 0, null);
    cursor += (widthOf.get(r) ?? o.nodeWidth) + o.gapX * 2;
  }
  const list = Array.from(placed.values());
  const width = Math.max(o.nodeWidth + o.padding * 2, ...list.map((p) => p.x + o.nodeWidth + o.padding));
  const height = Math.max(o.nodeHeight + o.padding * 2, ...list.map((p) => p.y + o.nodeHeight + o.padding));
  const edges = list
    .filter((p) => p.parentId)
    .map((p) => {
      const parent = placed.get(p.parentId as string)!;
      const r = route.get(p.id) ?? { kind: "tree" as const };
      const pcx = parent.x + o.nodeWidth / 2;
      const pBottom = parent.y + o.nodeHeight;
      if (r.kind === "spine") {
        const midY = p.y + o.nodeHeight / 2;
        if (r.from === "sibling") {
          // One spine segment per stacked node, from the previous one's join down to this one: no line drawn twice.
          const prev = placed.get(r.prevId as string)!;
          return { from: parent.id, to: p.id, path: roundedPath([[r.spineX, prev.y + o.nodeHeight / 2], [r.spineX, midY], [p.x, midY]]) };
        }
        // The first stacked node: straight down the spine when it drops from the parent, else round from the parent.
        const fromParent = Math.abs(r.spineX - pcx) > o.nodeWidth / 2;
        const points: Array<[number, number]> = fromParent
          ? [[pcx, pBottom], [pcx, pBottom + o.gapY / 2], [r.spineX, pBottom + o.gapY / 2], [r.spineX, midY], [p.x, midY]]
          : [[r.spineX, pBottom], [r.spineX, midY], [p.x, midY]];
        return { from: parent.id, to: p.id, path: roundedPath(points) };
      }
      const x2 = p.x + o.nodeWidth / 2;
      const y2 = p.y;
      const mid = pBottom + (y2 - pBottom) / 2;
      if (Math.abs(x2 - pcx) < 1) return { from: parent.id, to: p.id, path: `M ${pcx} ${pBottom} L ${x2} ${y2}` };
      return { from: parent.id, to: p.id, path: roundedPath([[pcx, pBottom], [pcx, mid], [x2, mid], [x2, y2]]) };
    });
  return { nodes: list, edges, width, height };
}

const KIND_LABEL: Record<HierarchyKind, string> = { founder: "Founder", assistant: "Chief of Staff", lead: "Lead", worker: "Worker", utility: "Utility", human: "Staff" };

export interface HierarchyChartProps {
  nodes: readonly HierarchyNode[];
  selectedId?: string | null;
  onSelect?: (node: HierarchyNode) => void;
  layout?: Partial<HierarchyLayoutOptions>;
  /**
   * Fit the tree to the chart's width (default true): tighter gaps, then narrower nodes (fitHierarchyLayout), so it
   * does not scroll sideways at 1280 px. False keeps `layout` as given.
   */
  fit?: boolean;
  className?: string;
}

/**
 * Org chart (BUILD §11.9 Hierarchy): founder → Chief of Staff → leads → workers, laid out locally. Nodes are buttons;
 * arrow keys walk the tree (Up parent, Down first child, Left/Right siblings), Enter selects.
 */
export function HierarchyChart({ nodes, selectedId, onSelect, layout: layoutOpts, fit = true, className }: HierarchyChartProps) {
  // The scroller's inner width, for fitting (null until measured: server markup and the first paint use the defaults).
  const scroller = useRef<HTMLDivElement>(null);
  const [avail, setAvail] = useState<number | null>(null);
  const o = useMemo(() => (fit ? fitHierarchyLayout(nodes, avail, layoutOpts) : { ...HIERARCHY_LAYOUT, ...layoutOpts }), [fit, nodes, avail, layoutOpts]);
  const compact = o.nodeWidth < HIERARCHY_COMPACT_NODE_WIDTH;
  const layout = useMemo(() => layoutHierarchy(nodes, o), [nodes, o]);
  const byId = useMemo(() => new Map(nodes.map((n) => [n.id, n])), [nodes]);
  const placedById = useMemo(() => new Map(layout.nodes.map((p) => [p.id, p])), [layout]);
  const [active, setActive] = useState<string | null>(layout.nodes[0]?.id ?? null);
  const refs = useRef(new Map<string, HTMLButtonElement>());
  // The Chief of Staff node's tooltip says what the role is (the node is a button, so no Term inside it).
  const chiefOfStaff = useTerm("chief_of_staff");

  const focusNode = (id: string | undefined) => {
    if (!id) return;
    setActive(id);
    refs.current.get(id)?.focus();
  };
  const onKey = (e: KeyboardEvent<HTMLButtonElement>, p: HierarchyPlaced) => {
    const siblings = p.parentId ? placedById.get(p.parentId)?.childIds ?? [] : layout.nodes.filter((n) => !n.parentId).map((n) => n.id);
    const i = siblings.indexOf(p.id);
    switch (e.key) {
      case "ArrowUp":
        focusNode(p.parentId ?? undefined);
        break;
      case "ArrowDown":
        focusNode(p.childIds[0]);
        break;
      case "ArrowLeft":
        focusNode(siblings[i - 1]);
        break;
      case "ArrowRight":
        focusNode(siblings[i + 1]);
        break;
      case "Home":
        focusNode(siblings[0]);
        break;
      case "End":
        focusNode(siblings[siblings.length - 1]);
        break;
      default:
        return;
    }
    e.preventDefault();
  };

  // The root (the founder or the Chief of Staff) is centred in view on first paint and when the tree changes, or the
  // selected node when it is out of view (the detail panel narrows the chart); edges with more tree behind them fade
  // (scroll cues).
  const [cues, setCues] = useState({ left: false, right: false });
  const updateCues = useCallback(() => {
    const el = scroller.current;
    if (!el) return;
    const left = el.scrollLeft > 2;
    const right = el.scrollLeft + el.clientWidth < el.scrollWidth - 2;
    setCues((c) => (c.left === left && c.right === right ? c : { left, right }));
    if (el.clientWidth > 0) setAvail((w) => (w === el.clientWidth ? w : el.clientWidth));
  }, []);
  const rootId = layout.nodes.find((n) => !n.parentId)?.id;
  useLayoutEffect(() => {
    const el = scroller.current;
    const selected = selectedId ? placedById.get(selectedId) : undefined;
    const target = selected ?? (rootId ? placedById.get(rootId) : undefined);
    if (!el || !target) return;
    const inView = target.x >= el.scrollLeft && target.x + o.nodeWidth <= el.scrollLeft + el.clientWidth;
    if (!selected || !inView) el.scrollLeft = Math.max(0, target.x + o.nodeWidth / 2 - el.clientWidth / 2);
    updateCues();
  }, [rootId, selectedId, layout.width, placedById, o.nodeWidth, updateCues]);
  useEffect(() => {
    const el = scroller.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => updateCues());
    ro.observe(el);
    return () => ro.disconnect();
  }, [updateCues]);

  return (
    <div className={cn("scroll-cues relative min-h-0", className)} data-more-left={cues.left || undefined} data-more-right={cues.right || undefined} data-hierarchy-chart>
      {/* A diagram that can be wider than its panel scrolls, with fade cues at the edges (like the task graph). */}
      <div ref={scroller} className="h-full overflow-auto" onScroll={updateCues} data-scroll-region="diagram">
      {/* A tree narrower than the panel sits in its middle; a wider one starts at the left edge and scrolls. */}
      <div role="tree" aria-label="Team hierarchy" className="relative mx-auto" style={{ width: layout.width, height: layout.height }} data-compact={compact || undefined}>
        <svg width={layout.width} height={layout.height} aria-hidden className="absolute inset-0">
          {layout.edges.map((e) => (
            <path key={`${e.from}-${e.to}`} d={e.path} fill="none" stroke="var(--line-strong)" strokeWidth={1.25} strokeLinecap="round" />
          ))}
        </svg>
        {layout.nodes.map((p) => {
          const n = byId.get(p.id);
          if (!n) return null;
          const selected = selectedId === n.id;
          const unwell = n.status && n.status !== "healthy" ? agentStatusTone(n.status) : null;
          return (
            <button
              key={n.id}
              ref={(el) => {
                if (el) refs.current.set(n.id, el);
                else refs.current.delete(n.id);
              }}
              type="button"
              role="treeitem"
              aria-level={p.depth + 1}
              aria-selected={selected}
              aria-expanded={p.childIds.length ? true : undefined}
              aria-label={`${n.name}, ${n.role}${n.department ? `, ${n.department}` : ""}, ${KIND_LABEL[n.kind]}${n.model ? `, ${MODEL_LABELS[n.model]}` : ""}`}
              tabIndex={active === n.id ? 0 : -1}
              data-kind={n.kind}
              onFocus={() => setActive(n.id)}
              onKeyDown={(e) => onKey(e, p)}
              onClick={() => onSelect?.(n)}
              title={`${n.model ? `${n.name} · ${n.role} · ${MODEL_LABELS[n.model]}` : `${n.name} · ${n.role}`}${n.kind === "assistant" && chiefOfStaff ? `\n${chiefOfStaff.word}: ${chiefOfStaff.short}` : ""}`}
              className={cn(
                "pressable absolute flex items-center overflow-hidden rounded-md border bg-surface-1 text-left shadow-elev-1 outline-none",
                compact ? "gap-2 px-2" : "gap-2.5 px-2.5",
                "transition duration-hover ease-out hover:border-line-strong hover:bg-surface-2 focus-visible:shadow-ring",
                selected ? "tile-focused" : "border-line",
                (n.kind === "assistant" || n.kind === "founder") && !selected && "border-kit-lift/45 bg-kit-lift/5",
              )}
              style={{ left: p.x, top: p.y, width: o.nodeWidth, height: o.nodeHeight }}
            >
              <Avatar size={compact ? 28 : 34} name={n.name} agent={n.avatar ? { seed: n.avatar.seed, dept: n.avatar.dept } : undefined} status={n.status} />
              <span className="flex min-w-0 flex-1 flex-col justify-center">
                {/* Names fit: two lines first, then a step down; the full name is in the node's tooltip. */}
                <span className="text-action font-semibold leading-4 text-primary">
                  <FitText lines={2} minPx={11}>
                    {n.name}
                  </FitText>
                </span>
                <span className="mt-0.5 flex min-w-0 items-baseline gap-1 text-small">
                  {unwell ? <span className={cn("shrink-0 font-medium", UNWELL_TEXT[unwell.tone])}>{unwell.word}</span> : null}
                  {unwell ? <span className="shrink-0 text-tertiary">·</span> : null}
                  <span className="min-w-0 text-secondary">
                    <FitText minPx={11} tooltip={false}>
                      {n.role}
                    </FitText>
                  </span>
                  {/* An agent's role gets the whole line (it used to end "Head of Engine… · Opus"); its model is in the
                      node's tooltip and the detail panel. People keep their short kind ("You · Founder"). */}
                  {n.model ? null : (
                    <>
                      <span className="shrink-0 text-tertiary">·</span>
                      <span className="shrink-0 font-mono text-micro text-tertiary">{KIND_LABEL[n.kind]}</span>
                    </>
                  )}
                </span>
              </span>
            </button>
          );
        })}
      </div>
      </div>
    </div>
  );
}

const UNWELL_TEXT: Record<string, string> = { good: "text-status-good", warn: "text-status-warn", bad: "text-status-bad", info: "text-status-info", neutral: "text-secondary" };
