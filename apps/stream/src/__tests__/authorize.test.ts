/**
 * Membership checks through the repositories on PGlite: a member of A may read ev:A and A's sessions, never B's.
 */
import { createBusinessFixture, type BusinessFixture } from "@foundmill/db/__tests__/rls/fixtures";
import { createTestDb, type TestHarness } from "@foundmill/db/testing/pglite";
import { businesses, memberships as membershipsTable, repos, type Db } from "@foundmill/db";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createCachedAuthorizer, createMemoryAuthorizer, createRepoAuthorizer, type Authorizer } from "../authorize";
import { businessChannel, sessionChannel } from "../protocol";
import { BUSINESS_A, memberships, SESSION_A, SESSION_B, USER_A, USER_B } from "./helpers";

let h: TestHarness;
let db: Db;
let A: BusinessFixture;
let B: BusinessFixture;
let authorizer: Authorizer;

beforeAll(async () => {
  h = await createTestDb();
  db = h.db as unknown as Db;
  [A, B] = await Promise.all([createBusinessFixture(h, "stream-a"), createBusinessFixture(h, "stream-b")]);
  authorizer = createRepoAuthorizer(db);
}, 120_000);

afterAll(async () => {
  await h?.close();
});

describe("repo authorizer (PGlite)", () => {
  it("allows every member role of a business to read ev:<businessId>, with the membership the server filters through", async () => {
    for (const [userId, role] of [[A.ownerId, "owner"], [A.adminId, "admin"], [A.memberId, "member"], [A.viewerId, "viewer"]] as const) {
      expect(await authorizer.canSubscribe(userId, businessChannel(A.businessId))).toEqual({ ok: true, businessId: A.businessId, membership: { role, sectionPermissions: {} } });
    }
  });

  it("carries section walls, and refuses an archived business (as apps/api does)", async () => {
    await repos.memberships.setSectionPermissions(db, A.businessId, A.memberId, { finance: "none" });
    try {
      expect(await authorizer.canSubscribe(A.memberId, businessChannel(A.businessId))).toMatchObject({ ok: true, membership: { role: "member", sectionPermissions: { finance: "none" } } });
    } finally {
      await repos.memberships.setSectionPermissions(db, A.businessId, A.memberId, {});
    }
    const founder = await h.createUser("stream-archived@stream.test");
    const [biz] = await h.db.insert(businesses).values({ name: "Shelved", slug: "stream-shelved", createdBy: founder }).returning({ id: businesses.id });
    await h.db.insert(membershipsTable).values({ businessId: biz!.id, userId: founder, role: "owner" });
    expect(await authorizer.canSubscribe(founder, businessChannel(biz!.id))).toMatchObject({ ok: true });
    await repos.businesses.archive(db, biz!.id);
    expect(await authorizer.canSubscribe(founder, businessChannel(biz!.id))).toMatchObject({ ok: false, code: "forbidden" });
  });

  it("refuses as:<sessionId> to a member walled from Development or from the module the session's work is filed under", async () => {
    // The fixture session works a task of the Product department (module "product").
    try {
      const walled: Record<string, "none">[] = [{ product: "none" }, { development: "none" }];
      for (const walls of walled) {
        await repos.memberships.setSectionPermissions(db, A.businessId, A.memberId, walls);
        expect(await authorizer.canSubscribe(A.memberId, sessionChannel(A.sessionId))).toMatchObject({ ok: false, code: "forbidden", message: expect.stringMatching(/product|development/) });
      }
      await repos.memberships.setSectionPermissions(db, A.businessId, A.memberId, { finance: "none", crm: "none" });
      expect(await authorizer.canSubscribe(A.memberId, sessionChannel(A.sessionId))).toMatchObject({ ok: true, businessId: A.businessId });
    } finally {
      await repos.memberships.setSectionPermissions(db, A.businessId, A.memberId, {});
    }
  });

  it("denies ev:<businessId> to members of another business and to strangers", async () => {
    const stranger = await h.createUser("stranger@stream.test");
    for (const userId of [B.ownerId, B.memberId, stranger]) {
      const r = await authorizer.canSubscribe(userId, businessChannel(A.businessId));
      expect(r).toMatchObject({ ok: false, code: "forbidden" });
    }
  });

  it("allows as:<sessionId> only to members of the session's business", async () => {
    expect(await authorizer.canSubscribe(A.ownerId, sessionChannel(A.sessionId))).toMatchObject({ ok: true, businessId: A.businessId });
    expect(await authorizer.canSubscribe(A.viewerId, sessionChannel(A.sessionId))).toMatchObject({ ok: true, businessId: A.businessId });
    expect(await authorizer.canSubscribe(B.ownerId, sessionChannel(A.sessionId))).toMatchObject({ ok: false, code: "forbidden" });
    expect(await authorizer.canSubscribe(A.ownerId, sessionChannel(B.sessionId))).toMatchObject({ ok: false, code: "forbidden" });
    expect(await authorizer.canSubscribe(A.ownerId, sessionChannel("00000000-0000-4000-8000-000000000000"))).toMatchObject({ ok: false, code: "forbidden" });
  });

  it("rejects channels that are not ev:/as: with a uuid", async () => {
    expect(await authorizer.canSubscribe(A.ownerId, "ev:*")).toMatchObject({ ok: false, code: "invalid_channel" });
    expect(await authorizer.canSubscribe(A.ownerId, `dlq:${A.businessId}`)).toMatchObject({ ok: false, code: "invalid_channel" });
  });

  it("fails closed when the database is unavailable", async () => {
    const broken = createRepoAuthorizer({
      select() {
        throw new Error("connection refused");
      },
    } as unknown as Db);
    expect(await broken.canSubscribe(A.ownerId, businessChannel(A.businessId))).toMatchObject({ ok: false, code: "unavailable" });
  });
});

