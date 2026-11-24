/** The hand-off to the founder (WP-05 T22, T26): the report's "Needs you" section, and the subjects said once. */
import { describe, expect, it } from "vitest";
import { connectSubject, handOffSubject, needsYouSection } from "../activities/hand-off";

describe("needsYouSection", () => {
  it("takes the lines under a Needs you heading of any level, up to the next heading", () => {
    expect(needsYouSection("## Findings\n\nThree tools.\n\n## Needs you\n\n- Pick a sender name.\n- Approve the price.\n\n## Sources\n\n- a")).toBe("- Pick a sender name.\n- Approve the price.");
    expect(needsYouSection("# needs you\nSet the price.")).toBe("Set the price.");
  });

  it("is empty when the report has no such heading, or it holds nothing", () => {
    expect(needsYouSection("## Findings\n\nNeeds you to read this.")).toBe("");
    expect(needsYouSection("## Needs you\n\n## Sources")).toBe("");
  });
});

describe("subjects", () => {
  it("fit the Inbox's 80 characters", () => {
    expect(connectSubject("GitHub, Notion and Google Drive")).toBe("Connect GitHub, Notion and Google Drive for the team");
    expect(handOffSubject("x".repeat(200)).length).toBeLessThanOrEqual(80);
  });
});
