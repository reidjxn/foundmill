/** "When the team stops" (item 10, Nov 13, 2026): the list per project, by the answer in force. */
import { describe, expect, it } from "vitest";
import { loopStops } from "./loop-stops";

const AGENT = 25_000;
const ids = (l: ReturnType<typeof loopStops>) => l.asks.map((s) => s.id);

describe("when the team stops", () => {
  it("lists what each answer asks, and what always comes to the founder", () => {
    expect(ids(loopStops({ mode: "augmented", lineMinor: 0, currency: "GBP", agentLimitMinor: AGENT }))).toEqual(["always_yours", "spend", "outside", "permanent", "release", "offline_channel", "credits", "holds_work"]);
    expect(ids(loopStops({ mode: "assisted", lineMinor: 5_000, currency: "GBP", agentLimitMinor: AGENT }))).toEqual(["always_yours", "spend", "permanent", "contract", "release", "offline_channel", "credits", "holds_work"]);
    expect(ids(loopStops({ mode: "automated", lineMinor: null, currency: "GBP", agentLimitMinor: AGENT }))).toEqual(["always_yours", "spend", "release", "offline_channel", "credits", "holds_work"]);
  });

  it("names the spend line in the business's own currency", () => {
    const when = (lineMinor: number | null, mode: "augmented" | "assisted" = "assisted") => loopStops({ mode, lineMinor, currency: "GBP", agentLimitMinor: AGENT }).asks.find((s) => s.id === "spend")!.when;
    expect(when(5_000)).toBe("A purchase over £50, or over the agent's own limit when that is lower");
    expect(when(0)).toBe("Any purchase, whatever it costs");
    expect(when(null)).toBe("A purchase over the agent's own limit (£250 unless you set one)");
    expect(when(5_000, "augmented")).toBe("Any purchase, whatever it costs");
  });

  it("on vacation the list is the third answer's", () => {
    const l = loopStops({ mode: "augmented", lineMinor: 5_000, currency: "USD", agentLimitMinor: AGENT, holiday: true });
    expect(l.modeInForce).toBe("automated");
    expect(ids(l)).not.toContain("outside");
  });

  it("adds Autopilot's own pause only while it is on, with its number", () => {
    expect(ids(loopStops({ mode: "assisted", lineMinor: null, currency: "USD", agentLimitMinor: AGENT, autopilot: { enabled: false, maxIdleCycles: 3 } }))).not.toContain("autopilot_idle");
    const on = loopStops({ mode: "assisted", lineMinor: null, currency: "USD", agentLimitMinor: AGENT, autopilot: { enabled: true, maxIdleCycles: 3 } });
    expect(on.asks.find((s) => s.id === "autopilot_idle")!.when).toBe("3 rounds of work in a row fail or get nothing done");
  });

  it("says what stops on its own, and never uses the words the page avoids", () => {
    const l = loopStops({ mode: "assisted", lineMinor: null, currency: "USD", agentLimitMinor: AGENT, autopilot: { enabled: true, maxIdleCycles: 1 } });
    expect(l.stops.map((s) => s.id)).toEqual(["unsubscribed", "unverified_address", "daily_email"]);
    const words = JSON.stringify(l);
    expect(words).not.toMatch(/\b(hard gates?|policy|policies|caps?|cofounder|alone)\b/i);
  });
});
