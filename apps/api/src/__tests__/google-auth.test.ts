/**
 * "Continue with Google" on the web sign-in page: a Supabase session proven by Google counts as a confirmed address for
 * SIGNUP_ALLOWLIST, like a magic link (auth.ts `googleVerifiedFromPayload`). The proof is what Supabase Auth alone
 * writes on the token: an `oauth` entry in `amr` and `google` among `app_metadata.providers`, with the address marked
 * verified. An unverified Google address, an anonymous session, another social provider and an `oauth` sign-in
 * without Google are refused on the same path as any unconfirmed address (403, `not_invited`, `email_unconfirmed`). The
 * account is the token's `sub`, as for every other sign-in: nothing here links accounts by email.
 */
import { SignJWT } from "jose";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../app";
import { createAuthVerifier, emailConfirmedFromPayload, googleVerifiedFromPayload } from "../auth";
import { EMAIL_UNCONFIRMED_MESSAGE, NOT_INVITED_MESSAGE } from "../services/access";
import { createApiHarness, type ApiHarness } from "./harness";

let hz: ApiHarness;
beforeAll(async () => {
  hz = await createApiHarness({ prefix: "google-auth" });
}, 120_000);
afterAll(() => hz.close());

const now = () => Math.floor(Date.now() / 1000);

/** What Supabase puts on an access token after a Google sign-in (a first-time Google account). */
function googleClaims(email: string, overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    email,
    role: "authenticated",
    is_anonymous: false,
    amr: [{ method: "oauth", timestamp: now() }],
    app_metadata: { provider: "google", providers: ["google"] },
    user_metadata: { email, email_verified: true, full_name: "Maya Okafor", iss: "https://accounts.google.com", provider_id: "1234567890", sub: "1234567890" },
    ...overrides,
  };
}

describe("googleVerifiedFromPayload / emailConfirmedFromPayload", () => {
  it("accepts a verified Google sign-in, first-time or linked to an earlier email account", () => {
    expect(googleVerifiedFromPayload(googleClaims("a@x.test"))).toBe(true);
    expect(emailConfirmedFromPayload(googleClaims("a@x.test"))).toBe(true);
    // An account that signed in by magic link first and was linked to Google by its verified address.
    expect(emailConfirmedFromPayload(googleClaims("a@x.test", { app_metadata: { provider: "email", providers: ["email", "google"] } }))).toBe(true);
    // Older tokens name the provider only.
    expect(emailConfirmedFromPayload(googleClaims("a@x.test", { app_metadata: { provider: "google" } }))).toBe(true);
  });

  it("refuses an unverified address, an anonymous session, another provider and oauth without Google", () => {
    const refused: Array<[string, Record<string, unknown>]> = [
      ["unverified", googleClaims("a@x.test", { user_metadata: { email_verified: false } })],
      ["no verified flag", googleClaims("a@x.test", { user_metadata: {} })],
      ["verified as a string", googleClaims("a@x.test", { user_metadata: { email_verified: "true" } })],
      ["anonymous", googleClaims("a@x.test", { is_anonymous: true })],
      ["another provider", googleClaims("a@x.test", { app_metadata: { provider: "github", providers: ["github"] } })],
      // Supabase does not say in amr which provider an oauth sign-in used: another social identity on the account makes it ambiguous.
      ["google beside another provider", googleClaims("a@x.test", { app_metadata: { provider: "github", providers: ["github", "google"] } })],
      ["oauth without google", googleClaims("a@x.test", { app_metadata: { provider: "email", providers: ["email"] } })],
      ["oauth with no app_metadata", googleClaims("a@x.test", { app_metadata: undefined })],
      ["google without an oauth sign-in", googleClaims("a@x.test", { amr: [{ method: "password", timestamp: now() }] })],
      ["no amr", googleClaims("a@x.test", { amr: undefined })],
      ["no email", googleClaims("", {})],
    ];
    for (const [name, claims] of refused) expect(emailConfirmedFromPayload(claims), name).toBe(false);
    // A user can write their own user_metadata: email_verified alone never proves anything.
    expect(emailConfirmedFromPayload({ email: "a@x.test", amr: [{ method: "password", timestamp: now() }], app_metadata: { provider: "email", providers: ["email"] }, user_metadata: { email_verified: true } })).toBe(false);
  });

  it("an oauth sign-in counts as a fresh authentication (the step-up window for permanent actions reads amr)", async () => {
    const secret = new TextEncoder().encode("google-auth-test-jwt-secret-0123456789ab");
    const auth = createAuthVerifier({ appEnv: "production", hsKey: secret });
    const userId = await hz.h.createUser("timestamp@google-auth.test");
    const signedAt = now() - 30;
    const token = await new SignJWT(googleClaims("timestamp@google-auth.test", { amr: [{ method: "oauth", timestamp: signedAt }] })).setProtectedHeader({ alg: "HS256" }).setSubject(userId).setAudience("authenticated").setIssuedAt().setExpirationTime("10m").sign(secret);
    expect(await auth.verify(token)).toEqual({ userId, email: "timestamp@google-auth.test", authenticatedAt: new Date(signedAt * 1000), emailConfirmed: true, expiresAt: expect.any(Number) });
  });
});

