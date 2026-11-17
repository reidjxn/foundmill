/**
 * reports (0127; docs/NETWORK.md F21): service role only. The reporter, the person reported and a third account read
 * nothing and write nothing through the client roles; the repo files once per open target, never about oneself, names a
 * message only to someone in its thread and a profile only while it is public, and the queue shows a pattern.
 */
import { REPORT_REASONS, REPORT_RESOLUTIONS, REPORT_TARGET_KINDS } from "@foundmill/shared/reports";
import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Db } from "../../client";
import { repos } from "../../repos";
import * as s from "../../schema";
import { createTestDb, type TestHarness } from "../../testing/pglite";

let h: TestHarness;
let db: Db;
let ana: string;
let ben: string;
let cai: string;
let messageId: string;

const content = {
  headline: "Bakes bread",
  about: "",
  strengths: [],
  wantsToLearn: [],
  lookingFor: "on_my_own" as const,
  place: "",
};

beforeAll(async () => {
  h = await createTestDb();
  db = h.db as unknown as Db;
  ana = await h.createUser("ana@reports.test");
  ben = await h.createUser("ben@reports.test");
  cai = await h.createUser("cai@reports.test");
  for (const [id, name] of [
    [ana, "Ana"],
    [ben, "Ben"],
    [cai, "Cai"],
  ] as const)
    await repos.founders.upsert(db, id, { displayName: name });
  await repos.personProfiles.save(db, ben, { handle: "ben-bakes", content });
  await repos.personProfiles.publish(db, ben);
  const link = await repos.social.requestConnection(db, ben, ana);
  await repos.social.respondConnection(db, ana, link.id, "accepted");
  const thread = await repos.social.startThread(db, ben, [ana], null);
  messageId = (
    await repos.social.sendMessage(db, ben, thread.id, "Send me $200 and I will double it")
  ).id;
}, 120_000);
afterAll(() => h?.close());

describe("reports: the lists match the database's checks", () => {
  it("target kinds, reasons and resolutions", async () => {
    const checks = await h.db.execute(
      sql`select conname, pg_get_constraintdef(oid) as def from pg_constraint where conrelid = 'reports'::regclass and contype = 'c'`,
    );
    const def = (name: string) =>
      (checks.rows as { conname: string; def: string }[]).find((c) => c.conname === name)?.def ??
      "";
    for (const k of REPORT_TARGET_KINDS)
      expect(def("reports_target_kind_value")).toContain(`'${k}'`);
    for (const r of REPORT_REASONS) expect(def("reports_reason_value")).toContain(`'${r}'`);
    for (const r of REPORT_RESOLUTIONS) expect(def("reports_resolution_value")).toContain(`'${r}'`);
  });
});

describe("reports: service role only", () => {
  it("has RLS on and no policy", async () => {
    const t = await h.db.execute(
      sql`select relrowsecurity as on from pg_class where relname = 'reports'`,
    );
    expect((t.rows[0] as { on: boolean }).on).toBe(true);
    const p = await h.db.execute(
      sql`select count(*)::int as n from pg_policies where tablename = 'reports'`,
    );
    expect((p.rows[0] as { n: number }).n).toBe(0);
  });

  it("the reporter, the person reported, a third account and a visitor read nothing and write nothing", async () => {
    await repos.reports.file(db, {
      reporterUserId: ana,
      targetKind: "person",
      targetUserId: ben,
      reason: "spam",
    });
    for (const role of [
      () => h.anon(),
      () => h.asUser(ana),
      () => h.asUser(ben),
      () => h.asUser(cai),
    ]) {
      const read = await role()
        .run((tx) => tx.select().from(s.reports))
        .then(
          (rows) => rows.length,
          (err: Error) => (/permission denied/.test(err.message) ? 0 : Promise.reject(err)),
        );
      expect(read).toBe(0);
      await expect(
        role().run((tx) =>
          tx.insert(s.reports).values({
            reporterUserId: cai,
            targetKind: "person",
            targetUserId: ben,
            reason: "spam",
          }),
        ),
      ).rejects.toThrow(/permission denied/);
      await expect(role().run((tx) => tx.update(s.reports).set({ note: "x" }))).rejects.toThrow(
        /permission denied/,
      );
      await expect(role().run((tx) => tx.delete(s.reports))).rejects.toThrow(/permission denied/);
    }
    expect(
      (
        await h
          .service()
          .run((tx) => tx.select().from(s.reports).where(eq(s.reports.reporterUserId, ana)))
      ).length,
    ).toBe(1);
  });
});

