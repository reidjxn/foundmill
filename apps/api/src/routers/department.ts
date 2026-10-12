/** department.list/create/update/merge/split/reorder/archive/resetDefaults + screen.* + dashboard.* (BUILD §11.2, §11.13). */
import { departmentTabs, getArchetypeSeed } from "@foundmill/agents";
import { CreateDepartmentInput, repos, ScreenLayout, UpdateDepartmentInput } from "@foundmill/db";
import { MODULE_KEYS, MODULE_TABS, ValidationError, type ModuleKey } from "@foundmill/shared";

const isModuleKey = (v: string): v is ModuleKey => (MODULE_KEYS as readonly string[]).includes(v);
/** Default tabs for a module key stored as text on a department row. */
const tabsFor = (moduleKey: string) => (isModuleKey(moduleKey) ? MODULE_TABS[moduleKey] : []);
import { z } from "zod";
import { DASHBOARD_PRESETS, PRESET_LAYOUTS } from "../presets";
import { compileMetric, listMetrics, runMetric, type MetricReader } from "../services/metrics";
import { Id, adminProcedure, audit, businessProcedure, hasSectionAccess, router, writeProcedure, type BusinessContext } from "../trpc";

/** The custom-metric catalogue as the caller may see it: only sections they can read (BUILD §11.9). */
const metricReader = (ctx: Pick<BusinessContext, "membership">): MetricReader => ({ canRead: (section) => hasSectionAccess(ctx.membership, section, "read") });

