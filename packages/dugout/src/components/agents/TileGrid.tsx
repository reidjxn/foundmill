"use client";
import { useCallback, useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { LayoutGrid, Network } from "lucide-react";
import type { AgentStatus, DeptColourToken } from "@foundmill/shared";
import { cn } from "../../lib/cn";
import { Avatar } from "../foundation/Avatar";
import { Icon } from "../foundation/Icon";

/** Grid sizes the Training Ground adapts to (BUILD §11.6). */
export const TILE_CAPACITIES = [1, 2, 4, 6, 9, 12, 16, 24] as const;
export type TileCapacity = (typeof TILE_CAPACITIES)[number];

const SHAPE: Record<TileCapacity, { cols: number; rows: number }> = {
  1: { cols: 1, rows: 1 },
  2: { cols: 2, rows: 1 },
  4: { cols: 2, rows: 2 },
  6: { cols: 3, rows: 2 },
  9: { cols: 3, rows: 3 },
  12: { cols: 4, rows: 3 },
  16: { cols: 4, rows: 4 },
  24: { cols: 6, rows: 4 },
};

export interface GridShape {
  capacity: TileCapacity;
  cols: number;
  rows: number;
  /** Tiles at or above 12 render compact. */
  compact: boolean;
}

/** The smallest capacity that fits `count` tiles (24 at most; the rest overflow). */
export function gridFor(count: number): GridShape {
  const capacity = TILE_CAPACITIES.find((c) => c >= Math.max(1, count)) ?? 24;
  return { capacity, ...SHAPE[capacity], compact: capacity >= 12 };
}

/** Which items are on screen: the first `max`, with the focused item swapped in when it would otherwise overflow. */
export function visibleItems<T extends { id: string }>(items: readonly T[], max: number, focusedId: string | null | undefined): { shown: T[]; overflow: T[] } {
  if (items.length <= max) return { shown: items.slice(), overflow: [] };
  let shown = items.slice(0, max);
  let overflow = items.slice(max);
  if (focusedId && !shown.some((i) => i.id === focusedId)) {
    const focused = overflow.find((i) => i.id === focusedId);
    if (focused) {
      const bumped = shown[shown.length - 1] as T;
      shown = [...shown.slice(0, -1), focused];
      overflow = [bumped, ...overflow.filter((i) => i.id !== focusedId)];
    }
  }
  return { shown, overflow };
}

/** Next index for an arrow key on a `cols`-wide grid; stays put at the edges. */
export function moveIndex(index: number, count: number, cols: number, key: string): number {
  switch (key) {
    case "ArrowRight":
      return Math.min(count - 1, index + 1);
    case "ArrowLeft":
      return Math.max(0, index - 1);
    case "ArrowDown":
      return index + cols < count ? index + cols : index;
    case "ArrowUp":
      return index - cols >= 0 ? index - cols : index;
    case "Home":
      return 0;
    case "End":
      return count - 1;
    default:
      return index;
  }
}

export interface TileGridItem {
  id: string;
  /** Accessible label for the cell and the overflow chip ("Juno: Add a bundle picker"). */
  label: string;
  avatar?: { name: string; seed: string | number; dept: DeptColourToken; status?: AgentStatus };
}

export interface TileRenderContext {
  focused: boolean;
  compact: boolean;
  /** Rendered in the rail beside the focused tile. */
  inRail: boolean;
}

export interface TileGridProps<T extends TileGridItem> {
  items: readonly T[];
  renderTile: (item: T, ctx: TileRenderContext) => ReactNode;
  /** Controlled focused tile (two-thirds width with a rail). */
  focusedId?: string | null;
  defaultFocusedId?: string | null;
  onFocusedChange?: (id: string | null) => void;
  /** On-screen cap, 1–24. Default 24. */
  maxTiles?: number;
  /** Rail tile height in px. Default 180. */
  railTileHeight?: number;
  className?: string;
  "aria-label"?: string;
}

/**
 * The Training Ground split-screen (BUILD §11.6, DESIGN §9): tiles on bg-base with 1 px gaps, grid adapting to
 * 1/2/4/6/9/12/16/24, an overflow strip for the rest, click (or Enter) to focus a tile at two-thirds width with a
 * rail of the others, arrow keys to move between tiles, Esc to leave focus.
 */
export function TileGrid<T extends TileGridItem>({ items, renderTile, focusedId: focusedProp, defaultFocusedId = null, onFocusedChange, maxTiles = 24, railTileHeight = 180, className, "aria-label": ariaLabel = "Agent tiles" }: TileGridProps<T>) {
  const [focusedState, setFocusedState] = useState<string | null>(defaultFocusedId);
  const focusedId = focusedProp === undefined ? focusedState : focusedProp;
  const setFocused = useCallback(
    (id: string | null) => {
      setFocusedState(id);
      onFocusedChange?.(id);
    },
    [onFocusedChange],
  );
  const cap = Math.max(1, Math.min(24, maxTiles));
  const { shown, overflow } = visibleItems(items, cap, focusedId);
  const shape = gridFor(shown.length);
  const focusedItem = focusedId ? shown.find((i) => i.id === focusedId) ?? null : null;
  const [activeIndex, setActiveIndex] = useState(0);
  const cellRefs = useRef<Array<HTMLDivElement | null>>([]);

  useEffect(() => {
    if (activeIndex >= shown.length) setActiveIndex(Math.max(0, shown.length - 1));
  }, [shown.length, activeIndex]);

  const onCellKey = (e: KeyboardEvent<HTMLDivElement>, index: number) => {
    if (e.target !== e.currentTarget) {
      // Keys typed inside a tile's own controls belong to them, except Esc leaving focus mode.
      if (e.key === "Escape" && focusedId) {
        setFocused(null);
        e.currentTarget.focus();
      }
      return;
    }
    const cols = focusedItem ? 1 : shape.cols;
    const next = moveIndex(index, shown.length, cols, e.key);
    if (next !== index) {
      e.preventDefault();
      setActiveIndex(next);
      cellRefs.current[next]?.focus();
      return;
    }
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      const item = shown[index];
      if (item) setFocused(focusedId === item.id ? null : item.id);
    } else if (e.key === "Escape" && focusedId) {
      e.preventDefault();
      setFocused(null);
    }
  };

  const cell = (item: T, index: number, ctx: TileRenderContext, style?: React.CSSProperties) => (
    <div
      key={item.id}
      ref={(el) => {
        cellRefs.current[index] = el;
      }}
      role="group"
      aria-label={item.label}
      aria-current={ctx.focused ? "true" : undefined}
      tabIndex={index === activeIndex ? 0 : -1}
      data-tile-id={item.id}
      data-focused={ctx.focused || undefined}
      onFocus={(e) => {
        if (e.target === e.currentTarget) setActiveIndex(index);
      }}
      onKeyDown={(e) => onCellKey(e, index)}
      style={style}
      className={cn("min-h-0 min-w-0 rounded-md outline-none focus-visible:shadow-ring", ctx.inRail && "shrink-0")}
    >
      {renderTile(item, ctx)}
    </div>
  );

  // Order cells so the focused tile is index 0 (keyboard order follows the visual order).
  const ordered = focusedItem ? [focusedItem, ...shown.filter((i) => i.id !== focusedItem.id)] : shown;

  return (
    <div className={cn("flex h-full min-h-0 flex-col", className)} data-capacity={shape.capacity} data-focused={focusedItem ? "true" : undefined}>
      {focusedItem ? (
        <div role="region" aria-label={ariaLabel} className="grid min-h-0 flex-1 grid-cols-3 gap-2 p-2">
          <div className="col-span-2 min-h-0 min-w-0">{cell(focusedItem, 0, { focused: true, compact: false, inRail: false })}</div>
          <div role="list" aria-label="Other tiles" className="flex min-h-0 flex-col gap-2 overflow-y-auto">
            {ordered.slice(1).map((item, i) => cell(item, i + 1, { focused: false, compact: true, inRail: true }, { height: railTileHeight }))}
          </div>
        </div>
      ) : (
        <div
          role="region"
          aria-label={ariaLabel}
          className="grid min-h-0 flex-1 gap-2 p-2"
          style={{ gridTemplateColumns: `repeat(${shape.cols}, minmax(0, 1fr))`, gridTemplateRows: `repeat(${shape.rows}, minmax(0, 1fr))` }}
        >
          {ordered.map((item, i) => cell(item, i, { focused: false, compact: shape.compact, inRail: false }))}
        </div>
      )}
      {overflow.length > 0 ? (
        <div role="list" aria-label={`${overflow.length} more agents`} className="flex h-control-lg shrink-0 items-center gap-1.5 overflow-x-auto border-t border-line px-2.5" data-testid="overflow-strip">
          <span className="t-data mr-1 shrink-0">+{overflow.length} more</span>
          {overflow.map((item) => (
            <button
              key={item.id}
              role="listitem"
              type="button"
              onClick={() => setFocused(item.id)}
              title={item.label}
              className="surface-raised pressable inline-flex h-control-sm shrink-0 items-center gap-1.5 rounded-pill pl-0.5 pr-2.5 text-small font-medium text-primary hover:brightness-125 focus-visible:shadow-ring"
            >
              {item.avatar ? <Avatar size={22} name={item.avatar.name} agent={{ seed: item.avatar.seed, dept: item.avatar.dept }} status={item.avatar.status} surface="surface-2" /> : null}
              <span className="whitespace-nowrap">{item.avatar?.name ?? item.label}</span>
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

export type GroundView = "tiles" | "formation";

export interface GroundViewToggleProps {
  value: GroundView;
  onChange: (view: GroundView) => void;
  className?: string;
}

/** Tiles / Task graph toggle for the Live sessions header (BUILD §11.6 "Formation view toggle"). */
export function GroundViewToggle({ value, onChange, className }: GroundViewToggleProps) {
  return (
    <div role="radiogroup" aria-label="Live sessions view" className={cn("seg-track h-control-sm", className)}>
      {(
        [
          { v: "tiles", label: "Tiles", icon: LayoutGrid },
          { v: "formation", label: "Task graph", icon: Network },
        ] as const
      ).map((o) => (
        <button
          key={o.v}
          type="button"
          role="radio"
          aria-checked={value === o.v}
          onClick={() => onChange(o.v)}
          className={cn("seg-item font-body text-action-sm font-medium focus-visible:shadow-ring", value === o.v && "tile-tab-on text-primary")}
        >
          <Icon icon={o.icon} size="inline" />
          {o.label}
        </button>
      ))}
    </div>
  );
}
