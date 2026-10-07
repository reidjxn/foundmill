/**
 * Simulate proxy (docs/SECURITY_REVIEW.md SEC-2; BUILD §13.3). The Settings → Integrations → Simulate panel no
 * longer talks to apps/ingest from the browser: `dev.simulate` (owner/admin only) mints a short-lived HS256 service
 * JWT with `SESSION_TOKEN_SECRET` (`aud foundmill-ingest/simulate`, `iss foundmill-api`, `businessId`, `userId`,
 * `exp` ≤ five minutes) and POSTs to `INGEST_URL/simulate/:eventName` over the private network. Ingest verifies
 * the token and binds it to the body's `businessId`, so a public client can never reach the route.
 */
import { randomUUID } from "node:crypto";
import { SignJWT } from "jose";
import { SIMULATE_TOKEN_AUDIENCE, SIMULATE_TOKEN_DEFAULT_TTL_SECONDS, SIMULATE_TOKEN_ISSUER, SIMULATE_TOKEN_MAX_TTL_SECONDS } from "@foundmill/config";
import { AppError, ValidationError, isUuid } from "@foundmill/shared";

export { SIMULATE_TOKEN_AUDIENCE, SIMULATE_TOKEN_ISSUER };

export const SIMULATE_SERVICE_NAME = "api";
const MIN_SECRET_LENGTH = 16;

export interface MintSimulateTokenInput {
  businessId: string;
  /** The signed-in owner/admin who asked (audited on both sides). */
  userId: string;
  ttlSeconds?: number;
}

/** HS256 JWT exactly as apps/ingest `verifySimulateToken` expects; never longer-lived than five minutes. */
export async function mintSimulateToken(secret: string | null | undefined, input: MintSimulateTokenInput, now: () => Date = () => new Date()): Promise<string> {
  if (!secret || secret.length < MIN_SECRET_LENGTH) throw new AppError("config", "SESSION_TOKEN_SECRET is not set; the Simulate panel cannot reach ingest", 412);
  if (!isUuid(input.businessId)) throw new ValidationError("businessId must be a UUID");
  if (!isUuid(input.userId)) throw new ValidationError("userId must be a UUID");
  const ttl = Math.floor(input.ttlSeconds ?? SIMULATE_TOKEN_DEFAULT_TTL_SECONDS);
  if (!Number.isFinite(ttl) || ttl <= 0 || ttl > SIMULATE_TOKEN_MAX_TTL_SECONDS) throw new ValidationError(`ttlSeconds must be between 1 and ${SIMULATE_TOKEN_MAX_TTL_SECONDS}`);
  const iat = Math.floor(now().getTime() / 1000);
  return new SignJWT({ businessId: input.businessId, userId: input.userId, svc: SIMULATE_SERVICE_NAME })
    .setProtectedHeader({ alg: "HS256", typ: "JWT" })
    .setIssuer(SIMULATE_TOKEN_ISSUER)
    .setAudience(SIMULATE_TOKEN_AUDIENCE)
    .setIssuedAt(iat)
    .setExpirationTime(iat + ttl)
    .setJti(randomUUID())
    .sign(new TextEncoder().encode(secret));
}

export interface SimulateRequest {
  businessId: string;
  userId: string;
  eventName: string;
  connector?: string;
  seed?: string;
  params?: Record<string, unknown>;
}

/** What the panel shows verbatim: ingest's status and JSON (or text) body. */
export interface SimulateResponse {
  ok: boolean;
  status: number;
  body: unknown;
}

export interface IngestClient {
  readonly baseUrl: string;
  /** Mint the token for `businessId` and proxy the simulation; throws `ingest_unreachable` (503) when ingest does not answer. */
  simulate(input: SimulateRequest): Promise<SimulateResponse>;
}

export interface CreateIngestClientOptions {
  url: string;
  /** `SESSION_TOKEN_SECRET`; null makes every simulation fail with 412 `config`. */
  secret: string | null;
  fetch?: typeof globalThis.fetch;
  timeoutMs?: number;
  now?: () => Date;
}

/** Only this shape of path can be built: the event name is validated upstream and URL-encoded here. */
export const simulatePath = (eventName: string): string => `/simulate/${encodeURIComponent(eventName)}`;

export function createIngestClient(opts: CreateIngestClientOptions): IngestClient {
  const baseUrl = opts.url.replace(/\/+$/, "");
  const fetchImpl = opts.fetch ?? globalThis.fetch;
  const timeoutMs = opts.timeoutMs ?? 15_000;
  const now = opts.now ?? (() => new Date());
  return {
    baseUrl,
    async simulate(input) {
      const token = await mintSimulateToken(opts.secret, { businessId: input.businessId, userId: input.userId }, now);
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      let res: Response;
      try {
        res = await fetchImpl(`${baseUrl}${simulatePath(input.eventName)}`, {
          method: "POST",
          headers: { "content-type": "application/json", accept: "application/json", authorization: `Bearer ${token}` },
          body: JSON.stringify({ businessId: input.businessId, ...(input.connector ? { connector: input.connector } : {}), ...(input.seed ? { seed: input.seed } : {}), ...(input.params ? { params: input.params } : {}) }),
          signal: controller.signal,
        });
      } catch (e) {
        throw new AppError("ingest_unreachable", `The ingest service did not answer: ${(e as Error).message}`, 503);
      } finally {
        clearTimeout(timer);
      }
      const text = await res.text();
      let body: unknown = text;
      try {
        body = JSON.parse(text);
      } catch {
        /* plain text */
      }
      return { ok: res.ok, status: res.status, body };
    },
  };
}
