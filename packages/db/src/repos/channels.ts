/**
 * channels, channel_metrics, suppression_list — the Distribution module's formation (BUILD §11.7;
 * routers distribution.recommend / channels.list / enable / disable / move / budget).
 *
 * One row per channel key per business (unique), so `recommend` upserts the strategist's verdict for
 * every key and the screen lists all 15 lines of the formation. Metrics are daily rows per channel
 * (and optionally campaign); `metricsSummary` folds a date range into the per-channel totals and a
 * blended CPA the screen labels "Estimate".
 */
import { createHash } from "node:crypto";
import { CHANNEL_KEYS, CHANNEL_LINES, type ChannelKey, type ChannelLine } from "@foundmill/shared";
import { and, asc, desc, eq, inArray, isNull, or, sql } from "drizzle-orm";
import { z } from "zod";
import { businesses, channelMetrics, channels, SUPPRESSION_SCOPES, suppressionList, type Channel, type ChannelMetric, type SuppressionEntry } from "../schema";
import { Currency, DayRange, dayRange, defined, Id, MinorAmount, numericText, one, parseInput, type Executor } from "./_shared";

export const UpsertChannelInput = z.object({
  channelKey: z.enum(CHANNEL_KEYS),
  line: z.enum(CHANNEL_LINES),
  enabled: z.boolean().optional(),
  fit: z.number().int().min(1).max(20).optional(),
  potential: z.number().min(0).max(100).optional(),
  recommended: z.boolean().optional(),
  whyMd: z.string().optional(),
  budgetMinor: MinorAmount.nonnegative().optional(),
  currency: Currency.optional(),
  kitMode: z.boolean().optional(),
  ownerAgentId: Id.nullable().optional(),
});
export type UpsertChannelInput = z.input<typeof UpsertChannelInput>;

export const ChannelListFilter = z.object({
  enabled: z.boolean().optional(),
  line: z.enum(CHANNEL_LINES).optional(),
  recommended: z.boolean().optional(),
  includeArchived: z.boolean().default(false),
});
export type ChannelListFilter = z.input<typeof ChannelListFilter>;

export const UpsertChannelMetricInput = z.object({
  channelId: Id,
  campaignId: Id.nullable().optional(),
  day: z.string().date(),
  spendMinor: MinorAmount.nonnegative().default(0),
  currency: Currency.optional(),
  impressions: z.number().int().nonnegative().default(0),
  leads: z.number().int().nonnegative().default(0),
  signups: z.number().int().nonnegative().default(0),
  activations: z.number().int().nonnegative().default(0),
  customers: z.number().int().nonnegative().default(0),
});
export type UpsertChannelMetricInput = z.input<typeof UpsertChannelMetricInput>;

export const MetricsRangeFilter = DayRange.extend({ channelId: Id.optional(), campaignId: Id.optional() });
export type MetricsRangeFilter = z.input<typeof MetricsRangeFilter>;

export interface ChannelMetricsSummary {
  channelId: string;
  channelKey: ChannelKey;
  line: ChannelLine;
  spendMinor: number;
  impressions: number;
  leads: number;
  signups: number;
  activations: number;
  customers: number;
  /** spend ÷ customers in minor units; null without customers. Label "Estimate". */
  cpaMinor: number | null;
  days: number;
}

export type SuppressionKind = "email" | "phone" | "address";

/**
 * The value a `suppression_list` hash column holds: sha256 hex of the normalized value (an email trimmed and lowercased,
 * a phone number as digits with one leading +, an address lowercased with its whitespace collapsed). The gateway's
 * `hashRecipient` normalizes emails and phones the same way, so an entry written here blocks its recipient check.
 */
export function suppressionHash(kind: SuppressionKind, value: string): string {
  const normalized =
    kind === "email" ? value.trim().toLowerCase() : kind === "phone" ? value.replace(/[^\d+]/g, "").replace(/(?!^)\+/g, "") : value.trim().toLowerCase().replace(/\s+/g, " ");
  return createHash("sha256").update(normalized, "utf8").digest("hex");
}

