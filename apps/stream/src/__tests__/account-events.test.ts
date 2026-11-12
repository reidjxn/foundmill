/**
 * Account events over real sockets (docs/ARCHITECTURE.md §12): `ae:<userId>` carries a person's own account events
 * to connections signed in as that account, and to nobody else. Another signed-in account, a cofounder in a project
 * the person belongs to, and a connection that is not signed in receive nothing; an account event never leaves on a
 * business stream; the content-free signals on `u:<userId>` keep working beside it.
 */
import { createBusinessFixture, type BusinessFixture } from "@foundmill/db/__tests__/rls/fixtures";
import { createTestDb, type TestHarness } from "@foundmill/db/testing/pglite";
import type { Db } from "@foundmill/db";
import { accountStreamKey, businessStreamKey, publishUserSignal, runAccountOutboxRelay, serializeAccountEvent, writeAccountEvent, type MemoryRedis, type Queryable, type TransactionalQueryable } from "@foundmill/events";
import { accountFixtureEvent, EVENT_FIXTURES, fixtureId } from "@foundmill/events/testing/fixtures";
import type { AccountEventType } from "@foundmill/shared";
import { createLocalJWKSet, exportJWK, generateKeyPair } from "jose";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { createTokenVerifier } from "../auth";
import { createMemoryAuthorizer, createRepoAuthorizer } from "../authorize";
import { accountChannel, businessChannel, userChannel } from "../protocol";
import { BUSINESS_A, BUSINESS_B, devToken, openSocket, sleep, startTestServer, USER_A, USER_B, waitFor, type TestServer, type TestSocket } from "./helpers";

/** A cofounder of USER_A: another account in the same business. */
const USER_C = fixtureId("user-c");
const people = { members: { [USER_A]: [BUSINESS_A], [USER_C]: [BUSINESS_A], [USER_B]: [BUSINESS_B] }, sessions: {} };

const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
  while (cleanups.length) await cleanups.pop()!();
});

async function boot(opts: Parameters<typeof startTestServer>[0] = {}): Promise<TestServer> {
  const t = await startTestServer({ authorizer: createMemoryAuthorizer(people), ...opts });
  cleanups.push(() => t.close());
  return t;
}

async function connect(t: TestServer, userId: string): Promise<TestSocket> {
  const s = await openSocket(t.url, devToken(userId));
  cleanups.push(() => s.close());
  return s;
}

let seq = 0;
/** One entry on a person's account stream, exactly as the account relay writes it. Returns the event's id. */
async function relayed(redis: MemoryRedis, userId: string, type: AccountEventType = "profile.published", handle = "maya-okafor"): Promise<string> {
  const event = accountFixtureEvent(type, { userId, id: fixtureId(`account-stream-${++seq}`), payload: { handle }, actor: { kind: "system", id: "internal-actor-name" } });
  await redis.xadd(accountStreamKey(userId), "*", "id", event.id, "type", event.type, "json", serializeAccountEvent(event));
  return event.id;
}

/** The hub reads from the live tail: give each new reader its first read before publishing. */
const live = async (t: TestServer, readers: number, ...sockets: [TestSocket, number][]) => {
  await waitFor(() => t.server.hub.readerCount === readers && sockets.every(([s, n]) => s.subscribed.length + s.errors.length === n), 3_000, "subscriptions settled");
  await sleep(30);
};

