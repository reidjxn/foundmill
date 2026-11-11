/** founder_profiles — account-scoped (userId first), routers founder.profile.get/update. */
import { RESERVED_NAME_MESSAGE, isReservedName } from "@foundmill/config";
import { VISIBILITY, ValidationError } from "@foundmill/shared";
import { and, asc, eq, isNull, sql } from "drizzle-orm";
import { authUsers } from "drizzle-orm/supabase";
import { z } from "zod";
import { businesses, founderProfiles, memberships, type Business, type FounderProfile, type Membership } from "../schema";
import { Currency, changes, Id, maybeOne, MinorAmount, one, parseInput, type Executor, patchSchema } from "./_shared";

const SkillRatings = z.record(z.string(), z.number().int().min(1).max(20));

export const FounderProfileInput = z.object({
  // Not a name that poses as the platform or its staff ("Foundmill Support"): other founders read it as who wrote to them.
  displayName: z.string().trim().min(1).max(120).refine((n) => !isReservedName(n), RESERVED_NAME_MESSAGE),
  experience: z.string().max(4000).nullable().optional(),
  skills: SkillRatings.default({}),
  timeCommitment: z.string().max(120).nullable().optional(),
  budgetMinor: MinorAmount.nullable().optional(),
  currency: Currency.optional(),
  citizenship: z.string().max(80).nullable().optional(),
  residence: z.string().max(80).nullable().optional(),
  targetMarkets: z.array(z.string().max(80)).default([]),
  constraints: z.array(z.string().max(400)).default([]),
  riskAppetite: z.string().max(80).nullable().optional(),
  visibility: z.enum(VISIBILITY).default("private"),
});
export type FounderProfileInput = z.input<typeof FounderProfileInput>;

export const FounderProfilePatch = patchSchema(FounderProfileInput);
export type FounderProfilePatch = z.input<typeof FounderProfilePatch>;

/** Says why in the person's words (parseInput would only say "Invalid founder profile"); the schema holds the same rule. */
function assertNameFree(displayName: string | undefined): void {
  if (displayName !== undefined && isReservedName(displayName)) throw new ValidationError(RESERVED_NAME_MESSAGE);
}

