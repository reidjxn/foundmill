/**
 * Who may do what (audit W15; SECURITY_REVIEW SEC-7):
 *
 * - #98  an admin walled from Team cannot rewrite staff memberships, and an admin walled from any exported section
 *        cannot take it out through business.export.
 * - #107 a member cannot raise autonomy or caps, switch negotiation, give an agent new tools or promote a version that
 *        does (or roll back to one), or answer an agent's approval nobody handed to them; caps are bounded.
 * - #113 agent.profile.update takes the profile's own fields only (autonomy, negotiation, model are a 400).
 * - #250 a member with Inbox write cannot confirm a plan whose spend asked the founder first.
 * - #100 journey.* follow the Distribution, Finance and CRM walls; the Ribbon keeps its shape for walled staff.
 */
import { getTemplateByAgentType } from "@foundmill/agents";
import { LIMITS } from "@foundmill/config";
import { repos, type InboxItem } from "@foundmill/db";
import { TRPCError } from "@trpc/server";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { approvalDecisionType, mayDecide } from "../services/approver";
import { widensGrants } from "../routers/agent";
import { createApiHarness, type ApiHarness } from "./harness";

let hz: ApiHarness;
beforeAll(async () => {
  hz = await createApiHarness({ prefix: "authority" });
}, 120_000);
afterAll(() => hz.close());

const code = async (p: Promise<unknown>) => {
  try {
    await p;
    return "OK";
  } catch (err) {
    return err instanceof TRPCError ? err.code : `other:${String(err)}`;
  }
};

const as = (userId: string) => hz.caller({ userId });
const walls = (userId: string, sections: Record<string, "none" | "read" | "write">) => repos.memberships.setSectionPermissions(hz.db, hz.A.businessId, userId, sections);

async function decisionItem(subject: string): Promise<InboxItem> {
  return repos.inbox.createItem(hz.db, hz.A.businessId, {
    type: "decision",
    from_agent_id: hz.A.agentId,
    subject,
    body_md: "The team needs a steer.",
    status_strip: [],
    exhibit: { kind: "none", spec_ref: null },
    decision: { options: [{ id: "go", label: "Go ahead", recommended: true, consequence: "", cost_minor: 0, reversible: true }, { id: "wait", label: "Wait a week", recommended: false, consequence: "", cost_minor: 0, reversible: true }], free_text: true, expires_at: null },
    blocks_continue: true,
    source_event_ids: [],
    entity_ids: [],
  });
}

describe("#98 staff permissions hold for admins", () => {
  it("an admin walled from Team cannot invite, change or remove staff; an owner still can", async () => {
    const { businessId, adminId, viewerId } = hz.A;
    await walls(adminId, { team: "none" });
    try {
      const outsider = await hz.h.createUser("authority-outsider@test.local");
      expect(await code(as(adminId).invitation.create({ businessId, role: "collaborator" }))).toBe("FORBIDDEN");
      expect(await code(as(adminId).invitation.revoke({ businessId, invitationId: outsider }))).toBe("FORBIDDEN");
      expect(await code(as(adminId).team.humans.role({ businessId, userId: viewerId, sectionPermissions: { finance: "write" } }))).toBe("FORBIDDEN");
      expect(await code(as(adminId).team.humans.remove({ businessId, userId: viewerId }))).toBe("FORBIDDEN");
      // Nor can it lift its own wall by role (and accepting an invitation never changes an existing member).
      expect(await code(as(adminId).team.humans.role({ businessId, userId: adminId, sectionPermissions: {} }))).not.toBe("OK");
      expect((await repos.memberships.get(hz.db, businessId, adminId))?.sectionPermissions).toEqual({ team: "none" });
      expect(await code(as(hz.A.ownerId).team.humans.role({ businessId, userId: viewerId, sectionPermissions: { finance: "read" } }))).toBe("OK");
    } finally {
      await walls(adminId, {});
      await walls(viewerId, {});
    }
  });

  it("business.export needs read access to every exported section: a walled admin is refused, an owner exports", async () => {
    const { businessId, adminId, ownerId } = hz.A;
    // Finance and CRM content is quoted in tables filed under other sections (Inbox notes, approvals, journeys), so a
    // wall cannot be kept by leaving out whole tables: the export is refused instead (DECISIONS 2026-10-13, W15).
    const refused: Record<string, "none">[] = [{ finance: "none" }, { crm: "none" }, { finance: "none", billing: "none" }];
    for (const wall of refused) {
      await walls(adminId, wall);
      try {
        expect(await code(as(adminId).business.export({ businessId }))).toBe("FORBIDDEN");
        expect(await code(as(ownerId).business.export({ businessId }))).toBe("OK");
      } finally {
        await walls(adminId, {});
      }
    }
    // Read access is enough.
    await walls(adminId, { finance: "read", crm: "read" });
    try {
      expect(await code(as(adminId).business.export({ businessId }))).toBe("OK");
    } finally {
      await walls(adminId, {});
    }
    // A wall on billing alone does not stop an export; its tables are left out and the archive says so.
    await walls(adminId, { billing: "none" });
    try {
      const result = await as(adminId).business.export({ businessId });
      expect(result.archive.tables.usage_ledger).toBeUndefined();
      expect(result.archive.excluded.map((e) => e.what)).toContain("The billing section");
    } finally {
      await walls(adminId, {});
    }
  });
});

