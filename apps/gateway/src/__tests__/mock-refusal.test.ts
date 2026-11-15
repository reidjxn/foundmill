/**
 * An account-free mock connector is refused for a real project (WP-05 T1, AR-01): on staging or production a person's
 * project never receives a simulated web search or exchange rate as if it were read. A sample project still gets the
 * simulated answer. Every account-free connector is live always, refuses a simulated send itself, or is refused here.
 */
import { createBuiltinConnectors, ALWAYS_LIVE_CONNECTORS, SELF_REFUSING_MOCK_CONNECTORS } from "@foundmill/connectors";
import { describe, expect, it } from "vitest";
import { connectionRefusal } from "../pipeline";
import { setupGateway } from "./harness";

describe("account-free connectors in mock mode", () => {
  it("a real project on staging is refused; a sample project gets the simulated answer", async () => {
    const f = await setupGateway({ connector: { authKind: "none" } });
    try {
      const token = await f.token();
      f.deps.appEnv = "staging";
      await expect(f.client.call(token, { connector: "test", tool: "note", args: { text: "x" } })).rejects.toMatchObject({ status: 409, code: "integration_not_connected" });
      expect(f.seen).toHaveLength(0);
      await f.h.pg.query("update businesses set is_demo = true where id = $1", [f.businessId]);
      const r = await f.client.call(token, { connector: "test", tool: "note", args: { text: "x" } });
      expect(r.outcome).toBe("allow");
    } finally {
      await f.close();
    }
  });

  it("says it is not switched on, and leaves the self-refusing ones to themselves", () => {
    const business = { isDemo: false } as never;
    const web = connectionRefusal({ appEnv: "production" }, { connector: { key: "web", displayName: "Web", auth: { kind: "none" } } as never, business, integrationRow: null }, "mock");
    expect(web?.message).toBe("Web is not switched on here yet, so nothing was read or done");
    expect(connectionRefusal({ appEnv: "production" }, { connector: { key: "platform_mail", displayName: "Mail", auth: { kind: "none" } } as never, business, integrationRow: null }, "mock")).toBeNull();
    expect(connectionRefusal({ appEnv: "production" }, { connector: { key: "web", displayName: "Web", auth: { kind: "none" } } as never, business, integrationRow: null }, "live")).toBeNull();
  });

  it("every account-free built-in is always live, refuses a simulated send itself, or is refused", () => {
    const business = { isDemo: false } as never;
    for (const c of createBuiltinConnectors().filter((c) => c.auth.kind === "none")) {
      const covered = ALWAYS_LIVE_CONNECTORS.has(c.key) || SELF_REFUSING_MOCK_CONNECTORS.has(c.key) || connectionRefusal({ appEnv: "production" }, { connector: c, business, integrationRow: null }, "mock") !== null;
      expect(covered, c.key).toBe(true);
    }
  });
});
