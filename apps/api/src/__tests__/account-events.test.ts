/**
 * The first two account events, end to end through the api (docs/ARCHITECTURE.md §5 "Account events"; migration
 * `account_events`): `founder.publicProfile.publish` and `unpublish` write `profile.published` and
 * `profile.unpublished` to the person's own account events in the same transaction as the change; nothing goes to a
 * business's `events` or `outbox`; another account cannot read them; the api's relay supervisor runs the account relay
 * beside the business one, and neither holds the other up.
 */
import { repos } from "@foundmill/db";
import { accountStreamKey, businessStreamKey, MemoryRedis, type OutboxRelay } from "@foundmill/events";
import { EVENT_FIXTURES } from "@foundmill/events/testing/fixtures";
import { PERSON_HANDLE_RESERVED, type PersonProfileContent } from "@foundmill/shared";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { handleLooksLikeAnId } from "../services/person-profile";
import { superviseOutboxRelay } from "../services/relay";
import { writeEventRow } from "../services/events";
import { createApiHarness, type ApiHarness } from "./harness";

let hz: ApiHarness;
beforeAll(async () => {
  hz = await createApiHarness({ prefix: "account-events" });
}, 120_000);
afterAll(() => hz?.close());
beforeEach(() => hz.limits.reset());

const content = (over: Partial<PersonProfileContent> = {}): PersonProfileContent => ({ headline: "Baker who wants to sell online", about: "I bake sourdough at home.", strengths: ["Baking"], wantsToLearn: ["Pricing"], lookingFor: "on_my_own", place: "Leeds", ...over });

let n = 0;
async function person(displayName: string) {
  n += 1;
  const userId = await hz.h.createUser(`account-events-${n}@test.local`);
  await repos.founders.upsert(hz.db, userId, { displayName, experience: "PRIVATE-experience", residence: "PRIVATE-residence" });
  return { userId, me: hz.caller({ userId }) };
}

const rows = async <T>(q: ReturnType<typeof sql>) => ((await hz.db.execute(q)) as unknown as { rows: T[] }).rows;
const accountEvents = (userId: string) => rows<{ id: string; type: string; actor: unknown; payload: unknown; occurred_at: Date | string; idempotency_key: string | null }>(sql`select id, type, actor, payload, occurred_at, idempotency_key from account_events where user_id = ${userId}::uuid order by created_at, id`);
const queued = (userId: string) => rows<{ event_id: string; published: boolean }>(sql`select event_id, published_at is not null as published from account_outbox where user_id = ${userId}::uuid order by created_at, id`);
const businessTables = async () => (await rows<{ events: number; outbox: number }>(sql`select (select count(*)::int from events) as events, (select count(*)::int from outbox) as outbox`))[0]!;
/** The columns a person may read of their own events (the grant of the migration). */
const readable = sql`select id, user_id, type, occurred_at, payload, created_at from account_events`;