describe("#107 a member cannot widen what an agent does on its own", () => {
  it("autonomy and negotiation are owners' and admins'; caps are bounded", async () => {
    const { businessId, memberId, adminId, agent2Id } = hz.A;
    expect(await code(as(memberId).agent.autonomy.set({ businessId, agentId: agent2Id, autonomy: { mode: "higher", spendCapMinor: 99_999_999, approvalThresholdMinor: 99_999_999 }, applyScope: "all" }))).toBe("FORBIDDEN");
    expect(await code(as(memberId).agent.negotiation.set({ businessId, agentId: agent2Id, negotiation: { enabled: false, topics: [] } }))).toBe("FORBIDDEN");
    expect(await code(as(adminId).agent.autonomy.set({ businessId, agentId: agent2Id, autonomy: { mode: "higher", spendCapMinor: LIMITS.agentCapMaxMinor + 1 } }))).toBe("BAD_REQUEST");
    expect(await code(as(adminId).agent.autonomy.set({ businessId, agentId: agent2Id, autonomy: { mode: "inherit", spendCapMinor: 5_000, approvalThresholdMinor: 10_000 } }))).toBe("OK");
    const agent = await repos.agents.get(hz.db, businessId, agent2Id);
    expect(agent.autonomy).toMatchObject({ mode: "inherit", spendCapMinor: 5_000, approvalThresholdMinor: 10_000 });
  });

  it("new tool grants are an owner's or admin's; a member may still save instructions and remove tools", async () => {
    const { businessId, memberId, adminId, agentId } = hz.A;
    const live = await repos.agents.get(hz.db, businessId, agentId);
    const instructions = { role: "Plans the round of work", goals: ["Keep the team moving"], rules: ["Ask before spending"], playbook: ["Read the brief"], tone: "Plain", examples: [] };
    // Adding a tool: refused for the member.
    const widen = as(memberId).agent.training.saveDraft({ businessId, agentId, instructions, tools: [{ connectorKey: "stripe", tools: ["create_coupon"] }] });
    expect(await code(widen)).toBe("FORBIDDEN");
    // Same or fewer tools: fine.
    expect(await code(as(memberId).agent.training.saveDraft({ businessId, agentId, instructions }))).toBe("OK");
    // The admin may grant; a member may not promote that version.
    const draft = await as(adminId).agent.training.saveDraft({ businessId, agentId, instructions, tools: [{ connectorKey: "stripe", tools: ["create_coupon"] }] });
    const run = await repos.training.create(hz.db, businessId, { agentId, fromVersionId: live.currentVersionId, toVersionId: draft.version.id, status: "awaiting_decision", requestedBy: adminId });
    expect(await code(as(memberId).agent.training.promote({ businessId, runId: run.id }))).toBe("FORBIDDEN");
    expect(await code(as(adminId).agent.training.promote({ businessId, runId: run.id }))).toBe("OK");
  });

  it("a member cannot roll an agent back to a version with tools an owner or admin took away; an owner can", async () => {
    const { businessId, memberId, adminId, ownerId, agent2Id } = hz.A;
    const instructions = { role: "Builds the product", goals: ["Ship the onboarding"], rules: ["Ask before spending"], playbook: ["Read the brief"], tone: "Plain", examples: [] };
    // v1 grants a send; the admin takes it away and makes the narrower version live, so the wider one is retired.
    const wide = await repos.agents.createVersion(hz.db, businessId, agent2Id, { instructions, tools: [{ connectorKey: "sendgrid", tools: ["send_mail", "create_contact"] }], modelKey: "sonnet", state: "draft", createdByKind: "user", createdBy: ownerId });
    await repos.agents.promoteVersion(hz.db, businessId, agent2Id, wide.id);
    const narrow = await as(adminId).agent.training.saveDraft({ businessId, agentId: agent2Id, instructions, tools: [{ connectorKey: "sendgrid", tools: ["create_contact"] }] });
    const run = await repos.training.create(hz.db, businessId, { agentId: agent2Id, fromVersionId: wide.id, toVersionId: narrow.version.id, status: "awaiting_decision", requestedBy: adminId });
    expect(await code(as(adminId).agent.training.promote({ businessId, runId: run.id }))).toBe("OK");
    expect((await repos.agents.get(hz.db, businessId, agent2Id)).currentVersionId).toBe(narrow.version.id);
    // The member's rollback would give the send back: refused, and the narrower version stays live.
    expect(await code(as(memberId).agent.training.rollback({ businessId, agentId: agent2Id }))).toBe("FORBIDDEN");
    expect((await repos.agents.get(hz.db, businessId, agent2Id)).currentVersionId).toBe(narrow.version.id);
    // The owner may.
    expect(await code(as(ownerId).agent.training.rollback({ businessId, agentId: agent2Id }))).toBe("OK");
    expect((await repos.agents.get(hz.db, businessId, agent2Id)).currentVersionId).toBe(wide.id);
  });

  it("an empty tool list is the template's full set: a member can neither save nor promote one over narrower grants", async () => {
    const { businessId, memberId, adminId, ownerId } = hz.A;
    const template = getTemplateByAgentType("backend_engineer")!;
    const all = template.tools.flatMap((g) => g.tools.map((t) => `${g.connectorKey}:${t}`));
    expect(all.length).toBeGreaterThan(1);
    const agent = await repos.agents.create(hz.db, businessId, { name: "Narrowed Engineer", agentType: "backend_engineer" });
    const instructions = { role: "Builds the product", goals: ["Ship"], rules: ["Ask before spending"], playbook: ["Read the brief"], tone: "Plain", examples: [] };
    const first = template.tools[0]!;
    const narrow = await repos.agents.createVersion(hz.db, businessId, agent.id, { instructions, tools: [{ connectorKey: first.connectorKey, tools: [first.tools[0]!] }], modelKey: "sonnet", state: "draft", createdByKind: "user", createdBy: ownerId });
    await repos.agents.promoteVersion(hz.db, businessId, agent.id, narrow.id);
    // Sessions read an empty list as the template's tools, so saving one widens what the agent may do.
    expect(await code(as(memberId).agent.training.saveDraft({ businessId, agentId: agent.id, instructions, tools: [] }))).toBe("FORBIDDEN");
    const empty = await repos.agents.createVersion(hz.db, businessId, agent.id, { instructions, tools: [], modelKey: "sonnet", state: "draft", createdByKind: "user", createdBy: adminId });
    const run = await repos.training.create(hz.db, businessId, { agentId: agent.id, fromVersionId: narrow.id, toVersionId: empty.id, status: "awaiting_decision", requestedBy: adminId });
    expect(await code(as(memberId).agent.training.promote({ businessId, runId: run.id }))).toBe("FORBIDDEN");
    expect(await code(as(adminId).agent.training.promote({ businessId, runId: run.id }))).toBe("OK");
  });

  it("widensGrants: only new connector:tool pairs widen; a connector wildcard covers its tools", () => {
    const live = [{ connectorKey: "sendgrid", tools: ["send_mail"] }];
    expect(widensGrants(live, [{ connectorKey: "sendgrid", tools: ["send_mail"] }])).toBe(false);
    expect(widensGrants(live, [])).toBe(false);
    expect(widensGrants(live, [{ connectorKey: "sendgrid", tools: ["send_mail", "create_contact"] }])).toBe(true);
    expect(widensGrants([{ connectorKey: "sendgrid", tools: ["*"] }], [{ connectorKey: "sendgrid", tools: ["create_contact"] }])).toBe(false);
    expect(widensGrants(null, [{ connectorKey: "github", tools: ["merge_pr"] }])).toBe(true);
  });

  it("an agent's approval is answered by an owner or admin, or the member Responsibilities names for it", async () => {
    const { businessId, memberId, adminId, agent2Id, departmentId } = hz.A;
    await repos.agents.update(hz.db, businessId, agent2Id, { departmentIds: [departmentId] });
    const send = await repos.approvals.create(hz.db, businessId, { agentId: agent2Id, connectorKey: "sendgrid", tool: "send_mail", args: {}, reasons: ["Contacts a third party"] });
    const spend = await repos.approvals.create(hz.db, businessId, { agentId: agent2Id, connectorKey: "e2b", tool: "create_sandbox", args: {}, reasons: ["Above the threshold"] });
    expect(await code(as(memberId).team.approvals.resolve({ businessId, approvalId: send.id, outcome: "approved" }))).toBe("FORBIDDEN");
    // The owner hands "messaging customers" in this department to the member: that one is theirs, the spend is not.
    await as(hz.A.ownerId).team.responsibilities.set({ businessId, decisionType: "message_customers", handler: { kind: "user", id: memberId }, departmentId });
    expect(await code(as(memberId).team.approvals.resolve({ businessId, approvalId: send.id, outcome: "approved" }))).toBe("OK");
    expect(await code(as(memberId).team.approvals.resolve({ businessId, approvalId: spend.id, outcome: "approved" }))).toBe("FORBIDDEN");
    expect(await code(as(adminId).team.approvals.resolve({ businessId, approvalId: spend.id, outcome: "rejected" }))).toBe("OK");
  });

  it("a made file's release, a listed remote change and a hosted-browser step are an owner's or admin's, never the member named for them", async () => {
    const { businessId, memberId, adminId, ownerId, agent2Id } = hz.A;
    // The member is named for messaging customers in agent2's department (the test above), which is how the gateway
    // routed these calls before Nov 22, 2026.
    for (const [connectorKey, tool] of [["cli_inkscape", "release_output"], ["hubspot_mcp", "manage_crm_objects"], ["notion_mcp", "notion_update_page"], ["browser_canva", "click"]] as const) {
      for (const decider of [ownerId, adminId]) {
        const a = await repos.approvals.create(hz.db, businessId, { agentId: agent2Id, connectorKey, tool, args: { decider }, reasons: ["asks"], decisionType: "message_customers" });
        expect(a.handlerKind, `${connectorKey}:${tool}`).toBeNull();
        expect(await code(as(memberId).team.approvals.resolve({ businessId, approvalId: a.id, outcome: "approved" })), `${connectorKey}:${tool}`).toBe("FORBIDDEN");
        expect(await code(as(decider).team.approvals.resolve({ businessId, approvalId: a.id, outcome: "approved" })), `${connectorKey}:${tool}`).toBe("OK");
      }
    }
    // A stored null (a payment record, a hard gate, a row from before the column) is the founder's: never recomputed from hints.
    const unrouted = await repos.approvals.create(hz.db, businessId, { agentId: agent2Id, connectorKey: "sendgrid", tool: "send_mail", args: { unrouted: true }, reasons: ["asks"], decisionType: null });
    expect(await code(as(memberId).team.approvals.resolve({ businessId, approvalId: unrouted.id, outcome: "approved" }))).toBe("FORBIDDEN");
  });

  it("approvalDecisionType is the stored type, null for founder-only calls; mayDecide follows the matrix", () => {
    expect(approvalDecisionType({ connectorKey: "sendgrid", tool: "send_mail", decisionType: "message_customers" })).toBe("message_customers");
    expect(approvalDecisionType({ connectorKey: "sendgrid", tool: "send_mail", decisionType: null })).toBeNull();
    expect(approvalDecisionType({ connectorKey: "cli_gimp", tool: "release_output", decisionType: "message_customers" })).toBeNull();
    expect(approvalDecisionType({ connectorKey: "browser_canva", tool: "fill", decisionType: "publish_content" })).toBeNull();
    const d1 = { id: "d1", approvers: [{ decisionType: "spend_above_threshold", handler: { kind: "user", id: "u1" } }] };
    const d2 = { id: "d2", approvers: [] };
    const member = { userId: "u1", role: "member" as const };
    expect(mayDecide({ userId: "x", role: "admin" }, null, [d1, d2], [])).toBe(true);
    expect(mayDecide(member, null, [d1, d2], ["d1"])).toBe(false);
    expect(mayDecide(member, "spend_above_threshold", [d1, d2], ["d1"])).toBe(true);
    expect(mayDecide(member, "spend_above_threshold", [d1, d2], ["d2"])).toBe(false);
    // Business-wide (no department known): every department must name them.
    expect(mayDecide(member, "spend_above_threshold", [d1, d2], [])).toBe(false);
    expect(mayDecide(member, "spend_above_threshold", [d1], [])).toBe(true);
  });
});

