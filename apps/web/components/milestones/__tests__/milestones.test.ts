import { describe, expect, it } from "vitest";
import { customersSoFarWords, describeTrophy, milestoneForTrophy, otherMilestones, pageStateOf, replayRefOf, shareText, trophyCards, trophyKeyOf } from "../milestones";
import { TROPHY_BY_KEY } from "@foundmill/journey";

const rows = [
  { id: "m1", kind: "customer", label: "First customer", achievedAt: new Date("2026-03-01T10:00:00Z"), ref: { trophyKey: "customer_1", amountMinor: 4_900, customerName: "Acme", permission: true, journeyId: "j-1" }, visibility: "public" },
  { id: "m2", kind: "revenue", label: "First €1K MRR", achievedAt: "2026-05-01T10:00:00Z", ref: { trophyKey: "mrr_1k", customerName: "Secret Co" }, visibility: "private" },
  { id: "m3", kind: "launch", label: "Public launch", achievedAt: "2026-04-01T10:00:00Z", ref: null },
  { id: "m4", kind: "release", label: "v1.2 shipped", achievedAt: "2026-06-01T10:00:00Z", ref: { conversionId: "c-9" } },
];

describe("milestones (BUILD §11.4 trophy cabinet)", () => {
  it("lists the two early milestones before the customer and revenue ones, each with its own plain line", () => {
    const cards = trophyCards(rows, "EUR", false);
    expect(cards.map((c) => c.key)).toEqual(["page_live", "first_follower", "customer_1", "customer_10", "customer_100", "customer_1000", "mrr_1k", "mrr_10k", "mrr_100k", "first_enterprise_contract"]);
    expect(cards.slice(0, 2).map((c) => [c.label, c.description, c.achievedAt])).toEqual([
      ["Page live", "Your project's public page went live.", null],
      ["First follower", "The first person confirmed that they follow your project.", null],
    ]);
    expect(describeTrophy(TROPHY_BY_KEY.page_live, "GBP", false)).toBe("Your project's public page went live.");
    const reached = trophyCards([...rows, { id: "m5", kind: "trophy", label: "Page live", achievedAt: "2026-11-12T09:00:00Z", ref: { trophyKey: "page_live", pageId: "p-1" }, visibility: "private" }], "EUR", false);
    expect(reached[0]).toMatchObject({ key: "page_live", achievedAt: "2026-11-12T09:00:00Z", customerName: null, amountMinor: null });
    // A milestone under a key stays out of the timeline of notes.
    expect(otherMilestones([{ id: "m5", kind: "trophy", label: "Page live", achievedAt: "2026-11-12T09:00:00Z", ref: { trophyKey: "page_live" } }])).toEqual([]);
  });
  it("says where a reached milestone stands on the public page, from its visibility and whether the page is live", () => {
    const recorded = (visibility: string) => ({ id: "m", kind: "trophy", label: "Page live", achievedAt: "2026-11-12T09:00:00Z", ref: { trophyKey: "page_live" }, visibility });
    expect(pageStateOf(recorded("private"), { live: true })).toBe("hidden");
    expect(pageStateOf(recorded("public"), { live: true })).toBe("shown");
    // Shown before and the page is down: it can still be hidden; nothing new can be shown.
    expect(pageStateOf(recorded("public"), { live: false })).toBe("waiting");
    expect(pageStateOf(recorded("private"), { live: false })).toBeNull();
    // No page to show on (a sample business, a reader with no view of the page), not reached, or a note someone typed in.
    expect(pageStateOf(recorded("public"), null)).toBeNull();
    expect(pageStateOf(undefined, { live: true })).toBeNull();
    expect(pageStateOf({ id: "n", kind: "launch", label: "Public launch", achievedAt: "2026-04-01T10:00:00Z", ref: null, visibility: "public" }, { live: true })).toBeNull();
    expect(pageStateOf({ id: "n", kind: "trophy", label: "Made up", achievedAt: "2026-04-01T10:00:00Z", ref: { trophyKey: "made_up" }, visibility: "private" }, { live: true })).toBeNull();
    // On the cards: only reached ones carry a state, and it does not depend on the old Personal and Live setting.
    for (const liveMode of [true, false]) {
      const cards = trophyCards(rows, "EUR", liveMode, null, { live: true });
      expect(cards.find((c) => c.key === "customer_1")!.page).toBe("shown");
      expect(cards.find((c) => c.key === "mrr_1k")!.page).toBe("hidden");
      expect(cards.find((c) => c.key === "customer_10")!.page).toBeNull();
    }
    expect(trophyCards(rows, "EUR", true).every((c) => c.page === null)).toBe(true);
  });
  it("matches stored milestones to the trophies by ref.trophyKey, with customer names only on permission", () => {
    const cards = trophyCards(rows, "EUR", true);
    expect(cards).toHaveLength(10);
    const first = cards.find((c) => c.key === "customer_1")!;
    expect(first).toMatchObject({ achievedAt: "2026-03-01T10:00:00.000Z", customerName: "Acme", amountMinor: 4_900, shareable: true });
    const mrr = cards.find((c) => c.key === "mrr_1k")!;
    expect(mrr.customerName).toBeNull();
    expect(mrr.shareable).toBe(false);
    expect(cards.filter((c) => c.achievedAt)).toHaveLength(2);
    expect(trophyCards(rows, "EUR", false).every((c) => !c.shareable)).toBe(true);
    expect(trophyCards(undefined, "GBP", false).every((c) => c.achievedAt === null)).toBe(true);
  });
  it("names a revenue milestone as Finance names its monthly figure, the same figure (DECISIONS 2026-11-11)", () => {
    const recurringCard = trophyCards(rows, "GBP", false, true).find((c) => c.key === "mrr_10k")!;
    expect(recurringCard.label).toBe("First £10K MRR");
    expect(recurringCard.description).toBe("Monthly recurring revenue (MRR) reaches £10K: the last 3 full months' revenue ÷ 3, as on Finance (Estimate).");
    const oneOff = trophyCards(rows, "GBP", false, false);
    expect(oneOff.find((c) => c.key === "mrr_10k")).toMatchObject({ label: "First £10K monthly revenue", description: "Average monthly revenue reaches £10K: the last 3 full months' revenue ÷ 3, as on Finance (Estimate)." });
    // A stored row keeps its own date and is still matched by its key, whatever its stored label.
    expect(trophyCards(rows, "EUR", false, false).find((c) => c.key === "mrr_1k")!.achievedAt).toBe("2026-05-01T10:00:00Z");
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