describe("profile.published and profile.unpublished", () => {
  it("publishing writes one account event with the handle and nothing private, in the person's own store and no business's", async () => {
    const p = await person("Maya Okafor");
    const before = await businessTables();
    expect(await accountEvents(p.userId)).toEqual([]);
    const published = await p.me.founder.publicProfile.publish({ handle: "maya-okafor", content: content() });
    expect(published.outcome).toBe("published");

    const events = await accountEvents(p.userId);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ type: "profile.published", actor: { kind: "user", id: p.userId }, payload: { handle: "maya-okafor" }, idempotency_key: null });
    // The handle and nothing else: none of the profile's words, none of the account's private fields.
    expect(Object.keys(events[0]!.payload as object)).toEqual(["handle"]);
    expect(JSON.stringify(events[0]!.payload)).not.toMatch(/PRIVATE|Baker|sourdough|Leeds|test\.local/);
    // The same moment as the row's `published_at`.
    expect(new Date(events[0]!.occurred_at).toISOString()).toBe(published.profile.publishedAt!.toISOString());
    // Its queue row waits for the account relay.
    expect(await queued(p.userId)).toEqual([{ event_id: events[0]!.id, published: false }]);

    // Nothing was written to a business: not the tables, not a row of these types.
    expect(await businessTables()).toEqual(before);
    expect(await rows(sql`select id from events where type in ('profile.published', 'profile.unpublished')`)).toEqual([]);
    expect(await rows(sql`select id from audit_log where action like 'profile.%' or action like '%publicProfile%'`)).toEqual([]);
  });

  it("writes once per change of state: a save, a second publish and a second take-down write nothing; publishing again does", async () => {
    const p = await person("Sam Lee");
    await p.me.founder.publicProfile.update({ handle: "sam-lee", content: content() });
    expect(await accountEvents(p.userId)).toEqual([]);
    await p.me.founder.publicProfile.publish({ content: content() });
    await p.me.founder.publicProfile.update({ content: content({ headline: "Baker in Leeds" }) });
    await p.me.founder.publicProfile.publish({ content: content({ headline: "Baker in Leeds, selling online" }) });
    expect((await accountEvents(p.userId)).map((e) => e.type)).toEqual(["profile.published"]);

    const down = await p.me.founder.publicProfile.unpublish();
    expect(down.public).toBe(false);
    await p.me.founder.publicProfile.unpublish();
    expect((await accountEvents(p.userId)).map((e) => [e.type, e.payload])).toEqual([
      ["profile.published", { handle: "sam-lee" }],
      ["profile.unpublished", { handle: "sam-lee" }],
    ]);

    await p.me.founder.publicProfile.publish({ content: content() });
    expect((await accountEvents(p.userId)).map((e) => e.type)).toEqual(["profile.published", "profile.unpublished", "profile.published"]);
    expect(await queued(p.userId)).toHaveLength(3);
    // Two take-downs at once write one event between them.
    await Promise.all([p.me.founder.publicProfile.unpublish(), p.me.founder.publicProfile.unpublish()]);
    expect((await accountEvents(p.userId)).filter((e) => e.type === "profile.unpublished")).toHaveLength(2);
  });

  it("a held publish and a private take-down write nothing", async () => {
    const p = await person("Ana Ruiz");
    const held = await p.me.founder.publicProfile.publish({ handle: "ana-ruiz", content: content({ about: "Write to me at ana@example.com" }) });
    expect(held.outcome).toBe("held");
    await p.me.founder.publicProfile.unpublish();
    expect(await accountEvents(p.userId)).toEqual([]);
    expect(await queued(p.userId)).toEqual([]);
  });

  it("another account cannot read them: not a stranger, not a cofounder in the person's own project", async () => {
    // The owner of business A publishes; the admin, member and viewer of A are in the same project.
    const owner = hz.caller({ userId: hz.A.ownerId });
    await repos.founders.upsert(hz.db, hz.A.ownerId, { displayName: "Olu Owner" });
    await owner.founder.publicProfile.publish({ handle: "olu-owner", content: content() });
    const stranger = await person("Stray Reader");

    const mine = await hz.h.asUser(hz.A.ownerId).execute<{ user_id: string; type: string; payload: unknown }>(readable);
    expect(mine.map((r) => [r.user_id, r.type, r.payload])).toEqual([[hz.A.ownerId, "profile.published", { handle: "olu-owner" }]]);
    expect((await hz.h.asUser(hz.A.ownerId).run((tx) => repos.accountEvents.list(tx, hz.A.ownerId))).items.map((e) => e.type)).toEqual(["profile.published"]);

    for (const other of [hz.A.adminId, hz.A.memberId, hz.A.viewerId, hz.B.ownerId, stranger.userId]) {
      expect(await hz.h.asUser(other).execute(readable), other).toEqual([]);
      expect(await hz.h.asUser(other).execute(sql`select id from account_events where user_id = ${hz.A.ownerId}::uuid`), other).toEqual([]);
      expect((await hz.h.asUser(other).run((tx) => repos.accountEvents.list(tx, hz.A.ownerId))).items, other).toEqual([]);
      await expect(hz.h.asUser(other).execute(sql`select * from account_events`), other).rejects.toThrow(/permission denied/);
      await expect(hz.h.asUser(other).execute(sql`select id from account_outbox`), other).rejects.toThrow(/permission denied/);
    }
    await expect(hz.h.anon().execute(readable)).rejects.toThrow(/permission denied/);
    // The project's own event log, which its members do read, says nothing about it.
    for (const member of [hz.A.ownerId, hz.A.adminId]) {
      expect(await hz.h.asUser(member).execute(sql`select id from events where business_id = ${hz.A.businessId}::uuid and (type like 'profile.%' or payload::text like '%olu-owner%')`), member).toEqual([]);
    }
  });

  it("the business writer refuses these types, so they cannot be written to a project by mistake", async () => {
    const before = await businessTables();
    await expect(
      writeEventRow(hz.db, { businessId: hz.A.businessId, type: "profile.published", actor: { kind: "user", id: hz.A.ownerId }, payload: { handle: "olu-owner" } } as never),
    ).rejects.toThrow(/profile.published is account-scoped and is never written to a business's events/);
    await expect(repos.events.write(hz.db, hz.A.businessId, { type: "profile.unpublished", actor: { kind: "user", id: hz.A.ownerId }, payload: { handle: "olu-owner" } })).rejects.toThrow(/account-scoped/);
    expect(await businessTables()).toEqual(before);
  });

  it("an address shaped like an id is refused, cannot go public, and never blocks a take-down", async () => {
    const p = await person("Idris Shape");
    const idShaped = "0a1b2c3d-0a1b-4a1b-8a1b-0a1b2c3d4e5f";
    expect(handleLooksLikeAnId(idShaped)).toBe(true);
    expect(handleLooksLikeAnId("idris-shape")).toBe(false);
    await expect(p.me.founder.publicProfile.update({ handle: idShaped, content: content() })).rejects.toThrow(PERSON_HANDLE_RESERVED);
    await expect(p.me.founder.publicProfile.update({ handle: p.userId, content: content() })).rejects.toThrow(PERSON_HANDLE_RESERVED);
    await expect(p.me.founder.publicProfile.publish({ handle: idShaped, content: content() })).rejects.toThrow(PERSON_HANDLE_RESERVED);

    // An address stored before the rule (written past the api): it cannot be published, and nothing is saved or written.
    await hz.db.execute(sql`update founder_profiles set handle = ${idShaped} where user_id = ${p.userId}::uuid`);
    await expect(p.me.founder.publicProfile.publish({ content: content({ headline: "Changed" }) })).rejects.toThrow(PERSON_HANDLE_RESERVED);
    expect(await rows(sql`select public, headline from founder_profiles where user_id = ${p.userId}::uuid`)).toEqual([{ public: false, headline: "" }]);
    expect(await accountEvents(p.userId)).toEqual([]);

    // One that was already public with such an address is still taken down, without an event.
    await hz.db.execute(sql`update founder_profiles set public = true, published_at = now() where user_id = ${p.userId}::uuid`);
    expect((await p.me.founder.publicProfile.unpublish()).public).toBe(false);
    expect(await rows(sql`select public from founder_profiles where user_id = ${p.userId}::uuid`)).toEqual([{ public: false }]);
    expect(await accountEvents(p.userId)).toEqual([]);
  });

  it("the events go with the account", async () => {
    const p = await person("Gone Soon");
    await p.me.founder.publicProfile.publish({ handle: "gone-soon", content: content() });
    await p.me.founder.publicProfile.unpublish();
    expect(await accountEvents(p.userId)).toHaveLength(2);
    await hz.db.execute(sql`delete from auth.users where id = ${p.userId}::uuid`);
    expect(await accountEvents(p.userId)).toEqual([]);
    expect(await queued(p.userId)).toEqual([]);
  });
});

