"use client";
import { forwardRef, useCallback, useEffect, useId, useImperativeHandle, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent as ReactPointerEvent } from "react";
import { Banknote, CalendarDays, Diamond, Flag, Landmark, Rocket, Trophy } from "lucide-react";
import { AxisBottom } from "@visx/axis";
import { ParentSize } from "@visx/responsive";
import { scaleLinear } from "@visx/scale";
import { cn } from "../../../lib/cn";
import { formatDate, formatMoney, formatNumber } from "../../../lib/format";
import { usePrefersReducedMotion } from "../../../lib/reducedMotion";
import { Button } from "../../foundation/Button";
import { Icon } from "../../foundation/Icon";
import type { Chapter, Conversion, ForecastPoint, JourneyDailyRow, Kit, Milestone, RibbonDepartment, RibbonEvent, RoadmapFlag, ZoomLevel } from "../types";
import { ZOOM_LEVELS } from "../types";
import {
  buildRibbonGeometry,
  clampScroll,
  forecastAt,
  indexDailyRows,
  scrollForToday,
  scrollKeepingDay,
  summariseDay,
  toDayKey,
  windowTotals,
  ZOOM_LABELS,
  type MilestoneGlyphKind,
  type RibbonGeometry,
  type TrackBar,
  type TrackKind,
} from "./geometry";
import { OnThisDayCard } from "./OnThisDayCard";
import { RibbonPixiLayer, RIPPLE_MS, type RibbonPixiLayerHandle } from "./RibbonPixiLayer";

export const RIBBON_FLOW_IN_MS = 1200;
export const RIBBON_DEFAULT_HEIGHT = 300;
/** Width of the row labels on the left. */
export const RIBBON_GUTTER = 184;
/** Height of the toolbar (legend and zoom) above the plot. */
export const RIBBON_TOOLBAR = 36;

export interface JourneyRibbonHandle {
  /** A live event ripples into the Today line (300 ms ring; a static counter under reduced motion). */
  ripple(event: RibbonEvent): void;
  scrollToToday(): void;
  setZoom(zoom: ZoomLevel): void;
  getZoom(): ZoomLevel;
}

export interface JourneyRibbonProps {
  rows: readonly JourneyDailyRow[];
  departments: readonly RibbonDepartment[];
  conversions?: readonly Conversion[];
  milestones?: readonly Milestone[];
  chapters?: readonly Chapter[];
  /** Today (DayKey or Date). Defaults to the last row's day. */
  today?: string | Date;
  /** First day of the journey. Defaults to the first row's day. */
  kickoff?: string;
  /** Revenue per day after Today: base, upside and downside. */
  forecast?: readonly ForecastPoint[];
  roadmap?: readonly RoadmapFlag[];
  /** Months of runway (Estimate). Omit when unknown. */
  runwayMonths?: number | null;
  /** Forecast horizon in months past Today. Default 6. */
  horizonMonths?: number;
  zoom?: ZoomLevel;
  defaultZoom?: ZoomLevel;
  onZoomChange?: (zoom: ZoomLevel) => void;
  onOpenJourney?: (conversionId: string) => void;
  onOpenDay?: (day: string) => void;
  onOpenChapter?: (chapterId: string) => void;
  /** The day under the pointer (null when it leaves), for a host that loads that day's details. */
  onHoverDay?: (day: string | null) => void;
  /**
   * Every conversion of a day, when the host has loaded them (`conversions` may only hold the most recent ones). The
   * hover card lists these instead of what `conversions` has for that day.
   */
  dayConversions?: (day: string) => readonly Conversion[] | undefined;
  /** Fixed width; otherwise the ribbon measures its parent. */
  width?: number;
  /** Fixed height; otherwise the ribbon fills its parent's height, never less than `minHeight`. */
  height?: number;
  /** Smallest height when filling the parent. Default 300. */
  minHeight?: number;
  /** Brand colours as hex for the canvas layer. Without it the layer reads --kit-primary from the DOM. */
  kit?: Kit;
  /** "pixi" (default): canvas overlay for the sweep and ripples; "svg": SMIL rings only; "none": no motion layer. */
  overlay?: "pixi" | "svg" | "none";
  /** Flow-in on first render (1.2 s). Default true; reduced motion disables it. */
  animateIn?: boolean;
  currency?: string;
  /** Accessible name. */
  label?: string;
  className?: string;
}

interface SvgRipple {
  id: number;
  x: number;
  y: number;
  kind: RibbonEvent["kind"];
}

/** The revenue colour: the brand colour lifted towards the text colour so it reads on the dark panel whatever the brand. */
const REVENUE = "color-mix(in oklab, var(--kit-primary) 55%, var(--text-primary))";
const TRACK_FILL: Record<TrackKind, { fill: string; opacity: number }> = {
  signups: { fill: "var(--accent-link)", opacity: 0.8 },
  payments: { fill: "var(--gold)", opacity: 1 },
  hours: { fill: "var(--text-secondary)", opacity: 0.5 },
};
const TRACK_LABEL: Record<TrackKind, string> = { signups: "New signups", payments: "Paying customers", hours: "Agent hours" };
const GLYPH_ICON: Record<MilestoneGlyphKind, typeof Trophy> = { trophy: Trophy, flag: Flag, diamond: Diamond, banner: Landmark };
const GLYPH_COLOUR: Record<MilestoneGlyphKind, string> = { trophy: "var(--gold)", flag: "var(--text-primary)", diamond: "var(--accent-link)", banner: "var(--text-primary)" };
const RUNWAY_COLOUR = { neutral: "var(--text-secondary)", warn: "var(--status-warn)", bad: "var(--status-bad)" } as const;
/** A dark halo behind SVG text so labels stay legible over lines and bars. */
const HALO = { paintOrder: "stroke", stroke: "var(--bg-panel)", strokeWidth: 3, strokeLinejoin: "round" } as const;

