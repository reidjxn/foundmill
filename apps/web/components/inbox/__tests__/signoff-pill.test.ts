/** The sign-off panel's pill (docs/DESIGN.md "Builder view"): the round number is Builder view's; off reads "Waiting for you". */
import { describe, expect, it } from "vitest";
import { signoffPanelStatus } from "../SignoffPanel";

const pending = { status: "pending", kind: "spec", round: 2 } as unknown as Parameters<typeof signoffPanelStatus>[0];
const fmt = () => "Nov 7, 2026";

describe("signoffPanelStatus", () => {
  it("a pending round reads 'Waiting for you' with Builder view off (the default), and its round with it on", () => {
    expect(signoffPanelStatus(pending, null, fmt, null)).toEqual({ tone: "info", word: "Waiting for you" });
    expect(signoffPanelStatus(pending, null, fmt, null, false).word).not.toMatch(/Round/);
    expect(signoffPanelStatus(pending, null, fmt, null, true)).toEqual({ tone: "info", word: "Round 2 · waiting for you" });
  });

  it("an answered round reads the same either way", () => {
    expect(signoffPanelStatus(pending, "approve", fmt, "2026-11-07T10:00:00Z", false).word).toBe("Approved by you · Nov 7, 2026");
    expect(signoffPanelStatus(pending, "approve", fmt, "2026-11-07T10:00:00Z", true).word).toBe("Approved by you · Nov 7, 2026");
  });
});
