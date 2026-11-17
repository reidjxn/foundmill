/** crm.search/entity.list/get/update/merge/unmerge/create/requestDeletion/notes/roles (BUILD §11.12; AC-11.12.2 via RLS, AC-11.12.3 merge/unmerge). */
import { INPUT_LIMITS } from "@foundmill/config";
import { AddRoleInput, EntityListFilter, STRONG_IDENTIFIERS, SearchInput, UpdateEntityInput, repos } from "@foundmill/db";
import { AppError, boundedRecord, hasSectionAccess, REPLY_ANSWER_MAX } from "@foundmill/shared";
import { z } from "zod";
import { Id, audit, router, sectionRead, sectionWrite } from "../trpc";
import { answerReply, listReplies } from "../services/replies";
import { modelLimited } from "../services/model-limits";

const read = sectionRead("crm");
/** Deletion requests complete no earlier than this (matches Settings › Danger zone). */
const DELETION_DELAY_DAYS = 7;
const write = sectionWrite("crm");
/** "Oct 7, 2026" (US English, UTC so the note reads the same wherever it is written). */
const usDate = (d: Date): string => d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });

export const crmRouter = router({
  /** Hybrid typeahead (pg_trgm names, tsvector notes, pgvector meaning) with the BUILD §11.12 operators. */
  search: read.input(SearchInput).query(({ ctx, input }) => ctx.rls((tx) => repos.entities.search(tx, ctx.businessId, input))),

  entity: router({
    /**
     * Hover cards and links for entity mentions (audit GTM-26, VFR3-X1): the records behind up to 50 ids, each with its
     * kind, active roles and contact facts, and for an agent's record the agent it stands for (an agent's mention opens
     * the agent's profile, not a CRM record). Ids that are not records of this business are left out.
     */
    lookup: read.input(z.object({ entityIds: z.array(Id).min(1).max(50) })).query(({ ctx, input }) =>
      ctx.rls(async (tx) => {
        const rows = await repos.entities.byIds(tx, ctx.businessId, [...new Set(input.entityIds)]);
        const agentIds = rows.flatMap((e) => (e.agentId ? [e.agentId] : []));
        const [roles, personaKeys] = await Promise.all([repos.entities.activeRoles(tx, ctx.businessId, rows.map((e) => e.id)), repos.agents.personaKeysByIds(tx, ctx.businessId, agentIds)]);
        const text = (v: unknown) => (typeof v === "string" && v ? v : null);
        return rows.map((e) => ({
          id: e.id,
          kind: e.kind,
          displayName: e.displayName,
          agentId: e.agentId,
          /** An agent record's persona (anthropomorphic agents, 0067): this business's agent only; null otherwise. */
          personaKey: e.agentId ? (personaKeys.get(e.agentId) ?? null) : null,
          avatarUrl: e.avatarUrl,
          mergedIntoId: e.mergedIntoId,
          email: text(e.identifiers?.email),
          domain: text(e.identifiers?.domain),
          roles: (roles.get(e.id) ?? []).map((r) => ({ role: r.role, stage: r.stage })),
        }));
      }),
    ),
    /**
     * The CRM list without a search term (newest first, keyset paged). Every row carries its active roles (role, stage,
     * owner) for the role and stage views; role, stage, owner and department filters match those roles server-side.
     */
    list: read.input(EntityListFilter).query(({ ctx, input }) => ctx.rls((tx) => repos.entities.listWithRoles(tx, ctx.businessId, { ...input, limit: Math.min(input?.limit ?? 100, 500) }))),
    /** How many records the same filters list (without paging): the CRM footer's true total. */
    count: read.input(EntityListFilter.omit({ cursor: true, limit: true, offset: true })).query(({ ctx, input }) => ctx.rls(async (tx) => ({ total: await repos.entities.count(tx, ctx.businessId, input ?? {}) }))),
    /**
     * GDPR-style deletion request (audit RA-23): at once, every contact identifier of the record goes on the business's
     * suppression list (the gateway refuses outreach to it and no engine imports it again) and the record is flagged
     * `deletion_requested_at`; the orchestrator's nightly `crmDeletionSweep` purges it once the delay has passed. Nothing
     * is deleted by agent or API code. Recorded on the profile (interaction note) and the audit chain with who asked,
     * when and the earliest completion date; a repeated request keeps the first dates and adds nothing.
     */
    requestDeletion: write.input(z.object({ entityId: Id, reason: z.string().max(1000).optional() })).mutation(({ ctx, input }) =>
      ctx.rls(async (tx) => {
        const requested = await repos.entities.requestDeletion(tx, ctx.businessId, input.entityId, { delayDays: DELETION_DELAY_DAYS });
        const entity = requested.entity;
        const requestedAt = entity.deletionRequestedAt ?? new Date();
        const earliestAt = entity.deletionDueAt ?? new Date(requestedAt.getTime() + DELETION_DELAY_DAYS * 86_400_000);
        let interactionId: string | null = null;
        if (!requested.already) {
          const note = `Deletion requested by ${ctx.email ?? ctx.userId} on ${usDate(requestedAt)}; earliest completion ${usDate(earliestAt)}. Outreach to this person is suppressed from now on.${input.reason ? ` Reason: ${input.reason}` : ""}`;
          interactionId = (await repos.entities.addNote(tx, ctx.businessId, entity.id, note)).id;
          await audit(tx, ctx, { action: "crm.entity.request_deletion", target: { kind: "entity", id: entity.id }, details: { reason: input.reason ?? null, requestedAt: requestedAt.toISOString(), earliestAt: earliestAt.toISOString(), interactionId, suppressed: requested.suppressed } });
        }
        return { entityId: entity.id, status: "requested" as const, requestedAt: requestedAt.toISOString(), earliestAt: earliestAt.toISOString(), delayDays: DELETION_DELAY_DAYS, interactionId, suppressed: requested.suppressed, already: requested.already };
      }),
    ),
    get: read.input(z.object({ entityId: Id })).query(({ ctx, input }) =>
      ctx.rls(async (tx) => {
        const entity = await repos.entities.resolve(tx, ctx.businessId, input.entityId);
        const [profile, roles, relationships, interactions, mentions, journeys, mergeHistory, consents] = await Promise.all([
          repos.entities.profile(tx, ctx.businessId, entity.id),
          repos.entities.listRoles(tx, ctx.businessId, entity.id, { includeEnded: true }),
          repos.entities.listRelationships(tx, ctx.businessId, entity.id),
          repos.entities.listInteractions(tx, ctx.businessId, { entityId: entity.id, limit: 50 }),
          repos.entities.listMentions(tx, ctx.businessId, entity.id, 50),
          repos.journeys.listConversions(tx, ctx.businessId, { entityId: entity.id, limit: 50 }),
          repos.entities.mergeHistory(tx, ctx.businessId, entity.id),
          repos.followers.consentStates(tx, ctx.businessId, [entity.id]),
        ]);
        // Each win carries its Customer Update id (null when it has none), so Re-watch and Activity link straight to it.
        // A payment's amount is Finance's: a reader walled off Finance (a collaborator among them) gets it as null and
        // `moneyHidden`, so the Commercial tab says the figures are hidden rather than show a total of nothing.
        const moneyHidden = !hasSectionAccess(ctx.membership, "finance", "read");
        const conversions = (await repos.journeys.labelConversions(tx, ctx.businessId, journeys.items)).map(({ entityName: _name, ...c }) => ({ ...c, amountMinor: moneyHidden ? null : c.amountMinor }));
        // A follower of the public page (0079, double opt-in): when they confirmed ("Agreed to email on Oct 7, 2026"), or
        // that they signed up and have not confirmed yet ("Not confirmed yet").
        const consent = consents.get(entity.id);
        const emailConsentAt = consent?.state === "confirmed" ? consent.confirmedAt : null;
        const emailConsentPending = consent?.state === "pending";
        return { entity, profile, roles, relationships, interactions: interactions.items, mentions, conversions, moneyHidden, mergeHistory, emailConsentAt, emailConsentPending, redirectedFrom: entity.id !== input.entityId ? input.entityId : null };
      }),
    ),
    update: write.input(z.object({ entityId: Id, patch: UpdateEntityInput })).mutation(({ ctx, input }) =>
      ctx.rls(async (tx) => {
        const entity = await repos.entities.update(tx, ctx.businessId, input.entityId, input.patch);
        for (const field of Object.keys(input.patch)) await repos.entities.recordProvenance(tx, ctx.businessId, entity.id, { field, source: "user", sourceRef: ctx.userId } as never).catch(() => undefined);
        await audit(tx, ctx, { action: "crm.entity.update", target: { kind: "entity", id: entity.id }, details: { fields: Object.keys(input.patch) } });
        return entity;
      }),
    ),
    /** Reversible, audited merge (AC-11.12.3). */
    merge: write.input(z.object({ keptId: Id, mergedId: Id })).mutation(({ ctx, input }) =>
      ctx.rls(async (tx) => {
        const result = await repos.entities.merge(tx, ctx.businessId, input.keptId, input.mergedId, { byKind: "user", byId: ctx.userId });
        await audit(tx, ctx, { action: "crm.entity.merge", target: { kind: "entity", id: input.keptId }, details: { mergedId: input.mergedId, mergeLogId: result.log.id } });
        return result;
      }),
    ),
    /** Reverts only what the merge changed; CONFLICT (with the later merge to undo first) while a later merge relies on it. */
    unmerge: write.input(z.object({ mergeLogId: Id })).mutation(({ ctx, input }) =>
      ctx.rls(async (tx) => {
        const result = await repos.entities.unmerge(tx, ctx.businessId, input.mergeLogId);
        await audit(tx, ctx, { action: "crm.entity.unmerge", target: { kind: "entity", id: result.kept.id }, details: { mergeLogId: input.mergeLogId, restored: result.merged.id } });
        return result;
      }),
    ),
    /**
     * A new record. A strong identifier (email, domain, LinkedIn, company number, Stripe customer) that a live record
     * already holds is a duplicate (BUILD §11.12 "strong identifiers first"): the call is refused with a CONFLICT
     * (`duplicate_entity`, `details.existing` names the record) unless the founder confirms with `allowDuplicate`.
     */
    create: write.input(z.object({ kind: z.enum(["person", "organisation", "venue"]), displayName: z.string().min(1).max(200), identifiers: boundedRecord(INPUT_LIMITS.entityIdentifiers, z.record(z.string(), z.string())).default({}), aliases: z.array(z.string()).max(INPUT_LIMITS.entityAliases).default([]), lawfulBasis: z.string().max(80).nullable().default(null), allowDuplicate: z.boolean().default(false) })).mutation(({ ctx, input: { allowDuplicate, ...input } }) =>
      ctx.rls(async (tx) => {
        if (!allowDuplicate) {
          for (const key of STRONG_IDENTIFIERS) {
            const value = input.identifiers[key]?.trim();
            if (!value) continue;
            const existing = await repos.entities.findByIdentifier(tx, ctx.businessId, key, value);
            if (existing) throw new AppError("duplicate_entity", `${existing.displayName} already has this ${key === "email" ? "email address" : key}.`, 409, { existing: { id: existing.id, displayName: existing.displayName, kind: existing.kind }, identifier: key });
          }
        }
        const entity = await repos.entities.create(tx, ctx.businessId, { ...input, source: "user" });
        await audit(tx, ctx, { action: "crm.entity.create", target: { kind: "entity", id: entity.id }, details: { kind: input.kind } });
        return entity;
      }),
    ),
  }),

  notes: router({
    list: read.input(z.object({ entityId: Id, limit: z.number().int().min(1).max(200).default(50), cursor: z.string().nullish() })).query(({ ctx, input }) => ctx.rls((tx) => repos.entities.listInteractions(tx, ctx.businessId, { entityId: input.entityId, kind: "note", limit: input.limit, cursor: input.cursor }))),
    add: write.input(z.object({ entityId: Id, note: z.string().min(1).max(4000) })).mutation(({ ctx, input }) =>
      ctx.rls(async (tx) => {
        const interaction = await repos.entities.addNote(tx, ctx.businessId, input.entityId, input.note);
        await audit(tx, ctx, { action: "crm.notes.add", target: { kind: "interaction", id: interaction.id }, details: { entityId: input.entityId } });
        return interaction;
      }),
    ),
  }),

  /**
   * Email that reached the project's Foundmill address, kept as plain text (WP-08 T2; founder D3), and the founders'
   * answers. The text is a stranger's: the screen shows it as plain text only. `answer` sends through the gateway as a
   * reply (transactional) and is refused for someone who has not written in the last 30 days.
   */
  replies: router({
    list: read.input(z.object({ entityId: Id.optional(), limit: z.number().int().min(1).max(50).default(20) })).query(({ ctx, input }) => listReplies(ctx, input)),
    answer: write.input(z.object({ interactionId: Id, text: z.string().trim().min(1).max(REPLY_ANSWER_MAX), requestId: Id })).use(modelLimited("replyAnswer")).mutation(({ ctx, input }) => answerReply(ctx, input)),
  }),

  roles: router({
    list: read.input(z.object({ entityId: Id, includeEnded: z.boolean().default(false) })).query(({ ctx, input }) => ctx.rls((tx) => repos.entities.listRoles(tx, ctx.businessId, input.entityId, { includeEnded: input.includeEnded }))),
    add: write.input(z.object({ entityId: Id, role: AddRoleInput })).mutation(({ ctx, input }) =>
      ctx.rls(async (tx) => {
        const role = await repos.entities.addRole(tx, ctx.businessId, input.entityId, input.role);
        await audit(tx, ctx, { action: "crm.roles.add", target: { kind: "entity_role", id: role.id }, details: { entityId: input.entityId, role: input.role.role } });
        return role;
      }),
    ),
    end: write.input(z.object({ roleId: Id })).mutation(({ ctx, input }) =>
      ctx.rls(async (tx) => {
        const role = await repos.entities.endRole(tx, ctx.businessId, input.roleId);
        await audit(tx, ctx, { action: "crm.roles.end", target: { kind: "entity_role", id: role.id } });
        return role;
      }),
    ),
    byRole: read.input(z.object({ role: z.string().min(1).max(80), stage: z.string().max(80).optional(), limit: z.number().int().min(1).max(500).default(100), cursor: z.string().nullish() })).query(({ ctx, input }) =>
        ctx.rls(async (tx) => {
          const page = await repos.entities.listByRole(tx, ctx.businessId, input.role, { stage: input.stage, limit: input.limit, cursor: input.cursor });
          // A confirmed follower of the public page shows when they agreed to email (0079); a pending one, nothing yet.
          const states = await repos.followers.consentStates(tx, ctx.businessId, page.items.map((e) => e.id));
          return { ...page, items: page.items.map((e) => { const s = states.get(e.id); return { ...e, emailConsentAt: s?.state === "confirmed" ? s.confirmedAt : null, emailConsentPending: s?.state === "pending" }; }) };
        }),
      ),
  }),
});