describe("ae:<userId> over sockets", () => {
  it("delivers a person's account events to them, and to nobody else: not another signed-in account, not a cofounder in the same project", async () => {
    const t = await boot();
    const mine = await connect(t, USER_A);
    const secondTab = await connect(t, USER_A);
    const other = await connect(t, USER_B);
    const cofounder = await connect(t, USER_C);
    mine.sub(accountChannel(USER_A));
    secondTab.sub(`ae:${USER_A.toUpperCase()}`);
    // Each of the others asks for the person's channel, and has channels of their own open.
    other.sub(accountChannel(USER_A));
    other.sub(accountChannel(USER_B));
    cofounder.sub(accountChannel(USER_A));
    cofounder.sub(accountChannel(USER_C));
    cofounder.sub(businessChannel(BUSINESS_A));
    await live(t, 4, [mine, 1], [secondTab, 1], [other, 2], [cofounder, 3]);
    expect(other.errors.map((e) => [e.ch, e.code])).toEqual([[accountChannel(USER_A), "forbidden"]]);
    expect(cofounder.errors.map((e) => [e.ch, e.code])).toEqual([[accountChannel(USER_A), "forbidden"]]);
    expect(other.subscribed).toEqual([accountChannel(USER_B)]);
    expect(cofounder.subscribed.sort()).toEqual([accountChannel(USER_C), businessChannel(BUSINESS_A)].sort());

    const eventId = await relayed(t.redis, USER_A);
    await waitFor(() => mine.events.length === 1 && secondTab.events.length === 1, 3_000, "account event delivered to the person's tabs");
    expect(mine.events[0]).toEqual({ ch: accountChannel(USER_A), e: { id: eventId, userId: USER_A, type: "profile.published", occurredAt: "2026-10-05T09:00:00.000Z", payload: { handle: "maya-okafor" } } });
    expect(secondTab.events[0]!.e).toEqual(mine.events[0]!.e);
    // The actor stays with the services, as in the table's column grant.
    expect(JSON.stringify(mine.frames)).not.toContain("internal-actor-name");
    await sleep(80);
    expect(other.events).toEqual([]);
    expect(cofounder.events).toEqual([]);
    expect(JSON.stringify([other.frames, cofounder.frames])).not.toContain("maya-okafor");
    expect(t.metrics.get("subscriptions_denied_total")).toBe(2);
    // Nobody but the person's own sockets holds the channel.
    expect(t.server.subscriptions().filter((s) => s.channels.some((ch) => ch.toLowerCase() === accountChannel(USER_A))).map((s) => s.userId)).toEqual([USER_A, USER_A]);
  });

  it("a connection that is not signed in gets no socket, so it receives nothing", async () => {
    const pair = await generateKeyPair("ES256");
    const jwks = createLocalJWKSet({ keys: [{ ...(await exportJWK(pair.publicKey)), kid: "k", alg: "ES256" }] });
    const t = await boot({ auth: createTokenVerifier({ appEnv: "production", jwks }) });
    await expect(openSocket(t.url, null)).rejects.toThrow(/401/);
    await expect(openSocket(t.url, "not-a-token")).rejects.toThrow(/401/);
    // A dev token is not a credential outside development and test.
    await expect(openSocket(t.url, devToken(USER_A))).rejects.toThrow(/401/);
    await relayed(t.redis, USER_A);
    await sleep(60);
    expect(t.server.connections).toBe(0);
    expect(t.server.hub.readerCount).toBe(0);
    expect(t.metrics.get("auth_failures_total")).toBe(3);
  });

  it("an account event never leaves on a business stream, and nothing but the person's own account events leaves on their channel", async () => {
    const t = await boot();
    const mine = await connect(t, USER_A);
    const cofounder = await connect(t, USER_C);
    mine.sub(accountChannel(USER_A));
    mine.sub(businessChannel(BUSINESS_A));
    cofounder.sub(businessChannel(BUSINESS_A));
    await live(t, 2, [mine, 2], [cofounder, 1]);

    // A stray writer puts the person's account event on the business stream, in either envelope.
    const strayed = accountFixtureEvent("profile.published", { userId: USER_A, id: fixtureId("strayed"), payload: { handle: "strayed-handle" } });
    await t.redis.xadd(businessStreamKey(BUSINESS_A), "*", "id", strayed.id, "type", strayed.type, "json", serializeAccountEvent(strayed));
    await t.redis.xadd(businessStreamKey(BUSINESS_A), "*", "id", strayed.id, "type", strayed.type, "json", JSON.stringify({ id: strayed.id, businessId: BUSINESS_A, type: strayed.type, occurredAt: "2026-11-12T09:00:00.000Z", actor: { kind: "user", id: USER_A }, entityIds: [], payload: { handle: "strayed-handle" }, narrated: false }));
    // And things that are not the person's own account events land on their account stream.
    const anothers = accountFixtureEvent("profile.published", { userId: USER_B, id: fixtureId("anothers"), payload: { handle: "planted-handle" } });
    await t.redis.xadd(accountStreamKey(USER_A), "*", "id", anothers.id, "type", anothers.type, "json", serializeAccountEvent(anothers));
    await t.redis.xadd(accountStreamKey(USER_A), "*", "id", "x", "type", "payment.received", "json", JSON.stringify({ id: fixtureId("planted-payment"), businessId: BUSINESS_B, userId: USER_A, type: "payment.received", occurredAt: "2026-11-12T09:00:00.000Z", actor: { kind: "system", id: "test" }, entityIds: [], payload: { note: "planted-payment" } }));
    await t.redis.xadd(accountStreamKey(USER_A), "*", "id", "y", "type", "profile.published", "json", "{planted-noise");

    // Then one real event on each stream, so the test knows the readers have passed the planted ones.
    const businessEvent = { id: fixtureId("real-task"), businessId: BUSINESS_A, type: "task.started", occurredAt: "2026-11-12T09:00:01.000Z", actor: { kind: "system", id: "test" }, entityIds: [], payload: EVENT_FIXTURES["task.started"], narrated: false };
    await t.redis.xadd(businessStreamKey(BUSINESS_A), "*", "id", businessEvent.id, "type", businessEvent.type, "json", JSON.stringify(businessEvent));
    const realId = await relayed(t.redis, USER_A, "profile.unpublished");
    await waitFor(() => mine.events.length === 2 && cofounder.events.length === 1, 3_000, "the real events arrived");
    await sleep(60);

    expect(mine.events.map((f) => [f.ch, (f.e as { id: string }).id]).sort()).toEqual([[accountChannel(USER_A), realId], [businessChannel(BUSINESS_A), businessEvent.id]].sort());
    expect(cofounder.events.map((f) => [f.ch, (f.e as { id: string }).id])).toEqual([[businessChannel(BUSINESS_A), businessEvent.id]]);
    const everything = JSON.stringify([mine.frames, cofounder.frames]);
    for (const planted of ["strayed-handle", "planted-handle", "planted-payment", "planted-noise"]) expect(everything).not.toContain(planted);
    // Two strays walled for each of the two readers of the business stream, three planted entries walled for the owner.
    expect(t.metrics.get("events_walled_total")).toBe(7);
  });

  it("the content-free signals on u:<userId> keep working beside it, each on its own channel", async () => {
    const t = await boot();
    const mine = await connect(t, USER_A);
    const other = await connect(t, USER_B);
    mine.sub(userChannel(USER_A));
    mine.sub(accountChannel(USER_A));
    other.sub(userChannel(USER_B));
    await live(t, 3, [mine, 2], [other, 1]);
    await publishUserSignal(t.redis, USER_A, { kind: "message_received" });
    const eventId = await relayed(t.redis, USER_A);
    await waitFor(() => mine.events.length === 2, 3_000, "signal and account event delivered");
    await sleep(40);
    const byChannel = Object.fromEntries(mine.events.map((f) => [f.ch, f.e]));
    expect(Object.keys(byChannel).sort()).toEqual([accountChannel(USER_A), userChannel(USER_A)].sort());
    expect(byChannel[userChannel(USER_A)]).toMatchObject({ type: "live.signal", kind: "message_received" });
    expect(Object.keys(byChannel[userChannel(USER_A)] as object).sort()).toEqual(["at", "kind", "type"]);
    expect(byChannel[accountChannel(USER_A)]).toMatchObject({ id: eventId, type: "profile.published", payload: { handle: "maya-okafor" } });
    expect(other.events).toEqual([]);
    // The two streams are separate keys: the signal stream holds no event, the account stream no signal.
    expect((await t.redis.xrange(userChannel(USER_A), "-", "+")).length).toBe(1);
    expect((await t.redis.xrange(accountStreamKey(USER_A), "-", "+")).length).toBe(1);
  });
});

