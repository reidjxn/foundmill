"use client";
/**
 * Journey Ribbon widget (BUILD §11.2): the Home hero. Reads `journey.ribbon` (daily rows, conversions, milestones,
 * chapters), `product.roadmap.list` (ghosted upcoming flags) and `finance.overview` (forecast cone + runway horizon),
 * ripples live events into the Today line and opens Customer Updates / day digests.
 */
import { useCallback, useMemo, useRef, useState } from "react";
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
import type { FinanceOverview, ForecastRecord, ForecastSeriesPoint, RibbonResponse, RoadmapListResponse } from "../shared/types";

export const JourneyRibbonSettings = z.object({
  zoom: z.enum(ZOOM_LEVELS).default("quarter"),
  /** Forecast horizon past Today, in months. */
  horizonMonths: z.number().int().min(1).max(12).default(6),
  showForecast: z.boolean().default(true),
  showRoadmap: z.boolean().default(true),
  /** Ribbon height in px (the panel adds its header). */
  height: z.number().int().min(200).max(480).default(RIBBON_DEFAULT_HEIGHT),
});
export type JourneyRibbonSettings = z.infer<typeof JourneyRibbonSettings>;

/** How many days of history to load: enough for "All time" on a two-year business, one request for every zoom. */
export const RIBBON_HISTORY_DAYS = 730;

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

/**
 * Fold the latest forecasts (one record per scenario, `series` as stored) into per-day cone points past Today.
 * A point is read as `{ day | month, revenueMinor | cashMinor | baseMinor }`; scenarios missing a day fall back to
 * the base value so the cone never inverts.
 */
export function forecastCone(forecasts: FinanceOverview["forecasts"] | undefined, today: string): ForecastPoint[] {
  if (!forecasts) return [];
  const read = (rec: ForecastRecord | null | undefined): Map<string, number> => {
    const out = new Map<string, number>();
    for (const raw of (rec?.series ?? []) as ForecastSeriesPoint[]) {
      if (!raw || typeof raw !== "object") continue;
      const day = typeof raw.day === "string" ? raw.day : typeof raw.month === "string" ? `${raw.month}-01` : null;
      const value = num(raw.revenueMinor) ?? num(raw.baseMinor) ?? num(raw.cashMinor);
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
  const row = conversions?.find((c) => c.id === conversionId);
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
    return summariseDay(digestDay, { index, departments: depts, conversions: data.conversions, milestones: data.milestones, chapters: data.chapters, today: data.today });
  }, [digestDay, data, depts]);

  const empty = data && data.rows.length === 0 && data.conversions.length === 0 && depts.length === 0;
  const runwayMonths = finance.data?.runway.months ?? null;

  return (
    <WidgetFrame
      title="Journey"
      data-widget="journey_ribbon"
      queries={[ribbon, departments]}
      empty={empty ? { icon: Route, text: "The river starts flowing on day one. Press Continue to run the first cycle." } : null}
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
          onOpenJourney={(conversionId) => navigate(journeyHref(businessId, data.conversions, conversionId))}
          onOpenDay={(day) => setDigestDay(day)}
          height={settings.height}
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
              onOpenJourney={(conversionId) => navigate(journeyHref(businessId, data?.conversions, conversionId))}
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
  description: "The river of agent work, revenue, wins and milestones from day one to the forecast horizon.",
  icon: "route",
  surfaces: ["home"],
  defaultSize: { w: 12, h: 16, minW: 6, minH: 12, maxH: 24 },
  settingsSchema: JourneyRibbonSettings,
  defaultSettings: JourneyRibbonSettings.parse({}),
  single: true,
  Component: JourneyRibbonWidget,
});
