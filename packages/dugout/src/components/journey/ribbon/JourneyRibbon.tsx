"use client";
import { forwardRef, useCallback, useEffect, useId, useImperativeHandle, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent as ReactPointerEvent } from "react";
import { ArrowDownRight, ArrowUpRight, Banknote, CalendarDays, Diamond, Flag, Landmark, Rocket, Trophy } from "lucide-react";
import { ParentSize } from "@visx/responsive";
import { cn } from "../../../lib/cn";
import { formatMoney, formatNumber, type DateFormatters } from "../../../lib/format";
import { useFormatters } from "../../foundation/DateFormatProvider";
import { usePrefersReducedMotion } from "../../../lib/reducedMotion";
import { Button } from "../../foundation/Button";
import { FitText } from "../../foundation/FitText";
import { Icon } from "../../foundation/Icon";
import { SegmentedControl } from "../../foundation/SegmentedControl";
import { Figure } from "../../data/Figure";
import type { Chapter, Conversion, DayKey, ForecastPoint, JourneyDailyRow, Kit, Milestone, RibbonDepartment, RibbonEvent, RoadmapFlag, ZoomLevel } from "../types";
import { ZOOM_LEVELS } from "../types";
import {
  buildRibbonGeometry,
  clampScroll,
  forecastAt,
  indexDailyRows,
  revealWidth,
  scrollForToday,
  scrollKeepingDay,
  summariseDay,
  toDayKey,
  windowTotals,
  ZOOM_LABELS,
  PIN_HEIGHT,
  PIN_LABEL_MAX,
  pinLaneY,
  placePinChips,
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
  /** The business's own currency (ISO 4217): every amount here is formatted in it. */
  currency: string;
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

/** The revenue colour: the brand lifted towards text-1 (kit-lift, derived per business), so it reads on the dark panel
 * whatever the brand. The line glows over a blurred under-stroke; the area is a three-stop fill of the same light. */
const REVENUE = "var(--kit-lift)";
const TRACK_FILL: Record<TrackKind, { fill: string; opacity: number }> = {
  signups: { fill: "var(--status-info)", opacity: 0.9 },
  payments: { fill: "var(--gold)", opacity: 1 },
  hours: { fill: "var(--text-secondary)", opacity: 0.28 },
};
const TRACK_LABEL: Record<TrackKind, string> = { signups: "New signups", payments: "Paying customers", hours: "Agent hours" };
const GLYPH_ICON: Record<MilestoneGlyphKind, typeof Trophy> = { trophy: Trophy, flag: Flag, diamond: Diamond, banner: Landmark };
const GLYPH_COLOUR: Record<MilestoneGlyphKind, string> = { trophy: "var(--gold)", flag: "var(--text-2)", diamond: "var(--accent)", banner: "var(--text-2)" };
/** Axis tick labels: mono 11 px, about 6.7 px a character (for keeping them inside the plot and apart). */
const TICK_CHAR = 6.7;
/** The keyboard's day cursor moves at least this far per arrow press (one day, or more when days are thinner). */
const KEY_STEP_PX = 4;
/** How close to the window's edge the keyboard's day may get before the Ribbon scrolls to follow it. */
const KEY_EDGE_PX = 48;
const RUNWAY_COLOUR = { neutral: "var(--text-secondary)", warn: "var(--status-warn)", bad: "var(--status-bad)" } as const;
/** A dark halo behind SVG text so labels stay legible over lines and bars. */
const HALO = { paintOrder: "stroke", stroke: "var(--surface-1)", strokeWidth: 3, strokeLinejoin: "round" } as const;

/** A pin's label on its chip: cut with an ellipsis past PIN_LABEL_MAX (the full label is in its title). */
const pinLabel = (label: string) => (label.length > PIN_LABEL_MAX ? `${label.slice(0, PIN_LABEL_MAX - 1)}…` : label);

function bannerIcon(kind: string) {
  if (kind === "funding") return Banknote;
  if (kind === "launch") return Rocket;
  return Landmark;
}

function money(amountMinor: number, currency: string): string {
  return formatMoney({ amountMinor: Math.round(amountMinor), currency }, { compact: amountMinor >= 100_000 });
}

function barLabel(kind: TrackKind, bar: TrackBar, f: DateFormatters): string {
  const when = bar.day === bar.dayEnd ? f.formatDate(bar.day) : f.formatRange(bar.day, bar.dayEnd, { withYear: true });
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
    currency,
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
  // Every date the ribbon prints (axis, Today tag, tooltips, runway) follows the signed-in person's format.
  const f = useFormatters();
  const datePrefs = f.prefs;
  const geometry: RibbonGeometry = useMemo(
    () => buildRibbonGeometry({ index, departments, conversions, milestones, chapters, forecast, roadmap, runwayMonths, today, horizonMonths, zoom, width: plotW, height: plotH, datePrefs }),
    [index, departments, conversions, milestones, chapters, forecast, roadmap, runwayMonths, today, horizonMonths, zoom, plotW, plotH, datePrefs],
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
      const elapsed = Math.max(0, now - start);
      rect.setAttribute("width", String(revealWidth(now, start, RIBBON_FLOW_IN_MS, plotW)));
      if (!started.sweep && pixiRef.current?.ready()) {
        started.sweep = true;
        pixiRef.current.sweep(RIBBON_FLOW_IN_MS - elapsed, kitHexRef.current || "#ffffff", { top: RIBBON_TOOLBAR + layout.revenueTop, bottom: RIBBON_TOOLBAR + layout.axisTop });
      }
      if (elapsed < RIBBON_FLOW_IN_MS) raf = requestAnimationFrame(tick);
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
  // The keyboard's day cursor (arrow keys): it drives the same scrubber, readout and On this day card as the pointer,
  // so the Ribbon stays one Tab stop instead of one per payment bar (WCAG 2.4.3; the bars sit in an aria-hidden SVG).
  const [keyDay, setKeyDay] = useState<DayKey | null>(null);
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
    if (p.inPlot) setKeyDay(null);
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

  const hoverDay = hoverX === null ? keyDay : geometry.dayAt(hoverX + scrollX);
  // Where the scrubber and the card sit: under the pointer, or on the keyboard's day.
  const cursorX = hoverX ?? (keyDay ? geometry.xOfDay(keyDay) - scrollX : null);
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

  /** Moves the keyboard's day cursor by whole days (at least one bar's width) and scrolls just enough to keep it in view. */
  const stepDay = (dir: -1 | 1) => {
    const from = hoverDay ?? today;
    const days = Math.max(1, Math.ceil(KEY_STEP_PX / geometry.pxPerDay));
    const next = geometry.dayAt(geometry.xOfDay(from) + dir * days * geometry.pxPerDay);
    setHoverX(null);
    setKeyDay(next);
    const x = geometry.xOfDay(next);
    const margin = Math.min(KEY_EDGE_PX, plotW / 4);
    updateScroll((s) => (x < s + margin ? x - margin : x > s + plotW - margin ? x - plotW + margin : s));
  };

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.target !== e.currentTarget && e.key !== "Escape") return;
    switch (e.key) {
      case "ArrowLeft":
      case "ArrowRight": {
        const dir = e.key === "ArrowLeft" ? -1 : 1;
        // Shift pans half a window; a plain arrow walks the days.
        if (e.shiftKey) updateScroll((s) => s + dir * 0.5 * plotW);
        else stepDay(dir);
        break;
      }
      case "Home":
        setKeyDay(null);
        updateScroll(scrollForToday(geometry, plotW));
        break;
      case "Escape":
        if (!keyDay) return;
        setKeyDay(null);
        break;
      case "+":
      case "=":
        changeZoom(ZOOM_LEVELS[Math.max(0, ZOOM_LEVELS.indexOf(zoom) - 1)] as ZoomLevel);
        break;
      case "-":
      case "_":
        changeZoom(ZOOM_LEVELS[Math.min(ZOOM_LEVELS.length - 1, ZOOM_LEVELS.indexOf(zoom) + 1)] as ZoomLevel);
        break;
      case "Enter": {
        // The day under the cursor: its one Customer Update when it holds exactly one payment, as a click on its bar does.
        const day = hoverDay ?? today;
        const x = geometry.xOfDay(day);
        const bar = geometry.tracks.payments.bars.find((b) => x >= b.x && x < b.x + Math.max(b.w, geometry.pxPerDay));
        if (bar) openBar(bar);
        else onOpenDay?.(day);
        break;
      }
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
  const visibleChapters = geometry.chapters.filter((c) => c.x1 >= vis0 && c.x0 <= vis1);
  const visibleRoadmap = geometry.roadmap.filter((r) => r.x >= vis0 - 200 && r.x <= vis1);
  // Axis labels stay inside the plot and never overlap: a label that would cross an edge is anchored to its tick on
  // the inside, and one that would touch the label before it is skipped (the tick mark stays).
  const axisLabels = useMemo(() => {
    const out: Array<{ x: number; label: string; anchor: "start" | "middle" | "end"; showLabel: boolean }> = [];
    let lastRight = -Infinity;
    for (const t of geometry.ticks) {
      const sx = t.x - scrollX;
      if (sx < 0 || sx > plotW) continue;
      const w = t.label.length * TICK_CHAR;
      let anchor: "start" | "middle" | "end" = "middle";
      let left = sx - w / 2;
      let right = sx + w / 2;
      if (left < 4) {
        anchor = "start";
        left = sx;
        right = sx + w;
      } else if (right > plotW - 4) {
        anchor = "end";
        left = sx - w;
        right = sx;
      }
      const showLabel = left >= lastRight + 14 && right <= plotW + 0.5 && left >= -0.5;
      if (showLabel) lastRight = right;
      out.push({ x: t.x, label: t.label, anchor, showLabel });
    }
    return out;
  }, [geometry.ticks, scrollX, plotW]);

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
  const summaryText = `${label ?? "Journey ribbon"}: ${f.formatDate(geometry.kickoff)} to ${f.formatDate(geometry.horizon)}. Revenue per day, new signups, paying customers and agent hours over time. ${departments.length} departments, ${formatNumber(totals.hours, { digits: 0 })} agent hours, ${totals.signups} signups, ${totals.activations} activations, ${totals.payments} payments, ${geometry.milestones.length} milestones. Zoom ${ZOOM_LABELS[zoom]}. Arrow keys move through the days, Shift with an arrow scrolls, plus and minus zoom, Home returns to today, Enter opens the day.`;

  const todayVisible = geometry.todayX >= vis0 && geometry.todayX <= vis1;
  const todayPoint = index.byDay.get(today);
  const todayRevenueY = geometry.revenue.y(todayPoint?.revenue7 ?? 0);
  const hoverRootX = cursorX === null ? 0 : RIBBON_GUTTER + cursorX;
  const cardLeft = cursorX === null ? 0 : hoverRootX + 16 + 288 > width ? Math.max(RIBBON_GUTTER, hoverRootX - 16 - 288) : hoverRootX + 16;

  // Row labels: the hovered day's values, or the last 7 days when nothing is hovered.
  const hoverPoint = hoverDay && hoverDay <= today ? (index.byDay.get(hoverDay) ?? null) : null;
  const readout = hoverDay
    ? {
        when: hoverDay === today ? "Today" : f.formatDate(hoverDay, "weekdayDate"),
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

  function openBar(bar: TrackBar) {
    if (bar.value === 1 && bar.ids.length === 1 && bar.ids[0]) onOpenJourney?.(bar.ids[0]);
    else onOpenDay?.(bar.day);
  }

  const todayTag = `Today · ${f.formatDateShort(today)}${liveCount > 0 ? ` · ${liveCount} live` : ""}`;
  // A chip is drawn while its day is in the window; the drop line carries it to the edge as it scrolls out.
  const inView = (p: { x: number }) => p.x - scrollX >= 0 && p.x - scrollX <= plotW;
  // The Today tag in window pixels: centred on Today, kept inside the plot. Its width is measured once drawn (an
  // estimate before that), so the pins can keep clear of exactly where it is.
  const todayTagRef = useRef<HTMLSpanElement>(null);
  const [todayTagW, setTodayTagW] = useState(0);
  useLayoutEffect(() => {
    const w = todayTagRef.current?.offsetWidth ?? 0;
    if (w > 0) setTodayTagW((prev) => (Math.abs(w - prev) > 0.5 ? w : prev));
  }, [todayTag, todayVisible]);
  const tagW = todayTagW || todayTag.length * 6.9 + 18;
  const todayTagCentre = Math.min(plotW - tagW / 2 - 2, Math.max(tagW / 2 + 2, geometry.todayX - scrollX));
  // Pins never overlap each other or the Today tag (placed for this window: flips at the edge, other lanes, icons).
  const chipPlacement = useMemo(
    () =>
      placePinChips(
        [
          ...geometry.milestones.filter(inView).map((m) => ({ id: m.id, x: m.x, y: m.y, label: m.showLabel ? pinLabel(m.label) : null })),
          ...geometry.roadmap.filter(inView).map((r) => ({ id: r.id, x: r.x, y: r.y, label: r.showLabel ? pinLabel(r.label) : null })),
        ],
        { scrollX, plotW, avoid: todayVisible ? { left: todayTagCentre - tagW / 2, right: todayTagCentre + tagW / 2, y: pinLaneY(0) } : null },
      ),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [geometry.milestones, geometry.roadmap, scrollX, plotW, todayVisible, todayTagCentre, tagW],
  );
  const pinY = (p: { id: string; y: number }) => chipPlacement.get(p.id)?.y ?? p.y;
  const pinStyle = (id: string) => {
    const c = chipPlacement.get(id);
    if (!c) return undefined;
    return c.anchor === "end" ? { right: plotW - c.right, top: c.y } : { left: c.left, top: c.y };
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
      className={cn("relative select-none overflow-hidden outline-none focus-visible:shadow-ring", drag.current?.moved ? "cursor-grabbing" : "cursor-crosshair", className)}
      style={{ width, height }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerLeave={onPointerLeave}
      onKeyDown={onKeyDown}
      onBlur={(e) => {
        // Leaving the Ribbon puts the label column back on the last 7 days.
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setKeyDay(null);
      }}
    >
      {/* Toolbar: what each mark means, and the zoom */}
      <div className="absolute inset-x-0 top-0 flex items-center justify-between gap-3 px-panel-pad rule-fade" style={{ height: RIBBON_TOOLBAR }} data-ribbon-control>
        <ul className="flex min-w-0 flex-wrap items-center gap-x-4 gap-y-1 text-small text-secondary" aria-label="Legend" data-ribbon-legend>
          <li className="flex items-center gap-1.5 whitespace-nowrap">
            <svg width={16} height={10} aria-hidden>
              <line x1={1} x2={15} y1={5} y2={5} stroke={REVENUE} strokeWidth={2} strokeLinecap="round" />
            </svg>
            Revenue
          </li>
          {geometry.forecast ? (
            <li className="flex items-center gap-1.5 whitespace-nowrap">
              <svg width={16} height={10} aria-hidden>
                <line x1={1} x2={15} y1={5} y2={5} stroke={REVENUE} strokeWidth={1.5} strokeDasharray="3 3" />
              </svg>
              Forecast
            </li>
          ) : null}
          <li className="flex items-center gap-1.5 whitespace-nowrap">
            <Icon icon={Trophy} size={13} className="text-gold" />
            Milestones
          </li>
          {geometry.roadmap.length > 0 ? (
            <li className="flex items-center gap-1.5 whitespace-nowrap">
              <Icon icon={Flag} size={13} className="text-tertiary" />
              Planned
            </li>
          ) : null}
        </ul>
        <div className="flex shrink-0 items-center gap-2">
          <SegmentedControl<ZoomLevel>
            aria-label="Zoom"
            value={zoom}
            onValueChange={changeZoom}
            options={ZOOM_LEVELS.map((z) => ({ value: z, label: ZOOM_LABELS[z] }))}
          />
          <Button size="sm" icon={CalendarDays} onClick={() => updateScroll(scrollForToday(geometry, plotW))} aria-label="Scroll to today">
            Today
          </Button>
        </div>
      </div>

      {/* Row labels with the values they show: the hero figure is the last 7 days' revenue, or the hovered day's */}
      <div className="absolute left-0" style={{ top: RIBBON_TOOLBAR, width: RIBBON_GUTTER, height: plotH }} data-ribbon-labels aria-hidden>
        <span aria-hidden className="absolute inset-y-0 right-0 w-px bg-linear-to-b from-transparent via-line to-transparent" />
        <div className="absolute inset-x-0 truncate px-panel-pad t-data" style={{ top: layout.chapterTop + 6 }} data-readout-when>
          {readout.when}
        </div>
        <div className="absolute inset-x-0 flex flex-col items-start gap-1 px-panel-pad" style={{ top: layout.chapterBottom + 10 }}>
          <div className="flex items-center gap-1.5 text-small text-secondary">
            <svg width={12} height={10} aria-hidden>
              <line x1={0} x2={12} y1={5} y2={5} stroke={REVENUE} strokeWidth={2} strokeLinecap="round" />
            </svg>
            Revenue
          </div>
          <FitText className="t-figure-hero -ml-0.5 text-primary" text={readout.revenue} minPx={26} truncate={false} tooltip={false} data-readout="revenue">
            <Figure value={readout.revenue} />
          </FitText>
          <div className="text-small text-secondary">{readout.revenueCaption}</div>
          {readout.revenueDay ? (
            <div className="text-small tabular-nums text-secondary" data-readout="revenue-day">
              {readout.revenueDay}
            </div>
          ) : null}
          {readout.trend !== null && Math.abs(readout.trend) >= 0.005 ? (
            <span
              className={cn(
                "chip-tone mt-1 inline-flex h-control-xs items-center gap-1 whitespace-nowrap rounded-pill border pl-1.5 pr-2 text-small font-medium tabular-nums",
                readout.trend > 0 ? "tone-status-good text-status-good" : "tone-status-bad text-status-bad",
              )}
              data-readout="trend"
            >
              <Icon icon={readout.trend > 0 ? ArrowUpRight : ArrowDownRight} size={13} strokeWidth={2} />
              {`${Math.round(Math.abs(readout.trend) * 100)}% vs prior week`}
            </span>
          ) : null}
        </div>
        {(["signups", "payments", "hours"] as const).map((kind) => {
          const band = layout.tracks[kind];
          return (
            <div key={kind} className="absolute inset-x-0 flex items-center gap-2 px-panel-pad text-small" style={{ top: band.top, height: band.bottom - band.top }}>
              <span className="size-2 shrink-0 rounded-xs" style={{ background: TRACK_FILL[kind].fill, opacity: kind === "hours" ? 0.6 : 1 }} />
              <span className="min-w-0 flex-1 truncate text-secondary">{TRACK_LABEL[kind]}</span>
              <span className="font-display text-display-sm font-semibold tabular-nums text-primary" data-readout={kind}>
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
          <filter id={`${uid}-under`} x="-5%" y="-30%" width="110%" height="160%">
            <feGaussianBlur stdDeviation="3.5" />
          </filter>
          <mask id={`${uid}-reveal`} maskUnits="userSpaceOnUse" x="0" y="0" width={plotW} height={plotH}>
            <rect ref={revealRef} x="0" y="0" width={revealed ? plotW : 0} height={plotH} fill="#fff" />
          </mask>
          <clipPath id={`${uid}-clip`}>
            <rect x="0" y="0" width={plotW} height={plotH} />
          </clipPath>
          <linearGradient id={`${uid}-revenue-fill`} x1="0" x2="0" y1="0" y2="1">
            <stop offset="0" stopColor={REVENUE} stopOpacity={0.3} />
            <stop offset="0.55" stopColor={REVENUE} stopOpacity={0.09} />
            <stop offset="1" stopColor={REVENUE} stopOpacity={0} />
          </linearGradient>
          <linearGradient id={`${uid}-today`} x1="0" x2="0" y1="0" y2="1">
            <stop offset="0" stopColor={REVENUE} stopOpacity={0.15} />
            <stop offset="0.35" stopColor={REVENUE} stopOpacity={0.95} />
            <stop offset="1" stopColor={REVENUE} stopOpacity={0.35} />
          </linearGradient>
          <pattern id={`${uid}-ahead`} width={7} height={7} patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
            <line x1={0} y1={0} x2={0} y2={7} stroke="var(--white)" strokeOpacity={0.045} strokeWidth={1.5} />
          </pattern>
        </defs>
        <g clipPath={`url(#${uid}-clip)`}>
          <g transform={`translate(${-scrollX} 0)`}>
            {/* Chapters: quarter bands along the top; the current one is lit */}
            {visibleChapters.map((c) => {
              const labelX = Math.max(c.x0, scrollX) + 10;
              const room = c.x1 - labelX - 10;
              const text = `${c.name} · ${c.label}`;
              const current = c.status === "current";
              return (
                <g key={c.id} data-chapter={c.id}>
                  <rect x={c.x0} y={layout.chapterTop} width={Math.max(0, c.x1 - c.x0)} height={layout.chapterBottom - layout.chapterTop} fill={current ? REVENUE : "var(--white)"} fillOpacity={current ? 0.07 : c.order % 2 === 0 ? 0.025 : 0.012} />
                  {current ? <line x1={c.x0} x2={c.x1} y1={layout.chapterBottom - 0.5} y2={layout.chapterBottom - 0.5} stroke={REVENUE} strokeOpacity={0.35} /> : null}
                  <line x1={c.x0} x2={c.x0} y1={layout.chapterTop} y2={layout.axisTop} stroke="var(--line)" strokeWidth={1} />
                  {room > 40 ? (
                    <text x={labelX} y={layout.chapterBottom - 8} fill={current ? "var(--text-1)" : c.status === "future" ? "var(--text-3)" : "var(--text-2)"} fontFamily="var(--font-body)" fontWeight={current ? 600 : 500} fontSize={12} style={{ cursor: onOpenChapter ? "pointer" : undefined }} onClick={() => onOpenChapter?.(c.id)}>
                      <title>{text}</title>
                      {text.length * 6.6 > room ? `${text.slice(0, Math.max(4, Math.floor(room / 6.6) - 1))}…` : text}
                    </text>
                  ) : null}
                </g>
              );
            })}
            <line x1={vis0} x2={vis1} y1={layout.chapterBottom + 0.5} y2={layout.chapterBottom + 0.5} stroke="var(--line)" />
            {/* Everything after Today is ahead: hatched */}
            <rect x={geometry.todayX} y={layout.chapterBottom + 1} width={Math.max(0, geometry.totalWidth - geometry.todayX)} height={layout.axisTop - layout.chapterBottom - 1} fill={`url(#${uid}-ahead)`} data-ahead />
            {/* Revenue gridlines: hairlines, the zero line a little stronger */}
            {geometry.revenue.ticks.map((v) => (
              <line key={v} x1={vis0} x2={vis1} y1={geometry.revenue.y(v) + 0.5} y2={geometry.revenue.y(v) + 0.5} stroke="var(--white)" strokeOpacity={v === 0 ? 0.1 : 0.045} />
            ))}
            {/* Bar-row baselines */}
            {(["signups", "payments", "hours"] as const).map((kind) => (
              <line key={kind} x1={vis0} x2={vis1} y1={layout.tracks[kind].bottom + 0.5} y2={layout.tracks[kind].bottom + 0.5} stroke="var(--white)" strokeOpacity={0.045} />
            ))}
          </g>

          {/* Data: masked for the flow-in */}
          <g mask={revealed ? undefined : `url(#${uid}-reveal)`}>
            <g transform={`translate(${-scrollX} 0)`}>
              {geometry.revenue.areaPath ? <path d={geometry.revenue.areaPath} fill={`url(#${uid}-revenue-fill)`} stroke="none" /> : null}
              {geometry.revenue.linePath ? (
                <>
                  <path d={geometry.revenue.linePath} fill="none" stroke={REVENUE} strokeWidth={5} strokeOpacity={0.45} strokeLinejoin="round" strokeLinecap="round" filter={`url(#${uid}-under)`} data-revenue-glow />
                  <path d={geometry.revenue.linePath} fill="none" stroke={REVENUE} strokeWidth={1.75} strokeLinejoin="round" strokeLinecap="round" data-revenue-line />
                </>
              ) : null}
              {geometry.forecast ? (
                <g data-forecast>
                  <path d={geometry.forecast.conePath} fill={REVENUE} fillOpacity={0.07} stroke="none" />
                  <path d={geometry.forecast.basePath} fill="none" stroke={REVENUE} strokeOpacity={0.8} strokeWidth={1.5} strokeDasharray="4 4" strokeLinecap="round" />
                </g>
              ) : null}
              {(["signups", "hours"] as const).map((kind) => (
                <g key={kind} data-track={kind} fill={TRACK_FILL[kind].fill} fillOpacity={TRACK_FILL[kind].opacity}>
                  {visibleBars(kind).map((b) => (
                    <rect key={b.key} x={b.x} y={b.y} width={b.w} height={b.h} rx={b.w >= 4 ? 1.5 : 0} data-bar={kind} data-count={b.value}>
                      <title>{barLabel(kind, b, f)}</title>
                    </rect>
                  ))}
                </g>
              ))}
              <g data-track="payments">
                {visibleBars("payments").map((b) => (
                  // A pointer target only: the keyboard reaches the same day through the Ribbon's arrow keys and Enter, so the
                  // bars add no Tab stops (and those inside this aria-hidden SVG would be announced as nothing).
                  <g
                    key={b.key}
                    data-marker="payment"
                    data-count={b.value}
                    data-label={barLabel("payments", b, f)}
                    className="cursor-pointer"
                    onClick={(e) => {
                      e.stopPropagation();
                      openBar(b);
                    }}
                  >
                    <title>{barLabel("payments", b, f)}</title>
                    <rect x={b.x} y={layout.tracks.payments.top} width={b.w} height={layout.tracks.payments.bottom - layout.tracks.payments.top} fill="transparent" />
                    <rect x={b.x} y={b.y} width={b.w} height={b.h} rx={b.w >= 4 ? 1.5 : 0} fill={TRACK_FILL.payments.fill} strokeWidth={1.5} />
                  </g>
                ))}
              </g>
            </g>
          </g>

          <g transform={`translate(${-scrollX} 0)`}>
            {/* Milestones: drop lines from their chips (drawn in HTML above) to the revenue baseline, with node dots */}
            {visibleMilestones.map((m) => (
              <g key={m.id} data-milestone={m.glyph}>
                <title>{`${m.label} · ${f.formatDate(m.day)}`}</title>
                <line x1={m.x} x2={m.x} y1={pinY(m) + PIN_HEIGHT} y2={m.stemTo} stroke={m.glyph === "trophy" ? "var(--gold)" : "var(--text-2)"} strokeOpacity={m.glyph === "trophy" ? 0.55 : 0.4} strokeWidth={1} strokeDasharray="1 3" strokeLinecap="round" />
                <circle cx={m.x} cy={pinY(m) + PIN_HEIGHT + 1} r={2} fill={m.glyph === "trophy" ? "var(--gold)" : "var(--text-1)"} />
                <circle cx={m.x} cy={m.stemTo} r={2.25} fill={m.glyph === "trophy" ? "var(--gold)" : "var(--text-2)"} stroke="var(--surface-1)" strokeWidth={1.5} />
              </g>
            ))}
            {/* Planned roadmap items: dashed (not measured), ghosted */}
            {visibleRoadmap.map((r) => (
              <g key={r.id} data-roadmap>
                <title>{`Planned: ${r.label} · ${f.formatDate(r.day)}`}</title>
                <line x1={r.x} x2={r.x} y1={pinY(r) + PIN_HEIGHT} y2={layout.revenueBottom} stroke="var(--text-2)" strokeOpacity={0.35} strokeWidth={1} strokeDasharray="1 3" strokeLinecap="round" />
                <circle cx={r.x} cy={pinY(r) + PIN_HEIGHT + 1} r={2} fill="none" stroke="var(--text-2)" strokeWidth={1} />
              </g>
            ))}
            {/* Runway: when the cash runs out (Estimate) */}
            {geometry.runway ? (
              <g data-runway={geometry.runway.tone}>
                {geometry.runway.inRange ? <line x1={geometry.runway.x} x2={geometry.runway.x} y1={layout.revenueTop} y2={layout.axisTop} stroke={RUNWAY_COLOUR[geometry.runway.tone]} strokeWidth={1.5} strokeDasharray="5 3" /> : null}
                <text
                  x={geometry.runway.inRange ? geometry.runway.x - 6 : Math.min(geometry.totalWidth, scrollX + plotW) - 8}
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
            {/* Forecast label at the end of the dashed line */}
            {geometry.forecast && geometry.todayX < scrollX + plotW - 120 ? (
              <text x={Math.min(geometry.forecast.x1, scrollX + plotW) - 12} y={Math.max(layout.revenueTop + 12, geometry.revenue.y(forecastFromToday?.[forecastFromToday.length - 1]?.upsideMinor ?? 0) - 10)} textAnchor="end" className="t-data" fill="var(--text-3)" fontSize={10.5} letterSpacing="0.09em">
                FORECAST
              </text>
            ) : null}
            {/* Today: a glowing line, its end dot with a halo; the tag is HTML above */}
            {todayVisible ? (
              <g data-today>
                <line x1={geometry.todayX} x2={geometry.todayX} y1={layout.chapterBottom} y2={layout.axisTop} stroke={REVENUE} strokeWidth={6} strokeOpacity={reduced ? 0.12 : 0.3} filter={`url(#${uid}-glow)`} />
                <line x1={geometry.todayX} x2={geometry.todayX} y1={layout.chapterBottom} y2={layout.axisTop} stroke={`url(#${uid}-today)`} strokeWidth={1.5} />
                <circle cx={geometry.todayX} cy={todayRevenueY} r={8} fill={REVENUE} fillOpacity={0.16} />
                <circle cx={geometry.todayX} cy={todayRevenueY} r={4} fill={REVENUE} stroke="var(--surface-1)" strokeWidth={2} />
              </g>
            ) : null}
            {/* SVG ripple fallback (SMIL) */}
            {svgRipples.map((r) => (
              <circle key={r.id} cx={r.x} cy={r.y} r={3} fill="none" stroke={r.kind === "payment" ? "var(--gold)" : REVENUE} strokeWidth={2} data-ripple={r.kind}>
                <animate attributeName="r" from="3" to="28" dur={`${RIPPLE_MS}ms`} fill="freeze" />
                <animate attributeName="opacity" from="1" to="0" dur={`${RIPPLE_MS}ms`} fill="freeze" />
              </circle>
            ))}
            {/* Time axis: ticks and labels kept inside the plot and apart */}
            <g data-axis>
              {axisLabels.map((t) => (
                <g key={t.x}>
                  <line x1={t.x} x2={t.x} y1={layout.axisTop} y2={layout.axisTop + 4} stroke="var(--line-strong)" />
                  {t.showLabel ? (
                    <text x={t.x} y={layout.axisTop + 17} textAnchor={t.anchor} className="chart-tick">
                      {t.label}
                    </text>
                  ) : null}
                </g>
              ))}
            </g>
            {/* Hover scrubber */}
            {cursorX !== null ? (
              <g data-scrubber data-key-day={hoverX === null ? keyDay ?? undefined : undefined}>
                <rect x={cursorX + scrollX - geometry.pxPerDay / 2} y={layout.chapterBottom} width={Math.max(1, geometry.pxPerDay)} height={layout.axisTop - layout.chapterBottom} fill="var(--white)" fillOpacity={0.05} />
                <line x1={cursorX + scrollX} x2={cursorX + scrollX} y1={layout.chapterBottom} y2={layout.axisTop + 4} stroke="var(--white)" strokeOpacity={0.45} strokeDasharray="2 3" />
              </g>
            ) : null}
          </g>

          {/* Revenue scale, pinned to the left edge of the window */}
          <g data-revenue-scale>
            {geometry.revenue.ticks
              .filter((v) => v > 0)
              .map((v) => (
                <text key={v} x={8} y={geometry.revenue.y(v) + 14} className="chart-tick" {...HALO}>
                  {`${money(v, currency)}/day`}
                </text>
              ))}
          </g>
        </g>
      </svg>

      {/* Pins and the Today tag: HTML chips over the plot (they size to their words), clipped to the plot */}
      <div className="pointer-events-none absolute overflow-hidden" style={{ left: RIBBON_GUTTER, top: RIBBON_TOOLBAR, width: plotW, height: plotH }} data-ribbon-pins aria-hidden>
        {visibleMilestones.filter(inView).map((m) => {
          const Glyph = m.glyph === "banner" ? bannerIcon(m.kind) : GLYPH_ICON[m.glyph];
          const placed = chipPlacement.get(m.id);
          if (!placed) return null;
          return (
            <span key={m.id} className={cn("pin-chip absolute", !placed.label && "px-1")} data-kind={m.glyph === "trophy" ? "milestone" : "release"} style={pinStyle(m.id)} data-pin={m.id}>
              <Glyph size={12} strokeWidth={2} color={GLYPH_COLOUR[m.glyph]} aria-hidden />
              {placed.label}
            </span>
          );
        })}
        {visibleRoadmap.filter(inView).map((r) => {
          const placed = chipPlacement.get(r.id);
          if (!placed) return null;
          return (
            <span key={r.id} className={cn("pin-chip absolute", !placed.label && "px-1")} data-kind="planned" style={pinStyle(r.id)} data-pin={r.id}>
              <Flag size={12} strokeWidth={2} aria-hidden />
              {placed.label}
            </span>
          );
        })}
        {todayVisible ? (
          <span ref={todayTagRef} className="today-pill absolute -translate-x-1/2" style={{ left: todayTagCentre, top: pinLaneY(0) }} data-today-tag>
            {todayTag}
          </span>
        ) : null}
      </div>
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
      {/* The keyboard's day, read out as it moves (the label column shows the same figures). */}
      <span className="sr-only" aria-live="polite" data-ribbon-day-readout>
        {keyDay && hoverX === null ? `${readout.when}: ${readout.revenue} ${readout.revenueCaption}${readout.revenueDay ? `, ${readout.revenueDay}` : ""}; ${readout.signups} new signups, ${readout.payments} paying customers, ${readout.hours} agent hours.` : ""}
      </span>
      {reduced && liveCount > 0 ? (
        <span className="absolute bottom-2 left-2 inline-flex items-center gap-1 rounded-xs bg-surface-2 px-1.5 t-label text-primary" data-live-count>
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
