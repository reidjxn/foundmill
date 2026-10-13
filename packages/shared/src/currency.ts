/**
 * Currency codes (ISO 4217). Every place that accepts a currency from a person or a client validates it here, so a
 * malformed code ("1$X") never reaches a money field, where `Intl.NumberFormat` would throw `RangeError` on every
 * screen that formats it (audit ARB-15).
 */
import { z } from "zod";

type IntlWithValues = typeof Intl & { supportedValuesOf?: (key: "currency") => string[] };

/** The codes this runtime's Intl knows; null where `Intl.supportedValuesOf` is missing (then the format alone is checked). */
const KNOWN: ReadonlySet<string> | null = (() => {
  try {
    const list = (Intl as IntlWithValues).supportedValuesOf?.("currency");
    return list?.length ? new Set(list) : null;
  } catch {
    return null;
  }
})();

/** Three capital letters that Intl formats as a currency. */
export function isCurrencyCode(code: string): boolean {
  return /^[A-Z]{3}$/.test(code) && (KNOWN === null || KNOWN.has(code));
}

/** A currency code as typed or sent: trimmed, upper-cased, then checked. */
export const CurrencyCode = z
  .string()
  .trim()
  .toUpperCase()
  .refine(isCurrencyCode, { message: "Use a three-letter currency code, such as USD, GBP or EUR." });
export type CurrencyCode = z.infer<typeof CurrencyCode>;
