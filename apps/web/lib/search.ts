/**
 * Universal search (BUILD §11.12, §5.3): local palette items (screens, departments, commands, recent inbox items)
 * plus the API's hybrid `crm.search` results, and the Help group (the defined terms of `TERMS` with the business
 * glossary applied, and the keyboard shortcuts; docs/UX_AUDIT_AND_PLAN.md §7.7, B12). The CommandPalette runs in
 * `remote` mode: the app filters, the palette only applies `kind:` and `>` locally and matches Help itself. Pure
 * helpers here; the shell wires the debounce and the query.
 */
import { KEYBOARD_SHORTCUTS_HELP_ITEM, type PaletteHelpItem, type PaletteItem, type SearchQuery } from "@foundmill/dugout";
import type { DeptColourToken, EntityKind, Glossary } from "@foundmill/shared";
import { learnPath, termsWithGlossary } from "@foundmill/shared/terms";
import { routes } from "@foundmill/widgets/shared/routes";
import { accountRoutes } from "./account-routes";
import { canOpenDepartment, FULL_ACCESS, type Access } from "./access";
import { entityHref } from "./entity-links";
import { CRM_LABEL } from "./sidebar";

export interface SearchDepartment {
  id: string;
  name: string;
  slug: string;
  colourToken: DeptColourToken;
  hidden?: boolean;
  moduleKeys?: readonly string[];
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
  // "Your words" on screen (docs/UX_AUDIT_AND_PLAN.md §7.17); the slug stays "glossary", and "glossary" stays a keyword.
  { slug: "glossary", label: "Your words" },
  { slug: "members", label: "Members" },
  { slug: "integrations", label: "Integrations" },
  { slug: "keys", label: "Keys" },
  { slug: "billing", label: "Billing" },
  // Personal, not the business's: the signed-in person's date and time format, in every business (founder, 2026-10-11).
  { slug: "preferences", label: "Preferences" },
  { slug: "danger", label: "Danger zone" },
] as const;
export type SettingsTabSlug = (typeof SETTINGS_TABS)[number]["slug"];

/** The founder's businesses, for the palette's "Open <business>" rows (the founder profile lists them). */
export interface SearchBusiness {
  id: string;
  name: string;
}

export interface LocalPaletteInput {
  businessId: string;
  departments: readonly SearchDepartment[];
  inboxItems?: readonly SearchInboxItem[];
  live: boolean;
  /** The screen on view has a layout to edit (Home, a widget screen): only then does "Edit layout" appear. */
  canEditLayout?: boolean;
  /** Every business the founder can open; the current one is left out of the "Open" rows. */
  businesses?: readonly SearchBusiness[];
  /** What the person may open and change (walled departments, the CRM, admin-only commands). Default: everything. */
  access?: Access;
}

export function localPaletteItems(input: LocalPaletteInput): PaletteItem[] {
  const bid = input.businessId;
  const access = input.access ?? FULL_ACCESS;
  const items: PaletteItem[] = [
    { id: "screen:home", kind: "screen", label: "Home", href: routes.home(bid), keywords: ["dashboard"], shortcut: ["G", "H"] },
    { id: "screen:inbox", kind: "screen", label: "Inbox", href: routes.inbox(bid), shortcut: ["G", "I"] },
    // "Contacts" on screen; "crm" stays a keyword so the old name still finds it.
    ...(access.canRead("crm") ? [{ id: "screen:crm", kind: "screen" as const, label: CRM_LABEL, href: routes.crm(bid), keywords: ["crm", "contacts", "people", "organizations"], shortcut: ["G", "C"] }] : []),
    { id: "screen:milestones", kind: "screen", label: "Milestones", href: `/b/${bid}/milestones` },
  ];
  for (const d of input.departments) {
    // Hidden departments, and those whose every module is walled for this person, are not offered.
    if (d.hidden || !canOpenDepartment(access, d)) continue;
    const tabs = d.tabs.slice().sort((a, b) => a.position - b.position);
    const first = tabs[0];
    items.push({ id: `department:${d.id}`, kind: "department", label: d.name, dept: d.colourToken, href: first ? routes.department(bid, d.slug, first.slug) : undefined, keywords: [d.slug] });
    for (const t of tabs) items.push({ id: `screen:${d.id}:${t.slug}`, kind: "screen", label: `${d.name} · ${t.title}`, dept: d.colourToken, href: routes.department(bid, d.slug, t.slug), keywords: [d.slug, t.slug] });
  }
  for (const t of SETTINGS_TABS) {
    if (t.slug === "preferences") continue;
    items.push({ id: `command:settings:${t.slug}`, kind: "command", label: `Settings · ${t.label}`, href: routes.settings(bid, t.slug), keywords: ["settings", t.slug, ...(t.slug === "glossary" ? ["rename", "words", "nouns"] : [])] });
  }
  // The person's own preferences (the date format, the guided layer's switch and the text size), found by what they change.
  items.push({
    id: "command:preferences",
    kind: "command",
    label: "Preferences",
    description: "Your date format, guidance and text size, in every business",
    href: routes.settings(bid, "preferences"),
    keywords: ["settings", "date format", "time format", "24-hour", "12-hour", "clock", "day first", "ISO 8601", "guidance", "explain", "text size", "comfortable", "checklist", "tour"],
  });
  // Commands a role cannot use are not offered (they would only answer with a refusal).
  if (access.canChange) items.push({ id: "command:refresh-inbox", kind: "command", label: "Refresh Inbox", description: "Ask the team for one quick note (does not start a cycle)", shortcut: ["R"] });
  // Only where the screen on view has a layout: elsewhere the command did nothing (audit OL-29).
  if (input.canEditLayout) items.push({ id: "command:edit-layout", kind: "command", label: "Edit layout", description: "Rearrange the widgets on this screen", shortcut: ["E"] });
  if (access.isAdmin) items.push({ id: "command:stop-all", kind: "command", label: "Stop all agents", description: "Pause the whole team. An owner can resume.", keywords: ["pause", "stop", "agents"] });
  items.push({ id: "command:sign-out", kind: "command", label: "Sign out", description: "End your session on this device", keywords: ["log out", "logout", "sign off"] });
  if (access.isAdmin) items.push({ id: "command:holiday", kind: "command", label: "Go on vacation", description: "Hand the business to the Chief of Staff", href: routes.settings(bid, "mode") });
  // Every other business the founder can open, a new one and the list of them all (audit IAE-08, WEB-13).
  for (const b of input.businesses ?? []) {
    if (b.id === bid) continue;
    items.push({ id: `business:${b.id}`, kind: "command", label: `Switch to ${b.name}`, description: "Switch business", href: routes.home(b.id), keywords: ["switch", "business", "open", b.name] });
  }
  items.push({ id: "command:new-business", kind: "command", label: "Create a new business", description: "From an idea in the Ideation Studio, or import what already exists", href: accountRoutes.newBusiness, keywords: ["new business", "create", "start", "another", "business", "idea", "import"] });
  items.push({ id: "command:manage-businesses", kind: "command", label: "Manage businesses", description: "Open one, change its settings or restore an archived one", href: accountRoutes.businesses, keywords: ["businesses", "manage", "archived", "restore", "your businesses"] });
  items.push({ id: "command:profile", kind: "command", label: "Your profile", description: "Your founder profile: name, background and preferences", href: "/onboarding", keywords: ["profile", "founder", "account", "me"] });
  for (const it of input.inboxItems ?? []) {
    if (it.state === "archived") continue;
    items.push({ id: `inbox:${it.id}`, kind: "inbox", label: it.subject, description: it.type.replace(/_/g, " "), href: routes.inbox(bid, it.id) });
  }
  // Network is the founder's own, in every mode (as in the sidebar).
  items.push({ id: "screen:network", kind: "screen", label: "Network", href: "/network" });
  if (input.live) {
    items.push({ id: "screen:communities", kind: "screen", label: "Communities", href: "/communities" });
    items.push({ id: "screen:leaderboards", kind: "screen", label: "Leaderboards", href: "/leaderboards" });
  }
  return items;
}

