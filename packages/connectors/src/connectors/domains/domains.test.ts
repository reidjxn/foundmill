import { describe, expect, it } from "vitest";
import { jsonResponse, type FetchLike } from "../../http";
import { describeConnectorContract, makeToolContext } from "../../testing/contract-suite";
import { createDomainsConnector } from "./index";
import { domainsMock, mockDomainAnswer } from "./mock";
import { BOOTSTRAP_TTL_MS, IANA_BOOTSTRAP_URL, createDomainLookup, parseBootstrap, registrationDetails, type DnsLike } from "./rdap";
import type { DomainAnswer } from "./tools";

const results = (r: { data?: unknown }) => (r.data as { results: DomainAnswer[] }).results;

describeConnectorContract("domains (mock)", {
  connector: domainsMock,
  mode: "mock",
  calls: [
    { tool: "check_domains", args: { domains: ["ledgerly.com"] }, check: (r) => expect(results(r)).toEqual([expect.objectContaining({ domain: "ledgerly.com", status: "available", provenance: "Mock", estimate: false })]) },
    { tool: "check_domains", args: { domains: ["google.com", "Apple.IO", "example.ai", "northwind.co"] }, check: (r) => expect(results(r).map((a) => a.status)).toEqual(["taken", "taken", "taken", "taken"]) },
    { tool: "check_domains", args: { domains: ["unknown-brand.com"] }, check: (r) => expect(results(r)[0]).toMatchObject({ status: "unknown", provenance: "Mock", reason: expect.stringContaining("unknown") }) },
    { tool: "check_domains", args: { domains: [] }, expectOk: false, check: (r) => expect(r.error?.code).toBe("invalid_args") },
    { tool: "check_domains", args: { domains: ["a.com", "b.com", "c.com", "d.com", "e.com", "f.com", "g.com", "h.com", "i.com"] }, expectOk: false, check: (r) => expect(r.error?.code).toBe("invalid_args") },
    { tool: "check_domains", args: { domains: ["example.xyz"] }, expectOk: false, check: (r) => expect(r.error?.code).toBe("invalid_args") },
    { tool: "check_domains", args: { domains: ["https://example.com/"] }, expectOk: false, check: (r) => expect(r.error?.code).toBe("invalid_args") },
  ],
});

describe("domains mock", () => {
  it("answers deterministically and never claims to be a registry", () => {
    expect(mockDomainAnswer("ledgerly.com")).toEqual(mockDomainAnswer("ledgerly.com"));
    for (const d of ["ledgerly.com", "google.com", "unknown-x.io"]) expect(mockDomainAnswer(d).provenance).toBe("Mock");
    expect(mockDomainAnswer("google.com")).toMatchObject({ status: "taken", registrar: "Mock Registrar" });
    expect(mockDomainAnswer("not a domain").status).toBe("unknown");
    // The Commit screen strips hyphens from a business name, so "unknown-brand" is asked about as unknownbrand.com.
    expect(mockDomainAnswer("unknownbrand.com")).toMatchObject({ status: "unknown", provenance: "Mock" });
  });
});

/* ---------- the live lookup, with no network ---------- */

const BOOTSTRAP = {
  version: "1.0",
  publication: "2026-09-30T23:00:03Z",
  services: [
    [["com", "net"], ["https://rdap.verisign.test/com/v1/"]],
    [["app", "dev"], ["http://insecure.test/rdap/", "https://pubapi.registry.test/rdap/"]],
    [["ai"], ["https://rdap.identity.test/rdap"]],
    [["org"], ["https://127.0.0.1/rdap/", "https://localhost/rdap/", "https://user:pw@evil.test/rdap/", "https://[::1]/rdap/", "https://rdap.pir.test:8443/rdap/"]],
  ],
};

const DOMAIN_RECORD = {
  objectClassName: "domain",
  ldhName: "EXAMPLE.COM",
  events: [
    { eventAction: "registration", eventDate: "1995-08-14T04:00:00Z" },
    { eventAction: "expiration", eventDate: "2027-08-13T04:00:00Z" },
  ],
  entities: [{ roles: ["registrar"], vcardArray: ["vcard", [["version", {}, "text", "4.0"], ["fn", {}, "text", "RESERVED-Internet Assigned Numbers Authority"]]] }],
};

