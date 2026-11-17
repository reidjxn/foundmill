import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { createSitesApp, sitePath, siteLabel, type ResolvedSite, type SiteFile, type SitesDeps } from "../app";
import { siteCsp } from "../headers";

const DOMAIN = "sites.localhost";
const TOKEN = "0123456789abcdef0123456789abcdef";
const enc = new TextEncoder();
const file = (text: string): SiteFile => ({ content: enc.encode(text), sha256: createHash("sha256").update(text).digest("hex"), size: text.length });

const RELEASES: Record<string, Record<string, SiteFile>> = {
  "rel-live": {
    "index.html": file("<!doctype html><html><body><h1>Lunchbox</h1></body></html>"),
    "about/index.html": file("<html><body>About</body></html>"),
    "styles.css": file("h1{color:red}"),
    "logo.svg": file('<svg xmlns="http://www.w3.org/2000/svg"></svg>'),
    "app.js": file("alert(1)"),
    ".env": file("SECRET=1"),
    "404.html": file("<html><body>Lost</body></html>"),
  },
  "rel-preview": { "index.html": file("<html><body>Preview</body></html>") },
  "rel-paid": { "index.html": file("<html><body>Paid</body></html>") },
};

const SITES: Record<string, ResolvedSite> = {
  lunchbox: { releaseId: "rel-live", businessId: "b1", kind: "live", planTier: "free" },
  paidco: { releaseId: "rel-paid", businessId: "b2", kind: "live", planTier: "pro" },
  gone: { releaseId: null, businessId: "b3", kind: "taken_down", planTier: "free" },
  [`p-${TOKEN}`]: { releaseId: "rel-preview", businessId: "b1", kind: "preview", planTier: "free" },
};

function makeApp(overrides: Partial<SitesDeps> = {}) {
  const reports: { label: string; reason: string; detail: string }[] = [];
  const submits: Parameters<SitesDeps["follow"]["submit"]>[0][] = [];
  const deps: SitesDeps = {
    env: { APP_ENV: "production", APP_URL: "https://foundmill.com", SITES_DOMAIN: DOMAIN },
    resolve: async (label) => SITES[label] ?? null,
    readFile: async (releaseId, path) => RELEASES[releaseId]?.[path] ?? null,
    report: async (label, reason, detail) => {
      reports.push({ label, reason, detail });
      return "recorded";
    },
    ping: async () => true,
    payLink: async (label, key) => (key === "starter" && (label === "lunchbox" || label === `p-${TOKEN}`) ? "https://buy.stripe.com/test_starter" : key === "tampered" ? "https://evil.example/x" : null),
    follow: {
      consent: async (slug) => (SITES[slug]?.kind === "live" ? { consentText: "I agree to get email from Lunchbox about the project. I can stop at any time." } : null),
      submit: async (input) => {
        submits.push(input);
        return { ok: true };
      },
    },
    turnstileSiteKey: null,
    log: { info: () => {}, warn: () => {} },
    ...overrides,
  };
  const app = createSitesApp(deps);
  const req = (host: string, path = "/", init: RequestInit = {}) => app.request(`http://${host}${path}`, { ...init, headers: { host, ...(init.headers as Record<string, string> | undefined) } });
  return { app, req, reports, submits };
}

const EXPECTED_LIVE = {
  "content-security-policy": "default-src 'none'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; font-src 'self'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'",
  "x-content-type-options": "nosniff",
  "referrer-policy": "strict-origin-when-cross-origin",
  "cross-origin-opener-policy": "same-origin",
  "permissions-policy": "camera=(), microphone=(), geolocation=()",
  "strict-transport-security": "max-age=31536000; includeSubDomains",
};

