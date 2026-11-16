/**
 * dev.tasks.count (WP-10 T12, audit A2-16): the reading pane's "Tasks running" tile asks for one number instead of 500
 * tasks. Same `read` guard and RLS as dev.tasks.list; another business's member is refused.
 */
import { repos } from "@foundmill/db";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApiHarness, type ApiHarness } from "./harness";

let hz: ApiHarness;
beforeAll(async () => {
  hz = await createApiHarness({ prefix: "dev-tasks-count" });
}, 120_000);
afterAll(() => hz.close());

describe("dev.tasks.count", () => {
  it("counts the business's tasks in one status", async () => {
    const owner = hz.caller({ userId: hz.A.ownerId });
    const before = (await owner.dev.tasks.count({ businessId: hz.A.businessId, status: "running" })).count;
    await repos.tasks.create(hz.db, hz.A.businessId, { kind: "code", title: "Count me", status: "running" });
    await repos.tasks.create(hz.db, hz.A.businessId, { kind: "code", title: "Not me", status: "ready" });
    expect(await owner.dev.tasks.count({ businessId: hz.A.businessId, status: "running" })).toEqual({ count: before + 1 });
  });

  it("refuses another business's member", async () => {
    await expect(hz.caller({ userId: hz.B.ownerId }).dev.tasks.count({ businessId: hz.A.businessId, status: "running" })).rejects.toThrow();
  });
});
