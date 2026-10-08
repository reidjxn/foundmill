"use client";
/**
 * Journey Ribbon widget (BUILD §11.2): the Home hero. Reads `journey.ribbon` (daily rows, conversions, milestones,
 * chapters), `product.roadmap.list` (ghosted upcoming flags) and `finance.overview` (forecast cone + runway horizon),
 * ripples live events into the Today line and opens Customer Updates / day digests.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { z } from "zod";
import { Route } from "lucide-react";
import {
  DayDigest,
  Dialog,
  DialogContent,
  DialogTitle,
  JourneyRibbon,
  ProvenanceChip,
  RIBBON_DEFAULT_HEIGHT,
  ZOOM_LEVELS,
  indexDailyRows,
  summariseDay,
  type ForecastPoint,
  type JourneyRibbonHandle,
  type RibbonEvent,
  type RoadmapFlag,
  type ZoomLevel,
} from "@foundmill/dugout";
import { useBusinessEvents, useWidgetData, useWidgetQuery, type WidgetEvent } from "../data";
import { registerWidget, type WidgetProps } from "../registry";
import { toRibbonDepartments, useDepartments } from "../shared/departments";
import { WidgetFrame } from "../shared/frame";
import { routes } from "../shared/routes";
import { addDays, dayKey } from "../shared/time";
import type { FinanceOverview, ForecastRecord, ForecastSeriesPoint, RibbonResponse, RoadmapListResponse, RoundupResponse } from "../shared/types";

export const JourneyRibbonSettings = z.object({
  zoom: z.enum(ZOOM_LEVELS).default("quarter"),
  /** Forecast horizon past Today, in months. */
  horizonMonths: z.number().int().min(1).max(12).default(6),
  showForecast: z.boolean().default(true),
  showRoadmap: z.boolean().default(true),
  /** Smallest ribbon height in px; it grows to fill the panel. */
  height: z.number().int().min(200).max(480).default(RIBBON_DEFAULT_HEIGHT),
});
export type JourneyRibbonSettings = z.infer<typeof JourneyRibbonSettings>;

/** How many days of history to load: enough for "All time" on a two-year business, one request for every zoom. */
export const RIBBON_HISTORY_DAYS = 730;
/** How long the pointer rests on a day before its customers are loaded. */
export const HOVER_LOAD_DELAY_MS = 150;

const RIPPLE_EVENTS = ["signup.created", "activation.reached", "payment.received", "task.completed", "decision.made", "customer.converted"] as const;

/** Map a platform event to the Ribbon's ripple kinds; null when it is not a Ribbon event. */
export function rippleFor(event: WidgetEvent): RibbonEvent | null {
  const p = event.payload;
  switch (event.type) {
    case "signup.created":
      return { kind: "signup" };
    case "activation.reached":
      return { kind: "activation" };
    case "payment.received": {
      const amount = p.amount as { amountMinor?: number } | undefined;
      return { kind: "payment", amountMinor: amount?.amountMinor };
    }
    case "task.completed":
      return { kind: "task", label: typeof p.title === "string" ? p.title : undefined };
    case "decision.made":
      return { kind: "decision" };
    default:
      return null;
  }
}

