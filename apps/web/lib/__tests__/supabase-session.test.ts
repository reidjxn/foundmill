// @vitest-environment node
/**
 * The server's Supabase session checks (audit topology F2/F3, WEB-1): a valid token is verified locally (the signing
 * keys are fetched once and kept), never with a call to Supabase Auth per request; an expired token is still
 * refreshed and the new cookies written; and a refresh that never answers reads as signed out within the deadline
 * instead of hanging the request. Real @supabase/ssr and auth-js over a stubbed `fetch` and an ES256 key made here.
 */
import { NextRequest } from "next/server";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { resetPublicEnvCache } from "../env";

const SUPABASE_URL = "https://testproj.supabase.co";
const AUTH_COOKIE = "sb-testproj-auth-token";
const USER_ID = "0f0a0d00-0000-4000-8000-00000000f0a1";
const KID = "test-key-1";

/** The request cookies getServerSession reads through next/headers. */
let serverCookies: { name: string; value: string }[] = [];
vi.mock("next/headers", () => ({
  cookies: async () => ({ getAll: () => serverCookies, set: () => undefined }),
}));

const { updateSession } = await import("../supabase/middleware");
const { getServerSession } = await import("../supabase/server");
const { AUTH_DEADLINE_MS, withDeadline } = await import("../supabase/timeouts");
const { proxy } = await import("../../proxy");

const enc = new TextEncoder();
const b64url = (bytes: Uint8Array | ArrayBuffer) => Buffer.from(bytes instanceof ArrayBuffer ? new Uint8Array(bytes) : bytes).toString("base64url");

let keys: CryptoKeyPair;
let publicJwk: JsonWebKey & { kid: string; alg: string; use: string };

async function signToken(expiresInSeconds: number): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const header = b64url(enc.encode(JSON.stringify({ alg: "ES256", typ: "JWT", kid: KID })));
  const payload = b64url(enc.encode(JSON.stringify({ sub: USER_ID, email: "founder@example.com", aud: "authenticated", role: "authenticated", iat: now, exp: now + expiresInSeconds })));
  const signature = await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, keys.privateKey, enc.encode(`${header}.${payload}`));
  return `${header}.${payload}.${b64url(signature)}`;
}

function sessionBody(accessToken: string, expiresInSeconds: number) {
  return {
    access_token: accessToken,
    refresh_token: "refresh-1",
    token_type: "bearer",
    expires_in: expiresInSeconds,
    expires_at: Math.floor(Date.now() / 1000) + expiresInSeconds,
    user: { id: USER_ID, aud: "authenticated", role: "authenticated", email: "founder@example.com", app_metadata: {}, user_metadata: {}, created_at: "2026-10-01T00:00:00Z" },
  };
}

/** The auth cookie @supabase/ssr writes (base64url, one chunk at this size). */
function authCookie(session: object): string {
  return `base64-${Buffer.from(JSON.stringify(session)).toString("base64url")}`;
}

type Route = (url: URL, init?: RequestInit) => Promise<Response>;
let route: Route;
const calls: string[] = [];

beforeAll(async () => {
  keys = (await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"])) as CryptoKeyPair;
  publicJwk = { ...(await crypto.subtle.exportKey("jwk", keys.publicKey)), kid: KID, alg: "ES256", use: "sig" };
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", SUPABASE_URL);
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "anon-key");
  resetPublicEnvCache();
  vi.stubGlobal("fetch", (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
    calls.push(`${init?.method ?? "GET"} ${url.pathname}`);
    return route(url, init);
  });
});

afterAll(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  resetPublicEnvCache();
});

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
/** Supabase Auth as it answers: the signing keys; anything else is a test failure unless a test routes it. */
const keysOnly: Route = async (url) => {
  if (url.pathname === "/auth/v1/.well-known/jwks.json") return json({ keys: [publicJwk] });
  throw new Error(`unexpected Supabase call ${url.pathname}`);
};

beforeEach(() => {
  calls.length = 0;
  route = keysOnly;
  serverCookies = [];
});

afterEach(() => {
  vi.useRealTimers();
});

function request(path: string, cookies: Record<string, string>): NextRequest {
  const cookie = Object.entries(cookies)
    .map(([k, v]) => `${k}=${v}`)
    .join("; ");
  return new NextRequest(`http://localhost:3000${path}`, { headers: { cookie } });
}

