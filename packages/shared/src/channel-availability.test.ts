import { describe, expect, it } from "vitest";
import {
  CHANNEL_AVAILABILITY_REASONS,
  CHANNEL_BY_TAP_SENTENCE,
  CHANNELS_SHARED_BY_TAP,
  channelAvailabilitySentence,
  channelByTapRefusal,
  channelEngineMayRun,
  channelMayRun,
  channelNotAvailableMessage,
  channelSharedByTap,
  channelTeamRuns,
  mockResultsAllowed,
  noChannelSentence,
  type ChannelAvailability,
} from "./channel-availability";
import { CHANNEL_KEYS } from "./constants";
import { postsByTap } from "./share-targets";

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

describe("tap-to-post (founder, 2026-11-12): a channel the founder posts with one press", () => {
  const byTap: ChannelAvailability = { available: true, reason: "by_tap", byTap: true };

  it("depends on a constant list of channels and on a network that still opens ready to post", () => {
    expect(CHANNELS_SHARED_BY_TAP).toEqual(["social"]);
    expect(postsByTap()).toBe(true);
    expect(CHANNEL_KEYS.filter(channelSharedByTap)).toEqual(["social"]);
    expect(CHANNEL_AVAILABILITY_REASONS).toEqual(["acts", "no_publisher", "not_connected", "simulated_allowed", "by_tap"]);
  });

  it("says honestly what it means, on the Board and where simulated results are allowed, and nothing once a connector posts", () => {
    expect(CHANNEL_BY_TAP_SENTENCE).toBe("You post each one with one press: the text and link are filled in for you.");
    expect(channelAvailabilitySentence(byTap)).toBe(CHANNEL_BY_TAP_SENTENCE);
    expect(channelAvailabilitySentence({ available: true, reason: "simulated_allowed", byTap: true })).toBe(CHANNEL_BY_TAP_SENTENCE);
    expect(channelAvailabilitySentence({ available: true, reason: "acts" })).toBeNull();
    // Never "posted", never "the team posts".
    expect(`${CHANNEL_BY_TAP_SENTENCE} ${channelByTapRefusal("social")}`).not.toMatch(/\bposted\b|\bpublished\b|team posts|we post/i);
  });

  it("is on the board and is never a channel the team runs: no engine, nothing to launch", () => {
    expect(channelMayRun(byTap, false)).toBe(true);
    expect(channelTeamRuns(byTap)).toBe(false);
    expect(channelEngineMayRun(byTap, false)).toBe(false);
    // Offline tracking is the founder's own choice: the agent prepares, the founder submits.
    expect(channelEngineMayRun(byTap, true)).toBe(true);
    // Every other available reason is the team's to run, as before.
    for (const reason of ["acts", "simulated_allowed"] as const) {
      expect(channelTeamRuns({ available: true, reason }), reason).toBe(true);
      expect(channelEngineMayRun({ available: true, reason }, false), reason).toBe(true);
    }
    const simulatedTap: ChannelAvailability = { available: true, reason: "simulated_allowed", byTap: true };
    expect(channelTeamRuns(simulatedTap)).toBe(true);
    for (const reason of ["no_publisher", "not_connected"] as const) {
      expect(channelTeamRuns({ available: false, reason }), reason).toBe(false);
      expect(channelEngineMayRun({ available: false, reason }, false), reason).toBe(false);
      expect(channelEngineMayRun({ available: false, reason }, true), reason).toBe(true);
    }
    // No answer (an older response): nothing is stopped.
    expect(channelTeamRuns(undefined)).toBe(true);
    expect(channelEngineMayRun(null, false)).toBe(true);
  });

  it("refuses a launch in the founder's words, and names what is ready when the team can run nothing", () => {
    expect(channelByTapRefusal("social")).toBe("Social media is yours to post, one press at a time: the team cannot publish there, so nothing is launched. Open a drafted post and press Share.");
    expect(noChannelSentence({ byTap: ["Social media"] })).toBe(
      "No channel can run on its own yet. Email opens first, as soon as sending is switched on for your project. Nothing is wrong, and nothing is waiting on you. Social media is ready now: you post each one with one press.",
    );
    expect(noChannelSentence({ opensFirst: { label: "Email automation", connectorName: "SendGrid", connectable: true }, byTap: ["Social media"] })).toBe(
      "No channel can run on its own yet. Email automation opens first: connect SendGrid in Settings › Integrations and the team can run it. Nothing is wrong. Social media is ready now: you post each one with one press.",
    );
    expect(noChannelSentence({ byTap: [] })).toBe(noChannelSentence());
  });
});
