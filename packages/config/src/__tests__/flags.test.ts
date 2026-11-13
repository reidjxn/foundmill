import { describe, expect, it } from "vitest";
import { FLAGS, OWN_PLAN_PROVIDERS, SIMULATE_TOKEN_AUDIENCE, SIMULATE_TOKEN_MAX_TTL_SECONDS, isSimulateEnv, ownPlanFunds, simulatePanelHonoured } from "../flags";

describe("the founder's own AI plan (0100)", () => {
  it("is off, with no provider integrated, so no work is billed to a plan", () => {
    expect(FLAGS.ownPlanFunding).toBe(false);
    expect(OWN_PLAN_PROVIDERS).toEqual([]);
    expect(ownPlanFunds("openai")).toBe(false);
  });
  it("funds work only with the flag on and the provider integrated", () => {
    expect(ownPlanFunds("openai", { enabled: true, providers: ["openai"] })).toBe(true);
    expect(ownPlanFunds("openai", { enabled: false, providers: ["openai"] })).toBe(false);
    expect(ownPlanFunds("anthropic", { enabled: true, providers: ["openai"] })).toBe(false);
    expect(ownPlanFunds(null, { enabled: true, providers: ["openai"] })).toBe(false);
  });
});

describe("Simulate panel gate (SEC-2)", () => {
  it("keeps the flag on by default but never honours it without a verified service token", () => {
    expect(FLAGS.devSimulatePanel).toBe(true);
    for (const appEnv of ["development", "staging", "test", "production"]) {
      expect(simulatePanelHonoured({ appEnv, serviceTokenVerified: false }), appEnv).toBe(false);
    }
  });

  it("honours a verified token only in development and staging", () => {
    expect(simulatePanelHonoured({ appEnv: "development", serviceTokenVerified: true })).toBe(true);
    expect(simulatePanelHonoured({ appEnv: "staging", serviceTokenVerified: true })).toBe(true);
    expect(simulatePanelHonoured({ appEnv: "test", serviceTokenVerified: true })).toBe(false);
    expect(simulatePanelHonoured({ appEnv: "production", serviceTokenVerified: true })).toBe(false);
  });

  it("the flag being off closes it everywhere; production stays closed whatever the inputs", () => {
    expect(simulatePanelHonoured({ appEnv: "development", flag: false, serviceTokenVerified: true })).toBe(false);
    expect(simulatePanelHonoured({ appEnv: "production", flag: true, serviceTokenVerified: true })).toBe(false);
    // A truthy non-boolean never passes.
    expect(simulatePanelHonoured({ appEnv: "development", serviceTokenVerified: 1 as unknown as boolean })).toBe(false);
  });

  it("names the environments and the token contract", () => {
    expect(isSimulateEnv("development")).toBe(true);
    expect(isSimulateEnv("staging")).toBe(true);
    expect(isSimulateEnv("production")).toBe(false);
    expect(SIMULATE_TOKEN_AUDIENCE).toBe("foundmill-ingest/simulate");
    expect(SIMULATE_TOKEN_MAX_TTL_SECONDS).toBe(300);
  });
});
