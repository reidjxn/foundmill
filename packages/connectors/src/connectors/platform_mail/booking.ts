/**
 * The link in a booking's emails (founder, Nov 22, 2026): one press to cancel or change the booking, on the project's
 * booking page. The token names the booking and is signed under its own label (`fm-booking-manage`), so it can never
 * pass for a session token, an unsubscribe token or a follow confirmation, and the other way round. Nothing is stored:
 * the api verifies the signature and reads the booking by its id. Signed with the secret the api and the gateway share
 * (SESSION_TOKEN_SECRET), because the gateway writes the link into the email and the api answers the page it opens.
 *
 * The link works for as long as the booking can be changed; whether it still can is the booking's own state (its
 * status and start), checked by the api on every use, not a property of the token. Only `node:crypto`.
 */
import { createHmac, timingSafeEqual } from "node:crypto";

const LABEL = "fm-booking-manage";
const VERSION = "b1";
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Development and test stacks without SESSION_TOKEN_SECRET: links work inside the stack and nowhere else. */
export const DEV_BOOKING_LINK_SECRET = "foundmill-dev-booking-link-secret-not-for-production";

// The shared secret is never used raw: the links are signed with a key derived from it under this file's own label.
const keyOf = (secret: string): Buffer => createHmac("sha256", secret).update(`${LABEL}/key`, "utf8").digest();
const mac = (secret: string, bookingId: string): string => createHmac("sha256", keyOf(secret)).update([LABEL, VERSION, bookingId].join("\u0000"), "utf8").digest("base64url");

export function bookingManageToken(secret: string, bookingId: string): string {
  const id = bookingId.toLowerCase();
  return `${VERSION}.${id}.${mac(secret, id)}`;
}

/** The booking id of a token signed with `secret`; null for anything else. */
export function readBookingManageToken(secret: string, token: string): string | null {
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const [v, id, sig] = parts as [string, string, string];
  if (v !== VERSION || !UUID_RE.test(id)) return null;
  const expected = Buffer.from(mac(secret, id.toLowerCase()));
  const given = Buffer.from(sig);
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
  return id.toLowerCase();
}

/**
 * The secret booking links are signed with: SESSION_TOKEN_SECRET where it is set (16 characters or more), the
 * development constant on a development or test stack without one, and null anywhere else (no link is made or accepted).
 */
export function bookingLinkSecret(env: { SESSION_TOKEN_SECRET?: string | undefined; APP_ENV?: string | undefined }): string | null {
  if (env.SESSION_TOKEN_SECRET && env.SESSION_TOKEN_SECRET.length >= 16) return env.SESSION_TOKEN_SECRET;
  return env.APP_ENV === undefined || env.APP_ENV === "development" || env.APP_ENV === "test" ? DEV_BOOKING_LINK_SECRET : null;
}

/** `<app>/p/<slug>/book/manage?t=<token>`: the page where a customer cancels or moves their booking. */
export const bookingManageUrl = (appUrl: string, slug: string, token: string): string => `${appUrl.replace(/\/+$/, "")}/p/${encodeURIComponent(slug)}/book/manage?t=${encodeURIComponent(token)}`;
