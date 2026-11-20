/**
 * Founder areas (docs/DESIGN.md §8–§9, founder decisions 2026-11-09): the sidebar asks the founder's questions (Plan,
 * Customers, Money, Product, Team) instead of listing departments. An area is a mapping over module tabs, the
 * `(module, tab)` pair, never over department names (CLAUDE.md: departments are labels over modules), so a renamed,
 * merged or split department still lands its tabs where they belong. Department routes stay as they are; an area only
 * groups their tabs into one tab bar. Pure, no Zod: browser code imports it from "@foundmill/shared/areas".
 *
 * - Every tab of a visible department goes to the area of the module that owns its slug (slugs are unique across
 *   modules), with `TAB_AREA_OVERRIDES` on top (product › roadmap is Plan's). A founder's own tab goes to the area of
 *   the department's first module. A department with no modules is no area's: it stays its own sidebar item.
 * - Company (the legal module) is a section inside Money.
 * - Tiers: a module's `DEFAULT_TABS` show inline, its other tabs sit behind "More detail", Builder view's tabs are not
 *   offered while it is off. A visible department with no inline tab gets its first tab promoted, so every department
 *   is one click from its area (Formulation Lab › Specialists). With Builder view on every tab shows inline.
 * - Two departments in one area with the same tab title: each label carries its department ("Specialists · Formulation Lab").
 */
import { MODULE_KEYS, tabModule, tabTier, visibleTabs, type ModuleKey } from "./constants";

export const AREA_KEYS = ["plan", "customers", "money", "product", "team"] as const;
export type AreaKey = (typeof AREA_KEYS)[number];

/** The sidebar's words for the areas. */
export const AREA_LABELS: Readonly<Record<AreaKey, string>> = { plan: "Plan", customers: "Customers", money: "Money", product: "Product", team: "Team" };

/** The G-chord letter of each area (founder decision 2026-11-09): G P, G C, G M, G R (pRoduct; P is Plan's), G T. */
export const AREA_LETTERS: Readonly<Record<AreaKey, string>> = { plan: "P", customers: "C", money: "M", product: "R", team: "T" };

/** The area each module's tabs go to by default. */
export const MODULE_AREA: Readonly<Record<ModuleKey, AreaKey>> = {
  product: "product",
  development: "product",
  distribution: "customers",
  finance: "money",
  team: "team",
  legal: "money",
};

/** Tabs that leave their module's area. */
export const TAB_AREA_OVERRIDES: Partial<Record<ModuleKey, Readonly<Record<string, AreaKey>>>> = { product: { roadmap: "plan" } };

/** Named sections inside an area: Company (the legal module) inside Money. */
export const AREA_SECTIONS = { company: { area: "money", label: "Company", modules: ["legal"] } } as const satisfies Record<string, { area: AreaKey; label: string; modules: readonly ModuleKey[] }>;
export type AreaSectionKey = keyof typeof AREA_SECTIONS;

/** Surfaces that are not department tabs but belong to an area's tab bar, after the department tabs. Always inline. */
export const AREA_FIXED_TABS: Partial<Record<AreaKey, readonly { key: AreaFixedTab; label: string }[]>> = {
  plan: [{ key: "milestones", label: "Milestones" }],
  customers: [{ key: "crm", label: "Contacts" }],
};
export type AreaFixedTab = "milestones" | "crm";

/** The area a fixed surface belongs to. */
export const FIXED_TAB_AREA: Readonly<Record<AreaFixedTab, AreaKey>> = { milestones: "plan", crm: "customers" };

export const isAreaKey = (v: unknown): v is AreaKey => typeof v === "string" && (AREA_KEYS as readonly string[]).includes(v);

const moduleKeysOf = (moduleKeys: readonly string[] | null | undefined): ModuleKey[] => (moduleKeys ?? []).filter((k): k is ModuleKey => (MODULE_KEYS as readonly string[]).includes(k));

/** The area of a department as a whole (its first module's), or null for a department with no modules. */
export function departmentArea(moduleKeys: readonly string[] | null | undefined): AreaKey | null {
  const first = moduleKeysOf(moduleKeys)[0];
  return first ? MODULE_AREA[first] : null;
}