describe("reports repo", () => {
  it("files once per open target, and never about oneself", async () => {
    expect(
      await repos.reports.file(db, {
        reporterUserId: ana,
        targetKind: "person",
        targetUserId: ben,
        reason: "harassment",
      }),
    ).toBeNull();
    expect(
      await repos.reports.file(db, {
        reporterUserId: ana,
        targetKind: "person",
        targetUserId: ana,
        reason: "spam",
      }),
    ).toBeNull();
    await expect(
      h.service().run((tx) =>
        tx.insert(s.reports).values({
          reporterUserId: ana,
          targetKind: "person",
          targetUserId: ana,
          reason: "spam",
        }),
      ),
    ).rejects.toThrow(/reports_not_self/);
  });

  it("resolves a profile only while it is public, and a message only for someone in its thread", async () => {
    expect(await repos.reports.profileOwner(db, "ben-bakes")).toBe(ben);
    expect(await repos.reports.profileOwner(db, "BEN-BAKES")).toBe(ben);
    expect(await repos.reports.profileOwner(db, "nobody-here")).toBeNull();
    expect(await repos.reports.messageAuthor(db, ana, messageId)).toEqual({
      authorId: ben,
      body: "Send me $200 and I will double it",
    });
    expect(await repos.reports.messageAuthor(db, cai, messageId)).toBeNull();
    expect(await repos.reports.messageAuthor(db, ben, messageId)).toBeNull();
    await repos.personProfiles.unpublish(db, ben);
    expect(await repos.reports.profileOwner(db, "ben-bakes")).toBeNull();
    await repos.personProfiles.publish(db, ben);
  });

  it("the queue lists open reports oldest first with names, the message as it reads and the pattern; resolve empties it", async () => {
    await repos.reports.file(db, {
      reporterUserId: ana,
      targetKind: "message",
      targetUserId: ben,
      targetMessageId: messageId,
      reason: "asks_for_money",
      note: "  He asked me for money  ",
      messageBody: "Send me $200 and I will double it",
    });
    await repos.reports.file(db, {
      reporterUserId: cai,
      targetKind: "profile",
      targetUserId: ben,
      reason: "impersonation",
    });
    const open = await repos.reports.listOpen(db);
    expect(open.map((r) => r.targetKind)).toEqual(["person", "message", "profile"]);
    expect(open[1]).toMatchObject({
      reporterName: "Ana",
      targetName: "Ben",
      targetHandle: "ben-bakes",
      messageBody: "Send me $200 and I will double it",
      note: "He asked me for money",
      openAboutPerson: 3,
    });
    expect(open[0]!.dueAt.getTime() - open[0]!.createdAt.getTime()).toBe(48 * 3_600_000);
    expect(await repos.reports.counts(db)).toEqual({ open: 3, overdue: 0 });
    expect(await repos.reports.counts(db, new Date(Date.now() + 49 * 3_600_000))).toEqual({
      open: 3,
      overdue: 3,
    });
    for (const r of open)
      expect(await repos.reports.resolve(db, r.id, cai, "no_action")).not.toBeNull();
    expect(await repos.reports.resolve(db, open[0]!.id, cai, "warned")).toBeNull();
    expect(await repos.reports.listOpen(db)).toEqual([]);
    // Once resolved, the same person may report the same thing again.
    expect(
      await repos.reports.file(db, {
        reporterUserId: ana,
        targetKind: "person",
        targetUserId: ben,
        reason: "spam",
      }),
    ).not.toBeNull();
  });

  it("a deleted reporter takes their reports; a deleted target leaves the report with nobody named", async () => {
    const dee = await h.createUser("dee@reports.test");
    await repos.reports.file(db, {
      reporterUserId: dee,
      targetKind: "person",
      targetUserId: cai,
      reason: "spam",
    });
    await repos.reports.file(db, {
      reporterUserId: cai,
      targetKind: "person",
      targetUserId: dee,
      reason: "spam",
    });
    await h.db.execute(sql`delete from auth.users where id = ${dee}`);
    const rows = await h
      .service()
      .run((tx) => tx.select().from(s.reports).where(eq(s.reports.reporterUserId, cai)));
    expect(rows.filter((r) => r.targetUserId === null)).toHaveLength(1);
    expect(
      (
        await h
          .service()
          .run((tx) => tx.select().from(s.reports).where(eq(s.reports.targetUserId, cai)))
      ).length,
    ).toBe(0);
  });

  it("a deleted message keeps its report and its words, and never blocks the thread's deletion or the author's", async () => {
    // Eve and Fay talk; Fay reports two of Eve's messages; Fay leaves; Eve, the last one in, leaves (the thread goes).
    const eve = await h.createUser("eve@reports.test");
    const fay = await h.createUser("fay@reports.test");
    const link = await repos.social.requestConnection(db, eve, fay);
    await repos.social.respondConnection(db, fay, link.id, "accepted");
    const thread = await repos.social.startThread(db, eve, [fay], null);
    for (const body of ["First", "Second"]) {
      const m = await repos.social.sendMessage(db, eve, thread.id, body);
      expect(
        await repos.reports.file(db, {
          reporterUserId: fay,
          targetKind: "message",
          targetUserId: eve,
          targetMessageId: m.id,
          reason: "harassment",
          messageBody: body,
        }),
      ).not.toBeNull();
    }
    await repos.social.leaveThread(db, fay, thread.id);
    await repos.social.leaveThread(db, eve, thread.id);
    const kept = await h
      .service()
      .run((tx) => tx.select().from(s.reports).where(eq(s.reports.reporterUserId, fay)));
    expect(kept.map((r) => [r.targetMessageId, r.messageBody]).sort()).toEqual([
      [null, "First"],
      [null, "Second"],
    ]);
    // Two more reported messages from the same author, then the author's account goes.
    const t2 = await repos.social.startThread(db, fay, [eve], null).catch(() => null);
    if (t2) {
      for (const body of ["Third", "Fourth"]) {
        const m = await repos.social.sendMessage(db, eve, t2.id, body);
        await repos.reports.file(db, {
          reporterUserId: fay,
          targetKind: "message",
          targetUserId: eve,
          targetMessageId: m.id,
          reason: "spam",
          messageBody: body,
        });
      }
    }
    await h.db.execute(sql`delete from auth.users where id = ${eve}`);
    const after = await h
      .service()
      .run((tx) => tx.select().from(s.reports).where(eq(s.reports.reporterUserId, fay)));
    expect(after.every((r) => r.targetUserId === null && r.targetMessageId === null)).toBe(true);
    expect(after.length).toBe(t2 ? 4 : 2);
  });
});
