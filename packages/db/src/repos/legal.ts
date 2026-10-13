/**
 * legal_entities, incorporations, filings, contracts, compliance_events — the Legal module (BUILD §11.11;
 * routers legal.recommend / incorporate.start / status / import.lookup / import.confirm / contracts.* /
 * compliance.list).
 *
 * Nothing here signs, files or accepts terms: an incorporation row tracks a supervised browser session
 * whose gated steps the founder performs; `setContractStatus("signed")` records a signature that happened
 * elsewhere (Dropbox Sign webhook or the founder).
 */
import { INCORPORATION_ROUTES, ValidationError } from "@foundmill/shared";
import { and, asc, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import {
  complianceEvents, CONTRACT_STATUSES, contracts, entities, FILING_STATUSES, filings, INCORPORATION_STATUSES, incorporations, LEGAL_ENTITY_STATUSES, legalEntities,
  type ComplianceEvent, type Contract, type Filing, type Incorporation, type LegalEntity,
} from "../schema";
import { Currency, DateRange, changes, defined, Id, IsoDateInput, JsonArray, MinorAmount, one, PageInput, parseInput, timeKeyset, timeRange, toPage, type Executor, type Page, patchSchema } from "./_shared";

export const CreateLegalEntityInput = z.object({
  jurisdiction: z.string().trim().min(2).max(40),
  entityType: z.string().trim().min(1).max(60),
  legalName: z.string().trim().min(1).max(200),
  regNo: z.string().max(60).nullable().optional(),
  registeredAddress: z.record(z.string(), z.string()).nullable().optional(),
  officers: JsonArray.default([]),
  shareCapitalMinor: MinorAmount.nonnegative().nullable().optional(),
  currency: Currency.optional(),
  formedAt: z.string().date().nullable().optional(),
  source: z.string().max(80).nullable().optional(),
  status: z.enum(LEGAL_ENTITY_STATUSES).default("planned"),
});
export type CreateLegalEntityInput = z.input<typeof CreateLegalEntityInput>;
export const UpdateLegalEntityInput = patchSchema(CreateLegalEntityInput);
export type UpdateLegalEntityInput = z.input<typeof UpdateLegalEntityInput>;

export const CreateIncorporationInput = z.object({
  legalEntityId: Id.nullable().optional(),
  route: z.enum(INCORPORATION_ROUTES),
  status: z.enum(INCORPORATION_STATUSES).default("draft"),
  steps: JsonArray.default([]),
  browserSessionId: z.string().max(200).nullable().optional(),
  workflowId: z.string().max(200).nullable().optional(),
});
export type CreateIncorporationInput = z.input<typeof CreateIncorporationInput>;
export const UpdateIncorporationInput = patchSchema(CreateIncorporationInput.omit({ route: true }));
export type UpdateIncorporationInput = z.input<typeof UpdateIncorporationInput>;

export const CreateFilingInput = z.object({
  legalEntityId: Id.nullable().optional(),
  kind: z.string().trim().min(1).max(80),
  title: z.string().max(200).default(""),
  dueAt: IsoDateInput.nullable().optional(),
  status: z.enum(FILING_STATUSES).default("upcoming"),
  ref: z.string().max(200).nullable().optional(),
});
export type CreateFilingInput = z.input<typeof CreateFilingInput>;
export const UpdateFilingInput = patchSchema(CreateFilingInput).extend({ filedAt: IsoDateInput.nullable().optional() });
export type UpdateFilingInput = z.input<typeof UpdateFilingInput>;

export const FilingListFilter = PageInput.extend({
  status: z.union([z.enum(FILING_STATUSES), z.array(z.enum(FILING_STATUSES))]).optional(),
  legalEntityId: Id.optional(),
  dueBefore: IsoDateInput.optional(),
  dueAfter: IsoDateInput.optional(),
});
export type FilingListFilter = z.input<typeof FilingListFilter>;

export const CreateContractInput = z.object({
  counterpartyEntityId: Id.nullable().optional(),
  kind: z.string().trim().min(1).max(80),
  title: z.string().max(200).default(""),
  status: z.enum(CONTRACT_STATUSES).default("draft"),
  docRef: z.string().max(2048).nullable().optional(),
  startsAt: z.string().date().nullable().optional(),
  endsAt: z.string().date().nullable().optional(),
  valueMinor: MinorAmount.nullable().optional(),
  currency: Currency.optional(),
  obligations: JsonArray.default([]),
});
export type CreateContractInput = z.input<typeof CreateContractInput>;
export const UpdateContractInput = patchSchema(CreateContractInput.omit({ status: true }));
export type UpdateContractInput = z.input<typeof UpdateContractInput>;

export const ContractListFilter = PageInput.extend({
  status: z.union([z.enum(CONTRACT_STATUSES), z.array(z.enum(CONTRACT_STATUSES))]).optional(),
  counterpartyEntityId: Id.optional(),
  kind: z.string().max(80).optional(),
  includeArchived: z.boolean().default(false),
});
export type ContractListFilter = z.input<typeof ContractListFilter>;

export const CreateComplianceEventInput = z.object({
  legalEntityId: Id.nullable().optional(),
  kind: z.string().trim().min(1).max(80),
  title: z.string().max(200).default(""),
  dueAt: IsoDateInput,
  recurrence: z.string().max(80).nullable().optional(),
});
export type CreateComplianceEventInput = z.input<typeof CreateComplianceEventInput>;

/** Contract lifecycle (BUILD §11.11): signing itself is a hard gate performed by the founder. */
export const CONTRACT_TRANSITIONS: Record<(typeof CONTRACT_STATUSES)[number], readonly (typeof CONTRACT_STATUSES)[number][]> = {
  draft: ["review", "awaiting_signature", "terminated"],
  review: ["draft", "awaiting_signature", "terminated"],
  awaiting_signature: ["signed", "review", "terminated"],
  signed: ["active", "terminated"],
  active: ["expired", "terminated"],
  expired: [],
  terminated: [],
};

const toArray = <T>(v: T | T[] | undefined): T[] | undefined => (v === undefined ? undefined : Array.isArray(v) ? v : [v]);
const scopedLe = (businessId: string, id: string) => and(eq(legalEntities.businessId, businessId), eq(legalEntities.id, id));
const scopedInc = (businessId: string, id: string) => and(eq(incorporations.businessId, businessId), eq(incorporations.id, id));
const scopedFiling = (businessId: string, id: string) => and(eq(filings.businessId, businessId), eq(filings.id, id));
const scopedContract = (businessId: string, id: string) => and(eq(contracts.businessId, businessId), eq(contracts.id, id));
const scopedCompliance = (businessId: string, id: string) => and(eq(complianceEvents.businessId, businessId), eq(complianceEvents.id, id));

async function assertLegalEntity(db: Executor, businessId: string, legalEntityId: string | null | undefined): Promise<void> {
  if (!legalEntityId) return;
  const rows = await db.select({ id: legalEntities.id }).from(legalEntities).where(scopedLe(businessId, legalEntityId)).limit(1);
  if (rows.length === 0) throw new ValidationError("legalEntityId is not a legal entity of this business", { legalEntityId });
}

export const legalRepo = {
  // legal entities ----------------------------------------------------------------------------------------------------
  async listEntities(db: Executor, businessId: string, options: { includeArchived?: boolean } = {}): Promise<LegalEntity[]> {
    return db
      .select()
      .from(legalEntities)
      .where(and(eq(legalEntities.businessId, businessId), options.includeArchived ? undefined : isNull(legalEntities.archivedAt)))
      .orderBy(asc(legalEntities.createdAt));
  },

  async getEntity(db: Executor, businessId: string, legalEntityId: string): Promise<LegalEntity> {
    return one(await db.select().from(legalEntities).where(scopedLe(businessId, legalEntityId)).limit(1), "legal entity", legalEntityId);
  },

  /** The business's operating entity (first active, else first non-archived), or null before incorporation. */
  async primaryEntity(db: Executor, businessId: string): Promise<LegalEntity | null> {
    const rows = await db
      .select()
      .from(legalEntities)
      .where(and(eq(legalEntities.businessId, businessId), isNull(legalEntities.archivedAt)))
      .orderBy(sql`case when ${legalEntities.status} = 'active' then 0 else 1 end`, asc(legalEntities.createdAt))
      .limit(1);
    return rows[0] ?? null;
  },

  async createEntity(db: Executor, businessId: string, input: CreateLegalEntityInput): Promise<LegalEntity> {
    const v = parseInput(CreateLegalEntityInput, input, "legal entity");
    return one(
      await db
        .insert(legalEntities)
        .values({
          businessId,
          jurisdiction: v.jurisdiction,
          entityType: v.entityType,
          legalName: v.legalName,
          regNo: v.regNo ?? null,
          registeredAddress: v.registeredAddress ?? null,
          officers: v.officers,
          shareCapitalMinor: v.shareCapitalMinor ?? null,
          ...(v.currency ? { currency: v.currency } : {}),
          formedAt: v.formedAt ?? null,
          source: v.source ?? null,
          status: v.status,
        })
        .returning(),
      "legal entity",
    );
  },

  async updateEntity(db: Executor, businessId: string, legalEntityId: string, input: UpdateLegalEntityInput): Promise<LegalEntity> {
    const v = parseInput(UpdateLegalEntityInput, input, "legal entity update");
    return one(await db.update(legalEntities).set(changes(v, "legal entity")).where(scopedLe(businessId, legalEntityId)).returning(), "legal entity", legalEntityId);
  },

  /** Import confirm (router legal.import.confirm): a registry lookup becomes the operating entity. */
  async importEntity(db: Executor, businessId: string, input: CreateLegalEntityInput & { source: string }): Promise<LegalEntity> {
    return legalRepo.createEntity(db, businessId, { ...input, status: input.status ?? "active" });
  },

  async archiveEntity(db: Executor, businessId: string, legalEntityId: string): Promise<LegalEntity> {
    return one(await db.update(legalEntities).set({ archivedAt: new Date() }).where(scopedLe(businessId, legalEntityId)).returning(), "legal entity", legalEntityId);
  },

  // incorporations ----------------------------------------------------------------------------------------------------
  async listIncorporations(db: Executor, businessId: string): Promise<Incorporation[]> {
    return db.select().from(incorporations).where(and(eq(incorporations.businessId, businessId), isNull(incorporations.archivedAt))).orderBy(desc(incorporations.createdAt));
  },

  async getIncorporation(db: Executor, businessId: string, incorporationId: string): Promise<Incorporation> {
    return one(await db.select().from(incorporations).where(scopedInc(businessId, incorporationId)).limit(1), "incorporation", incorporationId);
  },

  /** The incorporation in flight (anything not complete/abandoned), or null. */
  async activeIncorporation(db: Executor, businessId: string): Promise<Incorporation | null> {
    const rows = await db
      .select()
      .from(incorporations)
      .where(and(eq(incorporations.businessId, businessId), isNull(incorporations.archivedAt), inArray(incorporations.status, ["draft", "in_progress", "awaiting_founder", "submitted"])))
      .orderBy(desc(incorporations.createdAt))
      .limit(1);
    return rows[0] ?? null;
  },

  async startIncorporation(db: Executor, businessId: string, input: CreateIncorporationInput): Promise<Incorporation> {
    const v = parseInput(CreateIncorporationInput, input, "incorporation");
    return db.transaction(async (tx) => {
      await assertLegalEntity(tx, businessId, v.legalEntityId);
      if (await legalRepo.activeIncorporation(tx, businessId)) throw new ValidationError("An incorporation is already in progress", { businessId });
      return one(
        await tx
          .insert(incorporations)
          .values({ businessId, legalEntityId: v.legalEntityId ?? null, route: v.route, status: v.status, steps: v.steps, browserSessionId: v.browserSessionId ?? null, workflowId: v.workflowId ?? null })
          .returning(),
        "incorporation",
      );
    });
  },

  async updateIncorporation(db: Executor, businessId: string, incorporationId: string, input: UpdateIncorporationInput): Promise<Incorporation> {
    const v = parseInput(UpdateIncorporationInput, input, "incorporation update");
    await assertLegalEntity(db, businessId, v.legalEntityId);
    const now = new Date();
    return one(
      await db
        .update(incorporations)
        .set({ ...defined(v), ...(v.status === "submitted" ? { submittedAt: now } : {}), ...(v.status === "complete" ? { completedAt: now } : {}) })
        .where(scopedInc(businessId, incorporationId))
        .returning(),
      "incorporation",
      incorporationId,
    );
  },

  // filings -----------------------------------------------------------------------------------------------------------
  async listFilings(db: Executor, businessId: string, filter: FilingListFilter = {}): Promise<Page<Filing>> {
    const f = parseInput(FilingListFilter, filter, "filing filter");
    const ks = timeKeyset<Filing>(filings.createdAt, filings.id, (r) => ({ at: r.createdAt, id: r.id }), "asc");
    const statuses = toArray(f.status);
    const rows = await db
      .select()
      .from(filings)
      .where(
        and(
          eq(filings.businessId, businessId),
          isNull(filings.archivedAt),
          statuses?.length ? inArray(filings.status, statuses) : undefined,
          f.legalEntityId ? eq(filings.legalEntityId, f.legalEntityId) : undefined,
          f.dueBefore ? sql`${filings.dueAt} <= ${f.dueBefore.toISOString()}` : undefined,
          f.dueAfter ? sql`${filings.dueAt} >= ${f.dueAfter.toISOString()}` : undefined,
          ks.after(f.cursor),
        ),
      )
      .orderBy(sql`${filings.dueAt} asc nulls last`, ...ks.orderBy)
      .limit(f.limit + 1);
    return toPage(rows, f, ks);
  },

  async createFiling(db: Executor, businessId: string, input: CreateFilingInput): Promise<Filing> {
    const v = parseInput(CreateFilingInput, input, "filing");
    await assertLegalEntity(db, businessId, v.legalEntityId);
    return one(
      await db.insert(filings).values({ businessId, legalEntityId: v.legalEntityId ?? null, kind: v.kind, title: v.title, dueAt: v.dueAt ?? null, status: v.status, ref: v.ref ?? null }).returning(),
      "filing",
    );
  },

  async updateFiling(db: Executor, businessId: string, filingId: string, input: UpdateFilingInput): Promise<Filing> {
    const v = parseInput(UpdateFilingInput, input, "filing update");
    await assertLegalEntity(db, businessId, v.legalEntityId);
    return one(
      await db
        .update(filings)
        .set({ ...defined(v), ...(v.status === "filed" && v.filedAt === undefined ? { filedAt: new Date() } : {}) })
        .where(scopedFiling(businessId, filingId))
        .returning(),
      "filing",
      filingId,
    );
  },

  /** Flips upcoming filings to due/overdue relative to `now` (the nightly schedule); returns how many changed. */
  async rollFilingStatuses(db: Executor, businessId: string, now = new Date(), dueWindowDays = 30): Promise<number> {
    const windowEnd = new Date(now.getTime() + dueWindowDays * 86_400_000);
    const overdue = await db
      .update(filings)
      .set({ status: "overdue" })
      .where(and(eq(filings.businessId, businessId), isNull(filings.archivedAt), inArray(filings.status, ["upcoming", "due"]), sql`${filings.dueAt} < ${now.toISOString()}`))
      .returning({ id: filings.id });
    const due = await db
      .update(filings)
      .set({ status: "due" })
      .where(and(eq(filings.businessId, businessId), isNull(filings.archivedAt), eq(filings.status, "upcoming"), sql`${filings.dueAt} <= ${windowEnd.toISOString()}`))
      .returning({ id: filings.id });
    return overdue.length + due.length;
  },

  async archiveFiling(db: Executor, businessId: string, filingId: string): Promise<Filing> {
    return one(await db.update(filings).set({ archivedAt: new Date() }).where(scopedFiling(businessId, filingId)).returning(), "filing", filingId);
  },

  // contracts ---------------------------------------------------------------------------------------------------------
  async listContracts(db: Executor, businessId: string, filter: ContractListFilter = {}): Promise<Page<Contract & { counterparty: { id: string; displayName: string } | null }>> {
    const f = parseInput(ContractListFilter, filter, "contract filter");
    type Row = Contract & { counterparty: { id: string; displayName: string } | null };
    const ks = timeKeyset<Row>(contracts.createdAt, contracts.id, (r) => ({ at: r.createdAt, id: r.id }));
    const statuses = toArray(f.status);
    const rows = await db
      .select({ contract: contracts, counterparty: { id: entities.id, displayName: entities.displayName } })
      .from(contracts)
      .leftJoin(entities, eq(entities.id, contracts.counterpartyEntityId))
      .where(
        and(
          eq(contracts.businessId, businessId),
          f.includeArchived ? undefined : isNull(contracts.archivedAt),
          statuses?.length ? inArray(contracts.status, statuses) : undefined,
          f.counterpartyEntityId ? eq(contracts.counterpartyEntityId, f.counterpartyEntityId) : undefined,
          f.kind ? eq(contracts.kind, f.kind) : undefined,
          ks.after(f.cursor),
        ),
      )
      .orderBy(...ks.orderBy)
      .limit(f.limit + 1);
    return toPage(
      rows.map((r) => ({ ...r.contract, counterparty: r.counterparty?.id ? r.counterparty : null })),
      f,
      ks,
    );
  },

  async getContract(db: Executor, businessId: string, contractId: string): Promise<Contract> {
    return one(await db.select().from(contracts).where(scopedContract(businessId, contractId)).limit(1), "contract", contractId);
  },

  async createContract(db: Executor, businessId: string, input: CreateContractInput): Promise<Contract> {
    const v = parseInput(CreateContractInput, input, "contract");
    if (v.counterpartyEntityId) {
      const rows = await db.select({ id: entities.id }).from(entities).where(and(eq(entities.businessId, businessId), eq(entities.id, v.counterpartyEntityId))).limit(1);
      if (rows.length === 0) throw new ValidationError("counterpartyEntityId is not an entity of this business", { counterpartyEntityId: v.counterpartyEntityId });
    }
    return one(
      await db
        .insert(contracts)
        .values({
          businessId,
          counterpartyEntityId: v.counterpartyEntityId ?? null,
          kind: v.kind,
          title: v.title,
          status: v.status,
          docRef: v.docRef ?? null,
          startsAt: v.startsAt ?? null,
          endsAt: v.endsAt ?? null,
          valueMinor: v.valueMinor ?? null,
          ...(v.currency ? { currency: v.currency } : {}),
          obligations: v.obligations,
        })
        .returning(),
      "contract",
    );
  },

  async updateContract(db: Executor, businessId: string, contractId: string, input: UpdateContractInput): Promise<Contract> {
    const v = parseInput(UpdateContractInput, input, "contract update");
    return one(await db.update(contracts).set(changes(v, "contract")).where(scopedContract(businessId, contractId)).returning(), "contract", contractId);
  },

  /** Moves a contract along its lifecycle; `signed` stamps signed_at (the signature itself happened outside the platform). */
  async setContractStatus(db: Executor, businessId: string, contractId: string, status: (typeof CONTRACT_STATUSES)[number], options: { signedAt?: Date; force?: boolean } = {}): Promise<Contract> {
    const s = parseInput(z.enum(CONTRACT_STATUSES), status, "contract status");
    return db.transaction(async (tx) => {
      const current = await legalRepo.getContract(tx, businessId, contractId);
      if (current.status === s) return current;
      if (!options.force && !CONTRACT_TRANSITIONS[current.status].includes(s)) throw new ValidationError(`Contract cannot move from ${current.status} to ${s}`, { contractId, from: current.status, to: s });
      return one(
        await tx
          .update(contracts)
          .set({ status: s, ...(s === "signed" ? { signedAt: options.signedAt ?? new Date() } : {}) })
          .where(scopedContract(businessId, contractId))
          .returning(),
        "contract",
        contractId,
      );
    });
  },

  async archiveContract(db: Executor, businessId: string, contractId: string): Promise<Contract> {
    return one(await db.update(contracts).set({ archivedAt: new Date() }).where(scopedContract(businessId, contractId)).returning(), "contract", contractId);
  },

  // compliance --------------------------------------------------------------------------------------------------------
  async listCompliance(db: Executor, businessId: string, filter: DateRange & { pendingOnly?: boolean; legalEntityId?: string } = {}): Promise<ComplianceEvent[]> {
    const f = parseInput(DateRange.extend({ pendingOnly: z.boolean().default(false), legalEntityId: Id.optional() }), filter, "compliance filter");
    return db
      .select()
      .from(complianceEvents)
      .where(
        and(
          eq(complianceEvents.businessId, businessId),
          isNull(complianceEvents.archivedAt),
          f.pendingOnly ? isNull(complianceEvents.completedAt) : undefined,
          f.legalEntityId ? eq(complianceEvents.legalEntityId, f.legalEntityId) : undefined,
          timeRange(complianceEvents.dueAt, f),
        ),
      )
      .orderBy(asc(complianceEvents.dueAt));
  },

  async createCompliance(db: Executor, businessId: string, input: CreateComplianceEventInput): Promise<ComplianceEvent> {
    const v = parseInput(CreateComplianceEventInput, input, "compliance event");
    await assertLegalEntity(db, businessId, v.legalEntityId);
    return one(
      await db.insert(complianceEvents).values({ businessId, legalEntityId: v.legalEntityId ?? null, kind: v.kind, title: v.title, dueAt: v.dueAt, recurrence: v.recurrence ?? null }).returning(),
      "compliance event",
    );
  },

  async completeCompliance(db: Executor, businessId: string, eventId: string, completedAt = new Date()): Promise<ComplianceEvent> {
    return one(await db.update(complianceEvents).set({ completedAt }).where(scopedCompliance(businessId, eventId)).returning(), "compliance event", eventId);
  },

  async archiveCompliance(db: Executor, businessId: string, eventId: string): Promise<ComplianceEvent> {
    return one(await db.update(complianceEvents).set({ archivedAt: new Date() }).where(scopedCompliance(businessId, eventId)).returning(), "compliance event", eventId);
  },

  /** Deadlines (filings + compliance) due within `days` — the "Legal deadline" wake event and the Inbox reminders. */
  async upcomingDeadlines(db: Executor, businessId: string, days = 30, now = new Date()): Promise<{ filings: Filing[]; compliance: ComplianceEvent[] }> {
    const until = new Date(now.getTime() + days * 86_400_000);
    const [f, c] = await Promise.all([
      legalRepo.listFilings(db, businessId, { status: ["upcoming", "due", "overdue"], dueBefore: until, limit: 200 }),
      legalRepo.listCompliance(db, businessId, { pendingOnly: true, to: until }),
    ]);
    return { filings: f.items, compliance: c };
  },
};