describe("cached authorizer", () => {
  it("caches allow and deny decisions with separate TTLs and never caches unavailable", async () => {
    let t = 1_000_000;
    let calls = 0;
    let mode: "ok" | "deny" | "down" = "ok";
    const inner: Authorizer = {
      async canSubscribe() {
        calls++;
        if (mode === "ok") return { ok: true };
        if (mode === "deny") return { ok: false, code: "forbidden", message: "no" };
        return { ok: false, code: "unavailable", message: "db down" };
      },
    };
    const cached = createCachedAuthorizer(inner, { allowTtlMs: 1_000, denyTtlMs: 100, now: () => t });
    const ch = businessChannel(BUSINESS_A);
    expect(await cached.canSubscribe(USER_A, ch)).toEqual({ ok: true });
    expect(await cached.canSubscribe(USER_A, ch)).toEqual({ ok: true });
    expect(calls).toBe(1);
    t += 999;
    await cached.canSubscribe(USER_A, ch);
    expect(calls).toBe(1);
    t += 2;
    mode = "deny";
    expect(await cached.canSubscribe(USER_A, ch)).toMatchObject({ ok: false, code: "forbidden" });
    expect(calls).toBe(2);
    await cached.canSubscribe(USER_A, ch);
    expect(calls).toBe(2);
    t += 101;
    mode = "down";
    expect(await cached.canSubscribe(USER_A, ch)).toMatchObject({ ok: false, code: "unavailable" });
    expect(await cached.canSubscribe(USER_A, ch)).toMatchObject({ ok: false, code: "unavailable" });
    expect(calls).toBe(4); // unavailable is retried every time
    cached.invalidate(USER_A);
    expect(cached.size).toBe(0);
  });

  it("invalidate(user) drops that person's decisions at once, even one still being checked", async () => {
    let answer: "ok" | "deny" = "ok";
    let release = null as (() => void) | null;
    const inner: Authorizer = {
      async canSubscribe() {
        // The answer is read when the check starts (the database row as it was), returned when it ends.
        const read = answer;
        if (release === null) await new Promise<void>((r) => (release = r));
        return read === "ok" ? { ok: true } : { ok: false, code: "forbidden", message: "removed" };
      },
    };
    const cached = createCachedAuthorizer(inner, { allowTtlMs: 60_000, denyTtlMs: 60_000 });
    const ch = businessChannel(BUSINESS_A);
    // A check starts before the change and finishes after it: its (stale) allowance is not cached.
    const stale = cached.canSubscribe(USER_A, ch);
    await new Promise((r) => setTimeout(r, 5));
    cached.invalidate(USER_A);
    answer = "deny";
    release!();
    expect(await stale).toEqual({ ok: true });
    expect(await cached.canSubscribe(USER_A, ch)).toMatchObject({ ok: false, code: "forbidden" });
    // Another person's decisions stay cached.
    answer = "ok";
    expect(await cached.canSubscribe(USER_B, ch)).toEqual({ ok: true });
    answer = "deny";
    cached.invalidate(USER_A);
    expect(await cached.canSubscribe(USER_B, ch)).toEqual({ ok: true });
  });

  it("de-duplicates concurrent checks for the same (user, channel)", async () => {
    let calls = 0;
    const inner: Authorizer = {
      async canSubscribe() {
        calls++;
        await new Promise((r) => setTimeout(r, 5));
        return { ok: true };
      },
    };
    const cached = createCachedAuthorizer(inner);
    await Promise.all(Array.from({ length: 16 }, () => cached.canSubscribe(USER_A, sessionChannel(SESSION_A))));
    expect(calls).toBe(1);
  });
});

describe("memory authorizer", () => {
  it("mirrors the repo rules for tests", async () => {
    const m = createMemoryAuthorizer(memberships);
    expect(await m.canSubscribe(USER_A, businessChannel(BUSINESS_A))).toEqual({ ok: true, businessId: BUSINESS_A, membership: { role: "owner", sectionPermissions: {} } });
    expect(await m.canSubscribe(USER_B, businessChannel(BUSINESS_A))).toMatchObject({ ok: false, code: "forbidden" });
    expect(await m.canSubscribe(USER_A, sessionChannel(SESSION_A))).toMatchObject({ ok: true, businessId: BUSINESS_A });
    expect(await m.canSubscribe(USER_A, sessionChannel(SESSION_B))).toMatchObject({ ok: false, code: "forbidden" });
    expect(await m.canSubscribe(USER_A, "nope")).toMatchObject({ ok: false, code: "invalid_channel" });
  });
});
