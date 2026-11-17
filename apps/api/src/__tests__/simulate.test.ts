/**
 * dev.simulate (SEC-2): owner/admin only, minted service token, proxied to INGEST_URL over the private network,
 * audited. apps/ingest is a fetch stub that verifies the token with `jose` exactly as ingest's verifier does
 * (HS256, audience, issuer, five-minute ceiling, businessId).
 */
import { TRPCError } from "@trpc/server";
import { errors as joseErrors, jwtVerify } from "jose";
import { repos } from "@foundmill/db";
import { SIMULATE_TOKEN_AUDIENCE, SIMULATE_TOKEN_ISSUER, SIMULATE_TOKEN_MAX_TTL_SECONDS } from "@foundmill/config";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { ApiDeps, CallerUser } from "../context";
import { createCaller } from "../router";
import { createIngestClient, mintSimulateToken } from "../services/simulate";
import { createApiHarness, TEST_SESSION_TOKEN_SECRET, type ApiHarness } from "./harness";

interface Seen {
  url: string;
  method: string;
  authorization: string | null;
  body: Record<string, unknown>;
}

const seen: Seen[] = [];
let answer: { status: number; body: unknown } = { status: 200, body: { ok: true, written: 1, duplicates: 0, connector: "stripe", label: "Simulated" } };

/** The ingest stand-in: records the request and answers like `POST /simulate/:eventName`. */
const ingestFetch: typeof globalThis.fetch = async (input, init) => {
  const headers = new Headers(init?.headers);
  seen.push({ url: String(input), method: init?.method ?? "GET", authorization: headers.get("authorization"), body: JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown> });
  return new Response(typeof answer.body === "string" ? answer.body : JSON.stringify(answer.body), { status: answer.status, headers: { "content-type": "application/json" } });
};

let hz: ApiHarness;
beforeAll(async () => {
  hz = await createApiHarness({ prefix: "simulate", ingestFetch });
}, 120_000);
afterAll(() => hz.close());

const code = async (p: Promise<unknown>) => {
  try {
    await p;
    return "OK";
  } catch (err) {
    return err instanceof TRPCError ? err.code : `other:${String(err)}`;
  }
};

/** A caller whose api believes it runs in `appEnv` (the harness itself is `test`, where the route does not exist). */
const callerIn = (appEnv: ApiDeps["env"]["APP_ENV"], user: CallerUser, extra: Partial<ApiDeps> = {}) => createCaller({ ...hz.deps, env: { ...hz.deps.env, APP_ENV: appEnv }, ...extra }, user);

const verifyToken = (token: string) => jwtVerify(token, new TextEncoder().encode(TEST_SESSION_TOKEN_SECRET), { algorithms: ["HS256"], audience: SIMULATE_TOKEN_AUDIENCE, issuer: SIMULATE_TOKEN_ISSUER, requiredClaims: ["exp", "iat", "businessId", "userId", "svc"] });

