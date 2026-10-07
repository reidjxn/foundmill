/** Department lookups shared by the department card, squad pulse, status strip and navigation helpers. */
import type { ModuleKey } from "@foundmill/shared";
import { MODULE_KEYS } from "@foundmill/shared";
import type { RibbonDepartment } from "@foundmill/dugout";
import { useWidgetData, useWidgetQuery, type QueryState } from "../data";
import { routes } from "./routes";
import type { DepartmentRow } from "./types";

export function useDepartments(opts?: { enabled?: boolean }): QueryState<DepartmentRow[]> {
  return useWidgetQuery<DepartmentRow[]>("department.list", { includeHidden: false, includeArchived: false }, opts);
}

/** Visible departments in the founder's order. */
export function orderedDepartments(rows: readonly DepartmentRow[] | undefined): DepartmentRow[] {
  return (rows ?? []).filter((d) => !d.hidden).slice().sort((a, b) => a.position - b.position || a.name.localeCompare(b.name));
}

export function toRibbonDepartments(rows: readonly DepartmentRow[] | undefined): RibbonDepartment[] {
  return orderedDepartments(rows).map((d) => ({ id: d.id, name: d.name, dept: d.colourToken }));
}

export const isModuleKey = (v: unknown): v is ModuleKey => typeof v === "string" && (MODULE_KEYS as readonly string[]).includes(v);

/** The module a department is "mostly" about: its first module key, used to pick the headline metric. */
export function primaryModule(d: Pick<DepartmentRow, "moduleKeys">): ModuleKey | null {
  const k = d.moduleKeys.find(isModuleKey);
  return k ?? null;
}

export function departmentForModule(rows: readonly DepartmentRow[] | undefined, moduleKey: ModuleKey): DepartmentRow | undefined {
  return orderedDepartments(rows).find((d) => d.moduleKeys.includes(moduleKey));
}

/** Href of a module tab: the department that owns the module and the tab slug (falls back to the first tab). */
export function moduleHref(bid: string, rows: readonly DepartmentRow[] | undefined, moduleKey: ModuleKey, tabSlug?: string): string | null {
  const d = departmentForModule(rows, moduleKey);
  if (!d) return null;
  const tab = (tabSlug && d.tabs.find((t) => t.slug === tabSlug)) || d.tabs.slice().sort((a, b) => a.position - b.position)[0];
  return tab ? routes.department(bid, d.slug, tab.slug) : null;
}

/** Hook form of `moduleHref` plus a navigate callback. */
export function useModuleNavigate(rows: readonly DepartmentRow[] | undefined): (moduleKey: ModuleKey, tabSlug?: string) => void {
  const { businessId, navigate } = useWidgetData();
  return (moduleKey, tabSlug) => {
    const href = moduleHref(businessId, rows, moduleKey, tabSlug);
    if (href) navigate(href);
  };
}

export interface DepartmentPick {
  departmentId?: string | null;
  module?: ModuleKey | string | null;
  slot?: number | null;
}

/**
 * Resolve the department a card shows: an explicit id, else the department owning a module, else the Nth visible
 * department (presets use `slot` so the Founder's view works for any archetype).
 */
export function resolveDepartment(rows: readonly DepartmentRow[] | undefined, pick: DepartmentPick): DepartmentRow | undefined {
  const ordered = orderedDepartments(rows);
  if (pick.departmentId) {
    const byId = ordered.find((d) => d.id === pick.departmentId);
    if (byId) return byId;
  }
  if (pick.module && isModuleKey(pick.module)) {
    const byModule = ordered.find((d) => d.moduleKeys.includes(pick.module as ModuleKey));
    if (byModule) return byModule;
  }
  if (typeof pick.slot === "number" && pick.slot >= 0) return ordered[pick.slot];
  return undefined;
}
