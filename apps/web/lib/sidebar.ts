/**
 * Sidebar items for the shell (BUILD §5.3, DESIGN §8; founder areas, 2026-11-09): Today, Needs you (the Inbox on its
 * Respond tab; badge: items to respond to), the founder areas Plan, Customers, Money, Product and Team (each a mapping
 * over module tabs, lib/areas.ts; badge: unread items from its departments' agents), then each department with no
 * modules as its own item (its dot and letter), the LIVE block (Network in every mode, badged with what waits for the
 * founder; Communities once LIVE) and the foot (Settings, Sign out). Contacts (the CRM) is a Customers
 * tab and Milestones a Plan tab; Team call is its own item under Team. The Anthropic key lives in Settings › Keys (reached from Settings and the palette),
 * not in the foot (B13). Pure and unit-tested; the layout feeds it `department.list` + `inbox.list`.
 */
import { BookOpen, Compass, Globe, Inbox, LogOut, Megaphone, PiggyBank, Settings, Sun, Users, Users2, Video, type LucideIcon } from "lucide-react";
import type { SidebarBrand, SidebarItem } from "@foundmill/dugout";
import type { DeptColourToken } from "@foundmill/shared";
import { AREA_LABELS, departmentArea, moduleLessDepartments, type AreaKey } from "@foundmill/shared/areas";
import { firstVisibleTab } from "@foundmill/shared/constants";
import { routes } from "@foundmill/widgets/shared/routes";
import { canOpenDepartment, FULL_ACCESS, type Access } from "./access";
import { areaHref, areaNav, areaOfRoute } from "./areas";
import { iconByName } from "./icons";

export interface SidebarDepartment {
  id: string;
  name: string;
  slug: string;
  icon?: string | null;
  colourToken: DeptColourToken;
  position: number;
  hidden?: boolean;
  /** The stored G-chord letter (departments.shortcut); only a department with no modules shows one. */
  shortcut?: string | null;
  moduleKeys?: readonly string[];
  squad?: readonly { id: string }[];
  tabs: readonly { slug: string; position: number; title?: string }[];
}

export interface SidebarInboxItem {
  fromAgentId: string | null;
  state: string;
}

export interface SidebarInput {
  businessId: string;
  departments: readonly SidebarDepartment[];
  /** `counts` from inbox.list. */
  inboxCounts?: Partial<Record<string, number>>;
  /** First page of inbox items; unread ones from a department's agents badge that department's area. */
  inboxItems?: readonly SidebarInboxItem[];
  live: boolean;
  /**
   * The founder's LIVE counts from `live.summary`: `total` (unread messages, requests and invitations) badges Network
   * in every mode, `moderation` (posts waiting in communities they moderate) badges Communities.
   */
  network?: { total: number; moderation: number };
  /** What the person may open (audit RUI-05): walled departments and a walled CRM are not listed. Default: everything. */
  access?: Access;
  /** Builder view (docs/DESIGN.md): an area link never lands on a Builder view tab while it is off. Default off. */
  builder?: boolean;
}

export const SIDEBAR_IDS = { home: "home", inbox: "inbox", settings: "settings", signOut: "sign-out", network: "network", communities: "communities", calls: "calls" } as const;

/** The sidebar id of an area's item. */
export const areaSidebarId = (area: AreaKey) => `area-${area}`;

/** The Inbox's sidebar label: what it holds for the founder (founder areas, 2026-11-09); the id and G I stay. */
export const NEEDS_YOU_LABEL = "Needs you";

/** The Team call item's label (docs/TEAM_CALL.md): the feature's own name. */
export const TEAM_CALL_LABEL = "Team call";

/** The CRM's display label (founder, 2026-10-20: "Contacts"), now a Customers tab; its slug keeps "crm". */
export const CRM_LABEL = "Contacts";

