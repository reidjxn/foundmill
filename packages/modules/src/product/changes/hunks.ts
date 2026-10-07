/**
 * Pure helpers for change proposals (BUILD §11.5): the text sides of a hunk for DiffView, how far a proposal is
 * decided, the decision pill, and the impact summary (dates, tasks, cost) with its Estimate label.
 */
import { CircleCheck, CircleDashed, CircleX, PencilLine, TriangleAlert, type LucideIcon } from "lucide-react";
import type { StatusTone } from "@foundmill/dugout";
import type { HunkDecision, ProposalStatus, Severity } from "@foundmill/shared";
import { pmToText } from "../prosemirror";
import type { ProposalHunkRow, ProposalImpact, ProposalRow } from "../types";

export interface HunkSides {
  base: string | undefined;
  original: string;
  proposed: string;
}

/** DiffView inputs for a hunk: ours is the current text, theirs the proposal, base the common ancestor when known. */
export function hunkSides(h: Pick<ProposalHunkRow, "base" | "ours" | "theirs">): HunkSides {
  return { base: h.base ? pmToText(h.base) : undefined, original: pmToText(h.ours), proposed: pmToText(h.theirs) };
}

export interface DecisionProgress {
  total: number;
  decided: number;
  accepted: number;
  rejected: number;
  edited: number;
  pending: number;
}

export function decisionProgress(hunks: readonly Pick<ProposalHunkRow, "decision">[]): DecisionProgress {
  const p: DecisionProgress = { total: hunks.length, decided: 0, accepted: 0, rejected: 0, edited: 0, pending: 0 };
  for (const h of hunks) {
    if (h.decision === "pending") p.pending += 1;
    else {
      p.decided += 1;
      p[h.decision] += 1;
    }
  }
  return p;
}

export const DECISION_PILL: Record<HunkDecision, { word: string; tone: StatusTone; icon: LucideIcon }> = {
  pending: { word: "Pending", tone: "neutral", icon: CircleDashed },
  accepted: { word: "Accepted", tone: "good", icon: CircleCheck },
  rejected: { word: "Rejected", tone: "bad", icon: CircleX },
  edited: { word: "Edited", tone: "info", icon: PencilLine },
};

export const PROPOSAL_STATUS_PILL: Record<ProposalStatus, { word: string; tone: StatusTone; icon: LucideIcon }> = {
  open: { word: "Open", tone: "warn", icon: CircleDashed },
  accepted: { word: "Accepted", tone: "good", icon: CircleCheck },
  partially_accepted: { word: "Partly accepted", tone: "info", icon: PencilLine },
  rejected: { word: "Rejected", tone: "bad", icon: CircleX },
};

export const SEVERITY_CHIP: Record<Severity, { word: string; tone: "neutral" | "warn" | "bad"; icon?: LucideIcon }> = {
  low: { word: "Low · batched daily", tone: "neutral" },
  normal: { word: "Normal", tone: "warn" },
  critical: { word: "Critical · immediate", tone: "bad", icon: TriangleAlert },
};

export function isSettled(p: Pick<ProposalRow, "status">): boolean {
  return p.status !== "open";
}

export interface ImpactLine {
  label: string;
  value: string;
  /** Impact figures are the drafter's estimates (BUILD: label every non-real number). */
  estimate: true;
}

function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? "" : "s"}`;
}

/** The impact jsonb as label + value lines; unknown keys are ignored, missing ones omitted. */
export function impactLines(impact: ProposalImpact | null | undefined, currency = "EUR"): ImpactLine[] {
  const out: ImpactLine[] = [];
  if (!impact) return out;
  const { dates, tasks, costMinor } = impact;
  if (typeof dates === "string") out.push({ label: "Dates", value: dates, estimate: true });
  else if (dates && typeof dates === "object") {
    const parts: string[] = [];
    if (typeof dates.shiftDays === "number") parts.push(`${dates.shiftDays > 0 ? "+" : ""}${plural(dates.shiftDays, "day")}`);
    if (dates.from && dates.to) parts.push(`${dates.from} → ${dates.to}`);
    else if (dates.to) parts.push(`to ${dates.to}`);
    if (parts.length) out.push({ label: "Dates", value: parts.join(" · "), estimate: true });
  }
  if (typeof tasks === "number") out.push({ label: "Tasks", value: plural(tasks, "task"), estimate: true });
  else if (Array.isArray(tasks)) out.push({ label: "Tasks", value: tasks.length ? `${plural(tasks.length, "task")}: ${tasks.join(", ")}` : "No tasks", estimate: true });
  else if (tasks && typeof tasks === "object") {
    const count = typeof tasks.count === "number" ? tasks.count : tasks.titles?.length;
    if (count !== undefined) out.push({ label: "Tasks", value: `${plural(count, "task")}${tasks.titles?.length ? `: ${tasks.titles.join(", ")}` : ""}`, estimate: true });
  }
  if (typeof costMinor === "number") {
    const cur = typeof impact.currency === "string" ? impact.currency : currency;
    out.push({ label: "Cost", value: new Intl.NumberFormat("en-GB", { style: "currency", currency: cur, maximumFractionDigits: 0 }).format(costMinor / 100), estimate: true });
  }
  return out;
}
