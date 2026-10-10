"use client";
import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import * as ToastPrimitive from "@radix-ui/react-toast";
import { Circle, CircleCheck, CircleX, Info, TriangleAlert, X } from "lucide-react";
import { cn } from "../../lib/cn";
import { Button } from "./Button";
import { Icon, type IconComponent } from "./Icon";

export type ToastTone = "neutral" | "good" | "warn" | "bad" | "info";

export interface ToastAction {
  label: string;
  onClick: () => void;
  /** Screen-reader alternative describing how to perform the action elsewhere (Radix requirement). */
  altText?: string;
}

export interface ToastOptions {
  title: ReactNode;
  description?: ReactNode;
  tone?: ToastTone;
  /** Milliseconds; Infinity keeps it until dismissed. Default from the provider (5000). */
  duration?: number;
  action?: ToastAction;
  /** Foreground toasts interrupt screen readers; use for things the user asked for. */
  type?: "foreground" | "background";
  /** Reuse an id to update an existing toast in place. */
  id?: string;
  /** Override the tone's icon in the tile. */
  icon?: IconComponent;
}

export interface ToastRecord extends ToastOptions {
  id: string;
  open: boolean;
}

export interface ToastApi {
  toast: (opts: ToastOptions) => string;
  dismiss: (id: string) => void;
  dismissAll: () => void;
  toasts: readonly ToastRecord[];
}

const ToastContext = createContext<ToastApi | null>(null);

/** Access the toaster. Throws outside a ToastProvider. */
export function useToast(): ToastApi {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast must be used inside <ToastProvider>");
  return ctx;
}

/** Each tone's icon and the class that sets its light (`--tone`) for the tile and the timer. */
export const TOAST_TONES: Record<ToastTone, { icon: IconComponent; tone: string }> = {
  neutral: { icon: Circle, tone: "tone-secondary" },
  good: { icon: CircleCheck, tone: "tone-status-good" },
  warn: { icon: TriangleAlert, tone: "tone-status-warn" },
  bad: { icon: CircleX, tone: "tone-status-bad" },
  info: { icon: Info, tone: "tone-status-info" },
};

/** Where the stack sits. Bottom left of the content column (the default) never covers a primary action. */
export type ToastPosition = "bottom-left" | "bottom-right" | "top-right";

/** The column a bottom-left stack sits beside: the expanded sidebar (232 px), the collapsed one (64 px), or none. */
export type ToastSidebar = "expanded" | "collapsed" | "none";

/** A layout's say in where toasts go while it is mounted (see `useToastPlacement`). */
export interface ToastPlacementOptions {
  position: ToastPosition;
  /** For bottom-left: what the stack sits beside. Default "expanded". */
  sidebar?: ToastSidebar;
}

interface PlacementApi {
  register: (id: number, placement: ToastPlacementOptions) => void;
  unregister: (id: number) => void;
}
const ToastPlacementContext = createContext<PlacementApi | null>(null);
let placementSeq = 0;

/**
 * Layout-aware toasts: while the calling layout is mounted, the stack goes where it says (the most recently mounted
 * layout wins; unmounting hands back to the one before). The AppShell keeps it bottom left beside its sidebar, at the
 * sidebar's real width; a frame without a sidebar (first run, sign-in) sends it bottom right, so it never lands on the
 * first column of cards. A ToastProvider given an explicit `position` ignores layouts. No-op outside a provider.
 */
export function useToastPlacement(placement: ToastPlacementOptions): void {
  const api = useContext(ToastPlacementContext);
  const { position, sidebar } = placement;
  useEffect(() => {
    if (!api) return;
    const id = ++placementSeq;
    api.register(id, { position, sidebar });
    return () => api.unregister(id);
  }, [api, position, sidebar]);
}

/** `useToastPlacement` as an element, for server-rendered layouts: `<ToastPlacement position="bottom-right" />`. */
export function ToastPlacement(props: ToastPlacementOptions): null {
  useToastPlacement(props);
  return null;
}

/** At most this many toasts show in the stack; older ones wait hidden behind until a newer one leaves. */
export const TOAST_VISIBLE = 3;
/** Pixel gap between toasts when the stack fans out (tokens.css --toast-gap). */
export const TOAST_GAP = 8;

/**
 * Stack geometry: for each toast (oldest first, as stored) its depth from the front (0 = newest) and how far it moves
 * when the stack fans out, the sum of the newer toasts' heights plus gaps. Pure, for the component and its tests.
 */