describe("over HTTP with SIGNUP_ALLOWLIST: a Google sign-in meets the same gate as the email link", () => {
  const secret = new TextEncoder().encode("google-auth-test-jwt-secret-0123456789ab");
  const sign = (claims: Record<string, unknown>, sub: string) => new SignJWT(claims).setProtectedHeader({ alg: "HS256" }).setSubject(sub).setAudience("authenticated").setIssuedAt().setExpirationTime("10m").sign(secret);
  const app = () => createApp({ ...hz.deps, auth: createAuthVerifier({ appEnv: "production", hsKey: secret }), env: { ...hz.deps.env, SIGNUP_ALLOWLIST: "listed@google-auth.test, @google-team.test" } });
  const call = async (token: string) => {
    const res = await app().request("/trpc/founder.profile.get", { headers: { authorization: `Bearer ${token}` } });
    const body = (await res.json()) as { error?: { json: { message: string; data: { appCode?: string; details?: { reason?: string } } } } };
    return { status: res.status, message: body.error?.json.message, appCode: body.error?.json.data.appCode, reason: body.error?.json.data.details?.reason };
  };

  it("a first-time Google account on the list gets in; one not on the list meets not_invited, exactly like the email link", async () => {
    const listed = await hz.h.createUser("listed@google-auth.test");
    expect((await call(await sign(googleClaims("listed@google-auth.test"), listed))).status).toBe(200);
    const teammate = await hz.h.createUser("someone@google-team.test");
    expect((await call(await sign(googleClaims("someone@google-team.test"), teammate))).status).toBe(200);
    const stranger = await hz.h.createUser("stranger@gmail-google-auth.test");
    expect(await call(await sign(googleClaims("stranger@gmail-google-auth.test"), stranger))).toEqual({ status: 403, message: NOT_INVITED_MESSAGE, appCode: "not_invited", reason: "not_listed" });
    // The same stranger by email link: the same answer.
    expect(await call(await sign({ email: "stranger@gmail-google-auth.test", amr: [{ method: "magiclink", timestamp: now() }] }, stranger))).toEqual({ status: 403, message: NOT_INVITED_MESSAGE, appCode: "not_invited", reason: "not_listed" });
  });

  it("a listed address is refused when Google did not verify it, when the session is anonymous, from another provider, or oauth without Google", async () => {
    const userId = await hz.h.createUser("listed2@google-team.test");
    const email = "listed2@google-team.test";
    const unconfirmed = { status: 403, message: EMAIL_UNCONFIRMED_MESSAGE, appCode: "not_invited", reason: "email_unconfirmed" };
    expect(await call(await sign(googleClaims(email, { user_metadata: { email_verified: false } }), userId))).toEqual(unconfirmed);
    expect(await call(await sign(googleClaims(email, { is_anonymous: true }), userId))).toEqual(unconfirmed);
    expect(await call(await sign(googleClaims(email, { app_metadata: { provider: "github", providers: ["github"] } }), userId))).toEqual(unconfirmed);
    expect(await call(await sign(googleClaims(email, { app_metadata: { provider: "email", providers: ["email"] } }), userId))).toEqual(unconfirmed);
    expect((await call(await sign(googleClaims(email), userId))).status).toBe(200);
  });

  it("the account is the token's subject: a Google token for a listed address names only the account it was issued to", async () => {
    // Two accounts can never share an address in Supabase (it links a verified Google identity to the existing account
    // instead); the api never looks an account up by email, so the token's sub is the only account it acts as.
    const owner = await hz.h.createUser("subject@google-team.test");
    const res = await app().request("/trpc/founder.profile.get", { headers: { authorization: `Bearer ${await sign(googleClaims("subject@google-team.test"), owner)}` } });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { result: { data: { json: { userId: string; email: string; complete: boolean } } } };
    expect(body.result.data.json).toMatchObject({ userId: owner, email: "subject@google-team.test", complete: false });
  });
});
