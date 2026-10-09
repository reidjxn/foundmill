/** screen_definitions — department tabs and their widget layouts (routers screen.get/update; ARCHITECTURE §18). */
import { and, asc, eq, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import { screenDefinitions, type ScreenDefinition } from "../schema";
import { Id, maybeOne, one, parseInput, type Executor } from "./_shared";

/** Layout shape: widgets by key with grid positions and per-widget settings (screen_definitions.layout). */
export const WidgetPlacement = z.object({
  key: z.string().min(1),
  x: z.number().int().min(0),
  y: z.number().int().min(0),
  w: z.number().int().min(1),
  h: z.number().int().min(1),
  settings: z.record(z.string(), z.unknown()).default({}),
});
export const ScreenLayout = z.object({ widgets: z.array(WidgetPlacement) });
export type ScreenLayout = z.infer<typeof ScreenLayout>;

export const UpsertScreenInput = z.object({
  departmentId: Id,
  tabSlug: z.string().trim().min(1).max(60).regex(/^[a-z0-9-]+$/),
  title: z.string().trim().min(1).max(80),
  position: z.number().int().min(0).optional(),
  layout: ScreenLayout.default({ widgets: [] }),
});
export type UpsertScreenInput = z.input<typeof UpsertScreenInput>;

export const screensRepo = {
  async list(db: Executor, businessId: string, departmentId: string): Promise<ScreenDefinition[]> {
    return db
      .select()
      .from(screenDefinitions)
      .where(and(eq(screenDefinitions.businessId, businessId), eq(screenDefinitions.departmentId, departmentId), isNull(screenDefinitions.archivedAt)))
      .orderBy(asc(screenDefinitions.position), asc(screenDefinitions.createdAt));
  },

  async get(db: Executor, businessId: string, departmentId: string, tabSlug: string): Promise<ScreenDefinition | null> {
    return maybeOne(
      await db
        .select()
        .from(screenDefinitions)
        .where(and(eq(screenDefinitions.businessId, businessId), eq(screenDefinitions.departmentId, departmentId), eq(screenDefinitions.tabSlug, tabSlug), isNull(screenDefinitions.archivedAt)))
        .limit(1),
    );
  },

  async getById(db: Executor, businessId: string, screenId: string): Promise<ScreenDefinition> {
    return one(await db.select().from(screenDefinitions).where(and(eq(screenDefinitions.businessId, businessId), eq(screenDefinitions.id, screenId))).limit(1), "screen", screenId);
  },

  /** Creates the tab or replaces its title/layout (version increments on every update). */
  async upsert(db: Executor, businessId: string, input: UpsertScreenInput): Promise<ScreenDefinition> {
    const v = parseInput(UpsertScreenInput, input, "screen");
    const position =
      v.position ??
      Number(
        one(
          await db
            .select({ n: sql<number>`coalesce(max(${screenDefinitions.position}), -1) + 1` })
            .from(screenDefinitions)
            .where(and(eq(screenDefinitions.businessId, businessId), eq(screenDefinitions.departmentId, v.departmentId))),
          "position",
        ).n,
      );
    return one(
      await db
        .insert(screenDefinitions)
        .values({ businessId, departmentId: v.departmentId, tabSlug: v.tabSlug, title: v.title, position, layout: v.layout })
        .onConflictDoUpdate({
          target: [screenDefinitions.departmentId, screenDefinitions.tabSlug],
          set: { title: v.title, layout: v.layout, ...(v.position !== undefined ? { position: v.position } : {}), archivedAt: null, version: sql`${screenDefinitions.version} + 1` },
          setWhere: eq(screenDefinitions.businessId, businessId),
        })
        .returning(),
      "screen",
    );
  },

  /**
   * Many tabs at once, each with its position given (a business's first screens at commit): one statement instead of
   * one per tab. Same conflict rule as `upsert`. Rows come back in the order given.
   */
  async upsertMany(db: Executor, businessId: string, inputs: (UpsertScreenInput & { position: number })[]): Promise<ScreenDefinition[]> {
    if (inputs.length === 0) return [];
    const list = inputs.map((i) => ({ ...parseInput(UpsertScreenInput, i, "screen"), position: i.position }));
    const written = await db
      .insert(screenDefinitions)
      .values(list.map((v) => ({ businessId, departmentId: v.departmentId, tabSlug: v.tabSlug, title: v.title, position: v.position, layout: v.layout })))
      .onConflictDoUpdate({
        target: [screenDefinitions.departmentId, screenDefinitions.tabSlug],
        set: { title: sql`excluded.title`, layout: sql`excluded.layout`, position: sql`excluded.position`, archivedAt: null, version: sql`${screenDefinitions.version} + 1` },
        setWhere: eq(screenDefinitions.businessId, businessId),
      })
      .returning();
    const key = (r: { departmentId: string; tabSlug: string }) => `${r.departmentId}/${r.tabSlug}`;
    const byKey = new Map(written.map((r) => [key(r), r] as const));
    return list.map((v) => one([byKey.get(key(v))].filter((r): r is ScreenDefinition => r !== undefined), "screen"));
  },

  /** Updates only the layout (widget grid edits); bumps the version. */
  async updateLayout(db: Executor, businessId: string, screenId: string, layout: ScreenLayout): Promise<ScreenDefinition> {
    const l = parseInput(ScreenLayout, layout, "screen layout");
    return one(
      await db
        .update(screenDefinitions)
        .set({ layout: l, version: sql`${screenDefinitions.version} + 1` })
        .where(and(eq(screenDefinitions.businessId, businessId), eq(screenDefinitions.id, screenId)))
        .returning(),
      "screen",
      screenId,
    );
  },

  async archive(db: Executor, businessId: string, screenId: string): Promise<ScreenDefinition> {
    return one(await db.update(screenDefinitions).set({ archivedAt: new Date() }).where(and(eq(screenDefinitions.businessId, businessId), eq(screenDefinitions.id, screenId))).returning(), "screen", screenId);
  },
};
