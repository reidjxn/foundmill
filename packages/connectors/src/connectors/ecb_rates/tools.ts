/** ECB euro foreign exchange reference rates (daily). Base currency is always EUR. */
import { z } from "zod";
import { defineTool } from "../../define";

export const ECB_KEY = "ecb_rates";
export const ECB_DAILY_XML_URL = "https://www.ecb.europa.eu/stats/eurofxref/eurofxref-daily.xml";

export const RatesOut = z.object({
  date: z.string(),
  base: z.literal("EUR"),
  rates: z.record(z.string().length(3), z.number().positive()),
  source: z.string(),
  label: z.literal("Estimate"),
});
export type Rates = z.infer<typeof RatesOut>;

export const ecbTools = [
  defineTool({
    name: "get_daily_rates",
    description: "Latest ECB euro reference rates (one EUR in each currency). Published once per business day around 4:00 PM CET; treat as an estimate for conversions.",
    input: z.object({}),
    output: RatesOut,
    hints: {},
    annotations: { readOnlyHint: true, idempotentHint: true },
  }),
  defineTool({
    name: "convert",
    description: "Convert an amount in minor units between two currencies using the latest ECB reference rates (estimate; not a quote).",
    input: z.object({ amountMinor: z.number().int(), from: z.string().length(3), to: z.string().length(3) }),
    output: z.object({ amountMinor: z.number().int(), from: z.string(), to: z.string(), rate: z.number().positive(), date: z.string(), label: z.literal("Estimate") }),
    hints: {},
    annotations: { readOnlyHint: true, idempotentHint: true },
  }),
] as const;

export const ECB_RATE_LIMITS = { perMinute: 10, perDay: 200 };

/** Decimal places of a currency's minor unit (2 for EUR, 0 for JPY, ISK, KRW, 3 for KWD), from the platform's ICU data. */
export function minorUnitDigits(currency: string): number {
  try {
    return new Intl.NumberFormat("en-US", { style: "currency", currency: currency.toUpperCase() }).resolvedOptions().maximumFractionDigits ?? 2;
  } catch {
    return 2;
  }
}

/**
 * Converts an amount in `from`'s minor units into `to`'s minor units. The rate is between whole units (one EUR in
 * yen), so the amount is scaled by the difference of the two currencies' minor-unit digits: 10.00 EUR (1000 cents) is
 * about 1,629 yen, not 162,910.
 */
export function convertWithRates(rates: Rates, amountMinor: number, from: string, to: string) {
  const f = from.toUpperCase();
  const t = to.toUpperCase();
  const perEur = (ccy: string): number => {
    if (ccy === "EUR") return 1;
    const r = rates.rates[ccy];
    if (!r) throw Object.assign(new Error(`ECB does not publish a rate for ${ccy}`), { status: 404 });
    return r;
  };
  const rate = perEur(t) / perEur(f);
  const scale = 10 ** (minorUnitDigits(t) - minorUnitDigits(f));
  return { amountMinor: Math.round(amountMinor * rate * scale), from: f, to: t, rate: Number(rate.toFixed(6)), date: rates.date, label: "Estimate" as const };
}

/** Parse the ECB daily XML (`<Cube time='…'><Cube currency='USD' rate='1.08'/>…`). No XML dependency needed. */
export function parseEcbXml(xml: string): Rates {
  const date = /<Cube[^>]*time=['"](\d{4}-\d{2}-\d{2})['"]/.exec(xml)?.[1];
  if (!date) throw new Error("ECB XML: missing time cube");
  const rates: Record<string, number> = {};
  for (const m of xml.matchAll(/<Cube[^>]*currency=['"]([A-Z]{3})['"][^>]*rate=['"]([\d.]+)['"]/g)) {
    rates[m[1]!] = Number(m[2]);
  }
  if (Object.keys(rates).length === 0) throw new Error("ECB XML: no rates");
  return { date, base: "EUR", rates, source: ECB_DAILY_XML_URL, label: "Estimate" };
}
