/**
 * visitors, touches, conversions, journeys, journey_daily, milestones — the Customer Journey / Match Day
 * data (BUILD §11.4; routers journey.get/list/markViewed; the Ribbon reads `dailyRange`).
 *
 * `journey_daily` is a materialised view behind a security-barrier view (DECISIONS "journey_daily is a
 * materialised view plus a security-barrier view"): app roles read the view, which filters on membership;
 * the service role has no membership so `dailyRange` reads the matview directly when the current role
 * bypasses RLS. `refreshDaily` is for the metrics consumer and the nightly schedule.
 */
import { CHANNEL_KEYS, CONVERSION_KINDS, MATCHDAY_LEVELS, MILESTONE_KINDS, ValidationError, VISIBILITY, type ConversionKind } from "@foundmill/shared";
import { and, asc, desc, eq, inArray, isNull, sql, type SQL } from "drizzle-orm";
import { z } from "zod";
import {
  CONSENT_STATES, conversions, entities, journeyDaily, journeyDailyMv, journeys, milestones, touches, visitors,
  type Conversion, type Journey, type JourneyDailyRow, type Milestone, type Touch, type Visitor,
} from "../schema";
import {
  bypassesRls, Currency, DateRange, DayRange, dayRange, Id, IsoDateInput, JsonArray, JsonObject, MinorAmount, one, PageInput, parseInput, rowsOf, timeKeyset, timeRange, toPage,
  type Executor, type Page,
} from "./_shared";

export const UpsertVisitorInput = z.object({
  anonId: z.string().min(1).max(200),
  entityId: Id.nullable().optional(),
  consentState: z.enum(CONSENT_STATES).optional(),
  seenAt: IsoDateInput.optional(),
});
export type UpsertVisitorInput = z.input<typeof UpsertVisitorInput>;

export const RecordTouchInput = z
  .object({
    visitorId: Id.nullable().optional(),
    entityId: Id.nullable().optional(),
    occurredAt: IsoDateInput.optional(),
    channelKey: z.enum(CHANNEL_KEYS).nullable().optional(),
    campaignId: Id.nullable().optional(),
    source: JsonObject.default({}),
    kind: z.string().min(1).max(40).default("visit"),
  })
  .refine((v) => v.visitorId || v.entityId, { message: "a touch belongs to a visitor or an entity" });
export type RecordTouchInput = z.input<typeof RecordTouchInput>;

export const TouchListFilter = PageInput.extend(DateRange.shape).extend({
  visitorId: Id.optional(),
  entityId: Id.optional(),
  channelKey: z.enum(CHANNEL_KEYS).optional(),
  campaignId: Id.optional(),
});
export type TouchListFilter = z.input<typeof TouchListFilter>;

export const RecordConversionInput = z.object({
  entityId: Id.nullable().optional(),
  kind: z.enum(CONVERSION_KINDS),
  amountMinor: MinorAmount.nonnegative().default(0),
  currency: Currency.optional(),
  occurredAt: IsoDateInput.optional(),
  sourceEventId: Id.nullable().optional(),
});
export type RecordConversionInput = z.input<typeof RecordConversionInput>;

export const ConversionListFilter = PageInput.extend(DateRange.shape).extend({
  kind: z.union([z.enum(CONVERSION_KINDS), z.array(z.enum(CONVERSION_KINDS))]).optional(),
  entityId: Id.optional(),
});
export type ConversionListFilter = z.input<typeof ConversionListFilter>;

export const CreateJourneyInput = z.object({
  conversionId: Id,
  touchIds: z.array(Id).default([]),
  weights: z.record(z.string(), z.number()).default({}),
  xcSeries: JsonArray.default([]),
  commentary: JsonArray.default([]),
  agents: JsonArray.default([]),
  matchdayLevel: z.enum(MATCHDAY_LEVELS),
});
export type CreateJourneyInput = z.input<typeof CreateJourneyInput>;

export const JourneyListFilter = PageInput.extend(DateRange.shape).extend({
  matchdayLevel: z.union([z.enum(MATCHDAY_LEVELS), z.array(z.enum(MATCHDAY_LEVELS))]).optional(),
  kind: z.enum(CONVERSION_KINDS).optional(),
  unviewedOnly: z.boolean().default(false),
});
export type JourneyListFilter = z.input<typeof JourneyListFilter>;

export const DailyRangeFilter = DayRange.extend({ departmentId: Id.optional() });
export type DailyRangeFilter = z.input<typeof DailyRangeFilter>;

