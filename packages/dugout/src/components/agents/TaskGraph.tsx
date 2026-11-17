"use client";
import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent, type WheelEvent } from "react";
import { Ban, CircleCheck, CircleDashed, CirclePause, CirclePlay, CircleX, Focus, GitMerge, Hourglass, Minus, Plus, SearchCheck, SquareDashed } from "lucide-react";
import type { TaskStatus } from "@foundmill/shared";
import { cn } from "../../lib/cn";
import { generateAvatar } from "../foundation/Avatar";
import { Icon, type IconComponent } from "../foundation/Icon";
import { IconButton } from "../foundation/IconButton";
import { StatusPill, type StatusTone } from "../foundation/StatusPill";
import { Tooltip } from "../foundation/Tooltip";
import { useTerm } from "../guidance/GuidanceProvider";
import type { TaskGraphNode } from "./types";

// ---------------------------------------------------------------------------------------------------------------------
// Layout (pure)
// ---------------------------------------------------------------------------------------------------------------------

export interface LayoutOptions {
  nodeWidth: number;
  nodeHeight: number;
  gapX: number;
  gapY: number;
  padding: number;
  /**
   * Most nodes stacked in one column. A layer with more (a hundred independent tasks) wraps into side-by-side
   * sub-columns, so the graph stays readable instead of becoming one very tall column. Default 8.
   */
  maxRows?: number;
}

export const DEFAULT_LAYOUT: LayoutOptions = { nodeWidth: 196, nodeHeight: 64, gapX: 56, gapY: 14, padding: 16, maxRows: 8 };

export interface PositionedNode {
  id: string;
  x: number;
  y: number;
  layer: number;
  order: number;
}

export interface LayoutEdge {
  from: string;
  to: string;
  path: string;
}

export interface GraphLayout {
  nodes: PositionedNode[];
  edges: LayoutEdge[];
  width: number;
  height: number;
  layers: string[][];
}

/** Longest-path layering (a node sits one layer after its deepest dependency); unknown deps and cycles are ignored. */
export function layerNodes(nodes: readonly TaskGraphNode[]): Map<string, number> {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const layer = new Map<string, number>();
  const visiting = new Set<string>();
  const visit = (id: string): number => {
    const known = layer.get(id);
    if (known !== undefined) return known;
    if (visiting.has(id)) return 0;
    visiting.add(id);
    const node = byId.get(id);
    let l = 0;
    for (const d of node?.deps ?? []) {
      if (!byId.has(d) || d === id) continue;
      l = Math.max(l, visit(d) + 1);
    }
    visiting.delete(id);
    layer.set(id, l);
    return l;
  };
  for (const n of nodes) visit(n.id);
  return layer;
}

function barycenterSweep(layers: string[][], neighbours: Map<string, string[]>, direction: "down" | "up") {
  const order = new Map<string, number>();
  layers.forEach((ids) => ids.forEach((id, i) => order.set(id, i)));
  const range = direction === "down" ? layers.map((_, i) => i).slice(1) : layers.map((_, i) => i).slice(0, -1).reverse();
  for (const li of range) {
    const ids = layers[li] as string[];
    const scored = ids.map((id, i) => {
      const ns = (neighbours.get(id) ?? []).map((n) => order.get(n)).filter((v): v is number => v !== undefined);
      const bary = ns.length ? ns.reduce((a, b) => a + b, 0) / ns.length : i;
      return { id, bary, i };
    });
    scored.sort((a, b) => a.bary - b.bary || a.i - b.i);
    layers[li] = scored.map((s) => s.id);
    layers[li]!.forEach((id, i) => order.set(id, i));
  }
}

/**
 * A simple layered layout computed locally: longest-path layers left to right, two barycenter sweeps to reduce
 * crossings, layers centred vertically, edges as cubic curves from a node's right edge to its dependant's left edge.
 */
