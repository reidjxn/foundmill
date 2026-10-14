/**
 * Which webhooks a deployment may mount (audit SIEC-1 / SECX-1 / GPC-06): mock verifiers check signatures against secrets
 * committed to the repository, so they are mounted in development and test only; staging and production mount a
 * connector's webhook only when it runs live (INTEGRATIONS_MODE=live or LIVE_CONNECTORS).
 */
import { describe, expect, it } from "vitest";
import { createDefaultRegistry } from "../catalogue";
import { isMockConnector } from "../define";
import { MOCK_WEBHOOK_ENVS, mockWebhooksAllowed } from "../webhooks";

const registry = createDefaultRegistry({ secrets: {} });
const WEBHOOK_CONNECTORS = ["dropbox_sign", "github", "sendgrid", "shopify", "stripe"];

describe("mountableWebhooks", () => {
  it("mounts the mock webhooks in development and test", () => {
    for (const appEnv of MOCK_WEBHOOK_ENVS) {
      const { mounted, refused } = registry.mountableWebhooks({ mode: "mock", appEnv });
      expect(refused).toEqual([]);
      expect([...new Set(mounted.map((m) => m.connector))].sort()).toEqual(WEBHOOK_CONNECTORS);
      expect(mounted.every((m) => m.mode === "mock")).toBe(true);
      expect(mounted.map((m) => m.path)).toContain("/webhooks/sendgrid-inbound/:businessId");
    }
  });

  it("refuses every mock webhook in staging and production, whatever INTEGRATIONS_MODE says", () => {
    for (const appEnv of ["staging", "production"]) {
      const { mounted, refused } = registry.mountableWebhooks({ mode: "mock", appEnv });
      expect(mounted).toEqual([]);
      expect(refused.sort()).toEqual(WEBHOOK_CONNECTORS);
      expect(mockWebhooksAllowed(appEnv)).toBe(false);
    }
  });

  it("mounts the live webhook of a connector named in LIVE_CONNECTORS, and only that one", () => {
    const { mounted, refused } = registry.mountableWebhooks({ mode: "mock", appEnv: "staging", liveConnectors: ["github"] });
    expect(mounted.map((m) => [m.connector, m.mode])).toEqual([["github", "live"]]);
    expect(isMockConnector(registry.get("github", "live"))).toBe(false);
    expect(refused).not.toContain("github");
    expect(refused).toContain("stripe");
  });

  it("mounts every live webhook in live mode", () => {
    const { mounted, refused } = registry.mountableWebhooks({ mode: "live", appEnv: "production" });
    expect(refused).toEqual([]);
    expect([...new Set(mounted.map((m) => m.connector))].sort()).toEqual(WEBHOOK_CONNECTORS);
    expect(mounted.every((m) => m.mode === "live")).toBe(true);
  });
});
