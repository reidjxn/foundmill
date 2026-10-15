/**
 * The expected finish an agent is told about is a US date in words ("Oct 11"), never the ISO day: the agent quotes it as
 * written, so an ISO date reached the founder in replies (CLAUDE.md 2026-10-10, US dates everywhere a user can read).
 */
import { describe, expect, it } from "vitest";
import { etaWords } from "../services/conversation";

describe("etaWords", () => {
  const now = new Date("2026-10-07T12:00:00Z");

  it("reads the expected day as a US date without the year in the current year", () => {
    expect(etaWords(new Date("2026-10-11T09:00:00Z"), now)).toBe("Oct 11");
  });

  it("adds the year when the expected day falls in another year", () => {
    expect(etaWords(new Date("2027-01-04T00:00:00Z"), now)).toBe("Jan 4, 2027");
  });

  it("reads the UTC day, so a late-evening expected finish keeps its day", () => {
    expect(etaWords(new Date("2026-10-11T23:30:00Z"), now)).toBe("Oct 11");
  });

  it("never prints an ISO date", () => {
    expect(etaWords(new Date("2026-10-11T09:00:00Z"), now)).not.toMatch(/\d{4}-\d{2}-\d{2}/);
  });
});
