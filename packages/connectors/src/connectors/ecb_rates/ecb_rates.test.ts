import { describe, expect, it } from "vitest";
import { routedFetch } from "../../http";
import { describeConnectorContract, makeToolContext } from "../../testing/contract-suite";
import { ECB_FIXTURE_RATES, ECB_FIXTURE_XML } from "./fixtures/rates";
import { createEcbRatesConnector } from "./index";
import { ecbRatesMock } from "./mock";
import { convertWithRates, minorUnitDigits, parseEcbXml } from "./tools";

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

describe("ecb_rates minor-unit exponents (#350)", () => {
  it("reads each currency's minor-unit digits", () => {
    expect(minorUnitDigits("EUR")).toBe(2);
    expect(minorUnitDigits("jpy")).toBe(0);
    expect(minorUnitDigits("ISK")).toBe(0);
    expect(minorUnitDigits("KRW")).toBe(0);
    expect(minorUnitDigits("KWD")).toBe(3);
    expect(minorUnitDigits("not-a-currency")).toBe(2);
  });

  it("converts cents into whole yen and back instead of treating both as hundredths", () => {
    // 10.00 EUR at 162.91 yen per euro is about 1,629 yen (yen has no minor unit), not 162,910.
    expect(convertWithRates(ECB_FIXTURE_RATES, 1000, "EUR", "JPY").amountMinor).toBe(Math.round(10 * ECB_FIXTURE_RATES.rates.JPY!));
    // 100,000 yen is about 614 euros, which is 61,4xx cents, not 614.
    expect(convertWithRates(ECB_FIXTURE_RATES, 100_000, "JPY", "EUR").amountMinor).toBe(Math.round((100_000 * 100) / ECB_FIXTURE_RATES.rates.JPY!));
    expect(convertWithRates(ECB_FIXTURE_RATES, 100_000, "JPY", "ISK").amountMinor).toBe(Math.round((100_000 * ECB_FIXTURE_RATES.rates.ISK!) / ECB_FIXTURE_RATES.rates.JPY!));
    // two-decimal pairs are unchanged
    expect(convertWithRates(ECB_FIXTURE_RATES, 10_000, "EUR", "USD").amountMinor).toBe(Math.round(10_000 * ECB_FIXTURE_RATES.rates.USD!));
  });
});
