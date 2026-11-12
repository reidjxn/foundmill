/**
 * Account events end to end on the real tables (the `account_events` migration applied to PGlite): the writer inserts
 * the event and its queue row in the caller's transaction, the account relay publishes to `ae:{userId}`, a consumer
 * group receives the same typed event; idempotency keys, the two-person rule, the relay's failure handling (attempts,
 * last_error, the retry time), and the independence of the two relays.
 */
import { repos, type Db } from "@foundmill/db";
import { createTestDb, type TestHarness } from "@foundmill/db/testing/pglite";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { AccountEvent } from "../account-event";
import { consume, consumeAccountEvents } from "../consume";
import { ACCOUNT_RELAY_DEAD_LETTER_KEY, ACCOUNT_STREAM_RETENTION_MS, accountStreamKey, businessStreamKey, deadLetterKey } from "../keys";
import { createAccountOutboxRelay, deleteAccountStream } from "../outbox/account-relay";
import { writeAccountEvent, writeAccountEvents } from "../outbox/account-writer";
import { createOutboxRelay } from "../outbox/relay";
import type { TransactionalQueryable } from "../outbox/writer";
import type { RedisArg } from "../redis";
import { EVENT_FIXTURES } from "../testing/fixtures";
import { MemoryRedis } from "../testing/memory-redis";

/** A Redis whose XADD can be made to fail for chosen stream keys (or all of them). */
class FlakyRedis extends MemoryRedis {
  failing: (key: string) => boolean = () => false;
  override async xadd(key: string, ...args: RedisArg[]): Promise<string | null> {
    if (this.failing(key)) throw new Error(`stream ${key.slice(0, 3)} is away`);
    return super.xadd(key, ...args);
  }
}

let h: TestHarness;
let db: TransactionalQueryable;
let businessId: string;
let n = 0;

const person = () => h.createUser(`account-store-${++n}@test.local`);
const rows = async <T>(q: ReturnType<typeof sql>) => ((await h.db.execute(q)) as unknown as { rows: T[] }).rows;
const publish = (userId: string, handle: string, extra: { idempotencyKey?: string; occurredAt?: string } = {}) =>
  h.db.transaction((tx) => writeAccountEvent(tx as unknown as TransactionalQueryable, { userId, type: "profile.published", actor: { kind: "user", id: userId }, payload: { handle }, ...extra }));
const queue = (userId: string) => rows<{ published: boolean; attempts: number; last_error: string | null; waits: boolean }>(sql`
  select published_at is not null as published, attempts, last_error, next_attempt_at is not null and next_attempt_at > now() as waits
    from account_outbox where user_id = ${userId}::uuid order by created_at, id`);
const entries = async (redis: MemoryRedis, key: string) => (await redis.xrange(key, "-", "+")).map(([, fields]) => Object.fromEntries(Array.from({ length: fields.length / 2 }, (_, i) => [fields[2 * i]!, fields[2 * i + 1]!])));

async function waitFor(cond: () => boolean, timeoutMs = 3000): Promise<void> {
  const start = Date.now();
  while (!cond()) {
    if (Date.now() - start > timeoutMs) throw new Error("waitFor: timed out");
    await new Promise((r) => setTimeout(r, 2));
  }
}

beforeAll(async () => {
  h = await createTestDb();
  db = h.db as unknown as TransactionalQueryable;
  const owner = await person();
  businessId = (await rows<{ id: string }>(sql`insert into businesses (name, slug, created_by) values ('Account store', 'account-store', ${owner}::uuid) returning id`))[0]!.id;
});
afterAll(() => h?.close());
// Each test starts with empty queues, so one test's rows never ride another's relay.
beforeEach(async () => {
  await h.db.execute(sql`delete from account_outbox`);
  await h.db.execute(sql`delete from outbox`);
});