type Handler = (url: URL, init: RequestInit | undefined) => Response | Promise<Response>;

/** A fetch that records every URL and answers from `handlers` (keyed by "host/path-prefix"). */
function stubFetch(handlers: Record<string, Handler>, opts: { bootstrap?: unknown } = {}) {
  const calls: string[] = [];
  const fetch: FetchLike = async (input, init) => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
    calls.push(url.toString());
    if (url.toString() === IANA_BOOTSTRAP_URL) return opts.bootstrap === undefined ? jsonResponse(BOOTSTRAP) : opts.bootstrap instanceof Response ? opts.bootstrap : jsonResponse(opts.bootstrap);
    const key = `${url.host}${url.pathname}`;
    const handler = Object.entries(handlers).find(([prefix]) => key.startsWith(prefix))?.[1];
    if (!handler) throw new Error(`stubFetch: no handler for ${url}`);
    return handler(url, init);
  };
  return { fetch, calls, registryCalls: () => calls.filter((c) => c !== IANA_BOOTSTRAP_URL) };
}

const NOW = new Date("2026-10-13T15:45:00.000Z");
const noDns: DnsLike = { resolveNs: async () => Promise.reject(Object.assign(new Error("no dns in this test"), { code: "ESERVFAIL" })), resolveSoa: async () => Promise.reject(Object.assign(new Error("no dns in this test"), { code: "ESERVFAIL" })) };
const rdapJson = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/rdap+json" } });
const lookupWith = (fetch: FetchLike, extra: { dns?: DnsLike; timeoutMs?: number; now?: () => Date } = {}) => createDomainLookup({ fetch, now: extra.now ?? (() => NOW), dns: extra.dns ?? noDns, timeoutMs: extra.timeoutMs });

