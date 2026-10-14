"use client";
/**
 * Roadmap timeline widget (BUILD §11.5 "Now/Next/Later board + timeline"): the roadmap items per horizon with status
 * words, target dates and linked-task progress. Status comes from the API (Done only when acceptance criteria pass,
 * AC-11.5.4); this widget never recomputes it.
 */
import { useMemo } from "react";
import { z } from "zod";
import { CircleCheck, CircleDashed, CircleX, Map as MapIcon, Play, TriangleAlert, type LucideIcon } from "lucide-react";
import { StatusPill, formatNumber, useFormatters, type StatusTone } from "@foundmill/dugout";
import { useBusinessEvents, useWidgetData, useWidgetQuery } from "../data";
import { registerWidget, type WidgetProps } from "../registry";
import { moduleHref, useDepartments } from "../shared/departments";
import { WidgetFrame } from "../shared/frame";
import type { RoadmapItemRow, RoadmapListResponse } from "../shared/types";

export const ROADMAP_HORIZONS = ["now", "next", "later"] as const;
export type RoadmapHorizon = (typeof ROADMAP_HORIZONS)[number];

export const RoadmapTimelineSettings = z.object({
  horizons: z.array(z.enum(ROADMAP_HORIZONS)).min(1).default([...ROADMAP_HORIZONS]),
  /** Items per horizon column. */
  max: z.number().int().min(2).max(20).default(6),
  hideDone: z.boolean().default(false),
});
export type RoadmapTimelineSettings = z.infer<typeof RoadmapTimelineSettings>;

const HORIZON_LABEL: Record<RoadmapHorizon, string> = { now: "Now", next: "Next", later: "Later" };

/** Status word + tone + icon per roadmap status (free text in the DB; unknown statuses read as planned). */
export function roadmapStatus(status: string): { word: string; tone: StatusTone; icon: LucideIcon } {
  switch (status) {
    case "done":
      return { word: "Done", tone: "good", icon: CircleCheck };
    case "in_progress":
    case "on_track":
    case "building":
      return { word: "In progress", tone: "info", icon: Play };
    case "at_risk":
    case "late":
      return { word: "At risk", tone: "warn", icon: TriangleAlert };
    case "blocked":
      return { word: "Blocked", tone: "bad", icon: CircleX };
    default:
      return { word: "Planned", tone: "neutral", icon: CircleDashed };
  }
}

export function taskProgress(item: RoadmapItemRow): { done: number; total: number; progress: number } {
  const total = item.tasks.length;
  const done = item.tasks.filter((t) => t.status === "done").length;
  const progress = total ? item.tasks.reduce((s, t) => s + Math.min(1, Math.max(0, Number(t.progress) || 0)), 0) / total : 0;
  return { done, total, progress };
}

export function groupByHorizon(items: readonly RoadmapItemRow[], opts: { horizons: readonly RoadmapHorizon[]; max: number; hideDone: boolean }): Record<RoadmapHorizon, RoadmapItemRow[]> {
  const out = { now: [], next: [], later: [] } as Record<RoadmapHorizon, RoadmapItemRow[]>;
  for (const it of items.slice().sort((a, b) => a.position - b.position || a.title.localeCompare(b.title))) {
    if (!opts.horizons.includes(it.horizon)) continue;
    if (opts.hideDone && it.status === "done") continue;
    if (out[it.horizon].length < opts.max) out[it.horizon].push(it);
  }
  return out;
}

function RoadmapTimelineWidget({ settings }: WidgetProps<RoadmapTimelineSettings>) {
  const { businessId, navigate } = useWidgetData();
  const roadmap = useWidgetQuery<RoadmapListResponse>("product.roadmap.list", {});
  const departments = useDepartments();
  useBusinessEvents(() => roadmap.refetch(), ["task.completed", "pr.merged", "spec.version_published"]);
  const groups = useMemo(() => groupByHorizon(roadmap.data?.items ?? [], settings), [roadmap.data, settings]);
  const { formatDateShort } = useFormatters();
  const shown = settings.horizons.reduce((n, h) => n + groups[h].length, 0);
  const open = () => navigate(moduleHref(businessId, departments.data, "product", "roadmap") ?? `/b/${businessId}/home`);
  return (
    <WidgetFrame
      title="Roadmap"
      data-widget="roadmap_timeline"
      queries={[roadmap]}
      empty={roadmap.data && shown === 0 ? { icon: MapIcon, text: "Roadmap items appear once the Product lead turns the spec into Now, Next and Later.", action: { label: "Open roadmap", onClick: open } } : null}
      footer={<span>{formatNumber(roadmap.data?.items.length ?? 0, { maxDigits: 0 })} items · status flips to Done when acceptance criteria pass</span>}
    >
      <div className="grid h-full min-h-0 gap-gutter" style={{ gridTemplateColumns: `repeat(${settings.horizons.length}, minmax(0, 1fr))` }}>
        {settings.horizons.map((h) => (
          <section key={h} aria-label={`${HORIZON_LABEL[h]} roadmap items`} className="flex min-w-0 flex-col gap-1">
            <h3 className="t-label flex items-center justify-between">
              {HORIZON_LABEL[h]}
              <span className="tabular-nums">{groups[h].length}</span>
            </h3>
            <ul className="flex flex-col gap-1">
              {groups[h].map((it) => {
                const st = roadmapStatus(it.status);
                const tp = taskProgress(it);
                return (
                  <li key={it.id}>
                    <button type="button" onClick={open} data-roadmap-item={it.id} className="flex w-full flex-col gap-1 rounded-panel border border-subtle bg-panel-alt p-2 text-left transition-colors duration-micro ease-dugout hover:border-secondary/60 focus-visible:outline-2 focus-visible:outline-link">
                      <span className="flex items-center justify-between gap-2">
                        <span className="truncate text-body-strong">{it.title}</span>
                        <StatusPill tone={st.tone} icon={st.icon}>
                          {st.word}
                        </StatusPill>
                      </span>
                      <span className="flex items-center justify-between gap-2 text-small text-secondary tabular-nums">
                        <span>{it.targetEnd ? `Target ${formatDateShort(it.targetEnd)}` : it.targetStart ? `From ${formatDateShort(it.targetStart)}` : "No date"}</span>
                        <span>{tp.total ? `${tp.done}/${tp.total} tasks · ${Math.round(tp.progress * 100)}%` : "No tasks yet"}</span>
                      </span>
                      {tp.total ? (
                        <span className="h-1 w-full overflow-hidden rounded-chip bg-panel" role="progressbar" aria-valuenow={Math.round(tp.progress * 100)} aria-valuemin={0} aria-valuemax={100} aria-label={`${it.title} progress`}>
                          <span className="block h-full bg-kit-primary" style={{ width: `${Math.round(tp.progress * 100)}%` }} />
                        </span>
                      ) : null}
                    </button>
                  </li>
                );
              })}
            </ul>
          </section>
        ))}
      </div>
    </WidgetFrame>
  );
}

export const roadmapTimelineWidget = registerWidget<RoadmapTimelineSettings>({
  key: "roadmap_timeline",
  title: "Roadmap timeline",
  description: "Now, Next and Later with status and task progress.",
  icon: "map",
  surfaces: ["home", "department"],
  defaultSize: { w: 8, h: 12, minW: 4, minH: 8 },
  settingsSchema: RoadmapTimelineSettings,
  defaultSettings: RoadmapTimelineSettings.parse({}),
  Component: RoadmapTimelineWidget,
});
