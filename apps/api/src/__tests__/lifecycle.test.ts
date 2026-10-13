import { repos } from "@foundmill/db";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DELETION_DELAY_DAYS, EXPORT_FORMAT, REAUTH_WINDOW_MS } from "../services/lifecycle";
import { createApiHarness, type ApiHarness } from "./harness";

describe("Settings › Danger zone (BUILD §11.15): export, deletion request, archive", () => {
  let hz: ApiHarness;
  beforeAll(async () => {
    hz = await createApiHarness({ prefix: "danger" });
  }, 120_000);
  afterAll(() => hz.close());

  it("business.export builds a portable archive through repositories, never credentials, and posts an Inbox note", async () => {
    const owner = hz.caller({ userId: hz.A.ownerId });
    const result = await owner.business.export({ businessId: hz.A.businessId });
    expect(result.format).toBe(EXPORT_FORMAT);
    expect(result.archive.business.id).toBe(hz.A.businessId);
    expect(result.counts.agents).toBeGreaterThanOrEqual(2);
    expect(result.counts.tasks).toBeGreaterThanOrEqual(2);
    expect(result.counts.entities).toBeGreaterThanOrEqual(2);
    expect(result.counts.inboxItems).toBeGreaterThanOrEqual(1);
    expect(result.counts.auditEntries).toBeGreaterThanOrEqual(0);
    expect(result.sizeBytes).toBeGreaterThan(1000);
    const text = JSON.stringify(result.archive);
    expect(Object.keys(result.archive)).not.toContain("credentials");
    expect(text).not.toMatch(/"(ciphertext|cipherText|cipher_text|accessToken|refreshToken|apiKey)"/);
    expect(result.archive.integrations.every((i) => !("credentialId" in (i as object)))).toBe(true);
    expect(result.archive.finance.accounts.every((a) => (a as { externalId?: string }).externalId === undefined)).toBe(true);
    expect(result.inboxItem?.subject).toBe("Your export is ready");
    expect(result.inboxItem?.type).toBe("update");
    const audit = await repos.audit.list(hz.db, hz.A.businessId, { action: "business.export" });
    expect(audit.items).toHaveLength(1);
    // Members cannot export; another business's owner cannot either.
    await expect(hz.caller({ userId: hz.A.memberId }).business.export({ businessId: hz.A.businessId })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(hz.caller({ userId: hz.B.ownerId }).business.export({ businessId: hz.A.businessId })).rejects.toMatchObject({ code: "FORBIDDEN" });
    // Nothing from B leaked into A's archive.
    expect(text).not.toContain(hz.B.businessId);
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
    expect(result.inboxItem?.type).toBe("warning");
    // US dates in the title, the Inbox subject and the body: "Oct 18, 2026", never "2026-10-18".
    const usDay = new Date(scheduled).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
    expect(result.copy.title).toBe(`Deletion scheduled for ${usDay}`);
    expect(result.inboxItem?.subject).toBe(`Deletion scheduled for ${usDay}`);
    expect(result.copy.body).toContain(`scheduled for deletion on ${usDay},`);
    // Until the deletion job exists the copy promises a recorded request, never a deletion that nothing performs yet.
    expect(result.copy.body).not.toMatch(/permanently/);
    for (const text of [result.copy.title, result.copy.body, result.inboxItem?.bodyMd ?? ""]) expect(text).not.toMatch(/\d{4}-\d{2}-\d{2}/);

    // Visible on business.get; a second request is idempotent; cancel clears it.
    const got = await owner.business.get({ businessId });
    expect(got.deletion?.status).toBe("scheduled");
    const again = await owner.business.requestDeletion({ businessId });
    expect(again.deletion.scheduledFor).toBe(result.deletion.scheduledFor);
    const cancelled = await owner.business.cancelDeletion({ businessId });
    expect(cancelled.status).toBe("cancelled");
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
});