describe("proxy session check (lib/supabase/middleware.ts)", () => {
  it("verifies a valid token locally: the signing keys once, then no Supabase call at all, and never /auth/v1/user", async () => {
    const token = await signToken(3600);
    const cookies = { [AUTH_COOKIE]: authCookie(sessionBody(token, 3600)) };
    expect((await updateSession(request("/b/x/home", cookies))).authenticated).toBe(true);
    expect(calls.every((c) => c === "GET /auth/v1/.well-known/jwks.json")).toBe(true);
    calls.length = 0;
    for (let i = 0; i < 3; i++) expect((await updateSession(request("/b/x/inbox", cookies))).authenticated).toBe(true);
    expect(calls).toEqual([]);
  });

  it("refuses a token that is not signed by the project's key", async () => {
    const token = await signToken(3600);
    const [header, payload] = token.split(".");
    const forged = `${header}.${payload}.${b64url(new Uint8Array(64))}`;
    const res = await updateSession(request("/b/x/home", { [AUTH_COOKIE]: authCookie(sessionBody(forged, 3600)) }));
    expect(res.authenticated).toBe(false);
  });

  it("still refreshes an expired token and writes the new cookies onto the response", async () => {
    const fresh = await signToken(3600);
    route = async (url, init) => {
      if (url.pathname === "/auth/v1/token" && init?.method === "POST") return json(sessionBody(fresh, 3600));
      return keysOnly(url, init);
    };
    const expired = await signToken(-60);
    const res = await updateSession(request("/b/x/home", { [AUTH_COOKIE]: authCookie(sessionBody(expired, -60)) }));
    expect(res.authenticated).toBe(true);
    expect(calls).toContain("POST /auth/v1/token");
    const written = res.response.cookies.get(AUTH_COOKIE)?.value ?? "";
    expect(Buffer.from(written.replace(/^base64-/, ""), "base64url").toString()).toContain(fresh);
  });

  it("a refresh that never answers reads as signed out at the deadline: app paths go to /login, `/` to the landing page", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    route = async (url, init) => (url.pathname === "/auth/v1/token" ? new Promise<Response>(() => {}) : keysOnly(url, init));
    const expired = await signToken(-60);
    const cookies = { [AUTH_COOKIE]: authCookie(sessionBody(expired, -60)) };

    const app = proxy(request("/b/x/home", cookies));
    await vi.advanceTimersByTimeAsync(AUTH_DEADLINE_MS);
    const res = await app;
    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toBe("http://localhost:3000/login?next=%2Fb%2Fx%2Fhome");

    const index = proxy(request("/", cookies));
    await vi.advanceTimersByTimeAsync(AUTH_DEADLINE_MS);
    const landing = await index;
    expect(landing.headers.get("location")).toBeNull();
    expect(landing.headers.get("x-middleware-next")).toBe("1");
  });

  it("each Supabase request is cut after its timeout even when nothing else would end it", async () => {
    const { fetchWithTimeout } = await import("../supabase/timeouts");
    route = (_url, init) =>
      new Promise<Response>((_, reject) => {
        init?.signal?.addEventListener("abort", () => reject(init.signal?.reason));
      });
    const started = Date.now();
    await expect(fetchWithTimeout(50)(`${SUPABASE_URL}/auth/v1/token`, { method: "POST" })).rejects.toThrow();
    expect(Date.now() - started).toBeLessThan(2_000);
  });
});

describe("server render session (lib/supabase/server.ts getServerSession)", () => {
  it("reads the user id and email from the verified token, with no Supabase call", async () => {
    const token = await signToken(3600);
    serverCookies = [{ name: AUTH_COOKIE, value: authCookie(sessionBody(token, 3600)) }];
    await getServerSession(); // the signing keys, if this instance has not fetched them yet
    calls.length = 0;
    expect(await getServerSession()).toEqual({ accessToken: token, userId: USER_ID, email: "founder@example.com" });
    expect(calls).toEqual([]);
  });

  it("is null without a session, and null at the deadline when a refresh never answers", async () => {
    expect(await getServerSession()).toBeNull();
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    route = async (url, init) => (url.pathname === "/auth/v1/token" ? new Promise<Response>(() => {}) : keysOnly(url, init));
    serverCookies = [{ name: AUTH_COOKIE, value: authCookie(sessionBody(await signToken(-60), -60)) }];
    const pending = getServerSession();
    await vi.advanceTimersByTimeAsync(AUTH_DEADLINE_MS);
    expect(await pending).toBeNull();
  });
});

describe("withDeadline", () => {
  it("answers with the work when it is in time, with the fallback at the deadline, and passes an early failure on", async () => {
    expect(await withDeadline(Promise.resolve("claims"), 1_000, null)).toBe("claims");
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const late = withDeadline(new Promise<string>(() => {}), AUTH_DEADLINE_MS, null);
    await vi.advanceTimersByTimeAsync(AUTH_DEADLINE_MS - 1);
    let settled = false;
    void late.then(() => (settled = true));
    await Promise.resolve();
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(await late).toBeNull();
    await expect(withDeadline(Promise.reject(new Error("boom")), AUTH_DEADLINE_MS, null)).rejects.toThrow("boom");
    expect(vi.getTimerCount()).toBe(0);
  });
});
