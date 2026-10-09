"use client";
/**
 * The one recent `journey.ribbon` query Home shares: the status strip, every department card, the milestones cabinet and
 * the host's day-one check read the same business-wide, slim answer (daily rows for every department, milestones and
 * the conversion count, no per-conversion detail) and pick what they need on the client. One request instead of one
 * per card.
 */
import { useWidgetQuery, type QueryOptions, type QueryState } from "../data";
import { addDays, dayKey } from "./time";
import type { RibbonResponse } from "./types";

/** Days of history the shared query covers: the cards and the strip read the last 14, the day-one check the last 30. */
export const RECENT_RIBBON_DAYS = 30;

/** The shared query's input for a day (UTC). The host's typed query must use exactly this to share the cache entry. */
export function recentRibbonInput(today: string = dayKey()): { from: string; to: string; slim: true } {
  return { from: addDays(today, -RECENT_RIBBON_DAYS), to: today, slim: true };
}

export function useRecentRibbon(opts?: QueryOptions): QueryState<RibbonResponse> {
  return useWidgetQuery<RibbonResponse>("journey.ribbon", recentRibbonInput(), opts);
}

/** One department's daily rows from the business-wide answer (`null`: the business-wide row). */
export function departmentRows(ribbon: RibbonResponse | undefined, departmentId: string | null): RibbonResponse["rows"] {
  return (ribbon?.rows ?? []).filter((r) => r.departmentId === departmentId);
}
