/** dashboard_layouts — per-user Home layouts and presets (routers dashboard.*; BUILD §11.2). */
import { and, asc, eq, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import { dashboardLayouts, type DashboardLayout } from "../schema";
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

  async create(db: Executor, businessId: string, input: CreateDashboardInput): Promise<DashboardLayout> {
    const v = parseInput(CreateDashboardInput, input, "dashboard");
    return db.transaction(async (tx) => {
      if (v.isActive) {
        await tx.update(dashboardLayouts).set({ isActive: false }).where(and(eq(dashboardLayouts.businessId, businessId), eq(dashboardLayouts.userId, v.userId)));
      }
      return one(await tx.insert(dashboardLayouts).values({ businessId, userId: v.userId, name: v.name, preset: v.preset ?? null, layout: v.layout, isActive: v.isActive }).returning(), "dashboard");
    });
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
      return one(await tx.update(dashboardLayouts).set({ isActive: true }).where(scoped(businessId, dashboardId)).returning(), "dashboard", dashboardId);
    });
  },

  async delete(db: Executor, businessId: string, dashboardId: string): Promise<DashboardLayout> {
    return one(await db.update(dashboardLayouts).set({ archivedAt: new Date(), isActive: false }).where(scoped(businessId, dashboardId)).returning(), "dashboard", dashboardId);
  },
};
