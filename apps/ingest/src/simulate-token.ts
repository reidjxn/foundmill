/**
 * Simulate service token (docs/SECURITY_REVIEW.md SEC-2). apps/api mints an HS256 JWT with `SESSION_TOKEN_SECRET`
 * for the signed-in owner/admin (`aud foundmill-ingest/simulate`, `iss foundmill-api`, `businessId`, `exp` at most
 * five minutes after `iat`); ingest verifies it before `runSimulation` and the body's `businessId` must match the
 * token's. Without a valid token the request is refused with 401 before the body is read, so there are no side
 * effects.
 *
 * `jose` is not resolvable from this app (docs/NEEDED_DEPS.md), so the verification is written over node:crypto:
 * the algorithm is pinned to HS256, the signature is compared in constant time and every claim the gateway's
 * `jose` verifier would require (`exp`, `iat`, `aud`, `iss`) is required here too. The token format is the standard
 * one, so the api's `jose`-minted token and the `signSimulateToken` below (tests, scripts) are interchangeable.
 */
import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { SIMULATE_TOKEN_AUDIENCE, SIMULATE_TOKEN_DEFAULT_TTL_SECONDS, SIMULATE_TOKEN_ISSUER, SIMULATE_TOKEN_MAX_TTL_SECONDS } from "@foundmill/config";
import { UnauthorizedError, isUuid } from "@foundmill/shared";

export { SIMULATE_TOKEN_AUDIENCE, SIMULATE_TOKEN_ISSUER, SIMULATE_TOKEN_MAX_TTL_SECONDS };

/** Seconds of clock skew tolerated on `iat` (a token "from the future" by more than this is refused). */
export const SIMULATE_TOKEN_CLOCK_SKEW_SECONDS = 30;
const MIN_SECRET_LENGTH = 16;

export interface SimulateTokenClaims {
  businessId: string;
  /** Calling service (`api`). */
  svc: string;
  /** Who asked for the simulation (the signed-in user), when the minting service says. */
  userId: string | null;
  jti: string | null;
  /** Unix seconds. */
  exp: number;
  iat: number;
}

export interface SignSimulateTokenInput {
  businessId: string;
  svc?: string;
  userId?: string | null;
  ttlSeconds?: number;
  /** Overrides for negative tests only. */
  audience?: string;
  issuer?: string;
}

const b64url = (input: Buffer | string): string => Buffer.from(input).toString("base64url");

const secretKey = (secret: string | null | undefined): Buffer => {
  if (!secret || secret.length < MIN_SECRET_LENGTH) throw new UnauthorizedError("Simulate token secret is not configured");
  return Buffer.from(secret, "utf8");
};

/** HS256 JWT in the exact shape apps/api mints with `jose` (tests and scripts; the api itself uses `jose`). */
export function signSimulateToken(secret: string, input: SignSimulateTokenInput, now: () => Date = () => new Date()): string {
  const key = secretKey(secret);
  const ttl = Math.max(1, Math.floor(input.ttlSeconds ?? SIMULATE_TOKEN_DEFAULT_TTL_SECONDS));
  const iat = Math.floor(now().getTime() / 1000);
  const header = b64url(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const payload = b64url(
    JSON.stringify({
      businessId: input.businessId,
      svc: input.svc ?? "api",
      ...(input.userId ? { userId: input.userId } : {}),
      iss: input.issuer ?? SIMULATE_TOKEN_ISSUER,
      aud: input.audience ?? SIMULATE_TOKEN_AUDIENCE,
      iat,
      exp: iat + ttl,
      jti: randomUUID(),
    }),
  );
  const signature = createHmac("sha256", key).update(`${header}.${payload}`).digest("base64url");
  return `${header}.${payload}.${signature}`;
}

const JWT_SEGMENT = /^[A-Za-z0-9_-]+$/;

function decodeSegment(segment: string, what: string): Record<string, unknown> {
  if (!JWT_SEGMENT.test(segment)) throw new UnauthorizedError(`Simulate token ${what} is malformed`);
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(segment, "base64url").toString("utf8"));
  } catch {
    throw new UnauthorizedError(`Simulate token ${what} is malformed`);
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new UnauthorizedError(`Simulate token ${what} is malformed`);
  return parsed as Record<string, unknown>;
}