describe("apps/sites", () => {
  it("serves a live site's index.html with the exact header set and one footer", async () => {
    const { req } = makeApp();
    const res = await req(`lunchbox.${DOMAIN}`);
    expect(res.status).toBe(200);
    for (const [k, v] of Object.entries(EXPECTED_LIVE)) expect(res.headers.get(k)).toBe(v);
    expect(res.headers.get("content-type")).toBe("text/html; charset=utf-8");
    expect(res.headers.get("cache-control")).toBe("public, max-age=60");
    expect(res.headers.get("x-robots-tag")).toBeNull();
    expect(res.headers.get("set-cookie")).toBeNull();
    const body = await res.text();
    expect(body).toContain("<h1>Lunchbox</h1>");
    expect(body.match(/data-fm-footer/g)).toHaveLength(1);
    expect(body).toContain('href="/_fm/report"');
    expect(body).toContain("Built on Foundmill");
    expect(body.indexOf("data-fm-footer")).toBeLessThan(body.indexOf("</body>"));
  });

  it("gives a paid project the report link and no mark", async () => {
    const body = await (await makeApp().req(`paidco.${DOMAIN}`)).text();
    expect(body).toContain("Report this site");
    expect(body).not.toContain("Built on");
  });

  it("serves other live files for an hour with their hash, and answers a matching ETag with 304", async () => {
    const { req } = makeApp();
    const res = await req(`lunchbox.${DOMAIN}`, "/styles.css");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("text/css; charset=utf-8");
    expect(res.headers.get("cache-control")).toBe("public, max-age=3600");
    const etag = res.headers.get("etag");
    expect(etag).toMatch(/^"[0-9a-f]{64}"$/);
    expect(await res.text()).toBe("h1{color:red}");
    expect((await req(`lunchbox.${DOMAIN}`, "/styles.css", { headers: { "if-none-match": etag! } })).status).toBe(304);
  });

  it("serves a preview with noindex and no-store, and lets only the product frame it", async () => {
    const res = await makeApp().req(`p-${TOKEN}.${DOMAIN}`);
    expect(res.status).toBe(200);
    expect(res.headers.get("x-robots-tag")).toBe("noindex, nofollow");
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(res.headers.get("content-security-policy")).toContain("frame-ancestors https://foundmill.com");
    // The preview's host carries its token: it is never sent on to a site the preview links to.
    expect(res.headers.get("referrer-policy")).toBe("no-referrer");
    expect(await res.text()).toContain("Preview");
  });

  it("serves an SVG as an image, never as a page (a page carries the footer)", async () => {
    const { req } = makeApp();
    expect((await req(`lunchbox.${DOMAIN}`, "/logo.svg", { headers: { "sec-fetch-dest": "image" } })).status).toBe(200);
    expect((await req(`lunchbox.${DOMAIN}`, "/logo.svg", { headers: { "sec-fetch-dest": "document" } })).status).toBe(404);
  });

  it("maps folders to index.html and unknown paths to the release's 404.html", async () => {
    const { req } = makeApp();
    expect(await (await req(`lunchbox.${DOMAIN}`, "/about/")).text()).toContain("About");
    expect(await (await req(`lunchbox.${DOMAIN}`, "/about")).text()).toContain("About");
    const missing = await req(`lunchbox.${DOMAIN}`, "/nothing.html");
    expect(missing.status).toBe(404);
    expect(await missing.text()).toContain("Lost");
  });

  it.each([
    ["an unknown label", `nobody.${DOMAIN}`, "/"],
    ["a host outside SITES_DOMAIN", "lunchbox.example.com", "/"],
    ["the bare domain", DOMAIN, "/"],
    ["a nested label", `a.lunchbox.${DOMAIN}`, "/"],
    ["a path with ..", `lunchbox.${DOMAIN}`, "/a/..%2findex.html"],
    ["a dotfile", `lunchbox.${DOMAIN}`, "/.env"],
    ["a script", `lunchbox.${DOMAIN}`, "/app.js"],
    ["a platform path", `lunchbox.${DOMAIN}`, "/_fm/anything"],
  ])("answers 404 for %s", async (_what, host, path) => {
    const res = await makeApp().req(host, path);
    expect(res.status).toBe(404);
    expect(res.headers.get("set-cookie")).toBeNull();
    expect(res.headers.get("content-security-policy")).toContain("default-src 'none'");
    expect(await res.text()).not.toContain("alert(1)");
  });

  it("answers a held release or a draft site with 404 (site_resolve returns nothing for them)", async () => {
    const res = await makeApp({ resolve: async () => null }).req(`lunchbox.${DOMAIN}`);
    expect(res.status).toBe(404);
  });

  it("answers 410 for a taken-down site, on every path", async () => {
    const { req } = makeApp();
    for (const path of ["/", "/about/", "/_fm/report"]) {
      const res = await req(`gone.${DOMAIN}`, path);
      expect(res.status).toBe(410);
      expect(await res.text()).toContain("This site is no longer available.");
    }
  });

  it("refuses other methods on site paths", async () => {
    const { req } = makeApp();
    const res = await req(`lunchbox.${DOMAIN}`, "/", { method: "POST", body: "x" });
    expect(res.status).toBe(405);
    expect(res.headers.get("allow")).toBe("GET, HEAD");
    expect((await req(`lunchbox.${DOMAIN}`, "/", { method: "HEAD" })).status).toBe(200);
  });

  it("answers /health on any host", async () => {
    const res = await makeApp().req("internal:8080", "/health");
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, service: "sites", enabled: true });
  });

  it("takes a report for a live site, without anything about the reporter", async () => {
    const { req, reports } = makeApp();
    const form = await req(`lunchbox.${DOMAIN}`, "/_fm/report");
    expect(form.status).toBe(200);
    const html = await form.text();
    expect(html).toContain('action="/_fm/report"');
    expect(html).not.toMatch(/<script/i);
    const post = await req(`lunchbox.${DOMAIN}`, "/_fm/report", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ reason: "scam", detail: "asks for <b>money</b>", email: "me@example.com" }).toString(),
    });
    expect(post.status).toBe(200);
    expect(reports).toEqual([{ label: "lunchbox", reason: "scam", detail: "asks for <b>money</b>" }]);
    expect(post.headers.get("set-cookie")).toBeNull();
  });

  it("refuses an unknown reason, a body over 4 KB, and reports on a preview", async () => {
    const { req, reports } = makeApp();
    const post = (host: string, body: string) => req(host, "/_fm/report", { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body });
    expect((await post(`lunchbox.${DOMAIN}`, "reason=nonsense")).status).toBe(400);
    expect((await post(`lunchbox.${DOMAIN}`, `reason=scam&detail=${"x".repeat(5000)}`)).status).toBe(413);
    expect(reports).toHaveLength(0);
    // A preview link can be passed around, so it can be reported too.
    expect((await post(`p-${TOKEN}.${DOMAIN}`, "reason=scam")).status).toBe(200);
    expect(reports.map((r) => r.label)).toEqual([`p-${TOKEN}`]);
  });

  it("says when a site has had too many reports", async () => {
    const { req } = makeApp({ report: async () => "limited" });
    const res = await req(`lunchbox.${DOMAIN}`, "/_fm/report", { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: "reason=scam" });
    expect(res.status).toBe(429);
  });

  it("answers an error with the header set and no detail", async () => {
    const res = await makeApp({ readFile: async () => { throw new Error("db down: secret detail"); } }).req(`lunchbox.${DOMAIN}`);
    expect(res.status).toBe(500);
    expect(res.headers.get("content-security-policy")).toContain("default-src 'none'");
    expect(await res.text()).not.toContain("secret detail");
  });
});

