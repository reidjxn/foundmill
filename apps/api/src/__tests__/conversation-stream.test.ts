/**
 * Streamed replies (audit MB-1): `agent.conversation.sendStream`, `inboxReplyStream` and `idea.askStream` show each
 * bubble of the agent's reply as it is written, after the checks the stored reply gets, then `done` with exactly what
 * the plain procedure answers. Nothing is stored before the whole reply has passed: a stream that breaks after its first
 * bubble leaves no half exchange, and the same message sent again is answered once.
 */
import { CONVERSATION_MAX_TOKENS } from "@foundmill/agents";
import { repos } from "@foundmill/db";
import { MockModelClient, ModelOutputError, ModelUnavailableError, type CompleteRequest, type ModelClient, type StreamStructuredRequest, type StreamStructuredResult } from "@foundmill/models";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { readMeta } from "../routers/idea";
import type { ReplyStreamEvent } from "../services/conversation";
import { createApiHarness, type ApiHarness } from "./harness";

let hz: ApiHarness;
let original: ModelClient;
beforeAll(async () => {
  hz = await createApiHarness({ prefix: "convstream" });
  original = hz.deps.models;
}, 120_000);
afterEach(() => {
  hz.deps.models = original;
  hz.limits.reset();
});
afterAll(() => hz.close());

/** The mock, recording requests; `bubbles` replaces the conversation route's reply (quick replies padded by the checks). */
function models(bubbles?: string[]): MockModelClient {
  const client = new MockModelClient(bubbles ? { overrides: { conversation: () => ({ bubbles, reaction: "noted", quick_replies: [], hand_off: null, refers_to: [] }) } } : {});
  hz.deps.models = client;
  return client;
}

/** A client whose stream shows `shown` bubbles and then fails with `error`; `complete()` is the mock's. */
class BreaksAfter extends MockModelClient {
  constructor(
    private readonly shown: string[],
    private readonly error: Error,
  ) {
    super();
  }
  override async streamStructured<T, E>(req: StreamStructuredRequest<T, E>): Promise<StreamStructuredResult<T, E>> {
    this.history.push(req as unknown as CompleteRequest);
    for (const [index, value] of this.shown.entries()) await req.onElement?.({ index, value: value as E, path: req.elementPath, repaired: false, elapsedMs: 0 });
    throw this.error;
  }
}

async function collect<R>(stream: AsyncIterable<ReplyStreamEvent<R>>): Promise<ReplyStreamEvent<R>[]> {
  const out: ReplyStreamEvent<R>[] = [];
  for await (const e of stream) out.push(e);
  return out;
}

/** The events before the stream broke, and the error it ended with. */
async function collectUntilError<R>(stream: AsyncIterable<ReplyStreamEvent<R>>): Promise<{ events: ReplyStreamEvent<R>[]; error: unknown }> {
  const events: ReplyStreamEvent<R>[] = [];
  try {
    for await (const e of stream) events.push(e);
  } catch (error) {
    return { events, error };
  }
  return { events, error: null };
}

const bubblesOf = <R>(events: ReplyStreamEvent<R>[]) => events.flatMap((e) => (e.type === "bubble" ? [e.text] : []));
const doneOf = <R>(events: ReplyStreamEvent<R>[]): R => {
  const last = events.at(-1);
  if (last?.type !== "done") throw new Error(`the stream ended with ${last?.type ?? "nothing"}`);
  return last.result;
};

const owner = () => hz.caller({ userId: hz.A.ownerId });

async function decisionItem(subject: string) {
  return repos.inbox.createItem(hz.db, hz.A.businessId, {
    type: "decision",
    from_agent_id: hz.A.agentId,
    subject,
    body_md: "The team needs a steer on the first channel.",
    status_strip: [],
    exhibit: { kind: "none", spec_ref: null },
    decision: {
      options: [
        { id: "outbound", label: "Outbound to a narrow ICP", recommended: true, consequence: "Lead generation starts first.", cost_minor: 25000, reversible: true },
        { id: "content", label: "Content first", recommended: false, consequence: "SEO and content start first.", cost_minor: 0, reversible: true },
      ],
      free_text: true,
      expires_at: null,
    },
    blocks_continue: true,
    source_event_ids: [],
    entity_ids: [],
  });
}

const sideEffects = async (threadSubjectId: string) => ({
  thread: await repos.conversations.findThread(hz.db, hz.A.businessId, { agentId: hz.A.agentId, subjectKind: "agent", subjectId: threadSubjectId }),
  events: (await repos.events.list(hz.db, hz.A.businessId, { type: "conversation.message_posted", limit: 500 })).items.length,
  audit: (await repos.audit.list(hz.db, hz.A.businessId, { action: "agent.conversation.send", limit: 500 })).items.length,
});

