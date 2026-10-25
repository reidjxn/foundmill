/**
 * Anthropomorphic agents (0067): every hire takes a persona key (unique within the business, avoiding the owner's other
 * businesses' keys, seeded by the business id), a clone gets its own, a rename keeps it, the boot backfill is
 * idempotent, reads never cross tenants, and persona_portraits is a service-only platform table.
 */
import { pickPersonaKeys, personaByKey, PERSONAS } from "@foundmill/shared";
import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { personaContext, repos } from "../../repos";
import * as s from "../../schema";
import { setupRepoHarness, type RepoHarness } from "./helpers";

let r: RepoHarness;
beforeAll(async () => {
  r = await setupRepoHarness("personas");
}, 120_000);
afterAll(() => r?.close());

const keysOf = async (businessId: string): Promise<(string | null)[]> => (await r.db.select({ k: s.agents.personaKey }).from(s.agents).where(eq(s.agents.businessId, businessId))).map((x) => x.k);

/** A business with its own owner membership for `ownerId` (superuser insert, like the RLS fixture). */
async function businessOwnedBy(ownerId: string, slug: string): Promise<string> {
  const [b] = await r.db.insert(s.businesses).values({ name: slug, slug, createdBy: ownerId }).returning({ id: s.businesses.id });
  await r.db.insert(s.memberships).values({ businessId: b!.id, userId: ownerId, role: "owner" });
  return b!.id;
}

const hire = (businessId: string, name: string, extra: Record<string, unknown> = {}) => repos.agents.create(r.db, businessId, { name, agentType: "engineer", ...extra });

describe("boot backfill (repos.agents.backfillPersonas)", () => {
  it("gives every agent without a key one, unique per business, and a second run changes nothing", async () => {
    // The fixture's agents were inserted raw, before any hire rule: they have no key.
    expect((await keysOf(r.A.businessId)).some((k) => k === null)).toBe(true);
    const first = await repos.agents.backfillPersonas(r.db);
    expect(first.failed).toEqual([]);
    expect(first.agents).toBeGreaterThanOrEqual(4);
    for (const b of [r.A.businessId, r.B.businessId]) {
      const keys = await keysOf(b);
      expect(keys.every((k) => k !== null && personaByKey(k) !== null)).toBe(true);
      expect(new Set(keys).size).toBe(keys.length);
    }
    const before = await r.db.select({ id: s.agents.id, k: s.agents.personaKey }).from(s.agents).orderBy(s.agents.id);
    const second = await repos.agents.backfillPersonas(r.db);
    expect(second).toEqual({ businesses: 0, agents: 0, failed: [] });
    expect(await r.db.select({ id: s.agents.id, k: s.agents.personaKey }).from(s.agents).orderBy(s.agents.id)).toEqual(before);
  });

  it("assignMissingPersonas only touches agents with no key and keeps the business's own keys", async () => {
    const bid = await businessOwnedBy(r.A.ownerId, "personas-backfill-own");
    const kept = await hire(bid, "Kept");
    await r.db.insert(s.agents).values([
      { businessId: bid, name: "Legacy one", agentType: "engineer" },
      { businessId: bid, name: "Legacy two", agentType: "engineer" },
    ]);
    expect(await repos.agents.assignMissingPersonas(r.db, bid)).toBe(2);
    expect(await repos.agents.assignMissingPersonas(r.db, bid)).toBe(0);
    const keys = await keysOf(bid);
    expect(keys).toContain(kept.personaKey);
    expect(new Set(keys).size).toBe(3);
  });
});

