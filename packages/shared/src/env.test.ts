import { describe, expect, it } from "vitest";
import { allowMockPayments, bootSummary, connectorMode, KNOWN_CONNECTOR_KEYS, liveConnectorKeys, loadEnv, platformBillingMode, resolveConnectorMode } from "./env";

describe("ALLOW_MOCK_PAYMENTS (SEC2 S10)", () => {
  it("defaults to on only in development and test; an explicit value wins anywhere", () => {
    expect(allowMockPayments(loadEnv({ APP_ENV: "development", ALLOW_MOCK_PAYMENTS: undefined }))).toBe(true);
    expect(allowMockPayments(loadEnv({ APP_ENV: "test", ALLOW_MOCK_PAYMENTS: "" }))).toBe(true);
    expect(allowMockPayments(loadEnv({ APP_ENV: "staging", ALLOW_MOCK_PAYMENTS: undefined, MODEL_MODE: "mock" }))).toBe(false);
    expect(allowMockPayments(loadEnv({ APP_ENV: "production", ALLOW_MOCK_PAYMENTS: undefined }))).toBe(false);
    expect(allowMockPayments(loadEnv({ APP_ENV: "staging", ALLOW_MOCK_PAYMENTS: "true" }))).toBe(true);
    expect(allowMockPayments(loadEnv({ APP_ENV: "staging", ALLOW_MOCK_PAYMENTS: "1" }))).toBe(true);
    expect(allowMockPayments(loadEnv({ APP_ENV: "development", ALLOW_MOCK_PAYMENTS: "0" }))).toBe(false);
    expect(allowMockPayments(loadEnv({ APP_ENV: "test", ALLOW_MOCK_PAYMENTS: "FALSE" }))).toBe(false);
  });
});

describe("per-connector integrations mode", () => {
  it("runs the connectors LIVE_CONNECTORS names live while the rest stay mock", () => {
    const env = loadEnv({ INTEGRATIONS_MODE: "mock", LIVE_CONNECTORS: " github , stripe,," });
    expect(liveConnectorKeys(env)).toEqual(["github", "stripe"]);
    expect(connectorMode(env, "github")).toBe("live");
    expect(connectorMode(env, "gmail")).toBe("mock");
    expect(connectorMode(loadEnv({ INTEGRATIONS_MODE: "mock" }), "github")).toBe("mock");
  });

  it("AC-1 with INTEGRATIONS_MODE=live, connectors not in LIVE_CONNECTORS resolve to mock", () => {
    const env = loadEnv({ INTEGRATIONS_MODE: "live", LIVE_CONNECTORS: "github" });
    expect(connectorMode(env, "github")).toBe("live");
    expect(connectorMode(env, "gmail")).toBe("mock");
    expect(resolveConnectorMode("live", ["github"], "gmail")).toBe("mock");
  });

  it("AC-2 an empty or unset LIVE_CONNECTORS means no connector is live", () => {
    for (const LIVE_CONNECTORS of ["", "  ", " , ,", undefined]) {
      const env = loadEnv({ INTEGRATIONS_MODE: "live", LIVE_CONNECTORS });
      expect(liveConnectorKeys(env)).toEqual([]);
      for (const key of KNOWN_CONNECTOR_KEYS) expect(connectorMode(env, key)).toBe("mock");
    }
  });

  it("AC-3 unknown connector names in LIVE_CONNECTORS fail boot with a clear error", () => {
    expect(() => loadEnv({ INTEGRATIONS_MODE: "live", LIVE_CONNECTORS: "github, gitub,nope" })).toThrow(/LIVE_CONNECTORS names unknown connector\(s\) "gitub", "nope"/);
    expect(() => loadEnv({ LIVE_CONNECTORS: "github,stripe_billing,platform" })).not.toThrow();
  });

  it("AC-4 the boot summary holds APP_ENV, INTEGRATIONS_MODE and the live list, nothing else", () => {
    const env = loadEnv({ APP_ENV: "staging", INTEGRATIONS_MODE: "live", LIVE_CONNECTORS: "github, stripe", SESSION_TOKEN_SECRET: "super-secret-value-123" });
    const summary = bootSummary(env);
    expect(summary).toEqual({ appEnv: "staging", integrationsMode: "live", liveConnectors: ["github", "stripe"] });
    expect(JSON.stringify(summary)).not.toContain("super-secret");
  });

  it("switches the platform's own billing separately from the businesses' Stripe connector", () => {
    const billing = loadEnv({ INTEGRATIONS_MODE: "mock", LIVE_CONNECTORS: "stripe_billing" });
    expect(platformBillingMode(billing)).toBe("live");
    expect(connectorMode(billing, "stripe")).toBe("mock");
    expect(platformBillingMode(loadEnv({ INTEGRATIONS_MODE: "mock", LIVE_CONNECTORS: "stripe" }))).toBe("mock");
    expect(platformBillingMode(loadEnv({ INTEGRATIONS_MODE: "live" }))).toBe("mock");
    expect(platformBillingMode(loadEnv({ INTEGRATIONS_MODE: "live", LIVE_CONNECTORS: "stripe_billing" }))).toBe("live");
  });
});

describe("development-only settings", () => {
  const DEV_USER = "00000000-0000-4000-8000-000000000001";
  const devKnobs = { DEV_AUTH_USER_ID: DEV_USER, MOCK_MODEL_LATENCY_MS: "4000", MOCK_MODEL_STREAM_MS: "250" };

  it("are honoured in development and test", () => {
    for (const APP_ENV of ["development", "test"]) {
      const env = loadEnv({ APP_ENV, ...devKnobs });
      expect(env.DEV_AUTH_USER_ID).toBe(DEV_USER);
      expect(env.MOCK_MODEL_LATENCY_MS).toBe(4000);
      expect(env.MOCK_MODEL_STREAM_MS).toBe(250);
    }
  });

  it("never turn on in staging or production, even when the variables are set", () => {
    for (const APP_ENV of ["staging", "production"]) {
      const env = loadEnv({ APP_ENV, ...devKnobs });
      expect(env.DEV_AUTH_USER_ID).toBeUndefined();
      expect(env.MOCK_MODEL_LATENCY_MS).toBe(0);
      expect(env.MOCK_MODEL_STREAM_MS).toBe(0);
    }
  });

  it("leave the new model settings at their safe defaults when unset", () => {
    const env = loadEnv({ APP_ENV: "staging", MODEL_FAST_MODE: undefined, MOCK_MODEL_LATENCY_MS: undefined, MOCK_MODEL_STREAM_MS: undefined });
    expect(env.MODEL_FAST_MODE).toBe(false);
    expect(env.MOCK_MODEL_LATENCY_MS).toBe(0);
    expect(env.MOCK_MODEL_STREAM_MS).toBe(0);
    expect(loadEnv({ MODEL_FAST_MODE: "1" }).MODEL_FAST_MODE).toBe(true);
    expect(loadEnv({ MODEL_FAST_MODE: "yes" }).MODEL_FAST_MODE).toBe(false);
  });
});
