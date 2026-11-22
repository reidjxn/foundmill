/**
 * The hosted browser's write steps (0162; founder, Nov 22, 2026): a step is recorded with its screenshot, the lists
 * leave the bytes out, and another business reads none of them.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { repos } from "../../repos";
import { createTestDb, type TestHarness } from "../../testing/pglite";
import { createBusinessFixture, type BusinessFixture } from "../rls/fixtures";

let h: TestHarness;
let A: BusinessFixture;
let B: BusinessFixture;
const SESSION = crypto.randomUUID();
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]);
const step = (over: Record<string, unknown> = {}) => ({ sessionId: SESSION, siteKey: "shop.example", tool: "browser_click", target: "Publish button", class: "outward" as const, why: "Publish the listing.", url: "https://shop.example/listing/1", ...over });

beforeAll(async () => {
  h = await createTestDb();
  A = await createBusinessFixture(h, "steps-a");
  B = await createBusinessFixture(h, "steps-b");
});
afterAll(async () => h.close());

describe("browser steps", () => {
  it("records a step and gets it back with its screenshot", async () => {
    const { id } = await repos.browserSteps.record(h.db, A.businessId, step({ agentId: A.agentId, amount: "$12.00", screenshot: PNG }));
    const row = await repos.browserSteps.get(h.db, A.businessId, id);
    expect(row).toMatchObject({ id, businessId: A.businessId, class: "outward", amount: "$12.00", simulated: false });
    expect(Array.from(row!.screenshot!)).toEqual(Array.from(PNG));
  });

  it("lists a session oldest first without the bytes, and the recent steps newest first", async () => {
    await repos.browserSteps.record(h.db, A.businessId, step({ target: "Save button", class: "reversible", simulated: true }));
    const session = await repos.browserSteps.listForSession(h.db, A.businessId, SESSION);
    expect(session.map((r) => [r.target, r.hasScreenshot])).toEqual([["Publish button", true], ["Save button", false]]);
    expect(session[0]).not.toHaveProperty("screenshot");
    const recent = await repos.browserSteps.listRecent(h.db, A.businessId, { siteKey: "shop.example", limit: 10 });
    expect(recent.map((r) => r.target)).toEqual(["Save button", "Publish button"]);
    expect(await repos.browserSteps.listRecent(h.db, A.businessId, { siteKey: "other.example", limit: 10 })).toEqual([]);
  });

  it("another business reads none of them, by id or through RLS", async () => {
    const { id } = await repos.browserSteps.record(h.db, A.businessId, step({ screenshot: PNG }));
    expect(await repos.browserSteps.get(h.db, B.businessId, id)).toBeNull();
    expect(await repos.browserSteps.listForSession(h.db, B.businessId, SESSION)).toEqual([]);
    expect(await h.asUser(B.ownerId).run((tx) => repos.browserSteps.get(tx, A.businessId, id))).toBeNull();
    expect(await h.asUser(B.ownerId).run((tx) => repos.browserSteps.listRecent(tx, A.businessId, { limit: 10 }))).toEqual([]);
    expect(await h.asUser(A.memberId).run((tx) => repos.browserSteps.get(tx, A.businessId, id))).not.toBeNull();
    await expect(h.asUser(A.ownerId).run((tx) => repos.browserSteps.record(tx, A.businessId, step()))).rejects.toThrow();
  });
});
