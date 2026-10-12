/** team.agents.* / team.humans.* / team.responsibilities.* (BUILD §11.9; AC-11.9.2 responsibilities route approvals). */
import { TEMPLATE_KEYS, listTemplates } from "@foundmill/agents";
import { CREDITS_CURRENCY } from "@foundmill/config";
import { SectionPermissions, assertSeatAvailable, repos } from "@foundmill/db";
import { ConflictError, DECISION_TYPES, ForbiddenError, MEMBERSHIP_ROLES, ValidationError } from "@foundmill/shared";
import { z } from "zod";
import { hireFromTemplate } from "../services/squad";
import { Id, adminProcedure, audit, emit, router, sectionRead, sectionWrite } from "../trpc";

const read = sectionRead("team");
const write = sectionWrite("team");

const Handler = z.object({ kind: z.enum(["founder", "user", "agent"]), id: Id.nullable().default(null) });
const Responsibility = z.object({ decisionType: z.enum(DECISION_TYPES), handler: Handler });
type ResponsibilityRow = z.infer<typeof Responsibility>;

const parseApprovers = (raw: unknown): ResponsibilityRow[] => (Array.isArray(raw) ? raw.map((r) => Responsibility.safeParse(r)).filter((r) => r.success).map((r) => r.data) : []);

