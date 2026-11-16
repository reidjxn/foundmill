/**
 * The gateway's one start-up secret (SECURITY_REVIEW SEC-9): SESSION_TOKEN_SECRET signs and verifies every service and
 * session token, so a gateway that is not an explicit local or test run does not start without it, and a local run
 * without it never verifies tokens with a secret anyone could read in the repository.
 */
import { describe, expect, it } from "vitest";
import { loadEnv } from "@foundmill/shared";
import { gatewayConfig } from "../config";

const PUBLISHED_DEV_SECRET = "foundmill-dev-session-token-secret-not-for-production";
const envWith = (overrides: Record<string, string | undefined>) => loadEnv({ INTEGRATIONS_MODE: "mock", MODEL_MODE: "mock", SESSION_TOKEN_SECRET: undefined, ...overrides });

describe("gatewayConfig: SESSION_TOKEN_SECRET", () => {
  it("refuses to start without it on staging and production", () => {
    for (const APP_ENV of ["staging", "production"]) expect(() => gatewayConfig(envWith({ APP_ENV }), "production")).toThrow(/SESSION_TOKEN_SECRET is required/);
  });

  it("refuses to start without it in a deployed process (NODE_ENV=production), whatever APP_ENV says", () => {
    expect(() => gatewayConfig(envWith({ APP_ENV: "test" }), "production")).toThrow(/SESSION_TOKEN_SECRET is required/);
  });

  it("an explicit local or test run starts without it, on a key of its own that is never the published one", () => {
    for (const [APP_ENV, nodeEnv] of [["development", "development"], ["development", undefined], ["test", "test"]] as const) {
      const config = gatewayConfig(envWith({ APP_ENV }), nodeEnv);
      expect(config.sessionTokenSecret).not.toBe(PUBLISHED_DEV_SECRET);
      expect(config.sessionTokenSecret.length).toBeGreaterThanOrEqual(32);
    }
  });

  it("uses the secret it is given, and refuses one that is too short", () => {
    expect(gatewayConfig(envWith({ APP_ENV: "production", SESSION_TOKEN_SECRET: "s".repeat(40) }), "production").sessionTokenSecret).toBe("s".repeat(40));
    expect(() => gatewayConfig(envWith({ APP_ENV: "test", SESSION_TOKEN_SECRET: "short" }), "test")).toThrow(/at least 16/);
  });
});

describe("gatewayConfig: API_SERVICE_TOKEN_SECRET (WP-11 T12)", () => {
  const base = { APP_ENV: "staging", SESSION_TOKEN_SECRET: "shared-session-token-secret-0123456789" };
  it("refuses a secret shorter than 32 characters, and reads the legacy flag", () => {
    expect(() => gatewayConfig(envWith({ ...base, API_SERVICE_TOKEN_SECRET: "a".repeat(31) }), "production")).toThrow(/at least 32/);
    const config = gatewayConfig(envWith({ ...base, API_SERVICE_TOKEN_SECRET: "a".repeat(32), API_SERVICE_TOKEN_LEGACY: "1" }), "production");
    expect(config).toMatchObject({ apiServiceTokenSecret: "a".repeat(32), apiServiceTokenLegacy: true });
    expect(gatewayConfig(envWith(base), "production")).toMatchObject({ apiServiceTokenSecret: null, apiServiceTokenLegacy: false });
  });
});
