/** department.list/create/update/merge/split/reorder/archive/restore/resetDefaults + screen.* + dashboard.* (BUILD §11.2, §11.13). */
import { DEPARTMENT_DEFAULTS, getArchetypeSeed } from "@foundmill/agents";
import { CreateDepartmentInput, repos, ScreenLayout, UpdateDepartmentInput, type DashboardLayout, type Department, type Executor } from "@foundmill/db";
import { MODULE_KEYS, ValidationError, WRITE_ROLES, type ModuleKey } from "@foundmill/shared";
import { z } from "zod";
import { DASHBOARD_PRESETS, presetLayout, type DashboardPreset } from "../presets";
import { moveModuleScreens, syncModuleScreens } from "../services/department-screens";
import { compileMetric, listMetrics, runMetric, type MetricReader } from "../services/metrics";
import { Id, adminProcedure, audit, businessProcedure, hasSectionAccess, router, writeProcedure, type BusinessContext } from "../trpc";

/**
 * Makes `leadId` the department's lead (BUILD §11.13 people). The agent must be an active agent of the business; it
 * joins the department if it was not in it, and the department's agents who reported to nobody or to the previous lead
 * now report to the new lead (never the lead itself, nor anyone above it, so no reporting loop can form).
 */
async function assignLead(tx: Executor, businessId: string, department: Department, leadId: string): Promise<void> {
  const lead = await repos.agents.get(tx, businessId, leadId);
  if (lead.archivedAt) throw new ValidationError("A released agent cannot lead a department");
  if (!lead.departmentIds.includes(department.id)) await repos.agents.update(tx, businessId, lead.id, { departmentIds: [...lead.departmentIds, department.id] });
  await repos.departments.addMember(tx, businessId, department.id, { memberKind: "agent", memberId: lead.id });
  const members = (await repos.agents.list(tx, businessId, { departmentId: department.id, limit: 500 })).items;
  const above = new Set<string>();
  for (let at = lead.lineManagerId; at && !above.has(at); ) {
    above.add(at);
    at = (await repos.agents.byIds(tx, businessId, [at]))[0]?.lineManagerId ?? null;
  }
  for (const a of members) {
    if (a.id === lead.id || above.has(a.id)) continue;
    if (a.lineManagerId === null || (department.leadAgentId !== null && a.lineManagerId === department.leadAgentId)) await repos.agents.update(tx, businessId, a.id, { lineManagerId: lead.id });
  }
}

/** The custom-metric catalogue as the caller may see it: only sections they can read (BUILD §11.9). */
const metricReader = (ctx: Pick<BusinessContext, "membership">): MetricReader => ({ canRead: (section) => hasSectionAccess(ctx.membership, section, "read") });

/** Viewers and advisors never write, anywhere (DECISIONS): not even a Home layout of their own. */
const canWrite = (ctx: Pick<BusinessContext, "role">) => WRITE_ROLES.includes(ctx.role);

/** A dashboard as Home reads it: `stored` false for the unsaved Founder's view of a read-only role; `editable` for the caller. */
export type HomeDashboard = DashboardLayout & { stored: boolean; editable: boolean };

function homeDashboard(ctx: Pick<BusinessContext, "role" | "userId">, row: DashboardLayout, stored: boolean): HomeDashboard {
  return { ...row, stored, editable: stored && row.userId === ctx.userId && row.archivedAt === null && canWrite(ctx) };
}

/** The id of the unsaved Founder's view (no row has it: the nil uuid). */
export const UNSAVED_DASHBOARD_ID = "00000000-0000-0000-0000-000000000000";

/** The Founder's view a viewer or an advisor reads: built per request, never written. */
function unsavedHome(ctx: Pick<BusinessContext, "businessId" | "userId" | "business">, layout: ScreenLayout): DashboardLayout {
  const at = ctx.business.committedAt ?? ctx.business.createdAt;
  return { id: UNSAVED_DASHBOARD_ID, businessId: ctx.businessId, userId: ctx.userId, name: "Home", preset: "founder", layout, version: 1, isActive: true, createdAt: at, updatedAt: at, archivedAt: null };
}