/**
 * The area a tab of a department over these modules goes to: its owning module's (or that module's override for the
 * slug); a founder's own tab goes with the department's first module. Null for a department with no modules.
 */
export function areaOfTab(moduleKeys: readonly string[] | null | undefined, slug: string): AreaKey | null {
  const owner = tabModule(moduleKeysOf(moduleKeys), slug);
  if (owner) return TAB_AREA_OVERRIDES[owner]?.[slug] ?? MODULE_AREA[owner];
  return departmentArea(moduleKeys);
}

/** The section of an area a tab sits in (Company for the legal module's tabs), or null. */
export function sectionOfTab(moduleKeys: readonly string[] | null | undefined, slug: string): AreaSectionKey | null {
  const owner = tabModule(moduleKeysOf(moduleKeys), slug);
  if (!owner) return null;
  for (const [key, s] of Object.entries(AREA_SECTIONS) as [AreaSectionKey, (typeof AREA_SECTIONS)[AreaSectionKey]][]) if ((s.modules as readonly string[]).includes(owner)) return key;
  return null;
}

/** A department as the area helpers read it (`department.list` rows fit). */
export interface AreaDepartment {
  id: string;
  name: string;
  slug: string;
  position: number;
  hidden?: boolean | null;
  moduleKeys?: readonly string[] | null;
  tabs: readonly { slug: string; title: string; position: number }[];
}

/** One tab of an area's tab bar. */
export interface AreaTab {
  /** `<deptSlug>/<tabSlug>` for a department tab; the fixed key ("milestones", "crm") otherwise. */
  id: string;
  area: AreaKey;
  /** The label the bar shows: the tab's title as the person reads it, with the department after a "·" when two collide. */
  label: string;
  /** The tab's own title (Builder view's founder names applied). */
  title: string;
  /** "default": inline. "detail": behind "More detail" (always "default" with Builder view on). */
  tier: "default" | "detail";
  section: AreaSectionKey | null;
  /** The department tab's department; null for a fixed surface. */
  department: { id: string; slug: string; name: string } | null;
  /** The tab slug for a department tab. */
  slug: string | null;
  /** The module that owns the tab, when one does. */
  moduleKey: ModuleKey | null;
  /** The fixed surface this tab opens (Milestones, Contacts). */
  fixed: AreaFixedTab | null;
}

/** What a project has done so far; `business.get` reads it, and a tab shows once its moment has arrived (WP-10 T1). */
export interface StageFacts {
  pageLive: boolean;
  distributionStarted: boolean;
  roundCompleted: boolean;
  bankConnected: boolean;
  firstPayment: boolean;
  entityExists: boolean;
  /** Active memberships, the example membership excluded. */
  people: number;
}
export type TabReveal = (f: StageFacts) => boolean;

const paidOrTogether: TabReveal = (f) => f.firstPayment || f.people > 1;
const moneyIn: TabReveal = (f) => f.bankConnected || f.firstPayment;
const started: TabReveal = (f) => f.distributionStarted;
const round: TabReveal = (f) => f.roundCompleted;
const entity: TabReveal = (f) => f.entityExists;

/** When a tab appears for a project that is not in Builder view. A tab with no rule always shows. */
export const TAB_REVEAL: Partial<Record<ModuleKey, Readonly<Record<string, TabReveal>>>> = {
  distribution: { formation: (f) => f.pageLive || f.distributionStarted, leads: started, campaigns: started, channels: started, creative: started, attribution: started },
  finance: { overview: moneyIn, pnl: moneyIn, cash: moneyIn, runway: moneyIn, "wage-bill": round, "cap-table": paidOrTogether },
  legal: { incorporate: paidOrTogether, entity, compliance: entity, contracts: entity, ip: entity, policies: entity, regulatory: entity },
  development: { "training-ground": round, plan: round, "pull-requests": round, environments: round, specialists: round },
};

/** Team call appears after the first round of work. */
export const TEAM_CALL_REVEAL: TabReveal = (f) => f.roundCompleted;

/** Whether a tab shows at this stage: true with no stage or no rule. */
export function tabRevealed(moduleKey: ModuleKey | null, slug: string, stage: StageFacts | undefined): boolean {
  if (!stage || !moduleKey) return true;
  return TAB_REVEAL[moduleKey]?.[slug]?.(stage) ?? true;
}