describe("#113 agent.profile.update takes the profile's own fields only", () => {
  it("refuses autonomy, negotiation and model; keeps name edits; the wage cap is an admin's", async () => {
    const { businessId, memberId, adminId, agent2Id } = hz.A;
    const member = as(memberId);
    const patch = { autonomy: { mode: "automated", spendCapMinor: -5 }, negotiation: { enabled: true } } as unknown as { name: string };
    expect(await code(member.agent.profile.update({ businessId, agentId: agent2Id, patch }))).toBe("BAD_REQUEST");
    expect(await code(member.agent.profile.update({ businessId, agentId: agent2Id, patch: { modelKey: "opus" } as unknown as { name: string } }))).toBe("BAD_REQUEST");
    const before = await repos.agents.get(hz.db, businessId, agent2Id);
    expect(before.autonomy).not.toMatchObject({ mode: "automated" });
    expect((await member.agent.profile.update({ businessId, agentId: agent2Id, patch: { name: "Engineer Two" } })).name).toBe("Engineer Two");
    expect(await code(member.agent.profile.update({ businessId, agentId: agent2Id, patch: { wageCapMinor: 1_000_000 } }))).toBe("FORBIDDEN");
    expect(await code(as(adminId).agent.profile.update({ businessId, agentId: agent2Id, patch: { wageCapMinor: 20_000 } }))).toBe("OK");
  });
});

