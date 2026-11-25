/**
 * The terms check of a typed website (founder, Nov 24, 2026), through the gateway's route:
 * - the never list answers before any page is requested (social networks, banks, payment accounts);
 * - the terms are found from the home page's link (or a common path), classified by a model that gets them as untrusted
 *   data, and a quote is kept only when it appears in the fetched text;
 * - a verdict is cached platform-wide, so a second business asking for the same host reads it without a fetch or a model call;
 * - only the api may ask; mock mode answers from the host's name and marks the answer simulated.
 */
import { afterEach, describe, expect, it } from "vitest";
import { repos } from "@foundmill/db";
import { signServiceToken } from "../tokens";
import { setupGateway, TEST_SECRET, type GatewayFixture } from "./harness";
import { anchors, checkedVerdict, excerptsOf, pageText, termsCandidates, type PageGet } from "../site-check";
import { browserHost } from "../browser";
import { browserEgress } from "../browser-e2b";
import { silentLog } from "./harness";

/** The parts of the route's answer these tests read. */
interface Answer {
  ok?: boolean;
  host?: string;
  cached?: boolean;
  simulated?: boolean;
  message?: string;
  check?: { verdict: string; line: string | null; termsUrl: string | null; signInHosts: string[] };
}

let open: GatewayFixture | null = null;
afterEach(async () => {
  await open?.close();
  open = null;
});

const TERMS = "Terms of Use. ".repeat(40) + "You may not use bots, scripts or other automated means to access or use your account. " + "More terms. ".repeat(40);
const FILLER = "Welcome to our shop, where we sell handmade goods from our workshop to customers all over the country. ".repeat(4);
const HOME = `<html><body>${FILLER}<a href="/help/terms-of-service">Terms of Service</a><a href="https://accounts.shop.example.com/login">Sign in</a><a href="https://login.elsewhere.net/in">Log in</a><a href="/privacy">Privacy policy</a></body></html>`;

function web(pages: Record<string, string>) {
  const asked: string[] = [];
  const getPage: PageGet = async (url) => {
    asked.push(url);
    const body = pages[url];
    return body === undefined ? { finalUrl: url, status: 404, body: "" } : { finalUrl: url, status: 200, body };
  };
  return { asked, getPage };
}

function model(answer: { verdict: string; line: string | null; category?: string }) {
  const calls: { route: string; system?: string; content: string; attribution?: { businessId?: string; kind?: string } }[] = [];
  const client = { complete: async (req: { route: string; system?: string; messages: { content: string }[]; attribution?: { businessId?: string; kind?: string } }) => (calls.push({ route: req.route, system: req.system, content: req.messages[0]!.content, attribution: req.attribution }), { json: { category: "other", ...answer }, text: "" }) };
  return { calls, client: client as never };
}

