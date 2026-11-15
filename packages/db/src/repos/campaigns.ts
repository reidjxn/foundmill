/**
 * campaigns + assets — what a channel engine runs and produces (BUILD §11.7; routers distribution.campaigns.*,
 * distribution.assets.approve/reject).
 */
import { INPUT_LIMITS } from "@foundmill/config";
import { APPROVAL_STATES, ASSET_KINDS, boundedRecord, CAMPAIGN_STATUSES, ValidationError, type CampaignStatus } from "@foundmill/shared";
import { and, asc, desc, eq, inArray, isNotNull, isNull, ne, sql } from "drizzle-orm";
import { z } from "zod";
import { approvals, assets, campaigns, channels, type Asset, type Campaign } from "../schema";
import { Currency, changes, defined, Id, IsoDateInput, JsonObject, MinorAmount, one, PageInput, parseInput, timeKeyset, toPage, type Executor, type Page, patchSchema } from "./_shared";

export const CreateCampaignInput = z.object({
  channelId: Id,
  name: z.string().trim().min(1).max(160),
  goal: z.string().max(400).default(""),
  status: z.enum(CAMPAIGN_STATUSES).default("draft"),
  budgetMinor: MinorAmount.nonnegative().default(0),
  currency: Currency.optional(),
  startsAt: IsoDateInput.nullable().optional(),
  endsAt: IsoDateInput.nullable().optional(),
  config: boundedRecord(INPUT_LIMITS.jsonObjectKeys, JsonObject).default({}),
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
  /** The drafted text (0028). */
  body: z.string().max(8000).nullable().optional(),
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

/**
 * Allowed status moves (BUILD §11.7 engine: plan → create → approve → launch → measure → learn). A paused campaign
 * resumes to the status it was paused from (`config.pausedFrom`): live again, or still scheduled.
 */
export const CAMPAIGN_TRANSITIONS: Record<CampaignStatus, readonly CampaignStatus[]> = {
  draft: ["pending_approval", "scheduled", "ended"],
  pending_approval: ["draft", "scheduled", "live", "ended"],
  scheduled: ["live", "paused", "draft", "ended"],
  live: ["paused", "ended"],
  paused: ["live", "scheduled", "ended"],
  ended: [],
};

/** The bookkeeping `setStatus` keeps in a campaign's `config`. */
export interface CampaignLaunchState {
  /** When the campaign first went live (set once; a resume never sets it again). */
  launchedAt?: string;
  /** The status a paused campaign was paused from (`live` or `scheduled`), restored on resume. */
  pausedFrom?: CampaignStatus;
}

function launchState(c: Pick<Campaign, "config">): CampaignLaunchState {
  const config = (c.config ?? {}) as Record<string, unknown>;
  return {
    launchedAt: typeof config.launchedAt === "string" ? config.launchedAt : undefined,
    pausedFrom: typeof config.pausedFrom === "string" && (CAMPAIGN_STATUSES as readonly string[]).includes(config.pausedFrom) ? (config.pausedFrom as CampaignStatus) : undefined,
  };
}

/**
 * Whether the campaign has ever gone live. Going live after that is a resume, not a launch: no new
 * `campaign.launched`, and the approved-asset rule (checked at the first launch) is not asked again. A campaign paused
 * before this bookkeeping existed counts as launched unless it was paused while scheduled.
 */
export function hasLaunched(c: Pick<Campaign, "status" | "config">): boolean {
  const s = launchState(c);
  if (s.launchedAt || c.status === "live") return true;
  return c.status === "paused" && s.pausedFrom !== "scheduled";
}

/** Where Resume takes a paused campaign: back to scheduled when it was paused before it went live, else live. */
export function resumeStatus(c: Pick<Campaign, "status" | "config">): CampaignStatus {
  return launchState(c).pausedFrom === "scheduled" ? "scheduled" : "live";
}

/** Campaigns that have not ended: what taking a channel off the board ends. */
const OPEN_STATUSES = CAMPAIGN_STATUSES.filter((s) => s !== "ended");

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

  /** Edits a campaign. The dates are checked as they will be stored (the patch over the row), as `create` checks them. */
  async update(db: Executor, businessId: string, campaignId: string, input: UpdateCampaignInput): Promise<Campaign> {
    const v = parseInput(UpdateCampaignInput, input, "campaign update");
    return db.transaction(async (tx) => {
      if (v.startsAt !== undefined || v.endsAt !== undefined) {
        const current = one(await tx.select().from(campaigns).where(scoped(businessId, campaignId)).for("update").limit(1), "campaign", campaignId);
        const startsAt = v.startsAt === undefined ? current.startsAt : v.startsAt;
        const endsAt = v.endsAt === undefined ? current.endsAt : v.endsAt;
        if (startsAt && endsAt && endsAt < startsAt) throw new ValidationError("endsAt is before startsAt", { startsAt, endsAt });
      }
      return one(await tx.update(campaigns).set(changes(v, "campaign")).where(scoped(businessId, campaignId)).returning(), "campaign", campaignId);
    });
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
      // Launch bookkeeping: when it first went live, and what a pause interrupted (so Resume restores it).
      const { pausedFrom: _resumed, ...config } = (current.config ?? {}) as Record<string, unknown>;
      if (s === "paused") config.pausedFrom = current.status;
      if (s === "live" && typeof config.launchedAt !== "string" && !hasLaunched(current)) config.launchedAt = now.toISOString();
      return one(
        await tx
          .update(campaigns)
          .set({ status: s, config, ...(s === "live" && !current.startsAt ? { startsAt: now } : {}), ...(s === "ended" ? { endsAt: current.endsAt && current.endsAt < now ? current.endsAt : now } : {}) })
          .where(scoped(businessId, campaignId))
          .returning(),
        "campaign",
        campaignId,
      );
    });
  },

  /** Whether any campaign of the channel ever went live (`starts_at` is stamped on the first move to live). */
  async channelHasLaunched(db: Executor, businessId: string, channelId: string): Promise<boolean> {
    const rows = await db
      .select({ id: campaigns.id })
      .from(campaigns)
      .where(and(eq(campaigns.businessId, businessId), eq(campaigns.channelId, channelId), isNotNull(campaigns.startsAt)))
      .limit(1);
    return rows.length > 0;
  },

  async archive(db: Executor, businessId: string, campaignId: string): Promise<Campaign> {
    return one(await db.update(campaigns).set({ archivedAt: new Date() }).where(scoped(businessId, campaignId)).returning(), "campaign", campaignId);
  },

  /**
   * Ends every open campaign of a channel (draft, waiting for approval, scheduled, live or paused) and expires the
   * pending launch approvals the engine asked for them: taking a channel off the board is the full stop (DECISIONS
   * 2026-10-07), so nothing keeps spending on it. Returns the campaigns it ended.
   */
  async endForChannel(db: Executor, businessId: string, channelId: string): Promise<Campaign[]> {
    const ended = await db
      .update(campaigns)
      .set({ status: "ended", endsAt: sql`case when ${campaigns.endsAt} is not null and ${campaigns.endsAt} < now() then ${campaigns.endsAt} else now() end` })
      .where(and(eq(campaigns.businessId, businessId), eq(campaigns.channelId, channelId), inArray(campaigns.status, OPEN_STATUSES)))
      .returning();
    if (ended.length) {
      await db
        .update(approvals)
        .set({ outcome: "expired", byKind: "system", resolvedAt: new Date() })
        .where(and(eq(approvals.businessId, businessId), isNull(approvals.resolvedAt), eq(approvals.tool, "launch_campaign"), inArray(sql<string>`${approvals.args} ->> 'campaignId'`, ended.map((c) => c.id))));
    }
    return ended;
  },

  /**
   * The channel's most recent campaign that actually went live (live, paused or ended after a launch), other than
   * `exceptId`; null when none has. The engine's approve step reads it: a channel's first campaign is a new campaign.
   */
  async lastLaunched(db: Executor, businessId: string, channelId: string, exceptId?: string): Promise<Campaign | null> {
    const rows = await db
      .select()
      .from(campaigns)
      .where(
        and(
          eq(campaigns.businessId, businessId),
          eq(campaigns.channelId, channelId),
          inArray(campaigns.status, ["live", "paused", "ended"]),
          isNotNull(campaigns.startsAt),
          exceptId ? ne(campaigns.id, exceptId) : undefined,
        ),
      )
      .orderBy(desc(campaigns.startsAt))
      .limit(1);
    return rows[0] ?? null;
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
        .values({ businessId, campaignId: v.campaignId ?? null, kind: v.kind, title: v.title, contentRef: v.contentRef ?? null, body: v.body ?? null, approvalState: v.approvalState, authoredByAgentId: v.authoredByAgentId ?? null })
        .returning(),
      "asset",
    );
  },

  async updateAsset(db: Executor, businessId: string, assetId: string, input: { title?: string; contentRef?: string | null }): Promise<Asset> {
    const v = parseInput(z.object({ title: z.string().max(200).optional(), contentRef: z.string().max(2048).nullable().optional() }), input, "asset update");
    return one(await db.update(assets).set(changes(v, "asset")).where(scopedAsset(businessId, assetId)).returning(), "asset", assetId);
  },

  /** draft → pending → approved | rejected (router distribution.assets.approve/reject). */
  async setAssetApproval(db: Executor, businessId: string, assetId: string, approvalState: (typeof APPROVAL_STATES)[number]): Promise<Asset> {
    const s = parseInput(z.enum(APPROVAL_STATES), approvalState, "approval state");
    return one(await db.update(assets).set({ approvalState: s }).where(scopedAsset(businessId, assetId)).returning(), "asset", assetId);
  },

  /**
   * The founder approved a campaign's launch (or the business runs automated within its caps): every draft or pending
   * asset of the campaign is approved with it. Assets the founder rejected stay rejected. Returns the approved ids.
   */
  async approveCampaignAssets(db: Executor, businessId: string, campaignId: string): Promise<string[]> {
    const rows = await db
      .update(assets)
      .set({ approvalState: "approved" })
      .where(and(eq(assets.businessId, businessId), eq(assets.campaignId, campaignId), isNull(assets.archivedAt), inArray(assets.approvalState, ["draft", "pending"])))
      .returning({ id: assets.id });
    return rows.map((r) => r.id);
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