/** A preset's layout for this business: the Founder's view gets a department card per visible department. */
async function sizedPresetLayout(tx: Executor, businessId: string, preset: DashboardPreset): Promise<ScreenLayout> {
  if (preset !== "founder") return presetLayout(preset);
  return presetLayout(preset, { departments: (await repos.departments.list(tx, businessId)).length });
}

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

  /**
   * Templates for "Add department" (BUILD §11.13 "create … template"): the business archetype's seed departments, then
   * one per module the seed does not cover on its own. `inUse` marks a template whose department is in the sidebar;
   * `archivedId` one whose department is archived (restore it rather than make a second one).
   */
  templates: businessProcedure.query(({ ctx }) =>
    ctx.rls(async (tx) => {
      const existing = await repos.departments.list(tx, ctx.businessId, { includeHidden: true, includeArchived: true });
      const seed = ctx.business.archetype ? getArchetypeSeed(ctx.business.archetype).departments : [];
      const fromSeed = seed.map((d) => ({ key: d.slug.replace(/_/g, "-"), name: d.name, icon: d.icon, colourToken: d.colourToken, moduleKeys: d.moduleKeys as ModuleKey[], budgetMinor: d.budgetMinor as number | null }));
      const fromModules = MODULE_KEYS.filter((m) => !fromSeed.some((t) => t.moduleKeys.length === 1 && t.moduleKeys[0] === m)).map((m) => {
        const d = DEPARTMENT_DEFAULTS[m];
        return { key: d.slug, name: d.name, icon: d.icon, colourToken: d.colourToken, moduleKeys: [...d.moduleKeys], budgetMinor: null as number | null };
      });
      return [...fromSeed, ...fromModules].map((t) => {
        const match = existing.find((e) => e.slug === t.key);
        return { ...t, inUse: Boolean(match && !match.archivedAt), archivedId: match?.archivedAt ? match.id : null };
      });
    }),
  ),

  create: adminProcedure.input(CreateDepartmentInput).mutation(({ ctx, input }) =>
    ctx.rls(async (tx) => {
      const { leadAgentId, ...rest } = input;
      let dept = await repos.departments.create(tx, ctx.businessId, rest);
      await syncModuleScreens(tx, ctx.businessId, dept.id, dept.moduleKeys);
      if (leadAgentId) {
        await assignLead(tx, ctx.businessId, dept, leadAgentId);
        dept = await repos.departments.setLead(tx, ctx.businessId, dept.id, leadAgentId);
      }
      await audit(tx, ctx, { action: "department.create", target: { kind: "department", id: dept.id }, details: { moduleKeys: dept.moduleKeys } });
      return dept;
    }),
  ),

  update: adminProcedure.input(z.object({ departmentId: Id, patch: UpdateDepartmentInput })).mutation(({ ctx, input }) =>
    ctx.rls(async (tx) => {
      const before = await repos.departments.get(tx, ctx.businessId, input.departmentId);
      if (input.patch.leadAgentId && input.patch.leadAgentId !== before.leadAgentId) await assignLead(tx, ctx.businessId, before, input.patch.leadAgentId);
      const dept = await repos.departments.update(tx, ctx.businessId, input.departmentId, input.patch);
      await audit(tx, ctx, { action: "department.update", target: { kind: "department", id: dept.id }, details: { fields: Object.keys(input.patch) } });
      return dept;
    }),
  ),

  /**
   * The G-chord letter for a department (BUILD §11.13 "placement: order, visibility, shortcut"): a letter the founder
   * chooses (swapped with the department that had it), or null for the automatic one from its name.
   */
  setShortcut: adminProcedure.input(z.object({ departmentId: Id, letter: z.string().trim().length(1).nullable() })).mutation(({ ctx, input }) =>
    ctx.rls(async (tx) => {
      const dept = await repos.departments.setShortcut(tx, ctx.businessId, input.departmentId, input.letter);
      await audit(tx, ctx, { action: "department.set_shortcut", target: { kind: "department", id: dept.id }, details: { letter: dept.shortcut, chosen: dept.shortcutChosen } });
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

  /**
   * Split `sourceId`: a new department takes the chosen modules, and their tabs move with them (layouts and all), so
   * the source keeps only its remaining modules' tabs (AC-11.13.2).
   */
  split: adminProcedure.input(z.object({ sourceId: Id, department: CreateDepartmentInput })).mutation(({ ctx, input }) =>
    ctx.rls(async (tx) => {
      const result = await repos.departments.split(tx, ctx.businessId, input.sourceId, input.department);
      await moveModuleScreens(tx, ctx.businessId, result.source.id, result.created.id, result.created.moduleKeys);
      await syncModuleScreens(tx, ctx.businessId, result.created.id, result.created.moduleKeys);
      await syncModuleScreens(tx, ctx.businessId, result.source.id, result.source.moduleKeys);
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

  /** Brings an archived department back with its tabs (Settings › Departments "Archived", and the archive toast's Undo). */
  restore: adminProcedure.input(z.object({ departmentId: Id })).mutation(({ ctx, input }) =>
    ctx.rls(async (tx) => {
      const dept = await repos.departments.restore(tx, ctx.businessId, input.departmentId);
      await audit(tx, ctx, { action: "department.restore", target: { kind: "department", id: dept.id } });
      return dept;
    }),
  ),

  /**
   * Restore the archetype's departments (the way back after a merge, a split or an archive): a seed department that was
   * archived or merged away comes back with its tabs (its slug still holds the unique key, so it is never inserted
   * twice), a missing one is created, and every seed department gets its default identity, modules and module tabs back.
   * A department of the founder's own gives back the modules the seed departments hold again; one left with none is
   * archived.
   */
  resetDefaults: adminProcedure.mutation(({ ctx }) =>
    ctx.rls(async (tx) => {
      if (!ctx.business.archetype) throw new ValidationError("The business has no archetype to reset to");
      const seed = getArchetypeSeed(ctx.business.archetype);
      // Archived rows too: their slug stays taken (the unique index covers them), so they are restored, never re-created.
      const existing = await repos.departments.list(tx, ctx.businessId, { includeHidden: true, includeArchived: true });
      const restored: string[] = [];
      for (const d of seed.departments) {
        const slug = d.slug.replace(/_/g, "-");
        const match = existing.find((e) => e.slug === slug);
        let id: string;
        if (match) {
          if (match.archivedAt) await repos.departments.restore(tx, ctx.businessId, match.id);
          await repos.departments.update(tx, ctx.businessId, match.id, { name: d.name, icon: d.icon, colourToken: d.colourToken, position: d.position, moduleKeys: d.moduleKeys, hidden: false });
          id = match.id;
        } else {
          id = (await repos.departments.create(tx, ctx.businessId, { name: d.name, slug, icon: d.icon, colourToken: d.colourToken, position: d.position, moduleKeys: d.moduleKeys, budgetMinor: d.budgetMinor })).id;
        }
        // The archetype's own tabs (Operations: Specialists and Plan only), as at Commit.
        await syncModuleScreens(tx, ctx.businessId, id, d.moduleKeys, d.tabSlugs);
        restored.push(id);
      }
      const seedModules = new Set<string>(seed.departments.flatMap((d) => d.moduleKeys));
      for (const d of existing) {
        if (restored.includes(d.id) || d.archivedAt) continue;
        const remaining = d.moduleKeys.filter((k) => !seedModules.has(k)) as ModuleKey[];
        if (remaining.length === d.moduleKeys.length) continue;
        await repos.departments.update(tx, ctx.businessId, d.id, { moduleKeys: remaining });
        await syncModuleScreens(tx, ctx.businessId, d.id, remaining);
        if (remaining.length === 0) await repos.departments.archive(tx, ctx.businessId, d.id);
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
  presets: businessProcedure.query(({ ctx }) => ctx.rls(async (tx) => Promise.all(DASHBOARD_PRESETS.map(async (id) => ({ id, layout: await sizedPresetLayout(tx, ctx.businessId, id) }))))),
  /**
   * Custom metric widget (BUILD §11.2, AC-11.2.5): catalogue queries only, run under the caller's RLS transaction, and
   * only from sections the caller may read (each catalogue entry names its section; BUILD §11.9).
   */
  customMetric: router({
    list: businessProcedure.query(({ ctx }) => listMetrics(metricReader(ctx))),
    get: businessProcedure.input(z.object({ queryId: z.string().max(80).nullish(), sql: z.string().max(4000).nullish() })).query(({ ctx, input }) => ctx.rls((tx) => runMetric(tx, ctx.businessId, input, metricReader(ctx)))),
  }),
  /**
   * A sentence → the catalogue metric it means, with a preview. Deterministic; nothing the founder types is executed.
   * Part of editing a widget, so a role that writes (viewers and advisors never edit a dashboard).
   */
  compileMetric: writeProcedure.input(z.object({ sentence: z.string().min(1).max(400) })).mutation(({ ctx, input }) =>
    ctx.rls(async (tx) => {
      const compiled = await compileMetric(tx, ctx.businessId, input.sentence, metricReader(ctx));
      await audit(tx, ctx, { action: "dashboard.compile_metric", target: { kind: "metric", id: compiled.queryId }, details: { sentence: input.sentence.slice(0, 200) } });
      return compiled;
    }),
  ),
  list: businessProcedure.query(({ ctx }) => ctx.rls((tx) => repos.dashboards.list(tx, ctx.businessId, ctx.userId))),
  /**
   * One dashboard: by id (yours, or a co-member's shared one, read-only), else your default Home. A role that writes
   * gets a default Home created on the first open (idempotently: two first loads make one); a viewer or an advisor
   * writes nothing anywhere, so they read the Founder's view built for them, unsaved (`stored: false`). `editable`
   * says whether the caller may change it: their own stored dashboard and a role that writes.
   */
  get: businessProcedure.input(z.object({ dashboardId: Id.optional() })).query(({ ctx, input }) =>
    ctx.rls(async (tx): Promise<HomeDashboard> => {
      if (input.dashboardId) return homeDashboard(ctx, await repos.dashboards.get(tx, ctx.businessId, input.dashboardId), true);
      const active = await repos.dashboards.active(tx, ctx.businessId, ctx.userId);
      if (active) return homeDashboard(ctx, active, true);
      const layout = await sizedPresetLayout(tx, ctx.businessId, "founder");
      if (!canWrite(ctx)) return homeDashboard(ctx, unsavedHome(ctx, layout), false);
      return homeDashboard(ctx, await repos.dashboards.ensureActive(tx, ctx.businessId, { userId: ctx.userId, name: "Home", preset: "founder", layout }), true);
    }),
  ),
  /** A new tab from a preset (New › …, Copy to my dashboards). It becomes your default Home only when you have none. */
  create: writeProcedure.input(z.object({ name: z.string().min(1).max(80).default("Home"), preset: z.enum(DASHBOARD_PRESETS).default("founder") })).mutation(({ ctx, input }) =>
    ctx.rls(async (tx) => {
      const dashboard = await repos.dashboards.add(tx, ctx.businessId, { userId: ctx.userId, name: input.name, preset: input.preset, layout: await sizedPresetLayout(tx, ctx.businessId, input.preset) });
      await audit(tx, ctx, { action: "dashboard.create", target: { kind: "dashboard", id: dashboard.id }, details: { preset: input.preset } });
      return dashboard;
    }),
  ),
  update: writeProcedure.input(z.object({ dashboardId: Id, name: z.string().min(1).max(80).optional(), layout: ScreenLayout.optional(), setActive: z.boolean().optional() })).mutation(({ ctx, input }) =>
    ctx.rls(async (tx) => {
      const existing = await repos.dashboards.get(tx, ctx.businessId, input.dashboardId);
      if (existing.userId !== ctx.userId) throw new ValidationError("Dashboards are per user; copy a shared one to edit it");
      let dashboard = await repos.dashboards.update(tx, ctx.businessId, input.dashboardId, { name: input.name, layout: input.layout });
      if (input.setActive) dashboard = await repos.dashboards.setActive(tx, ctx.businessId, input.dashboardId);
      await audit(tx, ctx, { action: "dashboard.update", target: { kind: "dashboard", id: dashboard.id }, details: { fields: Object.keys(input).filter((k) => k !== "dashboardId") } });
      return dashboard;
    }),
  ),
  delete: writeProcedure.input(z.object({ dashboardId: Id })).mutation(({ ctx, input }) =>
    ctx.rls(async (tx) => {
      const existing = await repos.dashboards.get(tx, ctx.businessId, input.dashboardId);
      if (existing.userId !== ctx.userId) throw new ValidationError("Only the owner of a dashboard can delete it");
      const dashboard = await repos.dashboards.delete(tx, ctx.businessId, input.dashboardId);
      await audit(tx, ctx, { action: "dashboard.delete", target: { kind: "dashboard", id: dashboard.id } });
      return dashboard;
    }),
  ),
  applyPreset: writeProcedure.input(z.object({ dashboardId: Id, preset: z.enum(DASHBOARD_PRESETS) })).mutation(({ ctx, input }) =>
    ctx.rls(async (tx) => {
      const existing = await repos.dashboards.get(tx, ctx.businessId, input.dashboardId);
      if (existing.userId !== ctx.userId) throw new ValidationError("Dashboards are per user; copy a shared one to edit it");
      const dashboard = await repos.dashboards.applyPreset(tx, ctx.businessId, input.dashboardId, input.preset, await sizedPresetLayout(tx, ctx.businessId, input.preset));
      await audit(tx, ctx, { action: "dashboard.apply_preset", target: { kind: "dashboard", id: dashboard.id }, details: { preset: input.preset } });
      return dashboard;
    }),
  ),
});