describe("helpers", () => {
  it("reads the first label of a host on the sites domain", () => {
    expect(siteLabel(`lunchbox.${DOMAIN}:4007`, DOMAIN)).toBe("lunchbox");
    expect(siteLabel(`LunchBox.${DOMAIN}.`, DOMAIN)).toBe("lunchbox");
    expect(siteLabel(`x.lunchbox.${DOMAIN}`, DOMAIN)).toBeNull();
    expect(siteLabel(`evil${DOMAIN}`, DOMAIN)).toBeNull();
    expect(siteLabel(`lunchbox.${DOMAIN}`, null)).toBeNull();
  });

  it("normalizes paths and refuses traversal", () => {
    expect(sitePath("/")).toBe("index.html");
    expect(sitePath("/blog/")).toBe("blog/index.html");
    expect(sitePath("/img/a%20b.png")).toBe("img/a b.png");
    expect(sitePath("/../x")).toBeNull();
    expect(sitePath("/a/..%2fb")).toBeNull();
    expect(sitePath("/a//b")).toBeNull();
    expect(sitePath("/a\\b")).toBeNull();
    expect(sitePath("/%E0%A4%A")).toBeNull();
    expect(sitePath("/.git/config")).toBeNull();
  });

  it("frames nothing live, and a preview only from the product", () => {
    expect(siteCsp({ kind: "live", appOrigin: "https://foundmill.com" })).toContain("frame-ancestors 'none'");
    expect(siteCsp({ kind: "preview", appOrigin: null })).toContain("frame-ancestors 'none'");
  });
});

