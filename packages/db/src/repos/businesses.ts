/** businesses — the business record (BUILD §7.2 "Accounts and businesses", routers business.*). */
import { ARCHETYPES, BUSINESS_MODES, DATA_REGIONS, DEFAULT_BUSINESS_CURRENCY, GAME_MODES, MODEL_BILLING, PLAN_TIERS, slugify, uuid } from "@foundmill/shared";
import { and, desc, eq, isNull } from "drizzle-orm";
import { z } from "zod";
import { businesses, memberships, type Business } from "../schema";
import { Currency, defined, Id, IsoDateInput, maybeOne, one, parseInput, type Executor } from "./_shared";

const HexColour = z.string().regex(/^#[0-9a-fA-F]{6}$/, "brand colors are #RRGGBB");
/** ISO 4217: three letters (0025 holds the column to the same shape). */
const BusinessCurrency = Currency.regex(/^[A-Z]{3}$/, "a currency is a 3-letter ISO 4217 code");

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
  glossary: z.record(z.string(), z.string()).default({}),
  /** The business's own currency (0025); commit passes the founder's choice. Mirrors the column default. */
  currency: BusinessCurrency.default(DEFAULT_BUSINESS_CURRENCY),
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
  currency: BusinessCurrency.optional(),
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
      glossary: v.glossary,
      currency: v.currency,
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
      glossary: v.glossary,
      currency: v.currency,
      createdBy: v.createdBy ?? null,
      createdAt: new Date(),
      updatedAt: new Date(),
      archivedAt: null,
    };
  },

  async update(db: Executor, businessId: string, input: UpdateBusinessInput): Promise<Business> {
    const v = parseInput(UpdateBusinessInput, input, "business update");
    const rows = await db.update(businesses).set(defined(v)).where(and(eq(businesses.id, businessId), notArchived)).returning();
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

  /** Soft delete (permanent deletion is a hard gate). */
  async archive(db: Executor, businessId: string): Promise<Business> {
    return one(await db.update(businesses).set({ archivedAt: new Date() }).where(and(eq(businesses.id, businessId), notArchived)).returning(), "business", businessId);
  },
};
