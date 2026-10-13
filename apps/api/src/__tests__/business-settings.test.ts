/**
 * Settings › Business saves (audit RES-07, RUI-08): a save changes only what it sends; a stale form that changes a field
 * someone else changed since is refused (CONFLICT) instead of silently writing the old value back; and every save
 * emits `business.updated`, so other open tabs refetch the business.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { repos } from "@foundmill/db";
import { staleBusinessFields } from "../routers/business";
import { createApiHarness, type ApiHarness } from "./harness";

describe("business.update", () => {
  let hz: ApiHarness;
  beforeAll(async () => {
    hz = await createApiHarness({ prefix: "bizset" });
  }, 120_000);
  afterAll(() => hz.close());

  it("names only the fields that changed under the form", () => {
    const current = { name: "Renamed", slug: "s", archetype: null, kitPrimary: "#3366ff", kitSecondary: "#000000" };
    expect(staleBusinessFields(current, { name: "Original" })).toEqual(["name"]);
    expect(staleBusinessFields(current, { kitPrimary: "#3366ff" })).toEqual([]);
    expect(staleBusinessFields(current, { archetype: null })).toEqual([]);
  });

  it("a color-only save from a stale tab keeps the rename made elsewhere", async () => {
    const owner = hz.caller({ userId: hz.A.ownerId });
    const { businessId } = hz.A;
    const before = (await owner.business.get({ businessId })).business;
    // Tab A renames.
    await owner.business.update({ businessId, name: "Renamed Elsewhere", expected: { name: before.name } });
    // Tab B, opened before the rename, changes only the primary brand color: only that field travels.
    await owner.business.update({ businessId, kitPrimary: "#0f766e", expected: { kitPrimary: before.kitPrimary } });
    const after = (await owner.business.get({ businessId })).business;
    expect(after.name).toBe("Renamed Elsewhere");
    expect(after.kitPrimary).toBe("#0f766e");
  });

  it("refuses a stale save of a field someone else changed, and tells which", async () => {
    const owner = hz.caller({ userId: hz.A.ownerId });
    const { businessId } = hz.A;
    const seen = (await owner.business.get({ businessId })).business.name;
    await owner.business.update({ businessId, name: "Co-founder's name", expected: { name: seen } });
    await expect(owner.business.update({ businessId, name: "Stale tab's name", expected: { name: seen } })).rejects.toMatchObject({ code: "CONFLICT", message: expect.stringContaining("the name") });
    expect((await owner.business.get({ businessId })).business.name).toBe("Co-founder's name");
  });

  it("tells every open tab: business.updated names the changed fields", async () => {
    const owner = hz.caller({ userId: hz.A.ownerId });
    const { businessId } = hz.A;
    await owner.business.update({ businessId, kitSecondary: "#112233" });
    const events = await repos.events.list(hz.db, businessId, { type: "business.updated", limit: 10 });
    expect(events.items[0]?.payload).toEqual({ fields: ["kitSecondary"] });
  });
});