export const AddSuppressionInput = z
  .object({
    emailHash: z.string().min(16).max(128).optional(),
    addressHash: z.string().min(16).max(128).optional(),
    phoneHash: z.string().min(16).max(128).optional(),
    reason: z.string().min(1).max(200),
    scope: z.enum(SUPPRESSION_SCOPES).default("business"),
    source: z.string().max(80).nullable().optional(),
  })
  .refine((v) => v.emailHash || v.addressHash || v.phoneHash, { message: "a suppression entry carries at least one hash" });
export type AddSuppressionInput = z.input<typeof AddSuppressionInput>;

const scoped = (businessId: string, channelId: string) => and(eq(channels.businessId, businessId), eq(channels.id, channelId));
const cpa = (spend: number, customers: number) => (customers > 0 ? Math.round(spend / customers) : null);

export const channelsRepo = {
  /** The formation: every channel row, by line then fit (best first). */
  async list(db: Executor, businessId: string, filter: ChannelListFilter = {}): Promise<Channel[]> {
    const f = parseInput(ChannelListFilter, filter, "channel filter");
    return db
      .select()
      .from(channels)
      .where(
        and(
          eq(channels.businessId, businessId),
          f.includeArchived ? undefined : isNull(channels.archivedAt),
          f.enabled === undefined ? undefined : eq(channels.enabled, f.enabled),
          f.line ? eq(channels.line, f.line) : undefined,
          f.recommended === undefined ? undefined : eq(channels.recommended, f.recommended),
        ),
      )
      .orderBy(asc(channels.line), desc(channels.fit), asc(channels.channelKey));
  },

  async get(db: Executor, businessId: string, channelId: string): Promise<Channel> {
    return one(await db.select().from(channels).where(scoped(businessId, channelId)).limit(1), "channel", channelId);
  },

  async getByKey(db: Executor, businessId: string, channelKey: ChannelKey): Promise<Channel | null> {
    const key = parseInput(z.enum(CHANNEL_KEYS), channelKey, "channel key");
    const rows = await db.select().from(channels).where(and(eq(channels.businessId, businessId), eq(channels.channelKey, key))).limit(1);
    return rows[0] ?? null;
  },

  /** Creates or updates one channel row (unique per key). Only supplied fields change on update. */
  async upsert(db: Executor, businessId: string, input: UpsertChannelInput): Promise<Channel> {
    const v = parseInput(UpsertChannelInput, input, "channel");
    const patch = defined({
      line: v.line,
      enabled: v.enabled,
      fit: v.fit,
      potential: numericText(v.potential) ?? undefined,
      recommended: v.recommended,
      whyMd: v.whyMd,
      budgetMinor: v.budgetMinor,
      currency: v.currency,
      kitMode: v.kitMode,
      ownerAgentId: v.ownerAgentId,
      archivedAt: null,
    });
    return one(
      await db
        .insert(channels)
        .values({ businessId, channelKey: v.channelKey, ...patch, line: v.line })
        .onConflictDoUpdate({ target: [channels.businessId, channels.channelKey], set: patch })
        .returning(),
      "channel",
    );
  },

  /**
   * Many channels at once (router distribution.recommend, commit): rows that supply the same fields are written in one
   * statement (only supplied fields change on update, as in `upsert`), so a full set costs one round trip, not fifteen.
   * Rows come back in the order given; a repeated key keeps its last entry.
   */
  async upsertMany(db: Executor, businessId: string, inputs: UpsertChannelInput[]): Promise<Channel[]> {
    const parsed = [...new Map(inputs.map((i) => parseInput(UpsertChannelInput, i, "channel")).map((v) => [v.channelKey, v] as const)).values()];
    const groups = new Map<string, { patch: Record<string, unknown>; rows: Record<string, unknown>[] }>();
    for (const v of parsed) {
      const patch = defined({
        line: v.line,
        enabled: v.enabled,
        fit: v.fit,
        potential: numericText(v.potential) ?? undefined,
        recommended: v.recommended,
        whyMd: v.whyMd,
        budgetMinor: v.budgetMinor,
        currency: v.currency,
        kitMode: v.kitMode,
        ownerAgentId: v.ownerAgentId,
        archivedAt: null,
      }) as Record<string, unknown>;
      const fields = Object.keys(patch).sort().join(",");
      const group = groups.get(fields) ?? groups.set(fields, { patch, rows: [] }).get(fields)!;
      group.rows.push({ businessId, channelKey: v.channelKey, ...patch, line: v.line });
    }
    const written: Channel[] = [];
    for (const { patch, rows } of groups.values()) {
      const set = Object.fromEntries(Object.keys(patch).map((k) => [k, sql.raw(`excluded."${(channels[k as keyof typeof channels] as { name: string }).name}"`)]));
      written.push(...(await db.insert(channels).values(rows as (typeof channels.$inferInsert)[]).onConflictDoUpdate({ target: [channels.businessId, channels.channelKey], set }).returning()));
    }
    const byKey = new Map(written.map((r) => [r.channelKey, r] as const));
    return parsed.map((v) => byKey.get(v.channelKey)!);
  },

  async setEnabled(db: Executor, businessId: string, channelId: string, enabled: boolean): Promise<Channel> {
    return one(await db.update(channels).set({ enabled }).where(scoped(businessId, channelId)).returning(), "channel", channelId);
  },

  /** Moves a channel to another line of the formation. */
  async move(db: Executor, businessId: string, channelId: string, line: ChannelLine): Promise<Channel> {
    const l = parseInput(z.enum(CHANNEL_LINES), line, "channel line");
    return one(await db.update(channels).set({ line: l }).where(scoped(businessId, channelId)).returning(), "channel", channelId);
  },

  async setBudget(db: Executor, businessId: string, channelId: string, budgetMinor: number, currency?: string): Promise<Channel> {
    const v = parseInput(z.object({ budgetMinor: MinorAmount.nonnegative(), currency: Currency.optional() }), { budgetMinor, currency }, "channel budget");
    return one(await db.update(channels).set({ budgetMinor: v.budgetMinor, ...(v.currency ? { currency: v.currency } : {}) }).where(scoped(businessId, channelId)).returning(), "channel", channelId);
  },

  async setKitMode(db: Executor, businessId: string, channelId: string, kitMode: boolean): Promise<Channel> {
    return one(await db.update(channels).set({ kitMode }).where(scoped(businessId, channelId)).returning(), "channel", channelId);
  },

  async setEngineWorkflow(db: Executor, businessId: string, channelId: string, engineWorkflowId: string | null): Promise<Channel> {
    return one(await db.update(channels).set({ engineWorkflowId }).where(scoped(businessId, channelId)).returning(), "channel", channelId);
  },

  /**
   * Service role, for the engine reconciler (orchestrator `channelEngineReconcile`): every enabled channel of a committed
   * business that is neither archived nor stopped (0023), i.e. every channel the Board shows as running, oldest first.
   */
  async listForEngines(db: Executor, options: { limit?: number } = {}): Promise<{ businessId: string; channelId: string; channelKey: ChannelKey; engineWorkflowId: string | null }[]> {
    const rows = await db
      .select({ businessId: channels.businessId, channelId: channels.id, channelKey: channels.channelKey, engineWorkflowId: channels.engineWorkflowId })
      .from(channels)
      .innerJoin(businesses, eq(businesses.id, channels.businessId))
      .where(and(eq(channels.enabled, true), isNull(channels.archivedAt), isNull(businesses.archivedAt), isNull(businesses.agentsStoppedAt), sql`${businesses.committedAt} is not null`))
      .orderBy(asc(channels.createdAt), asc(channels.id))
      .limit(options.limit ?? 5_000);
    return rows.map((r) => ({ ...r, channelKey: r.channelKey as ChannelKey }));
  },

  async setOwner(db: Executor, businessId: string, channelId: string, ownerAgentId: string | null): Promise<Channel> {
    return one(await db.update(channels).set({ ownerAgentId }).where(scoped(businessId, channelId)).returning(), "channel", channelId);
  },

  async archive(db: Executor, businessId: string, channelId: string): Promise<Channel> {
    return one(await db.update(channels).set({ archivedAt: new Date(), enabled: false }).where(scoped(businessId, channelId)).returning(), "channel", channelId);
  },

  /** Total enabled budget per month in minor units (currency of the business's channels; mixed currencies are summed as-is and flagged). */
  async enabledBudget(db: Executor, businessId: string): Promise<{ budgetMinor: number; currencies: string[] }> {
    const rows = await db
      .select({ budget: sql<number>`coalesce(sum(${channels.budgetMinor}), 0)::bigint`, currency: channels.currency })
      .from(channels)
      .where(and(eq(channels.businessId, businessId), eq(channels.enabled, true), isNull(channels.archivedAt)))
      .groupBy(channels.currency);
    return { budgetMinor: rows.reduce((n, r) => n + Number(r.budget), 0), currencies: rows.map((r) => r.currency) };
  },

  // metrics -----------------------------------------------------------------------------------------------------------
  /** Daily rows in a date range, oldest first (the Channels tab's chart). */
  async metricsRange(db: Executor, businessId: string, filter: MetricsRangeFilter = {}): Promise<ChannelMetric[]> {
    const f = parseInput(MetricsRangeFilter, filter, "metrics range");
    return db
      .select()
      .from(channelMetrics)
      .where(
        and(
          eq(channelMetrics.businessId, businessId),
          f.channelId ? eq(channelMetrics.channelId, f.channelId) : undefined,
          f.campaignId ? eq(channelMetrics.campaignId, f.campaignId) : undefined,
          dayRange(channelMetrics.day, f),
        ),
      )
      .orderBy(asc(channelMetrics.day), asc(channelMetrics.channelId));
  },

  /** Per-channel totals over a range plus a blended CPA (spend ÷ customers). */
  async metricsSummary(db: Executor, businessId: string, range: DayRange = {}): Promise<{ channels: ChannelMetricsSummary[]; blended: Omit<ChannelMetricsSummary, "channelId" | "channelKey" | "line"> }> {
    const r = parseInput(DayRange, range, "day range");
    const rows = await db
      .select({
        channelId: channelMetrics.channelId,
        channelKey: channels.channelKey,
        line: channels.line,
        spendMinor: sql<number>`coalesce(sum(${channelMetrics.spendMinor}), 0)::bigint`,
        impressions: sql<number>`coalesce(sum(${channelMetrics.impressions}), 0)::bigint`,
        leads: sql<number>`coalesce(sum(${channelMetrics.leads}), 0)::int`,
        signups: sql<number>`coalesce(sum(${channelMetrics.signups}), 0)::int`,
        activations: sql<number>`coalesce(sum(${channelMetrics.activations}), 0)::int`,
        customers: sql<number>`coalesce(sum(${channelMetrics.customers}), 0)::int`,
        days: sql<number>`count(distinct ${channelMetrics.day})::int`,
      })
      .from(channelMetrics)
      .innerJoin(channels, eq(channels.id, channelMetrics.channelId))
      .where(and(eq(channelMetrics.businessId, businessId), eq(channels.businessId, businessId), dayRange(channelMetrics.day, r)))
      .groupBy(channelMetrics.channelId, channels.channelKey, channels.line)
      .orderBy(asc(channels.line), asc(channels.channelKey));
    const perChannel: ChannelMetricsSummary[] = rows.map((x) => {
      const spend = Number(x.spendMinor);
      const customers = Number(x.customers);
      return {
        channelId: x.channelId,
        channelKey: x.channelKey,
        line: x.line,
        spendMinor: spend,
        impressions: Number(x.impressions),
        leads: Number(x.leads),
        signups: Number(x.signups),
        activations: Number(x.activations),
        customers,
        cpaMinor: cpa(spend, customers),
        days: Number(x.days),
      };
    });
    const sum = (k: keyof Omit<ChannelMetricsSummary, "channelId" | "channelKey" | "line" | "cpaMinor">) => perChannel.reduce((n, c) => n + c[k], 0);
    const blendedSpend = sum("spendMinor");
    const blendedCustomers = sum("customers");
    return {
      channels: perChannel,
      blended: {
        spendMinor: blendedSpend,
        impressions: sum("impressions"),
        leads: sum("leads"),
        signups: sum("signups"),
        activations: sum("activations"),
        customers: blendedCustomers,
        cpaMinor: cpa(blendedSpend, blendedCustomers),
        days: perChannel.reduce((n, c) => Math.max(n, c.days), 0),
      },
    };
  },

  /** Writes one day's metrics for a channel (+ campaign); re-running replaces the day. CPA is derived. */
  async upsertMetric(db: Executor, businessId: string, input: UpsertChannelMetricInput): Promise<ChannelMetric> {
    const v = parseInput(UpsertChannelMetricInput, input, "channel metric");
    await channelsRepo.get(db, businessId, v.channelId);
    const values = {
      businessId,
      channelId: v.channelId,
      campaignId: v.campaignId ?? null,
      day: v.day,
      spendMinor: v.spendMinor,
      ...(v.currency ? { currency: v.currency } : {}),
      impressions: v.impressions,
      leads: v.leads,
      signups: v.signups,
      activations: v.activations,
      customers: v.customers,
      cpaMinor: cpa(v.spendMinor, v.customers),
    };
    // (channel_id, campaign_id, day) is unique, but a null campaign_id never conflicts: handle that case explicitly.
    if (v.campaignId == null) {
      const existing = await db
        .select({ id: channelMetrics.id })
        .from(channelMetrics)
        .where(and(eq(channelMetrics.businessId, businessId), eq(channelMetrics.channelId, v.channelId), isNull(channelMetrics.campaignId), eq(channelMetrics.day, v.day)))
        .limit(1);
      if (existing[0]) {
        return one(await db.update(channelMetrics).set(values).where(eq(channelMetrics.id, existing[0].id)).returning(), "channel metric");
      }
      return one(await db.insert(channelMetrics).values(values).returning(), "channel metric");
    }
    return one(
      await db
        .insert(channelMetrics)
        .values(values)
        .onConflictDoUpdate({ target: [channelMetrics.channelId, channelMetrics.campaignId, channelMetrics.day], set: values, setWhere: eq(channelMetrics.businessId, businessId) })
        .returning(),
      "channel metric",
    );
  },

  async upsertMetrics(db: Executor, businessId: string, inputs: UpsertChannelMetricInput[]): Promise<number> {
    const parsed = inputs.map((i) => parseInput(UpsertChannelMetricInput, i, "channel metric"));
    return db.transaction(async (tx) => {
      for (const v of parsed) await channelsRepo.upsertMetric(tx, businessId, v);
      return parsed.length;
    });
  },

  // suppression list (BUILD §11.7 "global suppression list", §9.5 context.suppressed) ------------------------------
  async listSuppression(db: Executor, businessId: string, options: { includePlatform?: boolean } = {}): Promise<SuppressionEntry[]> {
    return db
      .select()
      .from(suppressionList)
      .where(options.includePlatform ? or(eq(suppressionList.businessId, businessId), eq(suppressionList.scope, "platform")) : eq(suppressionList.businessId, businessId))
      .orderBy(desc(suppressionList.createdAt));
  },

  async addSuppression(db: Executor, businessId: string, input: AddSuppressionInput): Promise<SuppressionEntry> {
    const v = parseInput(AddSuppressionInput, input, "suppression entry");
    return one(
      await db
        .insert(suppressionList)
        .values({ businessId: v.scope === "platform" ? null : businessId, emailHash: v.emailHash ?? null, addressHash: v.addressHash ?? null, phoneHash: v.phoneHash ?? null, reason: v.reason, scope: v.scope, source: v.source ?? null })
        .returning(),
      "suppression entry",
    );
  },

  /** True when any of the hashes is suppressed for this business or platform-wide. */
  async isSuppressed(db: Executor, businessId: string, hashes: { emailHash?: string; addressHash?: string; phoneHash?: string }): Promise<boolean> {
    const checks = [
      hashes.emailHash ? eq(suppressionList.emailHash, hashes.emailHash) : undefined,
      hashes.addressHash ? eq(suppressionList.addressHash, hashes.addressHash) : undefined,
      hashes.phoneHash ? eq(suppressionList.phoneHash, hashes.phoneHash) : undefined,
    ].filter((c): c is NonNullable<typeof c> => c !== undefined);
    if (checks.length === 0) return false;
    const rows = await db
      .select({ id: suppressionList.id })
      .from(suppressionList)
      .where(and(or(eq(suppressionList.businessId, businessId), eq(suppressionList.scope, "platform")), or(...checks)))
      .limit(1);
    return rows.length > 0;
  },

  async removeSuppression(db: Executor, businessId: string, entryId: string): Promise<void> {
    await db.delete(suppressionList).where(and(eq(suppressionList.businessId, businessId), eq(suppressionList.id, entryId), inArray(suppressionList.scope, ["business"])));
  },
};
