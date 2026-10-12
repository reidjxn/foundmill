import { renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it } from "vitest";
import { BusinessProvider, makeBusinessContext, useBusinessCurrency, type BusinessGet } from "../business-context";

const BID = "00000000-0000-4000-8000-000000000001";

/** The business row as `business.get` returns it, with only what the hook reads. */
const businessGet = (currency: string, glossary: Record<string, string> = {}) => ({ business: { id: BID, currency, glossary }, role: "owner" }) as unknown as BusinessGet;

const wrap = (data: BusinessGet) =>
  function Wrapper({ children }: { children: ReactNode }) {
    return <BusinessProvider value={makeBusinessContext(BID, data, [])}>{children}</BusinessProvider>;
  };

describe("useBusinessCurrency (businesses.currency, 0025)", () => {
  it("is the business's own currency from the row the layout holds: no bank account, no glossary entry, no EUR fallback", () => {
    // A dollar business without a bank account used to read EUR (finance.overview's fallback) on every screen.
    expect(renderHook(() => useBusinessCurrency(), { wrapper: wrap(businessGet("USD")) }).result.current).toBe("USD");
    // The glossary is a word map, never a currency source (it used to be read for the Inbox and agent profiles).
    expect(renderHook(() => useBusinessCurrency(), { wrapper: wrap(businessGet("GBP", { currency: "EUR", squad: "lab team" })) }).result.current).toBe("GBP");
  });
});
