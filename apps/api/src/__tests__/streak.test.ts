/** today.streak (retention plan, founder 2026-11-11): the founder's own days in a row in this business. */
import { repos } from "@foundmill/db";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApiHarness, type ApiHarness } from "./harness";

let hz: ApiHarness;
beforeAll(async () => {
  hz = await createApiHarness({ prefix: "streak" });
}, 120_000);
afterAll(() => hz.close());

const DAY = 86_400_000;

describe("today.streak", () => {
  it("counts the caller's own days in a row, ending today, and nobody else's", async () => {
    const now = Date.now();
    for (const ago of [2, 1]) await repos.presence.ping(hz.db, hz.A.businessId, hz.A.ownerId, { now: new Date(now - ago * DAY) });
    const owner = hz.caller({ userId: hz.A.ownerId });
    expect(await owner.today.streak({ businessId: hz.A.businessId })).toMatchObject({ current: 2, visitedToday: false, atRisk: true });
    await owner.founder.presence.ping({ businessId: hz.A.businessId });
    expect(await owner.today.streak({ businessId: hz.A.businessId })).toMatchObject({ current: 3, visitedToday: true, atRisk: false, milestone: 3 });
    // A member's streak is their own.
    expect(await hz.caller({ userId: hz.A.memberId }).today.streak({ businessId: hz.A.businessId })).toMatchObject({ current: 0, best: 0 });
  });
});
