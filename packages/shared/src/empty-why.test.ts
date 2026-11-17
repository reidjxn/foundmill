import { describe, expect, it } from "vitest";
import { emptyWhy, type EmptyWhyId } from "./empty-why";

const IDS: EmptyWhyId[] = ["today_needs_you", "leads", "campaigns", "contacts", "milestones", "roadmap", "spec", "spec_versions", "cash_history", "cash_flow", "bank", "entity", "officers", "compliance", "hired_agents", "channel_board"];

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
    expect(emptyWhy("today_needs_you", { firstDays: true }).text).toBe("Nothing needs you yet. Your page is being drafted and will show here in about a minute.");
    // One first-day story (WP-04 T7): the page first, never the two documents to sign off.
    expect(emptyWhy("today_needs_you", { firstDays: true }).text).not.toMatch(/specification|roadmap|two notes|sign/i);
    expect(emptyWhy("today_needs_you").text).toBe("Nothing needs you right now. The team keeps working.");
  });

  it("the Channel Board with nothing to run says what opens first and that nothing is wrong", () => {
    const none = emptyWhy("channel_board");
    expect(none.title).toBe("No channels to run yet");
    expect(none.text).toBe("No channel can run on its own yet. Email opens first, as soon as sending is switched on for your project. Nothing is wrong, and nothing is waiting on you.");
    // A connection the founder can make now is named as their step, and never as a fault.
    expect(emptyWhy("channel_board", { noChannel: { opensFirst: { label: "SEO", connectorName: "GitHub", connectable: true } } }).text).toBe(
      "No channel can run on its own yet. SEO opens first: connect GitHub in Settings › Integrations and the team can run it. Nothing is wrong.",
    );
    // One that is not switched on yet is not the founder's step.
    expect(emptyWhy("channel_board", { noChannel: { opensFirst: { label: "Email automation", connectorName: "SendGrid", connectable: false } } }).text).toContain("nothing is waiting on you");
  });

  it("the spec and roadmap name day 1 and the sign-off", () => {
    expect(emptyWhy("spec").text).toMatch(/day 1.*sign-off/);
    expect(emptyWhy("roadmap").text).toMatch(/day 1.*sign-off/);
  });
});
