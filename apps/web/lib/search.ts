/**
 * Universal search (BUILD §11.12, §5.3): local palette items (screens, departments, commands, recent inbox items)
 * plus the API's hybrid `crm.search` results. The CommandPalette runs in `remote` mode: the app filters, the
 * palette only applies `kind:` and `>` locally. Pure helpers here; the shell wires the debounce and the query.
 */
import type { PaletteItem, SearchQuery } from "@foundmill/dugout";
import type { DeptColourToken, EntityKind } from "@foundmill/shared";
import { routes } from "@foundmill/widgets/shared/routes";

export interface SearchDepartment {
  id: string;
  name: string;
  slug: string;
  colourToken: DeptColourToken;
  hidden?: boolean;
  tabs: readonly { slug: string; title: string; position: number }[];
}

export interface SearchInboxItem {
  id: string;
  subject: string;
  type: string;
  state: string;
}

export const SETTINGS_TABS = [
  { slug: "business", label: "Business" },
  { slug: "mode", label: "Mode" },
  { slug: "departments", label: "Departments" },
  { slug: "glossary", label: "Glossary" },
  { slug: "members", label: "Members" },
  { slug: "integrations", label: "Integrations" },
  { slug: "keys", label: "Keys" },
  { slug: "billing", label: "Billing" },
  { slug: "danger", label: "Danger zone" },
] as const;
export type SettingsTabSlug = (typeof SETTINGS_TABS)[number]["slug"];

export function localPaletteItems(input: { businessId: string; departments: readonly SearchDepartment[]; inboxItems?: readonly SearchInboxItem[]; live: boolean }): PaletteItem[] {
  const bid = input.businessId;
  const items: PaletteItem[] = [
    { id: "screen:home", kind: "screen", label: "Home", href: routes.home(bid), keywords: ["dashboard"], shortcut: ["G", "H"] },
    { id: "screen:inbox", kind: "screen", label: "Inbox", href: routes.inbox(bid), shortcut: ["G", "I"] },
    { id: "screen:crm", kind: "screen", label: "CRM", href: routes.crm(bid), keywords: ["contacts", "people", "organisations"], shortcut: ["G", "C"] },
    { id: "screen:milestones", kind: "screen", label: "Milestones", href: `/b/${bid}/milestones` },
  ];
  for (const d of input.departments) {
    if (d.hidden) continue;
    const tabs = d.tabs.slice().sort((a, b) => a.position - b.position);
    const first = tabs[0];
    items.push({ id: `department:${d.id}`, kind: "department", label: d.name, dept: d.colourToken, href: first ? routes.department(bid, d.slug, first.slug) : undefined, keywords: [d.slug] });
    for (const t of tabs) items.push({ id: `screen:${d.id}:${t.slug}`, kind: "screen", label: `${d.name} · ${t.title}`, dept: d.colourToken, href: routes.department(bid, d.slug, t.slug), keywords: [d.slug, t.slug] });
  }
  for (const t of SETTINGS_TABS) items.push({ id: `command:settings:${t.slug}`, kind: "command", label: `Settings · ${t.label}`, href: routes.settings(bid, t.slug), keywords: ["settings", t.slug] });
  items.push({ id: "command:refresh-inbox", kind: "command", label: "Refresh Inbox", description: "Pull one new note", shortcut: ["R"] });
  items.push({ id: "command:edit-layout", kind: "command", label: "Edit layout", description: "Rearrange the widgets on this screen", shortcut: ["E"] });
  items.push({ id: "command:stop-all", kind: "command", label: "Stop all agents", description: "Kill switch: pause every workflow, engine and campaign" });
  items.push({ id: "command:holiday", kind: "command", label: "Go on vacation", description: "Hand the business to the Chief of Staff", href: routes.settings(bid, "mode") });
  for (const it of input.inboxItems ?? []) {
    if (it.state === "archived") continue;
    items.push({ id: `inbox:${it.id}`, kind: "inbox", label: it.subject, description: it.type.replace(/_/g, " "), href: routes.inbox(bid, it.id) });
  }
  if (input.live) {
    items.push({ id: "screen:network", kind: "screen", label: "Network", href: "/network" });
    items.push({ id: "screen:communities", kind: "screen", label: "Communities", href: "/communities" });
    items.push({ id: "screen:leaderboards", kind: "screen", label: "Leaderboards", href: "/leaderboards" });
  }
  return items;
}

export interface EntityHit {
  entity: { id: string; kind: EntityKind; displayName: string; identifiers?: Record<string, unknown> };
  score: number;
  matchedOn: string;
}

export function entityPaletteItems(businessId: string, hits: readonly EntityHit[]): PaletteItem[] {
  return hits.map((h) => {
    const ids = h.entity.identifiers ?? {};
    const description = [typeof ids.email === "string" ? ids.email : null, typeof ids.domain === "string" ? ids.domain : null].filter(Boolean).join(" · ") || undefined;
    return { id: `entity:${h.entity.id}`, kind: h.entity.kind, label: h.entity.displayName, description, href: routes.crm(businessId, h.entity.id) };
  });
}

/** The crm.search input for a parsed palette query (operators map to the API's filters). */
export function searchInputFor(q: SearchQuery, resolveDepartment?: (nameOrSlug: string) => string | undefined): { q: string; role?: string; stage?: string; departmentId?: string; limit: number } | null {
  const text = q.text.trim();
  if (!text || q.commandsOnly) return null;
  const departmentId = q.filters.department ? resolveDepartment?.(q.filters.department) : undefined;
  return { q: text, role: q.filters.role, stage: q.filters.stage, departmentId, limit: 20 };
}

/** Local ranking: prefix of a word › substring. Used for the non-entity rows when a query is active. */
export function filterLocal(items: readonly PaletteItem[], text: string): PaletteItem[] {
  const t = text.trim().toLowerCase();
  if (!t) return [...items];
  const score = (it: PaletteItem): number => {
    const hay = [it.label, ...(it.keywords ?? []), it.description ?? ""].join(" ").toLowerCase();
    if (hay.startsWith(t)) return 3;
    if (hay.split(/\s|·/).some((w) => w.startsWith(t))) return 2;
    if (hay.includes(t)) return 1;
    return 0;
  };
  return items
    .map((it) => ({ it, s: score(it) }))
    .filter((x) => x.s > 0)
    .sort((a, b) => b.s - a.s)
    .map((x) => x.it);
}
