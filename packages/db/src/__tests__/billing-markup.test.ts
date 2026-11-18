/**
 * The markup on the platform's keys (founder, Nov 17, 2026): a call on Foundmill's keys is charged against credits at
 * cost plus `CREDIT_MARKUP` (30%), on every plan; the usage ledger keeps the true cost, so the cost report and the free
 * plan's $600 cap measure what the calls really cost; a founder's own key is never charged at all.
 */
import { CREDIT_MARKUP, chargedMinor, includedCreditsMinor } from "@foundmill/config";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { bookUsage } from "../billing";
import { repos } from "../repos";
import { setupRepoHarness, type RepoHarness } from "./repos/helpers";

let r: RepoHarness;
beforeAll(async () => {
  r = await setupRepoHarness("markup");
});
afterAll(() => r?.close());

const when = new Date(Date.UTC(2027, 5, 4, 12));
const call = (costMinor: number, billedTo: "credits" | "byok") => ({ agentId: r.A.agentId, kind: "tokens" as const, modelKey: "sonnet" as const, quantity: 1000, unit: "tokens", costMinor, billedTo, occurredAt: when });

describe("the credit markup", () => {
  it("is 30%, applied once and rounded", () => {
    expect(CREDIT_MARKUP).toBe(0.3);
    expect(chargedMinor(100)).toBe(130);
    expect(chargedMinor(1)).toBe(1);
    expect(chargedMinor(0)).toBe(0);
  });

  it("charges credits at cost plus the markup while the ledger keeps the true cost; an own-key call charges nothing", async () => {
    const A = r.A.businessId;
    const booked = await bookUsage(r.db, A, call(100, "credits"));
    expect(Number(booked.entry.costMinor)).toBe(100);
    expect(booked.credits?.balance).toMatchObject({ grantedMinor: includedCreditsMinor("free"), spentMinor: 130, balanceMinor: includedCreditsMinor("free") - 130 });
    // The month's cost totals (what the cost report and the free plan's cap read) are the true cost.
    const totals = await repos.usage.totals(r.db, A, { from: new Date(Date.UTC(2027, 5, 1)), to: new Date(Date.UTC(2027, 6, 1)) });
    expect(totals.costMinor).toBe(100);
    const own = await bookUsage(r.db, A, call(100, "byok"));
    expect(own.credits).toBeNull();
    expect((await repos.usage.creditBalance(r.db, A, "2027-06"))?.spentMinor).toBe(130);
  });
});
