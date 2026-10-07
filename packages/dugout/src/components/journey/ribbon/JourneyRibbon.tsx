"use client";
import { forwardRef, useCallback, useEffect, useId, useImperativeHandle, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent as ReactPointerEvent } from "react";
import { Banknote, CalendarDays, Diamond, Flag, Landmark, Rocket, Trophy } from "lucide-react";
import { AxisBottom } from "@visx/axis";
import { Group } from "@visx/group";
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
  indexDailyRows,
  scrollForToday,
  scrollKeepingDay,
  summariseDay,
  toDayKey,
  ZOOM_LABELS,
  type MarkerBucket,
  type MilestoneGlyphKind,
  type RibbonGeometry,
} from "./geometry";
import { OnThisDayCard } from "./OnThisDayCard";
import { RibbonPixiLayer, RIPPLE_MS, type RibbonPixiLayerHandle } from "./RibbonPixiLayer";

export const RIBBON_FLOW_IN_MS = 1200;
export const RIBBON_DEFAULT_HEIGHT = 300;

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
  /** Fixed width; otherwise the ribbon measures its parent. */
  width?: number;
  height?: number;
  /** Kit colours as hex for the canvas layer. Without it the layer reads --kit-primary from the DOM. */
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

const GLYPH_ICON: Record<MilestoneGlyphKind, typeof Trophy> = { trophy: Trophy, flag: Flag, diamond: Diamond, banner: Landmark };
const GLYPH_COLOUR: Record<MilestoneGlyphKind, string> = { trophy: "var(--gold)", flag: "var(--text-primary)", diamond: "var(--accent-link)", banner: "var(--text-primary)" };
const RUNWAY_COLOUR = { neutral: "var(--text-secondary)", warn: "var(--status-warn)", bad: "var(--status-bad)" } as const;
const KIND_WORD = { signup: "signup", activation: "activation", payment: "payment" } as const;

function markerLabel(m: MarkerBucket, currency: string): string {
  const when = m.day === m.dayEnd ? formatDate(m.day) : `${formatDate(m.day)} to ${formatDate(m.dayEnd)}`;
  const who = m.names.length === 1 && m.count === 1 ? ` · ${m.names[0]}` : "";
  const amount = m.kind === "payment" && m.amountMinor > 0 ? ` · ${formatMoney({ amountMinor: m.amountMinor, currency: m.currency || currency })}` : "";
  return m.count === 1 ? `${KIND_WORD[m.kind]} on ${when}${who}${amount}. Opens the Customer Update` : `${m.count} ${KIND_WORD[m.kind]}s, ${when}${amount}. Opens the day`;
}

function bannerIcon(kind: string) {
  if (kind === "funding") return Banknote;
  if (kind === "launch") return Rocket;
  return Landmark;
}

/* ---------- Surface (fixed width) ---------- */

