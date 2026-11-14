/**
 * 0104 — adult_confirmations: "I am 18 or older", confirmed once at sign-up for the whole product. Account-scoped, so
 * the cross-tenant question is cross-account: a person reads and inserts only their own row, never someone else's; no
 * client updates or deletes one; the time is the database's, whatever the client sends; and the network's
 * `network_attestations` (0027) stays in step both ways, its old rows copied with their own time.
 */
import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { readMigrations } from "../../migrations";
import { adultsRepo } from "../../repos/adults";
import { socialRepo } from "../../repos/social";
import * as s from "../../schema";
import { createTestDb, type TestHarness } from "../../testing/pglite";
import { createBusinessFixture, RLS_DENIED, type BusinessFixture } from "./fixtures";

let h: TestHarness;
let A: BusinessFixture;
let B: BusinessFixture;

const denied = /permission denied/;
/** The migration's number may change when branches merge: this is the one place this file names it. */
const TAG = "0104_adult_confirmations";
const LONG_AGO = new Date("2001-01-01T00:00:00Z");

beforeAll(async () => {
  h = await createTestDb();
  A = await createBusinessFixture(h, "adult-a");
  B = await createBusinessFixture(h, "adult-b");
});
afterAll(() => h?.close());

const rowsFor = (userId: string) => h.service().run((tx) => tx.select().from(s.adultConfirmations).where(eq(s.adultConfirmations.userId, userId)));

describe("adult_confirmations (0104): each person their own row", () => {
  it("a person inserts and reads their own confirmation, and reads nobody else's", async () => {
    const mine = await h.asUser(A.ownerId).run((tx) => adultsRepo.confirm(tx, A.ownerId));
    expect(mine.created).toBe(true);
    expect((await h.asUser(A.ownerId).run((tx) => tx.select().from(s.adultConfirmations))).map((r) => r.userId)).toEqual([A.ownerId]);
    expect(await h.asUser(B.ownerId).run((tx) => tx.select().from(s.adultConfirmations))).toHaveLength(0);
    expect(await h.asUser(B.ownerId).run((tx) => adultsRepo.confirmedAt(tx, A.ownerId))).toBeNull();
  });

  it("a person cannot confirm for someone else", async () => {
    await expect(h.asUser(B.ownerId).run((tx) => tx.insert(s.adultConfirmations).values({ userId: B.memberId }))).rejects.toThrow(RLS_DENIED);
    expect(await rowsFor(B.memberId)).toHaveLength(0);
  });

  it("no client updates or deletes a confirmation, their own or anyone's", async () => {
    await expect(h.asUser(A.ownerId).run((tx) => tx.update(s.adultConfirmations).set({ confirmedAt: LONG_AGO }).where(eq(s.adultConfirmations.userId, A.ownerId)))).rejects.toThrow(denied);
    await expect(h.asUser(A.ownerId).run((tx) => tx.delete(s.adultConfirmations).where(eq(s.adultConfirmations.userId, A.ownerId)))).rejects.toThrow(denied);
    await expect(h.asUser(B.ownerId).run((tx) => tx.delete(s.adultConfirmations).where(eq(s.adultConfirmations.userId, A.ownerId)))).rejects.toThrow(denied);
    expect(await rowsFor(A.ownerId)).toHaveLength(1);
  });

  it("anon reads and writes nothing", async () => {
    await expect(h.anon().run((tx) => tx.select().from(s.adultConfirmations))).rejects.toThrow(denied);
    await expect(h.anon().run((tx) => tx.insert(s.adultConfirmations).values({ userId: B.ownerId }))).rejects.toThrow(denied);
  });

  it("the database sets the time: a client cannot backdate it, and the first confirmation stands", async () => {
    const before = Date.now() - 60_000;
    await h.asUser(B.ownerId).run((tx) => tx.insert(s.adultConfirmations).values({ userId: B.ownerId, confirmedAt: LONG_AGO }));
    const [row] = await rowsFor(B.ownerId);
    expect(row!.confirmedAt.getTime()).toBeGreaterThan(before);
    const again = await h.asUser(B.ownerId).run((tx) => adultsRepo.confirm(tx, B.ownerId));
    expect(again).toEqual({ confirmedAt: row!.confirmedAt, created: false });
    // Not even the service role redates one: an update keeps the first time.
    await h.service().run((tx) => tx.update(s.adultConfirmations).set({ confirmedAt: LONG_AGO }).where(eq(s.adultConfirmations.userId, B.ownerId)));
    expect((await rowsFor(B.ownerId))[0]!.confirmedAt).toEqual(row!.confirmedAt);
  });

  it("the client roles hold SELECT and INSERT only (0087's rule)", async () => {
    const held = async (role: string) => {
      const out: string[] = [];
      for (const priv of ["select", "insert", "update", "delete", "truncate", "references", "trigger"]) {
        const res = (await h.db.execute(sql`select has_table_privilege(${role}::name, 'public.adult_confirmations', ${priv}::text) as ok`)) as unknown as { rows: { ok: boolean }[] };
        if (res.rows[0]?.ok) out.push(priv);
      }
      return out;
    };
    expect(await held("authenticated")).toEqual(["select", "insert"]);
    expect(await held("anon")).toEqual([]);
  });
});

describe("adult_confirmations and network_attestations stay in step", () => {
  it("a confirmation at sign-up reads as confirmed on the network", async () => {
    const userId = await h.createUser("adult-signup@test.local");
    const { confirmedAt } = await h.asUser(userId).run((tx) => adultsRepo.confirm(tx, userId));
    const network = await h.service().run((tx) => tx.select().from(s.networkAttestations).where(eq(s.networkAttestations.userId, userId)));
    expect(network.map((r) => r.adultConfirmedAt)).toEqual([confirmedAt]);
    expect(await h.service().run((tx) => socialRepo.adultConfirmedAt(tx, userId))).toEqual(confirmedAt);
    expect((await h.service().run((tx) => socialRepo.badge(tx, userId))).adultConfirmed).toBe(true);
  });

  it("a row still written straight into network_attestations counts as the account's confirmation", async () => {
    const userId = await h.createUser("adult-network@test.local");
    await h.service().run((tx) => tx.insert(s.networkAttestations).values({ userId }));
    expect(await rowsFor(userId)).toHaveLength(1);
    expect(await h.service().run((tx) => adultsRepo.confirmedAt(tx, userId))).not.toBeNull();
  });

  it("the network's confirm writes the account's record", async () => {
    const userId = await h.createUser("adult-live@test.local");
    const at = await h.service().run((tx) => socialRepo.confirmAdult(tx, userId));
    expect((await rowsFor(userId)).map((r) => r.confirmedAt)).toEqual([at]);
  });
});

describe("0104 copies every earlier network attestation, with its own time", () => {
  it("a person the network asked before 0104 is confirmed, at the time they confirmed", async () => {
    const all = readMigrations();
    const before = await createTestDb({ migrations: all.filter((m) => m.tag < TAG) });
    try {
      const userId = await before.createUser("adult-before@test.local");
      const then = new Date("2026-10-20T10:00:00Z");
      await before.service().run((tx) => tx.insert(s.networkAttestations).values({ userId, adultConfirmedAt: then }));
      await before.pg.exec(all.find((m) => m.tag === TAG)!.sql);
      const rows = await before.service().run((tx) => tx.select().from(s.adultConfirmations).where(eq(s.adultConfirmations.userId, userId)));
      expect(rows.map((r) => r.confirmedAt)).toEqual([then]);
    } finally {
      await before.close();
    }
  });
});
