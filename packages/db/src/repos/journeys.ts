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
import { and, asc, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import {
  ATTRIBUTION_MODELS, CONSENT_STATES, conversions, entities, journeyDaily, journeyDailyMv, journeys, milestones, touches, visitors, XC_MODEL_SOURCES,
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
  /** False for a renewal or a repeat order: revenue, but not a new customer (0034). */
  firstPayment: z.boolean().default(true),
});
export type RecordConversionInput = z.input<typeof RecordConversionInput>;

export const ConversionListFilter = PageInput.extend(DateRange.shape).extend({
  kind: z.union([z.enum(CONVERSION_KINDS), z.array(z.enum(CONVERSION_KINDS))]).optional(),
  entityId: Id.optional(),
  /** true: conversions that won a customer (repeat payments left out); false: repeat payments only; omitted: every row. */
  firstPayment: z.boolean().optional(),
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
  /** The models the builder used for `weights` and `xcSeries` (journey.get labels the record with them). */
  attributionModel: z.enum(ATTRIBUTION_MODELS).nullable().optional(),
  xcModelSource: z.enum(XC_MODEL_SOURCES).nullable().optional(),
});
export type CreateJourneyInput = z.input<typeof CreateJourneyInput>;

export const JourneyListFilter = PageInput.extend(DateRange.shape).extend({
  matchdayLevel: z.union([z.enum(MATCHDAY_LEVELS), z.array(z.enum(MATCHDAY_LEVELS))]).optional(),
  kind: z.enum(CONVERSION_KINDS).optional(),
  unviewedOnly: z.boolean().default(false),
  /** `created` (default): the newest Customer Updates first; `converted`: the newest wins first, by when they happened. */
  orderBy: z.enum(["created", "converted"]).default("created"),
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

/** A `journey.list` row: the journey, its conversion and the consent behind it (see `consentForJourneys`). */
export type JourneyListRow = Journey & { conversion: Conversion; consent: JourneyConsent; partialJourney: boolean };

/** How many Customer Updates a business has and how many of them are partial (consent other than granted). */
export interface JourneyConsentSummary {
  journeys: number;
  partialJourneys: number;
}

export interface JourneyDetail extends Journey {
  conversion: Conversion;
  touches: Touch[];
  entity: { id: string; displayName: string; kind: string } | null;
}

const NIL_UUID = "00000000-0000-0000-0000-000000000000";
export type JourneyConsent = (typeof CONSENT_STATES)[number];

/**
 * A journey's consent is that of the visitor on the earliest of its touches that came through a visitor (by time, then
 * id), `unknown` when none did. A journey is partial unless that consent is `granted`: the builder weighted first-party
 * touches only (`filterTouchesForConsent`). `journey.get`, `journey.list` and the Attribution summary all read it here,
 * so a replay and the Attribution screen never disagree about which wins are partial.
 */
export function isPartialConsent(consent: JourneyConsent): boolean {
  return consent !== "granted";
}

/** `journeys j` joined to the visitor `v` of its first visitor-bearing touch: one definition for every reader. */
const journeyConsentFrom = sql`journeys j
  left join lateral (
    select t.visitor_id from touches t
    where t.business_id = j.business_id and t.id = any(j.touch_ids) and t.visitor_id is not null
    order by t.occurred_at asc, t.id asc
    limit 1
  ) first_touch on true
  left join visitors v on v.business_id = j.business_id and v.id = first_touch.visitor_id`;
const journeyConsent = sql`coalesce(v.consent_state, 'unknown')`;

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

  /**
   * Labeled paths for fitting the data-driven models (journeyBuild's Markov removal effect and xC model): the newest
   * `maxTouches` touches since `since`, grouped per visitor (per entity when the touch has no visitor), each group
   * marked converted when its person has a conversion. Oldest first inside a group.
   */
  async trainingPaths(db: Executor, businessId: string, options: { since?: Date; maxTouches?: number } = {}): Promise<Array<{ touches: Touch[]; converted: boolean }>> {
    const rows = await db
      .select()
      .from(touches)
      .where(and(eq(touches.businessId, businessId), options.since ? sql`${touches.occurredAt} >= ${options.since.toISOString()}::timestamptz` : undefined))
      .orderBy(desc(touches.occurredAt), desc(touches.id))
      .limit(Math.min(Math.max(1, options.maxTouches ?? 5000), 20_000));
    const visitorIds = [...new Set(rows.map((t) => t.visitorId).filter((v): v is string => v !== null))];
    const stitched = visitorIds.length
      ? await db.select({ id: visitors.id, entityId: visitors.entityId }).from(visitors).where(and(eq(visitors.businessId, businessId), inArray(visitors.id, visitorIds)))
      : [];
    const entityOfVisitor = new Map(stitched.map((v) => [v.id, v.entityId] as const));
    const entityOf = (t: Touch): string | null => t.entityId ?? (t.visitorId ? (entityOfVisitor.get(t.visitorId) ?? null) : null);
    const entityIds = [...new Set(rows.map(entityOf).filter((e): e is string => e !== null))];
    const convertedRows = entityIds.length
      ? await db.selectDistinct({ entityId: conversions.entityId }).from(conversions).where(and(eq(conversions.businessId, businessId), inArray(conversions.entityId, entityIds)))
      : [];
    const converted = new Set(convertedRows.map((r) => r.entityId));
    const groups = new Map<string, { touches: Touch[]; converted: boolean }>();
    for (const t of rows) {
      const key = t.visitorId ?? t.entityId;
      if (!key) continue;
      const group = groups.get(key) ?? { touches: [], converted: false };
      group.touches.push(t);
      const entityId = entityOf(t);
      if (entityId && converted.has(entityId)) group.converted = true;
      groups.set(key, group);
    }
    for (const g of groups.values()) g.touches.sort((a, b) => a.occurredAt.getTime() - b.occurredAt.getTime() || a.id.localeCompare(b.id));
    return [...groups.values()];
  },

  // conversions -------------------------------------------------------------------------------------------------------
  async recordConversion(db: Executor, businessId: string, input: RecordConversionInput): Promise<Conversion> {
    const v = parseInput(RecordConversionInput, input, "conversion");
    return one(
      await db
        .insert(conversions)
        .values({ businessId, entityId: v.entityId ?? null, kind: v.kind, amountMinor: v.amountMinor, ...(v.currency ? { currency: v.currency } : {}), occurredAt: v.occurredAt ?? new Date(), sourceEventId: v.sourceEventId ?? null, firstPayment: v.kind !== "payment" || v.firstPayment })
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
          f.firstPayment === undefined ? undefined : eq(conversions.firstPayment, f.firstPayment),
          timeRange(conversions.occurredAt, f),
          ks.after(f.cursor),
        ),
      )
      .orderBy(...ks.orderBy)
      .limit(f.limit + 1);
    return toPage(rows, f, ks);
  },

  /** Counts per kind (the "nth customer" numbers the journey builder needs): `payment` counts first payments only. */
  async countConversions(db: Executor, businessId: string, range: DateRange = {}): Promise<Record<ConversionKind, number>> {
    const r = parseInput(DateRange, range, "date range");
    const rows = await db
      .select({ kind: conversions.kind, n: sql<number>`count(*)::int` })
      .from(conversions)
      .where(and(eq(conversions.businessId, businessId), eq(conversions.firstPayment, true), timeRange(conversions.occurredAt, r)))
      .groupBy(conversions.kind);
    const out = Object.fromEntries(CONVERSION_KINDS.map((k) => [k, 0])) as Record<ConversionKind, number>;
    for (const row of rows) out[row.kind] = Number(row.n);
    return out;
  },

  /** Which number this conversion is among its kind (1-based, by occurred_at then id); payments count first payments only. */
  async nthOfKind(db: Executor, businessId: string, conversionId: string): Promise<number> {
    const c = await journeysRepo.getConversion(db, businessId, conversionId);
    const rows = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(conversions)
      .where(and(eq(conversions.businessId, businessId), eq(conversions.kind, c.kind), eq(conversions.firstPayment, true), sql`(${conversions.occurredAt}, ${conversions.id}) <= (${c.occurredAt.toISOString()}::timestamptz, ${c.id}::uuid)`));
    return Math.max(1, Number(rows[0]?.n ?? 1));
  },

  /** Whether the entity already paid (any payment strictly earlier than `before`): a payment now is a repeat, not a new customer. */
  async hasPaidBefore(db: Executor, businessId: string, entityId: string, before: Date): Promise<boolean> {
    const rows = await db
      .select({ id: conversions.id })
      .from(conversions)
      .where(and(eq(conversions.businessId, businessId), eq(conversions.entityId, entityId), eq(conversions.kind, "payment"), sql`${conversions.occurredAt} < ${before.toISOString()}::timestamptz`))
      .limit(1);
    return rows.length > 0;
  },

  /** 75th percentile of first-payment amounts (the volume rule for a full Match Day, BUILD §11.4). Null without payments. */
  async paymentPercentile75(db: Executor, businessId: string): Promise<number | null> {
    const rows = rowsOf<{ p75: string | number | null }>(
      await db.execute(sql`select percentile_cont(0.75) within group (order by amount_minor) as p75 from conversions where business_id = ${businessId}::uuid and kind = 'payment' and first_payment`),
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
        .values({ businessId, conversionId: v.conversionId, touchIds: v.touchIds, weights: v.weights, xcSeries: v.xcSeries, commentary: v.commentary, agents: v.agents, matchdayLevel: v.matchdayLevel, attributionModel: v.attributionModel ?? null, xcModelSource: v.xcModelSource ?? null })
        .onConflictDoUpdate({
          target: journeys.conversionId,
          set: { touchIds: v.touchIds, weights: v.weights, xcSeries: v.xcSeries, commentary: v.commentary, agents: v.agents, matchdayLevel: v.matchdayLevel, attributionModel: v.attributionModel ?? null, xcModelSource: v.xcModelSource ?? null },
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

  /**
   * Customer Updates newest first (by creation, or by when the win happened with `orderBy: "converted"`), with the
   * conversion joined for the list row (kind, amount, when) and the consent behind each one (`partialJourney`).
   */
  async list(db: Executor, businessId: string, filter: JourneyListFilter = {}): Promise<Page<JourneyListRow>> {
    const f = parseInput(JourneyListFilter, filter, "journey filter");
    type Row = Journey & { conversion: Conversion };
    const ks =
      f.orderBy === "converted"
        ? timeKeyset<Row>(conversions.occurredAt, journeys.id, (r) => ({ at: r.conversion.occurredAt, id: r.id }))
        : timeKeyset<Row>(journeys.createdAt, journeys.id, (r) => ({ at: r.createdAt, id: r.id }));
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
    const page = toPage(
      rows.map((r) => ({ ...r.journey, conversion: r.conversion })),
      f,
      ks,
    );
    const consent = await journeysRepo.consentForJourneys(db, businessId, page.items.map((j) => j.id));
    return {
      ...page,
      items: page.items.map((j) => {
        const c = consent.get(j.id) ?? "unknown";
        return { ...j, consent: c, partialJourney: isPartialConsent(c) };
      }),
    };
  },

  /** The consent behind each of these journeys (`isPartialConsent` says which are partial), in one query. */
  async consentForJourneys(db: Executor, businessId: string, journeyIds: readonly string[]): Promise<Map<string, JourneyConsent>> {
    const ids = [...new Set(journeyIds)];
    if (ids.length === 0) return new Map();
    const rows = rowsOf<{ journey_id: string; consent: JourneyConsent }>(
      await db.execute(
        sql`select j.id as journey_id, ${journeyConsent} as consent from ${journeyConsentFrom} where j.business_id = ${businessId}::uuid and j.id in (${sql.join(
          ids.map((id) => sql`${id}::uuid`),
          sql`, `,
        )})`,
      ),
    );
    return new Map(rows.map((r) => [String(r.journey_id), r.consent] as const));
  },

  /** Every Customer Update of the business and how many are partial: the Attribution screen's count, not one page's. */
  async consentSummary(db: Executor, businessId: string): Promise<JourneyConsentSummary> {
    const rows = rowsOf<{ journeys: number | string; partial: number | string }>(
      await db.execute(sql`select count(*)::int as journeys, (count(*) filter (where ${journeyConsent} <> 'granted'))::int as partial from ${journeyConsentFrom} where j.business_id = ${businessId}::uuid`),
    );
    return { journeys: Number(rows[0]?.journeys ?? 0), partialJourneys: Number(rows[0]?.partial ?? 0) };
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
