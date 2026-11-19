/**
 * updates.* (WP-08 T3): a member saves a draft (and `update.drafted` is written); the preview is exactly what goes out
 * (the AI line of founder D2 when the team drafted it, the footer with the postal address); only an owner or an admin
 * sends, with ids only, and the words never call a simulated press sent; a sample business sends nothing; a member
 * without Distribution reads nothing; another business's update is not found.
 */
import { repos } from "@foundmill/db";
import { PROJECT_UPDATE_WORDS } from "@foundmill/shared";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { ApiGatewayClient, GatewaySendUpdateRequest, GatewaySendUpdateResult } from "../services/gateway";
import { createApiHarness, type ApiHarness } from "./harness";

const asked: GatewaySendUpdateRequest[] = [];
let answer: GatewaySendUpdateResult = { sent: 3, skipped: 0, remaining: 0, simulated: false, refusal: null };
let hz: ApiHarness;
beforeAll(async () => {
  const gateway = { sendUpdate: async (input: GatewaySendUpdateRequest) => (asked.push(input), answer) } as unknown as ApiGatewayClient;
  hz = await createApiHarness({ prefix: "updates", gateway });
}, 120_000);
afterAll(() => hz?.close());
beforeEach(() => {
  hz.limits.reset();
  asked.length = 0;
  answer = { sent: 3, skipped: 0, remaining: 0, simulated: false, refusal: null };
});

let n = 0;
async function project(opts: { demo?: boolean } = {}) {
  n += 1;
  const [ownerId, memberId, walledId] = await Promise.all(["owner", "member", "walled"].map((r) => hz.h.createUser(`upd-${n}-${r}@test.local`)));
  const b = await repos.businesses.create(hz.db, { name: `Candle Shop ${n}`, archetype: "services", ...(opts.demo ? { isDemo: true } : {}) } as never);
  await repos.memberships.add(hz.db, b.id, { userId: ownerId!, role: "owner" });
  await repos.memberships.add(hz.db, b.id, { userId: memberId!, role: "member" });
  await repos.memberships.add(hz.db, b.id, { userId: walledId!, role: "member", sectionPermissions: { distribution: "none" } });
  await repos.founders.upsert(hz.db, ownerId!, { displayName: "Maya Lopez" } as never);
  return { id: b.id, ownerId: ownerId!, owner: hz.caller({ userId: ownerId! }), member: hz.caller({ userId: memberId! }), walled: hz.caller({ userId: walledId! }) };
}
const code = (p: Promise<unknown>) => p.then(() => "ok", (err: { code?: string }) => err.code ?? "error");
const events = async (businessId: string, type: string) => (await repos.events.outboxPending(hz.db, businessId)).filter((o) => o.event.type === type).map((o) => o.event);

describe("updates", () => {
  it("a member saves a draft; update.drafted is written; a member without Distribution reads nothing", async () => {
    const b = await project();
    const saved = await b.member.updates.save({ businessId: b.id, subject: "Our first batch", body: "It shipped today." });
    expect(saved).toMatchObject({ status: "draft", draftedByAgentId: null });
    expect((await events(b.id, "update.drafted")).map((e) => e.payload)).toEqual([{ updateId: saved.id, agentId: null }]);
    expect((await b.owner.updates.list({ businessId: b.id })).updates.map((u) => u.id)).toEqual([saved.id]);
    expect(await code(b.walled.updates.list({ businessId: b.id }))).toBe("FORBIDDEN");
  });

  it("the preview is what goes out: the words as written, and the footer with the postal address", async () => {
    const b = await project();
    // A founder wrote this one: no AI line (the team-drafted case is in the gateway's follower-update test).
    const row = await repos.updates.saveDraft(hz.db, b.id, { subject: "News", body: "We shipped." });
    const before = await b.owner.updates.preview({ businessId: b.id, id: row.id });
    expect(before.postalAddressMissing).toBe(true);
    expect(before.text).toBe("We shipped.");
    await repos.postalAddress.set(hz.db, b.id, { address: "PO Box 1234, Springfield, IL 62701, USA", userId: null });
    const after = await b.owner.updates.preview({ businessId: b.id, id: row.id });
    expect(after.postalAddressMissing).toBe(false);
    expect(after.footer).toContain("PO Box 1234, Springfield, IL 62701, USA");
  });

  it("only an owner or an admin sends, with ids only; the words follow what the gateway answered", async () => {
    const b = await project();
    const draft = await b.member.updates.save({ businessId: b.id, subject: "News", body: "Hi" });
    expect(await code(b.member.updates.send({ businessId: b.id, id: draft.id }))).toBe("FORBIDDEN");
    expect(asked).toHaveLength(0);
    expect((await b.owner.updates.send({ businessId: b.id, id: draft.id })).message).toBe(PROJECT_UPDATE_WORDS.sent(3));
    expect(asked).toEqual([{ businessId: b.id, updateId: draft.id, userId: b.ownerId }]);
    answer = { sent: 50, skipped: 0, remaining: 12, simulated: false, refusal: "daily_cap" };
    expect((await b.owner.updates.send({ businessId: b.id, id: draft.id })).message).toBe(PROJECT_UPDATE_WORDS.sentWithRest(50, 12));
    answer = { sent: 2, skipped: 0, remaining: 0, simulated: true, refusal: null };
    expect((await b.owner.updates.send({ businessId: b.id, id: draft.id })).message).toBe(PROJECT_UPDATE_WORDS.simulated);
  });

  it("a sample business sends nothing, and another business's update is not found", async () => {
    const demo = await project({ demo: true });
    const draft = await demo.owner.updates.save({ businessId: demo.id, subject: "News", body: "Hi" });
    expect(await demo.owner.updates.send({ businessId: demo.id, id: draft.id })).toMatchObject({ simulated: true, refusal: "simulated" });
    expect(asked).toHaveLength(0);
    const other = await project();
    expect(await code(other.owner.updates.send({ businessId: other.id, id: draft.id }))).toBe("NOT_FOUND");
    expect(await code(other.owner.updates.get({ businessId: other.id, id: draft.id }))).toBe("NOT_FOUND");
  });

  it("an owner deletes a draft; it cannot be sent after", async () => {
    const b = await project();
    const draft = await b.member.updates.save({ businessId: b.id, subject: "News", body: "Hi" });
    expect(await b.owner.updates.cancel({ businessId: b.id, id: draft.id })).toEqual({ canceled: true });
    expect(await b.owner.updates.send({ businessId: b.id, id: draft.id })).toMatchObject({ refusal: "not_draft" });
    expect(asked).toHaveLength(0);
  });
});