/** Each area's icon (lucide, through Dugout's Icon). */
const AREA_ICONS: Readonly<Record<AreaKey, LucideIcon>> = { plan: Compass, customers: Megaphone, money: PiggyBank, product: BookOpen, team: Users };

/** The collapsed tooltip's words for an area whose name does not say everything it holds. */
const AREA_HINTS: Partial<Record<AreaKey, string>> = { customers: "leads, campaigns and contacts", plan: "roadmap and milestones" };

/** The Foundmill wordmark closing the sidebar foot (DESIGN §8a). Not an item: Dugout draws it when the sidebar is expanded. */
export const SIDEBAR_BRAND: SidebarBrand = { href: "/" };

/** A module-less department's link: its first tab the person sees (Builder view's tabs skipped while it is off). */
export function departmentHref(businessId: string, d: SidebarDepartment, builder = false): string {
  const first = firstVisibleTab(d, builder);
  return routes.department(businessId, d.slug, first?.slug ?? "overview");
}

export function orderedVisibleDepartments<T extends SidebarDepartment>(departments: readonly T[]): T[] {
  return departments.filter((d) => !d.hidden).slice().sort((a, b) => a.position - b.position || a.name.localeCompare(b.name));
}

/** Unread inbox items per department, keyed by department id (agent → department through the squad lists). */
export function departmentBadges(departments: readonly SidebarDepartment[], items: readonly SidebarInboxItem[] | undefined): Map<string, number> {
  const out = new Map<string, number>();
  if (!items?.length) return out;
  const agentDept = new Map<string, string>();
  for (const d of departments) for (const a of d.squad ?? []) if (!agentDept.has(a.id)) agentDept.set(a.id, d.id);
  for (const it of items) {
    if (it.state !== "unread" || !it.fromAgentId) continue;
    const dept = agentDept.get(it.fromAgentId);
    if (dept) out.set(dept, (out.get(dept) ?? 0) + 1);
  }
  return out;
}

const withTitles = (departments: readonly SidebarDepartment[]) => departments.map((d) => ({ ...d, tabs: d.tabs.map((t) => ({ ...t, title: t.title ?? t.slug })) }));

export function buildSidebarItems(input: SidebarInput): SidebarItem[] {
  const bid = input.businessId;
  const access = input.access ?? FULL_ACCESS;
  const respond = input.inboxCounts?.respond ?? 0;
  const badges = departmentBadges(input.departments, input.inboxItems);
  const items: SidebarItem[] = [
    // Today, the front door (founder, 2026-11-07): the id and `fixed: "home"` stay, so G H and the tour's target follow.
    { id: SIDEBAR_IDS.home, label: "Today", icon: Sun, href: routes.today(bid), group: "main", fixed: "home" },
    // Needs you opens the Inbox on what needs a response; the id and `fixed: "inbox"` stay, so G I follows it.
    { id: SIDEBAR_IDS.inbox, label: NEEDS_YOU_LABEL, icon: Inbox, href: `${routes.inbox(bid)}?tab=respond`, group: "main", fixed: "inbox", badge: respond || undefined, badgeTone: "bad" },
  ];
  const departments = withTitles(input.departments);
  const nav = areaNav({ businessId: bid, departments, access, builder: input.builder });
  // An area's badge: the unread notes of the departments whose first module is the area's (each department counted once).
  const areaBadge = new Map<AreaKey, number>();
  for (const d of orderedVisibleDepartments(input.departments)) {
    const area = departmentArea(d.moduleKeys);
    const n = badges.get(d.id) ?? 0;
    if (area && n && canOpenDepartment(access, d)) areaBadge.set(area, (areaBadge.get(area) ?? 0) + n);
  }
  for (const [area, tabs] of nav) {
    items.push({ id: areaSidebarId(area), label: AREA_LABELS[area], icon: AREA_ICONS[area], href: areaHref(bid, tabs), group: "area", area, badge: areaBadge.get(area) || undefined, hint: AREA_HINTS[area] });
    // Team call (docs/TEAM_CALL.md §6) sits in the Team area's group, right under Team, for whoever may read the Team section.
    if (area === "team" && access.canRead("team")) items.push({ id: SIDEBAR_IDS.calls, label: TEAM_CALL_LABEL, icon: Video, href: routes.calls(bid), group: "area", hint: "talk it through with your team" });
  }
  // A department with no modules is no area's: it keeps its own item, dot and letter after Team.
  for (const d of moduleLessDepartments(departments)) {
    const row = input.departments.find((x) => x.id === d.id)!;
    if (!canOpenDepartment(access, row)) continue;
    items.push({ id: row.id, label: row.name, icon: iconByName(row.icon) as LucideIcon, href: departmentHref(bid, row, input.builder ?? false), group: "department", dept: row.colourToken, shortcut: row.shortcut ?? null, badge: badges.get(row.id) || undefined });
  }
  // Network is the founder's own (their connections, messages and invitations), so it is there in every mode with its
  // badge: a request or a message must reach a founder whichever business they have open. Communities
  // is about the business on the network, so it appears once it is LIVE.
  items.push({ id: SIDEBAR_IDS.network, label: "Network", icon: Globe, href: "/network", group: "live", badge: input.network?.total || undefined });
  if (input.live) items.push({ id: SIDEBAR_IDS.communities, label: "Communities", icon: Users2, href: "/communities", group: "live", badge: input.network?.moderation || undefined });
  items.push({ id: SIDEBAR_IDS.settings, label: "Settings", icon: Settings, href: routes.settings(bid, "business"), group: "foot" });
  // A button, not a link: the shell signs out with a POST (lib/auth/sign-out.ts), so nothing can prefetch it.
  items.push({ id: SIDEBAR_IDS.signOut, label: "Sign out", icon: LogOut, group: "foot" });
  return items;
}