describe("domains live lookup (RDAP, no network)", () => {
  it("200 is taken (with registrar and expiry), 404 is available, both labeled Registry, with the time checked", async () => {
    const stub = stubFetch({
      "rdap.verisign.test/com/v1/domain/example.com": () => rdapJson(DOMAIN_RECORD),
      "rdap.verisign.test/com/v1/domain/freshname.com": () => new Response(JSON.stringify({ errorCode: 404 }), { status: 404 }),
    });
    const out = await lookupWith(stub.fetch).check(["example.com", "freshname.com"]);
    expect(out).toEqual([
      { domain: "example.com", status: "taken", provenance: "Registry", estimate: false, checkedAt: NOW.toISOString(), registrar: "RESERVED-Internet Assigned Numbers Authority", expires: "2027-08-13" },
      { domain: "freshname.com", status: "available", provenance: "Registry", estimate: false, checkedAt: NOW.toISOString() },
    ]);
  });

  it("asks one registry request per distinct candidate, with the validated name only", async () => {
    const stub = stubFetch({ "rdap.verisign.test/": () => new Response("", { status: 404 }), "pubapi.registry.test/": () => new Response("", { status: 404 }), "rdap.identity.test/": () => new Response("", { status: 404 }) });
    await lookupWith(stub.fetch).check(["Brand.COM", "brand.com", "brand.net", "brand.app", "brand.ai"]);
    expect(stub.registryCalls().sort()).toEqual(["https://pubapi.registry.test/rdap/domain/brand.app", "https://rdap.identity.test/rdap/domain/brand.ai", "https://rdap.verisign.test/com/v1/domain/brand.com", "https://rdap.verisign.test/com/v1/domain/brand.net"]);
  });

  it("429, 5xx, an unreadable 200 and other statuses are unknown with a reason, never a guess", async () => {
    const stub = stubFetch({
      "rdap.verisign.test/com/v1/domain/busy.com": () => new Response("slow down", { status: 429 }),
      "rdap.verisign.test/com/v1/domain/broken.com": () => new Response("oops", { status: 503 }),
      "rdap.verisign.test/com/v1/domain/odd.com": () => new Response("<html>captive portal</html>", { status: 200 }),
      "rdap.verisign.test/com/v1/domain/notadomain.com": () => rdapJson({ objectClassName: "nameserver" }),
      "rdap.verisign.test/com/v1/domain/denied.com": () => new Response("", { status: 403 }),
    });
    const out = await lookupWith(stub.fetch).check(["busy.com", "broken.com", "odd.com", "notadomain.com", "denied.com"]);
    expect(out.map((a) => a.status)).toEqual(["unknown", "unknown", "unknown", "unknown", "unknown"]);
    for (const a of out) {
      expect(a.provenance).toBe("Registry");
      expect(a.estimate).toBe(false);
      expect(a.reason?.length).toBeGreaterThan(10);
    }
    expect(out[0]!.reason).toMatch(/busy/);
  });

  it("a registry that does not answer in time is unknown, and the other names still answer", async () => {
    const stub = stubFetch({
      "rdap.verisign.test/com/v1/domain/slow.com": (_url, init) => new Promise<Response>((_resolve, reject) => init?.signal?.addEventListener("abort", () => reject(Object.assign(new Error("aborted"), { name: "AbortError" })))),
      "rdap.verisign.test/com/v1/domain/quick.com": () => new Response("", { status: 404 }),
    });
    const out = await lookupWith(stub.fetch, { timeoutMs: 30 }).check(["slow.com", "quick.com"]);
    expect(out[0]).toMatchObject({ domain: "slow.com", status: "unknown", reason: expect.stringMatching(/in time/) });
    expect(out[1]).toMatchObject({ domain: "quick.com", status: "available" });
  });

  it("a network failure is unknown", async () => {
    const stub = stubFetch({ "rdap.verisign.test/": () => Promise.reject(new TypeError("fetch failed")) });
    expect((await lookupWith(stub.fetch).check(["down.com"]))[0]).toMatchObject({ status: "unknown", reason: expect.stringMatching(/could not be reached/) });
  });

  it("never follows a redirect to another host, and does not request it; a redirect within the registry's host is followed", async () => {
    const stub = stubFetch({
      "rdap.verisign.test/com/v1/domain/elsewhere.com": () => new Response(null, { status: 302, headers: { location: "https://evil.test/steal?x=1" } }),
      "rdap.verisign.test/com/v1/domain/downgrade.com": () => new Response(null, { status: 302, headers: { location: "http://rdap.verisign.test/com/v1/domain/downgrade.com" } }),
      "rdap.verisign.test/com/v1/domain/credentials.com": () => new Response(null, { status: 302, headers: { location: "https://user:pw@rdap.verisign.test/x" } }),
      "rdap.verisign.test/com/v1/domain/moved.com": () => new Response(null, { status: 301, headers: { location: "/com/v2/domain/moved.com" } }),
      "rdap.verisign.test/com/v2/domain/moved.com": () => rdapJson(DOMAIN_RECORD),
      "rdap.verisign.test/com/v1/domain/loop.com": () => new Response(null, { status: 302, headers: { location: "/com/v1/domain/loop.com" } }),
    });
    const out = await lookupWith(stub.fetch).check(["elsewhere.com", "downgrade.com", "credentials.com", "moved.com", "loop.com"]);
    expect(out.map((a) => a.status)).toEqual(["unknown", "unknown", "unknown", "taken", "unknown"]);
    expect(out[0]!.reason).toMatch(/another site/);
    expect(out[4]!.reason).toMatch(/too many/);
    expect(stub.calls.some((c) => c.includes("evil.test"))).toBe(false);
    expect(stub.calls.some((c) => c.startsWith("http://"))).toBe(false);
  });

  it("requests are manual-redirect GETs with no credentials", async () => {
    let seen: RequestInit | undefined;
    const stub = stubFetch({ "rdap.verisign.test/": (_u, init) => ((seen = init), new Response("", { status: 404 })) });
    await lookupWith(stub.fetch).check(["plain.com"]);
    expect(seen?.method).toBe("GET");
    expect(seen?.redirect).toBe("manual");
    expect(Object.keys(seen?.headers ?? {}).map((h) => h.toLowerCase())).not.toContain("authorization");
  });

  it("refuses to look up anything but a validated label.tld, before any request", async () => {
    const stub = stubFetch({ "": () => new Response("", { status: 404 }) });
    const lookup = lookupWith(stub.fetch);
    const bad = ["example.com/../../etc", "example.com@evil.test", "evil.test#.com", "a b.com", "example.xyz", "-x.com", "x..com", "https://example.com", "example.com:8443", `${"a".repeat(64)}.com`, "sub.example.com"];
    const out = await lookup.check(bad);
    expect(out.every((a) => a.status === "unknown")).toBe(true);
    expect(stub.registryCalls()).toEqual([]);
  });

  it("drops bootstrap entries that are not plain https host names (http, IPs, localhost, credentials, ports)", async () => {
    const table = parseBootstrap(BOOTSTRAP);
    expect(table.get("app")?.map(String)).toEqual(["https://pubapi.registry.test/rdap/"]);
    expect(table.get("ai")?.map(String)).toEqual(["https://rdap.identity.test/rdap/"]);
    expect(table.has("org")).toBe(false);
    expect(() => parseBootstrap({})).toThrow();
    // A TLD whose every entry was dropped has no RDAP server: it is answered from DNS, not by a made-up URL.
    const stub = stubFetch({});
    const out = await lookupWith(stub.fetch).check(["wikipedia.org"]);
    expect(out[0]).toMatchObject({ provenance: "DNS", status: "unknown" });
    expect(stub.registryCalls()).toEqual([]);
  });

  it("reads the IANA bootstrap once a day: cached for 24 hours, then refreshed", async () => {
    let clock = NOW.getTime();
    const stub = stubFetch({ "rdap.verisign.test/": () => new Response("", { status: 404 }) });
    const lookup = lookupWith(stub.fetch, { now: () => new Date(clock) });
    await lookup.check(["one.com"]);
    await lookup.check(["two.com"]);
    clock += BOOTSTRAP_TTL_MS - 1000;
    await lookup.check(["three.com"]);
    expect(stub.calls.filter((c) => c === IANA_BOOTSTRAP_URL)).toHaveLength(1);
    clock += 2000;
    await lookup.check(["four.com"]);
    expect(stub.calls.filter((c) => c === IANA_BOOTSTRAP_URL)).toHaveLength(2);
  });

  it("calls that arrive together share one bootstrap read", async () => {
    const stub = stubFetch({ "rdap.verisign.test/": () => new Response("", { status: 404 }) });
    const lookup = lookupWith(stub.fetch);
    await Promise.all([lookup.check(["a1.com"]), lookup.check(["a2.com"]), lookup.check(["a3.com"])]);
    expect(stub.calls.filter((c) => c === IANA_BOOTSTRAP_URL)).toHaveLength(1);
  });

  it("when IANA cannot be read every answer is unknown (nothing is guessed); a stale directory is still used", async () => {
    const down = stubFetch({}, { bootstrap: new Response("", { status: 503 }) });
    const out = await lookupWith(down.fetch).check(["ledgerly.com", "ledgerly.io"]);
    expect(out.map((a) => a.status)).toEqual(["unknown", "unknown"]);
    expect(out[0]!.reason).toMatch(/directory/);
    expect(down.registryCalls()).toEqual([]);

    let clock = NOW.getTime();
    let iana = 0;
    const flaky: FetchLike = async (input, init) => {
      const url = String(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
      if (url === IANA_BOOTSTRAP_URL) return ++iana === 1 ? jsonResponse(BOOTSTRAP) : new Response("", { status: 500 });
      void init;
      return new Response("", { status: 404 });
    };
    const lookup = lookupWith(flaky, { now: () => new Date(clock) });
    expect((await lookup.check(["first.com"]))[0]!.status).toBe("available");
    clock += 2 * BOOTSTRAP_TTL_MS;
    expect((await lookup.check(["second.com"]))[0]!.status).toBe("available");
  });

  it("reads the registrar and expiry from a domain record when the registry shares them, and tolerates their absence", () => {
    expect(registrationDetails(DOMAIN_RECORD)).toEqual({ registrar: "RESERVED-Internet Assigned Numbers Authority", expires: "2027-08-13" });
    expect(registrationDetails({})).toEqual({});
    expect(registrationDetails({ events: [{ eventAction: "expiration", eventDate: "soon" }], entities: [{ roles: ["registrar"], vcardArray: "nope" }] })).toEqual({});
  });
});

describe("domains DNS fallback (a TLD with no RDAP server), always an estimate", () => {
  const dnsThat = (ns: () => Promise<string[]>, soa: () => Promise<unknown>): DnsLike => ({ resolveNs: ns, resolveSoa: soa });
  const code = (c: string) => Object.assign(new Error(c), { code: c });

  it("records mean taken; NXDOMAIN means probably available; anything else is unknown. None of it is called Registry", async () => {
    const stub = stubFetch({});
    const dns = dnsThat(
      async () => ["ns1.example.test"],
      async () => ({}),
    );
    const taken = (await lookupWith(stub.fetch, { dns }).check(["google.io"]))[0]!;
    expect(taken).toMatchObject({ domain: "google.io", status: "taken", provenance: "DNS", estimate: true, checkedAt: NOW.toISOString() });
    expect(taken.reason).toMatch(/estimate/);

    const nx = dnsThat(
      async () => Promise.reject(code("ENOTFOUND")),
      async () => Promise.reject(code("ENOTFOUND")),
    );
    const free = (await lookupWith(stub.fetch, { dns: nx }).check(["qzxjv-no-such-name.io", "qzxjv-no-such-name.co"])) as DomainAnswer[];
    for (const a of free) expect(a).toMatchObject({ status: "available", provenance: "DNS", estimate: true });
    expect(free[0]!.reason).toMatch(/estimate/);

    const soaOnly = dnsThat(
      async () => Promise.reject(code("ENODATA")),
      async () => ({ nsname: "ns.example.test" }),
    );
    expect((await lookupWith(stub.fetch, { dns: soaOnly }).check(["soa.io"]))[0]).toMatchObject({ status: "taken", provenance: "DNS" });

    for (const failure of ["ESERVFAIL", "ETIMEOUT", "ECONNREFUSED", "ENODATA"]) {
      const bad = dnsThat(
        async () => Promise.reject(code(failure)),
        async () => Promise.reject(code(failure)),
      );
      expect((await lookupWith(stub.fetch, { dns: bad }).check(["maybe.io"]))[0], failure).toMatchObject({ status: "unknown", provenance: "DNS", estimate: true });
    }
    // No registry host was contacted for these TLDs.
    expect(stub.registryCalls()).toEqual([]);
  });
});

describe("domains (live connector through callTool)", () => {
  it("serves check_domains from the registry, validates its input, and reports health from the bootstrap", async () => {
    const stub = stubFetch({ "rdap.verisign.test/com/v1/domain/": (url) => (url.pathname.endsWith("/example.com") ? rdapJson(DOMAIN_RECORD) : new Response("", { status: 404 })) });
    const connector = createDomainsConnector({ fetch: stub.fetch, now: () => NOW, dns: noDns });
    const ctx = makeToolContext(connector, { mode: "live" });
    const ok = await connector.callTool("check_domains", { domains: ["example.com", "newbusiness.com", "newbusiness.io"] }, ctx);
    expect(ok.ok).toBe(true);
    expect((ok.data as { results: DomainAnswer[] }).results.map((a) => [a.domain, a.status, a.provenance])).toEqual([
      ["example.com", "taken", "Registry"],
      ["newbusiness.com", "available", "Registry"],
      ["newbusiness.io", "unknown", "DNS"],
    ]);
    const bad = await connector.callTool("check_domains", { domains: ["example.com/x"] }, ctx);
    expect(bad.ok).toBe(false);
    expect(bad.error?.code).toBe("invalid_args");
    expect(stub.registryCalls()).toHaveLength(2);
    expect((await connector.healthcheck(ctx.integration)).status).toBe("connected");
    const down = createDomainsConnector({ fetch: stubFetch({}, { bootstrap: new Response("", { status: 500 }) }).fetch, now: () => NOW, dns: noDns });
    expect((await down.healthcheck(ctx.integration)).status).toBe("degraded");
  });
});

/** Not in CI: `DOMAIN_TEST_LIVE=1 pnpm --filter @foundmill/connectors test -- domains` asks the real registries. */
describe.skipIf(process.env.DOMAIN_TEST_LIVE !== "1")("domains (live registries)", () => {
  it("example.com is taken and a random 20-character .com is available", async () => {
    const random = Array.from({ length: 20 }, () => "abcdefghijklmnopqrstuvwxyz"[Math.floor(Math.random() * 26)]).join("");
    const lookup = createDomainLookup({ fetch: globalThis.fetch, now: () => new Date() });
    const out = await lookup.check(["example.com", `${random}.com`]);
    expect(out[0]).toMatchObject({ status: "taken", provenance: "Registry" });
    expect(out[1]).toMatchObject({ status: "available", provenance: "Registry" });
  }, 20_000);
});
