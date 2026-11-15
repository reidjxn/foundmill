/**
 * Founder titles without the composer (0070): when the service is away, the api writes the deterministic rewrite of
 * @foundmill/shared for the open tasks it can title and leaves the rest alone; `dev.tasks.list` and `dev.prs.list` carry
 * the founder title for the screens; the Inbox's approval note names the task by it.
 */
import { repos } from "@foundmill/db";
import { approvalTaskTitle } from "@foundmill/db";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { founderTitlesLocally } from "../services/composer";
import { createApiHarness, type ApiHarness } from "./harness";

let hz: ApiHarness;
beforeAll(async () => {
  hz = await createApiHarness({ prefix: "founder-titles" });
}, 120_000);
afterAll(() => hz.close());

describe("founder titles (0070)", () => {
  it("the deterministic rewrite titles what it can, skips what it cannot, and the lists carry the result", async () => {
    const display = await repos.tasks.create(hz.db, hz.A.businessId, { kind: "code", title: "Fix hydration mismatch in /checkout", goalMd: "The checkout page shows stale prices.", status: "review" });
    const stubborn = await repos.tasks.create(hz.db, hz.A.businessId, { kind: "code", title: "Rebase agent/a5444581-1234-4abc-8def-123456789abc onto main and resolve merge conflicts", goalMd: "Rebase onto main and fix the merge conflicts.", status: "ready" });
    const written = await founderTitlesLocally(hz.db, hz.A.businessId, [display.id, stubborn.id]);
    expect(written).toBe(1);
    expect((await repos.tasks.get(hz.db, hz.A.businessId, display.id)).founderTitle).toBe("Fix a display bug in the checkout page");
    expect((await repos.tasks.get(hz.db, hz.A.businessId, stubborn.id)).founderTitle).toBeNull();
    // A second pass writes nothing new.
    expect(await founderTitlesLocally(hz.db, hz.A.businessId, [display.id, stubborn.id])).toBe(0);

    const owner = hz.caller({ userId: hz.A.ownerId });
    const listed = await owner.dev.tasks.list({ businessId: hz.A.businessId, status: ["review"], limit: 100 });
    expect(listed.items.find((t) => t.id === display.id)).toMatchObject({ title: "Fix hydration mismatch in /checkout", founderTitle: "Fix a display bug in the checkout page" });
    const prs = await owner.dev.prs.list({ businessId: hz.A.businessId });
    expect(prs.open.find((p) => p.taskId === display.id)).toMatchObject({ founderTitle: "Fix a display bug in the checkout page" });
  });

  it("a merged change carries its task's founder title and agent, for the founder's What changed list", async () => {
    const owner = hz.caller({ userId: hz.A.ownerId });
    const done = await repos.tasks.create(hz.db, hz.A.businessId, { kind: "code", title: "Merge the pricing page fix", status: "done" });
    await repos.tasks.update(hz.db, hz.A.businessId, done.id, { founderTitle: "Fix the pricing page" });
    const prs = await owner.dev.prs.list({ businessId: hz.A.businessId });
    expect(prs.merged.find((m) => m.taskId === done.id)).toMatchObject({ title: "Merge the pricing page fix", founderTitle: "Fix the pricing page", source: "merge_queue" });
  });

  it("the approval note names the task in the founder's words once there are any", async () => {
    const task = await repos.tasks.create(hz.db, hz.A.businessId, { kind: "code", title: "Open a PR for the usage export", status: "review" });
    expect(await approvalTaskTitle(hz.db, hz.A.businessId, { taskId: task.id })).toBe("Open a PR for the usage export");
    await repos.tasks.update(hz.db, hz.A.businessId, task.id, { founderTitle: "Put the usage export live" });
    expect(await approvalTaskTitle(hz.db, hz.A.businessId, { taskId: task.id })).toBe("Put the usage export live");
    expect(await approvalTaskTitle(hz.db, hz.A.businessId, { taskId: null })).toBeNull();
  });
});