describe("the sign-up form", () => {
  const form = (body: Record<string, string>) => ({ method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams(body).toString() });

  it("asks for consent on the platform's own page: the address escaped, the box unticked, the hidden field", async () => {
    const { req, submits } = makeApp();
    const res = await req(`lunchbox.${DOMAIN}`, "/_fm/follow", form({ email: "ME@example.com", name: "<b>x</b>", card: "4242424242424242" }));
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("me@example.com");
    expect(html).toContain('type="checkbox" name="consent" value="yes" required>');
    expect(html).not.toMatch(/checked/);
    expect(html).toContain('name="website"');
    expect(html).toContain("I agree to get email from Lunchbox");
    expect(html).not.toContain("4242");
    expect(submits).toEqual([]);
  });

  it("escapes an address that is not one, and refuses it", async () => {
    const res = await makeApp().req(`lunchbox.${DOMAIN}`, "/_fm/follow", form({ email: '"><script>x</script>@example.com' }));
    expect(res.status).toBe(400);
    expect(await res.text()).not.toContain("<script>x");
  });

  it("calls the api's follow path once the box is ticked, with nothing else the visitor typed", async () => {
    const { req, submits } = makeApp();
    const res = await req(`lunchbox.${DOMAIN}`, "/_fm/follow/confirm", form({ email: "me@example.com", consent: "yes", website: "", "cf-turnstile-response": "tok", extra: "ignored" }));
    expect(res.status).toBe(200);
    expect(await res.text()).toContain("Check your inbox");
    expect(submits).toEqual([{ slug: "lunchbox", email: "me@example.com", consent: true, website: "", turnstile: "tok" }]);
  });

  it("refuses without the box, and shows the api's refusal in plain words", async () => {
    const { req, submits } = makeApp({ follow: { consent: async () => ({ consentText: "x" }), submit: async () => ({ refused: "We could not check this browser." }) } });
    expect((await req(`lunchbox.${DOMAIN}`, "/_fm/follow/confirm", form({ email: "me@example.com" }))).status).toBe(400);
    const refused = await req(`lunchbox.${DOMAIN}`, "/_fm/follow/confirm", form({ email: "me@example.com", consent: "yes" }));
    expect(await refused.text()).toContain("We could not check this browser.");
    expect(submits).toEqual([]);
  });

  it("never posts onward from a preview, refuses over 4 KB, and answers GET with 405", async () => {
    const { req, submits } = makeApp();
    expect(await (await req(`p-${TOKEN}.${DOMAIN}`, "/_fm/follow", form({ email: "me@example.com" }))).text()).toContain("Sign-ups open when the site is published.");
    expect(await (await req(`p-${TOKEN}.${DOMAIN}`, "/_fm/follow/confirm", form({ email: "me@example.com", consent: "yes" }))).text()).toContain("Sign-ups open");
    expect((await req(`lunchbox.${DOMAIN}`, "/_fm/follow", form({ email: "me@example.com", pad: "x".repeat(5000) }))).status).toBe(413);
    expect((await req(`lunchbox.${DOMAIN}`, "/_fm/follow")).status).toBe(405);
    expect(submits).toEqual([]);
  });

  it("lets the bot check's script run on the sign-up page only, when a site key is set", async () => {
    const { req } = makeApp({ turnstileSiteKey: "0x4AAA" });
    const res = await req(`lunchbox.${DOMAIN}`, "/_fm/follow", form({ email: "me@example.com" }));
    expect(res.headers.get("content-security-policy")).toContain("script-src https://challenges.cloudflare.com");
    expect(await res.text()).toContain('data-sitekey="0x4AAA"');
    expect((await req(`lunchbox.${DOMAIN}`, "/")).headers.get("content-security-policy")).not.toContain("script-src");
  });
});


describe("pay buttons", () => {
  it("redirects a live site's button to the stored link with no referrer, and caches nothing", async () => {
    const { req } = makeApp();
    const res = await req(`lunchbox.${DOMAIN}`, "/_fm/pay/starter");
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("https://buy.stripe.com/test_starter");
    expect(res.headers.get("referrer-policy")).toBe("no-referrer");
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(res.headers.get("content-security-policy")).toBe(EXPECTED_LIVE["content-security-policy"]);
    expect(res.headers.get("set-cookie")).toBeNull();
  });

  it("redirects on a preview too, so the founder can try the button", async () => {
    const { req } = makeApp();
    const res = await req(`p-${TOKEN}.${DOMAIN}`, "/_fm/pay/starter");
    expect(res.status).toBe(302);
    expect(res.headers.get("x-robots-tag")).toBe("noindex, nofollow");
  });

  it("answers 404 for an unknown key, a malformed key, another site's key, or a stored URL that is not a Stripe link", async () => {
    const { req } = makeApp();
    for (const path of ["/_fm/pay/nothing", "/_fm/pay/Bad%20Key", "/_fm/pay/..%2Fx", "/_fm/pay/tampered", "/_fm/pay/"]) {
      expect((await req(`lunchbox.${DOMAIN}`, path)).status, path).toBe(404);
    }
    expect((await req(`paidco.${DOMAIN}`, "/_fm/pay/starter")).status).toBe(404);
  });

  it("a taken-down site answers 410, an unknown host 404, and POST is refused", async () => {
    const { req } = makeApp();
    expect((await req(`gone.${DOMAIN}`, "/_fm/pay/starter")).status).toBe(410);
    expect((await req(`nobody.${DOMAIN}`, "/_fm/pay/starter")).status).toBe(404);
    expect((await req(`lunchbox.${DOMAIN}`, "/_fm/pay/starter", { method: "POST" })).status).toBe(404);
  });
});
