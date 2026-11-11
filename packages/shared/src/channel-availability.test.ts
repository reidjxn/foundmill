import { describe, expect, it } from "vitest";
import { channelAvailabilitySentence, channelMayRun, channelNotAvailableMessage, mockResultsAllowed, noChannelSentence } from "./channel-availability";

describe("mockResultsAllowed", () => {
  it("a sample business anywhere, and any business in development or test; never a person's own project on staging or production", () => {
    expect(mockResultsAllowed("staging", false)).toBe(false);
    expect(mockResultsAllowed("production", false)).toBe(false);
    expect(mockResultsAllowed("production", true)).toBe(true);
    expect(mockResultsAllowed("staging", true)).toBe(true);
    expect(mockResultsAllowed("test", false)).toBe(true);
    expect(mockResultsAllowed("development", false)).toBe(true);
  });
});

describe("channel availability words", () => {
  it("an available channel has no sentence", () => {
    expect(channelAvailabilitySentence({ available: true, reason: "acts" })).toBeNull();
    expect(channelAvailabilitySentence({ available: true, reason: "simulated_allowed" })).toBeNull();
  });

  it("no publisher: the team cannot publish there yet", () => {
    expect(channelAvailabilitySentence({ available: false, reason: "no_publisher" })).toBe("Not available yet: the team cannot publish here yet.");
    expect(channelNotAvailableMessage("social", { available: false, reason: "no_publisher" })).toBe("Social media is not available yet: the team cannot publish there yet.");
  });

  it("not connected: the founder's step only when the connector is switched on here", () => {
    expect(channelAvailabilitySentence({ available: false, reason: "not_connected", connectorKey: "sendgrid", connectable: true }, "SendGrid")).toBe("Not available yet: connect SendGrid in Settings › Integrations and the team can run this.");
    const waiting = channelAvailabilitySentence({ available: false, reason: "not_connected", connectorKey: "sendgrid", connectable: false }, "SendGrid");
    expect(waiting).toBe("Not available yet: SendGrid is not switched on for your project yet. Nothing is waiting on you.");
    expect(channelNotAvailableMessage("email_automation", { available: false, reason: "not_connected", connectorKey: "sendgrid", connectable: true }, "SendGrid")).toBe("Email automation is not available yet: connect SendGrid in Settings › Integrations and the team can run it.");
    expect(channelNotAvailableMessage("email_automation", { available: false, reason: "not_connected", connectorKey: "sendgrid", connectable: false }, "SendGrid")).toContain("Nothing is waiting on you");
  });

  it("the words never blame the founder, never name another person and stay US English", () => {
    const all = [
      channelAvailabilitySentence({ available: false, reason: "no_publisher" }),
      channelAvailabilitySentence({ available: false, reason: "not_connected", connectable: true }, "GitHub"),
      channelAvailabilitySentence({ available: false, reason: "not_connected", connectable: false }, "GitHub"),
      noChannelSentence(),
      noChannelSentence({ opensFirst: { label: "SEO", connectorName: "GitHub", connectable: true } }),
    ].join(" ");
    expect(all).not.toMatch(/staff|seat|cofounder|collaborator|you need|you must|your fault|failed|error|colour|organisation/i);
  });
});

describe("channelMayRun", () => {
  it("an available channel runs; an unavailable one only in offline tracking", () => {
    expect(channelMayRun({ available: true }, false)).toBe(true);
    expect(channelMayRun({ available: false }, false)).toBe(false);
    expect(channelMayRun({ available: false }, true)).toBe(true);
    // No answer (an older response): nothing is hidden.
    expect(channelMayRun(undefined, false)).toBe(true);
  });
});