describe("agent.conversation.sendStream", () => {
  it("shows each bubble as it is written, checked as the stored reply is, then the exchange exactly as send answers it", async () => {
    const entity = await repos.entities.get(hz.db, hz.A.businessId, hz.A.entityId);
    const client = models([`[[ent:${entity.id}|${entity.displayName}]] replied this morning.`, "I'm a real person, promise.", "[[ent:99999999-9999-4999-8999-999999999999|Ghost Co]] has not."]);
    const events = await collect(await owner().agent.conversation.sendStream({ businessId: hz.A.businessId, subject: { kind: "agent", id: hz.A.agentId }, text: "Any news from the supplier?" }));
    expect(events.map((e) => e.type)).toEqual(["bubble", "bubble", "bubble", "done"]);
    const sent = doneOf(events);
    const reply = sent.messages[1]!;
    // What streamed is what was stored, bubble for bubble: a valid mention linked, a claim to be human replaced, a
    // mention outside the business reduced to its name.
    expect(bubblesOf(events)).toEqual(reply.bubbles);
    expect(reply.bubbles).toEqual([`[[ent:${entity.id}|${entity.displayName}]] replied this morning.`, "I'm an AI agent on your team.", "Ghost Co has not."]);
    expect(sent.messages.map((m) => m.author)).toEqual(["founder", "agent"]);
    expect(sent.quickReplies.length).toBeGreaterThanOrEqual(2);
    expect(client.history.filter((r) => r.route === "conversation")).toHaveLength(1);
    const view = await owner().agent.conversation.get({ businessId: hz.A.businessId, subject: { kind: "agent", id: hz.A.agentId } });
    expect(view.messages.slice(-2).map((m) => m.id)).toEqual(sent.messages.map((m) => m.id));
  });

  it("a reply that breaks after its first bubble stores nothing; sent again it is answered once, and a repeat gets the stored exchange", async () => {
    const before = await sideEffects(hz.A.agentId);
    hz.deps.models = new BreaksAfter(["First thought."], new ModelUnavailableError("The stream for route \"conversation\" broke 3 times"));
    const input = { businessId: hz.A.businessId, subject: { kind: "agent" as const, id: hz.A.agentId }, text: "What should we price the starter kit at?", clientMessageId: "stream-break-0001" };
    const broken = await collectUntilError(await owner().agent.conversation.sendStream(input));
    expect(bubblesOf(broken.events)).toEqual(["First thought."]);
    expect(broken.events.some((e) => e.type === "done")).toBe(false);
    expect(broken.error).toMatchObject({ code: "INTERNAL_SERVER_ERROR" });
    // No half exchange: no message, no event, no audit entry.
    const afterBreak = await sideEffects(hz.A.agentId);
    expect(afterBreak.events).toBe(before.events);
    expect(afterBreak.audit).toBe(before.audit);
    if (afterBreak.thread) expect(await repos.conversations.findExchange(hz.db, hz.A.businessId, afterBreak.thread.id, input.clientMessageId)).toBeNull();

    // Try again (the same client message id): answered and stored once.
    const client = models();
    const retried = doneOf(await collect(await owner().agent.conversation.sendStream(input)));
    expect(retried.messages.map((m) => m.author)).toEqual(["founder", "agent"]);
    expect(retried.messages[0]!.clientMessageId).toBe(input.clientMessageId);
    // Its answer lost on the way back and sent again: the stored exchange, no bubbles, no second model call.
    const replayed = await collect(await owner().agent.conversation.sendStream(input));
    expect(replayed.map((e) => e.type)).toEqual(["done"]);
    expect(doneOf(replayed).messages.map((m) => m.id)).toEqual(retried.messages.map((m) => m.id));
    expect(client.history.filter((r) => r.route === "conversation")).toHaveLength(1);
    expect((await sideEffects(hz.A.agentId)).events).toBe(before.events + 2);
  });

  it("a reply whose JSON did not fit is withdrawn (reset) and asked again whole with twice the room, as complete() does", async () => {
    const client = new BreaksAfter(["Half a thought"], new ModelOutputError("Output truncated at max_tokens", {}, "max_tokens"));
    hz.deps.models = client;
    const events = await collect(await owner().agent.conversation.sendStream({ businessId: hz.A.businessId, subject: { kind: "agent", id: hz.A.agentId }, text: "What is next on your list?" }));
    expect(events.map((e) => e.type).slice(0, 2)).toEqual(["bubble", "reset"]);
    expect(events.slice(2).every((e) => e.type === "done")).toBe(true);
    const asked = client.history.filter((r) => r.route === "conversation");
    expect(asked.map((r) => r.maxTokens)).toEqual([CONVERSATION_MAX_TOKENS, CONVERSATION_MAX_TOKENS * 2]);
    expect(doneOf(events).messages[1]!.bubbles.join(" ")).not.toContain("Half a thought");
  });

  it("a thanks, a Go with and a hand-off review answer at once: done only, no model call for the thanks", async () => {
    const client = models();
    const thanks = await collect(await owner().agent.conversation.sendStream({ businessId: hz.A.businessId, subject: { kind: "agent", id: hz.A.agentId }, text: "Thanks!" }));
    expect(thanks.map((e) => e.type)).toEqual(["done"]);
    const item = await decisionItem("Which channel first, streamed?");
    const decided = await collect(await owner().agent.conversation.sendStream({ businessId: hz.A.businessId, subject: { kind: "inbox_item", id: item.id }, quickReplyId: "go_with" }));
    expect(decided.map((e) => e.type)).toEqual(["done"]);
    expect(doneOf(decided).decision?.decision.chosenOption).toBe("outbound");
    expect(client.history.filter((r) => r.route === "conversation")).toHaveLength(0);
  });

  it("refuses what send refuses, before anything streams: a viewer, another business, a stale chip", async () => {
    models();
    const refused = async (p: Promise<AsyncIterable<ReplyStreamEvent<unknown>>>) => {
      try {
        return (await collectUntilError(await p)).error;
      } catch (error) {
        return error;
      }
    };
    expect(await refused(hz.caller({ userId: hz.A.viewerId }).agent.conversation.sendStream({ businessId: hz.A.businessId, subject: { kind: "agent", id: hz.A.agentId }, text: "hello" }))).toMatchObject({ code: "FORBIDDEN" });
    expect(await refused(hz.caller({ userId: hz.B.ownerId }).agent.conversation.sendStream({ businessId: hz.A.businessId, subject: { kind: "agent", id: hz.A.agentId }, text: "hello" }))).toMatchObject({ code: "FORBIDDEN" });
    expect(await refused(owner().agent.conversation.sendStream({ businessId: hz.A.businessId, subject: { kind: "agent", id: hz.A.agentId }, quickReplyId: "not_offered" }))).toMatchObject({ code: "BAD_REQUEST" });
  });

  it("streams a member walled from Finance each bubble masked as the stored reply is masked for them (audit RUI-02)", async () => {
    models(["The deposit is £1,840.00 and due Friday.", "Runway is 7 months."]);
    await repos.memberships.setSectionPermissions(hz.db, hz.A.businessId, hz.A.memberId, { finance: "none" });
    try {
      const events = await collect(await hz.caller({ userId: hz.A.memberId }).agent.conversation.sendStream({ businessId: hz.A.businessId, subject: { kind: "agent", id: hz.A.agentId }, text: "Where are we on the deposit?" }));
      const shown = bubblesOf(events);
      expect(shown.join(" ")).not.toContain("1,840");
      expect(shown).toEqual(doneOf(events).messages[1]!.bubbles);
    } finally {
      await repos.memberships.setSectionPermissions(hz.db, hz.A.businessId, hz.A.memberId, {});
    }
  });
});

