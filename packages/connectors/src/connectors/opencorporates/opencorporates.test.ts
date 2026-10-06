import { describe, expect, it } from "vitest";
import { jsonResponse, routedFetch } from "../../http";
import { isUntrusted } from "../../quarantine";
import { describeConnectorContract, envKeysPresent, makeToolContext } from "../../testing/contract-suite";
import { OC_COMPANIES } from "./fixtures/companies";
import { createOpencorporatesConnector } from "./index";
import { opencorporatesMock } from "./mock";

describeConnectorContract("opencorporates (mock)", {
  connector: opencorporatesMock,
  mode: "mock",
  calls: [
    { tool: "search_companies", args: { q: "Northwind*" }, check: (r) => expect(isUntrusted(r.data) && (r.data.content as { totalCount: number }).totalCount).toBe(2) },
    { tool: "search_companies", args: { q: "Northwind*", jurisdictionCode: "gb" }, check: (r) => expect(isUntrusted(r.data) && (r.data.content as { totalCount: number }).totalCount).toBe(1) },
    { tool: "get_company", args: { jurisdictionCode: "se", companyNumber: "5591234567" }, check: (r) => expect(isUntrusted(r.data) && r.data.content).toMatchObject({ name: "Nordlicht AB", officers: [{ name: "Sara Lindqvist" }] }) },
    { tool: "get_company", args: { jurisdictionCode: "GB", companyNumber: "1" }, expectOk: false, check: (r) => expect(r.error?.code).toBe("invalid_args") },
    { tool: "get_company", args: { jurisdictionCode: "gb", companyNumber: "1" }, expectOk: false, check: (r) => expect(r.error?.code).toBe("not_found") },
  ],
});

describe("opencorporates live (canned)", () => {
  it("passes the api_token as a query parameter and never puts it in the error text", async () => {
    let seenToken = "";
    const connector = createOpencorporatesConnector({
      secrets: { opencorporatesApiToken: "oc-secret-token" },
      fetch: routedFetch({
        "GET https://api.opencorporates.com/v0.4/companies/gb/14523871": (_req, url) => ((seenToken = url.searchParams.get("api_token") ?? ""), jsonResponse({ results: { company: OC_COMPANIES[0] } })),
        "GET https://api.opencorporates.com/v0.4/companies/gb/00000000": () => jsonResponse({ error: "not found" }, { status: 404 }),
      }),
    });
    const ctx = makeToolContext(connector, { mode: "live" });
    const ok = await connector.callTool("get_company", { jurisdictionCode: "gb", companyNumber: "14523871" }, ctx);
    expect(ok.ok).toBe(true);
    expect(seenToken).toBe("oc-secret-token");
    const missing = await connector.callTool("get_company", { jurisdictionCode: "gb", companyNumber: "00000000" }, ctx);
    expect(missing.error?.code).toBe("not_found");
    expect(JSON.stringify(missing)).not.toContain("oc-secret-token");
  });
});

describe.skipIf(!envKeysPresent("OPENCORPORATES_API_TOKEN"))("opencorporates (live)", () => {
  describeConnectorContract("opencorporates live", { connector: createOpencorporatesConnector({ secrets: { opencorporatesApiToken: process.env.OPENCORPORATES_API_TOKEN } }), mode: "live", deterministic: false, calls: [{ tool: "get_company", args: { jurisdictionCode: "gb", companyNumber: "00102498" } }] });
});