describe("assignment at hire", () => {
  it("create, createMany and clone give each agent a catalog key unique within the business (released agents included)", async () => {
    const bid = await businessOwnedBy(r.B.ownerId, "personas-unique");
    const one = await hire(bid, "Solo");
    expect(personaByKey(one.personaKey)).not.toBeNull();
    const released = await hire(bid, "Leaver");
    await repos.agents.release(r.db, bid, released.id);
    const many = await repos.agents.createMany(
      r.db,
      bid,
      Array.from({ length: 30 }, (_, i) => ({ id: crypto.randomUUID(), name: `Team ${i}`, agentType: "engineer" })),
    );
    const clone = await repos.agents.clone(r.db, bid, one.id, { name: "Solo copy" });
    expect(clone.personaKey).not.toBe(one.personaKey);
    const keys = [one.personaKey, released.personaKey, ...many.map((a) => a.personaKey), clone.personaKey];
    expect(keys.every((k) => k !== null)).toBe(true);
    expect(new Set(keys).size).toBe(keys.length);
    expect(new Set(await keysOf(bid)).size).toBe(keys.length);
  });

  it("is deterministic: a fresh business with no other businesses picks the catalog order seeded by its id", async () => {
    const owner = await r.h.createUser("personas-solo-owner@test.local");
    const bid = await businessOwnedBy(owner, "personas-deterministic");
    const many = await repos.agents.createMany(
      r.db,
      bid,
      Array.from({ length: 5 }, (_, i) => ({ id: crypto.randomUUID(), name: `Det ${i}`, agentType: "engineer" })),
    );
    expect(many.map((a) => a.personaKey)).toEqual(pickPersonaKeys(5, { seed: bid }));
  });

  it("avoids the keys the owner's other businesses use, and only theirs", async () => {
    const owner = await r.h.createUser("personas-multi-owner@test.local");
    const first = await businessOwnedBy(owner, "personas-owner-first");
    const firstAgents = await repos.agents.createMany(
      r.db,
      first,
      Array.from({ length: 20 }, (_, i) => ({ id: crypto.randomUUID(), name: `First ${i}`, agentType: "engineer" })),
    );
    const second = await businessOwnedBy(owner, "personas-owner-second");
    const ctx = await personaContext(r.db, second);
    expect(new Set(ctx.avoid)).toEqual(new Set(firstAgents.map((a) => a.personaKey)));
    const secondAgents = await repos.agents.createMany(
      r.db,
      second,
      Array.from({ length: 20 }, (_, i) => ({ id: crypto.randomUUID(), name: `Second ${i}`, agentType: "engineer" })),
    );
    const firstKeys = new Set(firstAgents.map((a) => a.personaKey));
    expect(secondAgents.filter((a) => firstKeys.has(a.personaKey))).toEqual([]);
    // A business of another owner does not avoid them.
    const stranger = await businessOwnedBy(await r.h.createUser("personas-stranger@test.local"), "personas-stranger");
    expect((await personaContext(r.db, stranger)).avoid).toEqual([]);
  });

  it("keeps a key the caller gives, refuses one outside the catalog, and a rename never changes it", async () => {
    const bid = await businessOwnedBy(r.B.ownerId, "personas-explicit");
    const key = PERSONAS[7]!.key;
    const given = await hire(bid, "Given", { personaKey: key });
    expect(given.personaKey).toBe(key);
    await expect(hire(bid, "Bad", { personaKey: "not-a-persona" })).rejects.toMatchObject({ code: "validation" });
    const renamed = await repos.agents.update(r.db, bid, given.id, { name: "Given renamed", personaKey: PERSONAS[8]!.key } as never);
    expect(renamed.name).toBe("Given renamed");
    expect(renamed.personaKey).toBe(key);
    // The next pick never takes the given key.
    const next = await hire(bid, "Next");
    expect(next.personaKey).not.toBe(key);
  });

  it("replaces a given key a live agent of the business already holds with a fresh pick (a released agent's key may be given back)", async () => {
    const bid = await businessOwnedBy(r.B.ownerId, "personas-given-taken");
    const first = await hire(bid, "First", { personaKey: PERSONAS[20]!.key });
    expect(first.personaKey).toBe(PERSONAS[20]!.key);
    const second = await hire(bid, "Second", { personaKey: PERSONAS[20]!.key });
    expect(second.personaKey).not.toBe(PERSONAS[20]!.key);
    expect(personaByKey(second.personaKey)).not.toBeNull();
    // Twice in one batch: the first keeps it, the second gets a fresh pick.
    const batch = await repos.agents.createMany(r.db, bid, [
      { id: crypto.randomUUID(), name: "Batch one", agentType: "engineer", personaKey: PERSONAS[21]!.key },
      { id: crypto.randomUUID(), name: "Batch two", agentType: "engineer", personaKey: PERSONAS[21]!.key },
    ]);
    expect(batch[0]!.personaKey).toBe(PERSONAS[21]!.key);
    expect(batch[1]!.personaKey).not.toBe(PERSONAS[21]!.key);
    const keys = await keysOf(bid);
    expect(new Set(keys).size).toBe(keys.length);
    // Released: the key is no longer held by a live agent, so a caller that names it on purpose gets it.
    await repos.agents.release(r.db, bid, first.id);
    const rehired = await hire(bid, "Rehired", { personaKey: PERSONAS[20]!.key });
    expect(rehired.personaKey).toBe(PERSONAS[20]!.key);
  });
});