export function toastStack(ids: readonly string[], heights: Readonly<Record<string, number>>, gap = TOAST_GAP): Record<string, { index: number; offset: number }> {
  const out: Record<string, { index: number; offset: number }> = {};
  let offset = 0;
  for (let i = ids.length - 1, index = 0; i >= 0; i--, index++) {
    const id = ids[i]!;
    out[id] = { index, offset };
    offset += (heights[id] ?? 0) + gap;
  }
  return out;
}

export interface ToastProviderProps {
  children: ReactNode;
  duration?: number;
  /**
   * Where toasts stack, fixed. Omit it to let the mounted layout decide (`useToastPlacement`): bottom left beside the
   * sidebar in the AppShell, bottom right in frames without one; bottom left when no layout has said.
   */
  position?: ToastPosition;
  /** Render the viewport here (default). Set false to place <Toaster /> yourself. */
  renderViewport?: boolean;
  /** Keep at most this many open; the oldest close first. */
  max?: number;
}

/** State + Radix provider. Put one at the app root; call useToast().toast({...}) anywhere below. */
export function ToastProvider({ children, duration = 5000, position: fixedPosition, renderViewport = true, max = 4 }: ToastProviderProps) {
  const [toasts, setToasts] = useState<ToastRecord[]>([]);
  const [placements, setPlacements] = useState<Array<{ id: number; placement: ToastPlacementOptions }>>([]);
  const placementApi = useMemo<PlacementApi>(
    () => ({
      register: (id, placement) => setPlacements((prev) => [...prev.filter((p) => p.id !== id), { id, placement }]),
      unregister: (id) => setPlacements((prev) => prev.filter((p) => p.id !== id)),
    }),
    [],
  );
  const layout = fixedPosition ? undefined : placements[placements.length - 1]?.placement;
  const position: ToastPosition = fixedPosition ?? layout?.position ?? "bottom-left";
  const sidebar: ToastSidebar = layout?.sidebar ?? "expanded";
  const [heights, setHeights] = useState<Record<string, number>>({});
  const seq = useRef(0);

  const dismiss = useCallback((id: string) => {
    setToasts((prev) => prev.map((t) => (t.id === id ? { ...t, open: false } : t)));
  }, []);

  const dismissAll = useCallback(() => setToasts((prev) => prev.map((t) => ({ ...t, open: false }))), []);

  const toast = useCallback(
    (opts: ToastOptions): string => {
      const id = opts.id ?? `toast-${++seq.current}`;
      setToasts((prev) => {
        const existing = prev.find((t) => t.id === id);
        const record: ToastRecord = { ...opts, id, open: true };
        if (existing) return prev.map((t) => (t.id === id ? record : t));
        const next = [...prev, record];
        // Close the oldest open toasts beyond the cap; they are removed once their exit animation ends.
        const open = next.filter((t) => t.open);
        if (open.length > max) {
          const toClose = new Set(open.slice(0, open.length - max).map((t) => t.id));
          return next.map((t) => (toClose.has(t.id) ? { ...t, open: false } : t));
        }
        return next;
      });
      return id;
    },
    [max],
  );

  const remove = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
    setHeights((prev) => {
      if (!(id in prev)) return prev;
      const next = { ...prev };
      delete next[id];
      return next;
    });
  }, []);

  const measure = useCallback((id: string, height: number) => {
    setHeights((prev) => (prev[id] === height ? prev : { ...prev, [id]: height }));
  }, []);

  const api = useMemo<ToastApi>(() => ({ toast, dismiss, dismissAll, toasts }), [toast, dismiss, dismissAll, toasts]);
  const stack = useMemo(() => toastStack(toasts.map((t) => t.id), heights), [toasts, heights]);
  const frontHeight = toasts.length ? heights[toasts[toasts.length - 1]!.id] : undefined;

  return (
    <ToastContext.Provider value={api}>
      <ToastPlacementContext.Provider value={placementApi}>
        <ToastPrimitive.Provider duration={duration} swipeDirection={position === "bottom-left" ? "left" : "right"} label="Notification">
          {children}
          {toasts.map((t) => (
            <Toast
              key={t.id}
              record={t}
              index={stack[t.id]?.index ?? 0}
              offset={stack[t.id]?.offset ?? 0}
              duration={t.duration ?? duration}
              frontHeight={frontHeight}
              onOpenChange={(open) => (open ? undefined : dismiss(t.id))}
              onRemoved={() => remove(t.id)}
              onMeasure={(h) => measure(t.id, h)}
            />
          ))}
          {renderViewport ? <Toaster position={position} sidebar={sidebar} /> : null}
        </ToastPrimitive.Provider>
      </ToastPlacementContext.Provider>
    </ToastContext.Provider>
  );
}

