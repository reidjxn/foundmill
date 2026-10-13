/**
 * Wire protocol of apps/stream (docs/ARCHITECTURE.md §12). Dependency-free so `client.ts` (shipped to the browser)
 * and the server share one definition.
 *
 * Handshake (security review SEC-12): the access token never travels in the URL, where proxies and CDNs log it. The
 * client offers two WebSocket subprotocols, `foundmill.stream.v1` and `foundmill.bearer.<base64url(token)>`; the
 * server verifies the bearer before the upgrade (401 / 403, never a socket), selects `foundmill.stream.v1` only (the
 * token is never echoed) and answers with `Cache-Control: no-store`. A URL that still carries `?token=` is refused
 * with 400. A socket lives no longer than its token: at expiry the server closes it with 4001 unless the client has
 * sent a fresh token for the same account (`auth`).
 *
 * Client → server
 *   { "t": "sub",   "ch": "ev:<businessId>" | "as:<sessionId>", "focus"?: boolean }
 *   { "t": "unsub", "ch": ... }
 *   { "t": "ping" }
 *   { "t": "focus", "ch": ..., "focused": boolean }        (extension: lets the server prefer dropping unfocused tiles
 *                                                            under backpressure; see docs/DECISIONS.md)
 *   { "t": "auth", "token": "..." }                        (extension: a refreshed access token for the same account,
 *                                                            sent before the current one expires; answered by `authed`)
 * Server → client
 *   { "ch": "...", "e": <event json> }                     one event
 *   [ { "ch", "e" }, ... ]                                 a coalesced burst (each element is exactly one event frame)
 *   { "t": "pong" }
 *   { "t": "err", "ch"?: "...", "code": "...", "message": "..." }   (extension: subscription denied / bad frame)
 *   { "t": "subscribed", "ch": "..." }                     (extension: the subscription is live; every event from
 *                                                            here on is delivered, so a tab refetches what it may
 *                                                            have missed before it, and only then trusts the stream)
 *   { "t": "authed", "exp": <epoch ms> | null }            (extension: a refreshed token was accepted; the socket now
 *                                                            lives until `exp`, null when the credential has none)
 */

/** The subprotocol every client offers and the server selects. */
export const STREAM_SUBPROTOCOL = "foundmill.stream.v1";
/**
 * Prefix of the subprotocol that carries the access token, base64url-encoded: a subprotocol must be an HTTP token, and
 * a dev token's ":" is not one.
 */
export const BEARER_PROTOCOL_PREFIX = "foundmill.bearer.";

