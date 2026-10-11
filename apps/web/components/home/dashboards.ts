/**
 * Pure helpers for the Home dashboards (BUILD §11.2 "Customisation", AC-11.2.4): tabs from `dashboard.list`, the
 * version bookkeeping behind "layout edits persist, version, and can be reset", presets for the WidgetGrid, the
 * share link co-founders open, and the day-one state (ghosted milestones).
 */
import type { TabItem, TrophyCard, WidgetPreset } from "@foundmill/dugout";
import { TROPHIES } from "@foundmill/journey";
import { DASHBOARD_PRESET_LIST, isDashboardPresetId, routes, toGridLayout, type DashboardPresetId } from "@foundmill/widgets";
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

/** One tab per dashboard of the signed-in founder; a dashboard opened from a co-founder's link gets a trailing tab. */
export function dashboardTabs(list: readonly DashboardSummary[], businessId: string, current: DashboardSummary | null | undefined): TabItem[] {
  const tabs: TabItem[] = list.map((d) => ({ id: d.id, label: d.name, href: routes.home(businessId, d.id) }));
  if (current && !list.some((d) => d.id === current.id)) tabs.push({ id: current.id, label: `Shared: ${current.name}`, href: routes.home(businessId, current.id) });
  return tabs;
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
}

/** Day one (BUILD §11.2): nothing has happened yet, so the Home shows what will. */
export function isDayOne(input: DayOneInput): boolean {
  return input.conversions === 0 && input.milestones === 0;
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
