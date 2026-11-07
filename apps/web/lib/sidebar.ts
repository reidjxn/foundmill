/**
 * Sidebar items for the shell (BUILD §5.3, DESIGN §8): Home, Inbox (badge: items to respond to), departments in the
 * founder's order (badge: unread items from that department's agents), Contacts (the CRM: the slug and the fixed
 * surface keep "crm", the label follows docs/UX_AUDIT_AND_PLAN.md §12), Milestones, the LIVE block (Network in every
 * mode, badged with what waits for the founder; Communities and Leaderboards once LIVE), foot items (Settings, Sign
 * out). The Anthropic key lives in Settings › Keys (reached from Settings and the palette), not in the foot (B13).
 * Pure and unit-tested; the layout feeds it `department.list` + `inbox.list`.
 */
import { Globe, Inbox, LogOut, Medal, Settings, Sun, Trophy, Users, Users2, type LucideIcon } from "lucide-react";
import type { SidebarBrand, SidebarItem } from "@foundmill/dugout";
import type { DeptColourToken } from "@foundmill/shared";
import { routes } from "@foundmill/widgets/shared/routes";
import { canOpenDepartment, FULL_ACCESS, type Access } from "./access";
import { iconByName } from "./icons";

export interface SidebarDepartment {
  id: string;
  name: string;
  slug: string;
  icon?: string | null;
  colourToken: DeptColourToken;
  position: number;
  hidden?: boolean;
  /** The stored G-chord letter (departments.shortcut); null until the API settles one. */
  shortcut?: string | null;
  moduleKeys?: readonly string[];
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
  /**
   * The founder's LIVE counts from `live.summary`: `total` (unread messages, requests and invitations) badges Network
   * in every mode, `moderation` (posts waiting in communities they moderate) badges Communities.
   */
  network?: { total: number; moderation: number };
  /** What the person may open (audit RUI-05): walled departments and a walled CRM are not listed. Default: everything. */
  access?: Access;
}

export const SIDEBAR_IDS = { home: "home", inbox: "inbox", crm: "crm", milestones: "milestones", settings: "settings", signOut: "sign-out", network: "network", communities: "communities", leaderboards: "leaderboards" } as const;

/** The CRM's display label (founder, 2026-10-20: "Contacts"); its slug, id and G chord keep "crm". */
export const CRM_LABEL = "Contacts";
/** The Contacts item's tooltip line: the old name, for operators who look for it (B13). */
export const CRM_HINT = "The CRM";

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
  const access = input.access ?? FULL_ACCESS;
  const respond = input.inboxCounts?.respond ?? 0;
  const badges = departmentBadges(input.departments, input.inboxItems);
  const items: SidebarItem[] = [
    // Today, the front door (founder, 2026-11-07): the id and `fixed: "home"` stay, so G H and the tour's target follow.
    { id: SIDEBAR_IDS.home, label: "Today", icon: Sun, href: routes.today(bid), group: "main", fixed: "home" },
    { id: SIDEBAR_IDS.inbox, label: "Inbox", icon: Inbox, href: routes.inbox(bid), group: "main", fixed: "inbox", badge: respond || undefined, badgeTone: "bad" },
  ];
  for (const d of orderedVisibleDepartments(input.departments)) {
    if (!canOpenDepartment(access, d)) continue;
    items.push({ id: d.id, label: d.name, icon: iconByName(d.icon) as LucideIcon, href: departmentHref(bid, d), group: "department", dept: d.colourToken, shortcut: d.shortcut ?? null, badge: badges.get(d.id) || undefined });
  }
  if (access.canRead("crm")) items.push({ id: SIDEBAR_IDS.crm, label: CRM_LABEL, icon: Users, href: routes.crm(bid), group: "main", fixed: "crm", hint: CRM_HINT });
  items.push({ id: SIDEBAR_IDS.milestones, label: "Milestones", icon: Trophy, href: `/b/${bid}/milestones`, group: "main" });
  // Network is the founder's own (their connections, messages and invitations), so it is there in every mode with its
  // badge: a request or a message must reach a founder whichever business they have open. Communities and Leaderboards
  // are about the business on the network, so they appear once it is LIVE (Leaderboards with its own Medal: the
  // Trophy is Milestones', B22).
  items.push({ id: SIDEBAR_IDS.network, label: "Network", icon: Globe, href: "/network", group: "live", badge: input.network?.total || undefined });
  if (input.live) {
    items.push({ id: SIDEBAR_IDS.communities, label: "Communities", icon: Users2, href: "/communities", group: "live", badge: input.network?.moderation || undefined });
    items.push({ id: SIDEBAR_IDS.leaderboards, label: "Leaderboards", icon: Medal, href: "/leaderboards", group: "live" });
  }
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
  ["/leaderboards", SIDEBAR_IDS.leaderboards],
] as const;

/** Which sidebar item is active for a pathname. */
export function activeSidebarId(pathname: string, businessId: string, departments: readonly SidebarDepartment[]): string | undefined {
  for (const [prefix, id] of LIVE_ROUTE_ITEMS) if (pathname === prefix || pathname.startsWith(`${prefix}/`)) return id;
  const base = `/b/${businessId}`;
  if (!pathname.startsWith(base)) return undefined;
  const rest = pathname.slice(base.length);
  // Today and its Details (the dashboards) both light the Today item.
  if (rest === "" || rest === "/" || rest.startsWith("/today") || rest.startsWith("/home")) return SIDEBAR_IDS.home;
  if (rest.startsWith("/inbox")) return SIDEBAR_IDS.inbox;
  if (rest.startsWith("/crm")) return SIDEBAR_IDS.crm;
  if (rest.startsWith("/milestones") || rest.startsWith("/trophies")) return SIDEBAR_IDS.milestones;
  // Settings › Keys included: the key is a Settings tab, not a sidebar item.
  if (rest.startsWith("/settings")) return SIDEBAR_IDS.settings;
  const m = /^\/d\/([^/]+)/.exec(rest);
  if (m) return departments.find((d) => d.slug === m[1])?.id;
  return undefined;
}
