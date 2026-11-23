/**
 * Founder-executed requests (0169; founder, Nov 22, 2026): one open request per payload, the hash is computed here and
 * never taken from a caller, and `claim` lets exactly one press through.
 */
import { founderActionPayloadHash } from "@foundmill/shared";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { repos } from "../../repos";
import { createTestDb, type TestHarness } from "../../testing/pglite";
import { createBusinessFixture, type BusinessFixture } from "../rls/fixtures";

let h: TestHarness;
let A: BusinessFixture;
let B: BusinessFixture;
const NOW = new Date("2026-11-22T12:00:00Z");
const input = (inv: string) => ({ connectorKey: "lightbringer_mcp", tool: "request_patent_preparation", payload: { invention_id: inv }, summary: { title: "Ask Lightbringer to prepare your patent filing", lines: ["Self-leveling bike rack hinge"], facts: { title: "Self-leveling bike rack hinge" } } });
const press = { tokenHash: "a".repeat(64), expiresAt: new Date(NOW.getTime() + 120_000), pressedBy: "00000000-0000-4000-8000-000000000001", now: NOW };

beforeAll(async () => {
  h = await createTestDb();
  A = await createBusinessFixture(h, "fa-a");
  B = await createBusinessFixture(h, "fa-b");
});
afterAll(async () => h.close());

describe("preparing a founder action", () => {
  it("stores the exact payload with its own hash, and an identical open request is returned, not repeated", async () => {
    const first = await repos.founderActions.prepare(h.db, A.businessId, input("inv_1"));
    expect(first.created).toBe(true);
    expect(first.action.payloadHash).toBe(founderActionPayloadHash({ invention_id: "inv_1" }));
    expect(first.action.status).toBe("prepared");
    const again = await repos.founderActions.prepare(h.db, A.businessId, input("inv_1"));
    expect(again).toMatchObject({ created: false, action: { id: first.action.id } });
    expect((await repos.founderActions.prepare(h.db, A.businessId, input("inv_2"))).created).toBe(true);
    // Another project's identical payload is its own request.
    expect((await repos.founderActions.prepare(h.db, B.businessId, input("inv_1"))).action.id).not.toBe(first.action.id);
  });

  it("a request is read only inside its own project", async () => {
    const { action } = await repos.founderActions.prepare(h.db, A.businessId, input("inv_scope"));
    expect(await repos.founderActions.get(h.db, B.businessId, action.id)).toBeNull();
    expect(await repos.founderActions.claim(h.db, B.businessId, action.id, press)).toBeNull();
    expect((await repos.founderActions.get(h.db, A.businessId, action.id))?.status).toBe("prepared");
  });
});

describe("a press", () => {
  it("claims a prepared request once: the second claim, a replay or a race, gets nothing", async () => {
    const { action } = await repos.founderActions.prepare(h.db, A.businessId, input("inv_claim"));
    const [x, y] = await Promise.all([repos.founderActions.claim(h.db, A.businessId, action.id, press), repos.founderActions.claim(h.db, A.businessId, action.id, press)]);
    expect([x, y].filter(Boolean)).toHaveLength(1);
    expect(await repos.founderActions.claim(h.db, A.businessId, action.id, press)).toBeNull();
    const done = await repos.founderActions.finish(h.db, A.businessId, action.id, { status: "executed", result: { simulated: true }, now: NOW });
    expect(done).toMatchObject({ status: "executed", pressedBy: press.pressedBy, result: { simulated: true } });
    expect(await repos.founderActions.finish(h.db, A.businessId, action.id, { status: "failed", error: "again", now: NOW })).toBeNull();
    expect(await repos.founderActions.voidOpen(h.db, A.businessId, action.id, "late")).toBeNull();
  });

  it("a voided request cannot be claimed, and the same payload can be prepared again afterwards", async () => {
    const { action } = await repos.founderActions.prepare(h.db, A.businessId, input("inv_void"));
    expect((await repos.founderActions.voidOpen(h.db, A.businessId, action.id, "The invention changed."))?.status).toBe("voided");
    expect(await repos.founderActions.claim(h.db, A.businessId, action.id, press)).toBeNull();
    const next = await repos.founderActions.prepare(h.db, A.businessId, input("inv_void"));
    expect(next).toMatchObject({ created: true });
    expect(next.action.id).not.toBe(action.id);
  });

  it("a failed press is never run again: the retry is a new request", async () => {
    const { action } = await repos.founderActions.prepare(h.db, A.businessId, input("inv_fail"));
    await repos.founderActions.claim(h.db, A.businessId, action.id, press);
    expect((await repos.founderActions.finish(h.db, A.businessId, action.id, { status: "failed", error: "Lightbringer refused", now: NOW }))?.status).toBe("failed");
    expect(await repos.founderActions.claim(h.db, A.businessId, action.id, press)).toBeNull();
  });
});

describe("a result that may have gone out (security review P2-3)", () => {
  it("is finished unknown, never run again, remembered for the next request of the same payload", async () => {
    const { action } = await repos.founderActions.prepare(h.db, A.businessId, input("inv_unknown"));
    expect(await repos.founderActions.hadUnknown(h.db, A.businessId, "lightbringer_mcp", "request_patent_preparation", action.payloadHash)).toBe(false);
    await repos.founderActions.claim(h.db, A.businessId, action.id, press);
    expect(await repos.founderActions.finish(h.db, A.businessId, action.id, { status: "unknown", error: "The call ended with an error.", now: NOW })).toMatchObject({ status: "unknown", error: "The call ended with an error.", executedAt: null });
    expect(await repos.founderActions.claim(h.db, A.businessId, action.id, press)).toBeNull();
    expect(await repos.founderActions.hadUnknown(h.db, A.businessId, "lightbringer_mcp", "request_patent_preparation", action.payloadHash)).toBe(true);
    expect(await repos.founderActions.hadUnknown(h.db, B.businessId, "lightbringer_mcp", "request_patent_preparation", action.payloadHash)).toBe(false);
    expect((await repos.founderActions.prepare(h.db, A.businessId, input("inv_unknown"))).created).toBe(true);
  });
});
