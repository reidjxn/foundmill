import { beforeEach, describe, expect, it } from "vitest";
import { buildWebSite, cleanSignInHosts, isOnSharedHostingSuffix, SHARED_HOSTING_SUFFIXES, neverMessage, parseSiteAddress, registrableDomain, webSiteConfig, webSiteFromConfig, webSlotOf, WebSiteRefused, STARTER_SITES, type SiteCheck } from "../../browser-web";
import { neverReason } from "../../browser-sites";
import { makeToolContext, TEST_BUSINESS_ID } from "../../testing/contract-suite";
import { mockIntegrationRecord } from "../../mock-utils";
import { createWebSlotConnector, mockBrowserControl, MOCK_BROWSER_SESSIONS, BROWSER_CONNECTOR_FACTORIES, withBrowserSites } from ".";
import { readForQuarantine, type Untrusted } from "../../quarantine";

const CHECK: SiteCheck = { verdict: "unclear", line: null, termsUrl: "https://shop.example.com/terms", signInHosts: ["accounts.example.com", "login.other.net", "evil-example.com"], checkedOn: "2026-11-24" };
const OTHER = "00000000-0000-4000-8000-0000000000b2";

describe("the address a founder types", () => {
  it("becomes one exact https host, an IDN as punycode", () => {
    expect(parseSiteAddress("Shop.Example.COM")).toEqual({ ok: true, host: "shop.example.com", startUrl: "https://shop.example.com/" });
    expect(parseSiteAddress("https://shop.example.com/dashboard?x=1#y")).toMatchObject({ ok: true, host: "shop.example.com" });
    expect(parseSiteAddress("https://bücher.de/")).toMatchObject({ ok: true, host: "xn--bcher-kva.de" });
    expect(parseSiteAddress("shop.example.com.")).toMatchObject({ ok: true, host: "shop.example.com" });
  });
  it("refuses http, userinfo, ports, IP addresses, localhost and local names", () => {
    expect(parseSiteAddress("http://shop.example.com")).toMatchObject({ ok: false, code: "not_https" });
    for (const a of ["https://user:pw@shop.example.com", "https://admin@shop.example.com", "https://shop.example.com:8443/"]) expect(parseSiteAddress(a), a).toMatchObject({ ok: false, code: "tricks" });
    for (const a of ["127.0.0.1", "https://10.0.0.5/", "https://0x7f.1/", "https://2130706433/", "https://[::1]/", "https://[fd00::1]/", "localhost", "https://app.localhost/", "https://printer.local/", "https://db.internal/", "intranet"]) expect(parseSiteAddress(a), a).toMatchObject({ ok: false, code: "private" });
    for (const a of ["", "a b.com", "javascript:alert(1)", "ftp://x.example.com"]) expect(parseSiteAddress(a).ok, a).toBe(false);
  });
  it("finds the registrable domain, with a shortcut for two-level suffixes", () => {
    expect(registrableDomain("a.b.example.com")).toBe("example.com");
    expect(registrableDomain("shop.example.co.uk")).toBe("example.co.uk");
    expect(registrableDomain("example.com")).toBe("example.com");
  });
  it("keeps only sign-in hosts of the same site", () => {
    expect(cleanSignInHosts("shop.example.com", CHECK.signInHosts)).toEqual(["accounts.example.com"]);
    // The bare registrable domain can be anyone's front page: never a sign-in host. Nor the site's own host, a stranger's, or an IP.
    expect(cleanSignInHosts("shop.example.com", ["shop.example.com", "accounts.paypal.com", "10.0.0.1", "example.com", "login.example.com"])).toEqual(["login.example.com"]);
  });
  it("gives a site on a shared hosting suffix no sibling hosts, and refuses the suffix itself", () => {
    for (const suffix of SHARED_HOSTING_SUFFIXES) {
      expect(isOnSharedHostingSuffix(`me.${suffix}`), suffix).toBe(true);
      expect(cleanSignInHosts(`me.${suffix}`, [`login.me.${suffix}`, `other.${suffix}`, suffix]), suffix).toEqual([]);
      expect(() => buildWebSite(1, { address: suffix, check: CHECK }), suffix).toThrow(/shared by many websites/);
    }
    expect(registrableDomain("me.github.io")).toBe("me.github.io");
    expect(registrableDomain("a.b.me.github.io")).toBe("me.github.io");
    const site = buildWebSite(1, { address: "me.github.io", check: CHECK });
    expect(site).toMatchObject({ hosts: ["me.github.io"], signInHosts: [] });
  });
  it("reads the bare check of a host that is not on a shared suffix as before", () => {
    expect(isOnSharedHostingSuffix("shop.example.com")).toBe(false);
  });
});

