/**
 * The link in a follow confirmation email (package 1.6, double opt-in): `/mail/confirm?t=<token>` on ingest, the same
 * host as the unsubscribe link. The gateway signs it when it sends the email; ingest verifies it when the person opens
 * it. Signed with PLATFORM_MAIL_SIGNING_SECRET under its own label (`fm-follow-confirm`), so it can never pass for an
 * unsubscribe token or a message's custom args, and the other way round.
 *
 * The token names the business, the consent record and the hash of the address (never the address), when it expires
 * (seven days after it was sent) and a random nonce whose sha256 the record keeps: a link from an earlier email stops
 * working once a newer one is sent, and every link stops once the person confirmed. Only `node:crypto`: the e2e suite
 * imports this file directly.
 */
import { createHash, createHmac, timingSafeEqual } from "node:crypto";

export const PLATFORM_MAIL_CONFIRM_PATH = "/mail/confirm";
const LABEL = "fm-follow-confirm";
const VERSION = "c1";
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const HASH_RE = /^[0-9a-f]{64}$/;
const NONCE_RE = /^[A-Za-z0-9_-]{32,64}$/;

export interface FollowConfirmClaims {
  businessId: string;
  consentId: string;
  /** sha256 hex of the address, trimmed and lowercased (the suppression list's form). */
  emailHash: string;
  /** Unix seconds. */
  expiresAt: number;
  nonce: string;
}

const mac = (secret: string, parts: readonly string[]): string => createHmac("sha256", secret).update([LABEL, ...parts].join("\u0000"), "utf8").digest("base64url");

/** sha256 hex of the nonce: what `contact_consents.confirmation_token_hash` keeps. */
export const followConfirmNonceHash = (nonce: string): string => createHash("sha256").update(nonce, "utf8").digest("hex");

export function followConfirmToken(secret: string, claims: FollowConfirmClaims): string {
  const parts = [VERSION, claims.businessId.toLowerCase(), claims.consentId.toLowerCase(), claims.emailHash, String(Math.floor(claims.expiresAt)), claims.nonce];
  return `${parts.join(".")}.${mac(secret, parts)}`;
}

/** The claims of a token signed with `secret` that has not expired at `nowMs`; null for anything else. */
export function readFollowConfirmToken(secret: string, token: string, nowMs: number): FollowConfirmClaims | null {
  const parts = token.split(".");
  if (parts.length !== 7) return null;
  const [v, b, c, h, exp, nonce, sig] = parts as [string, string, string, string, string, string, string];
  if (v !== VERSION || !UUID_RE.test(b) || !UUID_RE.test(c) || !HASH_RE.test(h) || !/^\d{1,12}$/.test(exp) || !NONCE_RE.test(nonce)) return null;
  const expected = Buffer.from(mac(secret, [v, b, c, h, exp, nonce]));
  const given = Buffer.from(sig);
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
  const expiresAt = Number(exp);
  if (expiresAt * 1000 <= nowMs) return null;
  return { businessId: b.toLowerCase(), consentId: c.toLowerCase(), emailHash: h, expiresAt, nonce };
}

export const followConfirmUrl = (base: string, token: string): string => `${base.replace(/\/+$/, "")}${PLATFORM_MAIL_CONFIRM_PATH}?t=${encodeURIComponent(token)}`;