describe("dev.simulate (SEC-2)", () => {
  it("viewer, advisor-level and member callers get FORBIDDEN and nothing reaches ingest", async () => {
    seen.length = 0;
    const input = { businessId: hz.A.businessId, eventName: "payment.received" };
    expect(await code(callerIn("development", { userId: hz.A.viewerId }).dev.simulate(input))).toBe("FORBIDDEN");
    expect(await code(callerIn("development", { userId: hz.A.memberId }).dev.simulate(input))).toBe("FORBIDDEN");
    expect(await code(callerIn("development", { userId: hz.B.ownerId }).dev.simulate(input))).toBe("FORBIDDEN");
    expect(await code(createCaller({ ...hz.deps, env: { ...hz.deps.env, APP_ENV: "development" } }, null).dev.simulate(input))).toBe("UNAUTHORIZED");
    expect(seen).toHaveLength(0);
    expect((await repos.audit.list(hz.db, hz.A.businessId, { action: "dev.simulate" })).items).toHaveLength(0);
  });

  it("the owner's call is proxied to INGEST_URL with a service token bound to the business and user, and audited", async () => {
    seen.length = 0;
    const owner = callerIn("development", { userId: hz.A.ownerId });
    const result = await owner.dev.simulate({ businessId: hz.A.businessId, eventName: "payment.received", connector: "stripe", seed: "panel-1", params: { amountMinor: 12_000 } });
    expect(result).toMatchObject({ ok: true, status: 200, label: "Simulated", body: { written: 1, connector: "stripe" } });

    expect(seen).toHaveLength(1);
    const req = seen[0]!;
    expect(req.url).toBe("http://ingest.test/simulate/payment.received");
    expect(req.method).toBe("POST");
    expect(req.body).toEqual({ businessId: hz.A.businessId, connector: "stripe", seed: "panel-1", params: { amountMinor: 12_000 } });
    expect(req.authorization).toMatch(/^Bearer /);
    const { payload, protectedHeader } = await verifyToken(req.authorization!.slice("Bearer ".length));
    expect(protectedHeader.alg).toBe("HS256");
    expect(payload).toMatchObject({ businessId: hz.A.businessId, userId: hz.A.ownerId, svc: "api", aud: SIMULATE_TOKEN_AUDIENCE, iss: SIMULATE_TOKEN_ISSUER });
    expect(payload.exp! - payload.iat!).toBeLessThanOrEqual(SIMULATE_TOKEN_MAX_TTL_SECONDS);
    expect(payload.exp! - payload.iat!).toBeGreaterThan(0);
    expect(typeof payload.jti).toBe("string");

    const audit = await repos.audit.list(hz.db, hz.A.businessId, { action: "dev.simulate" });
    expect(audit.items).toHaveLength(1);
    expect(audit.items[0]).toMatchObject({ actorKind: "user", actorId: hz.A.ownerId });
    expect(audit.items[0]!.details).toMatchObject({ eventName: "payment.received", connector: "stripe", ok: true, status: 200, written: 1, duplicates: 0 });
    // The token never lands in the audit log.
    expect(JSON.stringify(audit.items[0])).not.toContain(req.authorization!.slice("Bearer ".length));
    expect((await repos.audit.verify(hz.db, hz.A.businessId)).ok).toBe(true);
  });

  it("an admin may simulate too; the token is for the business in the input, never another", async () => {
    seen.length = 0;
    await callerIn("development", { userId: hz.A.adminId }).dev.simulate({ businessId: hz.A.businessId, eventName: "signup.created" });
    expect(seen).toHaveLength(1);
    expect(seen[0]!.url).toBe("http://ingest.test/simulate/signup.created");
    const { payload } = await verifyToken(seen[0]!.authorization!.slice("Bearer ".length));
    expect(payload.businessId).toBe(hz.A.businessId);
    expect(payload.userId).toBe(hz.A.adminId);
  });

  it("ingest's refusal is shown verbatim (not thrown) and still audited", async () => {
    seen.length = 0;
    answer = { status: 400, body: { ok: false, error: "unknown_simulation", message: "stripe mock cannot simulate bank.sync" } };
    try {
      const r = await callerIn("development", { userId: hz.A.ownerId }).dev.simulate({ businessId: hz.A.businessId, eventName: "bank.sync", connector: "stripe" });
      expect(r).toMatchObject({ ok: false, status: 400, body: { error: "unknown_simulation" } });
    } finally {
      answer = { status: 200, body: { ok: true, written: 1, duplicates: 0, connector: "stripe", label: "Simulated" } };
    }
    const audit = await repos.audit.list(hz.db, hz.A.businessId, { action: "dev.simulate" });
    expect(audit.items[0]!.details).toMatchObject({ eventName: "bank.sync", ok: false, status: 400 });
  });

  it("does not exist in test or production (NOT_FOUND before any token is minted)", async () => {
    seen.length = 0;
    const input = { businessId: hz.A.businessId, eventName: "payment.received" };
    expect(await code(hz.caller({ userId: hz.A.ownerId }).dev.simulate(input))).toBe("NOT_FOUND");
    expect(await code(callerIn("production", { userId: hz.A.ownerId }).dev.simulate(input))).toBe("NOT_FOUND");
    // Production runs APP_ENV=staging: an owner there can never fire a mock event into a real project.
    expect(await code(callerIn("staging", { userId: hz.A.ownerId }).dev.simulate(input))).toBe("NOT_FOUND");
    expect(seen).toHaveLength(0);
  });

  it("validates the simulation name so nothing but a catalogue key reaches the URL", async () => {
    seen.length = 0;
    const owner = callerIn("development", { userId: hz.A.ownerId });
    for (const eventName of ["../webhooks/stripe", "payment received", "Payment.Received", "", "a".repeat(61)]) {
      expect(await code(owner.dev.simulate({ businessId: hz.A.businessId, eventName })), eventName).toBe("BAD_REQUEST");
    }
    expect(seen).toHaveLength(0);
  });

  it("refuses to run without SESSION_TOKEN_SECRET (412) and reports an unreachable ingest as 503", async () => {
    seen.length = 0;
    const noSecret = callerIn("development", { userId: hz.A.ownerId }, { ingest: createIngestClient({ url: "http://ingest.test", secret: null, fetch: ingestFetch }) });
    expect(await code(noSecret.dev.simulate({ businessId: hz.A.businessId, eventName: "payment.received" }))).toBe("PRECONDITION_FAILED");
    const down = callerIn("development", { userId: hz.A.ownerId }, {
      ingest: createIngestClient({
        url: "http://127.0.0.1:1",
        secret: TEST_SESSION_TOKEN_SECRET,
        fetch: async () => {
          throw new Error("ECONNREFUSED");
        },
      }),
    });
    expect(await code(down.dev.simulate({ businessId: hz.A.businessId, eventName: "payment.received" }))).toBe("SERVICE_UNAVAILABLE");
    expect(seen).toHaveLength(0);
  });

  it("mintSimulateToken caps the lifetime at five minutes and the verifier agrees on expiry", async () => {
    await expect(mintSimulateToken(TEST_SESSION_TOKEN_SECRET, { businessId: hz.A.businessId, userId: hz.A.ownerId, ttlSeconds: SIMULATE_TOKEN_MAX_TTL_SECONDS + 1 })).rejects.toMatchObject({ code: "validation" });
    await expect(mintSimulateToken("short", { businessId: hz.A.businessId, userId: hz.A.ownerId })).rejects.toMatchObject({ code: "config" });
    const past = await mintSimulateToken(TEST_SESSION_TOKEN_SECRET, { businessId: hz.A.businessId, userId: hz.A.ownerId, ttlSeconds: 60 }, () => new Date(Date.now() - 120_000));
    await expect(verifyToken(past)).rejects.toBeInstanceOf(joseErrors.JWTExpired);
    const other = await mintSimulateToken(TEST_SESSION_TOKEN_SECRET, { businessId: hz.A.businessId, userId: hz.A.ownerId });
    await expect(jwtVerify(other, new TextEncoder().encode(TEST_SESSION_TOKEN_SECRET), { audience: "foundmill-gateway/service" })).rejects.toBeInstanceOf(joseErrors.JWTClaimValidationFailed);
  });
});
