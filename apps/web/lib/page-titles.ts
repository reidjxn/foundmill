/**
 * Browser titles of the screens inside a business (WCAG 2.4.2, audit A11Y-15). The business layout's template wraps
 * each into "<screen> · <business> · Foundmill"; these give the "<screen>" part. Pure and server-safe: the route pages'
 * `metadata` / `generateMetadata` call them, and the tests pin them.
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

/** The business layout's template: the screen, then the business, then the product. */
export function businessTitleTemplate(businessName: string, appName: string): string {
  return `%s · ${businessName} · ${appName}`;
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