describe("ae:<userId> from the real tables (PGlite): writer, account relay, repo authorizer, socket", () => {
  let h: TestHarness;
  let A: BusinessFixture;
  beforeAll(async () => {
    h = await createTestDb();
    A = await createBusinessFixture(h, "stream-account-events");
  }, 120_000);
  afterAll(() => h?.close());

  it("an event committed for the owner reaches the owner's socket only; the other people of the owner's project and a stranger get nothing", async () => {
    const stranger = await h.createUser("stranger-account-events@stream.test");
    const t = await boot({ authorizer: createRepoAuthorizer(h.db as unknown as Db) });
    const relay = runAccountOutboxRelay(h.db as unknown as TransactionalQueryable, t.redis, { intervalMs: 5 });
    cleanups.push(() => relay.stop());

    const owner = await connect(t, A.ownerId);
    const others = await Promise.all([A.adminId, A.memberId, A.viewerId, stranger].map((id) => connect(t, id)));
    owner.sub(accountChannel(A.ownerId));
    for (const s of others) s.sub(accountChannel(A.ownerId));
    // The people of the project also watch the project's own stream, which they may.
    for (const s of others.slice(0, 3)) s.sub(businessChannel(A.businessId));
    await live(t, 2, [owner, 1], [others[0]!, 2], [others[1]!, 2], [others[2]!, 2], [others[3]!, 1]);
    for (const s of others) expect(s.errors.map((e) => [e.ch, e.code])).toEqual([[accountChannel(A.ownerId), "forbidden"]]);

    const businessEventsBefore = (await h.pg.query<{ n: number }>(`select count(*)::int as n from events`)).rows[0]!.n;
    const eventId = await h.db.transaction((tx) => writeAccountEvent(tx as unknown as Queryable, { userId: A.ownerId, type: "profile.published", actor: { kind: "user", id: A.ownerId }, payload: { handle: "the-owner" } }));

    await waitFor(() => owner.events.length === 1, 5_000, "the owner's account event arrived");
    expect(owner.events[0]).toMatchObject({ ch: accountChannel(A.ownerId), e: { id: eventId, userId: A.ownerId, type: "profile.published", payload: { handle: "the-owner" } } });
    expect(Object.keys(owner.events[0]!.e as object).sort()).toEqual(["id", "occurredAt", "payload", "type", "userId"]);
    await sleep(120);
    for (const s of others) expect(s.events).toEqual([]);
    expect(JSON.stringify(others.map((s) => s.frames))).not.toContain("the-owner");
    // It was published on the owner's account stream and nowhere else, and nothing was written to a business.
    expect([...t.redis.store.streams.keys()].filter((k) => k.startsWith("ae:") || k.startsWith("ev:"))).toEqual([accountStreamKey(A.ownerId)]);
    expect((await h.pg.query<{ n: number }>(`select count(*)::int as n from events`)).rows[0]!.n).toBe(businessEventsBefore);
    expect((await h.pg.query<{ n: number }>(`select count(*)::int as n from account_outbox where published_at is null`)).rows[0]!.n).toBe(0);
  });
});
