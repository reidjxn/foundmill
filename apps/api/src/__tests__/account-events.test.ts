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
import { handleLooksLikeAnId, suggestedHandle, unpublishPublicProfile } from "../services/person-profile";
import { ACCOUNT_RELAY_ENABLED, RELAY_STOP_TIMEOUT_MS, combineRelays, superviseOutboxRelay } from "../services/relay";
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
  // A public profile is public once its person confirmed 18 or older (0104).
  await repos.adults.confirm(hz.db, userId);
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
    await repos.adults.confirm(hz.db, hz.A.ownerId);
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
    // And past every writer: a member's own insert straight into the table is refused by the database.
    await expect(
      hz.h.asUser(hz.A.memberId).execute(sql`insert into events (business_id, type, actor, payload) values (${hz.A.businessId}::uuid, 'profile.published', ${JSON.stringify({ kind: "user", id: hz.A.ownerId })}::jsonb, '{"handle":"forged"}'::jsonb)`),
    ).rejects.toThrow(/events_not_account_scoped/);
    expect(await businessTables()).toEqual(before);
  });

  it("an address that is, or holds, an id is refused when it is saved and when a profile goes public", async () => {
    const p = await person("Idris Shape");
    const other = await person("Otto Other");
    const id = "0a1b2c3d-0a1b-4a1b-8a1b-0a1b2c3d4e5f";
    const compact = id.replace(/-/g, "");
    const holding = [
      id, // an id
      `x${id}`, // an id behind a letter: 37 characters, inside the address rule (the review's case)
      `${id}-me`,
      compact, // without hyphens: 32 letters and digits, which could be someone's account id
      `me-${compact}`,
      compact.replace(/(.{8})/g, "$1-").slice(0, -1), // hyphens in other places
      other.userId, // another person's account id
      other.userId.replace(/-/g, ""),
      p.userId,
    ];
    for (const handle of holding) {
      expect(handleLooksLikeAnId(handle), handle).toBe(true);
      await expect(p.me.founder.publicProfile.update({ handle, content: content() }), `save ${handle}`).rejects.toThrow(PERSON_HANDLE_RESERVED);
      await expect(p.me.founder.publicProfile.publish({ handle, content: content() }), `publish ${handle}`).rejects.toThrow(PERSON_HANDLE_RESERVED);
    }
    for (const fine of ["idris-shape", "dead-beef-cafe", "a1b2c3d4-e5f6", "maya-0a1b2c3d", "x".repeat(40), "1234567890-1234567890-1234567890"]) expect(handleLooksLikeAnId(fine), fine).toBe(false);
    expect(await rows(sql`select handle, public from founder_profiles where user_id = ${p.userId}::uuid`)).toEqual([{ handle: null, public: false }]);

    // While public too: a change of address to one that holds an id is refused, and the profile keeps the address it had.
    await p.me.founder.publicProfile.publish({ handle: "idris-shape", content: content() });
    await expect(p.me.founder.publicProfile.update({ handle: `x${id}`, content: content() })).rejects.toThrow(PERSON_HANDLE_RESERVED);
    expect(await rows(sql`select handle, public from founder_profiles where user_id = ${p.userId}::uuid`)).toEqual([{ handle: "idris-shape", public: true }]);

    // An address stored before the rule (written past the api) cannot go public: nothing is saved, nothing is written.
    const q = await person("Quinn Legacy");
    await hz.db.execute(sql`update founder_profiles set handle = ${`x${id}`} where user_id = ${q.userId}::uuid`);
    await expect(q.me.founder.publicProfile.publish({ content: content({ headline: "Changed" }) })).rejects.toThrow(PERSON_HANDLE_RESERVED);
    expect(await rows(sql`select public, headline from founder_profiles where user_id = ${q.userId}::uuid`)).toEqual([{ public: false, headline: "" }]);
    expect(await accountEvents(q.userId)).toEqual([]);

    // A display name that is an id never becomes a suggested address that holds one.
    const named = await person(id);
    const suggestion = await suggestedHandle({ db: hz.db, env: hz.deps.env, limits: hz.limits, userId: named.userId }, id);
    expect(handleLooksLikeAnId(suggestion)).toBe(false);
    expect(suggestion).toMatch(/^profile/);
    expect((await named.me.founder.publicProfile.publish({ content: content() })).outcome).toBe("published");
    expect((await accountEvents(named.userId)).map((e) => [e.type, e.payload])).toEqual([["profile.published", { handle: suggestion }]]);
  });

  it("a profile is taken down after its address changed while it was public, with the address it has now", async () => {
    const p = await person("Maya Mover");
    await p.me.founder.publicProfile.publish({ handle: "maya", content: content() });
    // A change of address while public writes no event of its own.
    expect((await p.me.founder.publicProfile.update({ handle: "maya-two", content: content() })).outcome).toBe("saved");
    expect((await accountEvents(p.userId)).map((e) => [e.type, e.payload])).toEqual([["profile.published", { handle: "maya" }]]);
    const down = await p.me.founder.publicProfile.unpublish();
    expect([down.public, down.handle]).toEqual([false, "maya-two"]);
    expect((await accountEvents(p.userId)).map((e) => [e.type, e.payload])).toEqual([
      ["profile.published", { handle: "maya" }],
      ["profile.unpublished", { handle: "maya-two" }],
    ]);
  });

  it("taking a profile down never depends on its event: an address the event cannot carry is taken down without one", async () => {
    const other = await person("Other Account");
    const id = "1b2c3d4e-1b2c-4b2c-8b2c-1b2c3d4e5f6a";
    // What the review reproduced: public as `maya`, then (past the rule now, so written straight to the table) an
    // address that holds an id; and the same with an address that is another person's account id without its hyphens.
    for (const [handle, reason] of [[`x${id}`, "id_shaped"], [id, "id_shaped"], [other.userId.replace(/-/g, ""), "id_shaped"]] as const) {
      const p = await person("Maya Down");
      await p.me.founder.publicProfile.publish({ handle: `maya-down-${n}`, content: content() });
      await hz.db.execute(sql`update founder_profiles set handle = ${handle} where user_id = ${p.userId}::uuid`);
      const warn = vi.fn();
      const down = await unpublishPublicProfile({ db: hz.db, env: hz.deps.env, limits: hz.limits, userId: p.userId, log: { warn } });
      expect(down.public, handle).toBe(false);
      expect(await rows(sql`select public from founder_profiles where user_id = ${p.userId}::uuid`), handle).toEqual([{ public: false }]);
      // No event for the take-down, and nothing left half-written.
      expect((await accountEvents(p.userId)).map((e) => e.type), handle).toEqual(["profile.published"]);
      expect(await queued(p.userId), handle).toHaveLength(1);
      // The warning says who and which rule, and nothing else: not the address.
      expect(warn.mock.calls, handle).toEqual([[{ userId: p.userId, reason }, "profile taken down without its profile.unpublished event"]]);
      expect(JSON.stringify(warn.mock.calls)).not.toContain(handle);
      await hz.db.execute(sql`update founder_profiles set handle = null where user_id = ${p.userId}::uuid`);
    }
    // Through the router as well (the review's path), where the log is the request's own.
    const p = await person("Maya Router");
    await p.me.founder.publicProfile.publish({ handle: "maya-router", content: content() });
    await hz.db.execute(sql`update founder_profiles set handle = ${`y${id}`} where user_id = ${p.userId}::uuid`);
    expect((await p.me.founder.publicProfile.unpublish()).public).toBe(false);
    expect(await rows(sql`select public from founder_profiles where user_id = ${p.userId}::uuid`)).toEqual([{ public: false }]);
  });

  it("a take-down survives its event's insert failing in the database: the savepoint is undone, the profile is private", async () => {
    const p = await person("Sava Point");
    await p.me.founder.publicProfile.publish({ handle: "sava-point", content: content() });
    // Make the database refuse the insert for a reason the writer cannot foresee.
    await hz.db.execute(sql`alter table account_events add constraint test_refuse_unpublished check (type <> 'profile.unpublished') not valid`);
    try {
      const warn = vi.fn();
      const down = await unpublishPublicProfile({ db: hz.db, env: hz.deps.env, limits: hz.limits, userId: p.userId, log: { warn } });
      expect(down.public).toBe(false);
      expect(warn.mock.calls).toEqual([[{ userId: p.userId, reason: "write_failed" }, "profile taken down without its profile.unpublished event"]]);
    } finally {
      await hz.db.execute(sql`alter table account_events drop constraint test_refuse_unpublished`);
    }
    expect(await rows(sql`select public from founder_profiles where user_id = ${p.userId}::uuid`)).toEqual([{ public: false }]);
    expect((await accountEvents(p.userId)).map((e) => e.type)).toEqual(["profile.published"]);
    expect(await queued(p.userId)).toHaveLength(1);
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

describe("the relay supervisor runs the account outbox in the business relay's loop", () => {
  const log = () => ({ warn: vi.fn(), info: vi.fn() });
  const until = async (cond: () => Promise<boolean>, what: string) => {
    const start = Date.now();
    while (!(await cond())) {
      if (Date.now() - start > 5_000) throw new Error(`timed out: ${what}`);
      await new Promise((r) => setTimeout(r, 10));
    }
  };

  it("publishes a profile event to the person's own stream and a business event to the business's, through the one relay", async () => {
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

  it("one loop: the business batch then the account batch in the same tick; an account failure never fails the tick", async () => {
    const order: string[] = [];
    const relayOf = (name: string, tick: () => Promise<number>) => ({ tick: vi.fn(async () => (order.push(name), tick())) }) as unknown as OutboxRelay;
    const accountErrors: unknown[] = [];
    const tickErrors: unknown[] = [];
    // The account batch throws: the tick still answers with the business count.
    const loop = combineRelays(relayOf("business", async () => 3), relayOf("account", async () => Promise.reject(new Error("redis down"))), { onError: (e) => tickErrors.push(e), onAccountError: (e) => accountErrors.push(e), intervalMs: 5 });
    expect(await loop.tick()).toBe(3);
    expect(order).toEqual(["business", "account"]);
    expect(accountErrors).toHaveLength(1);
    expect(tickErrors).toHaveLength(0);
    // Full when either batch is full: the loop runs again at once.
    const full = combineRelays(relayOf("b", async () => 0), relayOf("a", async () => 100), { onError: () => undefined, onAccountError: () => undefined });
    expect(await full.tick()).toBe(100);
    // A business failure fails the tick (the loop backs off), and the account batch is not run that tick.
    order.length = 0;
    const down = combineRelays(relayOf("business", async () => Promise.reject(new Error("db"))), relayOf("account", async () => 1), { onError: () => undefined, onAccountError: () => undefined });
    await expect(down.tick()).rejects.toThrow("db");
    expect(order).toEqual(["business"]);
    // Without an account relay it is the business relay alone.
    expect(await combineRelays(relayOf("business", async () => 2), null, { onError: () => undefined, onAccountError: () => undefined }).tick()).toBe(2);
  });

  it("starts one relay once Redis answers, wakes it and stops it; the account outbox is on by default and can be turned off", async () => {
    expect(ACCOUNT_RELAY_ENABLED).toBe(true);
    const fake = () => ({ wake: vi.fn(), stop: vi.fn(async () => undefined) }) as unknown as OutboxRelay & { wake: ReturnType<typeof vi.fn>; stop: ReturnType<typeof vi.fn> };
    const relay = fake();
    const supervisor = superviseOutboxRelay({ db: {} as never, redis: null, log: log() as never, env: hz.deps.env }, { reachable: async () => true, start: () => relay });
    await until(async () => supervisor.status().state === "running", "started");
    supervisor.wake();
    expect(relay.wake).toHaveBeenCalledTimes(1);
    await supervisor.stop();
    expect(relay.stop).toHaveBeenCalledTimes(1);

    // Turned off: the default relay publishes the business outbox only, and the log says so.
    const redis = new MemoryRedis();
    const said = log();
    const off = superviseOutboxRelay({ db: hz.db, redis: redis as never, log: said as never, env: hz.deps.env }, { reachable: async () => true, accountRelay: false });
    try {
      await until(async () => off.status().state === "running", "started without the account outbox");
      expect(JSON.stringify(said.info.mock.calls)).toContain("account outbox relay is off");
      const p = await person("Relay Off");
      await p.me.founder.publicProfile.publish({ handle: "relay-off", content: content() });
      off.wake();
      await new Promise((r) => setTimeout(r, 400));
      expect(await redis.xlen(accountStreamKey(p.userId))).toBe(0);
      expect((await queued(p.userId)).every((q) => !q.published)).toBe(true);
    } finally {
      await off.stop();
    }
  });

  it("stopping never waits longer than its bound: a relay whose tick never returns is left behind with a warning", async () => {
    const stuck = { wake: vi.fn(), stop: vi.fn(() => new Promise<void>(() => undefined)) } as unknown as OutboxRelay;
    const said = log();
    const supervisor = superviseOutboxRelay({ db: {} as never, redis: null, log: said as never, env: hz.deps.env }, { reachable: async () => true, start: () => stuck, stopTimeoutMs: 50 });
    await until(async () => supervisor.status().state === "running", "started");
    const t = Date.now();
    await supervisor.stop();
    expect(Date.now() - t).toBeLessThan(2_000);
    expect(supervisor.status().state).toBe("stopped");
    expect(JSON.stringify(said.warn.mock.calls)).toContain("did not stop in time");
    expect(RELAY_STOP_TIMEOUT_MS).toBeLessThanOrEqual(5_000);
  });
});
