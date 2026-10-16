// @vitest-environment node
/**
 * The browser's API reads, served from the web app's own origin (audit F7, WEB-2): next.config.ts rewrites
 * `/api/trpc/*` to the API with the read's path and input untouched, the CDN never caches the answers, the proxy
 * (session refresh, sign-in redirects) never runs on them, and the root layout warms the API's connection for changes.
 */
import { getRewrittenUrl, unstable_doesMiddlewareMatch, unstable_getResponseFromNextConfig } from "next/experimental/testing/server";
import { describe, expect, it } from "vitest";
import nextConfig from "../../next.config";
import { config as proxyConfig } from "../../proxy";
import { apiRewrites, connectionHints, SAME_ORIGIN_API_HEADERS, SAME_ORIGIN_TRPC_PATH } from "../same-origin-api";
import { QUERY_TIMEOUT_MS } from "../trpc";

describe("same-origin API reads", () => {
  it("rewrites the same-origin path to the API's tRPC endpoint", () => {
    expect(SAME_ORIGIN_TRPC_PATH).toBe("/api/trpc");
    expect(apiRewrites("https://api.foundmill.com/")).toEqual([{ source: "/api/trpc/:path*", destination: "https://api.foundmill.com/trpc/:path*" }]);
  });

  it("hands a batched read to the API with its procedures and input untouched (next.config.ts)", async () => {
    const input = JSON.stringify({ "0": { json: { businessId: "b1", limit: 50 } }, "1": { json: { businessId: "b1" } } });
    const url = `http://localhost:3000/api/trpc/inbox.list,cycle.status?batch=1&input=${encodeURIComponent(input)}`;
    // vitest runs with NEXT_PUBLIC_API_URL=http://localhost:4000 (vitest.config.ts), as the local stack does.
    expect(await nextConfig.rewrites!()).toEqual([{ source: "/api/trpc/:path*", destination: "http://localhost:4000/trpc/:path*" }]);
    const res = await unstable_getResponseFromNextConfig({ url, nextConfig });
    // (Next's test helper drops the destination's port; the server keeps it.)
    const target = new URL(getRewrittenUrl(res) ?? "");
    expect(target.hostname).toBe("localhost");
    expect(target.pathname).toBe("/trpc/inbox.list,cycle.status");
    expect(target.searchParams.get("batch")).toBe("1");
    expect(JSON.parse(target.searchParams.get("input") ?? "null")).toEqual(JSON.parse(input));
  });

  it("tells the CDN never to cache an answer, and lets a slow read end with the browser's own message", async () => {
    const headers = await nextConfig.headers!();
    const own = headers.find((h) => h.source === `${SAME_ORIGIN_TRPC_PATH}/:path*`);
    expect(own?.headers).toEqual([...SAME_ORIGIN_API_HEADERS]);
    expect(SAME_ORIGIN_API_HEADERS).toContainEqual({ key: "x-vercel-enable-rewrite-caching", value: "0" });
    expect(nextConfig.experimental?.proxyTimeout).toBeGreaterThan(QUERY_TIMEOUT_MS);
  });

  it("never runs the proxy (session refresh, sign-in redirects) on a read, and still runs it on every page", () => {
    const matches = (path: string) => unstable_doesMiddlewareMatch({ config: proxyConfig, nextConfig, url: `http://localhost:3000${path}` });
    expect(matches("/api/trpc/inbox.list,cycle.status?batch=1&input=%7B%7D")).toBe(false);
    expect(matches("/api/trpc/founder.profile.get?batch=1")).toBe(false);
    for (const page of ["/", "/login", "/b/b1/home", "/b/b1/inbox", "/b/b1/d/finance/overview", "/api/other"]) expect(matches(page), page).toBe(true);
  });

  it("warms the API's connection and the event stream's name for the root layout", () => {
    expect(connectionHints({ apiUrl: "https://api.foundmill.com", streamUrl: "wss://stream.foundmill.com" })).toEqual({ preconnect: "https://api.foundmill.com", dnsPrefetch: "https://stream.foundmill.com" });
    expect(connectionHints({ apiUrl: "http://localhost:4000", streamUrl: "ws://localhost:4003" })).toEqual({ preconnect: "http://localhost:4000", dnsPrefetch: "http://localhost:4003" });
    // The same origin twice is warmed once; a bad URL is skipped.
    expect(connectionHints({ apiUrl: "https://api.foundmill.com", streamUrl: "wss://api.foundmill.com/ws" })).toEqual({ preconnect: "https://api.foundmill.com", dnsPrefetch: null });
    expect(connectionHints({ apiUrl: "not a url", streamUrl: "" })).toEqual({ preconnect: null, dnsPrefetch: null });
  });
});
