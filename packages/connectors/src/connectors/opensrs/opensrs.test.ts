/**
 * `opensrs` (WP-08 domain plan, Path A): the XCP envelope and its signature, the lookup with OpenSRS's cost, the
 * registration with the founder as owner (never a Foundmill default), and the zone. The mock answers offline.
 */
import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import type { RegistrantContact } from "@foundmill/shared";
import { routedFetch } from "../../http";
import { makeToolContext } from "../../testing/contract-suite";
import { createOpensrsConnector, MOCK_COM_COST_MINOR, opensrsMock, opsRecords, opsRequest, opsSignature, parseOps } from "./index";

const FOUNDER: RegistrantContact = { firstName: "Maya", lastName: "Lee", address1: "12 Elm Street", city: "Springfield", state: "IL", postalCode: "62701", country: "US", phone: "+1.2175550123", email: "maya@example.com" };

const reply = (attributes: string, ok = true, code = "200") =>
  new Response(`<?xml version='1.0' encoding='UTF-8' standalone='no' ?><OPS_envelope><header><version>0.9</version></header><body><data_block><dt_assoc><item key="protocol">XCP</item><item key="action">REPLY</item><item key="object">DOMAIN</item><item key="is_success">${ok ? 1 : 0}</item><item key="response_code">${code}</item><item key="response_text">${ok ? "Command Successful" : "Domain taken &amp; more"}</item><item key="attributes"><dt_assoc>${attributes}</dt_assoc></item></dt_assoc></data_block></body></OPS_envelope>`, { status: 200 });

const actionOf = (xml: string) => /<item key="action">([A-Z_]+)<\/item>/.exec(xml)?.[1];

describe("the XCP envelope", () => {
  it("signs as OpenSRS documents (md5 twice, lower case)", () => {
    const md5 = (v: string) => createHash("md5").update(v).digest("hex");
    // OpenSRS's own check value for md5 ("Troubleshooting HTTPS Post").
    expect(md5("ConnecttoOpenSRSviaSSL")).toBe("e787cc1d1951dfec4827cede7b1a0933");
    expect(opsSignature("<x/>", "k")).toBe(md5(md5("<x/>k") + "k"));
  });

  it("builds nested assocs and arrays, escapes text, and reads the reply back", () => {
    const xml = opsRequest("SET_DNS_ZONE", "DOMAIN", { domain: "a&b.com", records: { MX: [{ subdomain: "", hostname: "mx.sendgrid.net", priority: 10 }] }, flag: true });
    expect(xml).toContain('<item key="domain">a&amp;b.com</item>');
    expect(xml).toContain('<item key="MX"><dt_array><item key="0"><dt_assoc><item key="subdomain"></item><item key="hostname">mx.sendgrid.net</item><item key="priority">10</item></dt_assoc></item></dt_array></item>');
    expect(xml).toContain('<item key="flag">1</item>');
    const back = parseOps(xml) as { attributes: { records: { MX: { hostname: string }[] }; domain: string } };
    expect(back.attributes.domain).toBe("a&b.com");
    expect(back.attributes.records.MX[0]!.hostname).toBe("mx.sendgrid.net");
  });

  it("reads a hostile reply as data: no prototype from __proto__, no endless nesting, no control characters sent", () => {
    const back = parseOps('<dt_assoc><item key="__proto__"><dt_assoc><item key="polluted">1</item></dt_assoc></item></dt_assoc>');
    expect(Object.getPrototypeOf(back)).toBeNull();
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    expect(() => parseOps("<dt_assoc>" + '<item key="a"><dt_assoc>'.repeat(30) + "</dt_assoc></item>".repeat(30) + "</dt_assoc>")).toThrow(/too deep/);
    expect(opsRequest("LOOKUP", "DOMAIN", { domain: "a\u0000b\u0007.com" })).toContain('<item key="domain">ab.com</item>');
  });

  it("groups zone records by type in OpenSRS's field names", () => {
    expect(opsRecords([{ type: "TXT", subdomain: "_dmarc", value: "v=DMARC1; p=none;" }, { type: "CNAME", subdomain: "www", value: "acme.foundmill.app" }, { type: "MX", subdomain: "", value: "mx.sendgrid.net", priority: 10 }])).toEqual({
      TXT: [{ subdomain: "_dmarc", text: "v=DMARC1; p=none;" }],
      CNAME: [{ subdomain: "www", hostname: "acme.foundmill.app" }],
      MX: [{ subdomain: "", hostname: "mx.sendgrid.net", priority: 10 }],
    });
  });
});

