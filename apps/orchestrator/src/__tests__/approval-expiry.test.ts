/**
 * An approval that expires says so (WP-02 T1; audit a5 GTM-02 step 4): every path that sets `outcome: "expired"` writes
 * one `approval.resolved` with outcome "expired" and closes the approval's Inbox note, so the approvals requested minus
 * the approvals resolved is the number still open. An approval with no agent writes no event (the event's agentId is
 * required) and does not throw.
 */
import { repos } from "@foundmill/db";
import { CHANNEL_META } from "@foundmill/shared";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApprovalActivities, openApprovalNote } from "../activities/approvals";
import { setupOrchestratorHarness, type OrchestratorTestHarness } from "./harness";

let t: OrchestratorTestHarness;

beforeAll(async () => {
  t = await setupOrchestratorHarness({ prefix: "apexp" });
});
afterAll(async () => {
  await t?.close();
});

async function expiredEventsFor(approvalId: string) {
  const events = (await repos.events.list(t.db, t.businessId, { type: "approval.resolved", limit: 200 })).items;
  return events.filter((e) => (e.payload as { approvalId: string }).approvalId === approvalId);
}

describe("expireApproval", () => {
  it("writes approval.resolved with outcome expired and closes the note", async () => {
    const approval = await repos.approvals.create(t.db, t.businessId, { agentId: t.workerId, connectorKey: "github", tool: "run_migration", args: { file: "0001.sql" } });
    const itemId = await openApprovalNote(t.db, t.businessId, approval, { agent: { id: t.workerId, name: "Test Engineer" } });
    const result = await createApprovalActivities(t.deps).expireApproval({ businessId: t.businessId, approvalId: approval.id });
    expect(result).toEqual({ expired: true, outcome: "expired" });
    const events = await expiredEventsFor(approval.id);
    expect(events).toHaveLength(1);
    expect(events[0]!.payload).toMatchObject({ approvalId: approval.id, agentId: t.workerId, outcome: "expired", resolvedBy: { kind: "system", id: "expiry" }, note: null });
    expect((await repos.inbox.get(t.db, t.businessId, itemId!)).state).toBe("archived");
  });

  it("writes no event for an approval with no agent, and does not throw", async () => {
    const approval = await repos.approvals.create(t.db, t.businessId, { connectorKey: "github", tool: "run_migration", args: { file: "0002.sql" } });
    await expect(createApprovalActivities(t.deps).expireApproval({ businessId: t.businessId, approvalId: approval.id })).resolves.toEqual({ expired: true, outcome: "expired" });
    expect(await expiredEventsFor(approval.id)).toHaveLength(0);
  });
});

describe("a channel taken off the board", () => {
  it("expires its open launch approval with the event and an archived note", async () => {
    const channel = await repos.channels.upsert(t.db, t.businessId, { channelKey: "email_automation", line: CHANNEL_META.email_automation.line, enabled: true, kitMode: false, ownerAgentId: t.workerId });
    const campaign = await repos.campaigns.create(t.db, t.businessId, { channelId: channel.id, name: "Week 1", status: "pending_approval" });
    const approval = await repos.approvals.create(t.db, t.businessId, { agentId: t.workerId, connectorKey: "channel", tool: "launch_campaign", args: { campaignId: campaign.id } });
    const itemId = await openApprovalNote(t.db, t.businessId, approval, { agent: { id: t.workerId, name: "Test Engineer" } });

    const { expiredApprovals } = await repos.campaigns.endForChannel(t.db, t.businessId, channel.id);
    expect(expiredApprovals.map((a) => a.id)).toEqual([approval.id]);
    const { recordExpiredApprovals } = await import("@foundmill/events");
    await recordExpiredApprovals(t.db, t.businessId, expiredApprovals, new Date());

    expect(await expiredEventsFor(approval.id)).toHaveLength(1);
    expect((await repos.inbox.get(t.db, t.businessId, itemId!)).state).toBe("archived");
    expect((await repos.approvals.get(t.db, t.businessId, approval.id)).outcome).toBe("expired");
  });
});
