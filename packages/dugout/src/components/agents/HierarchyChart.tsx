"use client";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { cn } from "../../lib/cn";
import { Avatar } from "../foundation/Avatar";
import { FitText } from "../foundation/FitText";
import { agentStatusTone } from "../foundation/StatusPill";
import { MODEL_LABELS } from "./SquadCells";
import type { HierarchyKind, HierarchyNode } from "./types";

export interface HierarchyLayoutOptions {
  nodeWidth: number;
  nodeHeight: number;
  gapX: number;
  gapY: number;
  padding: number;
}

export const HIERARCHY_LAYOUT: HierarchyLayoutOptions = { nodeWidth: 188, nodeHeight: 64, gapX: 12, gapY: 40, padding: 16 };

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

/** A tidy top-down tree: leaves spaced evenly, parents centred over their children. Orphans become roots. */
export function layoutHierarchy(nodes: readonly HierarchyNode[], opts: Partial<HierarchyLayoutOptions> = {}): HierarchyLayout {
  const o = { ...HIERARCHY_LAYOUT, ...opts };
  const ids = new Set(nodes.map((n) => n.id));
  const children = new Map<string | null, string[]>();
  for (const n of nodes) {
    const parent = n.parentId && ids.has(n.parentId) && n.parentId !== n.id ? n.parentId : null;
    children.set(parent, [...(children.get(parent) ?? []), n.id]);
  }
  const placed = new Map<string, HierarchyPlaced>();
  const widthOf = new Map<string, number>();
  const measure = (id: string, seen: Set<string>): number => {
    if (seen.has(id)) return o.nodeWidth;
    seen.add(id);
    const kids = children.get(id) ?? [];
    const w = kids.length ? kids.reduce((s, k) => s + measure(k, seen), 0) + o.gapX * (kids.length - 1) : o.nodeWidth;
    widthOf.set(id, Math.max(o.nodeWidth, w));
    return widthOf.get(id)!;
  };
  const roots = children.get(null) ?? [];
  const seen = new Set<string>();
  roots.forEach((r) => measure(r, seen));
  const place = (id: string, left: number, depth: number, parentId: string | null) => {
    const w = widthOf.get(id) ?? o.nodeWidth;
    const kids = children.get(id) ?? [];
    placed.set(id, { id, x: left + (w - o.nodeWidth) / 2, y: o.padding + depth * (o.nodeHeight + o.gapY), depth, parentId, childIds: kids });
    let cursor = left;
    for (const k of kids) {
      if (placed.has(k)) continue;
      place(k, cursor, depth + 1, id);
      cursor += (widthOf.get(k) ?? o.nodeWidth) + o.gapX;
    }
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
      const x1 = parent.x + o.nodeWidth / 2;
      const y1 = parent.y + o.nodeHeight;
      const x2 = p.x + o.nodeWidth / 2;
      const y2 = p.y;
      const mid = y1 + (y2 - y1) / 2;
      // Orthogonal with rounded corners (radius up to 8, smaller when the turn is tight).
      const r = Math.min(8, Math.abs(x2 - x1) / 2, (y2 - y1) / 4);
      if (r < 0.5) return { from: parent.id, to: p.id, path: `M ${x1} ${y1} L ${x2} ${y2}` };
      const dir = x2 > x1 ? 1 : -1;
      return {
        from: parent.id,
        to: p.id,
        path: `M ${x1} ${y1} L ${x1} ${mid - r} Q ${x1} ${mid} ${x1 + dir * r} ${mid} L ${x2 - dir * r} ${mid} Q ${x2} ${mid} ${x2} ${mid + r} L ${x2} ${y2}`,
      };
    });
  return { nodes: list, edges, width, height };
}

const KIND_LABEL: Record<HierarchyKind, string> = { founder: "Founder", assistant: "Chief of Staff", lead: "Lead", worker: "Worker", utility: "Utility", human: "Staff" };

export interface HierarchyChartProps {
  nodes: readonly HierarchyNode[];
  selectedId?: string | null;
  onSelect?: (node: HierarchyNode) => void;
  layout?: Partial<HierarchyLayoutOptions>;
  className?: string;
}

