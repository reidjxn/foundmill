/**
 * The gateway's "ask" path end to end (audit FR-01 / O-26): an ask opens one approval and one Inbox decision item, a
 * call asked again waits on the same approval, and once the founder approves the same call runs once under it (in the
 * session still waiting or the next session on the task), never for more than the amount that was asked for.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { APPROVAL_OPTIONS, repos } from "@foundmill/db";
import { SAFE_EMAIL, sendRefusals, setupGateway, type GatewayFixture } from "./harness";
import type { AllowResponse, AskResponse, CallResponse } from "../types";

let g: GatewayFixture;
beforeAll(async () => {
  g = await setupGateway({ businessMode: "augmented" });
}, 120_000);
afterAll(async () => {
  await g.close();
});
beforeEach(() => {
  g.seen.length = 0;
});

const asAsk = (r: CallResponse): AskResponse => {
  expect(r.outcome).toBe("ask");
  return r as AskResponse;
};
const asAllow = (r: CallResponse): AllowResponse => {
  expect(r.outcome).toBe("allow");
  return r as AllowResponse;
};

async function sessionOnTask(taskId: string) {
  return (await repos.agents.createSession(g.db, g.businessId, { agentId: g.agentId, taskId, modelKey: "sonnet" })).id;
}

describe("one approval per gated call", () => {
  it("opens one approval and one decision item, and a call asked again waits on the same approval", async () => {
    const token = await g.token();
    const args = { to: SAFE_EMAIL, body: "Your invoice is ready" };
    const first = asAsk(await g.client.call(token, { connector: "test", tool: "send_message", args }));
    const again = asAsk(await g.client.call(token, { connector: "test", tool: "send_message", args: { body: "Your invoice is ready", to: SAFE_EMAIL } }));
    expect(again.approvalId).toBe(first.approvalId);
    expect(g.seen).toHaveLength(0);

    const rows = (await repos.approvals.list(g.db, g.businessId, { sessionId: g.sessionId, connectorKey: "test" })).items.filter((a) => (a.args as { body?: string }).body === "Your invoice is ready");
    expect(rows.map((a) => a.id)).toEqual([first.approvalId]);
    const requested = (await repos.events.list(g.db, g.businessId, { type: "approval.requested", limit: 200 })).items.filter((e) => (e.payload as { approvalId?: string }).approvalId === first.approvalId);
    expect(requested).toHaveLength(1);
    expect(requested[0]!.narrated).toBe(true);

    const approval = await repos.approvals.get(g.db, g.businessId, first.approvalId);
    expect(approval.inboxItemId).not.toBeNull();
    const item = await repos.inbox.get(g.db, g.businessId, approval.inboxItemId!);
    expect(item).toMatchObject({ type: "decision", blocksContinue: false, fromAgentId: g.agentId, subject: "Test Worker needs your OK: Test connector › send message" });
    expect((item.decision as { options: { id: string }[] }).options.map((o) => o.id)).toEqual([APPROVAL_OPTIONS.approve, APPROVAL_OPTIONS.reject]);
    expect(item.sourceEventIds).toEqual([requested[0]!.id]);
    const created = (await repos.events.list(g.db, g.businessId, { type: "inbox.item_created", limit: 200 })).items.find((e) => (e.payload as { inboxItemId?: string }).inboxItemId === item.id);
    expect(created).toBeDefined();
    expect((await repos.events.outboxPending(g.db, g.businessId)).some((o) => o.eventId === created!.id)).toBe(true);
  });

  it("once approved, the same call runs once under the approval; the next one asks again", async () => {
    const token = await g.token();
    const args = { to: SAFE_EMAIL, body: "Welcome aboard" };
    const asked = asAsk(await g.client.call(token, { connector: "test", tool: "send_message", args }));
    await repos.approvals.resolve(g.db, g.businessId, asked.approvalId, { outcome: "approved", byKind: "user" });

    const ran = asAllow(await g.client.call(token, { connector: "test", tool: "send_message", args }));
    expect(ran.result.data).toEqual({ sent: true, to: SAFE_EMAIL });
    expect(g.seen.map((s) => s.tool)).toEqual(["send_message"]);
    const audit = await repos.audit.get(g.db, g.businessId, ran.auditId);
    expect(audit.details).toMatchObject({ outcome: "allow", approvalId: asked.approvalId });
    expect(await repos.approvals.get(g.db, g.businessId, asked.approvalId)).toMatchObject({ usedBySessionId: g.sessionId });

    const next = asAsk(await g.client.call(token, { connector: "test", tool: "send_message", args }));
    expect(next.approvalId).not.toBe(asked.approvalId);
    expect(g.seen).toHaveLength(1);
  });

  it("a call the vendor refused outright keeps the approval for the next try; one that may have run spends it", async () => {
    const token = await g.token();
    const args = { to: SAFE_EMAIL, body: "Your change is live" };
    const asked = asAsk(await g.client.call(token, { connector: "test", tool: "send_message", args }));
    await repos.approvals.resolve(g.db, g.businessId, asked.approvalId, { outcome: "approved", byKind: "user" });

    // GitHub's "not mergeable" a moment after the checks pass (Nov 6, 2026): nothing happened, so the founder's yes stays.
    sendRefusals.push(405);
    const refused = asAllow(await g.client.call(token, { connector: "test", tool: "send_message", args }));
    expect(refused.result).toMatchObject({ ok: false, error: { status: 405 } });
    expect(await repos.approvals.get(g.db, g.businessId, asked.approvalId)).toMatchObject({ usedAt: null, usedBySessionId: null });

    // The retry runs under the same approval, without a second question.
    const ran = asAllow(await g.client.call(token, { connector: "test", tool: "send_message", args }));
    expect(ran.result.ok).toBe(true);
    expect((await repos.audit.get(g.db, g.businessId, ran.auditId)).details).toMatchObject({ approvalId: asked.approvalId });
    expect(g.seen.map((s) => s.tool)).toEqual(["send_message"]);
    expect(await repos.approvals.get(g.db, g.businessId, asked.approvalId)).toMatchObject({ usedBySessionId: g.sessionId });

    // An error with no answer from the vendor (or a 5xx) may have done the thing: that approval is spent.
    const second = asAsk(await g.client.call(token, { connector: "test", tool: "send_message", args: { ...args, body: "Second change" } }));
    await repos.approvals.resolve(g.db, g.businessId, second.approvalId, { outcome: "approved", byKind: "user" });
    sendRefusals.push(null);
    const dropped = asAllow(await g.client.call(token, { connector: "test", tool: "send_message", args: { ...args, body: "Second change" } }));
    expect(dropped.result.ok).toBe(false);
    expect((await repos.approvals.get(g.db, g.businessId, second.approvalId)).usedAt).toBeInstanceOf(Date);
    const again = asAsk(await g.client.call(token, { connector: "test", tool: "send_message", args: { ...args, body: "Second change" } }));
    expect(again.approvalId).not.toBe(second.approvalId);
  });

  it("a rejected call stays refused: asking again opens a new request and runs nothing", async () => {
    const token = await g.token();
    const args = { to: SAFE_EMAIL, body: "Price change" };
    const asked = asAsk(await g.client.call(token, { connector: "test", tool: "send_message", args }));
    await repos.approvals.resolve(g.db, g.businessId, asked.approvalId, { outcome: "rejected", byKind: "user" });
    const again = asAsk(await g.client.call(token, { connector: "test", tool: "send_message", args }));
    expect(again.approvalId).not.toBe(asked.approvalId);
    expect(g.seen).toHaveLength(0);
  });

  it("the next session on the task finds the approval granted after the first one ended", async () => {
    const task = await repos.tasks.create(g.db, g.businessId, { kind: "ops", title: "Tell the pilot customer", goalMd: "x", assigneeAgentId: g.agentId, status: "running" });
    const s1 = await sessionOnTask(task.id);
    const args = { to: SAFE_EMAIL, body: "The pilot starts Monday" };
    const asked = asAsk(await g.client.call(await g.token({ sessionId: s1 }), { connector: "test", tool: "send_message", args }));
    expect((await repos.approvals.get(g.db, g.businessId, asked.approvalId)).taskId).toBe(task.id);
    await repos.agents.endSession(g.db, g.businessId, s1, { endedAt: new Date(), tokensIn: 0, tokensOut: 0, costMinor: 0, outcome: "blocked" });
    await repos.approvals.resolve(g.db, g.businessId, asked.approvalId, { outcome: "approved", byKind: "user" });

    const s2 = await sessionOnTask(task.id);
    asAllow(await g.client.call(await g.token({ sessionId: s2 }), { connector: "test", tool: "send_message", args }));
    expect(g.seen.map((s) => s.tool)).toEqual(["send_message"]);
    expect(await repos.approvals.get(g.db, g.businessId, asked.approvalId)).toMatchObject({ usedBySessionId: s2 });
  });

  it("an approval an agent decided through Team › Responsibilities runs its one call; the next one asks again", async () => {
    const dept = await repos.departments.create(g.db, g.businessId, { name: "Delegated once" });
    const reviewer = await repos.agents.create(g.db, g.businessId, { name: "Reviewer", agentType: "review_agent", departmentIds: [dept.id] });
    await repos.agents.update(g.db, g.businessId, g.agentId, { departmentIds: [dept.id] });
    await repos.departments.update(g.db, g.businessId, dept.id, { approvers: [{ decisionType: "message_customers", handler: { kind: "agent", id: reviewer.id } }] });
    const args = { to: SAFE_EMAIL, body: "Delegated hello" };
    try {
      const token = await g.token();
      const ran = asAllow(await g.client.call(token, { connector: "test", tool: "send_message", args }));
      const approvalId = (await repos.approvals.list(g.db, g.businessId, { agentId: g.agentId, connectorKey: "test", limit: 1 })).items[0]!.id;
      expect(await repos.approvals.get(g.db, g.businessId, approvalId)).toMatchObject({ outcome: "approved", byKind: "agent", byId: reviewer.id, usedBySessionId: g.sessionId });
      // The audit row names the approval and who decided it: the agent, not the founder.
      const audit = await repos.audit.get(g.db, g.businessId, ran.auditId);
      expect(audit.details).toMatchObject({ outcome: "allow", approvalId });
      expect(JSON.stringify((audit.details as { reasons: string[] }).reasons)).not.toContain("by the founder");

      // The founder takes the decision back: the same call again is the founder's question, not a second run.
      await repos.departments.update(g.db, g.businessId, dept.id, { approvers: [] });
      const next = asAsk(await g.client.call(token, { connector: "test", tool: "send_message", args }));
      expect(next.approvalId).not.toBe(approvalId);
      expect(g.seen.map((s) => s.tool)).toEqual(["send_message"]);
    } finally {
      await repos.departments.update(g.db, g.businessId, dept.id, { approvers: [] });
      await repos.agents.update(g.db, g.businessId, g.agentId, { departmentIds: [] });
    }
  });

  it("an agent's approval given back after a call that did not run never runs a retry once the delegation is withdrawn", async () => {
    const dept = await repos.departments.create(g.db, g.businessId, { name: "Delegated, refused" });
    const reviewer = await repos.agents.create(g.db, g.businessId, { name: "Reviewer", agentType: "review_agent", departmentIds: [dept.id] });
    await repos.agents.update(g.db, g.businessId, g.agentId, { departmentIds: [dept.id] });
    await repos.departments.update(g.db, g.businessId, dept.id, { approvers: [{ decisionType: "message_customers", handler: { kind: "agent", id: reviewer.id } }] });
    const args = { to: SAFE_EMAIL, body: "Delegated, then refused" };
    try {
      const token = await g.token();
      sendRefusals.push(405);
      const refused = asAllow(await g.client.call(token, { connector: "test", tool: "send_message", args }));
      expect(refused.result.ok).toBe(false);
      const approvalId = (await repos.approvals.list(g.db, g.businessId, { agentId: g.agentId, connectorKey: "test", limit: 1 })).items[0]!.id;
      expect(await repos.approvals.get(g.db, g.businessId, approvalId)).toMatchObject({ byKind: "agent", usedAt: null });
      await repos.departments.update(g.db, g.businessId, dept.id, { approvers: [] });
      const retry = asAsk(await g.client.call(token, { connector: "test", tool: "send_message", args }));
      expect(retry.approvalId).not.toBe(approvalId);
      expect(g.seen).toHaveLength(0);
    } finally {
      sendRefusals.length = 0;
      await repos.departments.update(g.db, g.businessId, dept.id, { approvers: [] });
      await repos.agents.update(g.db, g.businessId, g.agentId, { departmentIds: [] });
    }
  });

  it("an agent's approval another call took first opens a fresh one instead of waiting on it", async () => {
    const dept = await repos.departments.create(g.db, g.businessId, { name: "Delegated, raced" });
    const reviewer = await repos.agents.create(g.db, g.businessId, { name: "Reviewer", agentType: "review_agent", departmentIds: [dept.id] });
    await repos.agents.update(g.db, g.businessId, g.agentId, { departmentIds: [dept.id] });
    await repos.departments.update(g.db, g.businessId, dept.id, { approvers: [{ decisionType: "message_customers", handler: { kind: "agent", id: reviewer.id } }] });
    // The first approval the agent decides is taken before this call can use it.
    const taken = vi.spyOn(repos.approvals, "useDecided").mockResolvedValueOnce(null);
    try {
      const ran = asAllow(await g.client.call(await g.token(), { connector: "test", tool: "send_message", args: { to: SAFE_EMAIL, body: "Raced" } }));
      expect(ran.result.ok).toBe(true);
      expect(taken).toHaveBeenCalledTimes(2);
      expect(g.seen.map((s) => s.tool)).toEqual(["send_message"]);
    } finally {
      taken.mockRestore();
      await repos.departments.update(g.db, g.businessId, dept.id, { approvers: [] });
      await repos.agents.update(g.db, g.businessId, g.agentId, { departmentIds: [] });
    }
  });

  it("an open approval of an earlier session on the task is handed to the session asking now", async () => {
    const task = await repos.tasks.create(g.db, g.businessId, { kind: "ops", title: "Book the launch call", goalMd: "x", assigneeAgentId: g.agentId, status: "running" });
    const s1 = await sessionOnTask(task.id);
    const args = { to: SAFE_EMAIL, body: "Launch call" };
    const asked = asAsk(await g.client.call(await g.token({ sessionId: s1 }), { connector: "test", tool: "send_message", args }));
    const s2 = await sessionOnTask(task.id);
    const again = asAsk(await g.client.call(await g.token({ sessionId: s2 }), { connector: "test", tool: "send_message", args }));
    expect(again.approvalId).toBe(asked.approvalId);
    expect(await repos.approvals.get(g.db, g.businessId, asked.approvalId)).toMatchObject({ sessionId: s2, taskId: task.id });
  });
});

describe("money stays inside what was approved", () => {
  it("an approval covers the amount it was asked for, never more", async () => {
    await repos.businesses.setBusinessMode(g.db, g.businessId, "assisted");
    try {
      const token = await g.token();
      const asked = asAsk(await g.client.call(token, { connector: "test", tool: "spend", args: { amountMinor: 900_000 }, context: { amountMinor: 900_000, currency: "usd" } }));
      expect(await repos.approvals.get(g.db, g.businessId, asked.approvalId)).toMatchObject({ amountMinor: 900_000, currency: "USD" });
      const item = await repos.inbox.get(g.db, g.businessId, (await repos.approvals.get(g.db, g.businessId, asked.approvalId)).inboxItemId!);
      expect(item.bodyMd).toContain("$9,000.00");
      await repos.approvals.resolve(g.db, g.businessId, asked.approvalId, { outcome: "approved", byKind: "user" });
      // The same arguments with a larger amount in the call's context are not what the founder approved.
      const bigger = asAsk(await g.client.call(token, { connector: "test", tool: "spend", args: { amountMinor: 900_000 }, context: { amountMinor: 950_000, currency: "USD" } }));
      expect(bigger.approvalId).not.toBe(asked.approvalId);
      // Nor is the same figure in another currency: it asks about itself, not on the open request for $9,500.00.
      const yen = asAsk(await g.client.call(token, { connector: "test", tool: "spend", args: { amountMinor: 900_000 }, context: { amountMinor: 900_000, currency: "JPY" } }));
      expect([asked.approvalId, bigger.approvalId]).not.toContain(yen.approvalId);
      expect(await repos.approvals.get(g.db, g.businessId, yen.approvalId)).toMatchObject({ amountMinor: 900_000, currency: "JPY", outcome: null });
      expect(g.seen).toHaveLength(0);
      asAllow(await g.client.call(token, { connector: "test", tool: "spend", args: { amountMinor: 900_000 }, context: { amountMinor: 900_000, currency: "USD" } }));
      expect(g.seen.map((s) => s.tool)).toEqual(["spend"]);
    } finally {
      await repos.businesses.setBusinessMode(g.db, g.businessId, "augmented");
    }
  });

  it("a hard gate stays a founder task: no decision item, no task held, no approval can lift it", async () => {
    const token = await g.token();
    const r = await g.client.call(token, { connector: "test", tool: "pay_out", args: { amountMinor: 100 } });
    expect(r.outcome).toBe("deny");
    const approvalId = (r as { approvalId?: string }).approvalId!;
    const approval = await repos.approvals.get(g.db, g.businessId, approvalId);
    expect(approval).toMatchObject({ inboxItemId: null, taskId: null });
    await repos.approvals.resolve(g.db, g.businessId, approvalId, { outcome: "approved", byKind: "user" });
    expect((await g.client.call(token, { connector: "test", tool: "pay_out", args: { amountMinor: 100 } })).outcome).toBe("deny");
    expect(g.seen).toHaveLength(0);
  });
});
