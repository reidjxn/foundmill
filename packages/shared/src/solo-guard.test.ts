import { describe, expect, it } from "vitest";
import { SOLO_GUARD_PHRASES, soloGuardViolations } from "./solo-guard";

describe("soloGuardViolations", () => {
  it.each(["Invite someone", "find a cofounder", "Find a co-founder", "add a collaborator", "find a partner", "Team up with a friend", "0 people", "No people yet", "Add someone"])("flags %s", (text) => {
    expect(soloGuardViolations(text).length).toBeGreaterThan(0);
  });

  it.each(["the team", "Your team is drafting your page", "Settings › People", "invitation accepted", "10 people read it", "Built by you", "A partnership of agents"])("passes %s", (text) => {
    expect(soloGuardViolations(text)).toEqual([]);
  });

  it("returns what it matched, once per phrase", () => {
    expect(soloGuardViolations("Invite someone, or invite your friend")).toEqual(["Invite someone"]);
    expect(SOLO_GUARD_PHRASES.length).toBe(8);
  });
});
