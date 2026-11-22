/**
 * Founder-only approvals (security review, Nov 22, 2026): a made file's release (CLI-Anything), a listed remote MCP
 * tool that can change or remove a founder's records, and a hosted-browser step are approved by an owner or admin
 * only. Team › Responsibilities cannot hand them to an agent or a member, the Chief of Staff and the system cannot
 * approve them, and a grant a delegate gave before this rule cannot run one. Ordinary delegation (`sendgrid:send_mail`)
 * keeps working.
 */
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { approvals } from "../../schema";
import { founderOnlyCall, repos } from "../../repos";
import { setupRepoHarness, type RepoHarness } from "./helpers";

let r: RepoHarness;
beforeAll(async () => {
  r = await setupRepoHarness("founderonly");
  const { businessId, agentId, agent2Id, departmentId, memberId } = r.A;
  await repos.agents.update(r.db, businessId, agent2Id, { departmentIds: [departmentId] });
  await repos.agents.update(r.db, businessId, agentId, { departmentIds: [departmentId] });
  // The worst case: every decision type in the department is handed to someone. Messaging customers to the member,
  // everything else to the first agent.
  await repos.departments.update(r.db, businessId, departmentId, {
    approvers: [
      { decisionType: "message_customers", handler: { kind: "user", id: memberId } },
      { decisionType: "publish_content", handler: { kind: "agent", id: agentId } },
      { decisionType: "spend_above_threshold", handler: { kind: "agent", id: agentId } },
    ],
  });
});
afterAll(() => r?.close());

const FOUNDER_ONLY = [
  { connectorKey: "cli_inkscape", tool: "release_output" },
  { connectorKey: "cli_ffmpeg", tool: "release_output" },
  { connectorKey: "notion_mcp", tool: "notion_update_page" },
  { connectorKey: "hubspot_mcp", tool: "manage_crm_objects" },
  { connectorKey: "browser_canva", tool: "click" },
];

async function open(call: { connectorKey: string; tool: string }, decisionType: "message_customers" | "publish_content" | null = "message_customers") {
  return repos.approvals.create(r.db, r.A.businessId, { agentId: r.A.agent2Id, ...call, args: { n: Math.random() }, reasons: ["asks"], decisionType });
}