/**
 * Org chart (BUILD §11.9 Hierarchy): founder → Chief of Staff → leads → workers, laid out locally. Nodes are buttons;
 * arrow keys walk the tree (Up parent, Down first child, Left/Right siblings), Enter selects.
 */
export function HierarchyChart({ nodes, selectedId, onSelect, layout: layoutOpts, className }: HierarchyChartProps) {
  const o = { ...HIERARCHY_LAYOUT, ...layoutOpts };
  const layout = useMemo(() => layoutHierarchy(nodes, layoutOpts), [nodes, layoutOpts]);
  const byId = useMemo(() => new Map(nodes.map((n) => [n.id, n])), [nodes]);
  const placedById = useMemo(() => new Map(layout.nodes.map((p) => [p.id, p])), [layout]);
  const [active, setActive] = useState<string | null>(layout.nodes[0]?.id ?? null);
  const refs = useRef(new Map<string, HTMLButtonElement>());

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

  // The root (the founder or the Chief of Staff) is centred in view on first paint and when the tree changes; edges
  // with more tree behind them fade (scroll cues).
  const scroller = useRef<HTMLDivElement>(null);
  const [cues, setCues] = useState({ left: false, right: false });
  const updateCues = useCallback(() => {
    const el = scroller.current;
    if (!el) return;
    const left = el.scrollLeft > 2;
    const right = el.scrollLeft + el.clientWidth < el.scrollWidth - 2;
    setCues((c) => (c.left === left && c.right === right ? c : { left, right }));
  }, []);
  const rootId = layout.nodes.find((n) => !n.parentId)?.id;
  useLayoutEffect(() => {
    const el = scroller.current;
    const root = rootId ? placedById.get(rootId) : undefined;
    if (!el || !root) return;
    el.scrollLeft = Math.max(0, root.x + o.nodeWidth / 2 - el.clientWidth / 2);
    updateCues();
  }, [rootId, layout.width, placedById, o.nodeWidth, updateCues]);
  useEffect(() => {
    const el = scroller.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => updateCues());
    ro.observe(el);
    return () => ro.disconnect();
  }, [updateCues]);

  return (
    <div className={cn("scroll-cues relative min-h-0", className)} data-more-left={cues.left || undefined} data-more-right={cues.right || undefined} data-hierarchy-chart>
      <div ref={scroller} className="h-full overflow-auto" onScroll={updateCues}>
      <div role="tree" aria-label="Team hierarchy" className="relative" style={{ width: layout.width, height: layout.height }}>
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
              aria-label={`${n.name}, ${n.role}${n.department ? `, ${n.department}` : ""}, ${KIND_LABEL[n.kind]}`}
              tabIndex={active === n.id ? 0 : -1}
              data-kind={n.kind}
              onFocus={() => setActive(n.id)}
              onKeyDown={(e) => onKey(e, p)}
              onClick={() => onSelect?.(n)}
              title={`${n.name} · ${n.role}`}
              className={cn(
                "pressable absolute flex items-center gap-2.5 overflow-hidden rounded-md border bg-surface-1 px-2.5 text-left shadow-elev-1 outline-none",
                "transition duration-hover ease-out hover:border-line-strong hover:bg-surface-2 focus-visible:shadow-ring",
                selected ? "tile-focused" : "border-line",
                (n.kind === "assistant" || n.kind === "founder") && !selected && "border-kit-lift/45 bg-kit-lift/5",
              )}
              style={{ left: p.x, top: p.y, width: o.nodeWidth, height: o.nodeHeight }}
            >
              <Avatar size={34} name={n.name} agent={n.avatar ? { seed: n.avatar.seed, dept: n.avatar.dept } : undefined} status={n.status} />
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
                  <span className="shrink-0 text-tertiary">·</span>
                  <span className="shrink-0 font-mono text-micro text-tertiary">{n.model ? MODEL_LABELS[n.model] : KIND_LABEL[n.kind]}</span>
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
