import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { allowedOrigins, clientOf, createApp, wwwTwinOrigin } from "../app";
import type { ApiDeps } from "../context";

/**
 * CORS for the web origins (docs/DEPLOY.md §2): with APP_URL=https://foundmill.com the API also answers
 * https://www.foundmill.com, so a page still open on www (the web app now redirects www to the apex) keeps working.
 */
beforeEach(() => {
  vi.stubEnv("NEXT_PUBLIC_APP_URL", "");
});
afterEach(() => {
  vi.unstubAllEnvs();
});

describe("allowedOrigins", () => {
  it("allows the apex and its www twin in staging", () => {
    expect(allowedOrigins({ APP_URL: "https://foundmill.com" })).toEqual(["http://localhost:3000", "http://127.0.0.1:3000", "https://foundmill.com", "https://www.foundmill.com"]);
  });

  it("works from a www APP_URL too, and from NEXT_PUBLIC_APP_URL", () => {
    expect(allowedOrigins({ APP_URL: "https://www.foundmill.com/" })).toEqual(expect.arrayContaining(["https://www.foundmill.com", "https://foundmill.com"]));
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://staging.example.com");
    expect(allowedOrigins({ APP_URL: "" })).toEqual(["http://localhost:3000", "http://127.0.0.1:3000", "https://staging.example.com", "https://www.staging.example.com"]);
  });

  it("adds no twin for http, localhost, IPs or a malformed URL", () => {
    expect(allowedOrigins({ APP_URL: "http://localhost:3000" })).toEqual(["http://localhost:3000", "http://127.0.0.1:3000"]);
    expect(allowedOrigins({ APP_URL: "not a url" })).toEqual(["http://localhost:3000", "http://127.0.0.1:3000"]);
    for (const origin of ["http://foundmill.com", "https://localhost:3000", "https://127.0.0.1", "https://[::1]:3000", "https://www.com", "nope"]) expect(wwwTwinOrigin(origin), origin).toBeNull();
    expect(wwwTwinOrigin("https://foundmill.com:8443")).toBe("https://www.foundmill.com:8443");
  });
});

describe("CORS preflight", () => {
  const app = createApp({ env: { APP_URL: "https://foundmill.com" }, log: { info: () => undefined } } as unknown as ApiDeps);
  const preflight = (origin: string) =>
    app.request("/trpc/business.list", { method: "OPTIONS", headers: { origin, "access-control-request-method": "POST", "access-control-request-headers": "authorization,content-type" } });

  it("answers https://www.foundmill.com and https://foundmill.com with credentials", async () => {
    for (const origin of ["https://www.foundmill.com", "https://foundmill.com"]) {
      const res = await preflight(origin);
      expect(res.headers.get("access-control-allow-origin"), origin).toBe(origin);
      expect(res.headers.get("access-control-allow-credentials"), origin).toBe("true");
    }
  });

  it("lets the browser keep a preflight for two hours (Chrome's cap), so a change does not ask again every 10 minutes", async () => {
    expect((await preflight("https://foundmill.com")).headers.get("access-control-max-age")).toBe("7200");
  });

  it("still refuses everything else, look-alikes included", async () => {
    for (const origin of ["https://evil.example", "http://www.foundmill.com", "https://www.foundmill.com.evil.example", "https://wwwfoundmill.com", "https://api.foundmill.com"]) {
      expect((await preflight(origin)).headers.get("access-control-allow-origin"), origin).toBeNull();
    }
  });

  it("lets a browser send x-foundmill-client, should the web ever name itself", async () => {
    const res = await app.request("/trpc/business.list", { method: "OPTIONS", headers: { origin: "https://foundmill.com", "access-control-request-method": "POST", "access-control-request-headers": "authorization,content-type,x-foundmill-client" } });
    expect(res.headers.get("access-control-allow-headers")?.toLowerCase()).toContain("x-foundmill-client");
  });
});

/**
 * The mobile app (docs/mobile) is not a browser: it sends no Origin and gets no CORS answer, and the bearer alone must
 * carry a request through. It names itself with `x-foundmill-client`, which the request log keeps.
 */
describe("a native client without an Origin", () => {
  it("passes the CORS layer untouched and is logged with its client name", async () => {
    const info = vi.fn();
    const app = createApp({ env: { APP_URL: "https://foundmill.com" }, log: { info } } as unknown as ApiDeps);
    const res = await app.request("/", { headers: { authorization: "Bearer not-a-real-token", "x-foundmill-client": "mobile/1.0.0 ios" } });
    expect(res.status).toBe(200);
    expect(res.headers.get("access-control-allow-origin")).toBeNull();
    expect(info).toHaveBeenCalledWith(expect.objectContaining({ method: "GET", path: "/", status: 200, client: "mobile/1.0.0 ios" }), "request");
    const web = await app.request("/");
    expect(web.status).toBe(200);
    expect(info).toHaveBeenLastCalledWith(expect.objectContaining({ path: "/", client: null }), "request");
  });

  it("keeps only a short, printable client name in the log", () => {
    expect(clientOf(undefined)).toBeNull();
    expect(clientOf("")).toBeNull();
    expect(clientOf("mobile/1.0.0 ios")).toBe("mobile/1.0.0 ios");
    expect(clientOf("  mobile/1.0.0-beta.2 android  ")).toBe("mobile/1.0.0-beta.2 android");
    expect(clientOf("mobile/1.0.0 ios extra words here")).toBeNull();
    expect(clientOf("<script>alert(1)</script>")).toBeNull();
    expect(clientOf("x".repeat(65))).toBeNull();
  });
});
