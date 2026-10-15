import { describe, expect, it } from "vitest";
import { jsonResponse, routedFetch } from "../../http";
import { isUntrusted } from "../../quarantine";
import { describeConnectorContract, envKeysPresent, makeToolContext } from "../../testing/contract-suite";
import { CH_COMPANIES } from "./fixtures/companies";
import { createCompaniesHouseConnector } from "./index";
import { companiesHouseMock } from "./mock";

describeConnectorContract("companies_house (mock)", {
  connector: companiesHouseMock,
  mode: "mock",
  calls: [
    { tool: "search_companies", args: { q: "northwind" }, check: (r) => expect(isUntrusted(r.data) && (r.data.content as { items: unknown[] }).items).toHaveLength(2) }, // the fixture company and the Northwind demo business, each at its own number
    { tool: "get_company", args: { companyNumber: "14523871" }, check: (r) => expect(isUntrusted(r.data) && r.data.content).toMatchObject({ name: "NORTHWIND SKINCARE LTD", sicCodes: ["20420", "47910"] }) },
    { tool: "get_company", args: { companyNumber: "sc654321" }, check: (r) => expect(isUntrusted(r.data) && r.data.source).toMatchObject({ connector: "companies_house", kind: "api", ref: "company:SC654321" }) },
    { tool: "get_company", args: { companyNumber: "00000000" }, expectOk: false, check: (r) => expect(r.error?.code).toBe("not_found") },
    { tool: "get_company", args: { companyNumber: "nope" }, expectOk: false, check: (r) => expect(r.error?.code).toBe("invalid_args") },
    { tool: "list_officers", args: { companyNumber: "14523871" }, check: (r) => expect(isUntrusted(r.data) && r.data.content).toMatchObject({ activeCount: 2, resignedCount: 1 }) },
  ],
});

describe("companies_house live (canned responses)", () => {
  it("sends Basic auth with the key as username and maps the vendor shape", async () => {
    let auth = "";
    const connector = createCompaniesHouseConnector({
      secrets: { companiesHouseApiKey: "test-key" },
      fetch: routedFetch({ "GET https://api.company-information.service.gov.uk/company/14523871": (req) => ((auth = req.headers.get("authorization") ?? ""), jsonResponse(CH_COMPANIES[0])) }),
    });
    const r = await connector.callTool("get_company", { companyNumber: "14523871" }, makeToolContext(connector, { mode: "live" }));
    expect(r.ok).toBe(true);
    expect(auth).toBe(`Basic ${Buffer.from("test-key:").toString("base64")}`);
    expect(isUntrusted(r.data) && r.data.content).toMatchObject({ companyNumber: "14523871", registeredOfficeAddress: { postalCode: "WC2H 9JQ" } });
  });
  it("throws ConfigError without a key", async () => {
    const c = createCompaniesHouseConnector({ secrets: {} });
    await expect(c.callTool("get_company", { companyNumber: "14523871" }, makeToolContext(c, { mode: "live" }))).rejects.toMatchObject({ code: "connector_unconfigured" });
  });
});

describe.skipIf(!envKeysPresent("COMPANIES_HOUSE_API_KEY"))("companies_house (live)", () => {
  describeConnectorContract("companies_house live", { connector: createCompaniesHouseConnector({ secrets: { companiesHouseApiKey: process.env.COMPANIES_HOUSE_API_KEY } }), mode: "live", deterministic: false, calls: [{ tool: "search_companies", args: { q: "Companies House", itemsPerPage: 1 } }] });
});
