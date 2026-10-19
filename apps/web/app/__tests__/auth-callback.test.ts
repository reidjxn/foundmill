// @vitest-environment node
import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { classifyCallbackParams, classifyExchangeError, parseSignInError, signInErrorCopy } from "@/lib/auth/sign-in-errors";

type ExchangeResult = { error: { name?: string; code?: string; message: string } | null };
const exchangeCodeForSession = vi.fn<(code: string) => Promise<ExchangeResult>>();
const verifyOtp = vi.fn<(params: { type: string; token_hash: string }) => Promise<ExchangeResult>>();
let configured = true;

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(async () => (configured ? { auth: { exchangeCodeForSession, verifyOtp } } : null)),
}));

const { GET } = await import("../auth/callback/route");

async function callback(query: string, cookie?: string) {
  const res = await GET(new NextRequest(`https://foundmill.com/auth/callback${query}`, { headers: cookie ? { cookie } : {} }));
  return { status: res.status, location: res.headers.get("location") };
}

/** What @supabase/ssr returns on a host that never asked for the link (auth-js AuthPKCECodeVerifierMissingError). */
const verifierMissing = { name: "AuthPKCECodeVerifierMissingError", code: "pkce_code_verifier_not_found", message: "PKCE code verifier not found in storage. This can happen if the auth flow was initiated in a different browser or device, or if the storage was cleared." };

beforeEach(() => {
  configured = true;
  exchangeCodeForSession.mockReset();
  verifyOtp.mockReset();
});

describe("/auth/callback", () => {
  it("signs in and goes to next", async () => {
    exchangeCodeForSession.mockResolvedValue({ error: null });
    expect(await callback("?code=abc&next=%2Fb%2Fx%2Finbox")).toEqual({ status: 307, location: "https://foundmill.com/b/x/inbox" });
    expect(exchangeCodeForSession).toHaveBeenCalledWith("abc");
  });

  it("without a next, goes straight to the last business's Home when the browser remembers one (as `/` would, one hop sooner)", async () => {
    exchangeCodeForSession.mockResolvedValue({ error: null });
    const last = "b1e5e5e5-0000-4000-8000-000000000001";
    expect(await callback("?code=abc", `fm_last_business=${last}`)).toEqual({ status: 307, location: `https://foundmill.com/b/${last}/home` });
    // An explicit next still wins; no usable cookie leaves `/` to pick.
    expect((await callback("?code=abc&next=%2Fb%2Fx%2Finbox", `fm_last_business=${last}`)).location).toBe("https://foundmill.com/b/x/inbox");
    expect((await callback("?code=abc", "fm_last_business=nope")).location).toBe("https://foundmill.com/");
    expect((await callback("?code=abc")).location).toBe("https://foundmill.com/");
    // A failed exchange never uses it.
    exchangeCodeForSession.mockResolvedValue({ error: verifierMissing });
    expect((await callback("?code=abc", `fm_last_business=${last}`)).location).toBe("https://foundmill.com/login?error=other_address");
  });

  it("a link asked for on another address (no code verifier here) lands on the login form with that reason and the same next", async () => {
    exchangeCodeForSession.mockResolvedValue({ error: verifierMissing });
    expect(await callback("?code=x&next=%2Fb%2Fx%2Finbox")).toEqual({ status: 307, location: "https://foundmill.com/login?error=other_address&next=%2Fb%2Fx%2Finbox" });
    expect(await callback("?code=x")).toEqual({ status: 307, location: "https://foundmill.com/login?error=other_address" });
  });

  it("an expired or used link says so; anything else is a generic failure with no raw message in the address", async () => {
    exchangeCodeForSession.mockResolvedValue({ error: { name: "AuthApiError", code: "flow_state_not_found", message: "invalid flow state, no valid flow state found" } });
    expect((await callback("?code=x")).location).toBe("https://foundmill.com/login?error=expired");
    exchangeCodeForSession.mockResolvedValue({ error: { name: "AuthApiError", code: "unexpected_failure", message: "Database error <secret-ish detail>" } });
    expect((await callback("?code=x")).location).toBe("https://foundmill.com/login?error=failed");
  });

  it("a hand-made link (token_hash + type, no PKCE code) is verified server-side and signs in", async () => {
    verifyOtp.mockResolvedValue({ error: null });
    expect(await callback("?token_hash=h1&type=magiclink&next=%2Fb%2Fx%2Finbox")).toEqual({ status: 307, location: "https://foundmill.com/b/x/inbox" });
    expect(verifyOtp).toHaveBeenCalledWith({ type: "magiclink", token_hash: "h1" });
    expect(await callback("?token_hash=h2&type=invite")).toEqual({ status: 307, location: "https://foundmill.com/" });
    expect(verifyOtp).toHaveBeenLastCalledWith({ type: "invite", token_hash: "h2" });
    expect(exchangeCodeForSession).not.toHaveBeenCalled();
  });

  it("a used or expired hand-made link says so; an unknown type or a hash alone is an incomplete link", async () => {
    verifyOtp.mockResolvedValue({ error: { name: "AuthApiError", code: "otp_expired", message: "Email link is invalid or has expired" } });
    expect((await callback("?token_hash=h&type=magiclink")).location).toBe("https://foundmill.com/login?error=expired");
    expect((await callback("?token_hash=h&type=recovery")).location).toBe("https://foundmill.com/login?error=missing_code");
    expect((await callback("?token_hash=h")).location).toBe("https://foundmill.com/login?error=missing_code");
    expect((await callback("?type=magiclink")).location).toBe("https://foundmill.com/login?error=missing_code");
    expect(verifyOtp).toHaveBeenCalledTimes(1);
  });

  it("no code: Supabase's own refusal (otp_expired) or a bare visit", async () => {
    expect((await callback("?error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid+or+has+expired")).location).toBe("https://foundmill.com/login?error=expired");
    expect((await callback("")).location).toBe("https://foundmill.com/login?error=missing_code");
    expect(exchangeCodeForSession).not.toHaveBeenCalled();
  });

  it("keeps next clamped to an in-app path", async () => {
    exchangeCodeForSession.mockResolvedValue({ error: null });
    expect((await callback("?code=x&next=https%3A%2F%2Fevil.example")).location).toBe("https://foundmill.com/");
    exchangeCodeForSession.mockResolvedValue({ error: verifierMissing });
    expect((await callback("?code=x&next=%2F%2Fevil.example")).location).toBe("https://foundmill.com/login?error=other_address");
  });

  it("never leaves foundmill.com after signing in, even for a next that a URL parser reads as another host", async () => {
    exchangeCodeForSession.mockResolvedValue({ error: null });
    // "/\evil.example" and "/<tab>/evil.example" resolve to https://evil.example/ with `new URL(next, request.url)`.
    for (const next of ["%2F%5Cevil.example", "%2F%5C%2Fevil.example", "%2F%09%2Fevil.example", "%2F%0A%2Fevil.example"]) {
      expect((await callback(`?code=x&next=${next}`)).location, next).toBe("https://foundmill.com/");
    }
    exchangeCodeForSession.mockResolvedValue({ error: verifierMissing });
    expect((await callback("?code=x&next=%2F%5Cevil.example")).location).toBe("https://foundmill.com/login?error=other_address");
  });

  it("without Supabase configured says so", async () => {
    configured = false;
    expect((await callback("?code=x")).location).toBe("https://foundmill.com/login?error=not_configured");
  });
});

