"use client";
/**
 * Team pulse widget (BUILD §11.2): a 7 × 24 heatmap of agent activity ("hours of team work", never "agent-hours" where
 * a person reads it, UX plan B16) by hour and department over the last seven days, built from `dev.sessions.list`
 * (session start/end per agent → department via `department.list`). Days and hours are the business's own (its time
 * zone, audit #196), the same days Home's tiles and the top bar count in.
 */
import { useMemo } from "react";
import { z } from "zod";
import { Activity } from "lucide-react";
import { SquadPulse, Term, type SquadPulseCell } from "@foundmill/dugout";
import { dayHourIn, dayRangeIn } from "@foundmill/shared/time-zone";
import { useBusinessEvents, useToday, useWidgetData, useWidgetQuery } from "../data";
import { registerWidget, type WidgetProps } from "../registry";
import { orderedDepartments, toRibbonDepartments, useDepartments } from "../shared/departments";
import { WidgetFrame } from "../shared/frame";
import { lastDays } from "../shared/time";
import type { DepartmentRow, Page } from "../shared/types";

export const SquadPulseSettings = z.object({
  /** Limit to one department (department screens); null → every department. */
  departmentId: z.string().nullable().default(null),
});
export type SquadPulseSettings = z.infer<typeof SquadPulseSettings>;

export interface SessionRow {
  id: string;
  agentId: string;
  startedAt: string;
  endedAt: string | null;
}

const HOUR_MS = 3_600_000;
/** Half-hour steps, so a zone half an hour off UTC (India, Newfoundland) still lands each slice in its own hour. */
const STEP_MS = HOUR_MS / 2;

/**
 * Spread each session's duration over the hour cells it covers in the business's time zone (UTC when it has none),
 * attributed to the agent's first department. Open sessions run until `now`; anything outside the window is clipped:
 * only the half-hour steps that can land on one of `days` are walked (audit C1: an open session used to walk every
 * step back to its start), and each step's day and hour are read once per call, however many sessions share it.
 */
export function sessionsToPulseCells(sessions: readonly SessionRow[], departments: readonly DepartmentRow[], days: readonly string[], now: Date = new Date(), timeZone?: string | null): SquadPulseCell[] {
  if (days.length === 0) return [];
  const deptOfAgent = new Map<string, string>();
  for (const d of departments) for (const a of d.squad) if (!deptOfAgent.has(a.id)) deptOfAgent.set(a.id, d.id);
  const dayIndex = new Map(days.map((d, i) => [d, i]));
  const sorted = [...days].sort();
  const range = dayRangeIn(sorted[0]!, sorted[sorted.length - 1]!, timeZone);
  // A step that starts before the first day's start or at the day after the last day's start lands outside `days`.
  const firstStep = Math.floor(range.from.getTime() / STEP_MS);
  const windowEnd = range.to.getTime() + 1;
  const slots = new Map<number, { day: string; hour: number }>();
  const slotAt = (cursor: number) => {
    let slot = slots.get(cursor);
    if (!slot) slots.set(cursor, (slot = dayHourIn(cursor, timeZone)));
    return slot;
  };
  const cells = new Map<string, SquadPulseCell>();
  for (const s of sessions) {
    const departmentId = deptOfAgent.get(s.agentId);
    if (!departmentId) continue;
    const start = new Date(s.startedAt).getTime();
    const end = s.endedAt ? new Date(s.endedAt).getTime() : now.getTime();
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) continue;
    const stop = Math.min(end, windowEnd);
    let cursor = Math.max(Math.floor(start / STEP_MS), firstStep) * STEP_MS;
    while (cursor < stop) {
      const next = cursor + STEP_MS;
      const overlap = Math.min(end, next) - Math.max(start, cursor);
      const { day, hour } = slotAt(cursor);
      const di = dayIndex.get(day);
      if (di !== undefined && overlap > 0) {
        const key = `${departmentId}:${di}:${hour}`;
        const cell = cells.get(key) ?? { departmentId, dayIndex: di, hour, agentHours: 0 };
        cell.agentHours += overlap / HOUR_MS;
        cells.set(key, cell);
      }
      cursor = next;
    }
  }
  return [...cells.values()];
}

function SquadPulseWidget({ settings }: WidgetProps<SquadPulseSettings>) {
  const departments = useDepartments();
  const sessions = useWidgetQuery<Page<SessionRow>>("dev.sessions.list", { limit: 200 });
  useBusinessEvents(() => sessions.refetch(), ["task.started", "task.completed", "cycle.completed"]);
  const { timeZone } = useWidgetData();
  const today = useToday();
  const days = useMemo(() => lastDays(7, today), [today]);
  const depts = useMemo(() => {
    const all = orderedDepartments(departments.data);
    return settings.departmentId ? all.filter((d) => d.id === settings.departmentId) : all;
  }, [departments.data, settings.departmentId]);
  const cells = useMemo(() => sessionsToPulseCells(sessions.data?.items ?? [], depts, days, new Date(), timeZone), [sessions.data, depts, days, timeZone]);
  const empty = departments.data && sessions.data && cells.length === 0;
  return (
    <WidgetFrame
      title="Team pulse"
      data-widget="squad_pulse"
      queries={[departments, sessions]}
      empty={empty ? { icon: Activity, text: <>Hours of team work by hour and department appear after the first <Term id="cycle">cycle</Term> runs.</> } : null}
      footer={<span>Last 7 days · hours of team work from session logs</span>}
    >
      <SquadPulse departments={toRibbonDepartments(depts)} days={days} cells={cells} />
    </WidgetFrame>
  );
}

export const squadPulseWidget = registerWidget<SquadPulseSettings>({
  key: "squad_pulse",
  title: "Team pulse",
  description: "A 7 × 24 heatmap of agent activity by hour and department.",
  icon: "activity",
  surfaces: ["home", "department"],
  // Sized to the 7 × 24 grid, its legend and footer: a stored taller cell is clamped instead of drawn empty.
  defaultSize: { w: 8, h: 12, minW: 6, minH: 10, maxH: 16 },
  settingsSchema: SquadPulseSettings,
  defaultSettings: SquadPulseSettings.parse({}),
  Component: SquadPulseWidget,
});