/**
 * The palette's Help group: every defined term ("Runway" with its one-line meaning, opening the screen that shows it,
 * in the business's own words through the glossary) after the keyboard shortcuts row, which the AppShell answers by
 * opening the overlay. A term without a `learn` target (Estimate, Vacation) is a row that reads and opens nothing: the
 * definition is the row itself, the way the design system's `Term` shows the same `short` in its card. Opening the
 * DefinitionCard from such a row needs the palette's help item to carry the definition (`PaletteHelpItem` holds a title,
 * a line and an href today) and the shell to answer the choice; both live outside this module.
 */
export function helpPaletteItems(businessId: string, glossary?: Glossary | null): PaletteHelpItem[] {
  const terms = Object.values(termsWithGlossary(glossary)).map((t): PaletteHelpItem => ({ id: `help:${t.id}`, title: t.word, line: t.short, href: t.learn ? learnPath(t.learn, businessId) : undefined }));
  return [KEYBOARD_SHORTCUTS_HELP_ITEM, ...terms];
}

export interface EntityHit {
  entity: { id: string; kind: EntityKind; displayName: string; identifiers?: Record<string, unknown>; agentId?: string | null };
  score: number;
  matchedOn: string;
}

/** Records found by `crm.search`; an agent's record opens the agent's profile, not a CRM record (audit GTM-19). */
export function entityPaletteItems(businessId: string, hits: readonly EntityHit[]): PaletteItem[] {
  return hits.map((h) => {
    const ids = h.entity.identifiers ?? {};
    const description = [typeof ids.email === "string" ? ids.email : null, typeof ids.domain === "string" ? ids.domain : null].filter(Boolean).join(" · ") || undefined;
    return { id: `entity:${h.entity.id}`, kind: h.entity.kind, label: h.entity.displayName, description, href: entityHref(businessId, h.entity) };
  });
}

/** The crm.search input for a parsed palette query (operators map to the API's filters). */
export function searchInputFor(q: SearchQuery, resolveDepartment?: (nameOrSlug: string) => string | undefined): { q: string; role?: string; stage?: string; departmentId?: string; limit: number } | null {
  if (q.commandsOnly) return null;
  const text = q.text.trim();
  const departmentId = q.filters.department ? resolveDepartment?.(q.filters.department) : undefined;
  // Operators alone (`role:supplier`) list every match (audit GTM-27); with neither words nor operators, no search.
  if (!text && !q.filters.role && !q.filters.stage && !departmentId) return null;
  return { q: text, role: q.filters.role, stage: q.filters.stage, departmentId, limit: 20 };
}

/** Local ranking: a keyword that is the query › prefix of the row › prefix of a word › substring. Used for the non-entity rows when a query is active. */
export function filterLocal(items: readonly PaletteItem[], text: string): PaletteItem[] {
  const t = text.trim().toLowerCase();
  if (!t) return [...items];
  const score = (it: PaletteItem): number => {
    const hay = [it.label, ...(it.keywords ?? []), it.description ?? ""].join(" ").toLowerCase();
    // A row that lists the query as a keyword ("switch" for "Open <business>") outranks one that only mentions it.
    if ((it.keywords ?? []).some((k) => k.toLowerCase() === t)) return 4;
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
