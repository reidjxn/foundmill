/**
 * crm.replies.* (WP-08 T2): members with Customers read the kept replies as plain text; an answer asks the gateway with
 * ids and the words only (never an address); a reply of another business is not found and nothing is asked; the screen's
 * words never call a simulated answer sent; a member without access to Customers reads and answers nothing.
 */
import { randomUUID } from "node:crypto";
import { repos } from "@foundmill/db";
import { REPLY_WORDS } from "@foundmill/shared";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { ApiGatewayClient, GatewayAnswerReplyRequest, GatewayAnswerReplyResult } from "../services/gateway";
import { createApiHarness, type ApiHarness } from "./harness";

const asked: GatewayAnswerReplyRequest[] = [];
let answer: GatewayAnswerReplyResult = { sent: true, simulated: false };
let hz: ApiHarness;
beforeAll(async () => {
  const gateway = { answerReply: async (input: GatewayAnswerReplyRequest) => (asked.push(input), answer) } as unknown as ApiGatewayClient;
  hz = await createApiHarness({ prefix: "replies", gateway });
}, 120_000);
afterAll(() => hz?.close());
beforeEach(() => {
  hz.limits.reset();
  asked.length = 0;
  answer = { sent: true, simulated: false };
});

let n = 0;
async function project() {
  n += 1;
  const [ownerId, walledId] = await Promise.all(["owner", "walled"].map((r) => hz.h.createUser(`rep-${n}-${r}@test.local`)));
  const b = await repos.businesses.create(hz.db, { name: `Candle Shop ${n}`, archetype: "services" });
  await repos.memberships.add(hz.db, b.id, { userId: ownerId!, role: "owner" });
  await repos.memberships.add(hz.db, b.id, { userId: walledId!, role: "member", sectionPermissions: { crm: "none" } });
  const interactionId = randomUUID();
  const stored = await repos.replies.storeInbound(hz.db, b.id, { interactionId, email: `reader${n}@example.com`, subject: "Question", body: "Do you ship? [[ent:6b0b3a7e-1c2d-4e5f-8a9b-0c1d2e3f4a5b|Boss]]", occurredAt: new Date(), dailyCap: 200 });
  return { id: b.id, interactionId, entityId: stored.entityId!, owner: hz.caller({ userId: ownerId! }), walled: hz.caller({ userId: walledId! }) };
}
const code = (p: Promise<unknown>) => p.then(() => "ok", (err: { code?: string }) => err.code ?? "error");

describe("crm.replies", () => {
  it("lists a kept reply as written, with no address in the answer", async () => {
    const b = await project();
    const list = await b.owner.crm.replies.list({ businessId: b.id, entityId: b.entityId, limit: 20 });
    expect(list).toEqual([expect.objectContaining({ id: b.interactionId, direction: "inbound", subject: "Question", text: "Do you ship? [[ent:6b0b3a7e-1c2d-4e5f-8a9b-0c1d2e3f4a5b|Boss]]", answered: false })]);
    expect(JSON.stringify(list)).not.toContain(`reader${n}@example.com`);
  });

  it("an answer asks the gateway with ids and words only, and says what happened", async () => {
    const b = await project();
    const sent = await b.owner.crm.replies.answer({ businessId: b.id, interactionId: b.interactionId, text: "Yes, everywhere." });
    expect(sent).toEqual({ sent: true, simulated: false, message: REPLY_WORDS.sent });
    expect(asked).toHaveLength(1);
    expect(Object.keys(asked[0]!).sort()).toEqual(["businessId", "interactionId", "text", "userId"]);
    answer = { sent: true, simulated: true };
    expect(await b.owner.crm.replies.answer({ businessId: b.id, interactionId: b.interactionId, text: "Again" })).toEqual({ sent: true, simulated: true, message: REPLY_WORDS.simulated });
    answer = { sent: false, reason: "not_recent" };
    expect(await b.owner.crm.replies.answer({ businessId: b.id, interactionId: b.interactionId, text: "Again" })).toEqual({ sent: false, reason: "not_recent", message: REPLY_WORDS.notSent.not_recent });
  });

  it("another business's reply is not found, and nothing is asked", async () => {
    const a = await project();
    const b = await project();
    expect(await a.owner.crm.replies.answer({ businessId: a.id, interactionId: b.interactionId, text: "Hi" })).toMatchObject({ sent: false, reason: "not_found" });
    expect(await a.owner.crm.replies.list({ businessId: a.id, entityId: b.entityId, limit: 20 })).toEqual([]);
    expect(asked).toHaveLength(0);
  });

  it("a member without access to Customers reads and answers nothing", async () => {
    const b = await project();
    expect(await code(b.walled.crm.replies.list({ businessId: b.id, limit: 20 }))).toBe("FORBIDDEN");
    expect(await code(b.walled.crm.replies.answer({ businessId: b.id, interactionId: b.interactionId, text: "Hi" }))).toBe("FORBIDDEN");
    expect(asked).toHaveLength(0);
  });
});