export const departmentRouter = router({
  list: businessProcedure.input(z.object({ includeHidden: z.boolean().default(false), includeArchived: z.boolean().default(false) })).query(({ ctx, input }) =>
    ctx.rls(async (tx) => {
      // Three projected queries, whatever the number of departments: the departments, the agents' lead and team-strip
      // columns, and every tab of the business without its layout.
      const [departments, roster, tabs] = await Promise.all([repos.departments.list(tx, ctx.businessId, input ?? {}), repos.agents.listRoster(tx, ctx.businessId, { limit: 500 }), repos.screens.listTabs(tx, ctx.businessId)]);
      const tabsByDepartment = new Map<string, { id: string; slug: string; title: string; position: number }[]>();
      for (const s of tabs) {
        const list = tabsByDepartment.get(s.departmentId) ?? [];
        list.push({ id: s.id, slug: s.tabSlug, title: s.title, position: s.position });
        tabsByDepartment.set(s.departmentId, list);
      }
      const member = (a: (typeof roster)[number]) => ({ id: a.id, name: a.name, role: a.role, status: a.status, modelKey: a.modelKey, avatarSeed: a.avatarSeed });
      return departments.map((d) => {
        const lead = roster.find((a) => a.id === d.leadAgentId);
        return {
          ...d,
          lead: lead ? member(lead) : null,
          squad: roster.filter((a) => a.departmentIds.includes(d.id)).map(member),
          tabs: tabsByDepartment.get(d.id) ?? [],
        };
      });
    }),
  ),

  create: adminProcedure.input(CreateDepartmentInput).mutation(({ ctx, input }) =>
    ctx.rls(async (tx) => {
      const dept = await repos.departments.create(tx, ctx.businessId, input);
      let position = 0;
      for (const moduleKey of dept.moduleKeys) for (const tab of tabsFor(moduleKey)) await repos.screens.upsert(tx, ctx.businessId, { departmentId: dept.id, tabSlug: tab.slug, title: tab.title, position: position++, layout: { widgets: [{ key: `module:${moduleKey}/${tab.slug}`, x: 0, y: 0, w: 12, h: 60, settings: {} }] } });
      await audit(tx, ctx, { action: "department.create", target: { kind: "department", id: dept.id }, details: { moduleKeys: dept.moduleKeys } });
      return dept;
    }),
  ),

  update: adminProcedure.input(z.object({ departmentId: Id, patch: UpdateDepartmentInput })).mutation(({ ctx, input }) =>
    ctx.rls(async (tx) => {
      const dept = await repos.departments.update(tx, ctx.businessId, input.departmentId, input.patch);
      await audit(tx, ctx, { action: "department.update", target: { kind: "department", id: dept.id }, details: { fields: Object.keys(input.patch) } });
      return dept;
    }),
  ),

  /** Merge `fromId` into `intoId`: one sidebar item containing both modules' tabs (AC-11.13.2). */
  merge: adminProcedure.input(z.object({ fromId: Id, intoId: Id })).mutation(({ ctx, input }) =>
    ctx.rls(async (tx) => {
      const from = await repos.departments.get(tx, ctx.businessId, input.fromId);
      const fromScreens = await repos.screens.list(tx, ctx.businessId, from.id);
      const merged = await repos.departments.merge(tx, ctx.businessId, input.fromId, input.intoId);
      const existing = await repos.screens.list(tx, ctx.businessId, merged.id);
      let position = existing.length;
      for (const s of fromScreens) {
        if (existing.some((e) => e.tabSlug === s.tabSlug)) continue;
        await repos.screens.upsert(tx, ctx.businessId, { departmentId: merged.id, tabSlug: s.tabSlug, title: s.title, position: position++, layout: s.layout as ScreenLayout });
      }
      await audit(tx, ctx, { action: "department.merge", target: { kind: "department", id: merged.id }, details: { from: input.fromId } });
      return merged;
    }),
  ),

  split: adminProcedure.input(z.object({ sourceId: Id, department: CreateDepartmentInput })).mutation(({ ctx, input }) =>
    ctx.rls(async (tx) => {
      const result = await repos.departments.split(tx, ctx.businessId, input.sourceId, input.department);
      let position = 0;
      for (const moduleKey of result.created.moduleKeys) for (const tab of tabsFor(moduleKey)) await repos.screens.upsert(tx, ctx.businessId, { departmentId: result.created.id, tabSlug: tab.slug, title: tab.title, position: position++, layout: { widgets: [{ key: `module:${moduleKey}/${tab.slug}`, x: 0, y: 0, w: 12, h: 60, settings: {} }] } });
      await audit(tx, ctx, { action: "department.split", target: { kind: "department", id: result.created.id }, details: { source: input.sourceId } });
      return result;
    }),
  ),

  reorder: adminProcedure.input(z.object({ orderedIds: z.array(Id).min(1) })).mutation(({ ctx, input }) =>
    ctx.rls(async (tx) => {
      const departments = await repos.departments.reorder(tx, ctx.businessId, input.orderedIds);
      await audit(tx, ctx, { action: "department.reorder", target: { kind: "business", id: ctx.businessId }, details: { orderedIds: input.orderedIds } });
      return departments;
    }),
  ),

  archive: adminProcedure.input(z.object({ departmentId: Id })).mutation(({ ctx, input }) =>
    ctx.rls(async (tx) => {
      const dept = await repos.departments.archive(tx, ctx.businessId, input.departmentId);
      await audit(tx, ctx, { action: "department.archive", target: { kind: "department", id: dept.id } });
      return dept;
    }),
  ),

  /** Restore archetype seeds: missing departments are re-created, existing ones get their default identity back. */
  resetDefaults: adminProcedure.mutation(({ ctx }) =>
    ctx.rls(async (tx) => {
      if (!ctx.business.archetype) throw new ValidationError("The business has no archetype to reset to");
      const seed = getArchetypeSeed(ctx.business.archetype);
      const existing = await repos.departments.list(tx, ctx.businessId, { includeHidden: true });
      const restored: string[] = [];
      for (const d of seed.departments) {
        const slug = d.slug.replace(/_/g, "-");
        const match = existing.find((e) => e.slug === slug);
        if (match) {
          await repos.departments.update(tx, ctx.businessId, match.id, { name: d.name, icon: d.icon, colourToken: d.colourToken, position: d.position, moduleKeys: d.moduleKeys, hidden: false });
          restored.push(match.id);
        } else {
          const created = await repos.departments.create(tx, ctx.businessId, { name: d.name, slug, icon: d.icon, colourToken: d.colourToken, position: d.position, moduleKeys: d.moduleKeys, budgetMinor: d.budgetMinor });
          // The archetype's own tabs (Operations: Specialists and Plan only), as at Commit.
          for (const [position, tab] of departmentTabs(d).entries()) await repos.screens.upsert(tx, ctx.businessId, { departmentId: created.id, tabSlug: tab.slug, title: tab.title, position, layout: { widgets: [{ key: `module:${tab.moduleKey}/${tab.slug}`, x: 0, y: 0, w: 12, h: 60, settings: {} }] } });
          restored.push(created.id);
        }
      }
      await audit(tx, ctx, { action: "department.reset_defaults", target: { kind: "business", id: ctx.businessId }, details: { restored } });
      return repos.departments.list(tx, ctx.businessId);
    }),
  ),
});

export const screenRouter = router({
  get: businessProcedure.input(z.object({ departmentId: Id, tabSlug: z.string().min(1).max(60) })).query(({ ctx, input }) =>
    ctx.rls(async (tx) => {
      const screen = await repos.screens.get(tx, ctx.businessId, input.departmentId, input.tabSlug);
      const department = await repos.departments.get(tx, ctx.businessId, input.departmentId);
      return { screen, department, tabs: await repos.screens.list(tx, ctx.businessId, input.departmentId) };
    }),
  ),
  update: writeProcedure.input(z.object({ screenId: Id, layout: ScreenLayout })).mutation(({ ctx, input }) =>
    ctx.rls(async (tx) => {
      const screen = await repos.screens.updateLayout(tx, ctx.businessId, input.screenId, input.layout);
      await audit(tx, ctx, { action: "screen.update", target: { kind: "screen", id: screen.id }, details: { widgets: input.layout.widgets.length } });
      return screen;
    }),
  ),
});