describe("#250 a spend that asked the founder is confirmed by an owner or admin", () => {
  it("a member with Inbox write cannot confirm it; the owner can", async () => {
    const { businessId, memberId, ownerId } = hz.A;
    const item = await decisionItem("Paid acquisition?");
    const result = await as(ownerId).inbox.decide({ businessId, itemId: item.id, freeText: "spend up to €500 on LinkedIn ads targeting fintech CFOs next week" });
    expect(result.requiresConfirmation).toBe(true);
    expect(await code(as(memberId).plan.confirm({ businessId, planId: result.plan.id }))).toBe("FORBIDDEN");
    expect((await repos.plans.get(hz.db, businessId, result.plan.id)).status).toBe("pending_confirmation");
    expect((await as(ownerId).plan.confirm({ businessId, planId: result.plan.id })).plan.status).not.toBe("pending_confirmation");
  });
});

describe("approve_spend naming an agent's approval is confirmed only by someone who may answer that approval (Nov 23, 2026)", () => {
  it("a member cannot confirm a plan that grants an approval they were not named for, even when the action itself is allowed; another project's approval is refused", async () => {
    const { businessId, memberId, ownerId, agent2Id } = hz.A;
    const spend = await repos.approvals.create(hz.db, businessId, { agentId: agent2Id, connectorKey: "e2b", tool: "create_sandbox", args: { plan: true }, reasons: ["Above the threshold"], decisionType: "spend_above_threshold" });
    const other = await repos.approvals.create(hz.db, hz.B.businessId, { agentId: hz.B.agentId, connectorKey: "e2b", tool: "create_sandbox", args: {}, reasons: ["Above the threshold"], decisionType: "spend_above_threshold" });
    const stage = (approvalId: string) => repos.plans.create(hz.db, businessId, { origin: "free_text", actions: [{ type: "approve_spend", params: { approval_id: approvalId, amount_minor: 0 }, agentId: agent2Id, policyOutcome: "allow" }] });
    const plan = await stage(spend.id);
    expect(await code(as(memberId).plan.confirm({ businessId, planId: plan.id }))).toBe("FORBIDDEN");
    expect((await repos.plans.get(hz.db, businessId, plan.id)).status).toBe("pending_confirmation");
    expect(await code(as(ownerId).plan.confirm({ businessId, planId: (await stage(other.id)).id }))).toBe("BAD_REQUEST");
    expect(await code(as(ownerId).plan.confirm({ businessId, planId: plan.id }))).toBe("OK");
  });
});

