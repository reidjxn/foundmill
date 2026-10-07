"use client";
import { useMemo, useRef, useState, type KeyboardEvent } from "react";
import { cn } from "../../lib/cn";
import { Avatar } from "../foundation/Avatar";
import { Chip } from "../foundation/Chip";
import { AgentStatusPill } from "../foundation/StatusPill";
import { MODEL_LABELS } from "./SquadCells";
import type { HierarchyKind, HierarchyNode } from "./types";

export interface HierarchyLayoutOptions {
  nodeWidth: number;
  nodeHeight: number;
  gapX: number;
  gapY: number;
  padding: number;
}

export const HIERARCHY_LAYOUT: HierarchyLayoutOptions = { nodeWidth: 176, nodeHeight: 60, gapX: 12, gapY: 40, padding: 12 };

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
      return { from: parent.id, to: p.id, path: `M ${x1} ${y1} L ${x1} ${mid} L ${x2} ${mid} L ${x2} ${y2}` };
    });
  return { nodes: list, edges, width, height };
}

const KIND_LABEL: Record<HierarchyKind, string> = { founder: "Founder", assistant: "Assistant manager", lead: "Lead", worker: "Worker", utility: "Utility", human: "Staff" };

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

  return (
    <div className={cn("overflow-auto", className)} data-hierarchy-chart>
      <div role="tree" aria-label="Squad hierarchy" className="relative" style={{ width: layout.width, height: layout.height }}>
        <svg width={layout.width} height={layout.height} aria-hidden className="absolute inset-0">
          {layout.edges.map((e) => (
            <path key={`${e.from}-${e.to}`} d={e.path} fill="none" className="stroke-subtle" strokeWidth={1.5} />
          ))}
        </svg>
        {layout.nodes.map((p) => {
          const n = byId.get(p.id);
          if (!n) return null;
          const selected = selectedId === n.id;
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
              className={cn(
                "absolute flex items-center gap-2 rounded-panel border bg-panel px-2 text-left shadow-inner-highlight outline-none",
                "transition-colors duration-micro ease-dugout hover:bg-panel-alt focus-visible:ring-2 focus-visible:ring-link",
                selected ? "border-kit-primary" : "border-subtle",
                n.kind === "assistant" && "border-l-3 border-l-kit-primary",
              )}
              style={{ left: p.x, top: p.y, width: o.nodeWidth, height: o.nodeHeight }}
            >
              <Avatar size={32} name={n.name} agent={n.avatar ? { seed: n.avatar.seed, dept: n.avatar.dept } : undefined} status={n.status} />
              <span className="flex min-w-0 flex-1 flex-col">
                <span className="truncate text-body-strong text-primary">{n.name}</span>
                <span className="truncate text-small text-secondary">{n.role}</span>
                <span className="mt-0.5 flex items-center gap-1">
                  {n.model ? (
                    <Chip tone="neutral" mono className="h-4 px-1 text-[10px]">
                      {MODEL_LABELS[n.model]}
                    </Chip>
                  ) : (
                    <Chip tone="neutral" className="h-4 px-1 text-[10px]">
                      {KIND_LABEL[n.kind]}
                    </Chip>
                  )}
                  {n.status && n.status !== "healthy" ? <AgentStatusPill status={n.status} className="h-4 px-1 text-[10px]" /> : null}
                </span>
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
