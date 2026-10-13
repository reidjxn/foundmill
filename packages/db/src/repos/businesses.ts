/** businesses — the club record (BUILD §7.2 "Accounts and businesses", routers business.*). */
import { AGENT_STOP_REASONS, ARCHETYPES, BUSINESS_MODES, DATA_REGIONS, GAME_MODES, MODEL_BILLING, PLAN_TIERS, slugify, uuid, type AgentStopReason } from "@foundmill/shared";
import { and, desc, eq, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import { businesses, memberships, type Business } from "../schema";
import { changes, Id, IsoDateInput, maybeOne, MinorAmount, one, parseInput, type Executor } from "./_shared";

const HexColour = z.string().regex(/^#[0-9a-fA-F]{6}$/, "brand colors are #RRGGBB");

export const CreateBusinessInput = z.object({
  /** Supply the id when the caller must know it before RETURNING is possible (RLS bootstrap, seeds). */
  id: Id.optional(),
  name: z.string().trim().min(1).max(120),
  slug: z.string().trim().min(1).max(80).regex(/^[a-z0-9-]+$/).optional(),
  gameMode: z.enum(GAME_MODES).default("personal"),
  businessMode: z.enum(BUSINESS_MODES).default("assisted"),
  archetype: z.enum(ARCHETYPES).nullable().optional(),
  kitPrimary: HexColour.optional(),
  kitSecondary: HexColour.optional(),
  region: z.enum(DATA_REGIONS).default("eu"),
  planTier: z.enum(PLAN_TIERS).default("free"),
  modelBilling: z.enum(MODEL_BILLING).default("credits"),
  /** "Spend cap per action" (Commit, Settings › Mode) in minor units of the business currency; null: no business cap. */
  spendCapMinor: MinorAmount.nonnegative().nullable().default(null),
  glossary: z.record(z.string(), z.string()).default({}),
  createdBy: Id.nullable().optional(),
});
export type CreateBusinessInput = z.input<typeof CreateBusinessInput>;

export const UpdateBusinessInput = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  slug: z.string().trim().min(1).max(80).regex(/^[a-z0-9-]+$/).optional(),
  archetype: z.enum(ARCHETYPES).nullable().optional(),
  kitPrimary: HexColour.optional(),
  kitSecondary: HexColour.optional(),
  region: z.enum(DATA_REGIONS).optional(),
  planTier: z.enum(PLAN_TIERS).optional(),
  modelBilling: z.enum(MODEL_BILLING).optional(),
  glossary: z.record(z.string(), z.string()).optional(),
});
export type UpdateBusinessInput = z.input<typeof UpdateBusinessInput>;

const notArchived = isNull(businesses.archivedAt);