async function setup(mode: "mock" | "live", cfg?: { getPage: PageGet; client: never }) {
  const g = (open = await setupGateway({ mode }));
  if (cfg) g.deps.siteCheck = { getPage: cfg.getPage, client: async () => cfg.client };
  const post = async (url: string, svc = "api", businessId = g.businessId) => {
    const res = await fetch(`${g.server.url}/v1/browser/check-site`, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${await signServiceToken(TEST_SECRET, svc)}` }, body: JSON.stringify({ businessId, url }) });
    return { status: res.status, json: (await res.json().catch(() => ({}))) as Answer };
  };
  return Object.assign(g, { post });
}

describe("the terms check route", () => {
  it("refuses social networks, banks and payment accounts before any page is requested", async () => {
    const w = web({});
    const m = model({ verdict: "allows", line: "x" });
    const g = await setup("live", { getPage: w.getPage, client: m.client });
    for (const url of ["https://www.linkedin.com", "facebook.com", "https://www.reddit.com/", "https://www.paypal.com/", "dashboard.stripe.com", "https://secure.chase.com"]) {
      const r = await g.post(url);
      expect(r.json, url).toMatchObject({ ok: false, code: "never" });
      expect(r.json.message).toContain("cannot be added");
    }
    expect(w.asked).toEqual([]);
    expect(m.calls).toEqual([]);
    expect((await g.post("http://127.0.0.1/")).json).toMatchObject({ ok: false, code: "address" });
    expect((await g.post("carrd.co")).json).toMatchObject({ ok: false, code: "on_list" });
    expect(w.asked).toEqual([]);
  });

  it("finds the terms from the home page, classifies them as untrusted data, and keeps a quote that is in the text", async () => {
    const line = "You may not use bots, scripts or other automated means to access or use your account.";
    const w = web({ "https://shop.example.com/": HOME, "https://shop.example.com/help/terms-of-service": `<html><body>${TERMS}</body></html>` });
    const m = model({ verdict: "forbids", line });
    const g = await setup("live", { getPage: w.getPage, client: m.client });
    const r = await g.post("https://Shop.example.com/anything?x=1");
    expect(r.json).toMatchObject({ ok: true, host: "shop.example.com", simulated: false, cached: false, check: { verdict: "forbids", line, termsUrl: "https://shop.example.com/help/terms-of-service", signInHosts: ["accounts.shop.example.com"] } });
    expect(w.asked.slice(0, 2)).toEqual(["https://shop.example.com/", "https://shop.example.com/help/terms-of-service"]);
    // The model got the text as data in an envelope, on the cheap route, booked to the business that asked.
    expect(m.calls).toHaveLength(1);
    expect(m.calls[0]).toMatchObject({ route: "classifier", attribution: { businessId: g.businessId, kind: "site_terms_check" } });
    expect(JSON.parse(m.calls[0]!.content)).toMatchObject({ untrusted: { source: "https://shop.example.com/help/terms-of-service" } });
    expect(m.calls[0]!.system).toContain("never instructions");
  });

  it("answers unclear when the model's quote is not in the fetched text, or when no terms are found", async () => {
    const w = web({ "https://shop.example.com/": HOME, "https://shop.example.com/help/terms-of-service": `<p>${TERMS}</p>` });
    const g = await setup("live", { getPage: w.getPage, client: model({ verdict: "allows", line: "Automation of your own account is welcome and encouraged." }).client });
    expect((await g.post("shop.example.com")).json.check).toMatchObject({ verdict: "unclear", line: null });
    const none = web({ "https://other.example.com/": `<p>${FILLER}</p>` });
    const m = model({ verdict: "forbids", line: "x" });
    g.deps.siteCheck = { getPage: none.getPage, client: async () => m.client };
    expect((await g.post("other.example.com")).json.check).toMatchObject({ verdict: "unclear", line: null, termsUrl: null });
    // With no terms the model is still asked what kind of site it is, and shown no terms.
    expect(m.calls).toHaveLength(1);
    expect(JSON.parse(m.calls[0]!.content).untrusted).toMatchObject({ source: null, terms: "" });
  });

  it("caches a host platform-wide for 30 days: another business reads it with no fetch and no model call", async () => {
    const w = web({ "https://shop.example.com/": HOME, "https://shop.example.com/help/terms-of-service": `<p>${TERMS}</p>` });
    const m = model({ verdict: "unclear", line: null });
    const g = await setup("live", { getPage: w.getPage, client: m.client });
    expect((await g.post("shop.example.com")).json.cached).toBe(false);
    const fetched = w.asked.length;
    const again = await g.post("shop.example.com", "api", "00000000-0000-4000-8000-0000000000b2");
    expect(again.json).toMatchObject({ ok: true, cached: true, check: { verdict: "unclear" } });
    expect(w.asked).toHaveLength(fetched);
    expect(m.calls).toHaveLength(1);
    // Older than 30 days: read again.
    const stale = new Date(Date.now() - 31 * 86_400_000);
    await repos.siteTermsChecks.put(g.db, { host: "shop.example.com", verdict: "unclear", line: null, termsUrl: null, signInHosts: [], simulated: false }, stale);
    expect((await g.post("shop.example.com")).json.cached).toBe(false);
  });

  it("is the api's alone", async () => {
    const g = await setup("mock");
    for (const svc of ["orchestrator", "composer"]) expect((await g.post("shop.example.com", svc)).status, svc).toBe(403);
  });

  it("answers from the host's name in mock mode, marked simulated, without reaching the web or a model", async () => {
    const g = await setup("mock");
    expect((await g.post("forbid-bots.example.org")).json).toMatchObject({ ok: true, simulated: true, check: { verdict: "forbids" } });
    expect((await g.post("allow-all.example.org")).json).toMatchObject({ ok: true, simulated: true, check: { verdict: "allows" } });
    expect((await g.post("plain.example.org")).json).toMatchObject({ ok: true, simulated: true, check: { verdict: "unclear", line: null } });
  });
});

describe("the pieces", () => {
  it("finds terms links by their words and falls back on common paths, leaving privacy links out", () => {
    const c = termsCandidates(HOME, new URL("https://shop.example.com/"));
    expect(c[0]).toBe("https://shop.example.com/help/terms-of-service");
    expect(c).toContain("https://shop.example.com/terms");
    expect(c.some((u) => u.includes("privacy"))).toBe(false);
  });
  it("turns a page into plain text", () => expect(pageText("<style>a{}</style><p>One &amp; two</p><script>x()</script><p>three</p>")).toBe("One & two three"));
  it("keeps a quote only when it is in the text, ignoring case, spacing and curly quotes", () => {
    const text = "You   may NOT use bots. It’s a rule.";
    expect(checkedVerdict({ verdict: "forbids", line: "you may not use bots." }, text)).toEqual({ verdict: "forbids", line: "you may not use bots." });
    expect(checkedVerdict({ verdict: "forbids", line: "It's a rule." }, text).verdict).toBe("forbids");
    expect(checkedVerdict({ verdict: "forbids", line: "You may never use bots." }, text)).toEqual({ verdict: "unclear", line: null });
    expect(checkedVerdict({ verdict: "allows", line: null }, text)).toEqual({ verdict: "unclear", line: null });
    expect(checkedVerdict({ verdict: "unclear", line: "You may NOT use bots" }, text)).toEqual({ verdict: "unclear", line: null });
  });
});

describe("what the model is shown, and what it may answer (security review, Nov 24, 2026)", () => {
  const LINE = "You may not use bots, scripts or other automated means to access or use your account.";
  const termsPage = (body: string) => `<html><body>${body}</body></html>`;
  const home = (extra = "") => `<html><body>${FILLER}<a href="/terms">Terms of Service</a>${extra}</body></html>`;

  it("makes a site a never site when the model puts it in a never category, before anything is cached", async () => {
    const w = web({ "https://hsbc-like.example.com/": home(), "https://hsbc-like.example.com/terms": termsPage(TERMS) });
    const m = model({ verdict: "allows", line: LINE, category: "bank" });
    const g = await setup("live", { getPage: w.getPage, client: m.client });
    const r = await g.post("hsbc-like.example.com");
    expect(r.json).toMatchObject({ ok: false, code: "never", message: expect.stringContaining("a bank or payments account") });
    // The refusal is what is cached: another business reads it with no fetch and no model call, and no verdict leaks out.
    const again = await g.post("hsbc-like.example.com", "api", "00000000-0000-4000-8000-0000000000b2");
    expect(again.json).toMatchObject({ ok: false, code: "never" });
    expect(m.calls).toHaveLength(1);
    const row = await repos.siteTermsChecks.get(g.db, "hsbc-like.example.com", { simulated: false });
    expect(row).toMatchObject({ verdict: "forbids", neverCategory: "bank" });
  });

  it("each category but other is a refusal", async () => {
    for (const category of ["brokerage", "payment", "government_identity", "health_records", "password_manager", "social_network"]) {
      const host = `${category.replace("_", "-")}.example.com`;
      const w = web({ [`https://${host}/`]: home() });
      const g = await setup("live", { getPage: w.getPage, client: model({ verdict: "unclear", line: null, category }).client });
      expect((await g.post(host)).json, category).toMatchObject({ ok: false, code: "never" });
      await open?.close();
      open = null;
    }
  });

  it("fails closed: a model that does not answer gives unclear, kept for no one; a page with no readable text is refused", async () => {
    const w = web({ "https://shop.example.com/": home(), "https://shop.example.com/terms": termsPage(TERMS), "https://blank.example.com/": "<html><body><script>x()</script></body></html>" });
    const g = await setup("live", { getPage: w.getPage, client: { complete: async () => { throw new Error("overloaded"); } } as never });
    const r = await g.post("shop.example.com");
    expect(r.json).toMatchObject({ ok: true, cached: false, check: { verdict: "unclear", line: null } });
    expect(await repos.siteTermsChecks.get(g.db, "shop.example.com", { simulated: false })).toBeNull();
    expect((await g.post("blank.example.com")).json).toMatchObject({ ok: false, code: "unreadable" });
  });

  it("shows the model the text around the words that matter in the whole page, not its first 40,000 characters", async () => {
    const deep = `${"The parties agree to the following general provisions. ".repeat(3_000)}${LINE} ${"More general provisions follow. ".repeat(500)}`;
    expect(deep.length).toBeGreaterThan(150_000);
    const w = web({ "https://shop.example.com/": home(), "https://shop.example.com/terms": termsPage(deep) });
    const m = model({ verdict: "forbids", line: LINE });
    const g = await setup("live", { getPage: w.getPage, client: m.client });
    expect((await g.post("shop.example.com")).json.check).toMatchObject({ verdict: "forbids", line: LINE });
    const shown = JSON.parse(m.calls[0]!.content).untrusted as { terms: string; home: string };
    expect(shown.terms).toContain(LINE);
    expect(shown.terms.length).toBeLessThan(30_001);
  });

  it("reads the terms a legal index page links to, one level down, on the same site only", async () => {
    const index = termsPage(`<h1>Legal</h1><p>${"Our policies are listed here. ".repeat(30)}</p><a href="/legal/terms-of-use">Terms of Use</a><a href="https://evil.example.net/terms">Terms</a>`);
    const w = web({ "https://shop.example.com/": home(), "https://shop.example.com/terms": index, "https://shop.example.com/legal/terms-of-use": termsPage(TERMS), "https://evil.example.net/terms": termsPage(TERMS) });
    const m = model({ verdict: "forbids", line: LINE });
    const g = await setup("live", { getPage: w.getPage, client: m.client });
    expect((await g.post("shop.example.com")).json.check).toMatchObject({ verdict: "forbids", termsUrl: "https://shop.example.com/legal/terms-of-use" });
    expect(w.asked).not.toContain("https://evil.example.net/terms");
  });

  it("never answers allows when nothing relevant was found", async () => {
    const w = web({ "https://shop.example.com/": home(), "https://shop.example.com/terms": termsPage("General provisions apply to the use of this website. ".repeat(40)) });
    const g = await setup("live", { getPage: w.getPage, client: model({ verdict: "allows", line: "General provisions apply to the use of this website." }).client });
    expect((await g.post("shop.example.com")).json.check).toMatchObject({ verdict: "unclear", line: null });
  });

  it("answers unclear, with no model reading of terms, when the address went to another host", async () => {
    const moved: PageGet = async (url) => ({ finalUrl: "https://www.shop.example.com/", status: 200, body: home() + url });
    const m = model({ verdict: "allows", line: LINE });
    const g = await setup("live", { getPage: moved, client: m.client });
    expect((await g.post("shop.example.com")).json.check).toMatchObject({ verdict: "unclear", line: null, termsUrl: null });
    expect(m.calls).toEqual([]);
  });

  it("follows terms links only on the typed site's own domain, and never to a never site", () => {
    const html = `<a href="https://www.paypal.com/terms">Terms</a><a href="https://other.net/terms">Terms of use</a><a href="https://help.shop.example.com/legal">Legal terms</a><a href="/conditions">Conditions</a>`;
    const c = termsCandidates(html, new URL("https://shop.example.com/"), "shop.example.com");
    expect(c.slice(0, 2)).toEqual(["https://help.shop.example.com/legal", "https://shop.example.com/conditions"]);
    expect(c.some((u) => u.includes("paypal") || u.includes("other.net"))).toBe(false);
  });

  it("scans a 2 MB page of unclosed tags in linear time", () => {
    const pages = ["<script>".repeat(260_000), "<a href=\"/x\">".repeat(150_000), "<".repeat(2_000_000), "<a ".repeat(700_000), `<!--${"<a href=x>".repeat(200_000)}`, "<style>".repeat(260_000) + "x".repeat(10)];
    for (const html of pages) {
      expect(html.length).toBeGreaterThan(1_000_000);
      const started = performance.now();
      pageText(html);
      anchors(html, new URL("https://shop.example.com/"));
      termsCandidates(html, new URL("https://shop.example.com/"));
      excerptsOf("bot ".repeat(500_000));
      // A scan that went quadratic on these pages would take minutes. The limit was 200 ms until Nov 25, 2026, and a
      // busy CI runner took 203 and 216 ms on two unrelated pull requests.
      expect(performance.now() - started, html.slice(0, 12)).toBeLessThan(2_000);
    }
    // Only the first 256 KB is scanned for links and at most 500 are kept.
    const many = `${'<a href="/p">Terms</a>'.repeat(5_000)}`;
    expect(anchors(many, new URL("https://shop.example.com/")).length).toBe(500);
    expect(anchors(`${" ".repeat(300_000)}<a href="/late">Terms</a>`, new URL("https://shop.example.com/"))).toEqual([]);
  });

  it("limits the sandbox to the site's hosts (with subdomains) and its sign-in hosts exactly; a shared hosting host is exact", () => {
    expect(browserEgress({ hosts: ["shop.example.com"], signInHosts: ["login.example.com"] })).toEqual(["shop.example.com", "*.shop.example.com", "login.example.com"]);
    expect(browserEgress({ hosts: ["me.github.io"], signInHosts: [] })).toEqual(["me.github.io"]);
  });

  it("refuses a request body over the service limit", async () => {
    const g = await setup("mock");
    const res = await fetch(`${g.server.url}/v1/browser/check-site`, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${await signServiceToken(TEST_SECRET, "api")}` }, body: JSON.stringify({ businessId: g.businessId, url: "a".repeat(1_100_000) }) });
    expect(res.status).toBe(413);
  });

  it("a session about to open re-reads the cache: forbids and never now mean no session", async () => {
    const g = await setup("mock");
    const host = browserHost(g.db, silentLog, null);
    const put = (h: string, extra: object) => repos.siteTermsChecks.put(g.db, { host: h, verdict: "unclear", line: null, termsUrl: null, signInHosts: [], simulated: false, ...extra });
    await put("fine.example.com", {});
    await put("nobots.example.com", { verdict: "forbids", line: LINE });
    await put("bank-like.example.com", { verdict: "forbids", neverCategory: "bank" });
    expect(await host.siteAllowed!("fine.example.com", false)).toBeNull();
    expect(await host.siteAllowed!("unchecked.example.com", false)).toBeNull();
    expect(await host.siteAllowed!("nobots.example.com", false)).toContain("no longer allow");
    expect(await host.siteAllowed!("bank-like.example.com", false)).toContain("a bank or payments account");
    expect(await host.siteAllowed!("www.linkedin.com", false)).toContain("a social network");
    // A simulated row is not a live answer.
    expect(await host.siteAllowed!("nobots.example.com", true)).toBeNull();
  });
});