describe("reads carry the key and stay in their business", () => {
  it("listRoster includes personaKey", async () => {
    const roster = await repos.agents.listRoster(r.db, r.A.businessId);
    expect(roster.length).toBeGreaterThan(0);
    for (const a of roster) expect(personaByKey(a.personaKey)).not.toBeNull();
  });

  it("personaKeysByIds answers only this business's agents, under the service role and as A's owner", async () => {
    const ids = [r.A.agentId, r.B.agentId, r.B.agent2Id];
    const svc = await repos.agents.personaKeysByIds(r.db, r.A.businessId, ids);
    expect([...svc.keys()]).toEqual([r.A.agentId]);
    const asOwner = await r.as(r.A.ownerId, (tx) => repos.agents.personaKeysByIds(tx, r.A.businessId, ids));
    expect([...asOwner.keys()]).toEqual([r.A.agentId]);
    // Asking for B's business as A's owner: RLS returns nothing at all.
    const crossed = await r.as(r.A.ownerId, (tx) => repos.agents.personaKeysByIds(tx, r.B.businessId, ids));
    expect(crossed.size).toBe(0);
    // And B's roster read as A's owner shows no agents (so no persona keys) of B.
    expect(await r.as(r.A.ownerId, (tx) => repos.agents.listRoster(tx, r.B.businessId))).toEqual([]);
  });

  it("A's owner cannot set a persona key on B's agents", async () => {
    const before = (await r.db.select({ k: s.agents.personaKey }).from(s.agents).where(eq(s.agents.id, r.B.agentId)))[0]!.k;
    await r.as(r.A.ownerId, (tx) => tx.update(s.agents).set({ personaKey: "amara" }).where(eq(s.agents.id, r.B.agentId)));
    expect((await r.db.select({ k: s.agents.personaKey }).from(s.agents).where(eq(s.agents.id, r.B.agentId)))[0]!.k).toBe(before);
  });

  it("the column refuses a malformed key", async () => {
    await expect(r.db.update(s.agents).set({ personaKey: "Not A Key!" }).where(eq(s.agents.id, r.A.agentId))).rejects.toThrow();
  });
});

