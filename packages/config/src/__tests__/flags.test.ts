import { describe, expect, it } from "vitest";
import { FLAGS, SIMULATE_TOKEN_AUDIENCE, SIMULATE_TOKEN_MAX_TTL_SECONDS, isSimulateEnv, simulatePanelHonoured } from "../flags";

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