export function layoutTaskGraph(nodes: readonly TaskGraphNode[], opts: Partial<LayoutOptions> = {}): GraphLayout {
  const o = { ...DEFAULT_LAYOUT, ...opts };
  const layerOf = layerNodes(nodes);
  const count = nodes.length ? Math.max(...nodes.map((n) => layerOf.get(n.id) ?? 0)) + 1 : 0;
  const layers: string[][] = Array.from({ length: count }, () => []);
  for (const n of nodes) layers[layerOf.get(n.id) ?? 0]!.push(n.id);
  const ids = new Set(nodes.map((n) => n.id));
  const preds = new Map(nodes.map((n) => [n.id, n.deps.filter((d) => ids.has(d) && d !== n.id)]));
  const succs = new Map<string, string[]>();
  for (const n of nodes) for (const d of preds.get(n.id) ?? []) succs.set(d, [...(succs.get(d) ?? []), n.id]);
  barycenterSweep(layers, preds, "down");
  barycenterSweep(layers, succs, "up");
  barycenterSweep(layers, preds, "down");

  const maxRows = Math.max(1, Math.floor(o.maxRows ?? Infinity));
  const rowsIn = (n: number) => Math.min(n, maxRows);
  const subCols = layers.map((l) => Math.max(1, Math.ceil(l.length / maxRows)));
  const totalCols = subCols.reduce((a, b) => a + b, 0);
  const tallest = Math.max(0, ...layers.map((l) => rowsIn(l.length)));
  const height = o.padding * 2 + tallest * o.nodeHeight + Math.max(0, tallest - 1) * o.gapY;
  // Sub-columns of one layer sit closer together than layers do, so a wrapped layer still reads as one step.
  const subGap = Math.min(o.gapX, 24);
  const width = o.padding * 2 + totalCols * o.nodeWidth + Math.max(0, count - 1) * o.gapX + (totalCols - count) * subGap;
  const positioned: PositionedNode[] = [];
  const pos = new Map<string, PositionedNode>();
  let x = o.padding;
  layers.forEach((layerIds, li) => {
    const cols = subCols[li] ?? 1;
    for (let c = 0; c < cols; c++) {
      const colIds = layerIds.slice(c * maxRows, (c + 1) * maxRows);
      const colHeight = colIds.length * o.nodeHeight + Math.max(0, colIds.length - 1) * o.gapY;
      const top = o.padding + (height - o.padding * 2 - colHeight) / 2;
      colIds.forEach((id, k) => {
        const p: PositionedNode = { id, layer: li, order: c * maxRows + k, x, y: top + k * (o.nodeHeight + o.gapY) };
        positioned.push(p);
        pos.set(id, p);
      });
      x += o.nodeWidth + (c < cols - 1 ? subGap : o.gapX);
    }
  });
  const edges: LayoutEdge[] = [];
  for (const n of nodes) {
    const to = pos.get(n.id);
    if (!to) continue;
    for (const d of preds.get(n.id) ?? []) {
      const from = pos.get(d);
      if (!from) continue;
      const x1 = from.x + o.nodeWidth;
      const y1 = from.y + o.nodeHeight / 2;
      const x2 = to.x;
      const y2 = to.y + o.nodeHeight / 2;
      const c = Math.max(24, (x2 - x1) / 2);
      edges.push({ from: d, to: n.id, path: `M ${x1} ${y1} C ${x1 + c} ${y1}, ${x2 - c} ${y2}, ${x2} ${y2}` });
    }
  }
  return { nodes: positioned, edges, width, height, layers };
}

// ---------------------------------------------------------------------------------------------------------------------
// Status vocabulary
// ---------------------------------------------------------------------------------------------------------------------

export const TASK_STATUS_META: Record<TaskStatus, { tone: StatusTone; word: string; icon: IconComponent }> = {
  planned: { tone: "neutral", word: "Planned", icon: CircleDashed },
  ready: { tone: "info", word: "Ready", icon: SquareDashed },
  running: { tone: "info", word: "Running", icon: CirclePlay },
  paused: { tone: "neutral", word: "Paused", icon: CirclePause },
  blocked: { tone: "warn", word: "Blocked", icon: Hourglass },
  review: { tone: "info", word: "Review", icon: SearchCheck },
  merging: { tone: "info", word: "Merging", icon: GitMerge },
  done: { tone: "good", word: "Done", icon: CircleCheck },
  failed: { tone: "bad", word: "Failed", icon: CircleX },
  stopped: { tone: "neutral", word: "Stopped", icon: Ban },
};

