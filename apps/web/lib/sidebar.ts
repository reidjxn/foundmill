/**
 * Sidebar items for the shell (BUILD §5.3, DESIGN §8): Home, Inbox (badge: items to respond to), departments in the
 * founder's order (badge: unread items from that department's agents), CRM, the LIVE block, foot items.
 * Pure and unit-tested; the layout feeds it `department.list` + `inbox.list`.
 */
import { Globe, Home, Inbox, KeyRound, LogOut, Settings, Trophy, Users, Users2, type LucideIcon } from "lucide-react";
import type { SidebarBrand, SidebarItem } from "@foundmill/dugout";
import type { DeptColourToken } from "@foundmill/shared";
import { routes } from "@foundmill/widgets/shared/routes";
import { iconByName } from "./icons";

export interface SidebarDepartment {
  id: string;
  name: string;
  slug: string;
  icon?: string | null;
  colourToken: DeptColourToken;
  position: number;
  hidden?: boolean;
  squad?: readonly { id: string }[];
  tabs: readonly { slug: string; position: number }[];
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
  /** First page of inbox items; unread ones from a department's agents badge that department. */
  inboxItems?: readonly SidebarInboxItem[];
  live: boolean;
}

export const SIDEBAR_IDS = { home: "home", inbox: "inbox", crm: "crm", milestones: "milestones", settings: "settings", keys: "keys", signOut: "sign-out", network: "network", communities: "communities", leaderboards: "leaderboards" } as const;

/** The Foundmill wordmark closing the sidebar foot (DESIGN §8a). Not an item: Dugout draws it when the sidebar is expanded. */
export const SIDEBAR_BRAND: SidebarBrand = { href: "/" };

export function departmentHref(businessId: string, d: SidebarDepartment): string {
  const first = d.tabs.slice().sort((a, b) => a.position - b.position)[0];
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

export function buildSidebarItems(input: SidebarInput): SidebarItem[] {
  const bid = input.businessId;
  const respond = input.inboxCounts?.respond ?? 0;
  const badges = departmentBadges(input.departments, input.inboxItems);
  const items: SidebarItem[] = [
    { id: SIDEBAR_IDS.home, label: "Home", icon: Home, href: routes.home(bid), group: "main", fixed: "home" },
    { id: SIDEBAR_IDS.inbox, label: "Inbox", icon: Inbox, href: routes.inbox(bid), group: "main", fixed: "inbox", badge: respond || undefined, badgeTone: "bad" },
  ];
  for (const d of orderedVisibleDepartments(input.departments)) {
    items.push({ id: d.id, label: d.name, icon: iconByName(d.icon) as LucideIcon, href: departmentHref(bid, d), group: "department", dept: d.colourToken, badge: badges.get(d.id) || undefined });
  }
  items.push({ id: SIDEBAR_IDS.crm, label: "CRM", icon: Users, href: routes.crm(bid), group: "main", fixed: "crm" });
  items.push({ id: SIDEBAR_IDS.milestones, label: "Milestones", icon: Trophy, href: `/b/${bid}/milestones`, group: "main" });
  if (input.live) {
    items.push({ id: SIDEBAR_IDS.network, label: "Network", icon: Globe, href: "/network", group: "live" });
    items.push({ id: SIDEBAR_IDS.communities, label: "Communities", icon: Users2, href: "/communities", group: "live" });
    items.push({ id: SIDEBAR_IDS.leaderboards, label: "Leaderboards", icon: Trophy, href: "/leaderboards", group: "live" });
  }
  items.push({ id: SIDEBAR_IDS.settings, label: "Settings", icon: Settings, href: routes.settings(bid, "business"), group: "foot" });
  items.push({ id: SIDEBAR_IDS.keys, label: "Anthropic key", icon: KeyRound, href: routes.settings(bid, "keys"), group: "foot" });
  // A button, not a link: the shell signs out with a POST (lib/auth/sign-out.ts), so nothing can prefetch it.
  items.push({ id: SIDEBAR_IDS.signOut, label: "Sign out", icon: LogOut, group: "foot" });
  return items;
}

/** The LIVE pages sit outside /b/[bid] (BUILD §6.2); each lights its own sidebar item, whichever business is current. */
const LIVE_ROUTE_ITEMS = [
  ["/network", SIDEBAR_IDS.network],
  ["/communities", SIDEBAR_IDS.communities],
  ["/leaderboards", SIDEBAR_IDS.leaderboards],
] as const;

/** Which sidebar item is active for a pathname. */
export function activeSidebarId(pathname: string, businessId: string, departments: readonly SidebarDepartment[]): string | undefined {
  for (const [prefix, id] of LIVE_ROUTE_ITEMS) if (pathname === prefix || pathname.startsWith(`${prefix}/`)) return id;
  const base = `/b/${businessId}`;
  if (!pathname.startsWith(base)) return undefined;
  const rest = pathname.slice(base.length);
  if (rest === "" || rest === "/" || rest.startsWith("/home")) return SIDEBAR_IDS.home;
  if (rest.startsWith("/inbox")) return SIDEBAR_IDS.inbox;
  if (rest.startsWith("/crm")) return SIDEBAR_IDS.crm;
  if (rest.startsWith("/milestones") || rest.startsWith("/trophies")) return SIDEBAR_IDS.milestones;
  if (rest.startsWith("/settings/keys")) return SIDEBAR_IDS.keys;
  if (rest.startsWith("/settings")) return SIDEBAR_IDS.settings;
  const m = /^\/d\/([^/]+)/.exec(rest);
  if (m) return departments.find((d) => d.slug === m[1])?.id;
  return undefined;
}
