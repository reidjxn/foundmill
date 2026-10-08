"use client";
/**
 * Squad pulse widget (BUILD §11.2): a 7 × 24 heatmap of agent activity by hour and department over the last seven
 * days, built from `dev.sessions.list` (session start/end per agent → department via `department.list`).
 */
import { useMemo } from "react";
import { z } from "zod";
import { Activity } from "lucide-react";
import { SquadPulse, type SquadPulseCell } from "@foundmill/dugout";
import { useBusinessEvents, useWidgetQuery } from "../data";
import { registerWidget, type WidgetProps } from "../registry";
import { orderedDepartments, toRibbonDepartments, useDepartments } from "../shared/departments";
import { WidgetFrame } from "../shared/frame";
import { dayKey, lastDays } from "../shared/time";
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

/**
 * Spread each session's duration over the UTC hour cells it covers, attributed to the agent's first department.
 * Open sessions run until `now`; anything outside the seven-day window is clipped.
 */
export function sessionsToPulseCells(sessions: readonly SessionRow[], departments: readonly DepartmentRow[], days: readonly string[], now: Date = new Date()): SquadPulseCell[] {
  const deptOfAgent = new Map<string, string>();
  for (const d of departments) for (const a of d.squad) if (!deptOfAgent.has(a.id)) deptOfAgent.set(a.id, d.id);
  const dayIndex = new Map(days.map((d, i) => [d, i]));
  const cells = new Map<string, SquadPulseCell>();
  for (const s of sessions) {
    const departmentId = deptOfAgent.get(s.agentId);
    if (!departmentId) continue;
    const start = new Date(s.startedAt).getTime();
    const end = s.endedAt ? new Date(s.endedAt).getTime() : now.getTime();
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) continue;
    let cursor = Math.floor(start / HOUR_MS) * HOUR_MS;
    while (cursor < end) {
      const next = cursor + HOUR_MS;
      const overlap = Math.min(end, next) - Math.max(start, cursor);
      const at = new Date(cursor);
      const di = dayIndex.get(dayKey(at));
      if (di !== undefined && overlap > 0) {
        const hour = at.getUTCHours();
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
  const days = useMemo(() => lastDays(7), []);
  const depts = useMemo(() => {
    const all = orderedDepartments(departments.data);
    return settings.departmentId ? all.filter((d) => d.id === settings.departmentId) : all;
  }, [departments.data, settings.departmentId]);
  const cells = useMemo(() => sessionsToPulseCells(sessions.data?.items ?? [], depts, days), [sessions.data, depts, days]);
  const empty = departments.data && sessions.data && cells.length === 0;
  return (
    <WidgetFrame
      title="Team pulse"
      data-widget="squad_pulse"
      queries={[departments, sessions]}
      empty={empty ? { icon: Activity, text: "Agent hours by hour and department appear after the first cycle runs." } : null}
      footer={<span>Last 7 days · agent hours from session logs</span>}
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
  defaultSize: { w: 8, h: 12, minW: 6, minH: 10 },
  settingsSchema: SquadPulseSettings,
  defaultSettings: SquadPulseSettings.parse({}),
  Component: SquadPulseWidget,
});
