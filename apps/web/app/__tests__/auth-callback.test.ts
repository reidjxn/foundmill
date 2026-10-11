// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import { classifyCallbackParams, classifyExchangeError, parseSignInError, signInErrorCopy } from "@/lib/auth/sign-in-errors";

type ExchangeResult = { error: { name?: string; code?: string; message: string } | null };
const exchangeCodeForSession = vi.fn<(code: string) => Promise<ExchangeResult>>();
let configured = true;

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(async () => (configured ? { auth: { exchangeCodeForSession } } : null)),
}));

const { GET } = await import("../auth/callback/route");

async function callback(query: string) {
  const res = await GET(new Request(`https://foundmill.com/auth/callback${query}`));
  return { status: res.status, location: res.headers.get("location") };
}

/** What @supabase/ssr returns on a host that never asked for the link (auth-js AuthPKCECodeVerifierMissingError). */
const verifierMissing = { name: "AuthPKCECodeVerifierMissingError", code: "pkce_code_verifier_not_found", message: "PKCE code verifier not found in storage. This can happen if the auth flow was initiated in a different browser or device, or if the storage was cleared." };

beforeEach(() => {
  configured = true;
  exchangeCodeForSession.mockReset();
});

describe("/auth/callback", () => {
  it("signs in and goes to next", async () => {
    exchangeCodeForSession.mockResolvedValue({ error: null });
    expect(await callback("?code=abc&next=%2Fb%2Fx%2Finbox")).toEqual({ status: 307, location: "https://foundmill.com/b/x/inbox" });
    expect(exchangeCodeForSession).toHaveBeenCalledWith("abc");
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
