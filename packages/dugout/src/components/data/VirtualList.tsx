"use client";
/**
 * VirtualList: a long list that draws only the rows near the viewport (the Inbox with hundreds of notes loaded). The
 * list element is its own scroll container, so the screen gives it a bounded height. Up to `virtualizeAfter` rows it
 * draws every row (nothing to measure, nothing to go wrong in a small list); above that, rows of unknown height are
 * measured as they appear, and the space of the rows above and below is held by two empty spacers so the scroll bar
 * stays honest. `scrollToIndex` brings a row into view even when it is not drawn yet (J/K through the Inbox).
 */
import { useVirtualizer } from "@tanstack/react-virtual";
import { forwardRef, useCallback, useImperativeHandle, useRef, type HTMLAttributes, type ReactNode, type Ref } from "react";
import { cn } from "../../lib/cn";

export interface VirtualListHandle {
  /** Scroll the row at `index` into view, by the least distance (nothing moves when it already is in view). */
  scrollToIndex: (index: number) => void;
}

export interface VirtualListProps<T> extends Omit<HTMLAttributes<HTMLUListElement>, "children"> {
  items: readonly T[];
  getKey: (item: T, index: number) => string;
  /** The row's content; the list wraps it in the `<li>`. `setSize` is the full count, for `aria-setsize` on options. */
  renderItem: (item: T, index: number, setSize: number) => ReactNode;
  /** Class names of each row's `<li>`. */
  rowClassName?: string;
  /** Expected row height in px until a row is measured. Default 72. */
  estimateSize?: number;
  /** Draw every row up to this many; virtualize above. Default 80. */
  virtualizeAfter?: number;
  /** Rows drawn beyond the viewport on each side. Default 8. */
  overscan?: number;
  /** Viewport height assumed where nothing is laid out (tests, the first server paint). Default 800. */
  fallbackHeight?: number;
}

function VirtualListInner<T>(
  { items, getKey, renderItem, rowClassName, estimateSize = 72, virtualizeAfter = 80, overscan = 8, fallbackHeight = 800, className, ...rest }: VirtualListProps<T>,
  ref: Ref<VirtualListHandle>,
) {
  const scrollRef = useRef<HTMLUListElement>(null);
  const isVirtual = items.length > virtualizeAfter;
  const virtualizer = useVirtualizer({
    count: isVirtual ? items.length : 0,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => estimateSize,
    overscan,
    getItemKey: (index) => {
      const item = items[index];
      return item === undefined ? index : getKey(item, index);
    },
    // A row that measures zero is not laid out (jsdom, a hidden tab): it keeps its estimate instead of collapsing.
    measureElement: (element, entry) => {
      const height = entry?.borderBoxSize?.[0]?.blockSize ?? element.getBoundingClientRect().height;
      return height > 0 ? height : estimateSize;
    },
    // The viewport is the list's own height; where nothing is laid out (jsdom), `fallbackHeight` stands in.
    observeElementRect: (instance, cb) => {
      const el = instance.scrollElement as HTMLElement | null;
      if (!el) return () => {};
      const report = () => cb({ width: el.clientWidth || 1, height: el.clientHeight || fallbackHeight });
      report();
      if (typeof ResizeObserver === "undefined") return () => {};
      const observer = new ResizeObserver(report);
      observer.observe(el);
      return () => observer.disconnect();
    },
  });

  const scrollToIndex = useCallback(
    (index: number) => {
      if (index < 0 || index >= items.length) return;
      if (isVirtual) virtualizer.scrollToIndex(index, { align: "auto" });
      else scrollRef.current?.querySelector<HTMLElement>(`[data-index="${index}"]`)?.scrollIntoView?.({ block: "nearest" });
    },
    [isVirtual, items.length, virtualizer],
  );
  useImperativeHandle(ref, () => ({ scrollToIndex }), [scrollToIndex]);

  const drawn = isVirtual ? virtualizer.getVirtualItems().map((v) => v.index) : items.map((_, i) => i);
  const before = isVirtual ? (virtualizer.getVirtualItems()[0]?.start ?? 0) : 0;
  const after = isVirtual ? Math.max(0, virtualizer.getTotalSize() - (virtualizer.getVirtualItems().at(-1)?.end ?? 0)) : 0;

  return (
    <ul ref={scrollRef} className={cn("overflow-y-auto", className)} data-virtual={isVirtual || undefined} {...rest}>
      {isVirtual ? <li role="presentation" aria-hidden style={{ height: before }} /> : null}
      {drawn.map((index) => {
        const item = items[index] as T;
        return (
          <li key={getKey(item, index)} role="presentation" data-index={index} ref={isVirtual ? virtualizer.measureElement : undefined} className={rowClassName}>
            {renderItem(item, index, items.length)}
          </li>
        );
      })}
      {isVirtual ? <li role="presentation" aria-hidden style={{ height: after }} /> : null}
    </ul>
  );
}

export const VirtualList = forwardRef(VirtualListInner) as <T>(props: VirtualListProps<T> & { ref?: Ref<VirtualListHandle> }) => ReturnType<typeof VirtualListInner>;