function num(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

/** Days in the month of a "YYYY-MM" key. */
function daysInMonth(month: string): number {
  const [y, m] = month.split("-").map(Number) as [number, number];
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

/**
 * Fold the latest forecasts (one record per scenario, `series` as stored) into cone points past Today, as revenue
 * per day (the unit the Ribbon draws). A point is read as `{ day | month, revenueMinor | cashMinor | baseMinor }`;
 * a monthly point is that month's total, so it becomes a per-day value placed mid-month. Scenarios missing a day fall
 * back to the base value so the cone never inverts.
 */
export function forecastCone(forecasts: FinanceOverview["forecasts"] | undefined, today: string): ForecastPoint[] {
  if (!forecasts) return [];
  const read = (rec: ForecastRecord | null | undefined): Map<string, number> => {
    const out = new Map<string, number>();
    for (const raw of (rec?.series ?? []) as ForecastSeriesPoint[]) {
      if (!raw || typeof raw !== "object") continue;
      const monthly = typeof raw.day !== "string" && typeof raw.month === "string" ? raw.month : null;
      const day = typeof raw.day === "string" ? raw.day : monthly ? `${monthly}-15` : null;
      const total = num(raw.revenueMinor) ?? num(raw.baseMinor) ?? num(raw.cashMinor);
      const value = total !== null && monthly ? Math.round(total / daysInMonth(monthly)) : total;
      if (day && value !== null && day > today) out.set(day, value);
    }
    return out;
  };
  const base = read(forecasts.base);
  const up = read(forecasts.upside);
  const down = read(forecasts.downside);
  const days = [...new Set([...base.keys(), ...up.keys(), ...down.keys()])].sort();
  return days.map((day) => {
    const b = base.get(day) ?? up.get(day) ?? down.get(day) ?? 0;
    return { day, baseMinor: b, upsideMinor: Math.max(b, up.get(day) ?? b), downsideMinor: Math.min(b, down.get(day) ?? b) };
  });
}

/**
 * Where a payment marker navigates. The Ribbon only knows conversion ids; when the API's conversion row carries its
 * `journeyId` the Customer Update opens in one request, otherwise the route takes the conversion id and apps/web
 * resolves it (components/journey/JourneyScreen.tsx).
 */
export function journeyHref(businessId: string, conversions: readonly RibbonResponse["conversions"][number][] | undefined, conversionId: string): string {
  const row = conversions?.find((c) => c.id === conversionId && c.journeyId) ?? conversions?.find((c) => c.id === conversionId);
  return routes.journey(businessId, row?.journeyId ?? conversionId);
}

export function roadmapFlags(items: RoadmapListResponse["items"] | undefined, today: string): RoadmapFlag[] {
  return (items ?? [])
    .filter((i) => i.status !== "done")
    .map((i) => ({ id: i.id, label: i.title, plannedOn: i.targetEnd ?? i.targetStart ?? "" }))
    .filter((f) => f.plannedOn > today)
    .sort((a, b) => a.plannedOn.localeCompare(b.plannedOn));
}

function JourneyRibbonWidget({ settings, updateSettings }: WidgetProps<JourneyRibbonSettings>) {
  const { businessId, navigate, currency = "EUR" } = useWidgetData();
  const today = dayKey();
  const ribbon = useWidgetQuery<RibbonResponse>("journey.ribbon", { from: addDays(today, -RIBBON_HISTORY_DAYS), to: today });
  const departments = useDepartments();
  const roadmap = useWidgetQuery<RoadmapListResponse>("product.roadmap.list", {}, { enabled: settings.showRoadmap });
  const finance = useWidgetQuery<FinanceOverview>("finance.overview", {}, { enabled: settings.showForecast });
  const handle = useRef<JourneyRibbonHandle>(null);
  const [zoom, setZoom] = useState<ZoomLevel>(settings.zoom);
  const [digestDay, setDigestDay] = useState<string | null>(null);
  // The ribbon query carries only the latest conversions; a day's full, named list loads when the pointer rests on it
  // or the day is opened (journey.roundup, cached per day by the host).
  const [hoverDay, setHoverDay] = useState<string | null>(null);
  const [restingDay, setRestingDay] = useState<string | null>(null);
  useEffect(() => {
    if (!hoverDay) return;
    const t = setTimeout(() => setRestingDay(hoverDay), HOVER_LOAD_DELAY_MS);
    return () => clearTimeout(t);
  }, [hoverDay]);
  const lastDay = ribbon.data?.today ?? today;
  const hoverRoundup = useWidgetQuery<RoundupResponse>("journey.roundup", { day: restingDay ?? lastDay }, { enabled: !!restingDay && restingDay <= lastDay });
  const digestRoundup = useWidgetQuery<RoundupResponse>("journey.roundup", { day: digestDay ?? lastDay }, { enabled: !!digestDay && digestDay <= lastDay });
  const loadedDays = useMemo(() => {
    const map = new Map<string, RibbonResponse["conversions"]>();
    for (const r of [hoverRoundup.data, digestRoundup.data]) if (r) map.set(r.day, r.conversions);
    return map;
  }, [hoverRoundup.data, digestRoundup.data]);
  const dayConversions = useCallback((day: string) => loadedDays.get(day), [loadedDays]);
  const knownConversions = useMemo(() => [...(ribbon.data?.conversions ?? []), ...[...loadedDays.values()].flat()], [ribbon.data?.conversions, loadedDays]);

  useBusinessEvents((event) => {
    const ripple = rippleFor(event);
    if (ripple) handle.current?.ripple(ripple);
    if (event.type === "customer.converted" || event.type === "payment.received") ribbon.refetch();
  }, RIPPLE_EVENTS);

  const depts = useMemo(() => toRibbonDepartments(departments.data), [departments.data]);
  const data = ribbon.data;
  const cone = useMemo(() => (settings.showForecast ? forecastCone(finance.data?.forecasts, data?.today ?? today) : []), [settings.showForecast, finance.data, data?.today, today]);
  const flags = useMemo(() => (settings.showRoadmap ? roadmapFlags(roadmap.data?.items, data?.today ?? today) : []), [settings.showRoadmap, roadmap.data, data?.today, today]);

  const onZoomChange = useCallback(
    (z: ZoomLevel) => {
      setZoom(z);
      updateSettings?.({ zoom: z });
    },
    [updateSettings],
  );

  const digest = useMemo(() => {
    if (!digestDay || !data) return null;
    const index = indexDailyRows(data.rows, depts, { kickoff: data.kickoff, last: data.today });
    return summariseDay(digestDay, { index, departments: depts, conversions: loadedDays.get(digestDay) ?? data.conversions, milestones: data.milestones, chapters: data.chapters, today: data.today });
  }, [digestDay, data, depts, loadedDays]);

  const empty = data && data.rows.length === 0 && data.conversions.length === 0 && depts.length === 0;
  const runwayMonths = finance.data?.runway.months ?? null;

  return (
    <WidgetFrame
      title="Journey"
      data-widget="journey_ribbon"
      queries={[ribbon, departments]}
      empty={empty ? { icon: Route, text: "Your journey starts on day one. Press Continue to run the first cycle." } : null}
      flush
      actions={
        <>
          {cone.length > 0 ? <ProvenanceChip kind="forecast" /> : null}
          {runwayMonths !== null ? <ProvenanceChip kind="estimate" title="Runway horizon is an estimate" /> : null}
        </>
      }
    >
      {data ? (
        <JourneyRibbon
          ref={handle}
          rows={data.rows}
          departments={depts}
          conversions={data.conversions}
          milestones={data.milestones}
          chapters={data.chapters}
          kickoff={data.kickoff}
          today={data.today}
          forecast={cone}
          roadmap={flags}
          runwayMonths={runwayMonths}
          horizonMonths={settings.horizonMonths}
          zoom={zoom}
          onZoomChange={onZoomChange}
          onOpenJourney={(conversionId) => navigate(journeyHref(businessId, knownConversions, conversionId))}
          onOpenDay={(day) => setDigestDay(day)}
          onHoverDay={setHoverDay}
          dayConversions={dayConversions}
          minHeight={settings.height}
          currency={currency}
          label="Journey Ribbon"
        />
      ) : null}
      <Dialog open={!!digest} onOpenChange={(open) => !open && setDigestDay(null)}>
        <DialogContent size="lg" aria-describedby={undefined}>
          <DialogTitle className="sr-only">Day digest</DialogTitle>
          {digest ? (
            <DayDigest
              summary={digest}
              currency={currency}
              onOpenJourney={(conversionId) => navigate(journeyHref(businessId, knownConversions, conversionId))}
              onOpenEntity={(id) => navigate(routes.crm(businessId, id))}
              onPrevDay={() => setDigestDay(addDays(digest.day, -1))}
              onNextDay={digest.isToday ? undefined : () => setDigestDay(addDays(digest.day, 1))}
              onClose={() => setDigestDay(null)}
            />
          ) : null}
        </DialogContent>
      </Dialog>
    </WidgetFrame>
  );
}

export const journeyRibbonWidget = registerWidget<JourneyRibbonSettings>({
  key: "journey_ribbon",
  title: "Journey Ribbon",
  description: "Revenue per day, new signups, paying customers, agent hours and milestones on one timeline, from day one to the forecast.",
  icon: "route",
  surfaces: ["home"],
  defaultSize: { w: 12, h: 16, minW: 6, minH: 12, maxH: 24 },
  settingsSchema: JourneyRibbonSettings,
  defaultSettings: JourneyRibbonSettings.parse({}),
  single: true,
  Component: JourneyRibbonWidget,
});
