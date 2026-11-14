/** team.agents.* / team.humans.* / team.responsibilities.* (BUILD §11.9; AC-11.9.2 responsibilities route approvals). */
import { TEMPLATE_KEYS, getTemplate, hasTemplate, listTemplates } from "@foundmill/agents";
import { CREDITS_CURRENCY } from "@foundmill/config";
import { SectionPermissions, membershipEnded, repos, type AgentRosterActivity } from "@foundmill/db";
import { ADMIN_ROLES, DECISION_TYPES, DEFAULT_AGENT_STYLE, ForbiddenError, hasSectionAccess, isOwnerRole, MEMBERSHIP_ROLES, NotFoundError, ValidationError, agentTier, characterFor, leadAgentIds } from "@foundmill/shared";
import { z } from "zod";
import { pendingApprovals, resolveApproval } from "../services/approvals";
import { founderChangeNote, noticeNames, recentlyLowered, refundingOnFailure, takeFounderChange, tellFoundersQuietly, type FounderChangeRefund } from "../services/founder-notices";
import { assertWithinGrantorAccess } from "../services/grants";
import { afterPeopleChange } from "../services/showcase";
import { modelLimited } from "../services/model-limits";
import { ensurePortraits } from "../services/personas";
import { archivePlaybook, compilePlaybookText, createPlaybook, setPlaybookEnabled, toPlaybookView, updatePlaybook } from "../services/playbooks";
import { SkillChoice, SkillFileUpload, attachSkills, libraryView, resolveSkillChoice, uploadPreview } from "../services/skills";
import { hireFromTemplate, shownToolGrants } from "../services/squad";
import { SIGNALS, workflowIds } from "../services/temporal";
import { Id, audit, businessProcedure, emit, router, sectionAdmin, sectionRead, sectionWrite, writeProcedure } from "../trpc";

const read = sectionRead("team");
const write = sectionWrite("team");
/** Staff and their permissions: owners and admins who may write to the Team section (a wall on Team holds for admins too). */
const staffAdmin = sectionAdmin("team");
const admin = staffAdmin;

const Handler = z.object({ kind: z.enum(["founder", "user", "agent"]), id: Id.nullable().default(null) });
const Responsibility = z.object({ decisionType: z.enum(DECISION_TYPES), handler: Handler });
type ResponsibilityRow = z.infer<typeof Responsibility>;

const parseApprovers = (raw: unknown): ResponsibilityRow[] => (Array.isArray(raw) ? raw.map((r) => Responsibility.safeParse(r)).filter((r) => r.success).map((r) => r.data) : []);

/** An agent's latest update for the Team table: what its open session works on, or how its last session ended. */
export function latestUpdate(latest: NonNullable<AgentRosterActivity["latest"]>): { at: Date; text: string } {
  const task = latest.taskTitle ? `“${latest.taskTitle}”` : "a session";
  if (latest.open) return { at: latest.startedAt, text: `Working on ${task}` };
  const at = latest.endedAt ?? latest.startedAt;
  switch (latest.outcome) {
    case "done":
    case "completed":
      return { at, text: `Finished ${task}` };
    case "blocked":
      return { at, text: `Blocked on ${task}` };
    case "failed":
    case "failure":
      return { at, text: `Failed on ${task}` };
    default:
      return { at, text: `Stopped ${task}` };
  }
}