function base64UrlEncode(text: string): string {
  let binary = "";
  for (const b of new TextEncoder().encode(text)) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function base64UrlDecode(text: string): string | null {
  if (!/^[A-Za-z0-9_-]*$/.test(text)) return null;
  try {
    const binary = atob(text.replace(/-/g, "+").replace(/_/g, "/"));
    return new TextDecoder("utf-8", { fatal: true }).decode(Uint8Array.from(binary, (c) => c.charCodeAt(0)));
  } catch {
    return null;
  }
}

/** The subprotocols a client offers: the stream's own, plus the token when there is one ("" connects anonymously, dev only). */
export function streamProtocols(token: string | null | undefined): string[] {
  return token ? [STREAM_SUBPROTOCOL, `${BEARER_PROTOCOL_PREFIX}${base64UrlEncode(token)}`] : [STREAM_SUBPROTOCOL];
}

/** The token a `Sec-WebSocket-Protocol` header carries; null when it carries none (or one that does not decode). */
export function tokenFromProtocols(header: string | readonly string[] | null | undefined): string | null {
  const joined = typeof header === "string" ? header : header ? header.join(",") : "";
  const bearer = joined
    .split(",")
    .map((v) => v.trim())
    .find((v) => v.startsWith(BEARER_PROTOCOL_PREFIX));
  return bearer ? base64UrlDecode(bearer.slice(BEARER_PROTOCOL_PREFIX.length)) || null : null;
}

/**
 * When a JWT expires (epoch ms), read without verifying it (the server verifies); null for a token that is not a JWT or
 * carries no `exp` (a dev token). Clients use it to send a fresh token before the server closes the socket.
 */
export function tokenExpiry(token: string | null | undefined): number | null {
  const payload = token?.split(".")[1];
  const json = payload ? base64UrlDecode(payload) : null;
  if (!json) return null;
  try {
    const exp = (JSON.parse(json) as { exp?: unknown }).exp;
    return typeof exp === "number" && Number.isFinite(exp) ? exp * 1000 : null;
  } catch {
    return null;
  }
}

export const BUSINESS_CHANNEL_PREFIX = "ev:";
export const SESSION_CHANNEL_PREFIX = "as:";

export type ChannelKind = "business" | "session";

export interface ParsedChannel {
  kind: ChannelKind;
  /** The business id (`ev:`) or the agent session id (`as:`). */
  id: string;
  /** The Redis stream key, identical to the channel name by design (BUILD §8.2). */
  streamKey: string;
}

const ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Parse `ev:<uuid>` / `as:<uuid>`; null for anything else (unknown prefix, non-uuid id, stray whitespace). */
export function parseChannel(channel: unknown): ParsedChannel | null {
  if (typeof channel !== "string") return null;
  if (channel.startsWith(BUSINESS_CHANNEL_PREFIX)) {
    const id = channel.slice(BUSINESS_CHANNEL_PREFIX.length);
    return ID_RE.test(id) ? { kind: "business", id, streamKey: channel } : null;
  }
  if (channel.startsWith(SESSION_CHANNEL_PREFIX)) {
    const id = channel.slice(SESSION_CHANNEL_PREFIX.length);
    return ID_RE.test(id) ? { kind: "session", id, streamKey: channel } : null;
  }
  return null;
}

export const businessChannel = (businessId: string): string => `${BUSINESS_CHANNEL_PREFIX}${businessId}`;
export const sessionChannel = (sessionId: string): string => `${SESSION_CHANNEL_PREFIX}${sessionId}`;

export type ClientFrame =
  | { t: "sub"; ch: string; focus?: boolean }
  | { t: "unsub"; ch: string }
  | { t: "ping" }
  | { t: "focus"; ch: string; focused: boolean }
  | { t: "auth"; token: string };

export type StreamErrorCode =
  | "bad_frame"
  | "invalid_channel"
  | "forbidden"
  | "unavailable"
  | "too_many_subscriptions"
  | "shutting_down";

export interface EventFrame {
  ch: string;
  e: unknown;
}
export type PongFrame = { t: "pong" };
export type ErrorFrame = { t: "err"; ch?: string; code: StreamErrorCode; message: string };
export type SubscribedFrame = { t: "subscribed"; ch: string };
export type AuthedFrame = { t: "authed"; exp: number | null };
export type ServerFrame = EventFrame | EventFrame[] | PongFrame | ErrorFrame | SubscribedFrame | AuthedFrame;

/** Close codes the server uses (RFC 6455 range plus the private 4xxx range). */
export const CLOSE_CODES = {
  goingAway: 1001,
  policyViolation: 1008,
  tooSlow: 1013,
  heartbeatTimeout: 4000,
  /** The token does not verify or has expired, or a refreshed one names another account. */
  unauthorized: 4001,
  /** The account may no longer use the app (the invite list no longer names it). */
  forbidden: 4003,
} as const;

/** Server coalesces bursts to this many frames per second per socket (ARCHITECTURE §12). */
export const SERVER_FRAMES_PER_SECOND = 20;
/** Client throttles unfocused channels to this many handler bursts per second (BUILD §8.2). */
export const UNFOCUSED_BURSTS_PER_SECOND = 4;

/** Type guard for an event frame coming off the wire. */
export function isEventFrame(v: unknown): v is EventFrame {
  return typeof v === "object" && v !== null && typeof (v as EventFrame).ch === "string" && "e" in (v as object);
}

export function isPongFrame(v: unknown): v is PongFrame {
  return typeof v === "object" && v !== null && (v as PongFrame).t === "pong";
}

export function isErrorFrame(v: unknown): v is ErrorFrame {
  return typeof v === "object" && v !== null && (v as ErrorFrame).t === "err" && typeof (v as ErrorFrame).code === "string";
}

export function isAuthedFrame(v: unknown): v is AuthedFrame {
  return typeof v === "object" && v !== null && (v as AuthedFrame).t === "authed";
}

export function isSubscribedFrame(v: unknown): v is SubscribedFrame {
  return typeof v === "object" && v !== null && (v as SubscribedFrame).t === "subscribed" && typeof (v as SubscribedFrame).ch === "string";
}
