import { describe, expect, it } from "vitest";
import { INVALIDATE_ON_EVENT } from "@/components/shell/BusinessShell";
import { agentsStoppedView } from "../agents-stopped";

describe("agentsStoppedView (the top bar's Resume agents)", () => {
  it("is null while the team runs", () => {
    expect(agentsStoppedView({ agentsStoppedAt: null, agentsStoppedReason: null }, "owner")).toBeNull();
    expect(agentsStoppedView({}, "owner")).toBeNull();
  });

  it("names why the team stopped, who may resume and what else brings it back", () => {
    const since = new Date("2026-10-12T15:45:00Z");
    expect(agentsStoppedView({ agentsStoppedAt: since, agentsStoppedReason: "kill_switch" }, "admin")).toEqual({ since, reason: "Stop all agents was pressed", canResume: true, hint: null });
    expect(agentsStoppedView({ agentsStoppedAt: since, agentsStoppedReason: "key_revoked" }, "owner")).toMatchObject({ reason: "the Anthropic key was revoked", hint: expect.stringMatching(/new key in Settings › Keys/) });
    expect(agentsStoppedView({ agentsStoppedAt: since, agentsStoppedReason: "credits_exhausted" }, "member")).toMatchObject({ reason: "this month's credits ran out", canResume: false, hint: expect.stringMatching(/top-up/) });
    // A stop recorded without a reason reads as the strictest one.
    expect(agentsStoppedView({ agentsStoppedAt: since, agentsStoppedReason: null }, "viewer")).toMatchObject({ reason: "Stop all agents was pressed", canResume: false });
  });

  it("a stop or resume in another tab reaches this one: agent.health_changed refetches the business", () => {
    expect(INVALIDATE_ON_EVENT["agent.health_changed"]).toContain("business");
  });
});
