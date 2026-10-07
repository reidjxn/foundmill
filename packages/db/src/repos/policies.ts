/**
 * policies — founder-authored Cedar policies layered over the platform rules (BUILD §9.5; scope business,
 * department or agent). The gateway loads `effective(businessId, { departmentIds, agentId })` and appends the
 * texts to the built-in policy set; platform hard gates can never be removed by a stored policy because the
 * built-ins are always evaluated first and a Cedar `forbid` wins.
 */
import { and, asc, eq, inArray, isNull, or, sql } from "drizzle-orm";
import { z } from "zod";
import { policies, POLICY_SCOPES, type Policy } from "../schema";
import { Id, one, parseInput, type Executor } from "./_shared";

export const CreatePolicyInput = z
  .object({
    scope: z.enum(POLICY_SCOPES),
    scopeId: Id.nullable().optional(),
    name: z.string().trim().max(120).default(""),
    cedarText: z.string().trim().min(1).max(20_000),
    enabled: z.boolean().default(true),
    createdBy: Id.nullable().optional(),
  })
  .refine((v) => v.scope === "business" || Boolean(v.scopeId), { message: "department and agent policies name their scopeId", path: ["scopeId"] });
export type CreatePolicyInput = z.input<typeof CreatePolicyInput>;

export const PolicyListFilter = z.object({
  scope: z.enum(POLICY_SCOPES).optional(),
  scopeId: Id.optional(),
  enabledOnly: z.boolean().default(false),
  includeArchived: z.boolean().default(false),
});
export type PolicyListFilter = z.input<typeof PolicyListFilter>;

const scoped = (businessId: string, policyId: string) => and(eq(policies.businessId, businessId), eq(policies.id, policyId));

export const policiesRepo = {
  async list(db: Executor, businessId: string, filter: PolicyListFilter = {}): Promise<Policy[]> {
    const f = parseInput(PolicyListFilter, filter, "policy filter");
    return db
      .select()
      .from(policies)
      .where(
        and(
          eq(policies.businessId, businessId),
          f.includeArchived ? undefined : isNull(policies.archivedAt),
          f.scope ? eq(policies.scope, f.scope) : undefined,
          f.scopeId ? eq(policies.scopeId, f.scopeId) : undefined,
          f.enabledOnly ? eq(policies.enabled, true) : undefined,
        ),
      )
      .orderBy(asc(policies.scope), asc(policies.createdAt));
  },

  async get(db: Executor, businessId: string, policyId: string): Promise<Policy> {
    return one(await db.select().from(policies).where(scoped(businessId, policyId)).limit(1), "policy", policyId);
  },

  async create(db: Executor, businessId: string, input: CreatePolicyInput): Promise<Policy> {
    const v = parseInput(CreatePolicyInput, input, "policy");
    return one(
      await db.insert(policies).values({ businessId, scope: v.scope, scopeId: v.scope === "business" ? null : (v.scopeId ?? null), name: v.name, cedarText: v.cedarText, enabled: v.enabled, createdBy: v.createdBy ?? null }).returning(),
      "policy",
    );
  },

  /** A new text bumps `version`; name changes alone do not. */
  async update(db: Executor, businessId: string, policyId: string, input: { name?: string; cedarText?: string }): Promise<Policy> {
    const v = parseInput(z.object({ name: z.string().trim().max(120).optional(), cedarText: z.string().trim().min(1).max(20_000).optional() }), input, "policy update");
    return db.transaction(async (tx) => {
      const current = await policiesRepo.get(tx, businessId, policyId);
      const textChanged = v.cedarText !== undefined && v.cedarText !== current.cedarText;
      return one(
        await tx
          .update(policies)
          .set({ ...(v.name !== undefined ? { name: v.name } : {}), ...(textChanged ? { cedarText: v.cedarText, version: current.version + 1 } : {}) })
          .where(scoped(businessId, policyId))
          .returning(),
        "policy",
        policyId,
      );
    });
  },

  async setEnabled(db: Executor, businessId: string, policyId: string, enabled: boolean): Promise<Policy> {
    return one(await db.update(policies).set({ enabled }).where(scoped(businessId, policyId)).returning(), "policy", policyId);
  },

  async archive(db: Executor, businessId: string, policyId: string): Promise<Policy> {
    return one(await db.update(policies).set({ archivedAt: new Date(), enabled: false }).where(scoped(businessId, policyId)).returning(), "policy", policyId);
  },

  /** Enabled policies that apply to an agent: business-wide + its departments + the agent itself, business first. */
  async effective(db: Executor, businessId: string, target: { departmentIds?: readonly string[]; agentId?: string } = {}): Promise<Policy[]> {
    const t = parseInput(z.object({ departmentIds: z.array(Id).default([]), agentId: Id.optional() }), target, "policy target");
    return db
      .select()
      .from(policies)
      .where(
        and(
          eq(policies.businessId, businessId),
          isNull(policies.archivedAt),
          eq(policies.enabled, true),
          or(
            eq(policies.scope, "business"),
            t.departmentIds.length ? and(eq(policies.scope, "department"), inArray(policies.scopeId, [...t.departmentIds])) : undefined,
            t.agentId ? and(eq(policies.scope, "agent"), eq(policies.scopeId, t.agentId)) : undefined,
          ),
        ),
      )
      .orderBy(sql`case ${policies.scope} when 'business' then 0 when 'department' then 1 else 2 end`, asc(policies.createdAt));
  },
};
