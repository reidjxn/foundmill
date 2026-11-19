/**
 * The founder areas in apps/web (docs/DESIGN.md §8–§9): the shared registry (@foundmill/shared/areas) with this app's
 * routes and access rules on top. One place builds what the sidebar, the area tab bars on department routes, /crm and
 * /milestones, search and the palette show, so they always agree. Pure and unit-tested.
 */
import type { TabItem } from "@foundmill/dugout";
import { AREA_LABELS, areaLanding, areaOfTab, areaTabsByArea, departmentArea, sectionOfTab, type AreaDepartment, type AreaKey, type AreaSectionKey, type AreaTab, type StageFacts } from "@foundmill/shared/areas";
import { routes } from "@foundmill/widgets/shared/routes";
import { canOpenDepartment, FULL_ACCESS, type Access } from "./access";

export interface AreaNavInput {
  businessId: string;
  departments: readonly AreaDepartment[];
  /** What the person may open: walled departments and a walled CRM are left out. Default: everything. */
  access?: Access;
  /** Builder view on: every tab inline, Builder view's tabs included. Default off. */
  builder?: boolean;
  /** What the project has done: a tab shows once its moment has arrived (Builder view ignores it). Default: every tab. */
  stage?: StageFacts;
}

/** Every area's tabs for this person, in sidebar order (areas with nothing to open are left out). */
export function areaNav(input: AreaNavInput): Map<AreaKey, AreaTab[]> {
  const access = input.access ?? FULL_ACCESS;
  return areaTabsByArea(input.departments, { builder: input.builder ?? false, stage: input.stage, canOpen: (d) => canOpenDepartment(access, d), fixed: { crm: access.canRead("crm") } });
}

/** Where an area tab goes. */
export function areaTabHref(businessId: string, tab: AreaTab): string {
  if (tab.fixed === "milestones") return routes.milestones(businessId);
  if (tab.fixed === "crm") return routes.crm(businessId);
  return routes.department(businessId, tab.department!.slug, tab.slug!);
}

/** Where an area's sidebar item goes: its first inline tab. */
export function areaHref(businessId: string, tabs: readonly AreaTab[]): string | undefined {
  const first = areaLanding(tabs);
  return first ? areaTabHref(businessId, first) : undefined;
}

/** The area's tabs as the TabBar takes them: ids `<deptSlug>/<tabSlug>` (or the fixed key), hrefs and tiers. */
export function areaTabItems(businessId: string, tabs: readonly AreaTab[]): TabItem[] {
  return tabs.map((t) => ({ id: t.id, label: t.label, href: areaTabHref(businessId, t), tier: t.tier }));
}

/** The area tab id of a department route. */
export const areaTabId = (deptSlug: string, tabSlug: string) => `${deptSlug}/${tabSlug}`;

/** The area a department route belongs to (by the tab's module), or null for a department with no modules. */
export function areaOfRoute(department: Pick<AreaDepartment, "moduleKeys"> | undefined, tabSlug: string | undefined): AreaKey | null {
  if (!department) return null;
  return (tabSlug ? areaOfTab(department.moduleKeys, tabSlug) : null) ?? departmentArea(department.moduleKeys);
}

/** The breadcrumb of a department route: "Product › Formulation Lab" (the area links to its landing tab). */
export function areaBreadcrumbs(businessId: string, area: AreaKey, tabs: readonly AreaTab[], departmentName: string): { label: string; href?: string }[] {
  return [{ label: AREA_LABELS[area], href: areaHref(businessId, tabs) }, { label: departmentName }];
}

/**
 * What a department route's opening line reads from (docs/DESIGN.md §9 "Opening line"): the area, the department for
 * the kind line and the tab's section (Company). Null for a department the area does not list (no modules, hidden).
 */
export function areaOpeningOf(department: Pick<AreaDepartment, "name" | "moduleKeys"> | undefined, tabSlug: string, area: AreaKey | null, inArea: boolean): { area: AreaKey; departmentName: string; section: AreaSectionKey | null } | null {
  if (!department || !area || !inArea) return null;
  return { area, departmentName: department.name, section: sectionOfTab(department.moduleKeys, tabSlug) };
}

/** "Customers › Leads": how copy names a screen (the area the founder sees in the sidebar and the tab as its bar reads it). */
export function areaTabLabel(tab: Pick<AreaTab, "area" | "title">): string {
  return `${AREA_LABELS[tab.area]} › ${tab.title}`;
}
