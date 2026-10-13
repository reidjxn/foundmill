/**
 * Pure helpers for the Home dashboards (BUILD §11.2 "Customisation", AC-11.2.4): tabs from `dashboard.list`, the
 * version bookkeeping behind "layout edits persist, version, and can be reset", presets for the WidgetGrid, the
 * share link co-founders open, and the day-one state (ghosted milestones).
 */
import type { TabItem, TrophyCard, WidgetLayout, WidgetPreset } from "@foundmill/dugout";
import { TROPHIES } from "@foundmill/journey";
import { DASHBOARD_PRESET_LIST, fromGridLayout, isDashboardPresetId, layoutsEqual, routes, toGridLayout, type DashboardPresetId } from "@foundmill/widgets";
import { formatNumber } from "@/lib/format";

export interface DashboardSummary {
  id: string;
  name: string;
  preset: string | null;
  version: number;
  isActive: boolean;
  userId: string;
}

export const DEFAULT_PRESET: DashboardPresetId = "founder";

/**
 * One tab per dashboard of the signed-in founder; a dashboard opened from a co-founder's link gets a trailing "Shared:"
 * tab. The person's own dashboard that the list does not hold yet (the first Home, created by `dashboard.get` after the
 * list was read) gets a plain tab.
 */
export function dashboardTabs(list: readonly DashboardSummary[], businessId: string, current: DashboardSummary | null | undefined, viewerId: string | null = null): TabItem[] {
  const tabs: TabItem[] = list.map((d) => ({ id: d.id, label: d.name, href: routes.home(businessId, d.id) }));
  if (current && !list.some((d) => d.id === current.id)) tabs.push({ id: current.id, label: isOwnDashboard(current, list, viewerId) ? current.name : `Shared: ${current.name}`, href: routes.home(businessId, current.id) });
  return tabs;
}

/** The signed-in person's own dashboard (editable): theirs by owner, or listed among theirs. */
export function isOwnDashboard(row: Pick<DashboardSummary, "id" | "userId">, list: readonly Pick<DashboardSummary, "id">[], viewerId: string | null): boolean {
  return (viewerId !== null && row.userId === viewerId) || list.some((d) => d.id === row.id);
}

/** Same widgets, places, sizes and settings (order aside): nothing to save. */
export function sameLayout(a: WidgetLayout, b: WidgetLayout): boolean {
  return layoutsEqual(fromGridLayout(a), fromGridLayout(b));
}

/** "Dashboard 2", "Dashboard 3", … never clashing with an existing name. */
export function nextDashboardName(existing: readonly string[], base = "Dashboard"): string {
  const taken = new Set(existing.map((n) => n.trim().toLowerCase()));
  if (!taken.has(base.toLowerCase())) return base;
  let n = 2;
  while (taken.has(`${base} ${n}`.toLowerCase())) n += 1;
  return `${base} ${n}`;
}

/** The share link co-founders open; they see the layout read-only and can copy it to their own dashboards. */
export function shareHref(origin: string, businessId: string, dashboardId: string): string {
  return `${origin.replace(/\/+$/, "")}${routes.home(businessId, dashboardId)}`;
}

/** Presets for the WidgetGrid toolbar (Founder's view, Builder, Seller, Investor update). */
export function gridPresets(): WidgetPreset[] {
  return DASHBOARD_PRESET_LIST.map((p) => ({ id: p.id, name: p.name, description: p.description, layout: toGridLayout(p.layout) }));
}

/** The preset a dashboard resets to: the one it was created from, else the Founder's view. */
export function resetPresetFor(preset: string | null | undefined): DashboardPresetId {
  return isDashboardPresetId(preset) ? preset : DEFAULT_PRESET;
}

/**
 * Version bookkeeping (AC-11.2.4). Every `dashboard.update` bumps `version` by one. When a save comes back with a
 * version further ahead than the one we knew plus one, another tab or device saved in between: adopt the server
 * copy rather than clobbering it.
 */
export function versionConflict(known: number, saved: number): boolean {
  return saved > known + 1;
}

/** A refetch that returns a newer version than the one on screen (and no save is in flight) means "edited elsewhere". */
export function editedElsewhere(known: number, fetched: number, saving: boolean): boolean {
  return !saving && fetched > known;
}

export interface DayOneInput {
  conversions: number;
  milestones: number;
  /** Cycles the team has finished (`cycle.status.completedCount`). */
  cyclesCompleted?: number;
}

/**
 * Day one (BUILD §11.2): nothing has happened yet, so the Home shows what will. It ends with the first finished cycle,
 * the first customer or the first milestone, whichever comes first (commit already starts cycle 1, so a business with
 * no customers is no longer on day one once the team has worked a cycle).
 */
export function isDayOne(input: DayOneInput): boolean {
  return input.conversions === 0 && input.milestones === 0 && (input.cyclesCompleted ?? 0) === 0;
}

/**
 * The day-one line, true to the cycle's state: never "press Continue to start the first cycle" while that cycle is
 * already running, or while a note in Respond holds Continue.
 */
export function dayOneLine(input: { running: boolean; cycleNumber: number | null; blocking: number }): string {
  if (input.running) return `Cycle ${input.cycleNumber ?? 1} is under way: the team is on its first tasks. These are the milestones ahead; they light up as customers and revenue arrive.`;
  if (input.blocking > 0) return `The team is waiting on you: answer the ${input.blocking === 1 ? "note" : `${input.blocking} notes`} in Respond, then Continue starts the next cycle. These are the milestones ahead.`;
  return "Nothing has happened yet. These are the milestones ahead; press Continue to start the first cycle.";
}

function describeTrophy(t: (typeof TROPHIES)[number], currency: string): string {
  if (t.metric === "customers") return t.threshold === 1 ? "The first paying customer." : `${formatNumber(t.threshold)} paying customers.`;
  if (t.metric === "mrrMinor") return `Monthly recurring revenue reaches ${t.label(currency).replace(/^First /, "").replace(/ MRR$/, "")}.`;
  return "A signed contract above the enterprise threshold.";
}

/** Every milestone ghosted: the cabinet on day one. */
export function ghostedMilestones(currency: string): TrophyCard[] {
  return TROPHIES.map((t) => ({ key: t.key, label: t.label(currency), description: describeTrophy(t, currency), achievedAt: null, currency }));
}

/** Which dashboard the route shows (server-safe, shared with the Home page's server prefetch). */
export { pickDashboardId } from "./pick-dashboard";
