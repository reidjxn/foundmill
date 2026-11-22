/**
 * Plan tier limits are enforced (BUILD §10.5 `TIERS`): businesses per owner (the highest tier among the businesses they
 * own; Try 1, Founder up to 5, Studio any number, at every stage), seats per business, and concurrent
 * agent sessions per business, each refused with a typed `tier_limit` error.
 */
import { TIERS } from "@foundmill/config";
import { TierLimitError } from "@foundmill/shared";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { repos } from "../repos";
import { assertBusinessAllowance, assertConcurrencyRoom, assertSeatAvailable, businessAllowance, concurrencyAllowance, OPEN_SESSION_WINDOW_HOURS, seatAllowance } from "../tiers";
import { setupRepoHarness, type RepoHarness } from "./repos/helpers";

let r: RepoHarness;
beforeAll(async () => {
  r = await setupRepoHarness("tier");
});
afterAll(() => r?.close());

describe("businesses per owner", () => {
  it("an owner with no project yet has room, and Try holds 1 (A14)", async () => {
    const fresh = await r.h.createUser("tier-fresh@test.local");
    expect(await businessAllowance(r.db, fresh)).toEqual({ tier: "free", allowed: 1, owned: 0, planBusinessId: null });
    await expect(assertBusinessAllowance(r.db, fresh)).resolves.toMatchObject({ owned: 0 });

    const owner = r.A.ownerId;
    expect(await businessAllowance(r.db, owner)).toEqual({ tier: "free", allowed: 1, owned: 1, planBusinessId: r.A.businessId });
    // Staff of a business (not its owner) hold no allowance there.
    expect((await businessAllowance(r.db, r.A.adminId)).owned).toBe(0);
  });

  it("Try holds 1 project: the owner keeps it and is told which plan allows another (A14)", async () => {
    const owner = r.A.ownerId;
    const refused = await assertBusinessAllowance(r.db, owner).catch((e: unknown) => e);
    expect(refused).toBeInstanceOf(TierLimitError);
    expect(refused).toMatchObject({ code: "tier_limit", status: 403, details: { limit: "businesses", tier: "free", allowed: 1, used: 1, planBusinessId: r.A.businessId } });
    expect((refused as Error).message).toBe("Try holds 1 project and you have 1. You keep it. Founder holds up to 5: change plan in Settings › Billing to take charge of another, or archive one.");
    expect((refused as Error).message).not.toMatch(/free|seat/i);
    // Founder has room for four more; Studio for any number.
    await repos.businesses.update(r.db, r.A.businessId, { planTier: "pro" });
    await expect(assertBusinessAllowance(r.db, owner)).resolves.toMatchObject({ tier: "pro", allowed: 5, owned: 1 });
    await repos.businesses.update(r.db, r.A.businessId, { planTier: "scale" });
    await expect(assertBusinessAllowance(r.db, owner)).resolves.toMatchObject({ tier: "scale", allowed: null });
    await repos.businesses.update(r.db, r.A.businessId, { planTier: "free" });
  });

  it("follows the owner's highest tier, and archived businesses do not count", async () => {
    const owner = r.A.ownerId;
    await repos.businesses.update(r.db, r.A.businessId, { planTier: "pro" });
    expect(await businessAllowance(r.db, owner)).toMatchObject({ tier: "pro", owned: 1 });
    await repos.businesses.update(r.db, r.A.businessId, { planTier: "scale" });
    expect(await businessAllowance(r.db, owner)).toMatchObject({ tier: "scale", allowed: null });
    await expect(assertBusinessAllowance(r.db, owner)).resolves.toMatchObject({ tier: "scale" });
    await repos.businesses.update(r.db, r.A.businessId, { planTier: "free" });

    const second = await repos.businesses.create(r.db, { name: "Tier Second", createdBy: r.B.ownerId });
    await repos.memberships.add(r.db, second.id, { userId: r.B.ownerId, role: "owner" });
    expect((await businessAllowance(r.db, r.B.ownerId)).owned).toBe(2);
    // Over Try's limit of 1 with 2: nothing is taken away, a third is refused, and Studio is not named while Founder has room.
    await expect(assertBusinessAllowance(r.db, r.B.ownerId)).rejects.toThrow(/Try holds 1 project and you have 2\. You keep them all\. Founder holds up to 5/);
    // A deleted (archived) project does not count toward the limit.
    await repos.businesses.archive(r.db, second.id);
    expect((await businessAllowance(r.db, r.B.ownerId)).owned).toBe(1);
  });
});

