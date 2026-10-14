/**
 * A department's tabs follow its modules (BUILD §11.13 "departments are labels over modules"): one tab per module tab
 * (`MODULE_TABS`), each rendering `module:<key>/<tab>`. Create, split and Reset to defaults call `syncModuleScreens`
 * so a department never keeps the tabs of a module it no longer holds (a split used to leave the moved module's tabs
 * behind, so the same tabs showed in two departments) and never misses one of a module it holds.
 */
import { repos, screenModule, type Executor, type ScreenDefinition } from "@foundmill/db";
import { MODULE_KEYS, MODULE_TABS, type ModuleKey } from "@foundmill/shared";

const isModuleKey = (v: string): v is ModuleKey => (MODULE_KEYS as readonly string[]).includes(v);

/** Default tabs for a module key stored as text on a department row. */
export const tabsFor = (moduleKey: string) => (isModuleKey(moduleKey) ? MODULE_TABS[moduleKey] : []);

/** The layout of a module's default tab: the module screen, full width. */
export const moduleTabLayout = (moduleKey: string, tabSlug: string) => ({ widgets: [{ key: `module:${moduleKey}/${tabSlug}`, x: 0, y: 0, w: 12, h: 60, settings: {} }] });

/**
 * Makes a department's live tabs match `moduleKeys`: tabs of a module the department no longer holds are archived,
 * missing default tabs of its modules are added (a customized tab is kept as it is), and the tabs are numbered in
 * module order, then any tab of the department's own. `tabSlugs` limits the tabs added to the department's own subset
 * (the archetype seed's `tabSlugs`). Returns the live tabs in that order.
 */
export async function syncModuleScreens(tx: Executor, businessId: string, departmentId: string, moduleKeys: readonly string[], tabSlugs?: readonly string[] | null): Promise<ScreenDefinition[]> {
  const live = await repos.screens.list(tx, businessId, departmentId);
  const held = new Set(moduleKeys);
  const stale = live.filter((s) => {
    const module = screenModule(s.layout);
    return module !== null && !held.has(module);
  });
  await repos.screens.archiveMany(tx, businessId, stale.map((s) => s.id));
  const kept = live.filter((s) => !stale.includes(s));
  const ordered: ScreenDefinition[] = [];
  for (const moduleKey of moduleKeys) {
    // A department seeded with its own subset of tabs (Operations) gets only those, in the seed's order; others get every tab of the module.
    const tabs = tabsFor(moduleKey);
    for (const tab of tabSlugs ? tabSlugs.flatMap((slug) => tabs.filter((t) => t.slug === slug).slice(0, 1)) : tabs) {
      const existing = kept.find((s) => s.tabSlug === tab.slug);
      ordered.push(existing ?? (await repos.screens.upsert(tx, businessId, { departmentId, tabSlug: tab.slug, title: tab.title, position: ordered.length, layout: moduleTabLayout(moduleKey, tab.slug) })));
    }
  }
  for (const s of kept) if (!ordered.includes(s)) ordered.push(s);
  await repos.screens.setPositions(tx, businessId, ordered);
  return ordered.map((s, position) => ({ ...s, position }));
}

/** The live tabs of `fromId` that belong to one of `moduleKeys`, moved (layouts and all) to `toId`. */
export async function moveModuleScreens(tx: Executor, businessId: string, fromId: string, toId: string, moduleKeys: readonly string[]): Promise<void> {
  const moving = (await repos.screens.list(tx, businessId, fromId)).filter((s) => {
    const module = screenModule(s.layout);
    return module !== null && moduleKeys.includes(module);
  });
  await repos.screens.moveTo(tx, businessId, moving.map((s) => s.id), toId);
}
