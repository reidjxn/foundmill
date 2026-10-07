/**
 * Service-to-service and session tokens (docs/ARCHITECTURE.md §9, BUILD §9.3).
 *
 * Two JWT kinds share `SESSION_TOKEN_SECRET` (HS256) and are told apart by `aud`:
 *  - a **service token** (`aud: "foundmill-gateway/service"`, claim `svc` naming the calling service) lets
 *    the orchestrator and the api mint session tokens;
 *  - a **session token** (`aud: "foundmill-gateway/session"`) is what an agent session presents on every
 *    tool call: `{ businessId, agentId, sessionId, allowedTools[], kitMode, exp }`.
 * A session token can never mint another token and a service token can never call a tool.
 */
import { randomUUID } from "node:crypto";
import { errors as joseErrors, jwtVerify, SignJWT, type JWTPayload } from "jose";
import { z } from "zod";
import { UnauthorizedError, ValidationError } from "@foundmill/shared";

export const SERVICE_AUDIENCE = "foundmill-gateway/service";
export const SESSION_AUDIENCE = "foundmill-gateway/session";
export const TOKEN_ISSUER = "foundmill-gateway";
export const DEFAULT_SERVICE_TOKEN_TTL_SECONDS = 60;

const Id = z.guid();

/** `connector:tool`, `connector:*` or `*` (the orchestrator derives these from the agent version's tool grants). */
export const ToolRef = z.string().regex(/^(\*|[a-z][a-z0-9_]{1,40}:(\*|[a-zA-Z][a-zA-Z0-9_]{0,120}))$/, "tool refs look like connector:tool or connector:*");
export type ToolRef = z.infer<typeof ToolRef>;

export const SessionClaims = z.object({
  businessId: Id,
  agentId: Id,
  sessionId: Id,
  allowedTools: z.array(ToolRef).max(500).default([]),
  /** The session runs a channel in kit mode (agent prepares, founder submits; BUILD §2.3). */
  kitMode: z.boolean().default(false),
});
export type SessionClaims = z.infer<typeof SessionClaims>;
export type SessionClaimsInput = z.input<typeof SessionClaims>;

export interface SessionToken extends SessionClaims {
  /** Token id. */
  jti: string;
  /** Unix seconds. */
  exp: number;
  iat: number;
}

export const ServiceClaims = z.object({ svc: z.string().min(1).max(60) });
export type ServiceClaims = z.infer<typeof ServiceClaims>;

export interface ServiceToken extends ServiceClaims {
  exp: number;
  iat: number;
}

const key = (secret: string): Uint8Array => {
  if (!secret || secret.length < 16) throw new Error("token secret must be at least 16 characters");
  return new TextEncoder().encode(secret);
};

export const toolRef = (connector: string, tool: string): string => `${connector}:${tool}`;

/** Scope check for a session token: exact `connector:tool`, the connector wildcard, or everything. */
export function toolAllowed(allowedTools: readonly string[], connector: string, tool: string): boolean {
  const exact = toolRef(connector, tool);
  const wildcard = `${connector}:*`;
  return allowedTools.some((ref) => ref === "*" || ref === wildcard || ref === exact);
}

export async function signServiceToken(secret: string, svc: string, ttlSeconds = DEFAULT_SERVICE_TOKEN_TTL_SECONDS): Promise<string> {
  const { svc: name } = ServiceClaims.parse({ svc });
  return new SignJWT({ svc: name })
    .setProtectedHeader({ alg: "HS256", typ: "JWT" })
    .setIssuer(TOKEN_ISSUER)
    .setAudience(SERVICE_AUDIENCE)
    .setIssuedAt()
    .setExpirationTime(`${Math.max(1, Math.floor(ttlSeconds))}s`)
    .setJti(randomUUID())
    .sign(key(secret));
}

export async function verifyServiceToken(secret: string, token: string): Promise<ServiceToken> {
  const payload = await verify(secret, token, SERVICE_AUDIENCE);
  const claims = ServiceClaims.safeParse(payload);
  if (!claims.success) throw new UnauthorizedError("Service token is missing the svc claim");
  return { ...claims.data, exp: payload.exp!, iat: payload.iat! };
}

export interface MintedSessionToken {
  token: string;
  /** ISO. */
  expiresAt: string;
  jti: string;
}

export async function mintSessionToken(secret: string, input: SessionClaimsInput, ttlSeconds: number, now: () => Date = () => new Date()): Promise<MintedSessionToken> {
  const parsed = SessionClaims.safeParse(input);
  if (!parsed.success) throw new ValidationError("Invalid session token claims", parsed.error.issues);
  if (!Number.isFinite(ttlSeconds) || ttlSeconds <= 0) throw new ValidationError("ttlSeconds must be positive", { ttlSeconds });
  const claims = parsed.data;
  const iat = Math.floor(now().getTime() / 1000);
  const exp = iat + Math.floor(ttlSeconds);
  const jti = randomUUID();
  const token = await new SignJWT({ ...claims })
    .setProtectedHeader({ alg: "HS256", typ: "JWT" })
    .setIssuer(TOKEN_ISSUER)
    .setAudience(SESSION_AUDIENCE)
    .setIssuedAt(iat)
    .setExpirationTime(exp)
    .setJti(jti)
    .sign(key(secret));
  return { token, expiresAt: new Date(exp * 1000).toISOString(), jti };
}

export async function verifySessionToken(secret: string, token: string, now: () => Date = () => new Date()): Promise<SessionToken> {
  const payload = await verify(secret, token, SESSION_AUDIENCE, now);
  const claims = SessionClaims.safeParse(payload);
  if (!claims.success) throw new UnauthorizedError("Session token claims are malformed");
  if (typeof payload.jti !== "string") throw new UnauthorizedError("Session token has no id");
  return { ...claims.data, jti: payload.jti, exp: payload.exp!, iat: payload.iat! };
}

async function verify(secret: string, token: string, audience: string, now: () => Date = () => new Date()): Promise<JWTPayload> {
  try {
    const { payload } = await jwtVerify(token, key(secret), {
      algorithms: ["HS256"],
      issuer: TOKEN_ISSUER,
      audience,
      requiredClaims: ["exp", "iat"],
      currentDate: now(),
    });
    return payload;
  } catch (e) {
    if (e instanceof joseErrors.JWTExpired) throw new UnauthorizedError("Token has expired");
    if (e instanceof joseErrors.JWTClaimValidationFailed) throw new UnauthorizedError(`Token rejected: ${e.claim} ${e.reason}`);
    if (e instanceof joseErrors.JOSEError) throw new UnauthorizedError("Token signature or format is invalid");
    throw e;
  }
}

/** Extracts a Bearer token from an Authorization header value. */
export function bearerToken(header: string | undefined | null): string | null {
  if (!header) return null;
  const m = /^Bearer\s+(.+)$/i.exec(header.trim());
  return m?.[1]?.trim() || null;
}
