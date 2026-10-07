/** founder_profiles — account-scoped (userId first), routers founder.profile.get/update. */
import { VISIBILITY } from "@founder-manager/shared";
import { and, eq, isNull } from "drizzle-orm";
import { z } from "zod";
import { founderProfiles, type FounderProfile } from "../schema";
import { Currency, defined, maybeOne, MinorAmount, one, parseInput, type Executor, patchSchema } from "./_shared";

const SkillRatings = z.record(z.string(), z.number().int().min(1).max(20));

export const FounderProfileInput = z.object({
  displayName: z.string().trim().min(1).max(120),
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

export const foundersRepo = {
  async get(db: Executor, userId: string): Promise<FounderProfile | null> {
    return maybeOne(await db.select().from(founderProfiles).where(and(eq(founderProfiles.userId, userId), isNull(founderProfiles.archivedAt))).limit(1));
  },

  /** Creates or replaces the profile for the user (one profile per account). */
  async upsert(db: Executor, userId: string, input: FounderProfileInput): Promise<FounderProfile> {
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

  async update(db: Executor, userId: string, patch: FounderProfilePatch): Promise<FounderProfile> {
    const v = parseInput(FounderProfilePatch, patch, "founder profile update");
    return one(await db.update(founderProfiles).set(defined(v)).where(eq(founderProfiles.userId, userId)).returning(), "founder profile", userId);
  },
};
