import { describe, expect, it } from "vitest";
import { isUntrusted, readForQuarantine } from "../../quarantine";
import { routedFetch } from "../../http";
import { describeConnectorContract, makeToolContext } from "../../testing/contract-suite";
import { MOCK_PAGES } from "./fixtures/pages";
import { createWebConnector } from "./index";
import { webMock } from "./mock";
import { htmlToText, isPublicAddress, robotsAllows } from "./reader";
import { WEB_ROBOTS_TOKEN, type WebPage } from "./tools";

const page = (r: { data?: unknown }) => readForQuarantine(r.data as never).content as WebPage;

describeConnectorContract("web (mock)", {
  connector: webMock,
  mode: "mock",
  calls: [
    { tool: "fetch", args: { url: "https://example.com/competitor-pricing" }, check: (r) => expect(page(r).text).toContain("$79 per month") },
    { tool: "fetch", args: { url: "https://acme.example/tpd-pricing" }, check: (r) => expect(page(r).text).toMatch(/per month/) },
    { tool: "fetch", args: { url: "https://blocked.example/pricing" }, expectOk: false, check: (r) => expect(r.error?.code).toBe("robots_disallowed") },
    { tool: "fetch", args: { url: "ftp://example.com/file" }, expectOk: false, check: (r) => expect(r.error?.code).toBe("invalid_args") },
    { tool: "fetch", args: { url: "https://user:pw@example.com/" }, expectOk: false, check: (r) => expect(r.error?.code).toBe("invalid_args") },
  ],
});

describe("web reader helpers", () => {
  it("only public unicast addresses are readable", () => {
    for (const ip of ["127.0.0.1", "10.1.2.3", "172.20.0.1", "192.168.1.1", "169.254.169.254", "100.64.0.1", "0.0.0.0", "224.0.0.1", "::1", "fe80::1", "fd00::1", "::ffff:127.0.0.1", "192.0.2.10", "2002:a00:1::1", "2001:0:4136:e378::1", "2001::1"]) expect(isPublicAddress(ip), ip).toBe(false);
    for (const ip of ["93.184.216.34", "8.8.8.8", "2606:4700::1111", "::ffff:8.8.8.8", "2001:4860:4860::8888"]) expect(isPublicAddress(ip), ip).toBe(true);
  });

  it("robots.txt: our group wins over *, longest match wins, allow wins a tie, wildcards and $ anchors work", () => {
    const txt = ["User-agent: *", "Disallow: /", "", `User-agent: ${WEB_ROBOTS_TOKEN.toLowerCase()}`, "Disallow: /private", "Allow: /private/press", "Disallow: /*.pdf$"].join("\n");
    expect(robotsAllows(txt, WEB_ROBOTS_TOKEN, "/pricing")).toBe(true);
    expect(robotsAllows(txt, WEB_ROBOTS_TOKEN, "/private/notes")).toBe(false);
    expect(robotsAllows(txt, WEB_ROBOTS_TOKEN, "/private/press/kit")).toBe(true);
    expect(robotsAllows(txt, WEB_ROBOTS_TOKEN, "/files/deck.pdf")).toBe(false);
    expect(robotsAllows(txt, "OtherBot", "/pricing")).toBe(false);
    expect(robotsAllows("User-agent: *\nDisallow:", WEB_ROBOTS_TOKEN, "/anything")).toBe(true);
  });

  it("HTML becomes readable text without scripts, styles or markup", () => {
    const out = htmlToText(`<html><head><title>Plans &amp; pricing</title><meta name="description" content="Three plans"><script>steal()</script></head><body><nav>Menu</nav><h1>Pricing</h1><p>Starter is <b>$29</b>&nbsp;per month.</p><style>p{}</style><p>Pro is $79.</p></body></html>`);
    expect(out).toEqual({ title: "Plans & pricing", description: "Three plans", text: "Pricing\n\nStarter is $29 per month.\n\nPro is $79." });
  });
});