function bannerIcon(kind: string) {
  if (kind === "funding") return Banknote;
  if (kind === "launch") return Rocket;
  return Landmark;
}

function money(amountMinor: number, currency: string): string {
  return formatMoney({ amountMinor: Math.round(amountMinor), currency }, { compact: amountMinor >= 100_000 });
}

function barLabel(kind: TrackKind, bar: TrackBar): string {
  const when = bar.day === bar.dayEnd ? formatDate(bar.day) : `${formatDate(bar.day)} to ${formatDate(bar.dayEnd)}`;
  if (kind === "payments") {
    const what = bar.value === 1 ? "1 paying customer" : `${formatNumber(bar.value, { digits: 0 })} paying customers`;
    return bar.value === 1 && bar.ids.length === 1 ? `${what} on ${when}. Opens the Customer Update` : `${what}, ${when}. Opens the day`;
  }
  return `${formatNumber(bar.value, { maxDigits: 1 })} ${kind === "signups" ? "signups" : "agent hours"}, ${when}`;
}

/* ---------- Surface (fixed width) ---------- */

interface SurfaceProps extends Omit<JourneyRibbonProps, "width" | "height" | "minHeight"> {
  width: number;
  height: number;
}

const RibbonSurface = forwardRef<JourneyRibbonHandle, SurfaceProps>(function RibbonSurface(props, ref) {
  const {
    rows,
    departments,
    conversions = [],
    milestones = [],
    chapters = [],
    forecast,
    roadmap,
    runwayMonths,
    horizonMonths = 6,
    zoom: zoomProp,
    defaultZoom = "quarter",
    onZoomChange,
    onOpenJourney,
    onOpenDay,
    onOpenChapter,
    onHoverDay,
    dayConversions,
    width,
    height,
    kit,
    overlay = "pixi",
    animateIn = true,
    currency = "EUR",
    label,
    className,
  } = props;
  const reduced = usePrefersReducedMotion();
  const uid = useId().replace(/:/g, "");
  const rootRef = useRef<HTMLDivElement>(null);
  const revealRef = useRef<SVGRectElement>(null);
  const pixiRef = useRef<RibbonPixiLayerHandle>(null);
  const plotW = Math.max(120, width - RIBBON_GUTTER);
  const plotH = Math.max(224, height - RIBBON_TOOLBAR);

  const [zoomState, setZoomState] = useState<ZoomLevel>(defaultZoom);
  const zoom = zoomProp ?? zoomState;
  const changeZoom = useCallback(
    (z: ZoomLevel) => {
      if (zoomProp === undefined) setZoomState(z);
      onZoomChange?.(z);
    },
    [zoomProp, onZoomChange],
  );

  const todayKey = useMemo(() => (props.today ? toDayKey(props.today) : null), [props.today]);
  const index = useMemo(() => indexDailyRows(rows, departments, { kickoff: props.kickoff, last: todayKey ?? undefined }), [rows, departments, props.kickoff, todayKey]);
  const today = todayKey ?? index.last;
  const geometry: RibbonGeometry = useMemo(
    () => buildRibbonGeometry({ index, departments, conversions, milestones, chapters, forecast, roadmap, runwayMonths, today, horizonMonths, zoom, width: plotW, height: plotH }),
    [index, departments, conversions, milestones, chapters, forecast, roadmap, runwayMonths, today, horizonMonths, zoom, plotW, plotH],
  );
  const { layout } = geometry;

  // Scroll offset in plot pixels. Zoom changes keep the day at the window centre; the first layout anchors Today at 70 %.
  const [scrollX, setScrollX] = useState(() => scrollForToday(geometry, plotW));
  const centreDayRef = useRef<string | null>(null);
  const prevKeyRef = useRef<string>(`${zoom}:${plotW}:${geometry.totalDays}`);
  useLayoutEffect(() => {
    const key = `${zoom}:${plotW}:${geometry.totalDays}`;
    if (key === prevKeyRef.current) return;
    prevKeyRef.current = key;
    const centre = centreDayRef.current;
    setScrollX(centre ? scrollKeepingDay(centre, 0.5, geometry, plotW) : scrollForToday(geometry, plotW));
  }, [zoom, plotW, geometry]);
  const updateScroll = useCallback(
    (next: number | ((prev: number) => number)) => {
      setScrollX((prev) => {
        const value = clampScroll(typeof next === "function" ? next(prev) : next, geometry.totalWidth, plotW);
        centreDayRef.current = geometry.dayAt(value + plotW / 2);
        return value;
      });
    },
    [geometry, plotW],
  );

  // Flow-in: the data reveals left → right over 1.2 s (SVG mask width), the canvas layer sweeps a light edge with it.
  const [revealed, setRevealed] = useState(!animateIn || reduced);
  const kitHexRef = useRef<string>(kit?.primary ?? "");
  useEffect(() => {
    if (!kit?.primary && rootRef.current && typeof getComputedStyle === "function") {
      const v = getComputedStyle(rootRef.current).getPropertyValue("--kit-primary").trim();
      if (v) kitHexRef.current = v;
    } else if (kit?.primary) kitHexRef.current = kit.primary;
  }, [kit?.primary]);
  useEffect(() => {
    if (revealed) return;
    const rect = revealRef.current;
    if (!rect || typeof requestAnimationFrame !== "function") {
      setRevealed(true);
      return;
    }
    const start = performance.now();
    let raf = 0;
    const started = { sweep: false };
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / RIBBON_FLOW_IN_MS);
      const e = 1 - Math.pow(1 - t, 3);
      rect.setAttribute("width", String(Math.ceil(e * plotW)));
      if (!started.sweep && pixiRef.current?.ready()) {
        started.sweep = true;
        pixiRef.current.sweep(RIBBON_FLOW_IN_MS - (now - start), kitHexRef.current || "#ffffff", { top: RIBBON_TOOLBAR + layout.revenueTop, bottom: RIBBON_TOOLBAR + layout.axisTop });
      }
      if (t < 1) raf = requestAnimationFrame(tick);
      else setRevealed(true);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [revealed, plotW, layout.revenueTop, layout.axisTop]);

  // Live ripples into the Today line, on the row the event belongs to.
  const [svgRipples, setSvgRipples] = useState<SvgRipple[]>([]);
  const [liveCount, setLiveCount] = useState(0);
  const [liveText, setLiveText] = useState("");
  const rippleSeq = useRef(0);
  const [pixiUnavailable, setPixiUnavailable] = useState(false);
  const usePixi = overlay === "pixi" && !reduced && !pixiUnavailable;

  const ripple = useCallback(
    (event: RibbonEvent) => {
      setLiveCount((n) => n + 1);
      setLiveText(`${event.label ?? event.kind} just now`);
      if (reduced || overlay === "none") return;
      const track = event.kind === "payment" ? layout.tracks.payments : event.kind === "signup" || event.kind === "activation" ? layout.tracks.signups : layout.tracks.hours;
      const y = (track.top + track.bottom) / 2;
      const colour = event.kind === "payment" ? "#E8C56B" : kitHexRef.current || "#ffffff";
      if (usePixi && pixiRef.current?.ready()) {
        pixiRef.current.ripple({ x: RIBBON_GUTTER + geometry.todayX - scrollX, y: RIBBON_TOOLBAR + y, colour });
        return;
      }
      const id = ++rippleSeq.current;
      setSvgRipples((r) => [...r, { id, x: geometry.todayX, y, kind: event.kind }]);
      setTimeout(() => setSvgRipples((r) => r.filter((it) => it.id !== id)), RIPPLE_MS + 40);
    },
    [reduced, overlay, geometry, scrollX, layout, usePixi],
  );

  useImperativeHandle(
    ref,
    () => ({
      ripple,
      scrollToToday: () => updateScroll(scrollForToday(geometry, plotW)),
      setZoom: changeZoom,
      getZoom: () => zoom,
    }),
    [ripple, updateScroll, geometry, plotW, changeZoom, zoom],
  );

  // Wheel: horizontal scroll; ctrl/⌘ + wheel: zoom. Non-passive so the page does not scroll with the ribbon.
  const zoomRef = useRef(zoom);
  zoomRef.current = zoom;
  useEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      if (e.ctrlKey || e.metaKey) {
        const i = ZOOM_LEVELS.indexOf(zoomRef.current);
        const next = ZOOM_LEVELS[Math.max(0, Math.min(ZOOM_LEVELS.length - 1, i + (e.deltaY > 0 ? 1 : -1)))];
        if (next && next !== zoomRef.current) changeZoom(next);
        return;
      }
      const delta = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
      updateScroll((s) => s + delta);
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [changeZoom, updateScroll]);

  // Hover scrubber and drag scrolling. Positions are in plot pixels (right of the labels, under the toolbar).
  const [hoverX, setHoverX] = useState<number | null>(null);
  const drag = useRef<{ startX: number; startScroll: number; moved: boolean; pointerId: number } | null>(null);
  const plotPoint = (e: { clientX: number; clientY: number }): { x: number; inPlot: boolean } => {
    const rect = rootRef.current?.getBoundingClientRect();
    const x = e.clientX - (rect?.left ?? 0) - RIBBON_GUTTER;
    const y = e.clientY - (rect?.top ?? 0) - RIBBON_TOOLBAR;
    return { x, inPlot: x >= 0 && x <= plotW && y >= 0 && y <= plotH };
  };
  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    if ((e.target as Element).closest("[data-ribbon-control]")) return;
    drag.current = { startX: e.clientX, startScroll: scrollX, moved: false, pointerId: e.pointerId };
  };
  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (d) {
      const dx = e.clientX - d.startX;
      if (!d.moved && Math.abs(dx) > 4) {
        d.moved = true;
        try {
          (e.currentTarget as HTMLElement).setPointerCapture(d.pointerId);
        } catch {
          /* capture is best effort */
        }
      }
      if (d.moved) {
        updateScroll(d.startScroll - dx);
        return;
      }
    }
    const p = plotPoint(e);
    setHoverX(p.inPlot ? p.x : null);
  };
  const onPointerUp = (e: ReactPointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    drag.current = null;
    if (d && !d.moved) {
      const target = e.target as Element;
      if (target.closest("[data-marker],[data-chapter],[data-ribbon-control],[data-on-this-day]")) return;
      const p = plotPoint(e);
      if (p.inPlot) onOpenDay?.(geometry.dayAt(p.x + scrollX));
    }
  };
  const onPointerLeave = () => {
    setHoverX(null);
    drag.current = null;
  };

  const hoverDay = hoverX === null ? null : geometry.dayAt(hoverX + scrollX);
  const onHoverDayRef = useRef(onHoverDay);
  onHoverDayRef.current = onHoverDay;
  useEffect(() => {
    onHoverDayRef.current?.(hoverDay);
  }, [hoverDay]);
  const hoverDayConversions = hoverDay ? dayConversions?.(hoverDay) : undefined;
  const hoverSummary = useMemo(
    () => (hoverDay ? summariseDay(hoverDay, { index, departments, conversions: hoverDayConversions ?? conversions, milestones, chapters, today }) : null),
    [hoverDay, hoverDayConversions, index, departments, conversions, milestones, chapters, today],
  );
  // The forecast starts from where revenue is today, as the drawn cone does.
  const forecastFromToday = useMemo(() => {
    const now = index.byDay.get(today)?.revenue7;
    return forecast && forecast.length > 0 && now !== undefined ? [{ day: today, baseMinor: now, upsideMinor: now, downsideMinor: now }, ...forecast.filter((f) => f.day > today)] : forecast;
  }, [forecast, index, today]);
  const hoverForecast = hoverDay && hoverDay > today ? forecastAt(forecastFromToday, hoverDay) : null;

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const step = (e.shiftKey ? 0.5 : 0.1) * plotW;
    switch (e.key) {
      case "ArrowLeft":
        updateScroll((s) => s - step);
        break;
      case "ArrowRight":
        updateScroll((s) => s + step);
        break;
      case "Home":
        updateScroll(scrollForToday(geometry, plotW));
        break;
      case "+":
      case "=":
        changeZoom(ZOOM_LEVELS[Math.max(0, ZOOM_LEVELS.indexOf(zoom) - 1)] as ZoomLevel);
        break;
      case "-":
      case "_":
        changeZoom(ZOOM_LEVELS[Math.min(ZOOM_LEVELS.length - 1, ZOOM_LEVELS.indexOf(zoom) + 1)] as ZoomLevel);
        break;
      case "Enter":
        if (e.target === e.currentTarget) onOpenDay?.(hoverDay ?? today);
        else return;
        break;
      default:
        return;
    }
    e.preventDefault();
  };

  // Culling: only elements near the window reach the DOM.
  const vis0 = scrollX - 48;
  const vis1 = scrollX + plotW + 48;
  const visibleBars = (kind: TrackKind) => geometry.tracks[kind].bars.filter((b) => b.x + b.w >= vis0 && b.x <= vis1);
  const visibleMilestones = geometry.milestones.filter((m) => m.x >= vis0 - 200 && m.x <= vis1);
  const visibleTicks = geometry.ticks.filter((t) => t.x >= vis0 && t.x <= vis1);
  const visibleChapters = geometry.chapters.filter((c) => c.x1 >= vis0 && c.x0 <= vis1);
  const visibleRoadmap = geometry.roadmap.filter((r) => r.x >= vis0 - 200 && r.x <= vis1);
  const tickScale = useMemo(() => scaleLinear<number>({ domain: [0, geometry.totalWidth], range: [0, geometry.totalWidth] }), [geometry.totalWidth]);
  const tickLabels = useMemo(() => new Map(geometry.ticks.map((t) => [t.x, t.label] as const)), [geometry.ticks]);

  const totals = useMemo(() => {
    let hours = 0;
    let signups = 0;
    let activations = 0;
    let payments = 0;
    for (const p of index.points) {
      hours += p.totalHours;
      signups += p.signups;
      activations += p.activations;
      payments += p.payments;
    }
    return { hours, signups, activations, payments };
  }, [index]);
  const recent = useMemo(() => windowTotals(index, today), [index, today]);
  const summaryText = `${label ?? "Journey ribbon"}: ${formatDate(geometry.kickoff)} to ${formatDate(geometry.horizon)}. Revenue per day, new signups, paying customers and agent hours over time. ${departments.length} departments, ${formatNumber(totals.hours, { digits: 0 })} agent hours, ${totals.signups} signups, ${totals.activations} activations, ${totals.payments} payments, ${geometry.milestones.length} milestones. Zoom ${ZOOM_LABELS[zoom]}. Arrow keys scroll, plus and minus zoom, Home returns to today, Enter opens the day.`;

  const todayVisible = geometry.todayX >= vis0 && geometry.todayX <= vis1;
  const todayPoint = index.byDay.get(today);
  const todayRevenueY = geometry.revenue.y(todayPoint?.revenue7 ?? 0);
  const hoverRootX = hoverX === null ? 0 : RIBBON_GUTTER + hoverX;
  const cardLeft = hoverX === null ? 0 : hoverRootX + 16 + 288 > width ? Math.max(RIBBON_GUTTER, hoverRootX - 16 - 288) : hoverRootX + 16;

  // Row labels: the hovered day's values, or the last 7 days when nothing is hovered.
  const hoverPoint = hoverDay && hoverDay <= today ? (index.byDay.get(hoverDay) ?? null) : null;
  const readout = hoverDay
    ? {
        when: hoverDay === today ? "Today" : formatDate(hoverDay, "EEE d MMM yyyy"),
        revenue: hoverPoint ? money(hoverPoint.revenue7, currency) : hoverForecast ? money(hoverForecast.baseMinor, currency) : "—",
        revenueCaption: hoverPoint ? "per day, 7-day average" : hoverForecast ? "per day, forecast" : "",
        revenueDay: hoverPoint ? `${money(hoverPoint.revenueMinor, currency)} on the day` : null,
        trend: null as number | null,
        signups: hoverPoint ? formatNumber(hoverPoint.signups, { digits: 0 }) : "—",
        payments: hoverPoint ? formatNumber(hoverPoint.payments, { digits: 0 }) : "—",
        hours: hoverPoint ? formatNumber(hoverPoint.totalHours, { maxDigits: 1 }) : "—",
      }
    : {
        when: "Last 7 days",
        revenue: money(recent.revenuePerDay, currency),
        revenueCaption: "per day, 7-day average",
        revenueDay: null as string | null,
        trend: recent.revenueChange,
        signups: formatNumber(recent.signups, { digits: 0 }),
        payments: formatNumber(recent.payments, { digits: 0 }),
        hours: formatNumber(recent.hours, { digits: 0 }),
      };
  const trackValue: Record<TrackKind, string> = { signups: readout.signups, payments: readout.payments, hours: readout.hours };

  const openBar = (bar: TrackBar) => {
    if (bar.value === 1 && bar.ids.length === 1 && bar.ids[0]) onOpenJourney?.(bar.ids[0]);
    else onOpenDay?.(bar.day);
  };

  return (
    <div
      ref={rootRef}
      role="group"
      aria-label={summaryText}
      aria-roledescription="journey ribbon"
      tabIndex={0}
      data-zoom={zoom}
      data-scroll-x={Math.round(scrollX)}
      data-revealed={revealed || undefined}
      className={cn("relative select-none overflow-hidden rounded-panel bg-panel outline-none focus-visible:outline-2 focus-visible:outline-link", drag.current?.moved ? "cursor-grabbing" : "cursor-crosshair", className)}
      style={{ width, height }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerLeave={onPointerLeave}
      onKeyDown={onKeyDown}
    >
      {/* Toolbar: what each mark means, and the zoom */}
      <div className="absolute inset-x-0 top-0 flex items-center justify-between gap-3 border-b border-subtle px-3" style={{ height: RIBBON_TOOLBAR }} data-ribbon-control>
        <ul className="flex min-w-0 items-center gap-4 text-small text-secondary" aria-label="Legend" data-ribbon-legend>
          <li className="flex items-center gap-1.5">
            <svg width={18} height={10} aria-hidden>
              <line x1={1} x2={17} y1={5} y2={5} stroke={REVENUE} strokeWidth={2} strokeLinecap="round" />
            </svg>
            Revenue
          </li>
          {geometry.forecast ? (
            <li className="flex items-center gap-1.5">
              <svg width={18} height={10} aria-hidden>
                <line x1={1} x2={17} y1={5} y2={5} stroke={REVENUE} strokeWidth={1.5} strokeDasharray="3 3" />
              </svg>
              Forecast
            </li>
          ) : null}
          <li className="flex items-center gap-1.5">
            <Icon icon={Trophy} size={12} className="text-gold" />
            <Icon icon={Flag} size={12} className="text-primary" />
            Milestones
          </li>
          {geometry.roadmap.length > 0 ? (
            <li className="flex items-center gap-1.5">
              <Icon icon={Flag} size={12} className="text-secondary opacity-60" />
              Planned
            </li>
          ) : null}
          <li className="hidden items-center gap-1.5 xl:flex">Hover for a day · click to open it</li>
        </ul>
        <div className="flex shrink-0 items-center gap-0.5" role="group" aria-label="Zoom">
          {ZOOM_LEVELS.map((z) => (
            <Button key={z} size="sm" variant="ghost" aria-pressed={z === zoom} className={cn("h-6 px-2", z === zoom && "bg-panel-alt text-primary")} onClick={() => changeZoom(z)} data-zoom-option={z}>
              {ZOOM_LABELS[z]}
            </Button>
          ))}
          <Button size="sm" variant="ghost" icon={CalendarDays} className="h-6 px-2" onClick={() => updateScroll(scrollForToday(geometry, plotW))} aria-label="Scroll to today">
            Today
          </Button>
        </div>
      </div>

      {/* Row labels with the values they show */}
      <div className="absolute left-0 border-r border-subtle" style={{ top: RIBBON_TOOLBAR, width: RIBBON_GUTTER, height: plotH }} data-ribbon-labels aria-hidden>
        <div className="absolute inset-x-0 truncate px-3 t-label" style={{ top: layout.chapterTop + 3 }} data-readout-when>
          {readout.when}
        </div>
        <div className="absolute inset-x-0 px-3" style={{ top: layout.revenueTop }}>
          <div className="flex items-center gap-1.5 text-small text-secondary">
            <svg width={10} height={10} aria-hidden>
              <line x1={0} x2={10} y1={5} y2={5} stroke={REVENUE} strokeWidth={2} />
            </svg>
            Revenue
          </div>
          <div className="t-display-sm tabular-nums text-primary" data-readout="revenue">
            {readout.revenue}
          </div>
          <div className="text-small text-secondary">{readout.revenueCaption}</div>
          {readout.revenueDay ? (
            <div className="text-small tabular-nums text-secondary" data-readout="revenue-day">
              {readout.revenueDay}
            </div>
          ) : null}
          {readout.trend !== null && Math.abs(readout.trend) >= 0.005 ? (
            <div className={cn("text-small tabular-nums", readout.trend > 0 ? "text-status-good" : "text-status-bad")} data-readout="trend">
              {`${readout.trend > 0 ? "▲" : "▼"} ${Math.round(Math.abs(readout.trend) * 100)}% vs prior week`}
            </div>
          ) : null}
        </div>
        {(["signups", "payments", "hours"] as const).map((kind) => {
          const band = layout.tracks[kind];
          return (
            <div key={kind} className="absolute inset-x-0 flex items-center gap-1.5 px-3 text-small" style={{ top: band.top, height: band.bottom - band.top }}>
              <span className="size-2 shrink-0 rounded-[2px]" style={{ background: TRACK_FILL[kind].fill, opacity: TRACK_FILL[kind].opacity }} />
              <span className="min-w-0 flex-1 truncate text-secondary">{TRACK_LABEL[kind]}</span>
              <span className="tabular-nums text-primary" data-readout={kind}>
                {trackValue[kind]}
              </span>
            </div>
          );
        })}
      </div>

      <svg width={plotW} height={plotH} viewBox={`0 0 ${plotW} ${plotH}`} className="absolute block" style={{ left: RIBBON_GUTTER, top: RIBBON_TOOLBAR }} aria-hidden focusable="false">
        <defs>
          <filter id={`${uid}-glow`} x="-400%" y="-10%" width="900%" height="120%">
            <feGaussianBlur stdDeviation="4" />
          </filter>
          <mask id={`${uid}-reveal`} maskUnits="userSpaceOnUse" x="0" y="0" width={plotW} height={plotH}>
            <rect ref={revealRef} x="0" y="0" width={revealed ? plotW : 0} height={plotH} fill="#fff" />
          </mask>
          <clipPath id={`${uid}-clip`}>
            <rect x="0" y="0" width={plotW} height={plotH} />
          </clipPath>
          <linearGradient id={`${uid}-revenue-fill`} x1="0" x2="0" y1="0" y2="1">
            <stop offset="0" stopColor={REVENUE} stopOpacity={0.28} />
            <stop offset="1" stopColor={REVENUE} stopOpacity={0.02} />
          </linearGradient>
          <pattern id={`${uid}-ahead`} width={8} height={8} patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
            <line x1={0} y1={0} x2={0} y2={8} stroke="var(--text-primary)" strokeOpacity={0.05} strokeWidth={2} />
          </pattern>
        </defs>
        <g clipPath={`url(#${uid}-clip)`}>
          <g transform={`translate(${-scrollX} 0)`}>
            {/* Chapters: quarter bands along the top, alternately shaded */}
            {visibleChapters.map((c) => {
              const labelX = Math.max(c.x0, scrollX) + 8;
              const room = c.x1 - labelX - 8;
              const text = `${c.name} · ${c.label}`;
              const current = c.status === "current";
              return (
                <g key={c.id} data-chapter={c.id} opacity={c.status === "future" ? 0.7 : 1}>
                  <rect x={c.x0} y={layout.chapterTop} width={Math.max(0, c.x1 - c.x0)} height={layout.chapterBottom - layout.chapterTop} fill={c.order % 2 === 0 ? "var(--bg-panel-alt)" : "var(--bg-panel)"} />
                  <line x1={c.x0} x2={c.x0} y1={layout.chapterTop} y2={layout.axisTop} stroke="var(--line-subtle)" strokeWidth={1} />
                  {room > 40 ? (
                    <text x={labelX} y={layout.chapterBottom - 6} fill={current ? "var(--text-primary)" : "var(--text-secondary)"} fontFamily="var(--font-body)" fontWeight={current ? 600 : 500} fontSize={11} style={{ cursor: onOpenChapter ? "pointer" : undefined }} onClick={() => onOpenChapter?.(c.id)}>
                      <title>{text}</title>
                      {text.length * 6.2 > room ? `${text.slice(0, Math.max(4, Math.floor(room / 6.2) - 1))}…` : text}
                    </text>
                  ) : null}
                </g>
              );
            })}
            {/* Everything after Today is ahead: hatched */}
            <rect x={geometry.todayX} y={layout.chapterBottom} width={Math.max(0, geometry.totalWidth - geometry.todayX)} height={layout.axisTop - layout.chapterBottom} fill={`url(#${uid}-ahead)`} data-ahead />
            {/* Revenue gridlines */}
            {geometry.revenue.ticks.map((v) => (
              <line key={v} x1={vis0} x2={vis1} y1={geometry.revenue.y(v)} y2={geometry.revenue.y(v)} stroke="var(--line-subtle)" strokeOpacity={v === 0 ? 1 : 0.6} strokeDasharray={v === 0 ? undefined : "2 4"} />
            ))}
            {/* Bar-row baselines */}
            {(["signups", "payments", "hours"] as const).map((kind) => (
              <line key={kind} x1={vis0} x2={vis1} y1={layout.tracks[kind].bottom + 0.5} y2={layout.tracks[kind].bottom + 0.5} stroke="var(--line-subtle)" />
            ))}
          </g>

          {/* Data: masked for the flow-in */}
          <g mask={revealed ? undefined : `url(#${uid}-reveal)`}>
            <g transform={`translate(${-scrollX} 0)`}>
              {geometry.revenue.areaPath ? <path d={geometry.revenue.areaPath} fill={`url(#${uid}-revenue-fill)`} stroke="none" /> : null}
              {geometry.revenue.linePath ? <path d={geometry.revenue.linePath} fill="none" stroke={REVENUE} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" data-revenue-line /> : null}
              {geometry.forecast ? (
                <g data-forecast>
                  <path d={geometry.forecast.conePath} fill={REVENUE} fillOpacity={0.12} stroke="none" />
                  <path d={geometry.forecast.basePath} fill="none" stroke={REVENUE} strokeWidth={1.5} strokeDasharray="4 4" />
                </g>
              ) : null}
              {(["signups", "hours"] as const).map((kind) => (
                <g key={kind} data-track={kind} fill={TRACK_FILL[kind].fill} fillOpacity={TRACK_FILL[kind].opacity}>
                  {visibleBars(kind).map((b) => (
                    <rect key={b.key} x={b.x} y={b.y} width={b.w} height={b.h} rx={b.w >= 4 ? 1 : 0} data-bar={kind} data-count={b.value}>
                      <title>{barLabel(kind, b)}</title>
                    </rect>
                  ))}
                </g>
              ))}
              <g data-track="payments">
                {visibleBars("payments").map((b) => (
                  <g
                    key={b.key}
                    role="button"
                    tabIndex={0}
                    data-marker="payment"
                    data-count={b.value}
                    aria-label={barLabel("payments", b)}
                    className="cursor-pointer outline-none focus-visible:[&>rect]:stroke-link"
                    onClick={(e) => {
                      e.stopPropagation();
                      openBar(b);
                    }}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        e.stopPropagation();
                        openBar(b);
                      }
                    }}
                  >
                    <title>{barLabel("payments", b)}</title>
                    <rect x={b.x} y={layout.tracks.payments.top} width={b.w} height={layout.tracks.payments.bottom - layout.tracks.payments.top} fill="transparent" />
                    <rect x={b.x} y={b.y} width={b.w} height={b.h} rx={b.w >= 4 ? 1 : 0} fill={TRACK_FILL.payments.fill} strokeWidth={1.5} />
                  </g>
                ))}
              </g>
            </g>
          </g>

          <g transform={`translate(${-scrollX} 0)`}>
            {/* Milestones: labelled pins over the revenue chart */}
            {visibleMilestones.map((m) => {
              const Glyph = m.glyph === "banner" ? bannerIcon(m.kind) : GLYPH_ICON[m.glyph];
              return (
                <g key={m.id} data-milestone={m.glyph}>
                  <title>{`${m.label} · ${formatDate(m.day)}`}</title>
                  <line x1={m.x} x2={m.x} y1={m.y + 13} y2={m.stemTo} stroke="var(--text-secondary)" strokeOpacity={0.5} strokeWidth={1} strokeDasharray="1 3" />
                  <Glyph x={m.x - 6} y={m.y} width={12} height={12} strokeWidth={2} color={GLYPH_COLOUR[m.glyph]} />
                  {m.showLabel ? (
                    <text x={m.x + 10} y={m.y + 10} fill="var(--text-primary)" fontFamily="var(--font-body)" fontSize={11} {...HALO}>
                      {m.label.length > 28 ? `${m.label.slice(0, 27)}…` : m.label}
                    </text>
                  ) : null}
                </g>
              );
            })}
            {/* Planned roadmap items, ghosted */}
            {visibleRoadmap.map((r) => (
              <g key={r.id} data-roadmap opacity={0.7}>
                <title>{`Planned: ${r.label} · ${formatDate(r.day)}`}</title>
                <line x1={r.x} x2={r.x} y1={r.y + 13} y2={layout.revenueBottom} stroke="var(--text-secondary)" strokeOpacity={0.5} strokeWidth={1} strokeDasharray="1 3" />
                <Flag x={r.x - 6} y={r.y} width={12} height={12} strokeWidth={2} color="var(--text-secondary)" />
                {r.showLabel ? (
                  <text x={r.x + 10} y={r.y + 10} fill="var(--text-secondary)" fontFamily="var(--font-body)" fontSize={11} fontStyle="italic" {...HALO}>
                    {r.label.length > 28 ? `${r.label.slice(0, 27)}…` : r.label}
                  </text>
                ) : null}
              </g>
            ))}
            {/* Runway: when the cash runs out (Estimate) */}
            {geometry.runway ? (
              <g data-runway={geometry.runway.tone}>
                {geometry.runway.inRange ? <line x1={geometry.runway.x} x2={geometry.runway.x} y1={layout.revenueTop} y2={layout.axisTop} stroke={RUNWAY_COLOUR[geometry.runway.tone]} strokeWidth={1.5} strokeDasharray="5 3" /> : null}
                <text
                  x={geometry.runway.inRange ? geometry.runway.x - 6 : geometry.totalWidth - 8}
                  y={layout.revenueBottom - 6}
                  textAnchor="end"
                  fill={RUNWAY_COLOUR[geometry.runway.tone]}
                  fontFamily="var(--font-body)"
                  fontSize={11}
                  fontWeight={600}
                  {...HALO}
                >
                  {`${geometry.runway.label} · Estimate`}
                </text>
              </g>
            ) : null}
            {/* Today */}
            {todayVisible ? (
              <g data-today>
                <line x1={geometry.todayX} x2={geometry.todayX} y1={layout.chapterBottom} y2={layout.axisTop} stroke={REVENUE} strokeWidth={6} strokeOpacity={reduced ? 0.15 : 0.35} filter={`url(#${uid}-glow)`} />
                <line x1={geometry.todayX} x2={geometry.todayX} y1={layout.chapterBottom} y2={layout.axisTop} stroke={REVENUE} strokeWidth={1.5} />
                <circle cx={geometry.todayX} cy={todayRevenueY} r={3.5} fill={REVENUE} stroke="var(--bg-panel)" strokeWidth={1.5} />
                <text x={geometry.todayX + 6} y={layout.chapterBottom + 14} fill="var(--text-primary)" fontFamily="var(--font-body)" fontWeight={600} fontSize={11} {...HALO}>
                  {`Today${liveCount > 0 ? ` · ${liveCount} live` : ""}`}
                </text>
                {geometry.forecast ? (
                  <text x={geometry.todayX + 8} y={Math.max(layout.revenueTop + 46, todayRevenueY - 8)} fill="var(--text-secondary)" fontFamily="var(--font-body)" fontSize={11} {...HALO}>
                    Forecast
                  </text>
                ) : null}
              </g>
            ) : null}
            {/* SVG ripple fallback (SMIL) */}
            {svgRipples.map((r) => (
              <circle key={r.id} cx={r.x} cy={r.y} r={3} fill="none" stroke={r.kind === "payment" ? "var(--gold)" : REVENUE} strokeWidth={2} data-ripple={r.kind}>
                <animate attributeName="r" from="3" to="28" dur={`${RIPPLE_MS}ms`} fill="freeze" />
                <animate attributeName="opacity" from="1" to="0" dur={`${RIPPLE_MS}ms`} fill="freeze" />
              </circle>
            ))}
            {/* Time axis */}
            <AxisBottom
              top={layout.axisTop}
              scale={tickScale}
              tickValues={visibleTicks.map((t) => t.x)}
              tickFormat={(v) => tickLabels.get(Number(v)) ?? ""}
              hideAxisLine
              tickLength={4}
              tickStroke="var(--line-subtle)"
              tickLabelProps={{ fill: "var(--text-secondary)", fontFamily: "var(--font-body)", fontSize: 12, textAnchor: "middle", dy: "0.25em" }}
            />
            {/* Hover scrubber */}
            {hoverX !== null ? (
              <g data-scrubber>
                <rect x={hoverX + scrollX - geometry.pxPerDay / 2} y={layout.chapterBottom} width={Math.max(1, geometry.pxPerDay)} height={layout.axisTop - layout.chapterBottom} fill="var(--text-primary)" fillOpacity={0.05} />
                <line x1={hoverX + scrollX} x2={hoverX + scrollX} y1={layout.chapterBottom} y2={layout.axisTop + 4} stroke="var(--text-primary)" strokeOpacity={0.5} strokeDasharray="2 3" />
              </g>
            ) : null}
          </g>

          {/* Revenue scale, pinned to the left edge of the window */}
          <g data-revenue-scale>
            {geometry.revenue.ticks
              .filter((v) => v > 0)
              .map((v) => (
                <text key={v} x={6} y={geometry.revenue.y(v) - 4} fill="var(--text-secondary)" fontFamily="var(--font-body)" fontSize={10} {...HALO}>
                  {`${money(v, currency)}/day`}
                </text>
              ))}
          </g>
        </g>
      </svg>
      <RibbonPixiLayer ref={pixiRef} width={width} height={height} enabled={usePixi} onUnavailable={() => setPixiUnavailable(true)} />
      {/* On this day */}
      {hoverSummary && !drag.current?.moved ? (
        <div className="pointer-events-none absolute z-10" style={{ left: cardLeft, top: RIBBON_TOOLBAR + 24 }}>
          <OnThisDayCard summary={hoverSummary} forecastPoint={hoverForecast} currency={currency} onOpenJourney={onOpenJourney} className="pointer-events-auto" />
        </div>
      ) : null}
      {/* Reduced motion / screen readers: the live event count with identical information */}
      <span className="sr-only" aria-live="polite">
        {liveText}
      </span>
      {reduced && liveCount > 0 ? (
        <span className="absolute bottom-2 left-2 inline-flex items-center gap-1 rounded-chip bg-panel-alt px-1.5 t-label text-primary" data-live-count>
          <Icon icon={CalendarDays} size={12} /> Live · {liveCount}
        </span>
      ) : null}
    </div>
  );
});

