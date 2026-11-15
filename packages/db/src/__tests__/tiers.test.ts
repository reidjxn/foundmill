/**
 * Plan tier limits are enforced (BUILD §10.5 `TIERS`): businesses per owner (the highest tier among the businesses they
 * own; unlimited on every plan for now, the check kept for when a limit returns), seats per business, and concurrent
 * agent sessions per business, each refused with a typed `tier_limit` error.
 */
import { TIERS } from "@foundmill/config";
import { TierLimitError } from "@foundmill/shared";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { repos } from "../repos";
import { assertBusinessAllowance, assertConcurrencyRoom, assertSeatAvailable, businessAllowance, concurrencyAllowance, includedCreditPool, OPEN_SESSION_WINDOW_HOURS, seatAllowance } from "../tiers";
import { setupRepoHarness, type RepoHarness } from "./repos/helpers";

let r: RepoHarness;
beforeAll(async () => {
  r = await setupRepoHarness("tier");
});
afterAll(() => r?.close());

describe("businesses per owner", () => {
  it("a free owner may take charge of more businesses: no business limit on any plan for now (founder, 2026-10-16)", async () => {
    const fresh = await r.h.createUser("tier-fresh@test.local");
    expect(await businessAllowance(r.db, fresh)).toEqual({ tier: "free", allowed: null, owned: 0, planBusinessId: null });
    await expect(assertBusinessAllowance(r.db, fresh)).resolves.toMatchObject({ owned: 0 });

    const owner = r.A.ownerId;
    expect(await businessAllowance(r.db, owner)).toEqual({ tier: "free", allowed: null, owned: 1, planBusinessId: r.A.businessId });
    await expect(assertBusinessAllowance(r.db, owner)).resolves.toMatchObject({ tier: "free", allowed: null, owned: 1 });
    // Staff of a business (not its owner) hold no allowance there.
    expect((await businessAllowance(r.db, r.A.adminId)).owned).toBe(0);
  });

  it("the allowance still refuses at a limit, with a typed error naming where to change plan, once a limit returns", async () => {
    const owner = r.A.ownerId;
    const refused = await assertBusinessAllowance(r.db, owner, { limitFor: () => 1 }).catch((e: unknown) => e);
    expect(refused).toBeInstanceOf(TierLimitError);
    expect(refused).toMatchObject({ code: "tier_limit", status: 403, details: { limit: "businesses", tier: "free", allowed: 1, used: 1, planBusinessId: r.A.businessId } });
    expect((refused as Error).message).toMatch(/Free plan holds 1 business/);
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
    await repos.businesses.archive(r.db, second.id);
    expect((await businessAllowance(r.db, r.B.ownerId)).owned).toBe(1);
  });

  it("the included-credit pool keeps its own size (SEC2 S6) and counts only the founder's own grants", async () => {
    const period = "2027-03";
    const founder = await r.h.createUser("tier-pool@test.local");
    expect(await includedCreditPool(r.db, founder, period)).toEqual({ tier: "free", period, places: TIERS.free.includedCreditBusinesses, taken: 0 });
    const first = await repos.businesses.create(r.db, { name: "Pool One", createdBy: founder });
    await repos.memberships.add(r.db, first.id, { userId: founder, role: "owner" });
    await repos.usage.chargeCredits(r.db, first.id, period, 1, { includedMinor: 500 });
    expect(await includedCreditPool(r.db, founder, period)).toMatchObject({ places: 1, taken: 1 });
    // Another founder's grants are theirs alone.
    expect(await includedCreditPool(r.db, r.B.ownerId, period)).toMatchObject({ taken: 0 });
    await repos.businesses.update(r.db, first.id, { planTier: "scale" });
    expect(await includedCreditPool(r.db, founder, period)).toMatchObject({ tier: "scale", places: null, taken: 1 });
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
    expect((refused as Error).message).toMatch(/^The Free plan runs 4 agents at once and all of them are working\./);
    // An ended session frees its slot; an open row older than the window is a lost session, not a running one.
    const ended = await repos.agents.createSession(r.db, r.B.businessId, { agentId: r.B.agentId, startedAt: now });
    await repos.agents.endSession(r.db, r.B.businessId, ended.id, { outcome: "done" });
    await repos.agents.createSession(r.db, r.B.businessId, { agentId: r.B.agentId, startedAt: new Date(now.getTime() - (OPEN_SESSION_WINDOW_HOURS + 1) * 3_600_000) });
    expect(await concurrencyAllowance(r.db, business, now)).toMatchObject({ running: 4, room: 0 });
    // One more session by hand is refused with a typed error while every slot is taken.
    await expect(assertConcurrencyRoom(r.db, business, now)).rejects.toMatchObject({ code: "tier_limit", details: { limit: "concurrent_agents", tier: "free", allowed: 4, used: 4, planBusinessId: r.B.businessId } });
    // A larger tier has room; the room never goes below zero.
    expect(await concurrencyAllowance(r.db, { ...business, planTier: "pro" }, now)).toEqual({ limit: 16, running: 4, room: 12 });
    await expect(assertConcurrencyRoom(r.db, { ...business, planTier: "pro" }, now)).resolves.toMatchObject({ room: 12 });
    // Business A's sessions are its own.
    expect((await concurrencyAllowance(r.db, await repos.businesses.get(r.db, r.A.businessId), now)).running).toBe(1);
  });
});
