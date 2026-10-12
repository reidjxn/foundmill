/**
 * Section walls reach the Inbox (BUILD §11.9).
 *
 * RUI-01: a plan compiled from an Inbox decision, the Inbox Write box, a confirmation or an agent's hand-off runs as the
 * person who decided it, so a member walled from Distribution (or Team, Finance, …) cannot turn on channels, set
 * budgets or change agents by typing in the Inbox; the note stays open for someone who can.
 *
 * RUI-02: a member walled from Finance and the CRM reads notes without cash, revenue, runway, customer names or the
 * customer's record; the agent's desk loads no CRM names for them and masks what the thread says.
 */
import { repos, type InboxItem } from "@foundmill/db";
import { TRPCError } from "@trpc/server";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { manifestFor } from "../services/conversation";
import { createApiHarness, type ApiHarness } from "./harness";

let hz: ApiHarness;
beforeAll(async () => {
  hz = await createApiHarness({ prefix: "walls" });
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

const walls = (sections: Record<string, "none" | "read" | "write">) => repos.memberships.setSectionPermissions(hz.db, hz.A.businessId, hz.A.memberId, sections);

async function decisionItem(subject: string, options: { id: string; label: string; recommended?: boolean }[] = [{ id: "go", label: "Go ahead", recommended: true }, { id: "wait", label: "Wait a week" }]): Promise<InboxItem> {
  return repos.inbox.createItem(hz.db, hz.A.businessId, {
    type: "decision",
    from_agent_id: hz.A.agentId,
    subject,
    body_md: "The team needs a steer.",
    status_strip: [],
    exhibit: { kind: "none", spec_ref: null },
    decision: { options: options.map((o) => ({ recommended: false, consequence: "", cost_minor: 0, reversible: true, ...o })), free_text: true, expires_at: null },
    blocks_continue: true,
    source_event_ids: [],
    entity_ids: [],
  });
}

describe("RUI-01: plans run with the decider's section permissions", () => {
  it("a member walled from Distribution cannot turn on a channel by typing in the Inbox; the note stays open", async () => {
    await walls({ distribution: "none", finance: "none" });
    try {
      const member = hz.caller({ userId: hz.A.memberId });
      const businessId = hz.A.businessId;
      expect(await code(member.distribution.channels.enable({ businessId, channelKey: "seo" }))).toBe("FORBIDDEN");
      const item = await decisionItem("How do we get found?");
      expect(await code(member.inbox.decide({ businessId, itemId: item.id, freeText: "Turn on the SEO channel and write two articles a week" }))).toBe("FORBIDDEN");
      await expect(member.inbox.decide({ businessId, itemId: item.id, freeText: "Turn on the SEO channel and write two articles a week" })).rejects.toThrow(/write access to distribution.*turn on a channel/);
      // The Write box path (agent.conversation.inboxReply) is the same decision.
      expect(await code(member.agent.conversation.inboxReply({ businessId, itemId: item.id, text: "Spend £20 on print ads in local magazines" }))).toBe("FORBIDDEN");
      expect((await repos.channels.getByKey(hz.db, businessId, "seo"))?.enabled ?? false).toBe(false);
      expect((await repos.channels.getByKey(hz.db, businessId, "print"))?.enabled ?? false).toBe(false);
      expect((await repos.inbox.get(hz.db, businessId, item.id)).state).not.toBe("answered");
      expect(await repos.plans.forInboxItem(hz.db, businessId, item.id)).toBeNull();
      // What the member may do still works: a plain task for the agent who asked.
      const ok = await member.inbox.decide({ businessId, itemId: item.id, freeText: "Write up a summary for me" });
      expect(ok.plan.actions.map((a) => a.type)).toEqual(["create_task"]);
    } finally {
      await walls({});
    }
  });

  it("a member walled from Team cannot change an agent's model from a decision", async () => {
    await walls({ team: "read" });
    try {
      const item = await decisionItem("Which model for the engineer?");
      expect(await code(hz.caller({ userId: hz.A.memberId }).inbox.decide({ businessId: hz.A.businessId, itemId: item.id, freeText: "Switch the engineer to sonnet" }))).toBe("FORBIDDEN");
    } finally {
      await walls({});
    }
  });

  it("plan.confirm checks the confirmer: a plan the owner staged cannot be confirmed by a walled member", async () => {
    const businessId = hz.A.businessId;
    const item = await decisionItem("Paid acquisition?");
    const staged = await hz.caller({ userId: hz.A.ownerId }).inbox.decide({ businessId, itemId: item.id, freeText: "spend up to €500 on LinkedIn ads targeting fintech CFOs next week" });
    expect(staged.plan.status).toBe("pending_confirmation");
    await walls({ distribution: "none" });
    try {
      expect(await code(hz.caller({ userId: hz.A.memberId }).plan.confirm({ businessId, planId: staged.plan.id }))).toBe("FORBIDDEN");
      expect((await repos.plans.get(hz.db, businessId, staged.plan.id)).status).toBe("pending_confirmation");
      expect((await repos.channels.getByKey(hz.db, businessId, "paid_ads"))?.enabled ?? false).toBe(false);
    } finally {
      await walls({});
    }
    const confirmed = await hz.caller({ userId: hz.A.ownerId }).plan.confirm({ businessId, planId: staged.plan.id });
    expect(confirmed.exec.executed.length).toBe(3);
  });

  it("an agent's hand-off cannot be staged into a walled section", async () => {
    const businessId = hz.A.businessId;
    const item = await decisionItem("Should we try GEO?");
    const thread = await repos.conversations.ensureThread(hz.db, businessId, { agentId: hz.A.agentId, subjectKind: "inbox_item", subjectId: item.id });
    const message = await repos.conversations.appendMessage(hz.db, businessId, { threadId: thread.id, authorKind: "agent", agentId: hz.A.agentId, bubbles: ["I can start GEO."], handOff: { instruction: "Turn on the GEO channel for AI search answers" } });
    await walls({ distribution: "none" });
    try {
      expect(await code(hz.caller({ userId: hz.A.memberId }).agent.conversation.handOff({ businessId, messageId: message.id }))).toBe("FORBIDDEN");
      expect((await repos.conversations.getMessage(hz.db, businessId, message.id)).planId).toBeNull();
    } finally {
      await walls({});
    }
    const staged = await hz.caller({ userId: hz.A.memberId }).agent.conversation.handOff({ businessId, messageId: message.id });
    expect(staged.plan.status).toBe("pending_confirmation");
  });
});

describe("RUI-02: notes follow the reader's Finance and CRM walls", () => {
  async function wonItem(): Promise<InboxItem> {
    const entity = await repos.entities.get(hz.db, hz.A.businessId, hz.A.entityId);
    const name = entity.displayName;
    return repos.inbox.createItem(hz.db, hz.A.businessId, {
      type: "customer_won",
      from_agent_id: hz.A.agentId,
      subject: `New order from ${name}`,
      body_md: `[[ent:${entity.id}|${name}]] ordered the routine for £56.99 through Shopify; cash stands at 263345.71 GBP with 14 months of runway (Estimate). [[ent:${hz.A.agentId}|The Chief of Staff]] ran the welcome sequence.`,
      status_strip: [
        { metric: "Revenue 30d £47,898.86", source: "conversions" },
        { metric: "cash", source: "cash_position" },
        { metric: "tasks_running", source: "tasks_by_status" },
      ],
      exhibit: { kind: "chart", spec_ref: "cash_position" },
      decision: { options: [{ id: "thank", label: `Send ${name} a thank-you`, recommended: true, consequence: "A €5 voucher goes out.", cost_minor: 500, reversible: true }, { id: "later", label: "Not now", recommended: false, consequence: "Nothing is sent.", cost_minor: 0, reversible: true }], free_text: true, expires_at: null },
      blocks_continue: false,
      source_event_ids: [],
      entity_ids: [entity.id],
    });
  }

  it("a member walled from Finance and the CRM gets no figures, names or customer record", async () => {
    const businessId = hz.A.businessId;
    const item = await wonItem();
    const name = (await repos.entities.get(hz.db, businessId, hz.A.entityId)).displayName;
    await walls({ finance: "none", crm: "none" });
    try {
      const member = hz.caller({ userId: hz.A.memberId });
      expect(await code(member.finance.overview({ businessId }))).toBe("FORBIDDEN");
      const got = await member.inbox.get({ businessId, itemId: item.id });
      const text = JSON.stringify(got);
      for (const leak of [name, "Ada", "56.99", "263345", "47,898", "14 months", `ada@${hz.A.slug}.test`, "lawfulBasis"]) expect(text, leak).not.toContain(leak);
      expect(got.item.subject).toBe("New order from a customer");
      expect(got.item.bodyMd).toBe(`A customer ordered the routine for (amount hidden) through Shopify; cash stands at (amount hidden) with (hidden) of runway (Estimate). [[ent:${hz.A.agentId}|The Chief of Staff]] ran the welcome sequence.`);
      expect(got.item.statusStrip).toEqual([{ metric: "tasks_running", source: "tasks_by_status" }]);
      expect(got.item.exhibit).toEqual({ kind: "none", spec_ref: null });
      expect(got.item.redacted).toEqual(["crm", "finance"]);
      expect(got.entities).toEqual([]);
      const option = (got.item.decision as { options: Record<string, unknown>[] }).options[0]!;
      expect(option).toMatchObject({ id: "thank", label: "Send a customer a thank-you", consequence: "A (amount hidden) voucher goes out." });
      expect(option).not.toHaveProperty("cost_minor");

      const listed = (await member.inbox.list({ businessId })).items.find((i) => i.id === item.id)!;
      expect(listed.subject).toBe("New order from a customer");
      expect(listed.bodyMd).not.toContain("56.99");
      expect(listed.redacted).toEqual(["crm", "finance"]);
    } finally {
      await walls({});
    }
  });

  it("each wall only hides its own section; the owner sees the note whole, with record stubs only", async () => {
    const businessId = hz.A.businessId;
    const item = await wonItem();
    const name = (await repos.entities.get(hz.db, businessId, hz.A.entityId)).displayName;
    await walls({ crm: "none" });
    try {
      const crmOnly = await hz.caller({ userId: hz.A.memberId }).inbox.get({ businessId, itemId: item.id });
      expect(crmOnly.item.bodyMd).toContain("£56.99");
      expect(crmOnly.item.bodyMd).not.toContain(name);
      expect(crmOnly.item.redacted).toEqual(["crm"]);
      await walls({ finance: "none" });
      const financeOnly = await hz.caller({ userId: hz.A.memberId }).inbox.get({ businessId, itemId: item.id });
      expect(financeOnly.item.subject).toBe(`New order from ${name}`);
      expect(financeOnly.item.bodyMd).not.toContain("56.99");
      expect(financeOnly.entities.map((e) => e.displayName)).toEqual([name]);
      expect(financeOnly.item.redacted).toEqual(["finance"]);
    } finally {
      await walls({});
    }
    const owner = await hz.caller({ userId: hz.A.ownerId }).inbox.get({ businessId, itemId: item.id });
    expect(owner.item.bodyMd).toContain("£56.99");
    expect(owner.item.subject).toBe(`New order from ${name}`);
    expect(owner.item.redacted).toEqual([]);
    expect(owner.entities).toEqual([{ id: hz.A.entityId, kind: "person", displayName: name }]);
    expect(JSON.stringify(owner.entities)).not.toContain("identifiers");
  });

  it("the agent desk loads no CRM names for a member walled from the CRM, and masks the shared thread", async () => {
    const businessId = hz.A.businessId;
    const item = await wonItem();
    const name = (await repos.entities.get(hz.db, businessId, hz.A.entityId)).displayName;
    const thread = await repos.conversations.ensureThread(hz.db, businessId, { agentId: hz.A.agentId, subjectKind: "inbox_item", subjectId: item.id });
    await repos.conversations.appendMessage(hz.db, businessId, { threadId: thread.id, authorKind: "agent", agentId: hz.A.agentId, bubbles: [`[[ent:${hz.A.entityId}|${name}]] paid £56.99.`] });
    await walls({ finance: "none", crm: "none" });
    try {
      const membership = (await repos.memberships.get(hz.db, businessId, hz.A.memberId))!;
      const manifest = await hz.h.asUser(hz.A.memberId).run((tx) => manifestFor(tx, { businessId, membership }));
      expect(manifest.entries.some((e) => e.kind !== "agent")).toBe(false);
      const desk = await hz.caller({ userId: hz.A.memberId }).agent.conversation.get({ businessId, subject: { kind: "inbox_item", id: item.id } });
      expect(desk.subject.title).toBe("New order from a customer");
      expect(desk.messages.map((m) => m.bubbles.join(" "))).toEqual(["A customer paid (amount hidden)."]);
      expect(JSON.stringify(desk)).not.toContain(name);
    } finally {
      await walls({});
    }
    const ownerMembership = (await repos.memberships.get(hz.db, businessId, hz.A.ownerId))!;
    const full = await hz.h.asUser(hz.A.ownerId).run((tx) => manifestFor(tx, { businessId, membership: ownerMembership }));
    expect(full.entries.some((e) => e.id === hz.A.entityId)).toBe(true);
  });
});
