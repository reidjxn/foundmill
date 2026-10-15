/**
 * LIVE writes are throttled per person and announce a connection request once (audit GLS2F-05, LS2-05): a burst of
 * requests, messages or posts is answered 429 past the allowance, a repeated request signals its recipient no second
 * time, and the message history is read a page at a time.
 */
import { LIMITS } from "@foundmill/config";
import { repos } from "@foundmill/db";
import { MemoryRedis, userStreamKey } from "@foundmill/events";
import { TRPCError } from "@trpc/server";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createApiHarness, type ApiHarness } from "./harness";

let hz: ApiHarness;
let redis: MemoryRedis;
beforeAll(async () => {
  redis = new MemoryRedis();
  hz = await createApiHarness({ prefix: "livelimits", redis, env: { LIVE_MODE: "1" } });
  for (const businessId of [hz.A.businessId, hz.B.businessId]) {
    await repos.businesses.setGameMode(hz.db, businessId, "live");
    await repos.businesses.commit(hz.db, businessId, { archetype: "b2b_saas" });
  }
  const users = [hz.A, hz.B].flatMap((side) => [side.ownerId, side.adminId, side.memberId, side.viewerId]);
  for (const userId of users) if (userId) await repos.social.confirmAdult(hz.db, userId);
}, 120_000);
afterAll(() => hz.close());
beforeEach(() => hz.limits.reset());

const as = (userId: string) => hz.caller({ userId });

/** Settled outcomes by HTTP-ish code: "OK" or the tRPC code. */
async function outcomes(calls: Promise<unknown>[]): Promise<Record<string, number>> {
  const out: Record<string, number> = {};
  for (const r of await Promise.allSettled(calls)) {
    const key = r.status === "fulfilled" ? "OK" : r.reason instanceof TRPCError ? r.reason.code : "other";
    out[key] = (out[key] ?? 0) + 1;
  }
  return out;
}

/** How many times the person's own stream was told a request reached them (the only place a new request is announced). */
const requestSignals = async (userId: string) =>
  (await redis.xrange(userStreamKey(userId), "-", "+")).filter(([, fields]) => (JSON.parse(String(fields[fields.indexOf("json") + 1])) as { kind: string }).kind === "connection_requested").length;

describe("connection requests", () => {
  it("announces a request once and signals nobody for a repeat; a burst past the allowance is 429", async () => {
    const from = as(hz.A.ownerId);
    const to = hz.B.ownerId;
    const burst = await outcomes(Array.from({ length: 10 }, () => from.live.connections.request({ businessId: hz.A.businessId, toUserId: to })));
    // The pair allowance: three asks a day, however many were sent at once.
    expect(burst).toEqual({ OK: LIMITS.liveRequestsPerPairPerDay, TOO_MANY_REQUESTS: 10 - LIMITS.liveRequestsPerPairPerDay });
    const [c] = await repos.social.listConnections(hz.db, hz.A.ownerId, { direction: "outgoing" });
    expect(c).toBeDefined();
    expect(await requestSignals(to)).toBe(1);
    // A repeat after the row exists (a fresh allowance) still announces nothing.
    hz.limits.reset();
    await from.live.connections.request({ businessId: hz.A.businessId, toUserId: to });
    expect(await requestSignals(to)).toBe(1);
  });

  it("request, withdraw, request again stops at the pair allowance", async () => {
    const from = as(hz.A.adminId);
    const to = hz.B.adminId;
    const results: string[] = [];
    for (let i = 0; i < LIMITS.liveRequestsPerPairPerDay + 2; i++) {
      try {
        const c = await from.live.connections.request({ businessId: hz.A.businessId, toUserId: to });
        await from.live.connections.remove({ connectionId: c.id });
        results.push("OK");
      } catch (err) {
        results.push(err instanceof TRPCError ? err.code : "other");
      }
    }
    expect(results.slice(0, LIMITS.liveRequestsPerPairPerDay)).toEqual(Array(LIMITS.liveRequestsPerPairPerDay).fill("OK"));
    expect(results.slice(LIMITS.liveRequestsPerPairPerDay)).toEqual(["TOO_MANY_REQUESTS", "TOO_MANY_REQUESTS"]);
  });
});

describe("messages", () => {
  it("throttles a flood in one thread", async () => {
    const a = hz.A.ownerId;
    const b = hz.B.memberId;
    const link = await repos.social.requestConnection(hz.db, a, b);
    await repos.social.respondConnection(hz.db, b, link.id, "accepted");
    const sender = as(a);
    const first = await sender.live.messages.send({ toUserIds: [b], body: "Hello" });
    const flood = await outcomes(Array.from({ length: 30 }, (_, i) => sender.live.messages.send({ threadId: first.threadId, body: `message ${i}` })));
    // The thread allowance is the tighter one (a first message is counted against its recipients, a reply against its thread).
    expect(flood.OK).toBe(LIMITS.liveMessagesPerThreadPerMinute);
    expect(flood.TOO_MANY_REQUESTS).toBe(30 - LIMITS.liveMessagesPerThreadPerMinute);
    const stored = await repos.social.listMessages(hz.db, a, first.threadId, { limit: 200 });
    expect(stored.items).toHaveLength(LIMITS.liveMessagesPerThreadPerMinute + 1);
    // Another person's messages are not held back by this one's.
    expect(await outcomes([as(b).live.messages.send({ threadId: first.threadId, body: "Reply" })])).toEqual({ OK: 1 });
  });

  it("reads history a page at a time and says when there is more", async () => {
    const a = hz.A.adminId;
    const b = hz.B.viewerId;
    const link = await repos.social.requestConnection(hz.db, a, b);
    await repos.social.respondConnection(hz.db, b, link.id, "accepted");
    const thread = await repos.social.startThread(hz.db, a, [b], null);
    for (let i = 0; i < 7; i++) await repos.social.sendMessage(hz.db, a, thread.id, `old ${i}`);
    const page = await as(a).live.messages.list({ threadId: thread.id, limit: 5 });
    expect(page.items).toHaveLength(5);
    expect(page.nextCursor).not.toBeNull();
    const rest = await as(a).live.messages.list({ threadId: thread.id, limit: 5, cursor: page.nextCursor });
    expect(rest.items).toHaveLength(2);
    expect(rest.nextCursor).toBeNull();
  });
});

describe("posts", () => {
  it("throttles a burst of posts per person", async () => {
    const owner = as(hz.A.ownerId);
    const community = await repos.social.createCommunity(hz.db, { name: "Limits Club", slug: "limits-club", visibility: "public", createdBy: hz.A.ownerId, ownerBusinessId: hz.A.businessId });
    const burst = await outcomes(Array.from({ length: 10 }, (_, i) => owner.live.communities.post({ communityId: community.id, bodyMd: `post ${i}` })));
    expect(burst).toEqual({ OK: LIMITS.livePostsPerUserPerMinute, TOO_MANY_REQUESTS: 10 - LIMITS.livePostsPerUserPerMinute });
  });
});