describe("account events on the real tables", () => {
  it("a committed event reaches the person's own stream and a consumer as the same typed event, and nothing touches the business tables", async () => {
    const maya = await person();
    const redis = new MemoryRedis();
    const before = await rows<{ events: number; outbox: number }>(sql`select (select count(*)::int from events) as events, (select count(*)::int from outbox) as outbox`);
    const eventId = await publish(maya, "maya-okafor", { occurredAt: "2026-11-12T09:00:00.000Z" });

    expect(await rows(sql`select id, user_id, type, actor, payload, idempotency_key from account_events where user_id = ${maya}::uuid`)).toEqual([
      { id: eventId, user_id: maya, type: "profile.published", actor: { kind: "user", id: maya }, payload: { handle: "maya-okafor" }, idempotency_key: null },
    ]);
    expect(await queue(maya)).toEqual([{ published: false, attempts: 0, last_error: null, waits: false }]);
    expect(await rows(sql`select (select count(*)::int from events) as events, (select count(*)::int from outbox) as outbox`)).toEqual(before);

    const relay = createAccountOutboxRelay(db, redis);
    const published: AccountEvent[] = [];
    const seen = createAccountOutboxRelay(db, redis, { onPublished: (events) => void published.push(...events) });
    expect(await seen.tick()).toBe(1);
    expect(await relay.tick()).toBe(0);
    expect(await queue(maya)).toEqual([{ published: true, attempts: 0, last_error: null, waits: false }]);
    expect(published.map((e) => [e.id, e.userId, e.type])).toEqual([[eventId, maya, "profile.published"]]);

    const onStream = await entries(redis, accountStreamKey(maya));
    expect(onStream.map((e) => [e.id, e.type])).toEqual([[eventId, "profile.published"]]);
    expect(JSON.parse(onStream[0]!.json!)).toEqual({ id: eventId, userId: maya, type: "profile.published", occurredAt: "2026-11-12T09:00:00.000Z", actor: { kind: "user", id: maya }, payload: { handle: "maya-okafor" } });
    // On the person's stream and no other: not a business stream, not the content-free signal stream.
    expect([...redis.store.streams.keys()]).toEqual([accountStreamKey(maya)]);
    expect(await redis.ttl(accountStreamKey(maya))).toBe(ACCOUNT_STREAM_RETENTION_MS / 1000);

    const received: AccountEvent[] = [];
    const consumer = consumeAccountEvents(redis, { userId: maya, group: "network", consumer: "test-1", blockMs: 10, handler: (event) => void received.push(event) });
    await waitFor(() => received.length === 1);
    await consumer.stop();
    expect(received[0]).toEqual({ id: eventId, userId: maya, type: "profile.published", occurredAt: new Date("2026-11-12T09:00:00.000Z"), actor: { kind: "user", id: maya }, payload: { handle: "maya-okafor" } });
    expect(await redis.xpending(accountStreamKey(maya), "network")).toEqual([0, null, null, null]);
  });

  it("the event is committed if and only if the change it describes is", async () => {
    const ana = await person();
    await expect(
      h.db.transaction(async (tx) => {
        await writeAccountEvent(tx as unknown as TransactionalQueryable, { userId: ana, type: "profile.published", actor: { kind: "user", id: ana }, payload: { handle: "ana-ruiz" } });
        throw new Error("the change failed");
      }),
    ).rejects.toThrow("the change failed");
    expect(await rows(sql`select id from account_events where user_id = ${ana}::uuid`)).toEqual([]);
    expect(await queue(ana)).toEqual([]);
  });

  it("an idempotency key writes once per person and never fails the caller's transaction", async () => {
    const sam = await person();
    const kit = await person();
    const first = await publish(sam, "sam-lee", { idempotencyKey: "publish:1" });
    // The repeat sits in a transaction that goes on to do more work: it must not be poisoned by a unique violation.
    const again = await h.db.transaction(async (tx) => {
      const id = await writeAccountEvent(tx as unknown as TransactionalQueryable, { userId: sam, type: "profile.published", actor: { kind: "user", id: sam }, payload: { handle: "sam-lee-renamed" }, idempotencyKey: "publish:1" });
      await writeAccountEvent(tx as unknown as TransactionalQueryable, { userId: sam, type: "profile.unpublished", actor: { kind: "user", id: sam }, payload: { handle: "sam-lee" } });
      return id;
    });
    expect(again).toBe(first);
    expect(await rows(sql`select type, payload->>'handle' as handle from account_events where user_id = ${sam}::uuid order by type`)).toEqual([
      { type: "profile.published", handle: "sam-lee" },
      { type: "profile.unpublished", handle: "sam-lee" },
    ]);
    expect(await queue(sam)).toHaveLength(2);
    // Another person's use of the same key is their own event.
    const other = await publish(kit, "kit-kit", { idempotencyKey: "publish:1" });
    expect(other).not.toBe(first);
    expect(await queue(kit)).toHaveLength(1);
    expect((await repos.accountEvents.byIdempotencyKey(h.db as unknown as Db, sam, "publish:1"))?.id).toBe(first);
  });

  it("one fact about two people is one row each, on each person's own stream, and neither names the other by their account", async () => {
    const ada = await person();
    const bo = await person();
    const redis = new MemoryRedis();
    const [forAda, forBo] = await h.db.transaction((tx) =>
      writeAccountEvents(tx as unknown as TransactionalQueryable, [
        { userId: ada, type: "profile.published", actor: { kind: "system", id: "platform" }, payload: { handle: "bo-ode" } },
        { userId: bo, type: "profile.published", actor: { kind: "system", id: "platform" }, payload: { handle: "ada-lovelace" } },
      ]),
    );
    expect(await createAccountOutboxRelay(db, redis).tick()).toBe(2);
    const adaStream = await entries(redis, accountStreamKey(ada));
    const boStream = await entries(redis, accountStreamKey(bo));
    expect(adaStream.map((e) => e.id)).toEqual([forAda]);
    expect(boStream.map((e) => e.id)).toEqual([forBo]);
    expect(JSON.stringify(adaStream)).not.toContain(bo);
    expect(JSON.stringify(boStream)).not.toContain(ada);
    expect(JSON.stringify(await rows(sql`select actor, payload from account_events where user_id = ${ada}::uuid`))).not.toContain(bo);
    // The writer refuses the fact whole when a row would carry the other person's account id: nothing is written.
    const cy = await person();
    const dee = await person();
    await expect(
      h.db.transaction((tx) =>
        writeAccountEvents(tx as unknown as TransactionalQueryable, [
          { userId: cy, type: "profile.published", actor: { kind: "system", id: "platform" }, payload: { handle: "dee-dee" } },
          { userId: dee, type: "profile.published", actor: { kind: "system", id: "platform" }, payload: { handle: cy } },
        ]),
      ),
    ).rejects.toThrow(/handle carries an account id/);
    expect(await rows(sql`select id from account_events where user_id in (${cy}::uuid, ${dee}::uuid)`)).toEqual([]);
  });

  it("deleting the account removes its events and queue rows; the stream copy goes with deleteAccountStream", async () => {
    const gus = await person();
    const hal = await person();
    const redis = new MemoryRedis();
    await publish(gus, "gus-gus");
    await publish(hal, "hal-hal");
    await createAccountOutboxRelay(db, redis).tick();
    await publish(gus, "gus-gus-again");
    await h.db.execute(sql`delete from auth.users where id = ${gus}::uuid`);
    expect(await rows(sql`select (select count(*)::int from account_events where user_id = ${gus}::uuid) as events, (select count(*)::int from account_outbox where user_id = ${gus}::uuid) as queued`)).toEqual([{ events: 0, queued: 0 }]);
    expect(await rows(sql`select count(*)::int as n from account_events where user_id = ${hal}::uuid`)).toEqual([{ n: 1 }]);
    // The relay finds nothing of the deleted account to publish.
    expect(await createAccountOutboxRelay(db, redis).tick()).toBe(0);
    expect(await deleteAccountStream(redis, gus)).toBe(true);
    expect(await deleteAccountStream(redis, gus)).toBe(false);
    expect([...redis.store.streams.keys()]).toEqual([accountStreamKey(hal)]);
  });
});