describe("seats", () => {
  it("people are free on every plan: no limit, and adding someone is never refused", async () => {
    const business = await repos.businesses.get(r.db, r.B.businessId);
    expect(await seatAllowance(r.db, business)).toEqual({ tier: "free", allowed: null, used: 4 });
    await expect(assertSeatAvailable(r.db, business)).resolves.toBeUndefined();
    await expect(assertSeatAvailable(r.db, { ...business, planTier: "scale" })).resolves.toBeUndefined();
  });

  it("the machinery still refuses past a limit, should one ever return", async () => {
    const business = await repos.businesses.get(r.db, r.B.businessId);
    const limitFor = () => 1;
    expect(await seatAllowance(r.db, business, { limitFor })).toEqual({ tier: "free", allowed: 1, used: 4 });
    await expect(assertSeatAvailable(r.db, business, { limitFor })).rejects.toMatchObject({ code: "tier_limit", details: { limit: "seats", allowed: 1, used: 4 } });
    await expect(assertSeatAvailable(r.db, business, { limitFor: () => 10 })).resolves.toBeUndefined();
  });
});

describe("concurrent agents", () => {
  it("counts the sessions still open (recently started) against the tier's limit", async () => {
    const business = await repos.businesses.get(r.db, r.B.businessId);
    const now = new Date();
    // The fixture leaves one session open.
    expect(await concurrencyAllowance(r.db, business, now)).toEqual({ limit: TIERS.free.maxConcurrentAgents, running: 1, room: TIERS.free.maxConcurrentAgents - 1 });
    await expect(assertConcurrencyRoom(r.db, business, now)).resolves.toMatchObject({ room: TIERS.free.maxConcurrentAgents - 1 });
    for (let i = 0; i < 3; i++) await repos.agents.createSession(r.db, r.B.businessId, { agentId: r.B.agentId, startedAt: now });
    expect(await concurrencyAllowance(r.db, business, now)).toMatchObject({ running: 4, room: 0 });
    // One more session is refused with the typed error the web turns into an upgrade prompt (dev.tasks.start, dispatch).
    const refused = await assertConcurrencyRoom(r.db, business, now).catch((e: unknown) => e);
    expect(refused).toBeInstanceOf(TierLimitError);
    expect(refused).toMatchObject({ code: "tier_limit", details: { limit: "concurrent_agents", tier: "free", allowed: TIERS.free.maxConcurrentAgents, used: 4, planBusinessId: r.B.businessId } });
    expect((refused as Error).message).toMatch(/^Try runs 4 agents at once and all of them are working\./);
    // An ended session frees its slot; an open row older than the window is a lost session, not a running one.
    const ended = await repos.agents.createSession(r.db, r.B.businessId, { agentId: r.B.agentId, startedAt: now });
    await repos.agents.endSession(r.db, r.B.businessId, ended.id, { outcome: "done" });
    await repos.agents.createSession(r.db, r.B.businessId, { agentId: r.B.agentId, startedAt: new Date(now.getTime() - (OPEN_SESSION_WINDOW_HOURS + 1) * 3_600_000) });
    expect(await concurrencyAllowance(r.db, business, now)).toMatchObject({ running: 4, room: 0 });
    // One more session by hand is refused with a typed error while every slot is taken.
    await expect(assertConcurrencyRoom(r.db, business, now)).rejects.toMatchObject({ code: "tier_limit", details: { limit: "concurrent_agents", tier: "free", allowed: 4, used: 4, planBusinessId: r.B.businessId } });
    // A larger tier has room; the room never goes below zero.
    // Studio adds more agents at once; Founder runs as many as Try (WP-14 T14).
    expect(await concurrencyAllowance(r.db, { ...business, planTier: "pro" }, now)).toEqual({ limit: 4, running: 4, room: 0 });
    expect(await concurrencyAllowance(r.db, { ...business, planTier: "scale" }, now)).toEqual({ limit: 64, running: 4, room: 60 });
    await expect(assertConcurrencyRoom(r.db, { ...business, planTier: "scale" }, now)).resolves.toMatchObject({ room: 60 });
    // Business A's sessions are its own.
    expect((await concurrencyAllowance(r.db, await repos.businesses.get(r.db, r.A.businessId), now)).running).toBe(1);
  });
});
