/**
 * Wire protocol of apps/stream (docs/ARCHITECTURE.md §12). Dependency-free so `client.ts` (shipped to the browser)
 * and the server share one definition.
 *
 * Client → server
 *   { "t": "sub",   "ch": "ev:<businessId>" | "as:<sessionId>", "focus"?: boolean }
 *   { "t": "unsub", "ch": ... }
 *   { "t": "ping" }
 *   { "t": "focus", "ch": ..., "focused": boolean }        (extension: lets the server prefer dropping unfocused tiles
 *                                                            under backpressure; see docs/DECISIONS.md)
 * Server → client
 *   { "ch": "...", "e": <event json> }                     one event
 *   [ { "ch", "e" }, ... ]                                 a coalesced burst (each element is exactly one event frame)
 *   { "t": "pong" }
 *   { "t": "err", "ch"?: "...", "code": "...", "message": "..." }   (extension: subscription denied / bad frame)
 *   { "t": "subscribed", "ch": "..." }                     (extension: the subscription is live; every event from
 *                                                            here on is delivered, so a tab refetches what it may
 *                                                            have missed before it, and only then trusts the stream)
 */

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
  | { t: "focus"; ch: string; focused: boolean };

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
export type ServerFrame = EventFrame | EventFrame[] | PongFrame | ErrorFrame | SubscribedFrame;

/** Close codes the server uses (RFC 6455 range plus the private 4xxx range). */
export const CLOSE_CODES = {
  goingAway: 1001,
  policyViolation: 1008,
  tooSlow: 1013,
  heartbeatTimeout: 4000,
  unauthorized: 4001,
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

export function isSubscribedFrame(v: unknown): v is SubscribedFrame {
  return typeof v === "object" && v !== null && (v as SubscribedFrame).t === "subscribed" && typeof (v as SubscribedFrame).ch === "string";
}