describe("account relay: failure handling", () => {
  it("a stream that cannot be written holds up only its own person: attempts, last_error and a later retry are recorded", async () => {
    const stuck = await person();
    const fine = await person();
    const redis = new FlakyRedis();
    redis.failing = (key) => key === accountStreamKey(stuck);
    const errors: unknown[] = [];
    const relay = createAccountOutboxRelay(db, redis, { onError: (err) => void errors.push(err) });
    await publish(stuck, "stuck-stuck", { occurredAt: "2026-11-12T09:00:00.000Z" });
    await publish(fine, "fine-fine", { occurredAt: "2026-11-12T09:00:01.000Z" });

    expect(await relay.tick()).toBe(1);
    expect(await queue(fine)).toEqual([{ published: true, attempts: 0, last_error: null, waits: false }]);
    expect(await queue(stuck)).toEqual([{ published: false, attempts: 1, last_error: "Error: stream ae: is away", waits: true }]);
    expect(errors).toHaveLength(1);
    expect((await entries(redis, accountStreamKey(fine))).length).toBe(1);

    // Its retry time has not come: the next ticks leave it alone (and cost one statement that locks nothing).
    expect(await relay.tick()).toBe(0);
    expect((await queue(stuck))[0]!.attempts).toBe(1);
    // A newer event of someone else is not behind it.
    const late = await person();
    await publish(late, "late-late");
    expect(await relay.tick()).toBe(1);

    // When its time comes it is tried again; a second failure pushes the retry further out.
    await h.db.execute(sql`update account_outbox set next_attempt_at = now() - interval '1 second' where user_id = ${stuck}::uuid`);
    await expect(relay.tick()).rejects.toThrow(/is away/);
    expect(await queue(stuck)).toEqual([{ published: false, attempts: 2, last_error: "Error: stream ae: is away", waits: true }]);
    const [gap] = await rows<{ seconds: number }>(sql`select round(extract(epoch from (next_attempt_at - updated_at)))::int as seconds from account_outbox where user_id = ${stuck}::uuid`);
    expect(gap!.seconds).toBe(4);

    // The stream comes back: the row is published and its error cleared; the count of attempts stays as a record.
    redis.failing = () => false;
    await h.db.execute(sql`update account_outbox set next_attempt_at = now() - interval '1 second' where user_id = ${stuck}::uuid`);
    expect(await relay.tick()).toBe(1);
    expect(await queue(stuck)).toEqual([{ published: true, attempts: 2, last_error: null, waits: false }]);
    expect((await entries(redis, accountStreamKey(stuck))).map((e) => e.type)).toEqual(["profile.published"]);
    expect((await repos.accountEvents.outboxFailing(h.db as unknown as Db)).filter((r) => r.userId === stuck)).toEqual([]);
  });

  it("the retry time grows from 2 seconds to a ceiling of 5 minutes", async () => {
    const stuck = await person();
    const redis = new FlakyRedis();
    redis.failing = () => true;
    const relay = createAccountOutboxRelay(db, redis, { onError: () => {} });
    await publish(stuck, "stuck-again");
    const gaps: number[] = [];
    for (const attempts of [0, 1, 2, 7, 8, 40]) {
      await h.db.execute(sql`update account_outbox set attempts = ${attempts}, next_attempt_at = null where user_id = ${stuck}::uuid`);
      await expect(relay.tick()).rejects.toThrow(/is away/);
      gaps.push((await rows<{ seconds: number }>(sql`select round(extract(epoch from (next_attempt_at - updated_at)))::int as seconds from account_outbox where user_id = ${stuck}::uuid`))[0]!.seconds);
    }
    expect(gaps).toEqual([2, 4, 8, 256, 300, 300]);
  });

  it("a row that can never be a valid account event is closed with its reason, noted without its payload, and does not stall the rest", async () => {
    const maya = await person();
    const redis = new MemoryRedis();
    const errors: unknown[] = [];
    // Written past the writer (the owner connection): a business-scoped type, and a payload the catalog refuses.
    const insert = (type: string, payload: object, at: string) =>
      rows<{ id: string }>(sql`with e as (insert into account_events (user_id, type, occurred_at, actor, payload) values (${maya}::uuid, ${type}, ${at}::timestamptz, ${JSON.stringify({ kind: "user", id: maya })}::jsonb, ${JSON.stringify(payload)}::jsonb) returning id, user_id)
        insert into account_outbox (user_id, event_id) select user_id, id from e returning event_id as id`);
    const [wrongScope] = await insert("payment.received", { note: "PRIVATE-PAYLOAD-TEXT" }, "2026-11-12T09:00:00.000Z");
    const [badPayload] = await insert("profile.published", { handle: "Not A Handle", note: "PRIVATE-PAYLOAD-TEXT" }, "2026-11-12T09:00:01.000Z");
    const good = await publish(maya, "maya-okafor", { occurredAt: "2026-11-12T09:00:02.000Z" });

    expect(await createAccountOutboxRelay(db, redis, { onError: (err) => void errors.push(err) }).tick()).toBe(3);
    expect((await entries(redis, accountStreamKey(maya))).map((e) => e.id)).toEqual([good]);
    const state = await rows<{ event_id: string; published: boolean; attempts: number; last_error: string | null }>(sql`select event_id, published_at is not null as published, attempts, last_error from account_outbox where user_id = ${maya}::uuid`);
    const of = (id: string) => state.find((s) => s.event_id === id)!;
    expect(of(good)).toMatchObject({ published: true, attempts: 0, last_error: null });
    expect(of(wrongScope!.id)).toMatchObject({ published: true, attempts: 1 });
    expect(of(wrongScope!.id).last_error).toMatch(/payment.received is business-scoped and is never an account event/);
    expect(of(badPayload!.id).last_error).toMatch(/Invalid payload for profile.published/);
    const dead = await entries(redis, ACCOUNT_RELAY_DEAD_LETTER_KEY);
    expect(dead.map((d) => [d.id, d.type]).sort()).toEqual([[wrongScope!.id, "payment.received"], [badPayload!.id, "profile.published"]].sort());
    for (const d of dead) expect(Object.keys(d).sort()).toEqual(["error", "id", "type"]);
    // Nothing the person wrote left the database on the way: not on the dead-letter stream, not in the errors, not on the row.
    expect(JSON.stringify([dead, errors.map((e) => (e as Error).message), state])).not.toContain("PRIVATE-PAYLOAD-TEXT");
    expect(errors).toHaveLength(2);
    // A business-scoped type never reached a stream.
    expect([...redis.store.streams.keys()].sort()).toEqual([accountStreamKey(maya), ACCOUNT_RELAY_DEAD_LETTER_KEY].sort());
  });

  it("the two relays do not hold each other up: a stuck account outbox, then a stuck business outbox", async () => {
    const maya = await person();
    const redis = new FlakyRedis();
    const accountRelay = createAccountOutboxRelay(db, redis, { onError: () => {} });
    const businessRelay = createOutboxRelay(db, redis, { onError: () => {} });
    const businessEvent = () => repos.events.write(h.db as unknown as Db, businessId, { type: "task.started", actor: { kind: "system", id: "test" }, payload: EVENT_FIXTURES["task.started"] as Record<string, unknown> });

    // Account streams are away: the business relay publishes as usual.
    redis.failing = (key) => key.startsWith("ae:");
    await publish(maya, "maya-okafor");
    const first = await businessEvent();
    await expect(accountRelay.tick()).rejects.toThrow(/is away/);
    expect(await businessRelay.tick()).toBe(1);
    expect((await entries(redis, businessStreamKey(businessId))).map((e) => e.id)).toEqual([first.id]);
    expect(await queue(maya)).toMatchObject([{ published: false, attempts: 1 }]);
    expect(await repos.events.outboxCountPending(h.db as unknown as Db, businessId)).toBe(0);

    // The reverse: business streams are away, the account relay publishes as usual.
    redis.failing = (key) => key.startsWith("ev:");
    await businessEvent();
    await h.db.execute(sql`update account_outbox set next_attempt_at = null where user_id = ${maya}::uuid`);
    await expect(businessRelay.tick()).rejects.toThrow(/is away/);
    expect(await accountRelay.tick()).toBe(1);
    expect(await queue(maya)).toMatchObject([{ published: true, last_error: null }]);
    expect(await repos.events.outboxCountPending(h.db as unknown as Db, businessId)).toBe(1);
    // Neither relay reads the other's queue or writes the other's stream.
    expect((await entries(redis, accountStreamKey(maya))).map((e) => e.type)).toEqual(["profile.published"]);
    expect((await entries(redis, businessStreamKey(businessId))).map((e) => e.type)).toEqual(["task.started"]);
  });

  it("start, wake and stop drive the same loop as the business relay", async () => {
    const maya = await person();
    const redis = new MemoryRedis();
    const relay = createAccountOutboxRelay(db, redis, { intervalMs: 60_000 });
    relay.start();
    expect(relay.running).toBe(true);
    await new Promise((r) => setTimeout(r, 20));
    await publish(maya, "maya-okafor");
    relay.wake();
    const stream = accountStreamKey(maya);
    const start = Date.now();
    while ((await redis.xlen(stream)) === 0) {
      if (Date.now() - start > 3000) throw new Error("the woken relay did not publish");
      await new Promise((r) => setTimeout(r, 5));
    }
    await relay.stop();
    expect(relay.running).toBe(false);
  });
});

