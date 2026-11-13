/** The idea box's bot check (turnstile.ts): live against a fake siteverify, the mock on a dev stack, refused unconfigured. */
import { describe, expect, it } from "vitest";
import { TURNSTILE_MOCK_FAIL_TOKEN, TURNSTILE_SITEVERIFY_URL, verifyTurnstile } from "../turnstile";

const log = { info: () => undefined, warn: () => undefined, error: () => undefined, debug: () => undefined } as never;

function fakeSiteverify(answer: unknown, status = 200) {
  const calls: { url: string; body: URLSearchParams }[] = [];
  const fetch = (async (url: string, init: RequestInit) => {
    calls.push({ url, body: init.body as URLSearchParams });
    return new Response(JSON.stringify(answer), { status, headers: { "content-type": "application/json" } });
  }) as unknown as typeof globalThis.fetch;
  return { fetch, calls };
}

describe("verifyTurnstile", () => {
  it("live: sends the secret, the token, the address and an idempotency key, and passes a good token", async () => {
    const cf = fakeSiteverify({ success: true, "error-codes": [], hostname: "foundmill.com" });
    const res = await verifyTurnstile({ appEnv: "production", log, turnstile: { secret: "0xSECRET", fetch: cf.fetch } }, { token: "tok", remoteIp: "203.0.113.9", hostname: "foundmill.com" });
    expect(res).toEqual({ ok: true, reason: "ok", simulated: false });
    expect(cf.calls[0]!.url).toBe(TURNSTILE_SITEVERIFY_URL);
    const body = cf.calls[0]!.body;
    expect([body.get("secret"), body.get("response"), body.get("remoteip")]).toEqual(["0xSECRET", "tok", "203.0.113.9"]);
    expect(body.get("idempotency_key")).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("live: a refused, a reused and a foreign-host token fail; Cloudflare down fails closed", async () => {
    const deps = (answer: unknown, status = 200) => ({ appEnv: "production", log, turnstile: { secret: "s", fetch: fakeSiteverify(answer, status).fetch } });
    expect(await verifyTurnstile(deps({ success: false, "error-codes": ["invalid-input-response"] }), { token: "t" })).toMatchObject({ ok: false, reason: "invalid" });
    expect(await verifyTurnstile(deps({ success: false, "error-codes": ["timeout-or-duplicate"] }), { token: "t" })).toMatchObject({ ok: false, reason: "expired" });
    expect(await verifyTurnstile(deps({ success: false, "error-codes": ["invalid-input-secret"] }), { token: "t" })).toMatchObject({ ok: false, reason: "unconfigured" });
    expect(await verifyTurnstile(deps({ success: true, hostname: "evil.example" }), { token: "t", hostname: "foundmill.com" })).toMatchObject({ ok: false, reason: "hostname" });
    expect(await verifyTurnstile(deps({ success: true, hostname: "www.foundmill.com" }), { token: "t", hostname: "foundmill.com" })).toMatchObject({ ok: true });
    expect(await verifyTurnstile(deps({}, 500), { token: "t" })).toMatchObject({ ok: false, reason: "unavailable" });
  });

  it("no secret: the mock on a development or test stack (simulated), refused on staging and production", async () => {
    expect(await verifyTurnstile({ appEnv: "development", log }, { token: "anything" })).toEqual({ ok: true, reason: "ok", simulated: true });
    expect(await verifyTurnstile({ appEnv: "test", log, turnstile: { secret: null } }, { token: TURNSTILE_MOCK_FAIL_TOKEN })).toEqual({ ok: false, reason: "invalid", simulated: true });
    for (const appEnv of ["staging", "production"]) expect(await verifyTurnstile({ appEnv, log, turnstile: { secret: "  " } }, { token: "anything" })).toEqual({ ok: false, reason: "unconfigured", simulated: false });
  });
});
