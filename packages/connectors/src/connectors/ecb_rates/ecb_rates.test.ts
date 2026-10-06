import { describe, expect, it } from "vitest";
import { routedFetch } from "../../http";
import { describeConnectorContract, makeToolContext } from "../../testing/contract-suite";
import { ECB_FIXTURE_RATES, ECB_FIXTURE_XML } from "./fixtures/rates";
import { createEcbRatesConnector } from "./index";
import { ecbRatesMock } from "./mock";
import { parseEcbXml } from "./tools";

describeConnectorContract("ecb_rates (mock)", {
  connector: ecbRatesMock,
  mode: "mock",
  calls: [
    { tool: "get_daily_rates", args: {}, check: (r) => expect(r.data).toMatchObject({ base: "EUR", label: "Estimate" }) },
    { tool: "convert", args: { amountMinor: 10_000, from: "EUR", to: "USD" }, check: (r) => expect(r.data).toMatchObject({ amountMinor: Math.round(10_000 * ECB_FIXTURE_RATES.rates.USD!), rate: ECB_FIXTURE_RATES.rates.USD }) },
    { tool: "convert", args: { amountMinor: 10_000, from: "GBP", to: "SEK" }, check: (r) => expect((r.data as { amountMinor: number }).amountMinor).toBe(Math.round((10_000 * ECB_FIXTURE_RATES.rates.SEK!) / ECB_FIXTURE_RATES.rates.GBP!)) },
    { tool: "convert", args: { amountMinor: 1, from: "EUR", to: "XXX" }, expectOk: false, check: (r) => expect(r.error?.code).toBe("not_found") },
  ],
});

describe("ecb_rates live parsing (no network)", () => {
  it("parses the ECB XML feed and serves conversions from it", async () => {
    expect(parseEcbXml(ECB_FIXTURE_XML).rates).toEqual(ECB_FIXTURE_RATES.rates);
    let hits = 0;
    const connector = createEcbRatesConnector({
      fetch: routedFetch({ "GET https://www.ecb.europa.eu/stats/eurofxref/eurofxref-daily.xml": () => (hits++, new Response(ECB_FIXTURE_XML, { headers: { "content-type": "application/xml" } })) }),
    });
    const ctx = makeToolContext(connector, { mode: "live" });
    const a = await connector.callTool("get_daily_rates", {}, ctx);
    const b = await connector.callTool("convert", { amountMinor: 100, from: "USD", to: "EUR" }, ctx);
    expect(a.ok && b.ok).toBe(true);
    expect(hits).toBe(1); // cached
    expect((b.data as { amountMinor: number }).amountMinor).toBe(Math.round(100 / ECB_FIXTURE_RATES.rates.USD!));
  });
});