/** The LIVE pages sit outside /b/[bid] (BUILD §6.2); each lights its own sidebar item, whichever business is current. */
const LIVE_ROUTE_ITEMS = [
  ["/network", SIDEBAR_IDS.network],
  // A public profile is reached from search or the Network; it lights the Network item.
  ["/profiles", SIDEBAR_IDS.network],
  ["/communities", SIDEBAR_IDS.communities],
] as const;

/**
 * Which sidebar item is active for a pathname: a department route lights the area of its tab's module (a merged
 * department lights a different area per tab), or its own item for a department with no modules; Milestones lights
 * Plan and Contacts lights Customers.
 */
export function activeSidebarId(pathname: string, businessId: string, departments: readonly SidebarDepartment[]): string | undefined {
  for (const [prefix, id] of LIVE_ROUTE_ITEMS) if (pathname === prefix || pathname.startsWith(`${prefix}/`)) return id;
  const base = `/b/${businessId}`;
  if (!pathname.startsWith(base)) return undefined;
  const rest = pathname.slice(base.length);
  // Today and its Details (the dashboards) both light the Today item.
  if (rest === "" || rest === "/" || rest.startsWith("/today") || rest.startsWith("/home")) return SIDEBAR_IDS.home;
  if (rest.startsWith("/inbox")) return SIDEBAR_IDS.inbox;
  if (rest.startsWith("/crm")) return areaSidebarId("customers");
  if (rest.startsWith("/calls")) return SIDEBAR_IDS.calls;
  if (rest.startsWith("/milestones") || rest.startsWith("/trophies")) return areaSidebarId("plan");
  // Settings › Keys included: the key is a Settings tab, not a sidebar item.
  if (rest.startsWith("/settings")) return SIDEBAR_IDS.settings;
  const m = /^\/d\/([^/]+)(?:\/([^/?#]+))?/.exec(rest);
  if (m) {
    const d = departments.find((x) => x.slug === m[1]);
    if (!d) return undefined;
    const area = areaOfRoute(d, m[2]);
    return area ? areaSidebarId(area) : d.id;
  }
  return undefined;
}