describe("what is never added", () => {
  it("refuses the banks, card issuers, brokerages, payment pages, password managers, social sites and government hosts that used to pass (security review)", () => {
    const hosts = ["hsbc.com", "www.hsbc.co.uk", "barclays.co.uk", "americanexpress.com", "global.americanexpress.com", "chime.com", "ally.com", "webull.com", "crypto.com", "pay.google.com", "payments.google.com", "wallet.google.com", "pay.amazon.com", "nordpass.com", "impots.gouv.fr", "discord.com", "www.sparkasse.de", "banco.example.com", "www.gob.mx", "service.govt.nz", "portal.gov.au", "ing.de", "bnpparibas.com", "visa.com", "mastercard.com", "twitch.tv", "coinbase.com", "kaiserpermanente.org"];
    for (const h of hosts) expect(neverMessage(h), h).toMatch(/cannot be added/);
    expect(neverReason("impots.gouv.fr")).toBe("government_identity");
    expect(neverReason("discord.com")).toBe("social_network");
    expect(neverReason("pay.google.com")).toBe("bank");
    // The rest of Google, and of Amazon, are not never sites: the starter list needs them.
    for (const h of ["business.google.com", "sellercentral.amazon.com", "www.etsy.com"]) expect(neverMessage(h), h).toBeNull();
  });
  it("refuses social networks, banks and payment accounts before anything is fetched", () => {
    for (const h of ["www.linkedin.com", "m.facebook.com", "www.instagram.com", "x.com", "twitter.com", "www.threads.net", "www.tiktok.com", "www.pinterest.com", "snapchat.com", "old.reddit.com", "www.youtube.com", "www.paypal.com", "venmo.com", "cash.app", "wise.com", "app.revolut.com", "dashboard.stripe.com", "squareup.com", "secure.chase.com", "www.irs.gov"]) {
      expect(neverMessage(h), h).toMatch(/cannot be added/);
      expect(() => buildWebSite(1, { address: h, check: { ...CHECK, verdict: "allows" } }), h).toThrow(WebSiteRefused);
    }
    expect(neverReason("www.linkedin.com")).toBe("social_network");
    expect(neverMessage("shop.example.com")).toBeNull();
  });
  it("never lists a social or payment site in the starter list", () => {
    for (const s of STARTER_SITES) expect(neverMessage(s.host), s.host).toBeNull();
  });
});

describe("the site entry", () => {
  it("is built from the address and the check: one exact host, the sign-in hosts found, ask first unless allowed", () => {
    const site = buildWebSite(2, { address: "https://shop.example.com/admin", check: CHECK });
    expect(site).toMatchObject({ key: "web_2", name: "shop.example.com", state: "ask_first", hosts: ["shop.example.com"], signInHosts: ["accounts.example.com"], startUrl: "https://shop.example.com/" });
    expect(site.terms.line).toContain("has not confirmed");
    expect(buildWebSite(1, { address: "www.etsy.com", check: { ...CHECK, verdict: "allows", line: "You may use tools on your own account." } })).toMatchObject({ name: "Etsy", state: "open", terms: { line: "You may use tools on your own account." } });
  });
  it("is refused when the terms forbid it, the host is on the static list, or the slot does not exist", () => {
    expect(() => buildWebSite(1, { address: "shop.example.com", check: { ...CHECK, verdict: "forbids", line: "No bots." } })).toThrow(/do not allow/);
    expect(() => buildWebSite(1, { address: "carrd.co", check: CHECK })).toThrow(/already on the list/);
    expect(() => buildWebSite(6, { address: "shop.example.com", check: CHECK })).toThrow(WebSiteRefused);
    expect(webSlotOf("browser_web_5")).toBe(5);
    expect(webSlotOf("browser_web_6")).toBeNull();
    expect(webSlotOf("browser_web_0")).toBeNull();
  });
  it("is rebuilt from an integration's config, and a config that holds none is refused", () => {
    const config = webSiteConfig(3, "shop.example.com", CHECK);
    expect(webSiteFromConfig(3, config)).toEqual(buildWebSite(3, { address: "shop.example.com", check: CHECK }));
    expect(() => webSiteFromConfig(3, {})).toThrow(WebSiteRefused);
    expect(() => webSiteFromConfig(3, { ...config, check: { ...config.check, verdict: "forbids" } })).toThrow(WebSiteRefused);
    expect(() => webSiteFromConfig(3, { ...config, address: "www.linkedin.com" })).toThrow(WebSiteRefused);
  });
});

