/** credentials: never selectable by app roles. audit_log: append-only, hash-chained in the database. */
import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import * as s from "../../schema";
import { createTestDb, unwrapDbError, type TestHarness } from "../../testing/pglite";
import { createBusinessFixture, type BusinessFixture } from "./fixtures";

let h: TestHarness;
let A: BusinessFixture;
let B: BusinessFixture;

beforeAll(async () => {
  h = await createTestDb();
  A = await createBusinessFixture(h, "cred-a");
  B = await createBusinessFixture(h, "cred-b");
});
afterAll(() => h?.close());

describe("credentials", () => {
  it("credentials: owner of the business cannot select (permission denied)", async () => {
    await expect(h.asUser(A.ownerId).run((tx) => tx.select().from(s.credentials))).rejects.toThrow(/permission denied/);
  });
  it("credentials: owner cannot insert, update or delete", async () => {
    const row = { businessId: A.businessId, integrationId: A.integrationId, ciphertext: new Uint8Array([1]), dataKeyCiphertext: new Uint8Array([2]), kmsKeyId: "k" };
    await expect(h.asUser(A.ownerId).run((tx) => tx.insert(s.credentials).values(row))).rejects.toThrow(/permission denied/);
    await expect(h.asUser(A.ownerId).run((tx) => tx.update(s.credentials).set({ kmsKeyId: "x" }))).rejects.toThrow(/permission denied/);
    await expect(h.asUser(A.ownerId).run((tx) => tx.delete(s.credentials))).rejects.toThrow(/permission denied/);
  });
  it("credentials: anon cannot select", async () => {
    await expect(h.anon().run((tx) => tx.select().from(s.credentials))).rejects.toThrow(/permission denied/);
  });
  it("credentials: service_role can read and write", async () => {
    const rows = await h.service().run((tx) => tx.select({ id: s.credentials.id, businessId: s.credentials.businessId }).from(s.credentials));
    expect(rows.map((r) => r.businessId).sort()).toEqual([A.businessId, B.businessId].sort());
    const inserted = await h.service().run((tx) =>
      tx
        .insert(s.credentials)
        .values({ businessId: B.businessId, integrationId: B.integrationId, ciphertext: new Uint8Array([9]), dataKeyCiphertext: new Uint8Array([8]), kmsKeyId: "dev" })
        .returning({ id: s.credentials.id }),
    );
    expect(inserted).toHaveLength(1);
  });
  it("credentials: no RLS policy exists, so a stray grant would still expose nothing", async () => {
    const res = await h.db.execute(sql`select count(*)::int as n from pg_policies where tablename = 'credentials'`);
    expect((res as unknown as { rows: { n: number }[] }).rows[0]?.n).toBe(0);
    const rls = await h.db.execute(sql`select rowsecurity from pg_tables where tablename = 'credentials'`);
    expect((rls as unknown as { rows: { rowsecurity: boolean }[] }).rows[0]?.rowsecurity).toBe(true);
  });
});

