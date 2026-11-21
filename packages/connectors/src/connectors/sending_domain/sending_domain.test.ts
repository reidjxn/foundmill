/**
 * `sending_domain` (WP-08 domain plan, Path B): SendGrid's domain authentication on the platform key, on the `em`
 * subdomain with automatic security; the validation answer read record by record; and the DNS check for the other
 * records. The mock answers the same shapes offline.
 */
import { describe, expect, it } from "vitest";
import { routedFetch } from "../../http";
import { makeToolContext } from "../../testing/contract-suite";
import { checkRecord, createSendingDomainConnector, MOCK_NOT_YET_MARKER, recordMatches, recordsFromSendgrid, sendingDomainMock, type RecordDns } from "./index";

const SG_DNS = {
  dkim2: { valid: false, type: "cname", host: "s2._domainkey.acme.com", data: "s2.domainkey.u123.wl.sendgrid.net" },
  mail_cname: { valid: false, type: "cname", host: "em.acme.com", data: "u123.wl.sendgrid.net" },
  dkim1: { valid: false, type: "cname", host: "s1._domainkey.acme.com", data: "s1.domainkey.u123.wl.sendgrid.net" },
};

const noDns: RecordDns = { resolveCname: async () => [], resolveMx: async () => [], resolveTxt: async () => [] };

describe("sending_domain (live)", () => {
  it("authenticates the domain on the em subdomain with automatic security, on the platform key", async () => {
    let body: Record<string, unknown> | null = null;
    let auth: string | null = null;
    const connector = createSendingDomainConnector({
      secrets: { sendgridApiKey: "SG.platform-test-key" },
      dns: noDns,
      fetch: routedFetch({
        "POST https://api.sendgrid.com/v3/whitelabel/domains": async (req) => {
          auth = req.headers.get("authorization");
          body = (await req.json()) as Record<string, unknown>;
          return Response.json({ id: 123, domain: "acme.com", subdomain: "em", dns: SG_DNS });
        },
      }),
    });
    const r = await connector.callTool("authenticate_domain", { domain: "acme.com", subdomain: "em" }, makeToolContext(connector, { mode: "live" }));
    expect(r.ok).toBe(true);
    expect(auth).toBe("Bearer SG.platform-test-key");
    expect(body).toEqual({ domain: "acme.com", subdomain: "em", automatic_security: true, custom_spf: false, default: false });
    expect(r.data).toEqual({ sendgridDomainId: "123", records: recordsFromSendgrid(SG_DNS) });
    expect((r.data as { records: { host: string }[] }).records.map((x) => x.host)).toEqual(["em.acme.com", "s1._domainkey.acme.com", "s2._domainkey.acme.com"]);
  });

  it("reads SendGrid's validation record by record", async () => {
    const connector = createSendingDomainConnector({
      secrets: { sendgridApiKey: "SG.k" },
      dns: noDns,
      fetch: routedFetch({
        "GET https://api.sendgrid.com/v3/whitelabel/domains/123": async () => Response.json({ id: 123, dns: SG_DNS }),
        "POST https://api.sendgrid.com/v3/whitelabel/domains/123/validate": async () =>
          Response.json({ id: 123, valid: false, validation_results: { mail_cname: { valid: true, reason: null }, dkim1: { valid: false, reason: "Expected CNAME to match s1.domainkey.u123.wl.sendgrid.net." }, dkim2: { valid: true, reason: null } } }),
      }),
    });
    const r = await connector.callTool("validate_domain", { sendgridDomainId: "123", domain: "acme.com" }, makeToolContext(connector, { mode: "live" }));
    expect(r.ok).toBe(true);
    const data = r.data as { valid: boolean; results: { host: string; found: boolean; reason?: string }[] };
    expect(data.valid).toBe(false);
    expect(data.results.find((x) => x.host === "em.acme.com")).toEqual({ host: "em.acme.com", found: true });
    expect(data.results.find((x) => x.host === "s1._domainkey.acme.com")?.found).toBe(false);
  });

  it("refuses without the platform key", async () => {
    const connector = createSendingDomainConnector({ secrets: {}, dns: noDns, fetch: routedFetch({}) });
    await expect(connector.callTool("authenticate_domain", { domain: "acme.com", subdomain: "em" }, makeToolContext(connector, { mode: "live" }))).rejects.toThrow(/SENDGRID_API_KEY/);
  });

  it("checks other records in DNS: a match, another value, nothing there", async () => {
    const dns: RecordDns = {
      resolveCname: async (n) => (n === "www.acme.com" ? ["Acme.Foundmill.App."] : Promise.reject(Object.assign(new Error("nf"), { code: "ENOTFOUND" }))),
      resolveMx: async () => [{ exchange: "mx.other.net", priority: 10 }],
      resolveTxt: async () => [["v=DMARC1; ", "p=none"]],
    };
    expect(await checkRecord(dns, { type: "CNAME", host: "www.acme.com", value: "acme.foundmill.app" })).toEqual({ found: true });
    expect(await checkRecord(dns, { type: "CNAME", host: "shop.acme.com", value: "acme.foundmill.app" })).toEqual({ found: false, reason: "Not found yet." });
    expect((await checkRecord(dns, { type: "MX", host: "acme.com", value: "mx.sendgrid.net" })).found).toBe(false);
    expect(await checkRecord(dns, { type: "TXT", host: "_dmarc.acme.com", value: "v=DMARC1; p=none" })).toEqual({ found: true });
    expect(recordMatches({ type: "MX", host: "acme.com", value: "mx.sendgrid.net" }, { mx: [{ exchange: "MX.SendGrid.net.", priority: 10 }] })).toBe(true);
  });
});

describe("sending_domain (mock)", () => {
  it("answers offline: found, except a name with the marker", async () => {
    const ctx = makeToolContext(sendingDomainMock);
    const added = await sendingDomainMock.callTool("authenticate_domain", { domain: "acme.com", subdomain: "em" }, ctx);
    const id = (added.data as { sendgridDomainId: string }).sendgridDomainId;
    expect((await sendingDomainMock.callTool("validate_domain", { sendgridDomainId: id, domain: "acme.com" }, ctx)).data).toMatchObject({ valid: true });
    expect((await sendingDomainMock.callTool("validate_domain", { sendgridDomainId: id, domain: `${MOCK_NOT_YET_MARKER}.com` }, ctx)).data).toMatchObject({ valid: false });
    expect((await sendingDomainMock.callTool("check_records", { records: [{ type: "CNAME", host: `www.${MOCK_NOT_YET_MARKER}.com`, value: "x.foundmill.app" }] }, ctx)).data).toEqual({ results: [{ found: false, reason: "Not found yet." }] });
  });
});
