/**
 * Gmail and Google Calendar as context (founder, Nov 19, 2026): a founder of the project turns agents' reads of their own
 * mail and calendar on or off; it needs the integration connected; a collaborator and another project cannot change it.
 */
import { repos } from "@foundmill/db";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApiHarness, type ApiHarness } from "./harness";

let hz: ApiHarness;
beforeAll(async () => {
  hz = await createApiHarness({ prefix: "ctxreads" });
}, 120_000);
afterAll(() => hz.close());

describe("integrations.setContextReads", () => {
  it("needs the integration connected", async () => {
    await expect(hz.caller({ userId: hz.A.ownerId }).integrations.setContextReads({ businessId: hz.A.businessId, connectorKey: "google_calendar", on: true })).rejects.toThrow(/connect Google Calendar first/);
  });

  it("a founder turns it on and off; the orchestrator's read follows; the change is audited", async () => {
    const businessId = hz.A.businessId;
    await repos.integrations.upsert(hz.db, businessId, { connectorKey: "gmail", status: "connected", authKind: "oauth", scopes: ["https://www.googleapis.com/auth/gmail.compose"], connectedBy: hz.A.ownerId });
    const owner = hz.caller({ userId: hz.A.ownerId });
    expect((await repos.integrations.contextReads(hz.db, businessId)).gmail).toEqual({ on: false, scopes: ["https://www.googleapis.com/auth/gmail.compose"] });
    await owner.integrations.setContextReads({ businessId, connectorKey: "gmail", on: true });
    expect((await repos.integrations.contextReads(hz.db, businessId)).gmail.on).toBe(true);
    expect((await repos.integrations.contextReads(hz.db, businessId)).googleCalendar.on).toBe(false);
    await owner.integrations.setContextReads({ businessId, connectorKey: "gmail", on: false });
    expect((await repos.integrations.contextReads(hz.db, businessId)).gmail.on).toBe(false);
    const rows = (await repos.audit.list(hz.db, businessId, { action: "integrations.context_reads" })).items;
    expect(rows.map((r) => (r.details as { on: boolean }).on)).toEqual(expect.arrayContaining([true, false]));
  });

  it("a founder cannot turn on reads of an account someone else connected, but can turn them off; a disconnect ends them", async () => {
    const businessId = hz.A.businessId;
    const owner = hz.caller({ userId: hz.A.ownerId });
    await repos.integrations.upsert(hz.db, businessId, { connectorKey: "google_calendar", status: "connected", authKind: "oauth", connectedBy: hz.A.memberId, settings: { contextReads: true } });
    await expect(owner.integrations.setContextReads({ businessId, connectorKey: "google_calendar", on: true })).rejects.toThrow(/Only the person who connected/);
    await owner.integrations.setContextReads({ businessId, connectorKey: "google_calendar", on: false });
    expect((await repos.integrations.contextReads(hz.db, businessId)).googleCalendar.on).toBe(false);
    await owner.integrations.setContextReads({ businessId, connectorKey: "gmail", on: true });
    const gmail = (await repos.integrations.getByKey(hz.db, businessId, "gmail"))!;
    await repos.integrations.disconnect(hz.db, businessId, gmail.id);
    expect((await repos.integrations.getByKey(hz.db, businessId, "gmail"))!.settings).not.toHaveProperty("contextReads");
  });

  it("a collaborator and another project's founder cannot change it", async () => {
    const businessId = hz.A.businessId;
    await expect(hz.caller({ userId: hz.A.memberId }).integrations.setContextReads({ businessId, connectorKey: "gmail", on: true })).rejects.toThrow();
    await expect(hz.caller({ userId: hz.B.ownerId }).integrations.setContextReads({ businessId, connectorKey: "gmail", on: true })).rejects.toThrow();
    expect((await repos.integrations.contextReads(hz.db, businessId)).gmail.on).toBe(false);
  });
});
