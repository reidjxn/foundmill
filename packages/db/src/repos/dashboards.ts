/** dashboard_layouts — per-user Home layouts and presets (routers dashboard.*; BUILD §11.2). */
import { and, asc, eq, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import { dashboardLayouts, type DashboardLayout } from "../schema";
import { NotFoundError } from "@foundmill/shared";
import { Id, one, parseInput, type Executor } from "./_shared";
import { ScreenLayout } from "./screens";

export const CreateDashboardInput = z.object({
  userId: Id,
  name: z.string().trim().min(1).max(80).default("Home"),
  preset: z.string().max(60).nullable().optional(),
  layout: ScreenLayout.default({ widgets: [] }),
  isActive: z.boolean().default(true),
});
export type CreateDashboardInput = z.input<typeof CreateDashboardInput>;

export const UpdateDashboardInput = z.object({
  name: z.string().trim().min(1).max(80).optional(),
  preset: z.string().max(60).nullable().optional(),
  layout: ScreenLayout.optional(),
});
export type UpdateDashboardInput = z.input<typeof UpdateDashboardInput>;

const scoped = (businessId: string, id: string) => and(eq(dashboardLayouts.businessId, businessId), eq(dashboardLayouts.id, id));

/** The conflict target of `dashboard_layouts_one_active_key` (0044): one active, live dashboard per user and business. */
const oneActive = { target: [dashboardLayouts.businessId, dashboardLayouts.userId], where: sql`${dashboardLayouts.isActive} and ${dashboardLayouts.archivedAt} is null` };

export const dashboardsRepo = {
  async list(db: Executor, businessId: string, userId: string): Promise<DashboardLayout[]> {
    return db
      .select()
      .from(dashboardLayouts)
      .where(and(eq(dashboardLayouts.businessId, businessId), eq(dashboardLayouts.userId, userId), isNull(dashboardLayouts.archivedAt)))
      .orderBy(asc(dashboardLayouts.createdAt));
  },

  async get(db: Executor, businessId: string, dashboardId: string): Promise<DashboardLayout> {
    return one(await db.select().from(dashboardLayouts).where(scoped(businessId, dashboardId)).limit(1), "dashboard", dashboardId);
  },

  /** The user's active dashboard for the business (null until one is created). */
  async active(db: Executor, businessId: string, userId: string): Promise<DashboardLayout | null> {
    const rows = await db
      .select()
      .from(dashboardLayouts)
      .where(and(eq(dashboardLayouts.businessId, businessId), eq(dashboardLayouts.userId, userId), eq(dashboardLayouts.isActive, true), isNull(dashboardLayouts.archivedAt)))
      .orderBy(asc(dashboardLayouts.createdAt))
      .limit(1);
    return rows[0] ?? null;
  },

  /** Creates a dashboard; `isActive` (the default) makes it the user's default Home in place of the current one. */
  async create(db: Executor, businessId: string, input: CreateDashboardInput): Promise<DashboardLayout> {
    const v = parseInput(CreateDashboardInput, input, "dashboard");
    return db.transaction(async (tx) => {
      if (v.isActive) {
        await tx.update(dashboardLayouts).set({ isActive: false }).where(and(eq(dashboardLayouts.businessId, businessId), eq(dashboardLayouts.userId, v.userId)));
      }
      return one(await tx.insert(dashboardLayouts).values({ businessId, userId: v.userId, name: v.name, preset: v.preset ?? null, layout: v.layout, isActive: v.isActive }).returning(), "dashboard");
    });
  },

  /**
   * A new tab of the user's dashboards (New › preset, Copy to my dashboards). It becomes the default Home only when the
   * user has none yet; otherwise the default stays where it is ("Make default" moves it). `isActive` in the input is
   * ignored.
   */
  async add(db: Executor, businessId: string, input: CreateDashboardInput): Promise<DashboardLayout> {
    const v = parseInput(CreateDashboardInput, input, "dashboard");
    const values = { businessId, userId: v.userId, name: v.name, preset: v.preset ?? null, layout: v.layout };
    const asDefault = await db.insert(dashboardLayouts).values({ ...values, isActive: true }).onConflictDoNothing(oneActive).returning();
    if (asDefault[0]) return asDefault[0];
    return one(await db.insert(dashboardLayouts).values({ ...values, isActive: false }).returning(), "dashboard");
  },

  /**
   * The user's default Home, created from `input` when they have none (the first open of Home). Idempotent under
   * concurrency: two first loads at once insert one row (`dashboard_layouts_one_active_key`, 0044) and both read it.
   */
  async ensureActive(db: Executor, businessId: string, input: CreateDashboardInput): Promise<DashboardLayout> {
    const v = parseInput(CreateDashboardInput, input, "dashboard");
    const existing = await dashboardsRepo.active(db, businessId, v.userId);
    if (existing) return existing;
    const created = await db.insert(dashboardLayouts).values({ businessId, userId: v.userId, name: v.name, preset: v.preset ?? null, layout: v.layout, isActive: true }).onConflictDoNothing(oneActive).returning();
    if (created[0]) return created[0];
    // Another request created it between the read and the insert; it has committed (the insert waited for it).
    const winner = await dashboardsRepo.active(db, businessId, v.userId);
    if (!winner) throw new NotFoundError("dashboard");
    return winner;
  },

  async update(db: Executor, businessId: string, dashboardId: string, input: UpdateDashboardInput): Promise<DashboardLayout> {
    const v = parseInput(UpdateDashboardInput, input, "dashboard update");
    const set: Partial<typeof dashboardLayouts.$inferInsert> = {};
    if (v.name !== undefined) set.name = v.name;
    if (v.preset !== undefined) set.preset = v.preset;
    if (v.layout !== undefined) set.layout = v.layout;
    return one(
      await db
        .update(dashboardLayouts)
        .set({ ...set, version: sql`${dashboardLayouts.version} + 1` })
        .where(and(scoped(businessId, dashboardId), isNull(dashboardLayouts.archivedAt)))
        .returning(),
      "dashboard",
      dashboardId,
    );
  },

  /** Applies a preset: records the preset name and replaces the layout. */
  async applyPreset(db: Executor, businessId: string, dashboardId: string, preset: string, layout: ScreenLayout): Promise<DashboardLayout> {
    return dashboardsRepo.update(db, businessId, dashboardId, { preset, layout });
  },

  async setActive(db: Executor, businessId: string, dashboardId: string): Promise<DashboardLayout> {
    return db.transaction(async (tx) => {
      const target = await dashboardsRepo.get(tx, businessId, dashboardId);
      await tx.update(dashboardLayouts).set({ isActive: false }).where(and(eq(dashboardLayouts.businessId, businessId), eq(dashboardLayouts.userId, target.userId)));
      return one(await tx.update(dashboardLayouts).set({ isActive: true }).where(and(scoped(businessId, dashboardId), isNull(dashboardLayouts.archivedAt))).returning(), "dashboard", dashboardId);
    });
  },

  /** Archives a dashboard; when it was the default Home, the user's oldest remaining dashboard takes over. */
  async delete(db: Executor, businessId: string, dashboardId: string): Promise<DashboardLayout> {
    return db.transaction(async (tx) => {
      const archived = one(await tx.update(dashboardLayouts).set({ archivedAt: new Date(), isActive: false }).where(scoped(businessId, dashboardId)).returning(), "dashboard", dashboardId);
      if (!(await dashboardsRepo.active(tx, businessId, archived.userId))) {
        const [next] = await dashboardsRepo.list(tx, businessId, archived.userId);
        if (next) await tx.update(dashboardLayouts).set({ isActive: true }).where(scoped(businessId, next.id));
      }
      return archived;
    });
  },
};