describe("web live reader (no network)", () => {
  const publicLookup = async () => ["93.184.216.34"];

  it("reads a page within robots.txt and returns it as untrusted content", async () => {
    const c = createWebConnector({
      lookup: publicLookup,
      fetch: routedFetch({
        "GET https://shop.example/robots.txt": () => new Response("User-agent: *\nDisallow: /admin", { headers: { "content-type": "text/plain" } }),
        "GET https://shop.example/pricing": (req) => {
          expect(req.headers.get("user-agent")).toContain(WEB_ROBOTS_TOKEN);
          return new Response("<html><title>Pricing</title><p>Basic $19 per month.</p></html>", { headers: { "content-type": "text/html" } });
        },
      }),
    });
    const r = await c.callTool("fetch", { url: "https://shop.example/pricing" }, makeToolContext(c, { mode: "live" }));
    expect(r.ok).toBe(true);
    expect(isUntrusted(r.data)).toBe(true);
    expect(page(r)).toMatchObject({ title: "Pricing", text: "Pricing\n\nBasic $19 per month.", robots: "allowed", status: 200, truncated: false });
  });

  it("refuses pages robots.txt disallows, private addresses, redirects into the private network and logins", async () => {
    const routes = {
      "GET https://shop.example/robots.txt": () => new Response("User-agent: *\nDisallow: /admin"),
      "GET https://shop.example/admin": () => new Response("secret"),
      "GET https://shop.example/go": () => new Response(null, { status: 302, headers: { location: "http://internal.example/meta" } }),
      "GET https://shop.example/account": () => new Response("no", { status: 401 }),
    };
    const lookup = async (host: string) => (host === "internal.example" ? ["169.254.169.254"] : ["93.184.216.34"]);
    const c = createWebConnector({ lookup, fetch: routedFetch(routes) });
    const ctx = makeToolContext(c, { mode: "live" });
    expect((await c.callTool("fetch", { url: "https://shop.example/admin" }, ctx)).error?.code).toBe("robots_disallowed");
    expect((await c.callTool("fetch", { url: "https://shop.example/go" }, ctx)).error?.code).toBe("blocked_address");
    expect((await c.callTool("fetch", { url: "https://shop.example/account" }, ctx)).error?.code).toBe("login_required");
    expect((await c.callTool("fetch", { url: "http://127.0.0.1/" }, ctx)).error?.code).toBe("blocked_address");
    expect((await c.callTool("fetch", { url: "http://localhost/" }, ctx)).error?.code).toBe("blocked_address");
    expect((await c.callTool("fetch", { url: "https://shop.example:8443/" }, ctx)).error?.code).toBe("blocked_url");
  });

  it("an unreadable robots.txt (server error) means the page is not read; a missing one means no restrictions", async () => {
    const down = createWebConnector({ lookup: publicLookup, fetch: routedFetch({ "GET https://a.example/robots.txt": () => new Response("oops", { status: 500 }), "GET https://a.example/": () => new Response("<p>hi</p>") }) });
    expect((await down.callTool("fetch", { url: "https://a.example/" }, makeToolContext(down, { mode: "live" }))).error?.code).toBe("robots_unreachable");
    const none = createWebConnector({ lookup: publicLookup, fetch: routedFetch({ "GET https://b.example/robots.txt": () => new Response("", { status: 404 }), "GET https://b.example/": () => new Response("plain words", { headers: { "content-type": "text/plain" } }) }) });
    const r = await none.callTool("fetch", { url: "https://b.example/" }, makeToolContext(none, { mode: "live" }));
    expect(page(r)).toMatchObject({ text: "plain words", robots: "no_robots_txt" });
  });

  it("the mock serves the demo fixtures deterministically", async () => {
    const r1 = await webMock.callTool("fetch", { url: "https://example.com/competitor-pricing" }, makeToolContext(webMock));
    const r2 = await webMock.callTool("fetch", { url: "https://example.com/competitor-pricing" }, makeToolContext(webMock));
    expect(page(r1)).toEqual(page(r2));
    expect(page(r1).title).toBe(MOCK_PAGES["https://example.com/competitor-pricing"]!.title);
  });
});
