/**
 * Tokens that founder emails carry (retention plan, 2026-11-11). Server-only (node:crypto): import it as
 * `@foundmill/shared/email-links`; it is not in the browser barrel.
 *
 * - A **pause link** ("Pause every email" in each email's footer, and the List-Unsubscribe header) is an HMAC-signed
 *   `{ user, expiry }`, so it works without signing in and without a row. The key is derived from SESSION_TOKEN_SECRET
 *   with its own label, so a pause token can never stand in for a service token.
 * - A **one-click answer** is a random 32-byte token; only its sha-256 is stored (founder_notifications), and it works
 *   once, before its expiry, for the one option it was minted for.
 */
import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";

const PAUSE_LABEL = "foundmill:founder-email:pause:v1";
/** Used only in development and test when SESSION_TOKEN_SECRET is unset. */
const DEV_SECRET = "foundmill-dev-email-link-secret";
export const PAUSE_TOKEN_TTL_MS = 60 * 86_400_000;

export function emailLinkSecret(env: { SESSION_TOKEN_SECRET?: string; APP_ENV: string }): string {
  if (env.SESSION_TOKEN_SECRET) return env.SESSION_TOKEN_SECRET;
  if (env.APP_ENV === "development" || env.APP_ENV === "test") return DEV_SECRET;
  throw new Error("SESSION_TOKEN_SECRET is required to sign founder email links");
}

const b64 = (buf: Buffer) => buf.toString("base64url");
const mac = (secret: string, body: string) => createHmac("sha256", `${PAUSE_LABEL}:${secret}`).update(body).digest();

export function signPauseToken(secret: string, userId: string, nowMs: number = Date.now(), ttlMs: number = PAUSE_TOKEN_TTL_MS): string {
  const body = b64(Buffer.from(JSON.stringify({ u: userId, e: Math.floor((nowMs + ttlMs) / 1000) })));
  return `${body}.${b64(mac(secret, body))}`;
}

/** The account a pause token was signed for, or null when it is malformed, forged or expired. */
export function verifyPauseToken(secret: string, token: string, nowMs: number = Date.now()): string | null {
  const [body, sig, extra] = token.split(".");
  if (!body || !sig || extra !== undefined || token.length > 400) return null;
  const want = mac(secret, body);
  const got = Buffer.from(sig, "base64url");
  if (got.length !== want.length || !timingSafeEqual(got, want)) return null;
  try {
    const v = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as { u?: unknown; e?: unknown };
    if (typeof v.u !== "string" || typeof v.e !== "number" || v.e * 1000 < nowMs) return null;
    return v.u;
  } catch {
    return null;
  }
}

export function hashActionToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/** A fresh one-click answer token and the hash to store. */
export function newActionToken(): { token: string; hash: string } {
  const token = b64(randomBytes(32));
  return { token, hash: hashActionToken(token) };
}

/** True when the string has the shape of an action token (43 base64url characters). */
export function isActionTokenShape(token: string): boolean {
  return /^[A-Za-z0-9_-]{43}$/.test(token);
}
