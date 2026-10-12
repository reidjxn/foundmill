/**
 * Membership checks through the repositories on PGlite: a member of A may read ev:A and A's sessions, never B's.
 */
import { createBusinessFixture, type BusinessFixture } from "@foundmill/db/__tests__/rls/fixtures";
import { createTestDb, type TestHarness } from "@foundmill/db/testing/pglite";
import type { Db } from "@foundmill/db";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createCachedAuthorizer, createMemoryAuthorizer, createRepoAuthorizer, type Authorizer } from "../authorize";
import { businessChannel, sessionChannel, userChannel } from "../protocol";
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
  it("allows every member role of a business to read ev:<businessId>", async () => {
    for (const userId of [A.ownerId, A.adminId, A.memberId, A.viewerId]) {
      expect(await authorizer.canSubscribe(userId, businessChannel(A.businessId))).toEqual({ ok: true });
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
    expect(await authorizer.canSubscribe(A.ownerId, sessionChannel(A.sessionId))).toEqual({ ok: true });
    expect(await authorizer.canSubscribe(A.viewerId, sessionChannel(A.sessionId))).toEqual({ ok: true });
    expect(await authorizer.canSubscribe(B.ownerId, sessionChannel(A.sessionId))).toMatchObject({ ok: false, code: "forbidden" });
    expect(await authorizer.canSubscribe(A.ownerId, sessionChannel(B.sessionId))).toMatchObject({ ok: false, code: "forbidden" });
    expect(await authorizer.canSubscribe(A.ownerId, sessionChannel("00000000-0000-4000-8000-000000000000"))).toMatchObject({ ok: false, code: "forbidden" });
  });

  it("opens u:<userId> to that person only, whatever businesses they or the others belong to (audit #65)", async () => {
    const stranger = await h.createUser("no-business@stream.test");
    expect(await authorizer.canSubscribe(A.ownerId, userChannel(A.ownerId))).toEqual({ ok: true });
    // A person with no business at all still gets their own LIVE signals.
    expect(await authorizer.canSubscribe(stranger, userChannel(stranger))).toEqual({ ok: true });
    expect(await authorizer.canSubscribe(stranger, userChannel(stranger.toUpperCase()))).toEqual({ ok: true });
    // Nobody reads another person's, not even a co-member of the same business.
    expect(await authorizer.canSubscribe(A.adminId, userChannel(A.ownerId))).toMatchObject({ ok: false, code: "forbidden" });
    expect(await authorizer.canSubscribe(B.ownerId, userChannel(A.ownerId))).toMatchObject({ ok: false, code: "forbidden" });
    expect(await authorizer.canSubscribe(A.ownerId, "u:*")).toMatchObject({ ok: false, code: "invalid_channel" });
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
    expect(await m.canSubscribe(USER_A, businessChannel(BUSINESS_A))).toEqual({ ok: true });
    expect(await m.canSubscribe(USER_B, businessChannel(BUSINESS_A))).toMatchObject({ ok: false, code: "forbidden" });
    expect(await m.canSubscribe(USER_A, sessionChannel(SESSION_A))).toEqual({ ok: true });
    expect(await m.canSubscribe(USER_A, sessionChannel(SESSION_B))).toMatchObject({ ok: false, code: "forbidden" });
    expect(await m.canSubscribe(USER_A, userChannel(USER_A))).toEqual({ ok: true });
    expect(await m.canSubscribe(USER_B, userChannel(USER_A))).toMatchObject({ ok: false, code: "forbidden" });
    expect(await m.canSubscribe(USER_A, "nope")).toMatchObject({ ok: false, code: "invalid_channel" });
  });
});