describe("account consumers", () => {
  it("consume every person's stream, only the types asked for, and acknowledge the rest", async () => {
    const maya = await person();
    const bo = await person();
    const redis = new MemoryRedis();
    await publish(maya, "maya-okafor", { occurredAt: "2026-11-12T09:00:00.000Z" });
    await h.db.transaction((tx) => writeAccountEvent(tx as unknown as TransactionalQueryable, { userId: maya, type: "profile.unpublished", actor: { kind: "user", id: maya }, payload: { handle: "maya-okafor" }, occurredAt: "2026-11-12T09:00:01.000Z" }));
    await publish(bo, "bo-ode", { occurredAt: "2026-11-12T09:00:02.000Z" });
    await createAccountOutboxRelay(db, redis).tick();

    const received: AccountEvent<"profile.published">[] = [];
    const consumer = consumeAccountEvents(redis, { userId: "*", group: "network", consumer: "test-1", types: ["profile.published"], blockMs: 10, handler: (event) => void received.push(event) });
    await waitFor(() => received.length === 2);
    await consumer.stop();
    expect(received.map((e) => [e.userId, e.type, e.payload.handle]).sort()).toEqual([[bo, "profile.published", "bo-ode"], [maya, "profile.published", "maya-okafor"]].sort());
    expect(consumer.streams().sort()).toEqual([accountStreamKey(bo), accountStreamKey(maya)].sort());
    for (const key of [accountStreamKey(maya), accountStreamKey(bo)]) expect((await redis.xpending(key, "network"))[0]).toBe(0);
    expect(await redis.xlen(deadLetterKey("network"))).toBe(0);
  });

  it("an entry that is not the stream's own person's account event is poison, and its dead letter carries no payload", async () => {
    const maya = await person();
    const bo = await person();
    const redis = new MemoryRedis();
    const eventId = await publish(bo, "bo-ode");
    await createAccountOutboxRelay(db, redis).tick();
    const [bosEntry] = await entries(redis, accountStreamKey(bo));
    // Bo's event planted on Maya's stream, a business event planted there, and something that is not JSON.
    await redis.xadd(accountStreamKey(maya), "*", "id", eventId, "type", "profile.published", "json", bosEntry!.json!);
    await redis.xadd(accountStreamKey(maya), "*", "id", "x", "type", "task.started", "json", JSON.stringify({ id: eventId, businessId, type: "task.started", occurredAt: "2026-11-12T09:00:00.000Z", actor: { kind: "system", id: "test" }, entityIds: [], payload: { note: "PRIVATE-PAYLOAD-TEXT" } }));
    await redis.xadd(accountStreamKey(maya), "*", "id", "y", "type", "profile.published", "json", "{not json PRIVATE-PAYLOAD-TEXT");

    const handled: AccountEvent[] = [];
    const errors: unknown[] = [];
    const consumer = consumeAccountEvents(redis, { userId: maya, group: "network", consumer: "test-1", blockMs: 10, onError: (err) => void errors.push(err), handler: (event) => void handled.push(event) });
    await waitFor(() => errors.length === 3);
    await consumer.stop();
    expect(handled).toEqual([]);
    const dead = await entries(redis, deadLetterKey("network"));
    expect(dead).toHaveLength(3);
    const reasons = dead.map((d) => d.error ?? "");
    for (const reason of [/carries an account event of another account/, /has invalid JSON/, /Invalid account event envelope/]) expect(reasons.some((r) => reason.test(r)), String(reason)).toBe(true);
    for (const d of dead) expect(Object.keys(d)).not.toContain("json");
    expect(JSON.stringify([dead, errors.map((e) => (e as Error).message)])).not.toContain("PRIVATE-PAYLOAD-TEXT");
    expect(JSON.stringify(dead)).not.toContain("bo-ode");
    // The business consumer keeps its own behavior: its dead letters carry the entry as before.
    await redis.xadd(businessStreamKey(businessId), "*", "id", "z", "type", "task.started", "json", "{not json");
    const business = consume(redis, { businessId, group: "composer", consumer: "test-1", blockMs: 10, onError: () => {}, handler: () => {} });
    await waitFor(() => redis.store.streams.has(deadLetterKey("composer")));
    await business.stop();
    expect((await entries(redis, deadLetterKey("composer")))[0]).toMatchObject({ id: "z", json: "{not json" });
  });
});
