import { EXPORT_TABLES, repos, transactions } from "@foundmill/db";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DELETION_DELAY_DAYS, EXPORT_FORMAT, REAUTH_WINDOW_MS, exportFileName } from "../services/lifecycle";
import { createApiHarness, type ApiHarness } from "./harness";

describe("Settings › Danger zone (BUILD §11.15): export, deletion request, archive, restore", () => {
  let hz: ApiHarness;
  beforeAll(async () => {
    hz = await createApiHarness({ prefix: "danger" });
  }, 120_000);
  afterAll(() => hz.close());

  it("business.export returns every exported table as a file-ready archive, never credentials, and posts an Inbox note", async () => {
    const owner = hz.caller({ userId: hz.A.ownerId });
    const result = await owner.business.export({ businessId: hz.A.businessId });
    expect(result.format).toBe(EXPORT_FORMAT);
    expect(result.complete).toBe(true);
    expect(result.archive.truncated).toEqual([]);
    expect(result.fileName).toMatch(/^danger-a[a-z0-9-]*-export-\d{4}-\d{2}-\d{2}\.json$/);
    expect(result.archive.business.id).toBe(hz.A.businessId);
    expect(typeof result.archive.business.createdAt).toBe("string"); // JSON-safe: what the browser saves is what it got
    // Every exported table is in the archive, including the ones the first export left out.
    expect(Object.keys(result.archive.tables).sort()).toEqual(Object.keys(EXPORT_TABLES).sort());
    for (const name of ["agent_threads", "business_foundations", "plans", "plan_actions", "approvals", "sources", "usage_ledger", "playbooks", "visitors", "conversions"]) expect(result.archive.tables[name], name).toBeDefined();
    expect(result.counts.agents).toBeGreaterThanOrEqual(2);
    expect(result.counts.tasks).toBeGreaterThanOrEqual(2);
    expect(result.counts.entities).toBeGreaterThanOrEqual(2);
    expect(result.counts.agent_threads).toBeGreaterThanOrEqual(1);
    expect(result.counts.plans).toBeGreaterThanOrEqual(1);
    expect(result.counts.playbooks).toBeGreaterThanOrEqual(1);
    expect(result.totalRows).toBe(Object.values(result.counts).reduce((n, c) => n + c, 0));
    expect(result.sizeBytes).toBeGreaterThan(1000);
    const text = JSON.stringify(result.archive);
    expect(result.sizeBytes).toBe(Buffer.byteLength(text, "utf8"));
    expect(Object.keys(result.archive.tables)).not.toContain("credentials");
    expect(text).not.toMatch(/"(ciphertext|cipherText|cipher_text|dataKeyCiphertext|accessToken|refreshToken|apiKey|secretRef)"/);
    expect(result.archive.tables.integrations!.every((i) => !("credentialId" in i) && !("settings" in i))).toBe(true);
    expect(result.archive.tables.accounts!.every((a) => !("externalId" in a))).toBe(true);
    expect(result.archive.excluded.map((e) => e.what)).toContain("credentials");
    // The Inbox note names the file and promises nothing that does not exist.
    expect(result.inboxItem?.subject).toBe("Your export is ready");
    expect(result.inboxItem?.type).toBe("update");
    expect(result.inboxItem?.bodyMd).toContain(result.fileName);
    expect(result.inboxItem?.bodyMd).not.toMatch(/Download it from/);
    const audit = await repos.audit.list(hz.db, hz.A.businessId, { action: "business.export" });
    expect(audit.items).toHaveLength(1);
    // Members cannot export; another business's owner cannot either.
    await expect(hz.caller({ userId: hz.A.memberId }).business.export({ businessId: hz.A.businessId })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(hz.caller({ userId: hz.B.ownerId }).business.export({ businessId: hz.A.businessId })).rejects.toMatchObject({ code: "FORBIDDEN" });
    // Nothing from B leaked into A's archive.
    expect(text).not.toContain(hz.B.businessId);
  });

  it("the owner's export holds every row the business has in each exported table: row security hides nothing", async () => {
    const { businessId } = hz.A;
    // Counted as the service (no row security) before the export writes its own audit row and Inbox note.
    const stored: Record<string, number> = {};
    for (const name of Object.keys(EXPORT_TABLES)) {
      const res = (await hz.db.execute(sql`select count(*)::int as n from ${sql.identifier(name)} where business_id = ${businessId}::uuid`)) as unknown as { rows: { n: number }[] };
      stored[name] = Number(res.rows[0]!.n);
    }
    const result = await hz.caller({ userId: hz.A.ownerId }).business.export({ businessId });
    expect(result.counts).toEqual(stored);
    expect(Object.values(stored).filter((n) => n > 0).length).toBeGreaterThan(20);
  });

  it("business.export reads past the old 5,000-row stop: every transaction is in the file", async () => {
    const { businessId, accountId } = hz.A;
    const rows = Array.from({ length: 5_050 }, (_, i) => ({ businessId, accountId, externalId: `bulk-${i}`, bookedAt: new Date(Date.UTC(2025, 0, 1) + i * 60_000), amountMinor: -(i + 1), description: `Row ${i}` }));
    await hz.db.insert(transactions).values(rows);
    const result = await hz.caller({ userId: hz.A.ownerId }).business.export({ businessId });
    expect(result.counts.transactions).toBeGreaterThanOrEqual(5_050);
    expect(new Set(result.archive.tables.transactions!.map((t) => t.id)).size).toBe(result.counts.transactions);
    expect(result.complete).toBe(true);
    expect(result.inboxItem?.bodyMd).toMatch(/Bank transactions: 5,0\d\d/);
  });

  it("business.export is refused to a member walled off a section, and leaves out billing for a billing wall", async () => {
    const { businessId, adminId } = hz.A;
    await repos.memberships.setSectionPermissions(hz.db, businessId, adminId, { finance: "none" });
    await expect(hz.caller({ userId: adminId }).business.export({ businessId })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await repos.memberships.setSectionPermissions(hz.db, businessId, adminId, { billing: "none" });
    const result = await hz.caller({ userId: adminId }).business.export({ businessId });
    expect(result.archive.tables.usage_ledger).toBeUndefined();
    expect(result.archive.tables.transactions).toBeDefined();
    expect(result.archive.tables.tasks).toBeDefined();
    expect(result.archive.excluded.map((e) => e.what)).toContain("The billing section");
    expect(result.inboxItem?.bodyMd).toContain("Left out because your role has no access: billing");
    await repos.memberships.setSectionPermissions(hz.db, businessId, adminId, {});
  });

  it("exportFileName is the slug and the UTC day", () => {
    expect(exportFileName({ slug: "ledgerly-3f2a1c", name: "Ledgerly" }, "2026-10-12T23:59:00.000Z")).toBe("ledgerly-3f2a1c-export-2026-10-12.json");
    expect(exportFileName({ slug: "", name: "Café & Co." }, "2026-10-12T00:00:00.000Z")).toBe("caf-co-export-2026-10-12.json");
  });

  it("business.requestDeletion is owner-only, needs a fresh authentication and schedules the 7-day delay", async () => {
    const { businessId } = hz.A;
    // Admins cannot; a stale authentication is refused with the re-auth flag.
    await expect(hz.caller({ userId: hz.A.adminId }).business.requestDeletion({ businessId })).rejects.toMatchObject({ code: "FORBIDDEN" });
    const stale = hz.caller({ userId: hz.A.ownerId, authenticatedAt: new Date(Date.now() - REAUTH_WINDOW_MS - 60_000) });
    await expect(stale.business.requestDeletion({ businessId })).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    expect((await stale.business.deletionStatus({ businessId })).status).toBe("none");

    const owner = hz.caller({ userId: hz.A.ownerId });
    await expect(owner.business.requestDeletion({ businessId, confirmName: "wrong name" })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    const before = Date.now();
    const result = await owner.business.requestDeletion({ businessId });
    expect(result.deletion.status).toBe("scheduled");
    expect(result.deletion.delayDays).toBe(DELETION_DELAY_DAYS);
    const scheduled = Date.parse(result.deletion.scheduledFor!);
    expect(scheduled - before).toBeGreaterThanOrEqual(DELETION_DELAY_DAYS * 86_400_000 - 5_000);
    expect(scheduled - before).toBeLessThanOrEqual(DELETION_DELAY_DAYS * 86_400_000 + 60_000);
    expect(result.reauth).toMatchObject({ required: true, satisfied: true });
    expect(result.copy.body).toContain("7 days");
    expect(result.copy.body).toContain("cancel");
    expect(result.copy.title).toMatch(/^Deletion scheduled for [A-Z][a-z]{2} \d{1,2}, \d{4}$/); // US date
    expect(result.inboxItem?.type).toBe("warning");
    // US dates in the title, the Inbox subject and the body: "Oct 18, 2026", never "2026-10-18".
    const usDay = new Date(scheduled).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
    expect(result.copy.title).toBe(`Deletion scheduled for ${usDay}`);
    expect(result.inboxItem?.subject).toBe(`Deletion scheduled for ${usDay}`);
    expect(result.copy.body).toContain(`deleted on ${usDay},`);
    for (const text of [result.copy.title, result.copy.body, result.inboxItem?.bodyMd ?? ""]) expect(text).not.toMatch(/\d{4}-\d{2}-\d{2}/);

    // Visible on business.get; a second request is idempotent; cancel clears it.
    const got = await owner.business.get({ businessId });
    expect(got.deletion?.status).toBe("scheduled");
    const again = await owner.business.requestDeletion({ businessId });
    expect(again.deletion.scheduledFor).toBe(result.deletion.scheduledFor);
    const cancelled = await owner.business.cancelDeletion({ businessId });
    expect(cancelled.status).toBe("cancelled");
    // The Inbox no longer announces a deletion that will not happen: the warning is settled and a note says so.
    expect((await repos.inbox.get(hz.db, businessId, result.inboxItem!.id)).state).toBe("archived");
    const note = (await repos.inbox.list(hz.db, businessId, { limit: 50 })).items.find((i) => i.subject === "Deletion canceled");
    expect(note).toMatchObject({ type: "update", state: "unread" });
    expect(note?.bodyMd).toContain("was canceled");
    // Cancelling again is idempotent: no second note.
    await owner.business.cancelDeletion({ businessId });
    expect((await repos.inbox.list(hz.db, businessId, { limit: 50 })).items.filter((i) => i.subject === "Deletion canceled")).toHaveLength(1);
    expect((await owner.business.get({ businessId })).deletion).toBeNull();
    const audit = await repos.audit.list(hz.db, businessId, { action: ["business.request_deletion", "business.cancel_deletion"] });
    expect(audit.items.map((a) => a.action)).toEqual(["business.cancel_deletion", "business.request_deletion"]);
    expect(await repos.businesses.get(hz.db, businessId)).toBeTruthy();
  });

  it("business.archive stops every agent, hides the business and is audited; the business stays in the database", async () => {
    const { businessId } = hz.B;
    await expect(hz.caller({ userId: hz.B.memberId }).business.archive({ businessId })).rejects.toMatchObject({ code: "FORBIDDEN" });
    const admin = hz.caller({ userId: hz.B.adminId });
    const result = await admin.business.archive({ businessId });
    expect(result.business.archivedAt).not.toBeNull();
    expect(result.stopped.pausedAgents).toBeGreaterThanOrEqual(1);
    const agents = await repos.agents.list(hz.db, businessId, { limit: 50 });
    expect(agents.items.every((a) => a.status === "paused")).toBe(true);
    await expect(admin.business.get({ businessId })).rejects.toMatchObject({ code: "NOT_FOUND" });
    const row = await repos.businesses.get(hz.db, businessId, { includeArchived: true });
    expect(row.id).toBe(businessId);
    const audit = await repos.audit.list(hz.db, businessId, { action: "business.archive" });
    expect(audit.items).toHaveLength(1);
    // A is untouched.
    expect((await repos.businesses.get(hz.db, hz.A.businessId)).archivedAt).toBeNull();
  });

  it("an archived business can still be found by its owner, exported, scheduled for deletion and restored", async () => {
    const { businessId } = hz.B;
    const owner = hz.caller({ userId: hz.B.ownerId });
    // Listed for its owner only, with any scheduled deletion.
    const listed = await owner.business.listArchived();
    expect(listed.map((a) => a.business.id)).toEqual([businessId]);
    expect(listed[0]!.deletion).toBeNull();
    expect(await hz.caller({ userId: hz.B.adminId }).business.listArchived()).toEqual([]);
    expect(await hz.caller({ userId: hz.A.ownerId }).business.listArchived()).toEqual([]);

    // Export still works on the archived business.
    const exported = await owner.business.export({ businessId });
    expect(exported.archive.business.id).toBe(businessId);
    expect(exported.archive.business.archivedAt).toEqual(expect.any(String));
    expect(exported.counts.tasks).toBeGreaterThanOrEqual(2);

    // Deletion can be scheduled and canceled while archived; the copy says where to cancel.
    const scheduled = await owner.business.requestDeletion({ businessId });
    expect(scheduled.deletion.status).toBe("scheduled");
    expect(scheduled.copy.body).toContain("Archived businesses");
    expect((await owner.business.listArchived())[0]!.deletion?.status).toBe("scheduled");
    expect((await owner.business.cancelDeletion({ businessId })).status).toBe("cancelled");

    // Everything else still answers NOT_FOUND; only the owner restores.
    await expect(owner.business.update({ businessId, name: "Renamed" })).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(hz.caller({ userId: hz.B.adminId }).business.restore({ businessId })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(hz.caller({ userId: hz.B.memberId }).business.restore({ businessId })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(hz.caller({ userId: hz.A.ownerId }).business.restore({ businessId })).rejects.toMatchObject({ code: "FORBIDDEN" });
    const restored = await owner.business.restore({ businessId });
    expect(restored.restored).toBe(true);
    expect(restored.business.archivedAt).toBeNull();
    expect((await owner.business.get({ businessId })).business.id).toBe(businessId);
    expect(await owner.business.listArchived()).toEqual([]);
    // Agents stay stopped until the founder resumes them; a second restore changes nothing.
    expect((await repos.agents.list(hz.db, businessId, { limit: 50 })).items.every((a) => a.status === "paused")).toBe(true);
    expect((await owner.business.restore({ businessId })).restored).toBe(false);
    expect((await repos.audit.list(hz.db, businessId, { action: "business.restore" })).items).toHaveLength(1);
  });
});
