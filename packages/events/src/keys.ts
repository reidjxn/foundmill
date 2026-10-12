/**
 * Redis stream key conventions (docs/ARCHITECTURE.md §5, BUILD §8.2).
 *
 * - `ev:{businessId}`   platform events for one business (relay → consumers, apps/stream fan-out)
 * - `as:{sessionId}`    agent session events (orchestrator → Training Ground tiles, replay)
 * - `u:{userId}`        signals for one person (LIVE: a request, a message or an invitation reached them); content-free
 * - `dlq:{group}`       dead letters for one consumer group (entries that failed `maxRetries` times)
 * - `dlq:outbox-relay`  outbox rows the relay could not publish as valid platform events
 */
export const BUSINESS_STREAM_PREFIX = "ev:";
export const SESSION_STREAM_PREFIX = "as:";
export const USER_STREAM_PREFIX = "u:";
export const DEAD_LETTER_PREFIX = "dlq:";

export const businessStreamKey = (businessId: string): string =>
  `${BUSINESS_STREAM_PREFIX}${businessId}`;
export const sessionStreamKey = (sessionId: string): string =>
  `${SESSION_STREAM_PREFIX}${sessionId}`;
export const userStreamKey = (userId: string): string => `${USER_STREAM_PREFIX}${userId}`;
export const deadLetterKey = (group: string): string => `${DEAD_LETTER_PREFIX}${group}`;
export const RELAY_DEAD_LETTER_KEY = deadLetterKey("outbox-relay");

/** Pattern matching every business stream (for consumers that want all businesses). */
export const ALL_BUSINESS_STREAMS_PATTERN = `${BUSINESS_STREAM_PREFIX}*`;

/** Default retention per stream: XADD ... MAXLEN ~ 100000 (approximate trimming). */
export const DEFAULT_STREAM_MAXLEN = 100_000;

export function businessIdFromStreamKey(key: string): string | null {
  return key.startsWith(BUSINESS_STREAM_PREFIX) ? key.slice(BUSINESS_STREAM_PREFIX.length) : null;
}

export function sessionIdFromStreamKey(key: string): string | null {
  return key.startsWith(SESSION_STREAM_PREFIX) ? key.slice(SESSION_STREAM_PREFIX.length) : null;
}
