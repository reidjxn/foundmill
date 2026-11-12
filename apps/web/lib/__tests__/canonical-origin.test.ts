// @vitest-environment node
import { getRedirectUrl, unstable_getResponseFromNextConfig } from "next/experimental/testing/server";
import type { NextConfig } from "next";
import { afterEach, describe, expect, it, vi } from "vitest";
import { APP_ORIGIN } from "@foundmill/config";
import { canonicalHostRedirects, canonicalOrigin, googleCallbackUrl, magicLinkCallbackUrl, wwwAliasHost } from "../auth/canonical-origin";

/** The real next.config.ts, loaded fresh under the given NEXT_PUBLIC_APP_URL (it reads the env at import). */
async function loadNextConfig(appUrl: string): Promise<NextConfig> {
  vi.resetModules();
  vi.stubEnv("NEXT_PUBLIC_APP_URL", appUrl);
  return (await import("../../next.config")).default;
}

async function respond(nextConfig: NextConfig, url: string) {
  const res = await unstable_getResponseFromNextConfig({ url, nextConfig });
  return { status: res.status, location: getRedirectUrl(res) };
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("next.config.ts: www.foundmill.com is a permanent redirect to the apex", () => {
  it("answers every path on www with a 308 to the same path and query on https://foundmill.com", async () => {
    const config = await loadNextConfig("");
    expect(await respond(config, "https://www.foundmill.com/")).toEqual({ status: 308, location: "https://foundmill.com/" });
    expect(await respond(config, "https://www.foundmill.com/login")).toEqual({ status: 308, location: "https://foundmill.com/login" });
    expect(await respond(config, "https://www.foundmill.com/login?next=%2Fb%2Fabc%2Finbox")).toEqual({ status: 308, location: "https://foundmill.com/login?next=%2Fb%2Fabc%2Finbox" });
    expect(await respond(config, "https://www.foundmill.com/auth/callback?code=x&next=%2Fb%2Fabc")).toEqual({ status: 308, location: "https://foundmill.com/auth/callback?code=x&next=%2Fb%2Fabc" });
    expect(await respond(config, "https://www.foundmill.com/b/abc/team/agents")).toEqual({ status: 308, location: "https://foundmill.com/b/abc/team/agents" });
  });

  it("leaves the apex, other hosts and look-alike hosts alone", async () => {
    const config = await loadNextConfig("");
    for (const url of ["https://foundmill.com/", "https://foundmill.com/login?next=%2F", "http://localhost:3000/login", "https://foundmill-git-main.vercel.app/", "https://wwwxfoundmill.com/", "https://www.foundmill.com.evil.example/"]) {
      expect((await respond(config, url)).status, url).toBe(200);
    }
  });

  it("follows NEXT_PUBLIC_APP_URL, and a local origin has no www twin to redirect", async () => {
    expect(await respond(await loadNextConfig("https://staging.example.com"), "https://www.staging.example.com/login?next=%2F")).toEqual({ status: 308, location: "https://staging.example.com/login?next=%2F" });
    expect((await respond(await loadNextConfig("http://localhost:3000"), "https://www.foundmill.com/login")).status).toBe(200);
  });
});

describe("canonical origin", () => {
  it("is NEXT_PUBLIC_APP_URL's origin when it is a URL, the apex otherwise", () => {
    expect(APP_ORIGIN).toBe("https://foundmill.com");
    expect(canonicalOrigin(undefined)).toBe(APP_ORIGIN);
    expect(canonicalOrigin("")).toBe(APP_ORIGIN);
    expect(canonicalOrigin("  ")).toBe(APP_ORIGIN);
    expect(canonicalOrigin("not a url")).toBe(APP_ORIGIN);
    expect(canonicalOrigin("javascript:alert(1)")).toBe(APP_ORIGIN);
    expect(canonicalOrigin("https://foundmill.com/")).toBe("https://foundmill.com");
    expect(canonicalOrigin("http://localhost:3000/some/path")).toBe("http://localhost:3000");
  });

  it("has a www twin only for an https apex or subdomain", () => {
    expect(wwwAliasHost("https://foundmill.com")).toBe("www.foundmill.com");
    expect(wwwAliasHost("https://www.foundmill.com")).toBeNull();
    expect(wwwAliasHost("http://foundmill.com")).toBeNull();
    expect(wwwAliasHost("http://localhost:3000")).toBeNull();
    expect(wwwAliasHost("https://localhost")).toBeNull();
    expect(wwwAliasHost("https://127.0.0.1:3000")).toBeNull();
    expect(wwwAliasHost("https://[::1]:3000")).toBeNull();
    expect(wwwAliasHost("nope")).toBeNull();
  });

  it("builds one host-matched redirect with the dots escaped", () => {
    expect(canonicalHostRedirects("https://foundmill.com")).toEqual([{ source: "/:path*", has: [{ type: "host", value: "www\\.foundmill\\.com" }], destination: "https://foundmill.com/:path*", permanent: true }]);
    expect(canonicalHostRedirects("http://localhost:3000")).toEqual([]);
  });
});

describe("magic-link callback URL", () => {
  const next = "/b/abc/inbox";

  it("points at the apex in staging and production whatever host the form was on", () => {
    for (const appEnv of ["staging", "production"] as const) {
      for (const currentOrigin of ["https://www.foundmill.com", "https://foundmill.com", "https://foundmill-git-x.vercel.app"]) {
        expect(magicLinkCallbackUrl({ appUrl: "", appEnv, currentOrigin, next })).toBe("https://foundmill.com/auth/callback?next=%2Fb%2Fabc%2Finbox");
        expect(magicLinkCallbackUrl({ appUrl: undefined, appEnv, currentOrigin, next })).toBe("https://foundmill.com/auth/callback?next=%2Fb%2Fabc%2Finbox");
      }
    }
  });

  it("uses NEXT_PUBLIC_APP_URL when set, in every environment", () => {
    expect(magicLinkCallbackUrl({ appUrl: "https://staging.example.com/", appEnv: "staging", currentOrigin: "https://www.staging.example.com", next: "/" })).toBe("https://staging.example.com/auth/callback?next=%2F");
    expect(magicLinkCallbackUrl({ appUrl: "http://localhost:3000", appEnv: "development", currentOrigin: "http://127.0.0.1:3000", next: "/" })).toBe("http://localhost:3000/auth/callback?next=%2F");
  });

  it("keeps the page's own origin for a local stack without NEXT_PUBLIC_APP_URL", () => {
    expect(magicLinkCallbackUrl({ appUrl: "", appEnv: "development", currentOrigin: "http://localhost:3000", next })).toBe("http://localhost:3000/auth/callback?next=%2Fb%2Fabc%2Finbox");
    expect(magicLinkCallbackUrl({ appUrl: "", appEnv: "test", currentOrigin: "http://localhost:3000", next: "/" })).toBe("http://localhost:3000/auth/callback?next=%2F");
  });
});

describe("googleCallbackUrl", () => {
  it("is the magic link's callback (same origin, same next) marked via=google", () => {
    expect(googleCallbackUrl({ appUrl: "", appEnv: "production", currentOrigin: "https://www.foundmill.com", next: "/b/abc/inbox" })).toBe("https://foundmill.com/auth/callback?next=%2Fb%2Fabc%2Finbox&via=google");
    expect(googleCallbackUrl({ appUrl: "", appEnv: "test", currentOrigin: "http://localhost:3000", next: "/" })).toBe("http://localhost:3000/auth/callback?next=%2F&via=google");
  });
});