describe("founder-only calls", () => {
  it("the list names the release, the change-capable remote tools and every hosted-browser step, and not ordinary sends", () => {
    for (const c of FOUNDER_ONLY) expect(founderOnlyCall(c.connectorKey, c.tool), `${c.connectorKey}:${c.tool}`).toBe(true);
    expect(founderOnlyCall("gmail", "send_message")).toBe(true);
    expect(founderOnlyCall("sendgrid", "send_mail")).toBe(false);
    expect(founderOnlyCall("notion_mcp", "notion_search")).toBe(false);
    expect(founderOnlyCall(null, null)).toBe(false);
  });

  it("are never routed to an agent or a member, whatever decision type the caller gave", async () => {
    for (const c of FOUNDER_ONLY) {
      for (const type of ["message_customers", "publish_content"] as const) {
        const a = await open(c, type);
        expect(a.outcome, `${c.connectorKey}:${c.tool} ${type}`).toBeNull();
        expect(a.handlerKind).toBeNull();
      }
    }
  });

  it("an ordinary send is still handed to the member Responsibilities names", async () => {
    const a = await open({ connectorKey: "sendgrid", tool: "send_mail" });
    expect(a.handlerKind).toBe("user");
    expect(a.handlerId).toBe(r.A.memberId);
    const resolved = await repos.approvals.resolve(r.db, r.A.businessId, a.id, { outcome: "approved", byKind: "user", byId: r.A.memberId });
    expect(resolved.outcome).toBe("approved");
    const used = await repos.approvals.useGranted(r.db, r.A.businessId, { sessionId: null, agentId: r.A.agent2Id, connectorKey: "sendgrid", tool: "send_mail", args: a.args as Record<string, unknown> });
    expect(used?.id).toBe(a.id);
  });

  it("cannot be approved by a member, the Chief of Staff, an agent or the system; an owner and an admin can", async () => {
    for (const c of FOUNDER_ONLY) {
      const a = await open(c);
      for (const by of [{ byKind: "user" as const, byId: r.A.memberId }, { byKind: "chief_of_staff" as const, byId: r.A.agentId }, { byKind: "agent" as const, byId: r.A.agentId }, { byKind: "system" as const }]) {
        await expect(repos.approvals.resolve(r.db, r.A.businessId, a.id, { outcome: "approved", ...by }), `${c.connectorKey}:${c.tool} ${by.byKind}`).rejects.toThrow(/owner or admin/);
      }
      const decider = c.tool === "release_output" ? r.A.ownerId : r.A.adminId;
      expect((await repos.approvals.resolve(r.db, r.A.businessId, a.id, { outcome: "approved", byKind: "user", byId: decider })).outcome).toBe("approved");
    }
  });

  it("anyone may still say no or let it expire", async () => {
    const a = await open(FOUNDER_ONLY[0]!);
    expect((await repos.approvals.resolve(r.db, r.A.businessId, a.id, { outcome: "rejected", byKind: "system" })).outcome).toBe("rejected");
  });

  it("an approval whose stored decision type is null is the founder's, also for rows from before the column", async () => {
    const a = await open({ connectorKey: "stripe", tool: "finalize_invoice" }, null);
    await expect(repos.approvals.resolve(r.db, r.A.businessId, a.id, { outcome: "approved", byKind: "user", byId: r.A.memberId })).rejects.toThrow(/owner or admin/);
    expect((await repos.approvals.resolve(r.db, r.A.businessId, a.id, { outcome: "approved", byKind: "user", byId: r.A.ownerId })).outcome).toBe("approved");
  });

  it("a grant a delegate gave before this rule never runs the call", async () => {
    const { businessId, agent2Id, memberId, agentId } = r.A;
    // Written as the old routing wrote them: approved by the member, or decided by an agent at creation.
    for (const by of [{ byKind: "user" as const, byId: memberId }, { byKind: "agent" as const, byId: agentId }, { byKind: "system" as const, byId: null }]) {
      const a = await open(FOUNDER_ONLY[0]!);
      await r.db.update(approvals).set({ outcome: "approved", byKind: by.byKind, byId: by.byId, resolvedAt: new Date() }).where(eq(approvals.id, a.id));
      const gated = { sessionId: null, agentId: agent2Id, connectorKey: a.connectorKey!, tool: a.tool!, args: a.args as Record<string, unknown> };
      expect(await repos.approvals.useGranted(r.db, businessId, gated), by.byKind).toBeNull();
      expect(await repos.approvals.useDecided(r.db, businessId, a.id, null), by.byKind).toBeNull();
    }
    // A stored null type (a payment record) closed as approved by the system's bookkeeping never runs a call either.
    const payment = await open({ connectorKey: "stripe", tool: "finalize_invoice" }, null);
    await repos.approvals.resolve(r.db, businessId, payment.id, { outcome: "approved", byKind: "system" });
    expect(await repos.approvals.useGranted(r.db, businessId, { sessionId: null, agentId: agent2Id, connectorKey: "stripe", tool: "finalize_invoice", args: payment.args as Record<string, unknown> })).toBeNull();
    // The owner's own grant runs it once.
    const own = await open(FOUNDER_ONLY[0]!);
    await repos.approvals.resolve(r.db, businessId, own.id, { outcome: "approved", byKind: "user", byId: r.A.ownerId });
    expect((await repos.approvals.useGranted(r.db, businessId, { sessionId: null, agentId: agent2Id, connectorKey: own.connectorKey!, tool: own.tool!, args: own.args as Record<string, unknown> }))?.id).toBe(own.id);
  });
});
