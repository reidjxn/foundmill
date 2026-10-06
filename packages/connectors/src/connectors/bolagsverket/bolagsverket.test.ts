import { describe, expect, it } from "vitest";
import { jsonResponse, routedFetch } from "../../http";
import { isUntrusted } from "../../quarantine";
import { describeConnectorContract, envKeysPresent, makeToolContext } from "../../testing/contract-suite";
import { BV_ORGANISATIONS } from "./fixtures/organisations";
import { createBolagsverketConnector } from "./index";
import { bolagsverketMock } from "./mock";

describeConnectorContract("bolagsverket (mock)", {
  connector: bolagsverketMock,
  mode: "mock",
  calls: [
    { tool: "get_organisation", args: { organisationNumber: "559123-4567" }, check: (r) => expect(isUntrusted(r.data) && r.data.content).toMatchObject({ organisationNumber: "5591234567", name: "Nordlicht AB", status: "active", legalFormCode: "AB" }) },
    { tool: "get_organisation", args: { organisationNumber: "5590001122" }, check: (r) => expect(isUntrusted(r.data) && r.data.content).toMatchObject({ status: "deregistered", deregisteredAt: "2025-06-30" }) },
    { tool: "get_organisation", args: { organisationNumber: "12-34" }, expectOk: false, check: (r) => expect(r.error?.code).toBe("invalid_args") },
    { tool: "list_documents", args: { organisationNumber: "559123-4567" }, check: (r) => expect(isUntrusted(r.data) && (r.data.content as { items: unknown[] }).items).toHaveLength(3) },
  ],
});

describe("bolagsverket live (canned)", () => {
  it("fetches a client-credentials token once with Basic auth and reuses it", async () => {
    let tokenCalls = 0;
    const connector = createBolagsverketConnector({
      secrets: { bolagsverketClientId: "cid", bolagsverketClientSecret: "csecret" },
      fetch: routedFetch({
        "POST https://portal.api.bolagsverket.se/oauth2/token": async (req) => {
          tokenCalls++;
          expect(req.headers.get("authorization")).toBe(`Basic ${Buffer.from("cid:csecret").toString("base64")}`);
          expect(await req.text()).toContain("grant_type=client_credentials");
          return jsonResponse({ access_token: "tok", expires_in: 3600 });
        },
        "POST https://gw.api.bolagsverket.se/vardefulla-datamangder/v1/organisationer": async (req) => {
          expect(req.headers.get("authorization")).toBe("Bearer tok");
          const body = (await req.json()) as { identitetsbeteckning: string };
          return jsonResponse({ organisationer: [BV_ORGANISATIONS[body.identitetsbeteckning]] });
        },
      }),
    });
    const ctx = makeToolContext(connector, { mode: "live" });
    const a = await connector.callTool("get_organisation", { organisationNumber: "559123-4567" }, ctx);
    const b = await connector.callTool("get_organisation", { organisationNumber: "5566778899" }, ctx);
    expect(a.ok && b.ok).toBe(true);
    expect(tokenCalls).toBe(1);
    expect(isUntrusted(b.data) && b.data.content).toMatchObject({ name: "Hallbergs Hud AB" });
  });
  it("throws ConfigError without client credentials", async () => {
    const c = createBolagsverketConnector({ secrets: {} });
    await expect(c.callTool("get_organisation", { organisationNumber: "5591234567" }, makeToolContext(c, { mode: "live" }))).rejects.toMatchObject({ code: "connector_unconfigured" });
  });
});

describe.skipIf(!envKeysPresent("BOLAGSVERKET_CLIENT_ID", "BOLAGSVERKET_CLIENT_SECRET"))("bolagsverket (live)", () => {
  describeConnectorContract("bolagsverket live", { connector: createBolagsverketConnector({ secrets: { bolagsverketClientId: process.env.BOLAGSVERKET_CLIENT_ID, bolagsverketClientSecret: process.env.BOLAGSVERKET_CLIENT_SECRET } }), mode: "live", deterministic: false, calls: [{ tool: "get_organisation", args: { organisationNumber: "5560125790" } }] });
});