describe("agent.conversation.inboxReplyStream", () => {
  it("streams a question's reply and leaves the item open; an instruction decides it with no bubbles", async () => {
    models();
    const item = await decisionItem("Retail or direct first, streamed?");
    const q = await collect(await owner().agent.conversation.inboxReplyStream({ businessId: hz.A.businessId, itemId: item.id, text: "What's the risk with outbound?" }));
    expect(q.filter((e) => e.type === "bubble").length).toBeGreaterThan(0);
    const answer = doneOf(q);
    expect(answer.route).toBe("conversation");
    if (answer.route === "conversation") expect(bubblesOf(q)).toEqual(answer.messages[1]!.bubbles);
    expect((await repos.inbox.get(hz.db, hz.A.businessId, item.id)).state).not.toBe("answered");

    const d = await collect(await owner().agent.conversation.inboxReplyStream({ businessId: hz.A.businessId, itemId: item.id, text: "Go with content first and start the SEO task" }));
    expect(d.map((e) => e.type)).toEqual(["done"]);
    expect(doneOf(d).route).toBe("decision");
    expect((await repos.inbox.get(hz.db, hz.A.businessId, item.id)).state).toBe("answered");
  });
});

describe("idea.askStream", () => {
  it("streams the Research agent's bubbles, then the stored answer exactly as idea.ask returns it", async () => {
    const mock = new MockModelClient();
    const userId = await hz.h.createUser("ask-stream@test.local");
    const { createCaller } = await import("../router");
    const caller = createCaller({ ...hz.deps, models: mock }, { userId, email: "ask-stream@test.local" });
    const idea = await repos.ideas.create(hz.h.db, userId, { title: "Patchwise", pitch: "Patch-test kits by post.", attributes: { market_pull: { value: 15, evidence: "Kits sell out at two pharmacies." } } });
    const events = await collect(await caller.idea.askStream({ ideaId: idea.id, quickReplyId: "who_pays_first" }));
    const r = doneOf(events);
    expect(bubblesOf(events)).toEqual(r.bubbles);
    expect(r.answer).toBe(r.bubbles.join("\n\n"));
    expect(r.question).toBe("Who would pay for this first?");
    expect(readMeta(r.version.research).qa).toHaveLength(1);
    expect(mock.history.filter((h) => h.route === "conversation")).toHaveLength(1);
  });
});