/** Node edges: quiet for finished work, lit for what needs eyes (running, blocked, failed). The bar and word carry the state. */
const TONE_STROKE: Record<StatusTone, string> = {
  good: "stroke-white/10",
  warn: "stroke-status-warn/60",
  bad: "stroke-status-bad/60",
  info: "stroke-status-info/55",
  neutral: "stroke-white/10",
};
const TONE_TEXT: Record<StatusTone, string> = {
  good: "text-status-good",
  warn: "text-status-warn",
  bad: "text-status-bad",
  info: "text-status-info",
  neutral: "text-secondary",
};
const TONE_FILL: Record<StatusTone, string> = {
  good: "fill-status-good",
  warn: "fill-status-warn",
  bad: "fill-status-bad",
  info: "fill-status-info",
  neutral: "fill-tertiary",
};

// ---------------------------------------------------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------------------------------------------------

export interface TaskGraphProps {
  nodes: readonly TaskGraphNode[];
  selectedId?: string | null;
  onSelect?: (id: string) => void;
  layout?: Partial<LayoutOptions>;
  /** Fixed height in px; width fills the container. Default 480. */
  height?: number;
  className?: string;
  "aria-label"?: string;
}

interface Transform {
  x: number;
  y: number;
  k: number;
}

export const ZOOM_MIN = 0.4;
export const ZOOM_MAX = 2.5;

/** Zoom by `factor` around a point in screen space. */
export function zoomAround(t: Transform, factor: number, px: number, py: number): Transform {
  const k = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, t.k * factor));
  const ratio = k / t.k;
  return { k, x: px - (px - t.x) * ratio, y: py - (py - t.y) * ratio };
}

/** The transform that fits a `w × h` drawing into a `vw × vh` viewport. */
/** The zoom below which node words stop being readable; the first view never goes under it. */
export const READABLE_ZOOM = 0.7;

/**
 * The first view of a graph: the whole graph when it fits at a readable zoom, otherwise the readable zoom anchored at
 * the top left (the first tasks), with the rest a pan away.
 */
export function readableTransform(w: number, h: number, vw: number, vh: number, pad = 16): Transform {
  const fitted = fitTransform(w, h, vw, vh, pad);
  if (fitted.k >= READABLE_ZOOM) return fitted;
  const k = READABLE_ZOOM;
  return { k, x: w * k < vw ? (vw - w * k) / 2 : pad, y: h * k < vh ? (vh - h * k) / 2 : pad };
}

export function fitTransform(w: number, h: number, vw: number, vh: number, pad = 16): Transform {
  if (w <= 0 || h <= 0 || vw <= 0 || vh <= 0) return { x: 0, y: 0, k: 1 };
  const k = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, Math.min((vw - pad * 2) / w, (vh - pad * 2) / h, 1)));
  return { k, x: (vw - w * k) / 2, y: (vh - h * k) / 2 };
}

/**
 * Formation view of the Training Ground (BUILD §11.6): the task graph as a dependency diagram coloured by status
 * (icon + word on every node, never colour alone), laid out locally, with wheel/drag pan and zoom, zoom buttons,
 * and keyboard control (+ / − zoom, arrows pan, 0 fit; Tab through nodes, Enter selects).
 */