describe("#100 journey data follows the section walls", () => {
  it("a member walled from Distribution gets no Customer Updates and a Ribbon without the conversion list", async () => {
    const { businessId, memberId, conversionIds } = hz.A;
    const journey = await repos.journeys.create(hz.db, businessId, { conversionId: conversionIds[2]!, touchIds: [], weights: {}, xcSeries: [], commentary: [], agents: [], matchdayLevel: "league" });
    await walls(memberId, { distribution: "none" });
    try {
      const member = as(memberId);
      expect(await code(member.journey.get({ businessId, journeyId: journey.id }))).toBe("FORBIDDEN");
      expect(await code(member.journey.list({ businessId }))).toBe("FORBIDDEN");
      expect(await code(member.journey.roundup({ businessId, day: new Date().toISOString().slice(0, 10) }))).toBe("FORBIDDEN");
      const ribbon = await member.journey.ribbon({ businessId });
      expect(ribbon.conversions).toEqual([]);
      expect(ribbon.redacted).toContain("distribution");
      expect(ribbon.conversionCount).toBeGreaterThan(0);
    } finally {
      await walls(memberId, {});
    }
  });

  it("a member walled from Finance and the CRM reads no amounts, revenue, spend or customer names", async () => {
    const { businessId, memberId, ownerId, conversionIds, entityId } = hz.A;
    const conversionId = conversionIds[5]!;
    const journey = (await repos.journeys.forConversion(hz.db, businessId, conversionId)) ?? (await repos.journeys.create(hz.db, businessId, { conversionId, touchIds: [], weights: {}, xcSeries: [], commentary: [{ text: `[[ent:${entityId}|Acme Buyer]] paid €49.00 after the demo` }], agents: [], matchdayLevel: "league" }));
    const ownerView = await as(ownerId).journey.get({ businessId, journeyId: journey.id });
    expect(ownerView.conversion.amountMinor).toBeGreaterThan(0);
    expect(ownerView.redacted).toEqual([]);
    await walls(memberId, { finance: "none", crm: "none" });
    try {
      const member = as(memberId);
      const got = await member.journey.get({ businessId, journeyId: journey.id });
      expect(got.conversion.amountMinor).toBe(0);
      expect(got.journey.stats.acquisitionCostMinor).toBeNull();
      expect(got.entity?.displayName).toBe("A customer");
      expect(JSON.stringify(got.commentary)).not.toMatch(/Acme Buyer|49\.00/);
      expect(got.redacted).toEqual(["finance", "crm"]);
      const list = await member.journey.list({ businessId });
      expect(list.items.every((j) => j.conversion.amountMinor === 0)).toBe(true);
      expect(list.items.some((j) => j.id === journey.id)).toBe(true);
      expect(JSON.stringify(list.items)).not.toMatch(/Acme Buyer|49\.00/);
      const ribbon = await member.journey.ribbon({ businessId });
      expect(ribbon.rows.every((r) => r.spendMinor === 0 && r.revenueMinor === 0)).toBe(true);
      expect(ribbon.conversions.every((c) => c.amountMinor === 0 && c.entityName === null)).toBe(true);
      expect(ribbon.redacted).toEqual(["finance", "crm"]);
    } finally {
      await walls(memberId, {});
    }
  });
});