/* ---------- Public component ---------- */

/**
 * The Journey Ribbon (BUILD §11.2, DESIGN §8): the business's story on one time axis, as labelled rows. Revenue per
 * day (7-day average) with a money scale, the forecast after Today and the runway estimate; milestones as labelled
 * pins; bars for new signups, paying customers and agent hours; quarters as chapters along the top. The labels on the
 * left show the last 7 days, or the hovered day. Zoom Week / Month / Quarter / All time; wheel and drag scroll; click
 * opens a day; a single payment opens its Customer Update. Reduced motion renders the same picture with no animation
 * (AC-11.2.6).
 */
export const JourneyRibbon = forwardRef<JourneyRibbonHandle, JourneyRibbonProps>(function JourneyRibbon({ width, height, minHeight = RIBBON_DEFAULT_HEIGHT, className, ...rest }, ref) {
  if (width !== undefined && height !== undefined) return <RibbonSurface ref={ref} width={width} height={height} className={className} {...rest} />;
  return (
    <ParentSize debounceTime={50} ignoreDimensions={["top", "left"]} className={className} style={{ width: "100%", height: height ?? "100%", minHeight: height ?? minHeight }}>
      {({ width: w, height: h }) => (w > 0 || width !== undefined ? <RibbonSurface ref={ref} width={width ?? Math.floor(w)} height={height ?? Math.max(minHeight, Math.floor(h))} {...rest} /> : null)}
    </ParentSize>
  );
});
