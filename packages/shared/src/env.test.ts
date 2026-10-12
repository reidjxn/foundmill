import { describe, expect, it } from "vitest";
import { allowMockPayments, connectorMode, liveConnectorKeys, loadEnv } from "./env";

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
    expect(connectorMode(loadEnv({ INTEGRATIONS_MODE: "live", LIVE_CONNECTORS: "" }), "gmail")).toBe("live");
    expect(connectorMode(loadEnv({ INTEGRATIONS_MODE: "mock" }), "github")).toBe("mock");
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
