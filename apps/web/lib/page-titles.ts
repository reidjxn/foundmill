/**
 * Browser titles of the screens inside a business (WCAG 2.4.2, audit A11Y-15): "<screen> · <business> · Foundmill".
 * These give the "<screen>" part, by route (`businessScreenTitle`), and <BusinessTitle> (components/shell) renders the
 * whole title in the browser from what the shell already holds. Next metadata gives none under /b/[bid]: asking for
 * the business's name there cost a `business.get` on every navigation and hover prefetch. Pure and server-safe; the
 * tests pin them.
 */
import { AGENT_TABS } from "@/components/agents/tabs";
import { ENTITY_TABS } from "@/components/crm/tabs";
import { SETTINGS_TABS } from "@/lib/search";

/** The screens with a fixed title. */
export const SCREEN_TITLES = {
  home: "Home",
  inbox: "Inbox",
  crm: "CRM",
  milestones: "Milestones",
  journey: "Customer Update",
} as const;

/** The whole title: the screen, then the business, then the product; the business and the product without a screen. */
export function businessDocumentTitle(screen: string | null, businessName: string, appName: string): string {
  return screen ? `${screen} · ${businessName} · ${appName}` : `${businessName} · ${appName}`;
}

export function settingsTitle(tab: string): string {
  const label = SETTINGS_TABS.find((t) => t.slug === tab)?.label;
  return label ? `${label} · Settings` : "Settings";
}

interface TitleDepartment {
  slug: string;
  name: string;
  tabs: readonly { slug: string; title: string }[];
  squad: readonly { id: string; name: string }[];
}

/** "Overview · Finance"; the department alone when the tab is unknown, "Department" when the department is. */
export function departmentTitle(departments: readonly TitleDepartment[], deptSlug: string, tabSlug: string): string {
  const dept = departments.find((d) => d.slug === deptSlug);
  if (!dept) return "Department";
  const tab = dept.tabs.find((t) => t.slug === tabSlug);
  return tab ? `${tab.title} · ${dept.name}` : dept.name;
}

/** "Training · Mara"; "Agent" when the agent is in none of the departments the layout loaded. */
export function agentTitle(departments: readonly TitleDepartment[], agentId: string, tab: string): string {
  const agent = departments.flatMap((d) => d.squad).find((a) => a.id === agentId);
  const label = AGENT_TABS.find((t) => t.id === tab)?.label;
  const name = agent?.name ?? "Agent";
  return label ? `${label} · ${name}` : name;
}

/** "Activity · Acme Ltd"; the CRM when the entity cannot be read. */
export function entityTitle(entityName: string | null, tab: string): string {
  const label = ENTITY_TABS.find((t) => t.id === tab)?.label;
  const name = entityName?.trim() || SCREEN_TITLES.crm;
  return label ? `${label} · ${name}` : name;
}

/** The entity id of a CRM record path inside the business (/b/<id>/crm/<entityId>/<tab>), else null. */
export function entityIdOfPath(pathname: string, businessId: string): string | null {
  const [section, entityId] = businessPathParts(pathname, businessId) ?? [];
  return section === "crm" && entityId ? entityId : null;
}

function businessPathParts(pathname: string, businessId: string): string[] | null {
  const prefix = `/b/${businessId}`;
  if (pathname !== prefix && !pathname.startsWith(`${prefix}/`)) return null;
  return pathname.slice(prefix.length + 1).split("/");
}

/**
 * The "<screen>" part for a path inside the business, as each route names itself: the fixed screens, a settings
 * section, a department tab and an agent by the departments the shell holds, a CRM record by its name once the record
 * is loaded. Null for a path that is none of these (the title is then the business and the product).
 */
export function businessScreenTitle(pathname: string, businessId: string, departments: readonly TitleDepartment[], entityName: string | null = null): string | null {
  const [section, a = "", b = ""] = businessPathParts(pathname, businessId) ?? [];
  switch (section) {
    case "home":
      return SCREEN_TITLES.home;
    case "inbox":
      return SCREEN_TITLES.inbox;
    case "crm":
      return a ? entityTitle(entityName, b) : SCREEN_TITLES.crm;
    case "milestones":
      return SCREEN_TITLES.milestones;
    case "journey":
      return SCREEN_TITLES.journey;
    case "settings":
      return settingsTitle(a);
    case "d":
      return departmentTitle(departments, a, b);
    case "agents":
      return agentTitle(departments, a, b);
    default:
      return null;
  }
}
