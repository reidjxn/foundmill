/**
 * campaigns + assets — what a channel engine runs and produces (BUILD §11.7; routers distribution.campaigns.*,
 * distribution.assets.approve/reject).
 */
import { APPROVAL_STATES, ASSET_KINDS, CAMPAIGN_STATUSES, ValidationError, type CampaignStatus } from "@founder-manager/shared";
import { and, asc, desc, eq, inArray, isNull } from "drizzle-orm";
import { z } from "zod";
import { assets, campaigns, channels, type Asset, type Campaign } from "../schema";
import { Currency, defined, Id, IsoDateInput, JsonObject, MinorAmount, one, PageInput, parseInput, timeKeyset, toPage, type Executor, type Page, patchSchema } from "./_shared";

export const CreateCampaignInput = z.object({
  channelId: Id,
  name: z.string().trim().min(1).max(160),
  goal: z.string().max(400).default(""),
  status: z.enum(CAMPAIGN_STATUSES).default("draft"),
  budgetMinor: MinorAmount.nonnegative().default(0),
  currency: Currency.optional(),
  startsAt: IsoDateInput.nullable().optional(),
  endsAt: IsoDateInput.nullable().optional(),
  config: JsonObject.default({}),
});
export type CreateCampaignInput = z.input<typeof CreateCampaignInput>;

export const UpdateCampaignInput = patchSchema(CreateCampaignInput.omit({ channelId: true, status: true }));
export type UpdateCampaignInput = z.input<typeof UpdateCampaignInput>;

export const CampaignListFilter = PageInput.extend({
  channelId: Id.optional(),
  status: z.union([z.enum(CAMPAIGN_STATUSES), z.array(z.enum(CAMPAIGN_STATUSES))]).optional(),
  includeArchived: z.boolean().default(false),
});
export type CampaignListFilter = z.input<typeof CampaignListFilter>;

export const CreateAssetInput = z.object({
  campaignId: Id.nullable().optional(),
  kind: z.enum(ASSET_KINDS),
  title: z.string().max(200).default(""),
  contentRef: z.string().max(2048).nullable().optional(),
  approvalState: z.enum(APPROVAL_STATES).default("draft"),
  authoredByAgentId: Id.nullable().optional(),
});
export type CreateAssetInput = z.input<typeof CreateAssetInput>;

export const AssetListFilter = z.object({
  campaignId: Id.optional(),
  kind: z.enum(ASSET_KINDS).optional(),
  approvalState: z.union([z.enum(APPROVAL_STATES), z.array(z.enum(APPROVAL_STATES))]).optional(),
  includeArchived: z.boolean().default(false),
});
export type AssetListFilter = z.input<typeof AssetListFilter>;

/** Allowed status moves (BUILD §11.7 engine: plan → create → approve → launch → measure → learn). */
export const CAMPAIGN_TRANSITIONS: Record<CampaignStatus, readonly CampaignStatus[]> = {
  draft: ["pending_approval", "scheduled", "ended"],
  pending_approval: ["draft", "scheduled", "live", "ended"],
  scheduled: ["live", "paused", "draft", "ended"],
  live: ["paused", "ended"],
  paused: ["live", "ended"],
  ended: [],
};

const scoped = (businessId: string, campaignId: string) => and(eq(campaigns.businessId, businessId), eq(campaigns.id, campaignId));
const scopedAsset = (businessId: string, assetId: string) => and(eq(assets.businessId, businessId), eq(assets.id, assetId));

