import { describe, expect, it } from "vitest";
import { emptyWhy, type EmptyWhyId } from "./empty-why";

const IDS: EmptyWhyId[] = ["today_needs_you", "leads", "campaigns", "contacts", "milestones", "roadmap", "spec", "spec_versions", "cash_history", "cash_flow", "bank", "entity", "officers", "compliance", "hired_agents"];

describe("emptyWhy", () => {
  it("every empty screen has one sentence of words: no dash, no loading text, US English", () => {
    for (const id of IDS) {
      const { text } = emptyWhy(id);
      expect(text.length, id).toBeGreaterThan(20);
      expect(text.trim(), id).not.toBe("—");
      expect(text, id).not.toMatch(/loading|colour|organisation|squad|club/i);
    }
  });

  it("says when: leads and campaigns point at the 'Ready to start selling?' answer until distribution has started", () => {
    expect(emptyWhy("leads").text).toContain("“Ready to start selling?”");
    expect(emptyWhy("campaigns", { distributionStarted: false }).text).toContain("“Ready to start selling?”");
    expect(emptyWhy("leads", { distributionStarted: true }).text).not.toContain("Ready to start selling");
    expect(emptyWhy("leads").title).toBe("No leads yet");
  });

  it("Needs you on a new business says when the first notes arrive; later it keeps its calm line", () => {
    expect(emptyWhy("today_needs_you", { firstDays: true }).text).toContain("usually on day 1");
    expect(emptyWhy("today_needs_you").text).toBe("Nothing needs you right now. The team keeps working.");
  });

  it("the spec and roadmap name day 1 and the sign-off", () => {
    expect(emptyWhy("spec").text).toMatch(/day 1.*sign-off/);
    expect(emptyWhy("roadmap").text).toMatch(/day 1.*sign-off/);
  });
});