describe("persona_portraits (repos.personaPortraits)", () => {
  const png = (n: number) => Uint8Array.from([0x89, 0x50, 0x4e, 0x47, n]);
  const key = PERSONAS[0]!.key;
  const other = PERSONAS[1]!.key;

  it("put stores, get returns the bytes, and a second put replaces (one row per key)", async () => {
    expect(await repos.personaPortraits.get(r.db, key)).toBeNull();
    const stored = await repos.personaPortraits.put(r.db, { key, mime: "image/png", content: png(1), model: "mock-image" });
    expect(stored.key).toBe(key);
    const got = await repos.personaPortraits.get(r.db, key);
    expect(got).toMatchObject({ key, mime: "image/png", model: "mock-image" });
    expect(Array.from(got!.content)).toEqual(Array.from(png(1)));
    expect(got!.createdAt).toBeInstanceOf(Date);
    await repos.personaPortraits.put(r.db, { key, mime: "image/webp", content: png(2), model: "mock-image-2" });
    const again = await repos.personaPortraits.get(r.db, key);
    expect(again).toMatchObject({ mime: "image/webp", model: "mock-image-2" });
    expect(Array.from(again!.content)).toEqual(Array.from(png(2)));
    const n = await r.db.select({ n: sql<number>`count(*)::int` }).from(s.personaPortraits).where(eq(s.personaPortraits.personaKey, key));
    expect(Number(n[0]!.n)).toBe(1);
  });

  it("readyKeys answers the stored ones among those asked, in order, without duplicates or unknown keys", async () => {
    expect(await repos.personaPortraits.readyKeys(r.db, [])).toEqual([]);
    expect(await repos.personaPortraits.readyKeys(r.db, [other, key, key, "nobody"])).toEqual([key]);
    await repos.personaPortraits.put(r.db, { key: other, mime: "image/jpeg", content: png(3), model: "mock-image" });
    expect(await repos.personaPortraits.readyKeys(r.db, [other, key])).toEqual([other, key]);
  });

  it("readyKeys counts a row of an excluded model as missing (a mock placeholder while portraits are live), and put replaces it", async () => {
    const k = PERSONAS[5]!.key;
    await repos.personaPortraits.put(r.db, { key: k, mime: "image/png", content: png(5), model: "mock-portrait" });
    expect(await repos.personaPortraits.readyKeys(r.db, [k, key])).toEqual([k, key]);
    expect(await repos.personaPortraits.readyKeys(r.db, [k, key], { excludeModels: ["mock-portrait"] })).toEqual([key]);
    expect(await repos.personaPortraits.readyKeys(r.db, [k], { excludeModels: [] })).toEqual([k]);
    await repos.personaPortraits.put(r.db, { key: k, mime: "image/webp", content: png(6), model: "gpt-image-real" });
    expect(await repos.personaPortraits.readyKeys(r.db, [k], { excludeModels: ["mock-portrait"] })).toEqual([k]);
    expect(await repos.personaPortraits.get(r.db, k)).toMatchObject({ mime: "image/webp", model: "gpt-image-real" });
  });

  it("0069: one key has one row per style; get and readyKeys read the style asked and default to humans", async () => {
    const k = PERSONAS[9]!.key;
    expect(await repos.personaPortraits.get(r.db, k, "fantasy")).toBeNull();
    const human = await repos.personaPortraits.put(r.db, { key: k, mime: "image/png", content: png(10), model: "mock-portrait" });
    expect(human.style).toBe("humans");
    const elf = await repos.personaPortraits.put(r.db, { key: k, style: "fantasy", mime: "image/webp", content: png(11), model: "gpt-image-real" });
    expect(elf).toMatchObject({ key: k, style: "fantasy", mime: "image/webp" });
    await repos.personaPortraits.put(r.db, { key: k, style: "cartoon_2d", mime: "image/png", content: png(12), model: "mock-portrait" });
    // Three rows for the key, one per style; the humans row is untouched by the others.
    const n = await r.db.select({ n: sql<number>`count(*)::int` }).from(s.personaPortraits).where(eq(s.personaPortraits.personaKey, k));
    expect(Number(n[0]!.n)).toBe(3);
    expect(Array.from((await repos.personaPortraits.get(r.db, k))!.content)).toEqual(Array.from(png(10)));
    expect(Array.from((await repos.personaPortraits.get(r.db, k, "humans"))!.content)).toEqual(Array.from(png(10)));
    expect(await repos.personaPortraits.get(r.db, k, "fantasy")).toMatchObject({ style: "fantasy", model: "gpt-image-real" });
    expect(await repos.personaPortraits.get(r.db, k, "cartoon_3d")).toBeNull();
    // A second put of the same (style, key) replaces, never adds.
    await repos.personaPortraits.put(r.db, { key: k, style: "fantasy", mime: "image/webp", content: png(13), model: "gpt-image-real-2" });
    expect(Number((await r.db.select({ n: sql<number>`count(*)::int` }).from(s.personaPortraits).where(eq(s.personaPortraits.personaKey, k)))[0]!.n)).toBe(3);
    expect(Array.from((await repos.personaPortraits.get(r.db, k, "fantasy"))!.content)).toEqual(Array.from(png(13)));
    // readyKeys is per style, humans unless given, and excludes models per style.
    expect(await repos.personaPortraits.readyKeys(r.db, [k])).toEqual([k]);
    expect(await repos.personaPortraits.readyKeys(r.db, [k], { style: "fantasy" })).toEqual([k]);
    expect(await repos.personaPortraits.readyKeys(r.db, [k], { style: "cartoon_3d" })).toEqual([]);
    expect(await repos.personaPortraits.readyKeys(r.db, [k], { style: "cartoon_2d", excludeModels: ["mock-portrait"] })).toEqual([]);
    expect(await repos.personaPortraits.readyKeys(r.db, [k], { style: "fantasy", excludeModels: ["mock-portrait"] })).toEqual([k]);
    // An unknown style is refused on write and the column refuses it in SQL too.
    await expect(repos.personaPortraits.put(r.db, { key: k, style: "anime" as never, mime: "image/png", content: png(1), model: "m" })).rejects.toMatchObject({ code: "validation" });
    await expect(r.db.execute(sql`update persona_portraits set style = 'anime' where persona_key = ${k}`)).rejects.toThrow();
  });

  it("refuses keys outside the catalog, empty content and other image types", async () => {
    await expect(repos.personaPortraits.put(r.db, { key: "nobody", mime: "image/png", content: png(1), model: "m" })).rejects.toMatchObject({ code: "validation" });
    await expect(repos.personaPortraits.put(r.db, { key, mime: "image/png", content: new Uint8Array(), model: "m" })).rejects.toMatchObject({ code: "validation" });
    await expect(repos.personaPortraits.put(r.db, { key, mime: "image/svg+xml" as never, content: png(1), model: "m" })).rejects.toMatchObject({ code: "validation" });
    expect(await repos.personaPortraits.get(r.db, "nobody")).toBeNull();
  });

  it("is service-only: app roles can neither read nor write it, and RLS is on", async () => {
    await expect(r.as(r.A.ownerId, (tx) => tx.select().from(s.personaPortraits))).rejects.toThrow(/permission denied/);
    await expect(r.as(r.A.ownerId, (tx) => tx.insert(s.personaPortraits).values({ personaKey: PERSONAS[2]!.key, mime: "image/png", content: png(4), model: "m" }))).rejects.toThrow(/permission denied/);
    await expect(r.as(r.A.ownerId, (tx) => tx.delete(s.personaPortraits))).rejects.toThrow(/permission denied/);
    await expect(r.h.anon().run((tx) => tx.select().from(s.personaPortraits))).rejects.toThrow(/permission denied/);
    const rls = await r.db.execute(sql`select rowsecurity from pg_tables where tablename = 'persona_portraits'`);
    expect((rls as unknown as { rows: { rowsecurity: boolean }[] }).rows[0]?.rowsecurity).toBe(true);
    const policies = await r.db.execute(sql`select count(*)::int as n from pg_policies where tablename = 'persona_portraits'`);
    expect(Number((policies as unknown as { rows: { n: number }[] }).rows[0]?.n)).toBe(0);
    // The service role reads it (what the api uses).
    expect((await r.svc((tx) => repos.personaPortraits.readyKeys(tx, [key]))).length).toBe(1);
  });
});

