// @vitest-environment node
import { describe, expect, it } from "vitest";
import { contentSecurityPolicy, securityHeaders } from "../security-headers";

const PROD = {
  NEXT_PUBLIC_API_URL: "https://api.foundmill.com",
  NEXT_PUBLIC_STREAM_URL: "wss://stream.foundmill.com",
  NEXT_PUBLIC_COLLAB_URL: "wss://collab.foundmill.com",
  NEXT_PUBLIC_INGEST_URL: "https://ingest.foundmill.com",
  NEXT_PUBLIC_SUPABASE_URL: "https://abc.supabase.co",
};

const directive = (csp: string, name: string) => csp.split("; ").find((d) => d.startsWith(`${name} `))?.slice(name.length + 1).split(" ") ?? [];

describe("security headers (audit SECX-7, PAS-3)", () => {
  it("sends every header on every path", () => {
    const headers = Object.fromEntries(securityHeaders(PROD).map((h) => [h.key, h.value]));
    expect(Object.keys(headers).sort()).toEqual(["Content-Security-Policy", "Permissions-Policy", "Referrer-Policy", "Strict-Transport-Security", "X-Content-Type-Options", "X-Frame-Options"]);
    expect(headers["X-Frame-Options"]).toBe("DENY");
    expect(headers["X-Content-Type-Options"]).toBe("nosniff");
    expect(headers["Referrer-Policy"]).toBe("strict-origin-when-cross-origin");
    expect(headers["Permissions-Policy"]).toContain("camera=()");
    expect(headers["Strict-Transport-Security"]).toMatch(/^max-age=\d+/);
  });

  it("forbids framing, plugins and a changed base, and keeps forms on the site", () => {
    const csp = contentSecurityPolicy(PROD);
    expect(directive(csp, "frame-ancestors")).toEqual(["'none'"]);
    expect(directive(csp, "object-src")).toEqual(["'none'"]);
    expect(directive(csp, "base-uri")).toEqual(["'self'"]);
    expect(directive(csp, "form-action")).toEqual(["'self'"]);
    expect(directive(csp, "default-src")).toEqual(["'self'"]);
  });

  it("allows scripts from the app only, and eval only on the dev server", () => {
    expect(directive(contentSecurityPolicy(PROD), "script-src")).toEqual(["'self'", "'unsafe-inline'"]);
    expect(directive(contentSecurityPolicy(PROD, { dev: true }), "script-src")).toContain("'unsafe-eval'");
    expect(contentSecurityPolicy(PROD)).not.toMatch(/script-src[^;]*https?:/);
  });

  it("connects to the app's own services over both schemes, and nowhere else", () => {
    const connect = directive(contentSecurityPolicy(PROD), "connect-src");
    expect(connect.sort()).toEqual(
      [
        "'self'",
        "https://api.foundmill.com", "wss://api.foundmill.com",
        "wss://stream.foundmill.com", "https://stream.foundmill.com",
        "wss://collab.foundmill.com", "https://collab.foundmill.com",
        "https://ingest.foundmill.com", "wss://ingest.foundmill.com",
        "https://abc.supabase.co", "wss://abc.supabase.co",
      ].sort(),
    );
    expect(connect).not.toContain("*");
    expect(connect).not.toContain("ws:");
  });

  it("covers the local stack, skips an empty collab URL and tolerates a bad one", () => {
    const local = { ...PROD, NEXT_PUBLIC_API_URL: "http://localhost:4000", NEXT_PUBLIC_STREAM_URL: "ws://localhost:4003", NEXT_PUBLIC_COLLAB_URL: "", NEXT_PUBLIC_SUPABASE_URL: "not a url" };
    const connect = directive(contentSecurityPolicy(local, { dev: true }), "connect-src");
    expect(connect).toEqual(expect.arrayContaining(["http://localhost:4000", "ws://localhost:4000", "ws://localhost:4003", "http://localhost:4003", "ws:"]));
    expect(connect.some((c) => c.includes("collab"))).toBe(false);
  });

  it("is wired into next.config.ts for every path", async () => {
    const { readFileSync } = await import("node:fs");
    const { fileURLToPath } = await import("node:url");
    const config = readFileSync(fileURLToPath(new URL("../../next.config.ts", import.meta.url)), "utf8");
    expect(config).toContain("securityHeaders(");
    expect(config).toContain('source: "/:path*"');
    expect(config).toContain("poweredByHeader: false");
  });
});