describe("sign-in error reasons", () => {
  it("classifies exchange errors by code, then name, then the verifier message", () => {
    expect(classifyExchangeError(verifierMissing)).toBe("other_address");
    expect(classifyExchangeError({ name: "AuthPKCECodeVerifierMissingError" })).toBe("other_address");
    expect(classifyExchangeError({ message: "PKCE code verifier not found in storage." })).toBe("other_address");
    for (const code of ["otp_expired", "flow_state_expired", "flow_state_not_found", "bad_code_verifier"]) expect(classifyExchangeError({ code }), code).toBe("expired");
    expect(classifyExchangeError({ code: "over_request_rate_limit", message: "x" })).toBe("failed");
  });

  it("classifies a callback with no code", () => {
    expect(classifyCallbackParams(new URLSearchParams("error_code=otp_expired"))).toBe("expired");
    expect(classifyCallbackParams(new URLSearchParams("error=server_error&error_code=unexpected_failure"))).toBe("failed");
    expect(classifyCallbackParams(new URLSearchParams(""))).toBe("missing_code");
  });

  it("parses the login page's error parameter; an old build's raw message reads as a generic failure", () => {
    expect(parseSignInError(null)).toBeNull();
    expect(parseSignInError("")).toBeNull();
    expect(parseSignInError("other_address")).toBe("other_address");
    expect(parseSignInError("invalid request: both auth code and code verifier should be non-empty")).toBe("failed");
  });

  it("tells the founder what happened and to send a new link", () => {
    const copy = signInErrorCopy("other_address");
    expect(copy.title).toMatch(/different address/);
    expect(copy.body).toMatch(/Send a new link/);
    for (const reason of ["expired", "missing_code", "failed"] as const) expect(signInErrorCopy(reason).body, reason).toMatch(/Send a new link/);
  });
});