export const campaignsRepo = {
  async list(db: Executor, businessId: string, filter: CampaignListFilter = {}): Promise<Page<Campaign>> {
    const f = parseInput(CampaignListFilter, filter, "campaign filter");
    const ks = timeKeyset<Campaign>(campaigns.createdAt, campaigns.id, (r) => ({ at: r.createdAt, id: r.id }));
    const statuses = f.status === undefined ? undefined : Array.isArray(f.status) ? f.status : [f.status];
    const rows = await db
      .select()
      .from(campaigns)
      .where(
        and(
          eq(campaigns.businessId, businessId),
          f.includeArchived ? undefined : isNull(campaigns.archivedAt),
          f.channelId ? eq(campaigns.channelId, f.channelId) : undefined,
          statuses?.length ? inArray(campaigns.status, statuses) : undefined,
          ks.after(f.cursor),
        ),
      )
      .orderBy(...ks.orderBy)
      .limit(f.limit + 1);
    return toPage(rows, f, ks);
  },

  async get(db: Executor, businessId: string, campaignId: string): Promise<Campaign> {
    return one(await db.select().from(campaigns).where(scoped(businessId, campaignId)).limit(1), "campaign", campaignId);
  },

  /** Live and scheduled campaigns (what the engines are running right now). */
  async active(db: Executor, businessId: string): Promise<Campaign[]> {
    return db
      .select()
      .from(campaigns)
      .where(and(eq(campaigns.businessId, businessId), isNull(campaigns.archivedAt), inArray(campaigns.status, ["scheduled", "live"])))
      .orderBy(asc(campaigns.startsAt), asc(campaigns.createdAt));
  },

  async create(db: Executor, businessId: string, input: CreateCampaignInput): Promise<Campaign> {
    const v = parseInput(CreateCampaignInput, input, "campaign");
    const channel = await db.select({ id: channels.id }).from(channels).where(and(eq(channels.businessId, businessId), eq(channels.id, v.channelId))).limit(1);
    if (channel.length === 0) throw new ValidationError("channelId is not a channel of this business", { channelId: v.channelId });
    if (v.startsAt && v.endsAt && v.endsAt < v.startsAt) throw new ValidationError("endsAt is before startsAt", { startsAt: v.startsAt, endsAt: v.endsAt });
    return one(
      await db
        .insert(campaigns)
        .values({
          businessId,
          channelId: v.channelId,
          name: v.name,
          goal: v.goal,
          status: v.status,
          budgetMinor: v.budgetMinor,
          ...(v.currency ? { currency: v.currency } : {}),
          startsAt: v.startsAt ?? null,
          endsAt: v.endsAt ?? null,
          config: v.config,
        })
        .returning(),
      "campaign",
    );
  },

  async update(db: Executor, businessId: string, campaignId: string, input: UpdateCampaignInput): Promise<Campaign> {
    const v = parseInput(UpdateCampaignInput, input, "campaign update");
    return one(await db.update(campaigns).set(defined(v)).where(scoped(businessId, campaignId)).returning(), "campaign", campaignId);
  },

  async setStatus(db: Executor, businessId: string, campaignId: string, status: CampaignStatus, options: { force?: boolean } = {}): Promise<Campaign> {
    const s = parseInput(z.enum(CAMPAIGN_STATUSES), status, "campaign status");
    return db.transaction(async (tx) => {
      const current = await campaignsRepo.get(tx, businessId, campaignId);
      if (current.status === s) return current;
      if (!options.force && !CAMPAIGN_TRANSITIONS[current.status].includes(s)) {
        throw new ValidationError(`Campaign cannot move from ${current.status} to ${s}`, { campaignId, from: current.status, to: s });
      }
      const now = new Date();
      return one(
        await tx
          .update(campaigns)
          .set({ status: s, ...(s === "live" && !current.startsAt ? { startsAt: now } : {}), ...(s === "ended" ? { endsAt: current.endsAt && current.endsAt < now ? current.endsAt : now } : {}) })
          .where(scoped(businessId, campaignId))
          .returning(),
        "campaign",
        campaignId,
      );
    });
  },

  async archive(db: Executor, businessId: string, campaignId: string): Promise<Campaign> {
    return one(await db.update(campaigns).set({ archivedAt: new Date() }).where(scoped(businessId, campaignId)).returning(), "campaign", campaignId);
  },

  /** Budget committed to campaigns per channel (live, scheduled and pending). */
  async budgetByChannel(db: Executor, businessId: string): Promise<Record<string, number>> {
    const rows = await db
      .select({ channelId: campaigns.channelId, budget: campaigns.budgetMinor })
      .from(campaigns)
      .where(and(eq(campaigns.businessId, businessId), isNull(campaigns.archivedAt), inArray(campaigns.status, ["pending_approval", "scheduled", "live", "paused"])));
    const out: Record<string, number> = {};
    for (const r of rows) out[r.channelId] = (out[r.channelId] ?? 0) + Number(r.budget);
    return out;
  },

  // assets ------------------------------------------------------------------------------------------------------------
  async listAssets(db: Executor, businessId: string, filter: AssetListFilter = {}): Promise<Asset[]> {
    const f = parseInput(AssetListFilter, filter, "asset filter");
    const states = f.approvalState === undefined ? undefined : Array.isArray(f.approvalState) ? f.approvalState : [f.approvalState];
    return db
      .select()
      .from(assets)
      .where(
        and(
          eq(assets.businessId, businessId),
          f.includeArchived ? undefined : isNull(assets.archivedAt),
          f.campaignId ? eq(assets.campaignId, f.campaignId) : undefined,
          f.kind ? eq(assets.kind, f.kind) : undefined,
          states?.length ? inArray(assets.approvalState, states) : undefined,
        ),
      )
      .orderBy(desc(assets.createdAt));
  },

  async getAsset(db: Executor, businessId: string, assetId: string): Promise<Asset> {
    return one(await db.select().from(assets).where(scopedAsset(businessId, assetId)).limit(1), "asset", assetId);
  },

  async createAsset(db: Executor, businessId: string, input: CreateAssetInput): Promise<Asset> {
    const v = parseInput(CreateAssetInput, input, "asset");
    if (v.campaignId) await campaignsRepo.get(db, businessId, v.campaignId);
    return one(
      await db
        .insert(assets)
        .values({ businessId, campaignId: v.campaignId ?? null, kind: v.kind, title: v.title, contentRef: v.contentRef ?? null, approvalState: v.approvalState, authoredByAgentId: v.authoredByAgentId ?? null })
        .returning(),
      "asset",
    );
  },

  async updateAsset(db: Executor, businessId: string, assetId: string, input: { title?: string; contentRef?: string | null }): Promise<Asset> {
    const v = parseInput(z.object({ title: z.string().max(200).optional(), contentRef: z.string().max(2048).nullable().optional() }), input, "asset update");
    return one(await db.update(assets).set(defined(v)).where(scopedAsset(businessId, assetId)).returning(), "asset", assetId);
  },

  /** draft → pending → approved | rejected (router distribution.assets.approve/reject). */
  async setAssetApproval(db: Executor, businessId: string, assetId: string, approvalState: (typeof APPROVAL_STATES)[number]): Promise<Asset> {
    const s = parseInput(z.enum(APPROVAL_STATES), approvalState, "approval state");
    return one(await db.update(assets).set({ approvalState: s }).where(scopedAsset(businessId, assetId)).returning(), "asset", assetId);
  },

  async archiveAsset(db: Executor, businessId: string, assetId: string): Promise<Asset> {
    return one(await db.update(assets).set({ archivedAt: new Date() }).where(scopedAsset(businessId, assetId)).returning(), "asset", assetId);
  },

  /** Assets waiting for the founder (the Approvals widget count). */
  async countPendingAssets(db: Executor, businessId: string): Promise<number> {
    const rows = await db.select({ id: assets.id }).from(assets).where(and(eq(assets.businessId, businessId), isNull(assets.archivedAt), eq(assets.approvalState, "pending")));
    return rows.length;
  },
};