describe("opensrs (live)", () => {
  const secrets = { opensrsUsername: "reseller", opensrsApiKey: "k".repeat(40) };

  it("looks a name up and prices a year, signed with the reseller's key, on the test host by default", async () => {
    const seen: { action?: string; sig: string | null; user: string | null; body: string }[] = [];
    const connector = createOpensrsConnector({
      secrets,
      fetch: routedFetch({
        "POST https://horizon.opensrs.net:55443/": async (req) => {
          const body = await req.text();
          seen.push({ action: actionOf(body), sig: req.headers.get("x-signature"), user: req.headers.get("x-username"), body });
          return actionOf(body) === "LOOKUP" ? reply('<item key="status">available</item>') : reply('<item key="price">10.97</item>');
        },
      }),
    });
    const r = await connector.callTool("lookup_domain", { domain: "acme.com" }, makeToolContext(connector, { mode: "live" }));
    expect(r.ok).toBe(true);
    expect(r.data).toEqual({ domain: "acme.com", available: true, costMinor: 1097 });
    expect(seen.map((s) => s.action)).toEqual(["LOOKUP", "GET_PRICE"]);
    expect(seen[0]!.user).toBe("reseller");
    expect(seen[0]!.sig).toBe(opsSignature(seen[0]!.body, secrets.opensrsApiKey));
  });

  it("registers with the founder as owner, admin and billing contact, and never a Foundmill default", async () => {
    let body = "";
    const connector = createOpensrsConnector({
      secrets,
      fetch: routedFetch({
        "POST https://horizon.opensrs.net:55443/": async (req) => {
          body = await req.text();
          return reply('<item key="id">3735928559</item><item key="registration_text">Domain registration successfully completed</item>');
        },
      }),
    });
    const r = await connector.callTool("register_domain", { domain: "acme.com", owner: FOUNDER }, makeToolContext(connector, { mode: "live" }));
    expect(r.ok).toBe(true);
    expect((r.data as { orderId: string }).orderId).toBe("3735928559");
    const sent = parseOps(body) as { attributes: { contact_set: Record<string, Record<string, string>>; custom_tech_contact: string; reg_type: string; period: string } };
    for (const role of ["owner", "admin", "billing"]) {
      expect(sent.attributes.contact_set[role]).toMatchObject({ first_name: "Maya", last_name: "Lee", email: "maya@example.com", phone: "+1.2175550123", address1: "12 Elm Street", country: "US" });
    }
    expect(Object.keys(sent.attributes.contact_set).sort()).toEqual(["admin", "billing", "owner"]);
    expect(body.toLowerCase()).not.toMatch(/foundmill/);
    expect(sent.attributes).toMatchObject({ reg_type: "new", period: "1", custom_tech_contact: "0" });
  });

  it("an OpenSRS refusal is an error, never a registration", async () => {
    const connector = createOpensrsConnector({ secrets, fetch: routedFetch({ "POST https://horizon.opensrs.net:55443/": async () => reply("", false, "485") }) });
    const r = await connector.callTool("register_domain", { domain: "acme.com", owner: FOUNDER }, makeToolContext(connector, { mode: "live" }));
    expect(r.ok).toBe(false);
  });

  it("sets the zone, creating it first and going on when it exists", async () => {
    const actions: (string | undefined)[] = [];
    const connector = createOpensrsConnector({
      secrets: { ...secrets, opensrsEnv: "live" },
      fetch: routedFetch({
        "POST https://rr-n1-tor.opensrs.net:55443/": async (req) => {
          const a = actionOf(await req.text());
          actions.push(a);
          return a === "CREATE_DNS_ZONE" ? reply("", false, "485") : reply('<item key="nameservers_ok">1</item>');
        },
      }),
    });
    const r = await connector.callTool("set_dns_zone", { domain: "acme.com", records: [{ type: "MX", subdomain: "", value: "mx.sendgrid.net", priority: 10 }] }, makeToolContext(connector, { mode: "live" }));
    expect(r.ok).toBe(true);
    expect(actions).toEqual(["CREATE_DNS_ZONE", "SET_DNS_ZONE"]);
  });

  it("refuses without the reseller's key", async () => {
    const connector = createOpensrsConnector({ secrets: {}, fetch: routedFetch({}) });
    await expect(connector.callTool("lookup_domain", { domain: "acme.com" }, makeToolContext(connector, { mode: "live" }))).rejects.toThrow(/OPENSRS/);
  });
});

describe("opensrs (mock)", () => {
  it("prices offline and answers taken for the well-known names", async () => {
    const ctx = makeToolContext(opensrsMock);
    expect((await opensrsMock.callTool("lookup_domain", { domain: "acme.com" }, ctx)).data).toEqual({ domain: "acme.com", available: true, costMinor: MOCK_COM_COST_MINOR });
    expect((await opensrsMock.callTool("lookup_domain", { domain: "google.com" }, ctx)).data).toMatchObject({ available: false, costMinor: null });
  });
});