export interface ToasterProps {
  position?: ToastPosition;
  /** For bottom-left: what the stack sits beside (default the expanded sidebar). */
  sidebar?: ToastSidebar;
  className?: string;
}

/**
 * The viewport: a fixed stack 340 px wide, bottom left of the content column by default (clear of the sidebar, the
 * DecisionBar, Continue and dialog footers). The newest toast is in front; hovering or focusing the stack fans the
 * others out. F8 focuses it (Radix default hotkey).
 */
export function Toaster({ position = "bottom-left", sidebar = "expanded", className }: ToasterProps) {
  return <ToastPrimitive.Viewport data-dugout-toasts="" data-position={position} data-sidebar={sidebar} className={cn("toast-viewport", className)} />;
}

interface ToastProps {
  record: ToastRecord;
  index: number;
  offset: number;
  duration: number;
  /** The newest toast's height: older toasts are cut to it while the stack is collapsed. */
  frontHeight?: number;
  onOpenChange: (open: boolean) => void;
  onRemoved: () => void;
  onMeasure: (height: number) => void;
}

function Toast({ record, index, offset, duration, frontHeight, onOpenChange, onRemoved, onMeasure }: ToastProps) {
  const tone = TOAST_TONES[record.tone ?? "neutral"];
  const [paused, setPaused] = useState(false);
  const body = useRef<HTMLDivElement>(null);
  const timed = Number.isFinite(duration) && duration > 0;

  // The stack needs each toast's natural height to fan out without overlaps.
  useLayoutEffect(() => {
    const el = body.current;
    if (!el) return;
    // The content's height plus the toast's own borders (the toast itself is cut to the front's height when collapsed).
    const report = () => {
      const li = el.parentElement;
      onMeasure(el.offsetHeight + (li ? li.offsetHeight - li.clientHeight : 0));
    };
    report();
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(report);
    ro.observe(el);
    return () => ro.disconnect();
    // onMeasure is a fresh closure each render; the element is what matters.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const style = {
    "--toast-index": index,
    "--toast-offset": `${offset}px`,
    "--toast-duration": `${duration}ms`,
    ...(frontHeight ? { "--toast-front-h": `${frontHeight}px` } : null),
  } as CSSProperties;

  return (
    <ToastPrimitive.Root
      open={record.open}
      onOpenChange={onOpenChange}
      duration={record.duration}
      type={record.type ?? "foreground"}
      data-tone={record.tone ?? "neutral"}
      data-front={index === 0 || undefined}
      data-depth={index >= TOAST_VISIBLE ? "far" : undefined}
      data-paused={paused || undefined}
      onPause={() => setPaused(true)}
      onResume={() => setPaused(false)}
      onAnimationEnd={(e) => {
        // Only the toast's own exit counts: the timer bar's animation bubbles up too.
        if (e.target === e.currentTarget && !record.open) onRemoved();
      }}
      style={style}
      className={cn("toast surface-popover text-body text-primary", tone.tone)}
    >
      <div ref={body} className="flex items-start gap-3 p-3 pr-10">
        <span className="toast-tile" aria-hidden>
          <Icon icon={record.icon ?? tone.icon} />
        </span>
        <div className="flex min-w-0 flex-1 flex-col gap-0.5 pt-0.5">
          <ToastPrimitive.Title className="t-body-strong text-pretty">{record.title}</ToastPrimitive.Title>
          {record.description ? <ToastPrimitive.Description className="text-small text-pretty text-secondary">{record.description}</ToastPrimitive.Description> : null}
          {record.action ? (
            <ToastPrimitive.Action altText={record.action.altText ?? record.action.label} asChild>
              <Button size="sm" onClick={record.action.onClick} className="mt-1.5 self-start">
                {record.action.label}
              </Button>
            </ToastPrimitive.Action>
          ) : null}
        </div>
      </div>
      <ToastPrimitive.Close
        aria-label="Dismiss"
        className="absolute right-2 top-2 inline-flex size-control-xs items-center justify-center rounded-sm text-tertiary transition-colors duration-hover ease-out hover:bg-white/8 hover:text-primary focus-ring"
      >
        <Icon icon={X} size="inline" />
      </ToastPrimitive.Close>
      {timed && record.open ? <span aria-hidden className="toast-timer" data-toast-timer="" /> : null}
    </ToastPrimitive.Root>
  );
}