export const foundersRepo = {
  /**
   * The account that signs in with this email (case-insensitive), or null: an owner or admin adds a co-founder by the
   * email they sign in with (team.humans.invite). Reads auth.users, so it runs on the service connection.
   */
  async userIdByEmail(db: Executor, email: string): Promise<string | null> {
    const e = parseInput(z.string().trim().email().max(320), email, "email");
    const rows = await db.select({ id: authUsers.id }).from(authUsers).where(sql`lower(${authUsers.email}) = lower(${e})`).limit(2);
    // Two accounts on one address (case variants) are ambiguous: the account ID is needed instead.
    return rows.length === 1 ? rows[0]!.id : null;
  },

  /**
   * The address the account signs in with, or null (no account, no address, or a malformed one). Reads auth.users, so it
   * runs on the service connection; only the gateway asks, to email the person from Foundmill (never from a request).
   */
  async emailOf(db: Executor, userId: string): Promise<string | null> {
    const id = parseInput(Id, userId, "user id");
    const row = maybeOne(await db.select({ email: authUsers.email }).from(authUsers).where(eq(authUsers.id, id)).limit(1));
    const email = row?.email?.trim().toLowerCase() ?? "";
    return z.email().max(254).safeParse(email).success ? email : null;
  },

  async get(db: Executor, userId: string): Promise<FounderProfile | null> {
    return maybeOne(await db.select().from(founderProfiles).where(and(eq(founderProfiles.userId, userId), isNull(founderProfiles.archivedAt))).limit(1));
  },

  /** Creates or replaces the profile for the user (one profile per account). */
  async upsert(db: Executor, userId: string, input: FounderProfileInput): Promise<FounderProfile> {
    assertNameFree(input.displayName);
    const v = parseInput(FounderProfileInput, input, "founder profile");
    const values = {
      userId,
      displayName: v.displayName,
      experience: v.experience ?? null,
      skills: v.skills,
      timeCommitment: v.timeCommitment ?? null,
      budgetMinor: v.budgetMinor ?? null,
      ...(v.currency ? { currency: v.currency } : {}),
      citizenship: v.citizenship ?? null,
      residence: v.residence ?? null,
      targetMarkets: v.targetMarkets,
      constraints: v.constraints,
      riskAppetite: v.riskAppetite ?? null,
      visibility: v.visibility,
    };
    const rows = await db
      .insert(founderProfiles)
      .values(values)
      .onConflictDoUpdate({ target: founderProfiles.userId, set: { ...values, archivedAt: null } })
      .returning();
    return one(rows, "founder profile", userId);
  },

  /**
   * The signed-in account in one statement, one round trip (founder.profile.get): the profile as `get` answers it, every
   * membership as `memberships.listForUser` answers them (oldest first, archived businesses included) and the open
   * businesses with the role held in each as `businesses.listForUser` answers them (newest first). Until 2026-10-15 these
   * were three statements on three pooled connections. Each business says whether it is held through an example
   * membership (`isExample`, 0065), so the index route and the LIVE pages never take a demo for the founder's own.
   */
  async account(db: Executor, userId: string): Promise<{ profile: FounderProfile | null; memberships: Membership[]; businesses: (Business & { role: string; isExample: boolean })[] }> {
    const id = parseInput(Id, userId, "user id");
    // One row per membership (one row of nulls when there is none), each carrying the profile.
    const rows = await db
      .select({ profile: founderProfiles, membership: memberships, business: businesses, businessOrder: sql<number>`row_number() over (order by ${businesses.createdAt} desc nulls last)`.mapWith(Number) })
      .from(sql`(select ${id}::uuid as user_id) as "me"`)
      .leftJoin(founderProfiles, and(sql`${founderProfiles.userId} = "me"."user_id"`, isNull(founderProfiles.archivedAt)))
      .leftJoin(memberships, sql`${memberships.userId} = "me"."user_id"`)
      .leftJoin(businesses, and(eq(businesses.id, memberships.businessId), isNull(businesses.archivedAt)))
      .orderBy(asc(memberships.createdAt));
    const held = rows.filter((r): r is typeof r & { membership: Membership } => r.membership !== null);
    return {
      profile: rows[0]?.profile ?? null,
      memberships: held.map((r) => r.membership),
      businesses: held
        .filter((r): r is typeof r & { business: Business } => r.business !== null)
        .sort((a, b) => a.businessOrder - b.businessOrder)
        .map((r) => ({ ...r.business, role: r.membership.role, isExample: r.membership.source === "example" })),
    };
  },

  /**
   * The business founder's profile experience (the Composer's "who the note is written to", UX plan §7.19), in one
   * statement: the owner as `memberships.owner` picks them (the creator while they still own it, else the
   * longest-standing owner) joined to their open profile. Null without an owner, a profile or an experience.
   */
  async ownerExperience(db: Executor, businessId: string): Promise<string | null> {
    const rows = await db
      .select({ experience: founderProfiles.experience })
      .from(memberships)
      .innerJoin(businesses, eq(businesses.id, memberships.businessId))
      .leftJoin(founderProfiles, and(eq(founderProfiles.userId, memberships.userId), isNull(founderProfiles.archivedAt)))
      .where(and(eq(memberships.businessId, businessId), eq(memberships.role, "owner")))
      .orderBy(sql`(${memberships.userId} = ${businesses.createdBy}) desc`, asc(memberships.createdAt), asc(memberships.id))
      .limit(1);
    return rows[0]?.experience ?? null;
  },

  async update(db: Executor, userId: string, patch: FounderProfilePatch): Promise<FounderProfile> {
    assertNameFree(patch.displayName);
    const v = parseInput(FounderProfilePatch, patch, "founder profile update");
    return one(await db.update(founderProfiles).set(changes(v, "founder profile")).where(eq(founderProfiles.userId, userId)).returning(), "founder profile", userId);
  },
};
