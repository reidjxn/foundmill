import { describe, expect, it } from "vitest";
import { jsonResponse, routedFetch } from "../../http";
import { describeConnectorContract, envKeysPresent, makeToolContext } from "../../testing/contract-suite";
import { CF_RECORDS, CF_ZONES } from "./fixtures/zones";
import { createCloudflareDnsConnector } from "./index";
import { cloudflareDnsMock, createCloudflareMock } from "./mock";

const NW = CF_ZONES[0].id;
const LG = CF_ZONES[1].id;

describeConnectorContract("cloudflare_dns (mock)", {
  connector: cloudflareDnsMock,
  mode: "mock",
  calls: [
    { tool: "list_zones", args: {}, check: (r) => expect((r.data as { items: unknown[] }).items).toHaveLength(2) },
    { tool: "list_records", args: { zoneId: NW, type: "TXT" }, check: (r) => expect((r.data as { items: unknown[] }).items).toHaveLength(2) },
    { tool: "check_email_auth", args: { zoneId: NW }, check: (r) => expect(r.data).toMatchObject({ ready: true, spf: { includesSendgrid: true }, dkim: { selectors: ["s1", "s2"] }, dmarc: { policy: "quarantine" } }) },
    { tool: "check_email_auth", args: { zoneId: LG }, check: (r) => expect(r.data).toMatchObject({ ready: false, spf: { found: true, includesSendgrid: false }, dkim: { found: false }, dmarc: { found: false } }) },
    { tool: "create_record", args: { zoneId: LG, type: "TXT", name: "_dmarc.ledgerly.app", content: "v=DMARC1; p=none" }, check: (r) => expect(r.data).toMatchObject({ type: "TXT", name: "_dmarc.ledgerly.app", ttl: 1 }) },
    { tool: "delete_record", args: { zoneId: NW, recordId: "ffffffffffffffffffffffffffffffff", type: "A", recordName: "northwindskincare.com" }, expectOk: false, check: (r) => expect(r.error?.code).toBe("not_found") },
  ],
});

describe("cloudflare mock record lifecycle", () => {
  it("creates, updates and deletes records in memory", async () => {
    const mock = createCloudflareMock();
    const ctx = makeToolContext(mock);
    const created = await mock.callTool("create_record", { zoneId: LG, type: "CNAME", name: "s1._domainkey.ledgerly.app", content: "s1.domainkey.u1.wl.sendgrid.net" }, ctx);
    expect(created.ok).toBe(true);
    const id = (created.data as { id: string }).id;
    const target = { type: "CNAME", recordName: "s1._domainkey.ledgerly.app" };
    // A change must name the record it changes; a wrong type or name is refused, and nothing changes.
    const wrong = await mock.callTool("update_record", { zoneId: LG, recordId: id, type: "MX", recordName: "ledgerly.app", ttl: 60 }, ctx);
    expect(wrong.ok).toBe(false);
    expect(wrong.error?.message).toContain("not a MX record");
    expect((await mock.callTool("delete_record", { zoneId: LG, recordId: id, type: "A", recordName: "S1._domainkey.ledgerly.app" }, ctx)).ok).toBe(false);
    const updated = await mock.callTool("update_record", { zoneId: LG, recordId: id, ...target, ttl: 300 }, ctx);
    expect(updated.data).toMatchObject({ id, ttl: 300 });
    const auth = await mock.callTool("check_email_auth", { zoneId: LG }, ctx);
    expect(auth.data).toMatchObject({ dkim: { found: true, selectors: ["s1"] } });
    const deleted = await mock.callTool("delete_record", { zoneId: LG, recordId: id, type: "CNAME", recordName: "S1._DOMAINKEY.ledgerly.app" }, ctx);
    expect(deleted.data).toEqual({ deleted: true, recordId: id });
    expect(((await mock.callTool("list_records", { zoneId: LG, type: "CNAME" }, ctx)).data as { items: unknown[] }).items).toHaveLength(0);
  });
});

describe("cloudflare live (canned)", () => {
  it("unwraps the Cloudflare envelope and sends a Bearer token", async () => {
    const connector = createCloudflareDnsConnector({
      secrets: { cloudflareApiToken: "cf-token" },
      fetch: routedFetch({
        [`GET https://api.cloudflare.com/client/v4/zones/${NW}/dns_records`]: (req) => {
          expect(req.headers.get("authorization")).toBe("Bearer cf-token");
          return jsonResponse({ success: true, result: CF_RECORDS.filter((r) => r.zoneId === NW).map((r) => ({ id: r.id, type: r.type, name: r.name, content: r.content, ttl: r.ttl, proxied: r.proxied, priority: r.priority ?? undefined, modified_on: r.modifiedOn })) });
        },
        [`GET https://api.cloudflare.com/client/v4/zones/${NW}`]: () => jsonResponse({ success: true, result: { id: NW, name: "northwindskincare.com", status: "active" } }),
        [`POST https://api.cloudflare.com/client/v4/zones/${NW}/dns_records`]: () => jsonResponse({ success: false, result: null, errors: [{ code: 81057, message: "Record already exists." }] }, { status: 400 }),
      }),
    });
    const ctx = makeToolContext(connector, { mode: "live" });
    const auth = await connector.callTool("check_email_auth", { zoneId: NW }, ctx);
    expect(auth.ok).toBe(true);
    expect(auth.data).toMatchObject({ domain: "northwindskincare.com", ready: true });
    const dup = await connector.callTool("create_record", { zoneId: NW, type: "A", name: "northwindskincare.com", content: "1.2.3.4" }, ctx);
    expect(dup.ok).toBe(false);
    expect(dup.error?.message).toContain("81057");
  });
  it("throws ConfigError without a token", async () => {
    const c = createCloudflareDnsConnector({ secrets: {} });
    await expect(c.callTool("list_zones", {}, makeToolContext(c, { mode: "live" }))).rejects.toMatchObject({ code: "connector_unconfigured" });
  });
});

describe.skipIf(!envKeysPresent("CLOUDFLARE_API_TOKEN"))("cloudflare_dns (live)", () => {
  describeConnectorContract("cloudflare live", { connector: createCloudflareDnsConnector({ secrets: { cloudflareApiToken: process.env.CLOUDFLARE_API_TOKEN } }), mode: "live", deterministic: false, calls: [{ tool: "list_zones", args: {} }] });
});