export const teamRouter = router({
  agents: router({
    /** Squad table rows (BUILD §11.9): agent, role, departments, status, current task, skills, model, wage. */
    list: read.input(z.object({ departmentId: Id.optional(), includeArchived: z.boolean().default(false) })).query(({ ctx, input }) =>
      ctx.rls(async (tx) => {
        const period = new Date().toISOString().slice(0, 7);
        const [agents, running, wages, departments] = await Promise.all([
          repos.agents.list(tx, ctx.businessId, { ...input, limit: 500 }),
          repos.tasks.list(tx, ctx.businessId, { status: ["running", "paused", "blocked", "review"], limit: 500 }),
          repos.usage.wages(tx, ctx.businessId, period),
          repos.departments.list(tx, ctx.businessId),
        ]);
        const rows = await Promise.all(
          agents.items.map(async (a) => {
            const skills = await repos.skills.listForAgent(tx, ctx.businessId, a.id);
            const rating = skills.length ? Math.round((skills.reduce((s, k) => s + k.displayed, 0) / skills.length) * 5) / 10 : null;
            return {
              ...a,
              departments: departments.filter((d) => a.departmentIds.includes(d.id)).map((d) => ({ id: d.id, name: d.name, colourToken: d.colourToken })),
              currentTask: running.items.find((t) => t.assigneeAgentId === a.id) ?? null,
              skills,
              rating,
              wage: { costMinor: wages.find((w) => w.agentId === a.id)?.costMinor ?? 0, currency: CREDITS_CURRENCY, capMinor: a.wageCapMinor, period, label: "Estimate" as const },
            };
          }),
        );
        return { agents: rows, templates: TEMPLATE_KEYS };
      }),
    ),

    catalogue: read.input(z.object({ family: z.enum(["assistant", "lead", "worker", "channel", "specialist", "utility"]).optional() })).query(({ input }) =>
      listTemplates(input ?? {}).map((t) => ({ key: t.key, name: t.name, role: t.role, family: t.family, layer: t.layer, module: t.module, channelKey: t.channelKey ?? null, modelKey: t.modelKey, description: t.description, skills: t.skills, wageCapMinor: t.wageCapMinor, wageLabel: "Estimate" as const, traits: t.traits })),
    ),

    /** Hire from the catalogue into a department (agent_skills is service-written, so this runs on the service db). */
    hire: write.input(z.object({ templateKey: z.string().min(1), departmentId: Id, name: z.string().min(1).max(80).optional() })).mutation(async ({ ctx, input }) => {
      const department = await ctx.rls((tx) => repos.departments.get(tx, ctx.businessId, input.departmentId));
      const hired = await ctx.db.transaction(async (tx) => {
        const h = await hireFromTemplate(tx, ctx.businessId, input.templateKey, { departmentIds: [department.id], lineManagerId: department.leadAgentId, name: input.name, createdBy: ctx.userId });
        await repos.departments.addMember(tx, ctx.businessId, department.id, { memberKind: "agent", memberId: h.agent.id });
        await audit(tx, ctx, { action: "team.agents.hire", target: { kind: "agent", id: h.agent.id }, details: { templateKey: input.templateKey, departmentId: department.id } });
        return h;
      });
      return hired.agent;
    }),

    release: write.input(z.object({ agentId: Id })).mutation(({ ctx, input }) =>
      ctx.rls(async (tx) => {
        const agent = await repos.agents.get(tx, ctx.businessId, input.agentId);
        if (agent.agentType === "chief_of_staff") throw new ValidationError("The Chief of Staff cannot be released");
        const released = await repos.agents.release(tx, ctx.businessId, input.agentId);
        await audit(tx, ctx, { action: "team.agents.release", target: { kind: "agent", id: released.id } });
        return released;
      }),
    ),

    clone: write.input(z.object({ agentId: Id, name: z.string().min(1).max(80), departmentIds: z.array(Id).optional() })).mutation(async ({ ctx, input }) =>
      ctx.db.transaction(async (tx) => {
        await repos.memberships.get(tx, ctx.businessId, ctx.userId);
        const cloned = await repos.agents.clone(tx, ctx.businessId, input.agentId, { name: input.name, departmentIds: input.departmentIds });
        const skills = await repos.skills.listForAgent(tx, ctx.businessId, input.agentId);
        if (skills.length) await repos.skills.upsertForAgent(tx, ctx.businessId, cloned.id, skills.map((s) => ({ skillKey: s.skillKey, group: s.group, tested: s.tested === null ? null : Number(s.tested), proven: s.proven === null ? null : Number(s.proven), nLive: 0, displayed: s.displayed, potential: s.potential })));
        await audit(tx, ctx, { action: "team.agents.clone", target: { kind: "agent", id: cloned.id }, details: { from: input.agentId } });
        return cloned;
      }),
    ),

    /** Loan between departments: the agent gains (or moves to) another department. */
    loan: write.input(z.object({ agentId: Id, departmentId: Id, move: z.boolean().default(false) })).mutation(({ ctx, input }) =>
      ctx.rls(async (tx) => {
        const agent = await repos.agents.get(tx, ctx.businessId, input.agentId);
        await repos.departments.get(tx, ctx.businessId, input.departmentId);
        const departmentIds = input.move ? [input.departmentId] : [...new Set([...agent.departmentIds, input.departmentId])];
        const updated = await repos.agents.update(tx, ctx.businessId, agent.id, { departmentIds });
        await repos.departments.addMember(tx, ctx.businessId, input.departmentId, { memberKind: "agent", memberId: agent.id }).catch(() => undefined);
        await audit(tx, ctx, { action: "team.agents.loan", target: { kind: "agent", id: agent.id }, details: { departmentId: input.departmentId, move: input.move } });
        return updated;
      }),
    ),
  }),

  humans: router({
    list: read.query(({ ctx }) => ctx.rls((tx) => repos.memberships.list(tx, ctx.businessId))),
    /** Invite by user id (Supabase auth user); e-mail invitations are sent by the web app's auth flow. */
    /** Adds a new member only: an existing member (the owner included) is never overwritten (409; use `role`). */
    invite: adminProcedure.input(z.object({ userId: Id, role: z.enum(MEMBERSHIP_ROLES).default("member"), sectionPermissions: SectionPermissions.default({}), email: z.string().email().optional() })).mutation(({ ctx, input }) =>
      ctx.rls(async (tx) => {
        if (input.role === "owner") throw new ValidationError("Ownership is granted by an owner from Role and permissions, not by invitation");
        if (await repos.memberships.get(tx, ctx.businessId, input.userId)) throw new ConflictError("That person is already a member of this business; change their role instead", { userId: input.userId });
        // Every membership is a seat; the plan tier's seats are a limit (TierLimitError past it).
        await assertSeatAvailable(tx, ctx.business);
        const membership = await repos.memberships.add(tx, ctx.businessId, { userId: input.userId, role: input.role, sectionPermissions: input.sectionPermissions });
        await audit(tx, ctx, { action: "team.humans.invite", target: { kind: "membership", id: membership.id }, details: { userId: input.userId, role: input.role } });
        return membership;
      }),
    ),
    /**
     * Role and section permissions of another member. Nobody edits their own; only an owner changes an owner's row or
     * grants ownership; the last owner keeps the role (the same rules hold in RLS, 0026_membership_guards).
     */
    role: adminProcedure.input(z.object({ userId: Id, role: z.enum(MEMBERSHIP_ROLES).optional(), sectionPermissions: SectionPermissions.optional() })).mutation(({ ctx, input }) =>
      ctx.rls(async (tx) => {
        if (input.userId === ctx.userId) throw new ValidationError("You cannot change your own role or section permissions; another owner or admin can");
        let membership = await repos.memberships.get(tx, ctx.businessId, input.userId);
        if (!membership) throw new ValidationError("Not a member of this business");
        if (ctx.role !== "owner" && membership.role === "owner") throw new ForbiddenError("Only an owner can change an owner's role or permissions");
        if (ctx.role !== "owner" && input.role === "owner") throw new ForbiddenError("Only an owner can grant ownership");
        if (input.role) membership = await repos.memberships.setRole(tx, ctx.businessId, input.userId, input.role);
        if (input.sectionPermissions) membership = await repos.memberships.setSectionPermissions(tx, ctx.businessId, input.userId, input.sectionPermissions);
        await audit(tx, ctx, { action: "team.humans.role", target: { kind: "membership", id: membership.id }, details: { role: input.role ?? null, sections: input.sectionPermissions ? Object.keys(input.sectionPermissions) : [] } });
        return membership;
      }),
    ),
    remove: adminProcedure.input(z.object({ userId: Id })).mutation(({ ctx, input }) =>
      ctx.rls(async (tx) => {
        if (input.userId === ctx.userId) throw new ValidationError("Leave the business from Settings instead of removing yourself");
        const target = await repos.memberships.get(tx, ctx.businessId, input.userId);
        if (target?.role === "owner") throw new ValidationError("The owner cannot be removed");
        await repos.memberships.remove(tx, ctx.businessId, input.userId);
        await audit(tx, ctx, { action: "team.humans.remove", target: { kind: "membership", id: input.userId } });
        return { removed: true };
      }),
    ),
  }),

  responsibilities: router({
    /** Decision types × handler, kept on each department's `approvers` (business-wide when every department agrees). */
    get: read.query(({ ctx }) =>
      ctx.rls(async (tx) => {
        const departments = await repos.departments.list(tx, ctx.businessId);
        const perDepartment = departments.map((d) => ({ departmentId: d.id, rows: parseApprovers(d.approvers) }));
        const matrix = DECISION_TYPES.map((decisionType) => {
          const handlers = perDepartment.map((p) => p.rows.find((r) => r.decisionType === decisionType)?.handler ?? { kind: "founder" as const, id: null });
          const first = handlers[0] ?? { kind: "founder" as const, id: null };
          const uniform = handlers.every((h) => h.kind === first.kind && h.id === first.id);
          return { decisionType, handler: uniform ? first : { kind: "founder" as const, id: null }, uniform };
        });
        return { matrix, perDepartment, decisionTypes: DECISION_TYPES };
      }),
    ),
    set: write.input(z.object({ decisionType: z.enum(DECISION_TYPES), handler: Handler, departmentId: Id.optional() })).mutation(({ ctx, input }) =>
      ctx.rls(async (tx) => {
        if (input.decisionType === "sign_contracts" && input.handler.kind === "agent") throw new ValidationError("Signing is a hard gate: an agent can never handle it (BUILD §2.2)");
        if (input.handler.kind === "agent" && input.handler.id) await repos.agents.get(tx, ctx.businessId, input.handler.id);
        if (input.handler.kind === "user" && input.handler.id && !(await repos.memberships.get(tx, ctx.businessId, input.handler.id))) throw new ValidationError("Handler is not a member");
        const departments = await repos.departments.list(tx, ctx.businessId);
        const targets = input.departmentId ? departments.filter((d) => d.id === input.departmentId) : departments;
        for (const d of targets) {
          const rows = parseApprovers(d.approvers).filter((r) => r.decisionType !== input.decisionType);
          rows.push({ decisionType: input.decisionType, handler: input.handler });
          await repos.departments.update(tx, ctx.businessId, d.id, { approvers: rows });
        }
        await audit(tx, ctx, { action: "team.responsibilities.set", target: { kind: "business", id: ctx.businessId }, details: { decisionType: input.decisionType, handler: input.handler, departments: targets.map((d) => d.id) } });
        return { updated: targets.length };
      }),
    ),
  }),

  /** Approvals routed to humans (BUILD §11.9 "approvers"), resolvable here when the handler is a human. */
  approvals: router({
    pending: read.query(({ ctx }) => ctx.rls((tx) => repos.approvals.pending(tx, ctx.businessId))),
    resolve: write.input(z.object({ approvalId: Id, outcome: z.enum(["approved", "rejected"]), note: z.string().max(2000).optional() })).mutation(({ ctx, input }) =>
      ctx.rls(async (tx) => {
        const before = await repos.approvals.get(tx, ctx.businessId, input.approvalId);
        const approval = await repos.approvals.resolve(tx, ctx.businessId, input.approvalId, { outcome: input.outcome, byKind: "user", byId: ctx.userId });
        if (approval.agentId) {
          await emit(tx, ctx, { type: "approval.resolved", payload: { approvalId: approval.id, planActionId: approval.planActionId, agentId: approval.agentId, outcome: input.outcome, resolvedBy: { kind: "user", id: ctx.userId }, note: input.note ?? null, latencyMs: Math.max(0, Date.now() - before.createdAt.getTime()) } });
        }
        await audit(tx, ctx, { action: "team.approvals.resolve", target: { kind: "approval", id: approval.id }, details: { outcome: input.outcome } });
        return approval;
      }),
    ),
  }),
});