describe("the relay supervisor runs the account relay beside the business one", () => {
  const log = () => ({ warn: vi.fn(), info: vi.fn() });
  const until = async (cond: () => Promise<boolean>, what: string) => {
    const start = Date.now();
    while (!(await cond())) {
      if (Date.now() - start > 5_000) throw new Error(`timed out: ${what}`);
      await new Promise((r) => setTimeout(r, 10));
    }
  };

  it("publishes a profile event to the person's own stream and a business event to the business's, each through its own relay", async () => {
    const redis = new MemoryRedis();
    const supervisor = superviseOutboxRelay({ db: hz.db, redis: redis as never, log: log() as never, env: hz.deps.env }, { reachable: async () => true });
    try {
      await until(async () => supervisor.status().state === "running", "relays started");
      const p = await person("Relay Reader");
      await p.me.founder.publicProfile.publish({ handle: "relay-reader", content: content() });
      const businessEventId = await hz.db.transaction((tx) => writeEventRow(tx, { businessId: hz.A.businessId, type: "task.started", actor: { kind: "system", id: "test" }, payload: EVENT_FIXTURES["task.started"] }));
      supervisor.wake();
      await until(async () => (await redis.xlen(accountStreamKey(p.userId))) === 1, "account event relayed");
      await until(async () => JSON.stringify(await redis.xrange(businessStreamKey(hz.A.businessId), "-", "+")).includes(businessEventId), "business event relayed");
      const fields = (await redis.xrange(accountStreamKey(p.userId), "-", "+"))[0]![1];
      const entry = Object.fromEntries(Array.from({ length: fields.length / 2 }, (_, i) => [fields[2 * i]!, fields[2 * i + 1]!]));
      expect(entry.type).toBe("profile.published");
      expect(JSON.parse(entry.json!)).toMatchObject({ userId: p.userId, type: "profile.published", payload: { handle: "relay-reader" } });
      expect(JSON.parse(entry.json!)).not.toHaveProperty("businessId");
      await until(async () => (await queued(p.userId)).every((q) => q.published), "queue row marked");
      // The person's event is on no business stream; whatever the business relay published or parked is not on theirs.
      for (const key of redis.store.streams.keys()) {
        const text = JSON.stringify(await redis.xrange(key, "-", "+"));
        if (key !== accountStreamKey(p.userId)) expect(text, key).not.toContain("relay-reader");
      }
      expect(JSON.stringify(await redis.xrange(businessStreamKey(hz.A.businessId), "-", "+"))).not.toContain(p.userId);
    } finally {
      await supervisor.stop();
    }
    expect(supervisor.status().state).toBe("stopped");
  });

  it("starts both once Redis answers, wakes both, stops both, and a failure to start the account relay leaves the business relay running", async () => {
    const fake = () => ({ wake: vi.fn(), stop: vi.fn(async () => undefined) }) as unknown as OutboxRelay & { wake: ReturnType<typeof vi.fn>; stop: ReturnType<typeof vi.fn> };
    const business = fake();
    const account = fake();
    const supervisor = superviseOutboxRelay({ db: {} as never, redis: null, log: log() as never, env: hz.deps.env }, { reachable: async () => true, start: () => business, startAccount: () => account });
    await until(async () => supervisor.status().state === "running", "started");
    supervisor.wake();
    expect(business.wake).toHaveBeenCalledTimes(1);
    expect(account.wake).toHaveBeenCalledTimes(1);
    await supervisor.stop();
    expect(business.stop).toHaveBeenCalledTimes(1);
    expect(account.stop).toHaveBeenCalledTimes(1);

    const alone = fake();
    const quiet = log();
    const second = superviseOutboxRelay(
      { db: {} as never, redis: null, log: quiet as never, env: hz.deps.env },
      {
        reachable: async () => true,
        start: () => alone,
        startAccount: () => {
          throw new Error("account relay could not be built");
        },
      },
    );
    await until(async () => second.status().state === "running", "business relay started without the account relay");
    second.wake();
    expect(alone.wake).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(quiet.warn.mock.calls)).toContain("account outbox relay did not start");
    await second.stop();
    expect(alone.stop).toHaveBeenCalledTimes(1);
  });
});