describe("a typed website's connector (recorded pages)", () => {
  const slot1 = () => createWebSlotConnector(1).mock;
  const slot2 = () => createWebSlotConnector(2).mock;
  const ctxFor = (c: ReturnType<typeof slot1>, slot: number, businessId = TEST_BUSINESS_ID, address = "shop.example.com") => makeToolContext(c, { businessId, integration: { ...mockIntegrationRecord(c.key, businessId, {}), config: webSiteConfig(slot, address, CHECK) } });
  beforeEach(() => mockBrowserControl.reset());

  it("is one connector per slot, with the same tools and the strictest hints on its writes", () => {
    expect(Object.keys(BROWSER_CONNECTOR_FACTORIES)).toEqual(expect.arrayContaining(["browser_web_1", "browser_web_5"]));
    const c = slot1();
    expect(c.key).toBe("browser_web_1");
    expect(c.policyHints.click).toEqual({ contactsThirdParty: true, irreversible: true });
  });

  it("works in the site its config names and nowhere else", async () => {
    const c = slot1();
    const r = await c.callTool("open_page", { url: "/" }, ctxFor(c, 1));
    expect(r.ok).toBe(true);
    expect(JSON.stringify(r.data)).toContain("shop.example.com");
    const off = await c.callTool("open_page", { url: "https://evil.example.net/" }, ctxFor(c, 1));
    expect(off.ok).toBe(false);
    expect(MOCK_BROWSER_SESSIONS.get(TEST_BUSINESS_ID, "web_1")?.site.hosts).toEqual(["shop.example.com"]);
  });

  it("answers plainly when the slot holds no site, or a site that is no longer allowed", async () => {
    const c = slot1();
    await expect(c.callTool("open_page", { url: "/" }, makeToolContext(c))).rejects.toThrow(/connect a website/);
    expect((await c.callTool("request_founder", { need: "sign_in", sentence: "Sign in to the site please" }, makeToolContext(c))).error?.code).toBe("hard_gate");
    await expect(c.callTool("open_page", { url: "/" }, ctxFor(c, 1, TEST_BUSINESS_ID, "www.linkedin.com"))).rejects.toMatchObject({ code: "site_unavailable" });
  });

  it("re-reads the cached check when a session is about to open, and refuses once the site is forbidden", async () => {
    let reason: string | null = null;
    const asked: [string, boolean][] = [];
    const c = createWebSlotConnector(1, { browser: { siteAllowed: async (h, simulated) => (asked.push([h, simulated]), reason) } }).mock;
    const ctx = ctxFor(c, 1);
    expect((await c.callTool("open_page", { url: "/" }, ctx)).ok).toBe(true);
    // A running session is not re-read on every step; the next one to open is.
    reason = "shop.example.com's terms no longer allow automated use of an account.";
    expect((await c.callTool("read_page", {}, ctx)).ok).toBe(true);
    expect(asked).toEqual([["shop.example.com", true]]);
    await MOCK_BROWSER_SESSIONS.stop(TEST_BUSINESS_ID);
    await expect(c.callTool("open_page", { url: "/" }, ctx)).rejects.toMatchObject({ code: "site_no_longer_allowed", message: reason });
    expect(MOCK_BROWSER_SESSIONS.get(TEST_BUSINESS_ID, "web_1")).toBeNull();
  });

  it("keeps two slots and two projects apart", async () => {
    const a = slot1();
    const b = slot2();
    await a.callTool("open_page", { url: "/" }, ctxFor(a, 1, TEST_BUSINESS_ID, "one.example.com"));
    await b.callTool("open_page", { url: "/" }, ctxFor(b, 2, TEST_BUSINESS_ID, "two.example.com"));
    await a.callTool("open_page", { url: "/" }, ctxFor(a, 1, OTHER, "three.example.com"));
    expect(MOCK_BROWSER_SESSIONS.get(TEST_BUSINESS_ID, "web_1")?.site.hosts).toEqual(["one.example.com"]);
    expect(MOCK_BROWSER_SESSIONS.get(TEST_BUSINESS_ID, "web_2")?.site.hosts).toEqual(["two.example.com"]);
    expect(MOCK_BROWSER_SESSIONS.get(OTHER, "web_1")?.site.hosts).toEqual(["three.example.com"]);
    expect(MOCK_BROWSER_SESSIONS.list(OTHER).map((s) => s.siteKey)).toEqual(["web_1"]);
  });

  it("classifies a write by the running session's site, and holds a payment", async () => {
    const c = slot1();
    const ctx = ctxFor(c, 1);
    const p = await c.callTool("open_page", { url: "/plan" }, ctx);
    const elements = (readForQuarantine(p.data as Untrusted<unknown>).content as { elements: { ref: string; label: string }[] }).elements;
    const buy = elements.find((e) => e.label === "Buy now")!;
    expect(await c.stepHints!("click", { ref: buy.ref }, TEST_BUSINESS_ID)).toMatchObject({ hardGate: true });
    expect(await c.stepHints!("click", { ref: "p00000000e0" }, OTHER)).toBeNull();
  });

  it("connects through the founder's own sign-in and records the site in its config", async () => {
    const c = slot1();
    const start = await c.connect(TEST_BUSINESS_ID, { address: "shop.example.com", check: CHECK });
    expect(start.config).toMatchObject({ siteKey: "web_1", address: "shop.example.com" });
    await expect(c.connect(TEST_BUSINESS_ID, { address: "www.linkedin.com", check: { ...CHECK, verdict: "allows" } })).rejects.toMatchObject({ code: "site_unavailable" });
  });

  it("is granted to an agent only once the project connected it", () => {
    const base = { toolRefs: [] as string[], servers: [] as string[], mcpTools: [] as string[] };
    expect(withBrowserSites(base, ["browser_web_2", "gmail"]).servers).toEqual(["browser_web_2"]);
    expect(withBrowserSites(base, ["gmail"])).toBe(base);
  });
});