export const businessesRepo = {
  /** The business, or NotFoundError. Archived businesses are not found unless `includeArchived`. */
  async get(db: Executor, businessId: string, options: { includeArchived?: boolean } = {}): Promise<Business> {
    const rows = await db
      .select()
      .from(businesses)
      .where(options.includeArchived ? eq(businesses.id, businessId) : and(eq(businesses.id, businessId), notArchived))
      .limit(1);
    return one(rows, "business", businessId);
  },

  async getBySlug(db: Executor, slug: string): Promise<Business | null> {
    return maybeOne(await db.select().from(businesses).where(and(eq(businesses.slug, slug), notArchived)).limit(1));
  },

  /** Account-scoped: every business the user is a member of, newest first. */
  async listForUser(db: Executor, userId: string): Promise<(Business & { role: string })[]> {
    const rows = await db
      .select({ business: businesses, role: memberships.role })
      .from(memberships)
      .innerJoin(businesses, eq(businesses.id, memberships.businessId))
      .where(and(eq(memberships.userId, userId), notArchived))
      .orderBy(desc(businesses.createdAt));
    return rows.map((r) => ({ ...r.business, role: r.role }));
  },

  /**
   * Account-scoped: creates the business row. The id is generated here (not by RETURNING) because
   * `insert … returning` as `authenticated` needs a membership that does not exist yet (DECISIONS
   * "Business creation generates the id client-side"); callers insert the owner membership next.
   */
  async create(db: Executor, input: CreateBusinessInput): Promise<Business> {
    const v = parseInput(CreateBusinessInput, input, "business");
    const id = v.id ?? uuid();
    const slug = v.slug ?? slugify(v.name);
    await db.insert(businesses).values({
      id,
      name: v.name,
      slug,
      gameMode: v.gameMode,
      businessMode: v.businessMode,
      archetype: v.archetype ?? null,
      ...(v.kitPrimary ? { kitPrimary: v.kitPrimary } : {}),
      ...(v.kitSecondary ? { kitSecondary: v.kitSecondary } : {}),
      region: v.region,
      planTier: v.planTier,
      modelBilling: v.modelBilling,
      spendCapMinor: v.spendCapMinor,
      glossary: v.glossary,
      createdBy: v.createdBy ?? null,
    });
    return {
      id,
      name: v.name,
      slug,
      gameMode: v.gameMode,
      businessMode: v.businessMode,
      archetype: v.archetype ?? null,
      kitPrimary: v.kitPrimary ?? "#1b4fd8",
      kitSecondary: v.kitSecondary ?? "#f5c400",
      // Retired (0017): always null; the logo lives in business_logos.
      crestUrl: null,
      region: v.region,
      committedAt: null,
      planTier: v.planTier,
      modelBilling: v.modelBilling,
      spendCapMinor: v.spendCapMinor,
      glossary: v.glossary,
      createdBy: v.createdBy ?? null,
      agentsStoppedAt: null,
      agentsStoppedReason: null,
      createdAt: new Date(),
      updatedAt: new Date(),
      archivedAt: null,
    };
  },

  /**
   * Whether work may start for the business (0023): false while the team is stopped (Stop all agents, a revoked key,
   * used-up credits) or the business is archived. Every path that starts a session, a cycle, an engine or a training
   * run asks this first; `resumeBusinessAgents` is the only way back.
   */
  async agentsStopped(db: Executor, businessId: string): Promise<boolean> {
    const state = await businessesRepo.stopState(db, businessId);
    return state.stopped;
  },

  /** The team-wide stop with its reason (`stopped` also when the business is archived). */
  async stopState(db: Executor, businessId: string): Promise<{ stopped: boolean; stoppedAt: Date | null; reason: Business["agentsStoppedReason"]; archived: boolean }> {
    const rows = await db
      .select({ stoppedAt: businesses.agentsStoppedAt, reason: businesses.agentsStoppedReason, archivedAt: businesses.archivedAt })
      .from(businesses)
      .where(eq(businesses.id, businessId))
      .limit(1);
    const row = one(rows, "business", businessId);
    return { stopped: row.stoppedAt !== null || row.archivedAt !== null, stoppedAt: row.stoppedAt, reason: row.reason, archived: row.archivedAt !== null };
  },

  async update(db: Executor, businessId: string, input: UpdateBusinessInput): Promise<Business> {
    const v = parseInput(UpdateBusinessInput, input, "business update");
    const rows = await db.update(businesses).set(changes(v, "business")).where(and(eq(businesses.id, businessId), notArchived)).returning();
    return one(rows, "business", businessId);
  },

  async setGameMode(db: Executor, businessId: string, gameMode: (typeof GAME_MODES)[number]): Promise<Business> {
    const mode = parseInput(z.enum(GAME_MODES), gameMode, "game mode");
    return one(await db.update(businesses).set({ gameMode: mode }).where(and(eq(businesses.id, businessId), notArchived)).returning(), "business", businessId);
  },

  async setBusinessMode(db: Executor, businessId: string, businessMode: (typeof BUSINESS_MODES)[number]): Promise<Business> {
    const mode = parseInput(z.enum(BUSINESS_MODES), businessMode, "business mode");
    return one(await db.update(businesses).set({ businessMode: mode }).where(and(eq(businesses.id, businessId), notArchived)).returning(), "business", businessId);
  },

  /**
   * Account-scoped: holds a per-owner lock until the transaction ends, so two commits by one owner are counted against
   * the plan's business limit one after the other (`assertBusinessAllowance`, packages/db/src/tiers.ts).
   */
  async lockOwnerBusinesses(db: Executor, userId: string): Promise<void> {
    const id = parseInput(Id, userId, "user id");
    await db.execute(sql`select pg_advisory_xact_lock(hashtext('business_allowance'), hashtext(${id}::text))`);
  },

  /** The founder's "Spend cap per action" (Settings › Mode); null removes the business cap. */
  async setSpendCap(db: Executor, businessId: string, spendCapMinor: number | null): Promise<Business> {
    const cap = parseInput(MinorAmount.nonnegative().nullable(), spendCapMinor, "spend cap");
    return one(await db.update(businesses).set({ spendCapMinor: cap }).where(and(eq(businesses.id, businessId), notArchived)).returning(), "business", businessId);
  },

  /** Marks the idea committed (BUILD §11.1): sets archetype and committed_at. */
  async commit(db: Executor, businessId: string, input: { archetype: (typeof ARCHETYPES)[number]; committedAt?: Date }): Promise<Business> {
    const v = parseInput(z.object({ archetype: z.enum(ARCHETYPES), committedAt: IsoDateInput.optional() }), input, "commit");
    return one(
      await db
        .update(businesses)
        .set({ archetype: v.archetype, committedAt: v.committedAt ?? new Date() })
        .where(and(eq(businesses.id, businessId), notArchived))
        .returning(),
      "business",
      businessId,
    );
  },

  /**
   * Sets the team-wide stop (0023). Stop all agents outranks a stop already set for a key or credits (only an owner or
   * admin lifts it); otherwise the first reason and time stay, so a later stop never hides why the team stopped.
   */
  async setAgentsStopped(db: Executor, businessId: string, input: { reason: AgentStopReason; at?: Date }): Promise<{ stoppedAt: Date; reason: AgentStopReason; already: boolean }> {
    const v = parseInput(z.object({ reason: z.enum(AGENT_STOP_REASONS), at: z.date().optional() }), input, "agents stop");
    return db.transaction(async (tx) => {
      const before = one(await tx.select({ stoppedAt: businesses.agentsStoppedAt, reason: businesses.agentsStoppedReason }).from(businesses).where(eq(businesses.id, businessId)).for("update").limit(1), "business", businessId);
      const stoppedAt = before.stoppedAt ?? v.at ?? new Date();
      const reason: AgentStopReason = v.reason === "kill_switch" ? "kill_switch" : (before.reason ?? v.reason);
      if (before.stoppedAt === null || before.reason !== reason) await tx.update(businesses).set({ agentsStoppedAt: stoppedAt, agentsStoppedReason: reason }).where(eq(businesses.id, businessId));
      return { stoppedAt, reason, already: before.stoppedAt !== null };
    });
  },

  /**
   * Clears the team-wide stop. With `onlyFor`, only a stop with one of those reasons is cleared (a new key clears a
   * key revoke, a top-up the credits stop; neither lifts Stop all agents). Returns what was cleared.
   */
  async clearAgentsStopped(db: Executor, businessId: string, options: { onlyFor?: readonly AgentStopReason[] } = {}): Promise<{ cleared: boolean; stoppedAt: Date | null; reason: AgentStopReason | null }> {
    return db.transaction(async (tx) => {
      const before = one(await tx.select({ stoppedAt: businesses.agentsStoppedAt, reason: businesses.agentsStoppedReason }).from(businesses).where(eq(businesses.id, businessId)).for("update").limit(1), "business", businessId);
      if (before.stoppedAt === null) return { cleared: false, stoppedAt: null, reason: null };
      if (options.onlyFor && (before.reason === null || !options.onlyFor.includes(before.reason))) return { cleared: false, stoppedAt: before.stoppedAt, reason: before.reason };
      await tx.update(businesses).set({ agentsStoppedAt: null, agentsStoppedReason: null }).where(eq(businesses.id, businessId));
      return { cleared: true, stoppedAt: before.stoppedAt, reason: before.reason };
    });
  },

  /** Soft delete (permanent deletion is a hard gate). */
  async archive(db: Executor, businessId: string): Promise<Business> {
    return one(await db.update(businesses).set({ archivedAt: new Date() }).where(and(eq(businesses.id, businessId), notArchived)).returning(), "business", businessId);
  },
};
