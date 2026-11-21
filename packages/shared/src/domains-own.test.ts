import { describe, expect, it } from "vitest";
import { normalizeOwnDomain, OWN_DOMAIN_SENDER_RE, ownDomainSendingReady, ownDomainSiteRecord } from "./domains";

describe("normalizeOwnDomain", () => {
  it("keeps the domain a founder typed, however they typed it", () => {
    expect(normalizeOwnDomain(" Acme.COM ", "Foundmill")).toBe("acme.com");
    expect(normalizeOwnDomain("https://www.acme.co.uk/about?x=1", "Foundmill")).toBe("acme.co.uk");
    expect(normalizeOwnDomain("acme.com.", "Foundmill")).toBe("acme.com");
    expect(normalizeOwnDomain("shop.acme.com:443", "Foundmill")).toBe("shop.acme.com");
    expect(normalizeOwnDomain("xn--bcher-kva.example", "Foundmill")).toBe("xn--bcher-kva.example");
  });

  it("refuses what is not a domain, and the product's own name", () => {
    for (const bad of ["", "acme", "acme.c", "-acme.com", "acme-.com", "ac me.com", "a@acme.com", "acme.123", "mail.foundmill.com", "found-mill.app", "localhost"]) expect(normalizeOwnDomain(bad, "Foundmill")).toBeNull();
  });
});

describe("own-domain records", () => {
  it("sending is ready only when every sending record was found", () => {
    const sending = (found: boolean | null) => ({ purpose: "sending" as const, type: "CNAME" as const, host: "em.acme.com", value: "u1.wl.sendgrid.net", found });
    expect(ownDomainSendingReady([])).toBe(false);
    expect(ownDomainSendingReady([sending(true), sending(null)])).toBe(false);
    expect(ownDomainSendingReady([sending(true), { ...ownDomainSiteRecord("acme.com", "acme.foundmill.app"), found: false }])).toBe(true);
  });

  it("the site record is www on the domain, pointing at the site address", () => {
    expect(ownDomainSiteRecord("acme.com", "acme.foundmill.app")).toEqual({ purpose: "site", type: "CNAME", host: "www.acme.com", value: "acme.foundmill.app", found: null });
  });

  it("sender names are plain local parts", () => {
    for (const ok of ["hello", "maya", "maya.lee", "team_1"]) expect(OWN_DOMAIN_SENDER_RE.test(ok)).toBe(true);
    for (const bad of ["", ".maya", "maya.", "ma ya", "maya@x", "Maya"]) expect(OWN_DOMAIN_SENDER_RE.test(bad)).toBe(false);
  });
});