export const dashboardRouter = router({
  presets: businessProcedure.query(() => DASHBOARD_PRESETS.map((id) => ({ id, layout: PRESET_LAYOUTS[id] }))),
  /**
   * Custom metric widget (BUILD §11.2, AC-11.2.5): catalogue queries only, run under the caller's RLS transaction, and
   * only from sections the caller may read (each catalogue entry names its section; BUILD §11.9).
   */
  customMetric: router({
    list: businessProcedure.query(({ ctx }) => listMetrics(metricReader(ctx))),
    get: businessProcedure.input(z.object({ queryId: z.string().max(80).nullish(), sql: z.string().max(4000).nullish() })).query(({ ctx, input }) => ctx.rls((tx) => runMetric(tx, ctx.businessId, input, metricReader(ctx)))),
  }),
  /** A sentence → the catalogue metric it means, with a preview. Deterministic; nothing the founder types is executed. */
  compileMetric: businessProcedure.input(z.object({ sentence: z.string().min(1).max(400) })).mutation(({ ctx, input }) =>
    ctx.rls(async (tx) => {
      const compiled = await compileMetric(tx, ctx.businessId, input.sentence, metricReader(ctx));
      await audit(tx, ctx, { action: "dashboard.compile_metric", target: { kind: "metric", id: compiled.queryId }, details: { sentence: input.sentence.slice(0, 200) } });
      return compiled;
    }),
  ),
  list: businessProcedure.query(({ ctx }) => ctx.rls((tx) => repos.dashboards.list(tx, ctx.businessId, ctx.userId))),
  get: businessProcedure.input(z.object({ dashboardId: Id.optional() })).query(({ ctx, input }) =>
    ctx.rls(async (tx) => {
      if (input.dashboardId) return repos.dashboards.get(tx, ctx.businessId, input.dashboardId);
      const active = await repos.dashboards.active(tx, ctx.businessId, ctx.userId);
      return active ?? repos.dashboards.create(tx, ctx.businessId, { userId: ctx.userId, name: "Home", preset: "founder", layout: PRESET_LAYOUTS.founder, isActive: true });
    }),
  ),
  create: businessProcedure.input(z.object({ name: z.string().min(1).max(80).default("Home"), preset: z.enum(DASHBOARD_PRESETS).default("founder") })).mutation(({ ctx, input }) =>
    ctx.rls(async (tx) => {
      const dashboard = await repos.dashboards.create(tx, ctx.businessId, { userId: ctx.userId, name: input.name, preset: input.preset, layout: PRESET_LAYOUTS[input.preset], isActive: true });
      await audit(tx, ctx, { action: "dashboard.create", target: { kind: "dashboard", id: dashboard.id }, details: { preset: input.preset } });
      return dashboard;
    }),
  ),
  update: businessProcedure.input(z.object({ dashboardId: Id, name: z.string().min(1).max(80).optional(), layout: ScreenLayout.optional(), setActive: z.boolean().optional() })).mutation(({ ctx, input }) =>
    ctx.rls(async (tx) => {
      const existing = await repos.dashboards.get(tx, ctx.businessId, input.dashboardId);
      if (existing.userId !== ctx.userId) throw new ValidationError("Dashboards are per user; copy a shared one to edit it");
      let dashboard = await repos.dashboards.update(tx, ctx.businessId, input.dashboardId, { name: input.name, layout: input.layout });
      if (input.setActive) dashboard = await repos.dashboards.setActive(tx, ctx.businessId, input.dashboardId);
      await audit(tx, ctx, { action: "dashboard.update", target: { kind: "dashboard", id: dashboard.id }, details: { fields: Object.keys(input).filter((k) => k !== "dashboardId") } });
      return dashboard;
    }),
  ),
  delete: businessProcedure.input(z.object({ dashboardId: Id })).mutation(({ ctx, input }) =>
    ctx.rls(async (tx) => {
      const existing = await repos.dashboards.get(tx, ctx.businessId, input.dashboardId);
      if (existing.userId !== ctx.userId) throw new ValidationError("Only the owner of a dashboard can delete it");
      const dashboard = await repos.dashboards.delete(tx, ctx.businessId, input.dashboardId);
      await audit(tx, ctx, { action: "dashboard.delete", target: { kind: "dashboard", id: dashboard.id } });
      return dashboard;
    }),
  ),
  applyPreset: businessProcedure.input(z.object({ dashboardId: Id, preset: z.enum(DASHBOARD_PRESETS) })).mutation(({ ctx, input }) =>
    ctx.rls(async (tx) => {
      const dashboard = await repos.dashboards.applyPreset(tx, ctx.businessId, input.dashboardId, input.preset, PRESET_LAYOUTS[input.preset]);
      await audit(tx, ctx, { action: "dashboard.apply_preset", target: { kind: "dashboard", id: dashboard.id }, details: { preset: input.preset } });
      return dashboard;
    }),
  ),
});
