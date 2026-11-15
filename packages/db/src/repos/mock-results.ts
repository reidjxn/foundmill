/**
 * Generated results left on people's projects before the guards (WP-02 T4; audit a5 GTM-02, GTM-10, GTM-16): leads
 * the channel engine made up (addresses ending in `.example`, `source` a channel key), channel numbers it estimated
 * (`channel_metrics.source = 'estimate'`), `mock` integration rows, campaigns left `live` on a channel that is not in
 * offline tracking, and their open launch approvals. `find` only reads; `remove` changes one business's rows and
 * returns what it changed. The orchestrator's `cleanMockResults` decides which businesses (never a sample one).
 */
import { CHANNEL_KEYS } from "@foundmill/shared";
import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import { approvals, campaigns, channelMetrics, channels, entities, entityRoles, integrations, type Approval } from "../schema";
import type { Executor } from "./_shared";
import { integrationsRepo } from "./integrations";

export interface MockResultsFound {
  leadEntityIds: string[];
  metricRows: number;
  mockIntegrationIds: string[];
  liveCampaignIds: string[];
  openLaunchApprovalIds: string[];
}

/** Channels whose campaigns are sent by the product, not by the founder (not offline tracking). */
const sentByProduct = (businessId: string) => and(eq(channels.businessId, businessId), eq(channels.kitMode, false));

export const mockResultsRepo = {
  async find(db: Executor, businessId: string): Promise<MockResultsFound> {
    const leads = await db
      .select({ id: entities.id })
      .from(entities)
      .where(and(eq(entities.businessId, businessId), isNull(entities.archivedAt), sql`${entities.identifiers} ->> 'email' like '%.example'`, inArray(entities.source, [...CHANNEL_KEYS])));
    const metrics = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(channelMetrics)
      .where(and(eq(channelMetrics.businessId, businessId), eq(channelMetrics.source, "estimate")));
    const mocks = await db
      .select({ id: integrations.id })
      .from(integrations)
      .where(and(eq(integrations.businessId, businessId), eq(integrations.status, "mock"), isNull(integrations.archivedAt)));
    const live = await db
      .select({ id: campaigns.id })
      .from(campaigns)
      .innerJoin(channels, eq(channels.id, campaigns.channelId))
      .where(and(eq(campaigns.businessId, businessId), eq(campaigns.status, "live"), sentByProduct(businessId)));
    const keys = (await db.select({ key: channels.channelKey }).from(channels).where(sentByProduct(businessId))).map((r) => r.key);
    const open = keys.length
      ? await db
          .select({ id: approvals.id })
          .from(approvals)
          .where(and(eq(approvals.businessId, businessId), eq(approvals.tool, "launch_campaign"), isNull(approvals.resolvedAt), inArray(sql<string>`${approvals.args} ->> 'channelKey'`, keys)))
      : [];
    return { leadEntityIds: leads.map((r) => r.id), metricRows: Number(metrics[0]?.n ?? 0), mockIntegrationIds: mocks.map((r) => r.id), liveCampaignIds: live.map((r) => r.id), openLaunchApprovalIds: open.map((r) => r.id) };
  },

  /**
   * Removes what `find` found: lead roles ended and the entities archived the way the CRM archives one (never deleted:
   * their `lead.created` events keep pointing at them), the estimated channel rows deleted, the mock integrations
   * archived through the Disconnect path (a mock row has no credential), the live campaigns ended and their open launch
   * approvals expired. Returns the expired approvals for the caller to record (`recordExpiredApprovals`).
   */
  async remove(db: Executor, businessId: string, found: MockResultsFound, now = new Date()): Promise<{ expiredApprovals: Approval[] }> {
    if (found.leadEntityIds.length) {
      await db.update(entityRoles).set({ endedAt: now }).where(and(eq(entityRoles.businessId, businessId), inArray(entityRoles.entityId, found.leadEntityIds), eq(entityRoles.role, "lead"), isNull(entityRoles.endedAt)));
      await db.update(entities).set({ archivedAt: now }).where(and(eq(entities.businessId, businessId), inArray(entities.id, found.leadEntityIds)));
    }
    if (found.metricRows) await db.delete(channelMetrics).where(and(eq(channelMetrics.businessId, businessId), eq(channelMetrics.source, "estimate")));
    for (const id of found.mockIntegrationIds) await integrationsRepo.archive(db, businessId, id);
    if (found.liveCampaignIds.length) await db.update(campaigns).set({ status: "ended", endsAt: now }).where(and(eq(campaigns.businessId, businessId), inArray(campaigns.id, found.liveCampaignIds)));
    const expiredApprovals = found.openLaunchApprovalIds.length
      ? await db.update(approvals).set({ outcome: "expired", byKind: "system", resolvedAt: now }).where(and(eq(approvals.businessId, businessId), inArray(approvals.id, found.openLaunchApprovalIds), isNull(approvals.resolvedAt))).returning()
      : [];
    return { expiredApprovals };
  },
};