describe("audit_log", () => {
  it("audit_log: inserts by a member are chained (seq, prev_hash, hash) by the trigger", async () => {
    const rows = await h.asUser(A.memberId).run(async (tx) => {
      await tx.insert(s.auditLog).values({ businessId: A.businessId, actorKind: "user", actorId: A.memberId, action: "task.create", target: { id: A.taskId } });
      await tx.insert(s.auditLog).values({ businessId: A.businessId, actorKind: "user", actorId: A.memberId, action: "task.update", hash: "forged", prevHash: "forged" });
      await tx.insert(s.auditLog).values({ businessId: A.businessId, actorKind: "agent", actorId: A.agentId, action: "tool.call", details: { tool: "github.pr" } });
      return tx.select().from(s.auditLog).where(eq(s.auditLog.businessId, A.businessId)).orderBy(s.auditLog.seq);
    });
    expect(rows.map((r) => r.seq)).toEqual([1, 2, 3]);
    expect(rows[0]!.prevHash).toBeNull();
    expect(rows[1]!.prevHash).toBe(rows[0]!.hash);
    expect(rows[2]!.prevHash).toBe(rows[1]!.hash);
    expect(rows[1]!.hash).not.toBe("forged");
    expect(rows.every((r) => /^[0-9a-f]{64}$/.test(r.hash))).toBe(true);
    expect(new Set(rows.map((r) => r.hash)).size).toBe(3);
  });

  it("audit_log: chains are per business and verify intact", async () => {
    await h.asUser(B.ownerId).run((tx) => tx.insert(s.auditLog).values({ businessId: B.businessId, actorKind: "user", actorId: B.ownerId, action: "business.update" }));
    const b = await h.asUser(B.ownerId).run((tx) => tx.select().from(s.auditLog).where(eq(s.auditLog.businessId, B.businessId)));
    expect(b).toHaveLength(1);
    expect(b[0]!.seq).toBe(1);
    const verify = await h.asUser(A.memberId).execute<{ broken: number | null }>(sql`select audit_log_verify(${A.businessId}) as broken`);
    expect(verify[0]?.broken).toBeNull();
  });

  it("audit_log: member cannot update or delete (no privilege)", async () => {
    await expect(h.asUser(A.ownerId).run((tx) => tx.update(s.auditLog).set({ action: "x" }).where(eq(s.auditLog.businessId, A.businessId)))).rejects.toThrow(/permission denied/);
    await expect(h.asUser(A.ownerId).run((tx) => tx.delete(s.auditLog).where(eq(s.auditLog.businessId, A.businessId)))).rejects.toThrow(/permission denied/);
  });

  it("audit_log: service_role cannot update or delete either", async () => {
    await expect(h.service().run((tx) => tx.update(s.auditLog).set({ action: "x" }).where(eq(s.auditLog.businessId, A.businessId)))).rejects.toThrow(/permission denied|append-only/);
    await expect(h.service().run((tx) => tx.delete(s.auditLog).where(eq(s.auditLog.businessId, A.businessId)))).rejects.toThrow(/permission denied|append-only/);
  });

  it("audit_log: even the table owner is stopped by the append-only trigger", async () => {
    await expect(h.db.update(s.auditLog).set({ action: "x" }).where(eq(s.auditLog.businessId, A.businessId)).catch((e) => Promise.reject(unwrapDbError(e)))).rejects.toThrow(/append-only/);
    await expect(h.db.delete(s.auditLog).where(eq(s.auditLog.businessId, A.businessId)).catch((e) => Promise.reject(unwrapDbError(e)))).rejects.toThrow(/append-only/);
  });

  it("audit_log: tampering (trigger disabled by a superuser) is detected by audit_log_verify", async () => {
    await h.db.execute(sql`alter table audit_log disable trigger audit_log_immutable`);
    try {
      await h.db.update(s.auditLog).set({ details: { tampered: true } }).where(sql`${s.auditLog.businessId} = ${A.businessId} and ${s.auditLog.seq} = 2`);
    } finally {
      await h.db.execute(sql`alter table audit_log enable trigger audit_log_immutable`);
    }
    const verify = await h.service().execute<{ broken: number | string | null }>(sql`select audit_log_verify(${A.businessId}) as broken`);
    expect(Number(verify[0]?.broken)).toBe(2);
  });

  it("audit_log: member of A cannot read B's audit trail", async () => {
    const rows = await h.asUser(A.memberId).run((tx) => tx.select().from(s.auditLog).where(eq(s.auditLog.businessId, B.businessId)));
    expect(rows).toHaveLength(0);
    await expect(
      h.asUser(A.memberId).run((tx) => tx.insert(s.auditLog).values({ businessId: B.businessId, actorKind: "user", actorId: A.memberId, action: "sneak" })),
    ).rejects.toThrow(/row-level security/);
  });
});
