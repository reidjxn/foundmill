/**
 * The volume rule's daily round-up (BUILD §11.4, audit #342): wins rolled up (`fullMatchDay: false`) are not narrated
 * one by one; Refresh groups each UTC day's into one results note.
 */
import { describe, expect, it } from "vitest";
import { splitRoundups } from "../refresh";

const win = (id: string, at: string, fullMatchDay: boolean | undefined, type = "customer.converted") => ({ id, type, occurredAt: new Date(at), payload: fullMatchDay === undefined ? {} : { fullMatchDay } });

describe("splitRoundups", () => {
  it("keeps full wins and other events single, and groups the rolled-up wins by UTC day, oldest day first", () => {
    const events = [
      win("full", "2026-10-12T09:00:00Z", true),
      win("r2", "2026-10-12T18:00:00Z", false),
      win("r1", "2026-10-11T10:00:00Z", false),
      win("r3", "2026-10-12T20:00:00Z", false),
      win("pay", "2026-10-12T12:00:00Z", undefined, "payment.received"),
      win("unknown", "2026-10-12T13:00:00Z", undefined),
    ];
    const { single, roundups } = splitRoundups(events);
    expect(single.map((e) => e.id)).toEqual(["full", "pay", "unknown"]);
    expect(roundups.map((g) => g.map((e) => e.id))).toEqual([["r1"], ["r2", "r3"]]);
  });

  it("caps one round-up note at 50 wins", () => {
    const many = Array.from({ length: 80 }, (_, i) => win(`w${i}`, "2026-10-12T10:00:00Z", false));
    expect(splitRoundups(many).roundups[0]).toHaveLength(50);
  });

  it("returns nothing to roll up when every win earned a full update", () => {
    expect(splitRoundups([win("a", "2026-10-12T10:00:00Z", true)]).roundups).toEqual([]);
  });
});
