/**
 * Team call's streamed speech (docs/TEAM_CALL.md §3): a ticket stands for one agent turn the listener may hear. An
 * <audio> element cannot send the bearer token, so `teamCall.speech({ stream: true })` checks the person (Team read,
 * RLS on the call, the credits gate), renders the turn's words with the listener's own names, and stores what the stream
 * needs under a random id; `GET /team-call-audio/:ticket` then pipes the gateway's stream to the browser. A ticket lives
 * `SPEECH_TICKET_TTL_MS` and serves at most `SPEECH_TICKET_MAX_USES` requests (a browser may ask twice for one clip),
 * so a leaked link speaks at most that turn, briefly. Redis when the api has one (every replica reads the same tickets),
 * else this process.
 */
import { randomBytes } from "node:crypto";

export const SPEECH_TICKET_TTL_MS = 120_000;
export const SPEECH_TICKET_MAX_USES = 3;
const PREFIX = "speech-ticket:";

export interface SpeechTicket {
  businessId: string;
  callId: string;
  turnId: string;
  userId: string;
  speechAccent: string;
  text: string;
}

interface TicketRedis {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, px: "PX", ms: number): Promise<unknown>;
  incr(key: string): Promise<number>;
  pexpire(key: string, ms: number): Promise<unknown>;
}

const isTicketRedis = (r: unknown): r is TicketRedis => {
  const x = r as Partial<TicketRedis> | null | undefined;
  return !!x && typeof x.get === "function" && typeof x.set === "function" && typeof x.incr === "function" && typeof x.pexpire === "function";
};

export interface SpeechTicketStore {
  issue(ticket: SpeechTicket): Promise<string>;
  /** The ticket, counting one use; null when unknown, expired or used up. */
  take(id: string): Promise<SpeechTicket | null>;
}

const TICKET_ID = /^[A-Za-z0-9_-]{32,64}$/;

function memoryStore(now: () => number): SpeechTicketStore {
  const tickets = new Map<string, { ticket: SpeechTicket; expiresAt: number; uses: number }>();
  return {
    async issue(ticket) {
      const t = now();
      for (const [k, v] of tickets) if (v.expiresAt <= t) tickets.delete(k);
      const id = randomBytes(24).toString("base64url");
      tickets.set(id, { ticket, expiresAt: t + SPEECH_TICKET_TTL_MS, uses: 0 });
      return id;
    },
    async take(id) {
      if (!TICKET_ID.test(id)) return null;
      const entry = tickets.get(id);
      if (!entry || entry.expiresAt <= now() || entry.uses >= SPEECH_TICKET_MAX_USES) return null;
      entry.uses += 1;
      return entry.ticket;
    },
  };
}

function redisStore(redis: TicketRedis): SpeechTicketStore {
  return {
    async issue(ticket) {
      const id = randomBytes(24).toString("base64url");
      await redis.set(PREFIX + id, JSON.stringify(ticket), "PX", SPEECH_TICKET_TTL_MS);
      return id;
    },
    async take(id) {
      if (!TICKET_ID.test(id)) return null;
      const raw = await redis.get(PREFIX + id);
      if (!raw) return null;
      const uses = await redis.incr(PREFIX + id + ":uses");
      if (uses === 1) await redis.pexpire(PREFIX + id + ":uses", SPEECH_TICKET_TTL_MS);
      if (uses > SPEECH_TICKET_MAX_USES) return null;
      try {
        return JSON.parse(raw) as SpeechTicket;
      } catch {
        return null;
      }
    },
  };
}

const stores = new WeakMap<object, SpeechTicketStore>();
let local: SpeechTicketStore | null = null;

/** The store for this api: Redis-backed when `redis` speaks GET/SET/INCR/PEXPIRE, else one per process. */
export function speechTickets(redis: unknown, now: () => number = Date.now): SpeechTicketStore {
  if (isTicketRedis(redis)) {
    let store = stores.get(redis as object);
    if (!store) stores.set(redis as object, (store = redisStore(redis)));
    return store;
  }
  return (local ??= memoryStore(now));
}

/** Tests: a fresh in-process store with its own clock. */
export const createMemorySpeechTickets = (now: () => number): SpeechTicketStore => memoryStore(now);