export const teamRouter = router({
  /**
   * The faces of anthropomorphic agents. `ensure` (any member of the business: the faces show in the shell, so it is not a
   * Team-section permission) says which of the business's agents' persona keys have a portrait in the caller's own
   * character style (`ctx.agentStyle`, their account preference; humans until chosen), and starts generating the missing
   * ones in the background (services/personas.ts: deduped, three at a time, never awaited, with a backoff shared across
   * replicas). `{ style, ready, pending, failed }`: `style` is the one the answer is about, `failed` holds the keys refused
   * for good (moderation, a key the gateway does not know), which are not tried again. The web polls it until `pending`
   * is empty, loads each ready face from `GET /personas/:style/:key` and keeps the drawn portrait for a failed one. Keys
   * are read from this business's own agents under RLS; the input carries nothing but the business, so a caller cannot
   * ask for a key of another business, nor for a style other than their own. `names` is each key's first name in that
   * style (the shared character catalog), for a client without the catalog (the mobile app, Nov 11, 2026): with
   * Anthropomorphic agents on, an agent reads "<names[personaKey]> (<role>)", else by its stored name.
   */
  personas: router({
    ensure: businessProcedure.query(async ({ ctx }) => {
      const agents = await ctx.rls((tx) => repos.agents.list(tx, ctx.businessId, { limit: 500 }));
      const keys = [...new Set(agents.items.map((a) => a.personaKey).filter((k): k is string => typeof k === "string"))];
      const style = ctx.agentStyle ?? DEFAULT_AGENT_STYLE;
      const status = await ensurePortraits(ctx, keys, { businessId: ctx.businessId, style });
      const names = Object.fromEntries(keys.flatMap((k) => { const c = characterFor(k, style); return c ? [[k, c.name] as const] : []; }));
      return { style, ...status, names };
    }),
  }),

  /**
   * The skills library and skill-file previews (founder request 2026-10-16): the hire dialog's Skills step and the
   * profile's Skills from the library or files panel. Adding happens in team.agents.hire and agent.skills.add.
   */
  skills: router({
    /** The curated, read-only catalog: every skill with its category, the attribute it shows as and its instructions. */
    library: read.query(() => libraryView()),
    /** Parses and screens a skill file without storing it: the preview, or a 400 that says what to change. */
    preview: write.input(SkillFileUpload).mutation(({ input }) => uploadPreview(input)),
  }),

  agents: router({
    /**
     * Squad table rows (BUILD §11.9): agent, role, departments, status, current task, skills, the rating (`rating20`,
     * the 1–20 mean of the skills to one decimal; `rating` is its deprecated 1–10 form, kept one release), model, wage,
     * and what the Tools, Health and Performance views show: the live version's tool grants, the form (last five
     * session outcomes, oldest first), the latest update (its latest session), the health behind the status (the last
     * `agent.health_changed`: reason, signals, expected return; heartbeat and error rate from its sessions) and whether
     * it is the business's Chief of Staff (the one agent that cannot be released or cloned).
     */
    list: read.input(z.object({ departmentId: Id.optional(), includeArchived: z.boolean().default(false) })).query(({ ctx, input }) =>
      ctx.rls(async (tx) => {
        const period = new Date().toISOString().slice(0, 7);
        const [agents, running, wages, departments] = await Promise.all([
          repos.agents.list(tx, ctx.businessId, { ...input, limit: 500 }),
          repos.tasks.list(tx, ctx.businessId, { status: ["running", "paused", "blocked", "review"], limit: 500 }),
          repos.usage.wages(tx, ctx.businessId, period),
          repos.departments.list(tx, ctx.businessId),
        ]);
        const ids = agents.items.map((a) => a.id);
        // Each of these reads every agent at once, in parallel: skills, live versions, sessions, health events.
        const [skillsByAgent, versions, activity, health] = await Promise.all([
          repos.skills.listForAgents(tx, ctx.businessId, ids),
          repos.agents.versionsByIds(tx, ctx.businessId, agents.items.map((a) => a.currentVersionId).filter((v): v is string => v !== null)),
          repos.agents.rosterActivity(tx, ctx.businessId, ids),
          repos.events.latestPerAgent(tx, ctx.businessId, "agent.health_changed", ids),
        ]);
        // The Chief of Staff is the oldest live assistant (`repos.agents.chiefOfStaff`); `list` is oldest first too.
        const chiefId = agents.items.find((a) => a.layer === "assistant" && !a.archivedAt)?.id ?? null;
        // Leads first (packages/shared team-tiers): chief, lead, specialist or background, from what is stored.
        const leads = leadAgentIds(departments);
        const rows = agents.items.map((a) => {
          const skills = skillsByAgent.get(a.id) ?? [];
          // One rating scale everywhere (founder, Oct 20, 2026): `rating20` is the 1–20 mean of the displayed skills
          // to one decimal, what the Team table and the profile header show. `rating` is the same mean on a 1–10 scale,
          // deprecated and kept for one release so older clients keep working; read `rating20`.
          const mean = skills.length ? skills.reduce((s, k) => s + k.displayed, 0) / skills.length : null;
          const rating20 = mean === null ? null : Math.round(mean * 10) / 10;
          const rating = mean === null ? null : Math.round(mean * 5) / 10;
          const seen = activity.get(a.id);
          const last = health.get(a.id);
          const changed = last ? (last.payload as { to?: string; reason?: string; signals?: { loopDetected?: boolean; credentialExpired?: boolean; rateLimited?: boolean }; expectedReturnAt?: string | null }) : null;
          // The last health event explains the status only while the agent still has that status.
          const explains = changed && changed.to === a.status ? changed : null;
          const tools = versions.find((v) => v.id === a.currentVersionId)?.tools;
          return {
            ...a,
            departments: departments.filter((d) => a.departmentIds.includes(d.id)).map((d) => ({ id: d.id, name: d.name, colourToken: d.colourToken })),
            currentTask: running.items.find((t) => t.assigneeAgentId === a.id) ?? null,
            skills,
            rating20,
            /** @deprecated The 1–10 form of `rating20`; dropped next release. */
            rating,
            wage: { costMinor: wages.find((w) => w.agentId === a.id)?.costMinor ?? 0, currency: CREDITS_CURRENCY, capMinor: a.wageCapMinor, period, label: "Estimate" as const },
            chiefOfStaff: a.id === chiefId,
            tier: agentTier({ ...a, chiefOfStaff: a.layer === "assistant" ? a.id === chiefId : undefined }, leads),
            // Only grants that resolve to a tool: a version hired before Nov 11, 2026 may still list connectors that were never built.
            tools: shownToolGrants(tools),
            form: seen?.form ?? [],
            latestUpdate: seen?.latest ? latestUpdate(seen.latest) : null,
            health: {
              lastHeartbeatAt: seen?.lastActivityAt ?? null,
              errorRate: seen && seen.sessions24h > 0 ? seen.failed24h / seen.sessions24h : null,
              loopDetected: explains?.signals?.loopDetected ?? false,
              credentialExpired: explains?.signals?.credentialExpired ?? false,
              rateLimited: explains?.signals?.rateLimited ?? false,
              expectedReturnAt: explains?.expectedReturnAt ?? null,
              reason: explains?.reason ?? null,
            },
            expectedReturnAt: a.status === "injured" ? (explains?.expectedReturnAt ?? null) : null,
          };
        });
        return { agents: rows, templates: TEMPLATE_KEYS };
      }),
    ),

    /**
     * The templates a founder can hire (the Chief of Staff joins with the business and is never hired again). The
     * utility family (the background helpers every business already runs) is left out unless asked for by name.
     */
    catalogue: read.input(z.object({ family: z.enum(["assistant", "lead", "worker", "channel", "specialist", "utility"]).optional() })).query(({ input }) =>
      listTemplates(input ?? {})
        .filter((t) => t.family !== "assistant" && (t.family !== "utility" || input?.family === "utility"))
        .map((t) => ({ key: t.key, name: t.name, role: t.role, family: t.family, layer: t.layer, module: t.module, channelKey: t.channelKey ?? null, modelKey: t.modelKey, description: t.description, skills: t.skills, wageCapMinor: t.wageCapMinor, wageLabel: "Estimate" as const, traits: t.traits })),
    ),

    /**
     * Hire from the catalogue into a department (agent_skills is service-written, so this runs on the service db), with
     * any skills chosen in the hire dialog's Skills step (library keys or skill files). Files are parsed and screened
     * again here, before anything is written, so a refused file hires nobody; the agent and its skills land together.
     */
    hire: write
      .input(z.object({ templateKey: z.string().min(1).refine(hasTemplate, "Unknown agent template"), departmentId: Id, name: z.string().min(1).max(80).optional(), skills: z.array(SkillChoice).max(8).default([]) }))
      .mutation(async ({ ctx, input }) => {
        // One Chief of Staff per business: it joins with the business and plans every cycle.
        if (getTemplate(input.templateKey).family === "assistant") throw new ValidationError("A business has one Chief of Staff; it joins with the business and cannot be hired again");
        const department = await ctx.rls((tx) => repos.departments.get(tx, ctx.businessId, input.departmentId));
        if (department.archivedAt) throw new ValidationError(`${department.name} has been archived; hire into a live department`);
        const skills = input.skills.map(resolveSkillChoice);
        const hired = await ctx.db.transaction(async (tx) => {
          // A new hire reports to the department's lead, never to an agent that has left the team.
          const lead = department.leadAgentId ? (await repos.agents.byIds(tx, ctx.businessId, [department.leadAgentId]))[0] : undefined;
          const h = await hireFromTemplate(tx, ctx.businessId, input.templateKey, { departmentIds: [department.id], lineManagerId: lead && !lead.archivedAt ? lead.id : null, name: input.name, createdBy: ctx.userId });
          await repos.departments.addMember(tx, ctx.businessId, department.id, { memberKind: "agent", memberId: h.agent.id });
          await audit(tx, ctx, { action: "team.agents.hire", target: { kind: "agent", id: h.agent.id }, details: { templateKey: input.templateKey, departmentId: department.id, skills: skills.map((s) => s.skillKey) } });
          await attachSkills(tx, ctx, h.agent, skills);
          return h;
        });
        return hired.agent;
      }),

    /**
     * Release: the agent leaves the team (archived, paused). Its open tasks are handed back (unassigned; the ones it
     * was working on return to ready), a department it led has no lead until the founder picks one, its reports move to
     * its own line manager, and its open sessions are told to stop. The business's Chief of Staff cannot be released.
     * Runs on the service db after the team-write check, so a member's release clears a department lead as well.
     */
    release: write.input(z.object({ agentId: Id })).mutation(async ({ ctx, input }) => {
      const { agent, handedBack, sessionIds } = await ctx.db.transaction(async (tx) => {
        const before = await repos.agents.get(tx, ctx.businessId, input.agentId);
        if (before.archivedAt) return { agent: before, handedBack: [] as string[], sessionIds: [] as string[] };
        const chief = await repos.agents.chiefOfStaff(tx, ctx.businessId);
        if (chief?.id === before.id) throw new ValidationError("The Chief of Staff plans every cycle and cannot be released");
        const open = await repos.agents.listSessions(tx, ctx.businessId, { agentId: before.id, openOnly: true, limit: 100 });
        const tasks = await repos.tasks.handBack(tx, ctx.businessId, before.id);
        const released = await repos.agents.release(tx, ctx.businessId, before.id);
        if (before.status !== "paused") await emit(tx, ctx, { type: "agent.health_changed", payload: { agentId: before.id, from: before.status, to: "paused", reason: `${before.name} was released from the team`, signals: {}, sessionId: null } });
        await audit(tx, ctx, { action: "team.agents.release", target: { kind: "agent", id: released.id }, details: { tasks: tasks.map((t) => ({ id: t.task.id, from: t.from })), sessions: open.items.map((s) => s.id) } });
        return { agent: released, handedBack: tasks.map((t) => t.task.id), sessionIds: open.items.map((s) => s.id) };
      });
      // Its open sessions end now; the workflow id is always computed from the session id (contract 1).
      const stopped = sessionIds.length ? await ctx.temporal.signalMany(sessionIds.map((id) => workflowIds.session(id)), SIGNALS.stop, [{ reason: "released", by: ctx.userId }]) : null;
      return { ...agent, handedBack, sessions: { stopping: sessionIds.length, signalled: stopped?.signalled.length ?? 0 } };
    }),

    /** Clone any agent but the Chief of Staff (one per business). */
    clone: write.input(z.object({ agentId: Id, name: z.string().min(1).max(80), departmentIds: z.array(Id).optional() })).mutation(async ({ ctx, input }) =>
      ctx.db.transaction(async (tx) => {
        // The repo refuses a department that is not this business's. A clone joins the departments it is filed under as
        // a hire does, so department rosters and merges see it (audit ARB-24).
        const source = await repos.agents.get(tx, ctx.businessId, input.agentId);
        if (source.agentType === "chief_of_staff" || source.layer === "assistant") throw new ValidationError("A business has one Chief of Staff; it cannot be cloned");
        if (source.archivedAt) throw new ValidationError(`${source.name} has left the team and cannot be cloned`);
        const cloned = await repos.agents.clone(tx, ctx.businessId, input.agentId, { name: input.name, departmentIds: input.departmentIds });
        await repos.departments.addMembers(tx, ctx.businessId, cloned.departmentIds.map((departmentId) => ({ departmentId, memberKind: "agent" as const, memberId: cloned.id })));
        const skills = await repos.skills.listForAgent(tx, ctx.businessId, input.agentId);
        if (skills.length) await repos.skills.upsertForAgent(tx, ctx.businessId, cloned.id, skills.map((s) => ({ skillKey: s.skillKey, group: s.group, tested: s.tested === null ? null : Number(s.tested), proven: s.proven === null ? null : Number(s.proven), nLive: 0, displayed: s.displayed, potential: s.potential })));
        await audit(tx, ctx, { action: "team.agents.clone", target: { kind: "agent", id: cloned.id }, details: { from: input.agentId } });
        return cloned;
      }),
    ),

    /**
     * Loan between departments: the agent gains (or moves to) another department. A move also makes the new
     * department's lead the agent's line manager (no lead: it reports to the founder), so the hierarchy follows it.
     */
    loan: write.input(z.object({ agentId: Id, departmentId: Id, move: z.boolean().default(false) })).mutation(({ ctx, input }) =>
      ctx.rls(async (tx) => {
        const agent = await repos.agents.get(tx, ctx.businessId, input.agentId);
        const department = await repos.departments.get(tx, ctx.businessId, input.departmentId);
        if (department.archivedAt) throw new ValidationError(`${department.name} has been archived; choose a live department`);
        const departmentIds = input.move ? [input.departmentId] : [...new Set([...agent.departmentIds, input.departmentId])];
        const lead = input.move && department.leadAgentId && department.leadAgentId !== agent.id ? (await repos.agents.byIds(tx, ctx.businessId, [department.leadAgentId]))[0] : undefined;
        const lineManagerId = input.move ? (lead && !lead.archivedAt ? lead.id : null) : undefined;
        const updated = await repos.agents.update(tx, ctx.businessId, agent.id, { departmentIds, ...(lineManagerId !== undefined ? { lineManagerId } : {}) });
        await repos.departments.addMember(tx, ctx.businessId, input.departmentId, { memberKind: "agent", memberId: agent.id }).catch(() => undefined);
        await audit(tx, ctx, { action: "team.agents.loan", target: { kind: "agent", id: agent.id }, details: { departmentId: input.departmentId, move: input.move, ...(lineManagerId !== undefined ? { lineManagerId } : {}) } });
        return updated;
      }),
    ),
  }),

  humans: router({
    /**
     * Staff with their name and CRM record (`team_member` whose identifiers name the account); the signed-in member's
     * own founder profile names them when the CRM has no record. Never an auth id dressed up as a CRM link.
     */
    list: read.query(({ ctx }) =>
      ctx.rls(async (tx) => {
        const [members, me] = await Promise.all([repos.memberships.listNamed(tx, ctx.businessId), repos.founders.get(tx, ctx.userId)]);
        return members.map((m) => (m.displayName === null && m.userId === ctx.userId && me?.displayName ? { ...m, displayName: me.displayName } : m));
      }),
    ),
    // Adding someone is an invitation they accept (`invitation.create` / `accept`, routers/people.ts; THESIS_REVIEW
    // package 3.1): the silent add by email or account id (`team.humans.invite`) was removed with it.
    /**
     * Role, section permissions and (a collaborator's only) the date access ends, of another member. Nobody edits their
     * own; only someone with an owner's standing (an owner or a cofounder, THESIS_REVIEW 3.3) changes such a row or
     * grants that standing; the last owner or cofounder keeps it (the same rules hold in RLS, 0026 and 0092). Someone
     * without that standing gives no more than their own access (`assertWithinGrantorAccess`; the api's rule alone, as
     * the section walls are: no policy reads section permissions).
     */
    role: staffAdmin
      .input(z.object({ userId: Id, role: z.enum(MEMBERSHIP_ROLES).optional(), sectionPermissions: SectionPermissions.optional(), expiresAt: z.coerce.date().nullable().optional() }))
      .mutation(async ({ ctx, input }) => {
        const names = await noticeNames(ctx.db, ctx.userId, input.userId);
        // The founder change taken below is given back when the transaction fails after it (final review, P3).
        const refund: { current: FounderChangeRefund | null } = { current: null };
        // A founder's role changed: a showcase ask about the project is checked again (services/showcase.ts).
        const changed = await refundingOnFailure(refund, () => afterPeopleChange(ctx, ctx.rls(async (tx) => {
          if (input.userId === ctx.userId) throw new ValidationError("You cannot change your own role or section permissions; another owner or admin can");
          // Judged on fresh rows, not on the request's: the business's people changes take turns (the owner lock, as
          // `setRole` and `remove` take it), the editor's own row is re-read under a share lock and the person's under an
          // update lock, so an owner lowering this editor at the same moment is either seen here or waits for it.
          await repos.memberships.lockOwners(tx, ctx.businessId);
          const editor = await repos.memberships.getMineForShare(tx, ctx.businessId, ctx.userId);
          if (!editor || !ADMIN_ROLES.includes(editor.role) || !hasSectionAccess(editor, "team", "write")) throw new ForbiddenError("You can no longer change people's access in this business");
          const locked = await repos.memberships.getForUpdate(tx, ctx.businessId, input.userId);
          let membership = locked ?? (await repos.memberships.get(tx, ctx.businessId, input.userId));
          if (!membership) throw new ValidationError("Not a member of this business");
          const fromRole = membership.role;
          if (!isOwnerRole(editor.role) && isOwnerRole(membership.role)) throw new ForbiddenError("Only an owner or a cofounder can change an owner's or a cofounder's role or permissions");
          if (!isOwnerRole(editor.role) && input.role && isOwnerRole(input.role)) throw new ForbiddenError("Only an owner or a cofounder can make someone an owner or a cofounder");
          // RLS let the row be read but not locked: it is not this editor's to change.
          if (!locked) throw new ForbiddenError("You cannot change this person's access");
          // Nor past the editor's own access: no section above their own level on it and no role above theirs (an
          // owner's standing is not limited); narrowing and lowering stay free (services/grants.ts). A collaborator whose
          // access ended has none now, so a new date gives everything the row holds and is judged as a grant.
          assertWithinGrantorAccess(editor, { role: input.role ?? membership.role, sectionPermissions: input.sectionPermissions ?? membership.sectionPermissions }, membershipEnded(membership) ? null : membership);
          // One person lowers a founder's role at most so often a day in a project (second review, P1-1).
          if (isOwnerRole(fromRole) && input.role && !isOwnerRole(input.role)) refund.current = await takeFounderChange(ctx, "lower");
          if (input.role) membership = await repos.memberships.setRole(tx, ctx.businessId, input.userId, input.role);
          if (input.sectionPermissions) membership = await repos.memberships.setSectionPermissions(tx, ctx.businessId, input.userId, input.sectionPermissions);
          if (input.expiresAt !== undefined) {
            if (input.expiresAt && input.expiresAt.getTime() <= Date.now()) throw new ValidationError("Choose a date after today, or remove the person instead");
            membership = await repos.memberships.setExpiry(tx, ctx.businessId, input.userId, input.expiresAt);
          }
          // `userId` and `fromRole` let the gateway read a founder notice from this entry (security review P2-3).
          const entry = await audit(tx, ctx, { action: "team.humans.role", target: { kind: "membership", id: membership.id }, details: { userId: input.userId, fromRole, role: input.role ?? null, sections: input.sectionPermissions ? Object.keys(input.sectionPermissions) : [], ...(input.expiresAt !== undefined ? { expiresAt: input.expiresAt?.toISOString() ?? null } : {}) } });
          // apps/stream re-checks the member's open subscriptions at once, under the new walls.
          await emit(tx, ctx, { type: "membership.changed", payload: { userId: input.userId, change: "updated" } });
          // A founder's standing taken away: the Inbox tells the other founders (never only the one who did it).
          const lowered = isOwnerRole(fromRole) && !isOwnerRole(membership.role);
          if (lowered) await founderChangeNote(tx, { names, businessId: ctx.businessId, actorUserId: ctx.userId, subjectUserId: input.userId, notice: "role_changed", fromRole, toRole: membership.role, timeZone: ctx.business.timeZone });
          return { membership, auditId: entry.id, lowered };
        })));
        // Every founder and the person themselves hear it by email, once the change has committed.
        if (changed.lowered) await tellFoundersQuietly(ctx, { businessId: ctx.businessId, auditId: changed.auditId, notice: "role_changed", actorUserId: ctx.userId, subjectUserId: input.userId });
        return changed.membership;
      }),
    /**
     * Removes a member. A founder is stepped down first (their role changed), then removed; a person whose founder's
     * standing someone else took away in the last 30 days counts as a founder removed (security review P2-3): the entry
     * names the role they had (`formerRole`), the other founders get an Inbox note, and every founder and the person
     * removed are emailed.
     */
    remove: staffAdmin.input(z.object({ userId: Id })).mutation(async ({ ctx, input }) => {
      const [names, lowered] = await Promise.all([noticeNames(ctx.db, ctx.userId, input.userId), recentlyLowered(ctx.db, ctx.businessId, input.userId)]);
      // Someone left the project: a showcase ask about it is checked again (services/showcase.ts).
      const removed = await afterPeopleChange(ctx, ctx.rls(async (tx) => {
        if (input.userId === ctx.userId) throw new ValidationError("Leave the business from Settings instead of removing yourself");
        const target = await repos.memberships.get(tx, ctx.businessId, input.userId);
        // An owner's standing is stepped down first (an owner or a cofounder changes the role), then removed.
        if (target && isOwnerRole(target.role)) throw new ValidationError(target.role === "cofounder" ? "A cofounder cannot be removed; another founder changes their role first" : "The owner cannot be removed");
        const lately = target ? lowered : null;
        await repos.memberships.remove(tx, ctx.businessId, input.userId);
        // `userId`, the role and the founder's role they had lately let the gateway read a founder notice from this entry.
        const entry = await audit(tx, ctx, { action: "team.humans.remove", target: { kind: "membership", id: input.userId }, details: { userId: input.userId, role: target?.role ?? null, ...(lately ? { formerRole: lately } : {}) } });
        // apps/stream closes the removed person's open subscriptions to this business at once.
        if (target) await emit(tx, ctx, { type: "membership.changed", payload: { userId: input.userId, change: "removed" } });
        if (lately) await founderChangeNote(tx, { names, businessId: ctx.businessId, actorUserId: ctx.userId, subjectUserId: input.userId, notice: "removed", fromRole: lately, timeZone: ctx.business.timeZone });
        return { auditId: entry.id, wasFounder: lately !== null };
      }));
      if (removed.wasFounder) await tellFoundersQuietly(ctx, { businessId: ctx.businessId, auditId: removed.auditId, notice: "removed", actorUserId: ctx.userId, subjectUserId: input.userId });
      return { removed: true };
    }),
  }),

  responsibilities: router({
    /**
     * Decision types × handler, kept on each department's `approvers` (business-wide when every department agrees), and
     * the business's Chief of Staff (`chiefOfStaffId`, null before one is hired): Settings › What the team can do offers
     * "The Chief of Staff approves" for publishing and messaging customers, which writes that agent as the handler.
     */
    get: read.query(({ ctx }) =>
      ctx.rls(async (tx) => {
        const [departments, chief] = await Promise.all([repos.departments.list(tx, ctx.businessId), repos.agents.chiefOfStaff(tx, ctx.businessId)]);
        const perDepartment = departments.map((d) => ({ departmentId: d.id, rows: parseApprovers(d.approvers) }));
        const matrix = DECISION_TYPES.map((decisionType) => {
          const handlers = perDepartment.map((p) => p.rows.find((r) => r.decisionType === decisionType)?.handler ?? { kind: "founder" as const, id: null });
          const first = handlers[0] ?? { kind: "founder" as const, id: null };
          const uniform = handlers.every((h) => h.kind === first.kind && h.id === first.id);
          return { decisionType, handler: uniform ? first : { kind: "founder" as const, id: null }, uniform };
        });
        return { matrix, perDepartment, decisionTypes: DECISION_TYPES, chiefOfStaffId: chief?.id ?? null };
      }),
    ),
    /**
     * Who handles a decision type, in one department or all. Changing who approves is an owner's or admin's call (a
     * member could otherwise hand approvals to themselves), and departments are written by owners and admins only.
     */
    set: admin.input(z.object({ decisionType: z.enum(DECISION_TYPES), handler: Handler, departmentId: Id.optional() })).mutation(({ ctx, input }) =>
      ctx.rls(async (tx) => {
        if (input.decisionType === "sign_contracts" && input.handler.kind === "agent") throw new ValidationError("Signing is a hard gate: an agent can never handle it (BUILD §2.2)");
        if (input.handler.kind !== "founder" && !input.handler.id) throw new ValidationError("Name the staff member or agent who handles it");
        if (input.handler.kind === "agent" && input.handler.id) {
          const agent = await repos.agents.get(tx, ctx.businessId, input.handler.id);
          if (agent.archivedAt) throw new ValidationError(`${agent.name} has left the team`);
        }
        // One of the project's people now: a collaborator whose access ended is not (0092).
        if (input.handler.kind === "user" && input.handler.id && !(await repos.memberships.getActive(tx, ctx.businessId, input.handler.id))) throw new ValidationError("Handler is not a member");
        const departments = await repos.departments.list(tx, ctx.businessId);
        const targets = input.departmentId ? departments.filter((d) => d.id === input.departmentId) : departments;
        // A department outside the business, archived or hidden since the page loaded: say so, never "saved" for nothing.
        if (input.departmentId && targets.length === 0) throw new NotFoundError("department", input.departmentId);
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

  /**
   * Approvals routed to humans (BUILD §11.9 "approvers"), resolvable here when the handler is a human. Answering one
   * here is the same as on its Inbox item (services/approvals.ts): the decision reaches the session or wait that asked,
   * and the person needs write on the section the call changes (the service checks it), not on Team.
   */
  approvals: router({
    pending: read.input(z.object({ forMe: z.boolean().default(false) })).query(({ ctx, input }) =>
      ctx.rls(async (tx) => {
        const rows = await pendingApprovals(tx, ctx);
        return input.forMe ? rows.filter((a) => a.forMe) : rows;
      }),
    ),
    resolve: writeProcedure.input(z.object({ approvalId: Id, outcome: z.enum(["approved", "rejected"]), note: z.string().max(2000).optional() })).mutation(({ ctx, input }) => resolveApproval(ctx, input)),
  }),

  /**
   * Playbooks (BUILD §11.13): standing rules written in plain words. `compile` shows the flow (trigger, steps, approvals,
   * stop) without saving; `create` saves it off; the founder edits it and turns it on with `setEnabled`.
   */
  playbooks: router({
    list: read.query(({ ctx }) => ctx.rls(async (tx) => ({ playbooks: (await repos.playbooks.list(tx, ctx.businessId)).map(toPlaybookView) }))),
    compile: write.input(z.object({ text: z.string().trim().min(3).max(2000) })).use(modelLimited("plan")).mutation(({ ctx, input }) => compilePlaybookText(ctx, input.text)),
    create: write.input(z.object({ name: z.string().trim().max(120).optional(), sourceText: z.string().trim().min(1).max(2000), flow: z.unknown(), departmentId: Id.nullable().optional() })).mutation(({ ctx, input }) => createPlaybook(ctx, input)),
    update: write.input(z.object({ id: Id, name: z.string().trim().min(1).max(120).optional(), flow: z.unknown().optional() })).mutation(({ ctx, input }) => updatePlaybook(ctx, input)),
    setEnabled: write.input(z.object({ id: Id, enabled: z.boolean() })).mutation(({ ctx, input }) => setPlaybookEnabled(ctx, input.id, input.enabled)),
    archive: write.input(z.object({ id: Id })).mutation(({ ctx, input }) => archivePlaybook(ctx, input.id)),
  }),
});