interface SurfaceProps extends Omit<JourneyRibbonProps, "width" | "height"> {
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
    () => buildRibbonGeometry({ index, departments, conversions, milestones, chapters, forecast, roadmap, runwayMonths, today, horizonMonths, zoom, width, height }),
    [index, departments, conversions, milestones, chapters, forecast, roadmap, runwayMonths, today, horizonMonths, zoom, width, height],
  );
  const { layout } = geometry;

  // Scroll offset in ribbon pixels. Zoom changes keep the day at the window centre; the first layout anchors Today at 70 %.
  const [scrollX, setScrollX] = useState(() => scrollForToday(geometry, width));
  const centreDayRef = useRef<string | null>(null);
  const prevKeyRef = useRef<string>(`${zoom}:${width}:${geometry.totalDays}`);
  useLayoutEffect(() => {
    const key = `${zoom}:${width}:${geometry.totalDays}`;
    if (key === prevKeyRef.current) return;
    prevKeyRef.current = key;
    const centre = centreDayRef.current;
    setScrollX(centre ? scrollKeepingDay(centre, 0.5, geometry, width) : scrollForToday(geometry, width));
  }, [zoom, width, geometry]);
  const updateScroll = useCallback(
    (next: number | ((prev: number) => number)) => {
      setScrollX((prev) => {
        const value = clampScroll(typeof next === "function" ? next(prev) : next, geometry.totalWidth, width);
        centreDayRef.current = geometry.dayAt(value + width / 2);
        return value;
      });
    },
    [geometry, width],
  );

  // Flow-in: the river reveals left → right over 1.2 s (SVG mask width), the canvas layer sweeps a light edge with it.
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
      rect.setAttribute("width", String(Math.ceil(e * width)));
      if (!started.sweep && pixiRef.current?.ready()) {
        started.sweep = true;
        pixiRef.current.sweep(RIBBON_FLOW_IN_MS - (now - start), kitHexRef.current || "#ffffff", { top: layout.riverTop - 8, bottom: layout.riverBottom + 8 });
      }
      if (t < 1) raf = requestAnimationFrame(tick);
      else setRevealed(true);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [revealed, width, layout.riverTop, layout.riverBottom]);

  // Live ripples.
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
      const x = geometry.todayX - scrollX;
      const dept = event.departmentId ? departments.find((d) => d.id === event.departmentId) : undefined;
      const y = event.kind === "payment" || event.kind === "activation" || event.kind === "signup" ? layout.lanes[event.kind] : layout.riverMid;
      const colour = event.kind === "payment" ? "#E8C56B" : kitHexRef.current || "#ffffff";
      if (usePixi && pixiRef.current?.ready()) {
        pixiRef.current.ripple({ x, y, colour: dept && event.kind !== "payment" ? colour : colour });
        return;
      }
      const id = ++rippleSeq.current;
      setSvgRipples((r) => [...r, { id, x: geometry.todayX, y, kind: event.kind }]);
      setTimeout(() => setSvgRipples((r) => r.filter((it) => it.id !== id)), RIPPLE_MS + 40);
    },
    [reduced, overlay, geometry, scrollX, departments, layout, usePixi],
  );

  useImperativeHandle(
    ref,
    () => ({
      ripple,
      scrollToToday: () => updateScroll(scrollForToday(geometry, width)),
      setZoom: changeZoom,
      getZoom: () => zoom,
    }),
    [ripple, updateScroll, geometry, width, changeZoom, zoom],
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

  // Hover scrubber and drag scrolling.
  const [hoverX, setHoverX] = useState<number | null>(null);
  const drag = useRef<{ startX: number; startScroll: number; moved: boolean; pointerId: number } | null>(null);
  const localX = (e: { clientX: number }) => {
    const rect = rootRef.current?.getBoundingClientRect();
    return e.clientX - (rect?.left ?? 0);
  };
  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
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
    setHoverX(localX(e));
  };
  const onPointerUp = (e: ReactPointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    drag.current = null;
    if (d && !d.moved) {
      const target = e.target as Element;
      if (target.closest("[data-marker],[data-chapter],[data-ribbon-control],[data-on-this-day]")) return;
      onOpenDay?.(geometry.dayAt(localX(e) + scrollX));
    }
  };
  const onPointerLeave = () => {
    setHoverX(null);
    drag.current = null;
  };

  const hoverDay = hoverX === null ? null : geometry.dayAt(hoverX + scrollX);
  const hoverSummary = useMemo(() => (hoverDay ? summariseDay(hoverDay, { index, departments, conversions, milestones, chapters, today }) : null), [hoverDay, index, departments, conversions, milestones, chapters, today]);
  const hoverForecast = hoverDay && forecast ? (forecast.find((f) => f.day === hoverDay) ?? null) : null;

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const step = (e.shiftKey ? 0.5 : 0.1) * width;
    switch (e.key) {
      case "ArrowLeft":
        updateScroll((s) => s - step);
        break;
      case "ArrowRight":
        updateScroll((s) => s + step);
        break;
      case "Home":
        updateScroll(scrollForToday(geometry, width));
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
  const vis1 = scrollX + width + 48;
  const visibleMarkers = geometry.markers.filter((m) => m.x >= vis0 && m.x <= vis1);
  const visibleMilestones = geometry.milestones.filter((m) => m.x >= vis0 && m.x <= vis1);
  const visibleTicks = geometry.ticks.filter((t) => t.x >= vis0 && t.x <= vis1);
  const visibleChapters = geometry.chapters.filter((c) => c.x1 >= vis0 && c.x0 <= vis1);
  const visibleRoadmap = geometry.roadmap.filter((r) => r.x >= vis0 && r.x <= vis1);
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
  const summaryText = `${label ?? "Journey ribbon"}: ${formatDate(geometry.kickoff)} to ${formatDate(geometry.horizon)}. ${departments.length} departments, ${formatNumber(totals.hours, { digits: 0 })} agent hours, ${totals.signups} signups, ${totals.activations} activations, ${totals.payments} payments, ${geometry.milestones.length} milestones. Zoom ${ZOOM_LABELS[zoom]}. Arrow keys scroll, plus and minus zoom, Home returns to today, Enter opens the day.`;

  const todayVisible = geometry.todayX >= vis0 && geometry.todayX <= vis1;
  const cardLeft = hoverX === null ? 0 : hoverX + 16 + 288 > width ? Math.max(0, hoverX - 16 - 288) : hoverX + 16;

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
      <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} className="block" aria-hidden focusable="false">
        <defs>
          <filter id={`${uid}-glow`} x="-400%" y="-10%" width="900%" height="120%">
            <feGaussianBlur stdDeviation="4" />
          </filter>
          <mask id={`${uid}-reveal`} maskUnits="userSpaceOnUse" x="0" y="0" width={width} height={height}>
            <rect ref={revealRef} x="0" y="0" width={revealed ? width : 0} height={height} fill="#fff" />
          </mask>
          <clipPath id={`${uid}-clip`}>
            <rect x="0" y="0" width={width} height={height} />
          </clipPath>
        </defs>
        <g clipPath={`url(#${uid}-clip)`}>
          {/* Chapter captions along the top (DESIGN §8) */}
          <g transform={`translate(${-scrollX} 0)`}>
            {visibleChapters.map((c) => {
              const labelX = Math.max(c.x0, scrollX) + 8;
              const room = c.x1 - labelX;
              return (
                <g key={c.id} data-chapter={c.id} opacity={c.status === "future" ? 0.5 : 1}>
                  <line x1={c.x0} x2={c.x0} y1={0} y2={height - 1} stroke="var(--line-subtle)" strokeWidth={1} />
                  {room > 48 ? (
                    <text x={labelX} y={13} className="t-label" fill="var(--text-secondary)" fontFamily="var(--font-display)" fontWeight={600} fontSize={11} letterSpacing="0.06em" style={{ textTransform: "uppercase", cursor: onOpenChapter ? "pointer" : undefined }} onClick={() => onOpenChapter?.(c.id)}>
                      {`${c.chapter.id.replace("-", " ")} · ${c.label}`.toUpperCase().slice(0, Math.max(6, Math.floor(room / 7)))}
                    </text>
                  ) : null}
                </g>
              );
            })}
          </g>
          {/* River, revenue, forecast: masked for the flow-in */}
          <g mask={revealed ? undefined : `url(#${uid}-reveal)`}>
            <g transform={`translate(${-scrollX} 0)`}>
              <line x1={vis0} x2={vis1} y1={layout.riverMid} y2={layout.riverMid} stroke="var(--line-subtle)" strokeOpacity={0.5} />
              {geometry.bands.map((b) => (
                <path key={b.departmentId} d={b.path} fill={`var(--${b.dept})`} fillOpacity={0.85} stroke="var(--bg-ink)" strokeOpacity={0.35} strokeWidth={1} data-band={b.departmentId}>
                  <title>{b.name}</title>
                </path>
              ))}
              {geometry.revenue.path ? <path d={geometry.revenue.path} fill="none" stroke="var(--kit-primary)" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" data-revenue-line /> : null}
              {geometry.forecast ? (
                <g data-forecast>
                  <path d={geometry.forecast.conePath} fill="var(--kit-primary)" fillOpacity={0.12} stroke="none" />
                  <path d={geometry.forecast.basePath} fill="none" stroke="var(--kit-primary)" strokeWidth={1.5} strokeDasharray="4 4" />
                  <text x={geometry.todayX + 8} y={layout.revenueTop - 4} fill="var(--text-secondary)" fontFamily="var(--font-display)" fontWeight={600} fontSize={11} letterSpacing="0.06em">
                    FORECAST
                  </text>
                </g>
              ) : null}
              {geometry.runway ? (
                <g data-runway={geometry.runway.tone}>
                  <line x1={geometry.todayX} x2={geometry.runway.xDrawn} y1={geometry.runway.y} y2={geometry.runway.y} stroke={RUNWAY_COLOUR[geometry.runway.tone]} strokeWidth={1} />
                  {geometry.runway.x <= geometry.totalWidth ? <line x1={geometry.runway.x} x2={geometry.runway.x} y1={geometry.runway.y - 6} y2={geometry.runway.y + 6} stroke={RUNWAY_COLOUR[geometry.runway.tone]} strokeWidth={1.5} /> : null}
                  <text x={Math.min(geometry.runway.xDrawn, geometry.totalWidth - 4)} y={geometry.runway.y + 14} textAnchor="end" fill={RUNWAY_COLOUR[geometry.runway.tone]} fontFamily="var(--font-body)" fontSize={12}>
                    {`${geometry.runway.label} · Estimate`}
                  </text>
                </g>
              ) : null}
            </g>
          </g>
          <g transform={`translate(${-scrollX} 0)`}>
            {/* Milestones on hairline stems */}
            {visibleMilestones.map((m) => {
              const Glyph = m.glyph === "banner" ? bannerIcon(m.kind) : GLYPH_ICON[m.glyph];
              return (
                <g key={m.id} data-milestone={m.glyph}>
                  <title>{`${m.label} · ${formatDate(m.day)}`}</title>
                  <line x1={m.x} x2={m.x} y1={m.y + 7} y2={m.stemTo} stroke="var(--line-subtle)" strokeWidth={1} />
                  <Glyph x={m.x - 6} y={m.y - 6} width={12} height={12} strokeWidth={1.75} color={GLYPH_COLOUR[m.glyph]} />
                </g>
              );
            })}
            {/* Ghosted roadmap flags */}
            {visibleRoadmap.map((r) => (
              <g key={r.id} data-roadmap opacity={0.45}>
                <title>{`Planned: ${r.label} · ${formatDate(r.day)}`}</title>
                <line x1={r.x} x2={r.x} y1={r.y + 7} y2={layout.riverTop} stroke="var(--text-secondary)" strokeWidth={1} strokeDasharray="2 3" />
                <Flag x={r.x - 6} y={r.y - 6} width={12} height={12} strokeWidth={1.75} color="var(--text-secondary)" />
              </g>
            ))}
            {/* Today line: kit-primary with an 8 px glow */}
            {todayVisible ? (
              <g data-today>
                <line x1={geometry.todayX} x2={geometry.todayX} y1={layout.chapterBand} y2={layout.axisTop} stroke="var(--kit-primary)" strokeWidth={6} strokeOpacity={reduced ? 0.25 : 0.55} filter={`url(#${uid}-glow)`} />
                <line x1={geometry.todayX} x2={geometry.todayX} y1={layout.chapterBand} y2={layout.axisTop} stroke="var(--kit-primary)" strokeWidth={1.5} />
                <text x={geometry.todayX + 6} y={layout.axisTop - 6} fill="var(--kit-primary)" fontFamily="var(--font-display)" fontWeight={600} fontSize={11} letterSpacing="0.06em">
                  TODAY{liveCount > 0 ? ` · LIVE ${liveCount}` : ""}
                </text>
              </g>
            ) : null}
            {/* Conversion markers */}
            {visibleMarkers.map((m) => (
              <g
                key={m.key}
                role="button"
                tabIndex={0}
                data-marker={m.kind}
                data-count={m.count}
                aria-label={markerLabel(m, currency)}
                className="cursor-pointer outline-none focus-visible:[&>circle]:stroke-link"
                onClick={(e) => {
                  e.stopPropagation();
                  if (m.ids.length === 1 && m.ids[0]) onOpenJourney?.(m.ids[0]);
                  else onOpenDay?.(m.day);
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    e.stopPropagation();
                    if (m.ids.length === 1 && m.ids[0]) onOpenJourney?.(m.ids[0]);
                    else onOpenDay?.(m.day);
                  }
                }}
              >
                <title>{markerLabel(m, currency)}</title>
                <circle cx={m.x} cy={m.y} r={Math.max(7, m.r + 4)} fill="transparent" />
                {m.kind === "signup" ? <circle cx={m.x} cy={m.y} r={m.r} fill="var(--text-secondary)" /> : null}
                {m.kind === "activation" ? <circle cx={m.x} cy={m.y} r={m.r} fill="none" stroke="var(--text-primary)" strokeWidth={1.5} /> : null}
                {m.kind === "payment" ? (
                  <>
                    <circle cx={m.x} cy={m.y} r={m.r} fill="var(--gold)" stroke="var(--gold-deep)" strokeWidth={1.5} />
                    <circle cx={m.x} cy={m.y} r={Math.max(1, m.r - 3)} fill="none" stroke="var(--bg-ink)" strokeOpacity={0.6} strokeWidth={1} />
                  </>
                ) : null}
                {m.count > 1 ? (
                  <text x={m.x} y={m.y + m.r + 10} textAnchor="middle" fill="var(--text-secondary)" fontFamily="var(--font-mono)" fontSize={10}>
                    {m.count}
                  </text>
                ) : null}
              </g>
            ))}
            {/* SVG ripple fallback (SMIL) */}
            {svgRipples.map((r) => (
              <circle key={r.id} cx={r.x} cy={r.y} r={3} fill="none" stroke={r.kind === "payment" ? "var(--gold)" : "var(--kit-primary)"} strokeWidth={2} data-ripple={r.kind}>
                <animate attributeName="r" from="3" to="28" dur={`${RIPPLE_MS}ms`} fill="freeze" />
                <animate attributeName="opacity" from="1" to="0" dur={`${RIPPLE_MS}ms`} fill="freeze" />
              </circle>
            ))}
            {/* Time axis (small style) */}
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
              <Group data-scrubber>
                <line x1={hoverX + scrollX} x2={hoverX + scrollX} y1={layout.chapterBand} y2={layout.axisTop + 4} stroke="var(--text-primary)" strokeOpacity={0.5} strokeDasharray="2 3" />
              </Group>
            ) : null}
          </g>
        </g>
      </svg>
      <RibbonPixiLayer ref={pixiRef} width={width} height={height} enabled={usePixi} onUnavailable={() => setPixiUnavailable(true)} />
      {/* Zoom controls */}
      <div className="absolute right-2 top-1 flex items-center gap-0.5 rounded-panel bg-panel/80 p-0.5 backdrop-blur-[1px]" role="group" aria-label="Zoom" data-ribbon-control>
        {ZOOM_LEVELS.map((z) => (
          <Button key={z} size="sm" variant="ghost" aria-pressed={z === zoom} className={cn("h-6 px-2", z === zoom && "bg-panel-alt text-primary")} onClick={() => changeZoom(z)} data-zoom-option={z}>
            {ZOOM_LABELS[z]}
          </Button>
        ))}
        <Button size="sm" variant="ghost" icon={CalendarDays} className="h-6 px-2" onClick={() => updateScroll(scrollForToday(geometry, width))} aria-label="Scroll to today">
          Today
        </Button>
      </div>
      {/* On this day */}
      {hoverSummary && !drag.current?.moved ? (
        <div className="pointer-events-none absolute top-6 z-10" style={{ left: cardLeft }}>
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
 * The Journey Ribbon (BUILD §11.2, DESIGN §8): a streamgraph river of agent work per department, the revenue line in
 * kit-primary, signups / activations / payments as markers, milestones on stems, chapters along the top, a glowing
 * Today line, the forecast cone, ghosted roadmap flags and the runway horizon. SVG via visx with a PixiJS overlay for
 * the flow-in and live ripples. Zoom Week / Month / Quarter / All; wheel and drag scroll; hover scrubber; click opens
 * a day; markers open their Customer Update. Reduced motion renders the same picture with no animation (AC-11.2.6).
 */
export const JourneyRibbon = forwardRef<JourneyRibbonHandle, JourneyRibbonProps>(function JourneyRibbon({ width, height = RIBBON_DEFAULT_HEIGHT, className, ...rest }, ref) {
  if (width !== undefined) return <RibbonSurface ref={ref} width={width} height={height} className={className} {...rest} />;
  return (
    <ParentSize debounceTime={50} ignoreDimensions={["height", "top", "left"]} className={className} style={{ width: "100%", height }}>
      {({ width: w }) => (w > 0 ? <RibbonSurface ref={ref} width={Math.floor(w)} height={height} {...rest} /> : null)}
    </ParentSize>
  );
});