export const CreateMilestoneInput = z.object({
  kind: z.enum(MILESTONE_KINDS),
  label: z.string().min(1).max(200),
  achievedAt: IsoDateInput.optional(),
  ref: JsonObject.nullable().optional(),
  visibility: z.enum(VISIBILITY).default("private"),
});
export type CreateMilestoneInput = z.input<typeof CreateMilestoneInput>;

export interface JourneyDetail extends Journey {
  conversion: Conversion;
  touches: Touch[];
  entity: { id: string; displayName: string; kind: string } | null;
}

const NIL_UUID = "00000000-0000-0000-0000-000000000000";
const toArray = <T>(v: T | T[] | undefined): T[] | undefined => (v === undefined ? undefined : Array.isArray(v) ? v : [v]);

export const journeysRepo = {
  // visitors ----------------------------------------------------------------------------------------------------------
  /** Finds or creates the visitor for an anonymous id, bumping last_seen (and linking an entity / consent when given). */
  async upsertVisitor(db: Executor, businessId: string, input: UpsertVisitorInput): Promise<Visitor> {
    const v = parseInput(UpsertVisitorInput, input, "visitor");
    const seen = v.seenAt ?? new Date();
    return db.transaction(async (tx) => {
      const existing = await tx.select().from(visitors).where(and(eq(visitors.businessId, businessId), eq(visitors.anonId, v.anonId))).limit(1);
      const current = existing[0];
      if (current) {
        return one(
          await tx
            .update(visitors)
            .set({
              lastSeen: seen > current.lastSeen ? seen : current.lastSeen,
              ...(v.entityId !== undefined ? { entityId: v.entityId } : {}),
              ...(v.consentState ? { consentState: v.consentState } : {}),
            })
            .where(eq(visitors.id, current.id))
            .returning(),
          "visitor",
        );
      }
      return one(
        await tx.insert(visitors).values({ businessId, anonId: v.anonId, entityId: v.entityId ?? null, consentState: v.consentState ?? "unknown", firstSeen: seen, lastSeen: seen }).returning(),
        "visitor",
      );
    });
  },

  async getVisitor(db: Executor, businessId: string, visitorId: string): Promise<Visitor> {
    return one(await db.select().from(visitors).where(and(eq(visitors.businessId, businessId), eq(visitors.id, visitorId))).limit(1), "visitor", visitorId);
  },

  /** Stitches an anonymous visitor to a CRM entity (signup): the visitor's touches now belong to the entity too. */
  async identifyVisitor(db: Executor, businessId: string, visitorId: string, entityId: string): Promise<Visitor> {
    return db.transaction(async (tx) => {
      const ent = await tx.select({ id: entities.id }).from(entities).where(and(eq(entities.businessId, businessId), eq(entities.id, entityId))).limit(1);
      if (ent.length === 0) throw new ValidationError("entityId is not an entity of this business", { entityId });
      const visitor = one(await tx.update(visitors).set({ entityId }).where(and(eq(visitors.businessId, businessId), eq(visitors.id, visitorId))).returning(), "visitor", visitorId);
      await tx.update(touches).set({ entityId }).where(and(eq(touches.businessId, businessId), eq(touches.visitorId, visitorId), isNull(touches.entityId)));
      return visitor;
    });
  },

  async setConsent(db: Executor, businessId: string, visitorId: string, consentState: (typeof CONSENT_STATES)[number]): Promise<Visitor> {
    const s = parseInput(z.enum(CONSENT_STATES), consentState, "consent state");
    return one(await db.update(visitors).set({ consentState: s }).where(and(eq(visitors.businessId, businessId), eq(visitors.id, visitorId))).returning(), "visitor", visitorId);
  },

  // touches -----------------------------------------------------------------------------------------------------------
  async recordTouch(db: Executor, businessId: string, input: RecordTouchInput): Promise<Touch> {
    const v = parseInput(RecordTouchInput, input, "touch");
    return one(
      await db
        .insert(touches)
        .values({ businessId, visitorId: v.visitorId ?? null, entityId: v.entityId ?? null, occurredAt: v.occurredAt ?? new Date(), channelKey: v.channelKey ?? null, campaignId: v.campaignId ?? null, source: v.source, kind: v.kind })
        .returning(),
      "touch",
    );
  },

  async recordTouches(db: Executor, businessId: string, inputs: RecordTouchInput[]): Promise<Touch[]> {
    const parsed = inputs.map((i) => parseInput(RecordTouchInput, i, "touch"));
    if (parsed.length === 0) return [];
    return db
      .insert(touches)
      .values(parsed.map((v) => ({ businessId, visitorId: v.visitorId ?? null, entityId: v.entityId ?? null, occurredAt: v.occurredAt ?? new Date(), channelKey: v.channelKey ?? null, campaignId: v.campaignId ?? null, source: v.source, kind: v.kind })))
      .returning();
  },

  async listTouches(db: Executor, businessId: string, filter: TouchListFilter = {}): Promise<Page<Touch>> {
    const f = parseInput(TouchListFilter, filter, "touch filter");
    const ks = timeKeyset<Touch>(touches.occurredAt, touches.id, (r) => ({ at: r.occurredAt, id: r.id }), "asc");
    const rows = await db
      .select()
      .from(touches)
      .where(
        and(
          eq(touches.businessId, businessId),
          f.visitorId ? eq(touches.visitorId, f.visitorId) : undefined,
          f.entityId ? eq(touches.entityId, f.entityId) : undefined,
          f.channelKey ? eq(touches.channelKey, f.channelKey) : undefined,
          f.campaignId ? eq(touches.campaignId, f.campaignId) : undefined,
          timeRange(touches.occurredAt, f),
          ks.after(f.cursor),
        ),
      )
      .orderBy(...ks.orderBy)
      .limit(f.limit + 1);
    return toPage(rows, f, ks);
  },

  /** Every touch on the path to a conversion: the entity's touches plus those of visitors stitched to it, oldest first. */
  async pathForEntity(db: Executor, businessId: string, entityId: string, until?: Date): Promise<Touch[]> {
    return db
      .select()
      .from(touches)
      .where(
        and(
          eq(touches.businessId, businessId),
          sql`(${touches.entityId} = ${entityId}::uuid or ${touches.visitorId} in (select id from visitors where business_id = ${businessId}::uuid and entity_id = ${entityId}::uuid))`,
          until ? sql`${touches.occurredAt} <= ${until.toISOString()}` : undefined,
        ),
      )
      .orderBy(asc(touches.occurredAt), asc(touches.id));
  },

  // conversions -------------------------------------------------------------------------------------------------------
  async recordConversion(db: Executor, businessId: string, input: RecordConversionInput): Promise<Conversion> {
    const v = parseInput(RecordConversionInput, input, "conversion");
    return one(
      await db
        .insert(conversions)
        .values({ businessId, entityId: v.entityId ?? null, kind: v.kind, amountMinor: v.amountMinor, ...(v.currency ? { currency: v.currency } : {}), occurredAt: v.occurredAt ?? new Date(), sourceEventId: v.sourceEventId ?? null })
        .returning(),
      "conversion",
    );
  },

  async getConversion(db: Executor, businessId: string, conversionId: string): Promise<Conversion> {
    return one(await db.select().from(conversions).where(and(eq(conversions.businessId, businessId), eq(conversions.id, conversionId))).limit(1), "conversion", conversionId);
  },

  /**
   * Each conversion with its customer's display name and its Customer Update (journey) id, null when there is none:
   * what the Ribbon's hover card and the day digest show. Two lookups, whatever the number of rows.
   */
  async labelConversions<T extends { id: string; entityId: string | null }>(db: Executor, businessId: string, rows: readonly T[]): Promise<Array<T & { entityName: string | null; journeyId: string | null }>> {
    const entityIds = [...new Set(rows.map((r) => r.entityId).filter((id): id is string => id !== null))];
    const conversionIds = rows.map((r) => r.id);
    const names = entityIds.length
      ? await db.select({ id: entities.id, name: entities.displayName }).from(entities).where(and(eq(entities.businessId, businessId), inArray(entities.id, entityIds)))
      : [];
    const updates = conversionIds.length
      ? await db.select({ id: journeys.id, conversionId: journeys.conversionId }).from(journeys).where(and(eq(journeys.businessId, businessId), inArray(journeys.conversionId, conversionIds)))
      : [];
    const nameById = new Map(names.map((n) => [n.id, n.name] as const));
    const journeyByConversion = new Map(updates.map((u) => [u.conversionId, u.id] as const));
    return rows.map((r) => ({ ...r, entityName: r.entityId ? (nameById.get(r.entityId) ?? null) : null, journeyId: journeyByConversion.get(r.id) ?? null }));
  },

  async listConversions(db: Executor, businessId: string, filter: ConversionListFilter = {}): Promise<Page<Conversion>> {
    const f = parseInput(ConversionListFilter, filter, "conversion filter");
    const ks = timeKeyset<Conversion>(conversions.occurredAt, conversions.id, (r) => ({ at: r.occurredAt, id: r.id }));
    const kinds = toArray(f.kind);
    const rows = await db
      .select()
      .from(conversions)
      .where(
        and(
          eq(conversions.businessId, businessId),
          kinds?.length ? inArray(conversions.kind, kinds) : undefined,
          f.entityId ? eq(conversions.entityId, f.entityId) : undefined,
          timeRange(conversions.occurredAt, f),
          ks.after(f.cursor),
        ),
      )
      .orderBy(...ks.orderBy)
      .limit(f.limit + 1);
    return toPage(rows, f, ks);
  },

  /** Counts per kind (the "nth customer" numbers the journey builder needs). */
  async countConversions(db: Executor, businessId: string, range: DateRange = {}): Promise<Record<ConversionKind, number>> {
    const r = parseInput(DateRange, range, "date range");
    const rows = await db
      .select({ kind: conversions.kind, n: sql<number>`count(*)::int` })
      .from(conversions)
      .where(and(eq(conversions.businessId, businessId), timeRange(conversions.occurredAt, r)))
      .groupBy(conversions.kind);
    const out = Object.fromEntries(CONVERSION_KINDS.map((k) => [k, 0])) as Record<ConversionKind, number>;
    for (const row of rows) out[row.kind] = Number(row.n);
    return out;
  },

  /**
   * The paying customer base over a revenue window [from, to) (BUILD §11.8: payback divides the window's monthly gross
   * profit by it): distinct customers who had paid by the window's end and had not churned before it began. A payment
   * conversion is a customer's win (the first payment; renewals are not always recorded), so counting only the payers
   * inside the window would count the newly acquired customers again. Churn comes from the CRM: a `customer` role that
   * ended before the window, or is marked `churned` and last changed before it, with no open customer role since. A
   * payment with no linked customer counts once, and only inside the window (nothing says whether it repeats).
   */
  async countPayingCustomers(db: Executor, businessId: string, range: DateRange = {}): Promise<number> {
    const r = parseInput(DateRange, range, "date range");
    const to = r.to ?? new Date();
    const from = r.from ?? to;
    const role = (cond: SQL) => sql`exists (select 1 from entity_roles r where r.business_id = ${conversions.businessId} and r.entity_id = ${conversions.entityId} and r.role = 'customer' and ${cond})`;
    const churnedBefore = sql`(${role(sql`((r.ended_at is not null and r.ended_at < ${from.toISOString()}) or (r.ended_at is null and r.stage = 'churned' and r.updated_at < ${from.toISOString()}))`)} and not ${role(sql`r.ended_at is null and r.stage is distinct from 'churned'`)})`;
    const rows = await db
      .select({ n: sql<number>`count(distinct case when ${conversions.entityId} is not null then ${conversions.entityId}::text when ${conversions.occurredAt} >= ${from.toISOString()} then ${conversions.id}::text end)::int` })
      .from(conversions)
      .where(and(eq(conversions.businessId, businessId), eq(conversions.kind, "payment"), timeRange(conversions.occurredAt, { to }), sql`(${conversions.entityId} is null or not ${churnedBefore})`));
    return Number(rows[0]?.n ?? 0);
  },

  /** Which number this conversion is among its kind (1-based, by occurred_at then id). */
  async nthOfKind(db: Executor, businessId: string, conversionId: string): Promise<number> {
    const c = await journeysRepo.getConversion(db, businessId, conversionId);
    const rows = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(conversions)
      .where(and(eq(conversions.businessId, businessId), eq(conversions.kind, c.kind), sql`(${conversions.occurredAt}, ${conversions.id}) <= (${c.occurredAt.toISOString()}::timestamptz, ${c.id}::uuid)`));
    return Number(rows[0]?.n ?? 1);
  },

  /** 75th percentile of payment amounts (the volume rule for a full Match Day, BUILD §11.4). Null without payments. */
  async paymentPercentile75(db: Executor, businessId: string): Promise<number | null> {
    const rows = rowsOf<{ p75: string | number | null }>(
      await db.execute(sql`select percentile_cont(0.75) within group (order by amount_minor) as p75 from conversions where business_id = ${businessId}::uuid and kind = 'payment'`),
    );
    const p = rows[0]?.p75;
    return p === null || p === undefined ? null : Number(p);
  },

  // journeys ----------------------------------------------------------------------------------------------------------
  async create(db: Executor, businessId: string, input: CreateJourneyInput): Promise<Journey> {
    const v = parseInput(CreateJourneyInput, input, "journey");
    await journeysRepo.getConversion(db, businessId, v.conversionId);
    if (v.touchIds.length) {
      const owned = await db.select({ id: touches.id }).from(touches).where(and(eq(touches.businessId, businessId), inArray(touches.id, v.touchIds)));
      if (owned.length !== new Set(v.touchIds).size) throw new ValidationError("touchIds must be touches of this business", { touchIds: v.touchIds });
    }
    return one(
      await db
        .insert(journeys)
        .values({ businessId, conversionId: v.conversionId, touchIds: v.touchIds, weights: v.weights, xcSeries: v.xcSeries, commentary: v.commentary, agents: v.agents, matchdayLevel: v.matchdayLevel })
        .onConflictDoUpdate({
          target: journeys.conversionId,
          set: { touchIds: v.touchIds, weights: v.weights, xcSeries: v.xcSeries, commentary: v.commentary, agents: v.agents, matchdayLevel: v.matchdayLevel },
          setWhere: eq(journeys.businessId, businessId),
        })
        .returning(),
      "journey",
    );
  },

  async get(db: Executor, businessId: string, journeyId: string): Promise<JourneyDetail> {
    const journey = one(await db.select().from(journeys).where(and(eq(journeys.businessId, businessId), eq(journeys.id, journeyId))).limit(1), "journey", journeyId);
    const conversion = await journeysRepo.getConversion(db, businessId, journey.conversionId);
    const touchRows = journey.touchIds.length
      ? await db.select().from(touches).where(and(eq(touches.businessId, businessId), inArray(touches.id, journey.touchIds))).orderBy(asc(touches.occurredAt), asc(touches.id))
      : [];
    const entity = conversion.entityId
      ? ((await db.select({ id: entities.id, displayName: entities.displayName, kind: entities.kind }).from(entities).where(and(eq(entities.businessId, businessId), eq(entities.id, conversion.entityId))).limit(1))[0] ?? null)
      : null;
    return { ...journey, conversion, touches: touchRows, entity };
  },

  async forConversion(db: Executor, businessId: string, conversionId: string): Promise<Journey | null> {
    const rows = await db.select().from(journeys).where(and(eq(journeys.businessId, businessId), eq(journeys.conversionId, conversionId))).limit(1);
    return rows[0] ?? null;
  },

  /** Match Days newest first, with the conversion joined for the list row (kind, amount, when). */
  async list(db: Executor, businessId: string, filter: JourneyListFilter = {}): Promise<Page<Journey & { conversion: Conversion }>> {
    const f = parseInput(JourneyListFilter, filter, "journey filter");
    type Row = Journey & { conversion: Conversion };
    const ks = timeKeyset<Row>(journeys.createdAt, journeys.id, (r) => ({ at: r.createdAt, id: r.id }));
    const levels = toArray(f.matchdayLevel);
    const rows = await db
      .select({ journey: journeys, conversion: conversions })
      .from(journeys)
      .innerJoin(conversions, eq(conversions.id, journeys.conversionId))
      .where(
        and(
          eq(journeys.businessId, businessId),
          eq(conversions.businessId, businessId),
          levels?.length ? inArray(journeys.matchdayLevel, levels) : undefined,
          f.kind ? eq(conversions.kind, f.kind) : undefined,
          f.unviewedOnly ? isNull(journeys.viewedAt) : undefined,
          timeRange(conversions.occurredAt, f),
          ks.after(f.cursor),
        ),
      )
      .orderBy(...ks.orderBy)
      .limit(f.limit + 1);
    return toPage(
      rows.map((r) => ({ ...r.journey, conversion: r.conversion })),
      f,
      ks,
    );
  },

  async markViewed(db: Executor, businessId: string, journeyId: string): Promise<Journey> {
    return one(
      await db
        .update(journeys)
        .set({ viewedAt: new Date() })
        .where(and(eq(journeys.businessId, businessId), eq(journeys.id, journeyId), isNull(journeys.viewedAt)))
        .returning()
        .then((rows) => (rows.length ? rows : db.select().from(journeys).where(and(eq(journeys.businessId, businessId), eq(journeys.id, journeyId))))),
      "journey",
      journeyId,
    );
  },

  /** Composer `/v1/commentary` fills the lines after the record exists. */
  async setCommentary(db: Executor, businessId: string, journeyId: string, commentary: unknown[]): Promise<Journey> {
    const c = parseInput(JsonArray, commentary, "commentary");
    return one(await db.update(journeys).set({ commentary: c }).where(and(eq(journeys.businessId, businessId), eq(journeys.id, journeyId))).returning(), "journey", journeyId);
  },

  async countUnviewed(db: Executor, businessId: string): Promise<number> {
    const rows = await db.select({ n: sql<number>`count(*)::int` }).from(journeys).where(and(eq(journeys.businessId, businessId), isNull(journeys.viewedAt)));
    return Number(rows[0]?.n ?? 0);
  },

  // journey_daily -----------------------------------------------------------------------------------------------------
  /** Daily aggregate rows (the Ribbon and department cards), oldest first. `departmentId` nil-uuid = business-level rows. */
  async dailyRange(db: Executor, businessId: string, filter: DailyRangeFilter = {}): Promise<JourneyDailyRow[]> {
    const f = parseInput(DailyRangeFilter, filter, "daily range");
    const relation = (await bypassesRls(db)) ? journeyDailyMv : journeyDaily;
    return db
      .select()
      .from(relation)
      .where(and(eq(relation.businessId, businessId), f.departmentId ? eq(relation.departmentId, f.departmentId) : undefined, dayRange(relation.day, f)))
      .orderBy(asc(relation.day), asc(relation.departmentId));
  },

  /** Business-level totals per day (every department folded together). */
  async dailyTotals(db: Executor, businessId: string, range: DayRange = {}): Promise<Omit<JourneyDailyRow, "departmentId">[]> {
    const rows = await journeysRepo.dailyRange(db, businessId, range);
    const byDay = new Map<string, Omit<JourneyDailyRow, "departmentId">>();
    for (const r of rows) {
      const acc = byDay.get(r.day) ?? { businessId, day: r.day, agentHours: "0", tasksDone: 0, spendMinor: 0, revenueMinor: 0, signups: 0, activations: 0, payments: 0, decisions: 0 };
      acc.agentHours = (Number(acc.agentHours) + Number(r.agentHours)).toFixed(3);
      acc.tasksDone += r.tasksDone;
      acc.spendMinor += Number(r.spendMinor);
      acc.revenueMinor += Number(r.revenueMinor);
      acc.signups += r.signups;
      acc.activations += r.activations;
      acc.payments += r.payments;
      acc.decisions += r.decisions;
      byDay.set(r.day, acc);
    }
    return [...byDay.values()].sort((a, b) => (a.day < b.day ? -1 : a.day > b.day ? 1 : 0));
  },

  /** Rebuilds the matview (service role; `refresh_journey_daily()` is security definer). */
  async refreshDaily(db: Executor): Promise<void> {
    await db.execute(sql`select refresh_journey_daily()`);
  },

  // milestones --------------------------------------------------------------------------------------------------------
  async listMilestones(db: Executor, businessId: string, filter: { kind?: (typeof MILESTONE_KINDS)[number] } & DateRange = {}): Promise<Milestone[]> {
    const f = parseInput(DateRange.extend({ kind: z.enum(MILESTONE_KINDS).optional() }), filter, "milestone filter");
    return db
      .select()
      .from(milestones)
      .where(and(eq(milestones.businessId, businessId), isNull(milestones.archivedAt), f.kind ? eq(milestones.kind, f.kind) : undefined, timeRange(milestones.achievedAt, f)))
      .orderBy(desc(milestones.achievedAt));
  },

  async createMilestone(db: Executor, businessId: string, input: CreateMilestoneInput): Promise<Milestone> {
    const v = parseInput(CreateMilestoneInput, input, "milestone");
    return one(
      await db.insert(milestones).values({ businessId, kind: v.kind, label: v.label, achievedAt: v.achievedAt ?? new Date(), ref: v.ref ?? null, visibility: v.visibility }).returning(),
      "milestone",
    );
  },

  async archiveMilestone(db: Executor, businessId: string, milestoneId: string): Promise<Milestone> {
    return one(await db.update(milestones).set({ archivedAt: new Date() }).where(and(eq(milestones.businessId, businessId), eq(milestones.id, milestoneId))).returning(), "milestone", milestoneId);
  },
};

export { NIL_UUID as NO_DEPARTMENT_ID };
