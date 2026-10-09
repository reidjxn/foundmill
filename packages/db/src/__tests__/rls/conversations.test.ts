/**
 * 0020 founder ↔ agent conversations, beyond the generated cross-tenant suite (./cross-tenant.test.ts covers read, write,
 * update and delete per role for both tables): a message can never point at another business's thread, even when the
 * writer can see its own business; viewers read the desk but never post; anon and outsiders see nothing; the founder /
 * agent message shapes are enforced by the database as well as the repo.
 */
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { DbTx } from "../../client";
import { repos } from "../../repos";
import { agentMessages, agentThreads } from "../../schema";
import { createTestDb, type TestHarness } from "../../testing/pglite";
import { createBusinessFixture, RLS_DENIED, type BusinessFixture } from "./fixtures";

let h: TestHarness;
let A: BusinessFixture;
let B: BusinessFixture;
let outsiderId: string;

beforeAll(async () => {
  h = await createTestDb();
  A = await createBusinessFixture(h, "alpha");
  B = await createBusinessFixture(h, "bravo");
  outsiderId = await h.createUser("conversation-outsider@test.local");
  for (const f of [A, B]) {
    await h.service().run((tx) => repos.conversations.appendMessage(tx, f.businessId, { threadId: f.agentThreadId, authorKind: "agent", bubbles: [`${f.slug} says hello`], quickReplies: [] }));
  }
}, 120_000);
afterAll(() => h?.close());

const threadsOf = (businessId: string) => (tx: DbTx) => tx.select({ id: agentThreads.id }).from(agentThreads).where(eq(agentThreads.businessId, businessId));
const messagesOf = (businessId: string) => (tx: DbTx) => tx.select({ id: agentMessages.id, bubbles: agentMessages.bubbles }).from(agentMessages).where(eq(agentMessages.businessId, businessId));

async function expectRefused(p: Promise<unknown>, re: RegExp = RLS_DENIED) {
  await expect(p).rejects.toThrow(re);
}

describe("agent conversations (0020) tenancy", () => {
  it("members and viewers of A read A's desk; nobody reads B's from A; outsiders and anon read nothing", async () => {
    for (const userId of [A.ownerId, A.memberId, A.viewerId]) {
      expect((await h.asUser(userId).run(threadsOf(A.businessId))).length).toBeGreaterThanOrEqual(1);
      expect((await h.asUser(userId).run(messagesOf(A.businessId))).map((m) => m.bubbles)).toContainEqual(["alpha says hello"]);
      expect(await h.asUser(userId).run(threadsOf(B.businessId))).toEqual([]);
      expect(await h.asUser(userId).run(messagesOf(B.businessId))).toEqual([]);
    }
    expect(await h.asUser(outsiderId).run(messagesOf(A.businessId))).toEqual([]);
    try {
      expect(await h.anon().run(messagesOf(A.businessId))).toEqual([]);
    } catch (err) {
      expect((err as Error).message).toMatch(RLS_DENIED);
    }
  });

  it("a member of A posts on A's thread through the repo; a viewer of A cannot", async () => {
    const posted = await h.asUser(A.memberId).run((tx) => repos.conversations.appendMessage(tx, A.businessId, { threadId: A.agentThreadId, authorKind: "founder", authorUserId: A.memberId, bubbles: ["Any blockers?"] }));
    expect(posted.businessId).toBe(A.businessId);
    await expectRefused(h.asUser(A.viewerId).run((tx) => repos.conversations.appendMessage(tx, A.businessId, { threadId: A.agentThreadId, authorKind: "founder", authorUserId: A.viewerId, bubbles: ["Can I post?"] })));
  });

  it("a message in A can never point at B's thread (composite key), not even written by the service role", async () => {
    // As a member of A: B's thread is invisible, and the (thread, business) pair does not exist for A.
    await expect(
      h.asUser(A.ownerId).run((tx) => tx.insert(agentMessages).values({ businessId: A.businessId, threadId: B.agentThreadId, authorKind: "founder", authorUserId: A.ownerId, bubbles: ["sneaky"] })),
    ).rejects.toThrow(/foreign key|violates|agent_messages_thread_fkey/i);
    await expect(h.service().run((tx) => tx.insert(agentMessages).values({ businessId: A.businessId, threadId: B.agentThreadId, authorKind: "agent", bubbles: ["sneaky"] }))).rejects.toThrow(/foreign key|violates|agent_messages_thread_fkey/i);
    // Nor can a member of A move one of A's messages into B.
    const moved = await h
      .asUser(A.ownerId)
      .run((tx) => tx.update(agentMessages).set({ businessId: B.businessId }).where(eq(agentMessages.businessId, A.businessId)).returning({ id: agentMessages.id }))
      .catch((err: Error) => err);
    if (moved instanceof Error) expect(moved.message).toMatch(/row-level security|permission denied|foreign key|violates/i);
    else expect(moved).toEqual([]);
    expect((await h.service().run(messagesOf(B.businessId))).every((m) => !JSON.stringify(m.bubbles).includes("sneaky"))).toBe(true);
  });

  it("the database enforces the message shapes: founders press chips, agents offer them", async () => {
    await expect(
      h.service().run((tx) => tx.insert(agentMessages).values({ businessId: A.businessId, threadId: A.agentThreadId, authorKind: "founder", bubbles: ["x"], quickReplies: [{ id: "a", label: "Ask", say: "Ask", kind: "ask", option_id: null, recommended: false }] })),
    ).rejects.toThrow(/agent_messages_founder_shape|check constraint/i);
    await expect(h.service().run((tx) => tx.insert(agentMessages).values({ businessId: A.businessId, threadId: A.agentThreadId, authorKind: "agent", bubbles: ["x"], chosenQuickReplyId: "a" }))).rejects.toThrow(/agent_messages_agent_shape|check constraint/i);
    await expect(h.service().run((tx) => tx.insert(agentMessages).values({ businessId: A.businessId, threadId: A.agentThreadId, authorKind: "agent", bubbles: ["1", "2", "3", "4"] }))).rejects.toThrow(/check constraint|bubbles/i);
  });

  it("deleting a thread takes its messages with it; the thread is unique per agent and subject", async () => {
    const t = await h.service().run((tx) => repos.conversations.ensureThread(tx, A.businessId, { agentId: A.agent2Id, subjectKind: "agent", subjectId: A.agent2Id }));
    await h.service().run((tx) => repos.conversations.appendMessage(tx, A.businessId, { threadId: t.id, authorKind: "agent", bubbles: ["temp"] }));
    await expect(h.service().run((tx) => tx.insert(agentThreads).values({ businessId: A.businessId, agentId: A.agent2Id, subjectKind: "agent", subjectId: A.agent2Id }))).rejects.toThrow(/duplicate|unique/i);
    await h.asUser(A.ownerId).run((tx) => tx.delete(agentThreads).where(and(eq(agentThreads.businessId, A.businessId), eq(agentThreads.id, t.id))));
    expect((await h.service().run((tx) => tx.select().from(agentMessages).where(eq(agentMessages.threadId, t.id)))).length).toBe(0);
  });
});
