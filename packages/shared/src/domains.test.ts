import { describe, expect, it } from "vitest";
import { DOMAIN_TLDS, domainCandidates, domainSlug, parseDomain } from "./domains";

describe("domains", () => {
  it("accepts label.tld for the allowed TLDs, in any case, and returns it lower case", () => {
    for (const tld of DOMAIN_TLDS) expect(parseDomain(`Ledgerly.${tld.toUpperCase()}`)).toEqual({ domain: `ledgerly.${tld}`, label: "ledgerly", tld });
    expect(parseDomain("my-brand-2.com")?.label).toBe("my-brand-2");
    expect(parseDomain("a.com")?.label).toBe("a");
    expect(parseDomain(`${"a".repeat(63)}.com`)).not.toBeNull();
  });

  it("refuses anything that could build another URL", () => {
    for (const bad of ["", "com", ".com", "a.xyz", "a.com.evil.net", "sub.example.com", "-a.com", "a-.com", `${"a".repeat(64)}.com`, "a b.com", "a_b.com", "a.com/path", "a.com:8080", "a.com?x=1", "a@b.com", "a%2e.com", "ünï.com", "a..com", "http://a.com", "a.com\n.evil.net", "127.0.0.1"]) {
      expect(parseDomain(bad), bad).toBeNull();
    }
  });

  it("turns a business name into one label", () => {
    expect(domainSlug("Ledgerly HQ")).toBe("ledgerlyhq");
    expect(domainSlug("Café Münch & Co.")).toBe("cafemunchco");
    expect(domainSlug("日本")).toBe("");
    expect(domainSlug("x".repeat(64))).toBe("");
    expect(domainCandidates("Ledgerly HQ")).toEqual(["ledgerlyhq.com", "ledgerlyhq.io", "ledgerlyhq.co", "ledgerlyhq.app", "ledgerlyhq.ai"]);
    expect(domainCandidates("   ")).toEqual([]);
    expect(domainCandidates("日本")).toEqual([]);
    for (const d of domainCandidates("Café Münch")) expect(parseDomain(d)).not.toBeNull();
  });
});
