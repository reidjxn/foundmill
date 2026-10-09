import { describe, expect, it } from "vitest";
import { connectorMode, liveConnectorKeys, loadEnv } from "./env";

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