const hasAudience = (aud: unknown, expected: string): boolean => (typeof aud === "string" ? aud === expected : Array.isArray(aud) && aud.length === 1 && aud[0] === expected);

/**
 * Verifies signature, algorithm, audience, issuer, lifetime and the `businessId` claim. Throws `UnauthorizedError`
 * (401) for anything short of a token apps/api minted within the last five minutes.
 */
export function verifySimulateToken(secret: string | null | undefined, token: string, now: () => Date = () => new Date()): SimulateTokenClaims {
  const key = secretKey(secret);
  const parts = token.split(".");
  if (parts.length !== 3) throw new UnauthorizedError("Simulate token signature or format is invalid");
  const [h, p, s] = parts as [string, string, string];
  if (!JWT_SEGMENT.test(s)) throw new UnauthorizedError("Simulate token signature or format is invalid");

  const header = decodeSegment(h, "header");
  if (header.alg !== "HS256") throw new UnauthorizedError("Simulate token algorithm is not allowed");
  if (header.typ !== undefined && header.typ !== "JWT") throw new UnauthorizedError("Simulate token type is not allowed");
  if (header.crit !== undefined) throw new UnauthorizedError("Simulate token uses unsupported critical extensions");

  const expected = createHmac("sha256", key).update(`${h}.${p}`).digest();
  const given = Buffer.from(s, "base64url");
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) throw new UnauthorizedError("Simulate token signature or format is invalid");

  const payload = decodeSegment(p, "payload");
  if (!hasAudience(payload.aud, SIMULATE_TOKEN_AUDIENCE)) throw new UnauthorizedError("Simulate token rejected: aud unexpected");
  if (payload.iss !== SIMULATE_TOKEN_ISSUER) throw new UnauthorizedError("Simulate token rejected: iss unexpected");
  const { exp, iat } = payload;
  if (typeof exp !== "number" || !Number.isFinite(exp)) throw new UnauthorizedError("Simulate token rejected: exp missing");
  if (typeof iat !== "number" || !Number.isFinite(iat)) throw new UnauthorizedError("Simulate token rejected: iat missing");
  const nowSec = Math.floor(now().getTime() / 1000);
  if (iat > nowSec + SIMULATE_TOKEN_CLOCK_SKEW_SECONDS) throw new UnauthorizedError("Simulate token rejected: iat in the future");
  if (exp <= nowSec) throw new UnauthorizedError("Simulate token has expired");
  if (exp - iat > SIMULATE_TOKEN_MAX_TTL_SECONDS || exp > nowSec + SIMULATE_TOKEN_MAX_TTL_SECONDS + SIMULATE_TOKEN_CLOCK_SKEW_SECONDS) {
    throw new UnauthorizedError("Simulate token rejected: lifetime exceeds five minutes");
  }
  if (typeof payload.businessId !== "string" || !isUuid(payload.businessId)) throw new UnauthorizedError("Simulate token rejected: businessId missing");
  const svc = typeof payload.svc === "string" && payload.svc.length > 0 && payload.svc.length <= 60 ? payload.svc : null;
  if (!svc) throw new UnauthorizedError("Simulate token rejected: svc missing");

  return {
    businessId: payload.businessId,
    svc,
    userId: typeof payload.userId === "string" && isUuid(payload.userId) ? payload.userId : null,
    jti: typeof payload.jti === "string" ? payload.jti : null,
    exp,
    iat,
  };
}

/** Extracts a Bearer token from an Authorization header value. */
export function bearerToken(header: string | undefined | null): string | null {
  if (!header) return null;
  const m = /^Bearer\s+(.+)$/i.exec(header.trim());
  return m?.[1]?.trim() || null;
}
