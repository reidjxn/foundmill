import { describe, expect, it } from "vitest";
import { customersSoFarWords, milestoneForTrophy, otherMilestones, replayRefOf, shareText, trophyCards, trophyKeyOf } from "../milestones";

const rows = [
  { id: "m1", kind: "customer", label: "First customer", achievedAt: new Date("2026-03-01T10:00:00Z"), ref: { trophyKey: "customer_1", amountMinor: 4_900, customerName: "Acme", permission: true, journeyId: "j-1" }, visibility: "public" },
  { id: "m2", kind: "revenue", label: "First €1K MRR", achievedAt: "2026-05-01T10:00:00Z", ref: { trophyKey: "mrr_1k", customerName: "Secret Co" }, visibility: "private" },
  { id: "m3", kind: "launch", label: "Public launch", achievedAt: "2026-04-01T10:00:00Z", ref: null },
  { id: "m4", kind: "release", label: "v1.2 shipped", achievedAt: "2026-06-01T10:00:00Z", ref: { conversionId: "c-9" } },
];

describe("milestones (BUILD §11.4 trophy cabinet)", () => {
  it("matches stored milestones to the eight trophies by ref.trophyKey, with customer names only on permission", () => {
    const cards = trophyCards(rows, "EUR", true);
    expect(cards).toHaveLength(8);
    const first = cards.find((c) => c.key === "customer_1")!;
    expect(first).toMatchObject({ achievedAt: "2026-03-01T10:00:00.000Z", customerName: "Acme", amountMinor: 4_900, shareable: true });
    const mrr = cards.find((c) => c.key === "mrr_1k")!;
    expect(mrr.customerName).toBeNull();
    expect(mrr.shareable).toBe(false);
    expect(cards.filter((c) => c.achievedAt)).toHaveLength(2);
    expect(trophyCards(rows, "EUR", false).every((c) => !c.shareable)).toBe(true);
    expect(trophyCards(undefined, "GBP", false).every((c) => c.achievedAt === null)).toBe(true);
  });
  it("falls back to kind + label when the ref carries no key", () => {
    const cards = trophyCards([{ id: "x", kind: "customer", label: "First customer", achievedAt: "2026-01-01T00:00:00Z" }], "EUR", false);
    expect(cards.find((c) => c.key === "customer_1")?.achievedAt).toBe("2026-01-01T00:00:00Z");
    expect(trophyKeyOf({ id: "y", kind: "customer", label: "x", achievedAt: "2026-01-01T00:00:00Z", trophyKey: "customer_10" })).toBe("customer_10");
  });
  it("keeps non-trophy milestones for the timeline, newest first, and finds replays in refs", () => {
    expect(otherMilestones(rows).map((m) => m.id)).toEqual(["m4", "m3"]);
    expect(replayRefOf(milestoneForTrophy("customer_1", rows, "EUR"))).toEqual({ journeyId: "j-1", conversionId: undefined });
    expect(replayRefOf(rows[3])).toEqual({ journeyId: undefined, conversionId: "c-9" });
    expect(replayRefOf(rows[2])).toBeNull();
    expect(milestoneForTrophy("nope", rows, "EUR")).toBeUndefined();
  });
  it("share text anonymizes the customer unless permission is recorded", () => {
    const cards = trophyCards(rows, "EUR", true);
    expect(shareText(cards.find((c) => c.key === "customer_1")!, "Northwind")).toBe("Northwind · First customer with Acme · Mar 1, 2026");
    expect(shareText(cards.find((c) => c.key === "mrr_1k")!, "Northwind")).not.toContain("Secret");
    // The date reads in the founder's own format (Settings › Preferences).
    expect(shareText(cards.find((c) => c.key === "customer_1")!, "Northwind", { date: "iso", time: "24h" })).toBe("Northwind · First customer with Acme · 2026-03-01");
    expect(shareText(cards.find((c) => c.key === "customer_1")!, "Northwind", { date: "day_first", time: "12h" })).toBe("Northwind · First customer with Acme · 1 Mar 2026");
  });
});

describe("customersSoFarWords (one number per fact, DECISIONS 2026-11-10)", () => {
  it("names the first-payment total the customer milestones are reached at", () => {
    expect(customersSoFarWords(1_073)).toBe("1,073 paying customers so far");
    expect(customersSoFarWords(1)).toBe("1 paying customer so far");
    expect(customersSoFarWords(0)).toBe("No paying customers yet");
    expect(customersSoFarWords(undefined)).toBeUndefined();
  });
});