export interface AreaTabsOptions {
  /** Builder view on: every tab inline, Builder view's tabs included. */
  builder: boolean;
  /** What the project has done; a tab appears when its moment has arrived. Ignored in Builder view. */
  stage?: StageFacts;
  /** Whether this person may open a department (walled departments are left out). Default: every department. */
  canOpen?: (d: AreaDepartment) => boolean;
  /** Which fixed surfaces this person may open. Default: both. */
  fixed?: Partial<Record<AreaFixedTab, boolean>>;
}

const ordered = <T extends AreaDepartment>(departments: readonly T[]): T[] => departments.filter((d) => !d.hidden).slice().sort((a, b) => a.position - b.position || a.name.localeCompare(b.name));

/**
 * Every area's tabs, in sidebar order: each visible department's tabs (departments in the founder's order, tabs by
 * position) under the area of their own module, then the area's fixed surfaces. A department with no modules has none
 * here (it keeps its own tab bar). Areas with no tab are left out of the map.
 */
export function areaTabsByArea(departments: readonly AreaDepartment[], opts: AreaTabsOptions): Map<AreaKey, AreaTab[]> {
  const out = new Map<AreaKey, AreaTab[]>();
  for (const area of AREA_KEYS) out.set(area, []);
  for (const d of ordered(departments)) {
    if (!departmentArea(d.moduleKeys)) continue;
    if (opts.canOpen && !opts.canOpen(d)) continue;
    const tabs = visibleTabs({ moduleKeys: d.moduleKeys, tabs: d.tabs }, opts.builder).filter((t) => opts.builder || tabRevealed(tabModule(d.moduleKeys, t.slug), t.slug, opts.stage));
    const rows = tabs.map((t) => {
      const tier = tabTier(d.moduleKeys, t.slug);
      return { t, tier: opts.builder || tier === "default" ? ("default" as const) : ("detail" as const) };
    });
    // The promotion rule: a department with no inline tab shows its first one, so it is never only behind the menu.
    if (rows.length > 0 && !rows.some((r) => r.tier === "default")) rows[0]!.tier = "default";
    for (const { t, tier } of rows) {
      const area = areaOfTab(d.moduleKeys, t.slug);
      if (!area) continue;
      out.get(area)!.push({
        id: `${d.slug}/${t.slug}`,
        area,
        label: t.title,
        title: t.title,
        tier,
        section: sectionOfTab(d.moduleKeys, t.slug),
        department: { id: d.id, slug: d.slug, name: d.name },
        slug: t.slug,
        moduleKey: tabModule(d.moduleKeys, t.slug),
        fixed: null,
      });
    }
  }
  for (const area of AREA_KEYS) {
    const list = out.get(area)!;
    // Two departments' tabs with one title in one area: each says whose it is.
    const byTitle = new Map<string, Set<string>>();
    for (const t of list) byTitle.set(t.title, (byTitle.get(t.title) ?? new Set()).add(t.department!.id));
    for (const t of list) if ((byTitle.get(t.title)?.size ?? 0) > 1) t.label = `${t.title} · ${t.department!.name}`;
    for (const f of AREA_FIXED_TABS[area] ?? []) {
      if (opts.fixed?.[f.key] === false) continue;
      list.push({ id: f.key, area, label: f.label, title: f.label, tier: "default", section: null, department: null, slug: null, moduleKey: null, fixed: f.key });
    }
    if (list.length === 0) out.delete(area);
  }
  return out;
}

/** One area's tabs (see `areaTabsByArea`). */
export function areaTabs(area: AreaKey, departments: readonly AreaDepartment[], opts: AreaTabsOptions): AreaTab[] {
  return areaTabsByArea(departments, opts).get(area) ?? [];
}

/** Where an area's sidebar item goes: its first inline tab. */
export function areaLanding(tabs: readonly AreaTab[]): AreaTab | undefined {
  return tabs.find((t) => t.tier === "default") ?? tabs[0];
}

/** Visible departments with no modules: each keeps its own sidebar item after Team. */
export function moduleLessDepartments<T extends AreaDepartment>(departments: readonly T[]): T[] {
  return ordered(departments).filter((d) => !departmentArea(d.moduleKeys));
}
