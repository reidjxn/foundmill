import { describe, expect, it } from "vitest";
import { EXPLAINERS, missingExplainers } from "../explainers";

describe("explainers (WP-10 T3)", () => {
  it("every DEFAULT_TABS slug has an EXPLAINERS entry", () => {
    expect(missingExplainers()).toEqual([]);
  });

  it("Needs you, Details, Team call, Milestones and Contacts have one (Settings' tabs are held in apps/web)", () => {
    for (const key of ["inbox", "home", "calls", "milestones", "crm"]) expect(EXPLAINERS[key], key).toBeDefined();
  });

  it("every entry has three non-empty lines, and every plain line is a sentence under 160 characters", () => {
    for (const [key, e] of Object.entries(EXPLAINERS)) {
      expect(e.screenId, key).toBeTruthy();
      for (const text of [e.purpose, e.action, e.watchFor]) {
        expect(text, key).toBeTruthy();
        if (typeof text === "string") expect(text.length, key).toBeLessThan(160);
      }
    }
  });

  it("the new entries are three plain sentences that end with a period", () => {
    for (const key of ["product/roadmap", "product/specification", "distribution/leads", "distribution/campaigns", "finance/runway", "legal/compliance", "development/environments", "milestones", "crm", "inbox", "home", "calls"]) {
      const e = EXPLAINERS[key]!;
      for (const text of [e.purpose, e.action, e.watchFor]) expect(text, key).toMatch(/^[A-Z].*\.$/);
    }
  });
});
