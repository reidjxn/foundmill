/**
 * Roadmap item status (BUILD §11.5 "status computed from tasks and acceptance criteria", AC-11.5.4).
 *
 * The API owns "done": it flips only when the linked acceptance criteria pass, and this module never promotes an item to
 * Done on its own. Everything short of done is derived here from the linked tasks and dates so the board reads the live
 * state without a round trip: blocked tasks → Blocked, a past target date → At risk, any running task → In progress,
 * every task done but acceptance pending → Awaiting acceptance, otherwise Planned.
 */
import { CircleCheck, CircleDashed, CircleX, Hourglass, Play, TriangleAlert, type LucideIcon } from "lucide-react";
import type { StatusTone } from "@foundmill/dugout";
import type { RoadmapRow } from "./types";

export type RoadmapStatusKey = "done" | "blocked" | "at_risk" | "in_progress" | "awaiting_acceptance" | "planned";

export interface RoadmapStatus {
  key: RoadmapStatusKey;
  word: string;
  tone: StatusTone;
  icon: LucideIcon;
}

const STATUS: Record<RoadmapStatusKey, RoadmapStatus> = {
  done: { key: "done", word: "Done", tone: "good", icon: CircleCheck },
  blocked: { key: "blocked", word: "Blocked", tone: "bad", icon: CircleX },
  at_risk: { key: "at_risk", word: "At risk", tone: "warn", icon: TriangleAlert },
  in_progress: { key: "in_progress", word: "In progress", tone: "info", icon: Play },
  awaiting_acceptance: { key: "awaiting_acceptance", word: "Awaiting acceptance", tone: "info", icon: Hourglass },
  planned: { key: "planned", word: "Planned", tone: "neutral", icon: CircleDashed },
};

const ACTIVE = new Set(["running", "paused", "review", "merging", "ready"]);

export function computeRoadmapStatus(item: Pick<RoadmapRow, "status" | "tasks" | "targetEnd">, today: Date = new Date()): RoadmapStatus {
  if (item.status === "done") return STATUS.done;
  const tasks = item.tasks ?? [];
  if (item.status === "blocked" || tasks.some((t) => t.status === "blocked" || t.status === "failed")) return STATUS.blocked;
  const end = item.targetEnd ? new Date(`${item.targetEnd}T23:59:59`) : null;
  const late = end !== null && !Number.isNaN(end.getTime()) && end.getTime() < today.getTime();
  if (late || item.status === "at_risk" || item.status === "late") return STATUS.at_risk;
  if (tasks.length > 0 && tasks.every((t) => t.status === "done")) return STATUS.awaiting_acceptance;
  if (tasks.some((t) => ACTIVE.has(t.status)) || item.status === "in_progress" || item.status === "building" || item.status === "on_track") return STATUS.in_progress;
  return STATUS.planned;
}

export function taskSummary(item: Pick<RoadmapRow, "tasks">): { done: number; total: number; progress: number } {
  const tasks = item.tasks ?? [];
  const total = tasks.length;
  const done = tasks.filter((t) => t.status === "done").length;
  const progress = total ? tasks.reduce((s, t) => s + Math.min(1, Math.max(0, Number(t.progress) || 0)), 0) / total : 0;
  return { done, total, progress };
}

export const HORIZON_LABEL = { now: "Now", next: "Next", later: "Later" } as const;