describe("account preference (anthropomorphic_agents)", () => {
  it("defaults to off, round-trips on and off as the user, and is the user's own", async () => {
    const u = r.A.memberId;
    expect((await r.as(u, (tx) => repos.preferences.get(tx, u))).anthropomorphicAgents).toBe(false);
    expect((await r.as(u, (tx) => repos.preferences.update(tx, u, { anthropomorphicAgents: true }))).anthropomorphicAgents).toBe(true);
    expect((await r.as(u, (tx) => repos.preferences.get(tx, u))).anthropomorphicAgents).toBe(true);
    // Another change keeps it.
    const after = await r.as(u, (tx) => repos.preferences.update(tx, u, { textSize: "comfortable" }));
    expect(after).toMatchObject({ anthropomorphicAgents: true, textSize: "comfortable" });
    expect((await r.as(u, (tx) => repos.preferences.update(tx, u, { anthropomorphicAgents: false }))).anthropomorphicAgents).toBe(false);
    // Someone else reads their own defaults, not this row.
    expect((await r.as(r.B.memberId, (tx) => repos.preferences.get(tx, u))).anthropomorphicAgents).toBe(false);
    await expect(r.as(u, (tx) => repos.preferences.update(tx, u, { anthropomorphicAgents: "yes" } as never))).rejects.toMatchObject({ code: "validation" });
  });

  it("0069: the style defaults to humans, round-trips each style as the user, survives the switch, and refuses an unknown one", async () => {
    const u = r.A.memberId;
    expect((await r.as(u, (tx) => repos.preferences.get(tx, u))).agentStyle).toBe("humans");
    for (const style of ["cartoon_3d", "cartoon_2d", "fantasy", "humans"] as const) {
      expect((await r.as(u, (tx) => repos.preferences.update(tx, u, { agentStyle: style }))).agentStyle).toBe(style);
      expect((await r.as(u, (tx) => repos.preferences.get(tx, u))).agentStyle).toBe(style);
    }
    // The switch and the style travel together or apart; turning the switch off keeps the style for next time.
    expect(await r.as(u, (tx) => repos.preferences.update(tx, u, { anthropomorphicAgents: true, agentStyle: "fantasy" }))).toMatchObject({ anthropomorphicAgents: true, agentStyle: "fantasy" });
    expect(await r.as(u, (tx) => repos.preferences.update(tx, u, { anthropomorphicAgents: false }))).toMatchObject({ anthropomorphicAgents: false, agentStyle: "fantasy" });
    expect((await r.as(r.B.memberId, (tx) => repos.preferences.get(tx, r.B.memberId))).agentStyle).toBe("humans");
    await expect(r.as(u, (tx) => repos.preferences.update(tx, u, { agentStyle: "anime" } as never))).rejects.toMatchObject({ code: "validation" });
    await expect(r.db.execute(sql`update account_preferences set agent_style = 'anime' where user_id = ${u}::uuid`)).rejects.toThrow();
    await r.as(u, (tx) => repos.preferences.update(tx, u, { agentStyle: "humans" }));
  });
});

describe("the display preference rides with the membership (repos.memberships.access)", () => {
  it("is false without a preferences row, and follows the member's own choice", async () => {
    const userId = r.A.ownerId;
    try {
      await r.db.delete(s.accountPreferences).where(eq(s.accountPreferences.userId, userId));
      expect(await repos.memberships.access(r.db, r.A.businessId, userId)).toMatchObject({ anthropomorphicAgents: false, agentStyle: "humans" });
      await repos.preferences.update(r.db, userId, { anthropomorphicAgents: true, agentStyle: "cartoon_2d" });
      expect(await repos.memberships.access(r.db, r.A.businessId, userId)).toMatchObject({ anthropomorphicAgents: true, agentStyle: "cartoon_2d" });
      // A non-member learns nothing, not even the preferences.
      expect(await repos.memberships.access(r.db, r.B.businessId, userId)).toEqual({ membership: null, business: null, anthropomorphicAgents: false, agentStyle: "humans" });
    } finally {
      await repos.preferences.update(r.db, userId, { anthropomorphicAgents: false, agentStyle: "humans" });
    }
  });
});
