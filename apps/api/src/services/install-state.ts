/**
 * The `state` that rides through an App installation (GitHub): Connect signs it for the founder and the business, GitHub
 * hands it back with the installation id and an authorization code, and finishing the connect accepts it only from the
 * same founder, for the same business, within fifteen minutes. A link carrying someone else's installation (or someone
 * else's state) cannot attach it to a business.
 *
 * Format: `<base64url(JSON {b, u, exp, n})>.<base64url(HMAC-SHA256)>`, keyed by SESSION_TOKEN_SECRET under its own
 * label so the same secret's other uses (service and session JWTs) can never verify as a state, or the reverse.
 */
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { AppError, ForbiddenError } from "@foundmill/shared";
import { z } from "zod";

export const INSTALL_STATE_TTL_SECONDS = 15 * 60;
const LABEL = "foundmill/app-install-state/v1";

const Payload = z.object({ b: z.uuid(), u: z.string().min(1).max(200), exp: z.number().int(), n: z.string().min(8).max(64) });

const mac = (secret: string, body: string): Buffer => createHmac("sha256", secret).update(`${LABEL}\n${body}`).digest();

function requireSecret(secret: string | null | undefined): string {
  if (!secret || secret.length < 16) throw new AppError("config", "SESSION_TOKEN_SECRET is not set on the api, so App installations cannot be connected", 412);
  return secret;
}

export function signInstallState(secret: string | null | undefined, who: { userId: string; businessId: string }, now: Date = new Date()): string {
  const key = requireSecret(secret);
  const body = Buffer.from(JSON.stringify({ b: who.businessId, u: who.userId, exp: Math.floor(now.getTime() / 1000) + INSTALL_STATE_TTL_SECONDS, n: randomBytes(12).toString("base64url") })).toString("base64url");
  return `${body}.${mac(key, body).toString("base64url")}`;
}

/** Throws ForbiddenError unless `state` was signed here for this founder and business and has not expired. */
export function verifyInstallState(secret: string | null | undefined, state: string, who: { userId: string; businessId: string }, now: Date = new Date()): void {
  const key = requireSecret(secret);
  const [body, sig, ...rest] = state.split(".");
  if (!body || !sig || rest.length > 0) throw new ForbiddenError("This GitHub installation link is not valid: connect GitHub again from Settings › Integrations");
  const expected = mac(key, body);
  const given = Buffer.from(sig, "base64url");
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) throw new ForbiddenError("This GitHub installation link is not valid: connect GitHub again from Settings › Integrations");
  let payload: z.infer<typeof Payload>;
  try {
    payload = Payload.parse(JSON.parse(Buffer.from(body, "base64url").toString("utf8")));
  } catch {
    throw new ForbiddenError("This GitHub installation link is not valid: connect GitHub again from Settings › Integrations");
  }
  if (payload.exp * 1000 < now.getTime()) throw new ForbiddenError("This GitHub installation link has expired: connect GitHub again from Settings › Integrations");
  if (payload.u !== who.userId || payload.b !== who.businessId) throw new ForbiddenError("This GitHub installation was started by someone else or for another business: connect GitHub again from Settings › Integrations");
}