export function TaskGraph({ nodes, selectedId, onSelect, layout: layoutOpts, height = 480, className, "aria-label": ariaLabel = "Task graph" }: TaskGraphProps) {
  const layout = useMemo(() => layoutTaskGraph(nodes, layoutOpts), [nodes, layoutOpts]);
  const o = { ...DEFAULT_LAYOUT, ...layoutOpts };
  const hostRef = useRef<HTMLDivElement>(null);
  const [t, setT] = useState<Transform>({ x: 16, y: 16, k: 1 });
  const [size, setSize] = useState({ w: 0, h: height });
  const drag = useRef<{ x: number; y: number; tx: number; ty: number } | null>(null);
  const byId = useMemo(() => new Map(nodes.map((n) => [n.id, n])), [nodes]);
  // What a task graph is, on the header's hover (hosts often put their own Term on the panel, so no second button here).
  const taskGraph = useTerm("task_graph");

  const fit = useCallback(() => {
    const el = hostRef.current;
    const w = el?.clientWidth ?? 0;
    setT(fitTransform(layout.width, layout.height, w || layout.width + 32, height));
  }, [layout.width, layout.height, height]);
  const firstView = useCallback(() => {
    const el = hostRef.current;
    const w = el?.clientWidth ?? 0;
    setT(readableTransform(layout.width, layout.height, w || layout.width + 32, height));
  }, [layout.width, layout.height, height]);

  useEffect(() => {
    const el = hostRef.current;
    if (!el) return;
    const measure = () => setSize({ w: el.clientWidth, h: height });
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [height]);

  useEffect(() => {
    firstView();
  }, [firstView, size.w]);

  const onWheel = (e: WheelEvent<HTMLDivElement>) => {
    e.preventDefault();
    const rect = e.currentTarget.getBoundingClientRect();
    setT((prev) => zoomAround(prev, e.deltaY < 0 ? 1.1 : 1 / 1.1, e.clientX - rect.left, e.clientY - rect.top));
  };
  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    if ((e.target as HTMLElement).closest("[data-node]")) return;
    drag.current = { x: e.clientX, y: e.clientY, tx: t.x, ty: t.y };
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d) return;
    setT((prev) => ({ ...prev, x: d.tx + (e.clientX - d.x), y: d.ty + (e.clientY - d.y) }));
  };
  const onPointerUp = () => {
    drag.current = null;
  };
  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.target !== e.currentTarget) return;
    const stepPx = 40;
    switch (e.key) {
      case "+":
      case "=":
        setT((p) => zoomAround(p, 1.2, size.w / 2, height / 2));
        break;
      case "-":
      case "_":
        setT((p) => zoomAround(p, 1 / 1.2, size.w / 2, height / 2));
        break;
      case "0":
        fit();
        break;
      case "ArrowLeft":
        setT((p) => ({ ...p, x: p.x + stepPx }));
        break;
      case "ArrowRight":
        setT((p) => ({ ...p, x: p.x - stepPx }));
        break;
      case "ArrowUp":
        setT((p) => ({ ...p, y: p.y + stepPx }));
        break;
      case "ArrowDown":
        setT((p) => ({ ...p, y: p.y - stepPx }));
        break;
      default:
        return;
    }
    e.preventDefault();
  };

  const present = Array.from(new Set(nodes.map((n) => n.status)));

  return (
    <div className={cn("flex min-w-0 flex-col surface-panel overflow-hidden", className)} data-task-graph>
      <div className="flex h-panel-header shrink-0 items-center gap-2 px-panel-pad pr-2 rule-fade">
        <Tooltip content={taskGraph ? `${taskGraph.word}: ${taskGraph.short}` : null}>
          <span className="t-title flex-1 text-primary">
            Task graph <span className="font-mono text-micro font-normal text-tertiary">· {nodes.length} tasks</span>
          </span>
        </Tooltip>
        <span className="font-mono text-micro text-tertiary tabular-nums" aria-live="polite">
          {Math.round(t.k * 100)}%
        </span>
        <IconButton icon={Minus} label="Zoom out" size="sm" onClick={() => setT((p) => zoomAround(p, 1 / 1.2, size.w / 2, height / 2))} />
        <IconButton icon={Plus} label="Zoom in" size="sm" onClick={() => setT((p) => zoomAround(p, 1.2, size.w / 2, height / 2))} />
        <IconButton icon={Focus} label="Fit to view" size="sm" onClick={fit} />
      </div>
      <div
        ref={hostRef}
        role="application"
        aria-label={`${ariaLabel}. Use plus and minus to zoom, arrow keys to pan, 0 to fit.`}
        tabIndex={0}
        onWheel={onWheel}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onKeyDown={onKey}
        style={{ height }}
        className="graph-canvas relative min-w-0 cursor-grab touch-none select-none overflow-hidden outline-none focus-visible:shadow-ring active:cursor-grabbing"
        data-scroll-region="graph"
      >
        <svg width="100%" height={height} role="img" aria-label={ariaLabel} className="block">
          <defs>
            <marker id="tg-arrow" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="8" markerHeight="8" orient="auto-start-reverse">
              <path d="M 0 0 L 8 4 L 0 8 z" fill="var(--line-strong)" />
            </marker>
          </defs>
          <g transform={`translate(${t.x} ${t.y}) scale(${t.k})`} data-transform={`${t.x.toFixed(1)},${t.y.toFixed(1)},${t.k.toFixed(3)}`}>
            {layout.edges.map((e) => {
              const from = byId.get(e.from);
              const done = from?.status === "done";
              return <path key={`${e.from}->${e.to}`} d={e.path} fill="none" strokeWidth={1.5} markerEnd="url(#tg-arrow)" stroke={done ? "color-mix(in oklab, var(--status-good) 60%, transparent)" : "var(--line-strong)"} strokeDasharray={done ? undefined : "4 3"} strokeLinecap="round" />;
            })}
            {layout.nodes.map((p) => {
              const n = byId.get(p.id);
              if (!n) return null;
              const meta = TASK_STATUS_META[n.status];
              const selected = selectedId === n.id;
              const pct = n.progress !== undefined ? Math.round(n.progress * 100) : null;
              return (
                <g
                  key={n.id}
                  data-node={n.id}
                  data-status={n.status}
                  transform={`translate(${p.x} ${p.y})`}
                  role={onSelect ? "button" : undefined}
                  tabIndex={onSelect ? 0 : undefined}
                  aria-label={`${n.title}, ${meta.word}${n.agent ? `, ${n.agent.name}` : ""}${pct !== null ? `, ${pct}%` : ""}`}
                  aria-pressed={onSelect ? selected : undefined}
                  onClick={() => onSelect?.(n.id)}
                  onKeyDown={(e) => {
                    if (onSelect && (e.key === "Enter" || e.key === " ")) {
                      e.preventDefault();
                      onSelect(n.id);
                    }
                  }}
                  className={cn("outline-none", onSelect && "cursor-pointer")}
                >
                  <rect width={o.nodeWidth} height={o.nodeHeight} rx={8} fill="var(--surface-1)" className={cn(selected ? "stroke-kit-lift" : TONE_STROKE[meta.tone])} strokeWidth={selected ? 2 : 1} />
                  <rect x={0.5} y={8} width={2.5} height={o.nodeHeight - 16} rx={1.25} className={TONE_FILL[meta.tone]} />
                  {n.agent ? <g transform="translate(12 10)" dangerouslySetInnerHTML={{ __html: generateAvatar({ seed: n.agent.seed, dept: n.agent.dept, size: 20, title: n.agent.name }) }} /> : <circle cx={22} cy={20} r={10} fill="var(--surface-3)" />}
                  {/* The title wraps to two lines (HTML inside the node), so a task name is read, not guessed. */}
                  <foreignObject x={40} y={7} width={o.nodeWidth - 48} height={34}>
                    <div className="line-clamp-2 break-words font-body text-small font-medium leading-4 text-primary" title={n.title}>
                      {n.title}
                    </div>
                  </foreignObject>
                  <g transform={`translate(40 ${o.nodeHeight - 20})`} className={TONE_TEXT[meta.tone]}>
                    <Icon icon={meta.icon} size={12} x={0} y={0} />
                    <text x={16} y={10} className="fill-current font-body text-micro font-medium">
                      {meta.word}
                    </text>
                  </g>
                  {pct !== null && n.status !== "done" ? (
                    <text x={o.nodeWidth - 10} y={o.nodeHeight - 10} textAnchor="end" className="fill-tertiary font-mono text-micro tabular-nums">
                      {pct}%
                    </text>
                  ) : null}
                  {pct !== null ? <rect x={8} y={o.nodeHeight - 3} width={Math.max(0, (o.nodeWidth - 16) * (pct / 100))} height={2} rx={1} className={TONE_FILL[meta.tone]} /> : null}
                </g>
              );
            })}
          </g>
        </svg>
        <ul className="sr-only" aria-label="Dependencies">
          {nodes.map((n) => (
            <li key={n.id}>
              {n.title}: {TASK_STATUS_META[n.status].word}
              {n.deps.length ? `, after ${n.deps.map((d) => byId.get(d)?.title ?? d).join(", ")}` : ""}
            </li>
          ))}
        </ul>
      </div>
      <div className="flex min-h-control-lg shrink-0 flex-wrap items-center gap-1.5 border-t border-line px-panel-pad py-1.5" role="group" aria-label="Legend">
        {present.map((s) => (
          <StatusPill key={s} tone={TASK_STATUS_META[s].tone} icon={TASK_STATUS_META[s].icon}>
            {TASK_STATUS_META[s].word}
          </StatusPill>
        ))}
      </div>
    </div>
  );
}
