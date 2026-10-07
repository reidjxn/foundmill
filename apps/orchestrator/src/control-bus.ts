/**
 * Session control bus: how a Temporal signal (pause / resume / shout / stop / decision) reaches the activity that is
 * running the agent session right now. The workflow calls the `postSessionCommand` activity, which appends to the
 * session's control list; the runner polls the list between events (and on a timer while it waits). In production the
 * list lives in Redis (`asctl:{sessionId}`); tests and the mock golden path can use the in-memory bus.
 */
export type SessionCommand =
  | { kind: "pause"; by?: string | null; at?: string }
  | { kind: "resume"; by?: string | null; at?: string }
  | { kind: "stop"; reason: string; by?: string | null; at?: string }
  | { kind: "shout"; message: string; preset?: string | null; modelKey?: string | null; by?: string | null; at?: string }
  | { kind: "decision"; approvalId: string; outcome: "approved" | "rejected"; by?: string | null; at?: string };

export interface SessionControlBus {
  post(sessionId: string, command: SessionCommand): Promise<void>;
  /** Drain every pending command in order. */
  drain(sessionId: string): Promise<SessionCommand[]>;
  clear(sessionId: string): Promise<void>;
}

export const controlKey = (sessionId: string): string => `asctl:${sessionId}`;

/** The slice of ioredis this bus needs. */
export interface ControlRedis {
  rpush(key: string, ...values: string[]): Promise<number>;
  lpop(key: string): Promise<string | null>;
  del(...keys: string[]): Promise<number>;
  expire?(key: string, seconds: number): Promise<number>;
}

const CONTROL_TTL_SECONDS = 24 * 60 * 60;

export class RedisControlBus implements SessionControlBus {
  constructor(private readonly redis: ControlRedis) {}

  async post(sessionId: string, command: SessionCommand): Promise<void> {
    const key = controlKey(sessionId);
    await this.redis.rpush(key, JSON.stringify({ at: new Date().toISOString(), ...command }));
    await this.redis.expire?.(key, CONTROL_TTL_SECONDS);
  }

  async drain(sessionId: string): Promise<SessionCommand[]> {
    const key = controlKey(sessionId);
    const out: SessionCommand[] = [];
    for (let i = 0; i < 1000; i++) {
      const raw = await this.redis.lpop(key);
      if (raw === null) break;
      const parsed = parseCommand(raw);
      if (parsed) out.push(parsed);
    }
    return out;
  }

  async clear(sessionId: string): Promise<void> {
    await this.redis.del(controlKey(sessionId));
  }
}

export class MemoryControlBus implements SessionControlBus {
  private readonly queues = new Map<string, SessionCommand[]>();
  /** Every command ever posted, for assertions. */
  readonly log: { sessionId: string; command: SessionCommand }[] = [];

  async post(sessionId: string, command: SessionCommand): Promise<void> {
    const q = this.queues.get(sessionId) ?? [];
    q.push({ at: new Date().toISOString(), ...command });
    this.queues.set(sessionId, q);
    this.log.push({ sessionId, command });
  }

  async drain(sessionId: string): Promise<SessionCommand[]> {
    const q = this.queues.get(sessionId) ?? [];
    this.queues.set(sessionId, []);
    return q;
  }

  async clear(sessionId: string): Promise<void> {
    this.queues.delete(sessionId);
  }
}

const KINDS = new Set(["pause", "resume", "stop", "shout", "decision"]);

export function parseCommand(raw: string): SessionCommand | null {
  try {
    const v = JSON.parse(raw) as Record<string, unknown>;
    if (!v || typeof v.kind !== "string" || !KINDS.has(v.kind)) return null;
    if (v.kind === "stop" && typeof v.reason !== "string") return { kind: "stop", reason: "stopped", by: (v.by as string | null) ?? null };
    if (v.kind === "shout" && typeof v.message !== "string") return null;
    if (v.kind === "decision" && (typeof v.approvalId !== "string" || (v.outcome !== "approved" && v.outcome !== "rejected"))) return null;
    return v as unknown as SessionCommand;
  } catch {
    return null;
  }
}
