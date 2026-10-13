/**
 * Recipients and the untrusted-content register (BUILD §2.3 suppression, §9.8 step 4).
 *
 * Every third-party result that comes back through the gateway is scanned with the connectors package's
 * `extractCandidateRecipients`; the emails, URLs and phone numbers it finds are remembered for the whole business
 * as "first seen in untrusted content" (every session and every replica: audit SECX-8). A later outbound call whose
 * arguments carry one of them gets `recipientFirstSeenInUntrusted: true`, which the untrusted-recipient policy forbids
 * until a founder approves.
 *
 * Suppression hashes: the suppression list stores sha256 hex of the normalised value (lowercase, trimmed email;
 * digits-only phone), never the value itself (BUILD §7.2 `suppression_list`).
 */
import { createHash } from "node:crypto";
import { extractCandidateRecipients, type CandidateRecipients } from "@foundmill/connectors";

export type RecipientKind = "email" | "url" | "phone";

export interface RecipientCandidate {
  kind: RecipientKind;
  /** Normalised form used for matching and hashing. */
  value: string;
}

export function normaliseEmail(value: string): string {
  return value.trim().toLowerCase();
}

export function normalisePhone(value: string): string {
  return value.replace(/[^\d+]/g, "").replace(/(?!^)\+/g, "");
}

export function normaliseUrl(value: string): string {
  const trimmed = value.trim().replace(/[.,;:!?)\]]+$/, "");
  try {
    const u = new URL(trimmed);
    u.hash = "";
    const path = u.pathname.replace(/\/+$/, "");
    return `${u.protocol}//${u.host.toLowerCase()}${path}${u.search}`;
  } catch {
    return trimmed.toLowerCase();
  }
}

export function normaliseRecipient(kind: RecipientKind, value: string): string {
  return kind === "email" ? normaliseEmail(value) : kind === "phone" ? normalisePhone(value) : normaliseUrl(value);
}

/** sha256 hex of the normalised value — the form `suppression_list.*_hash` columns hold. */
export function hashRecipient(kind: RecipientKind, value: string): string {
  return createHash("sha256").update(normaliseRecipient(kind, value), "utf8").digest("hex");
}

const EMAIL_ONLY_RE = /^[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}$/i;
const URL_ONLY_RE = /^https?:\/\/\S+$/i;

/** Classifies a single explicit recipient (the `context.recipient` field of a call). */
export function classifyRecipient(value: string): RecipientCandidate | null {
  const v = value.trim();
  if (!v) return null;
  if (EMAIL_ONLY_RE.test(v)) return { kind: "email", value: normaliseEmail(v) };
  if (URL_ONLY_RE.test(v)) return { kind: "url", value: normaliseUrl(v) };
  const digits = v.replace(/\D/g, "");
  if (digits.length >= 8 && /^[+\d\s().-]+$/.test(v)) return { kind: "phone", value: normalisePhone(v) };
  return null;
}

export function toCandidates(found: CandidateRecipients): RecipientCandidate[] {
  const out: RecipientCandidate[] = [];
  for (const e of found.emails) out.push({ kind: "email", value: normaliseEmail(e) });
  for (const u of found.urls) out.push({ kind: "url", value: normaliseUrl(u) });
  for (const p of found.phones) out.push({ kind: "phone", value: normalisePhone(p) });
  return dedupe(out);
}

function dedupe(list: RecipientCandidate[]): RecipientCandidate[] {
  const seen = new Set<string>();
  return list.filter((c) => {
    const k = `${c.kind}:${c.value}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

/** Every recipient-shaped value inside tool arguments, plus the explicit `context.recipient` when given. */
export function candidatesFromArgs(args: unknown, explicitRecipient?: string): RecipientCandidate[] {
  const fromArgs = args === undefined || args === null ? [] : toCandidates(extractCandidateRecipients(args));
  const explicit = explicitRecipient ? classifyRecipient(explicitRecipient) : null;
  return dedupe(explicit ? [explicit, ...fromArgs] : fromArgs);
}

/** Every recipient-shaped value inside a piece of untrusted content. */
export function candidatesFromContent(content: unknown): RecipientCandidate[] {
  return toCandidates(extractCandidateRecipients(content));
}

/** The business-wide register of recipients first seen in untrusted content (SEC-6). Async: the shared one is in Redis. */
export interface UntrustedRegister {
  /** Records candidates found in untrusted content for the business; returns how many were new. */
  record(businessId: string, candidates: readonly RecipientCandidate[]): Promise<number>;
  /**
   * Records the seed a session starts with (recipients in files restored from earlier sessions): the values join the
   * business's register; `all` marks every recipient of this session; the session is marked as seeded. Returns how many
   * values were new.
   */
  seed(businessId: string, sessionId: string, candidates: readonly RecipientCandidate[], all?: boolean): Promise<number>;
  /** Whether the seed this session was minted with is known here (a replica that lost it fails closed). */
  isSeeded(sessionId: string): Promise<boolean>;
  /** The subset of `candidates` the business first saw inside untrusted content (or every one, for a session marked `all`). */
  firstSeenInUntrusted(businessId: string, sessionId: string, candidates: readonly RecipientCandidate[]): Promise<RecipientCandidate[]>;
  size(businessId: string): Promise<number>;
  clear(businessId: string, sessionId?: string): Promise<void>;
}

export interface UntrustedRecipientRegistryOptions {
  /** How long a business's register lives after its last write. Default 12 hours (longer than any session token). */
  ttlMs?: number;
  now?: () => number;
}

const keyOf = (c: RecipientCandidate) => `${c.kind}:${c.value}`;

/**
 * In-process register (development, tests, and the Redis register's fallback), keyed by business: what any session of the
 * business saw is known to every session of it in this process. Another replica or a restart does not share it; the
 * Redis register does.
 */
export class UntrustedRecipientRegistry implements UntrustedRegister {
  private readonly businesses = new Map<string, { values: Set<string>; touchedAt: number }>();
  private readonly sessions = new Map<string, { all: boolean; seeded: boolean; touchedAt: number }>();
  private readonly ttlMs: number;
  private readonly now: () => number;

  constructor(options: UntrustedRecipientRegistryOptions = {}) {
    this.ttlMs = options.ttlMs ?? 12 * 60 * 60 * 1000;
    this.now = options.now ?? (() => Date.now());
  }

  async record(businessId: string, candidates: readonly RecipientCandidate[]): Promise<number> {
    return this.recordNow(businessId, candidates);
  }

  /** Synchronous `record` (the Redis register writes here too, so a Redis outage never forgets what this process saw). */
  recordNow(businessId: string, candidates: readonly RecipientCandidate[]): number {
    if (candidates.length === 0) return 0;
    this.sweep();
    const entry = this.businesses.get(businessId) ?? { values: new Set<string>(), touchedAt: 0 };
    let added = 0;
    for (const c of candidates) {
      const k = keyOf(c);
      if (!entry.values.has(k)) {
        entry.values.add(k);
        added += 1;
      }
    }
    entry.touchedAt = this.now();
    this.businesses.set(businessId, entry);
    return added;
  }

  async seed(businessId: string, sessionId: string, candidates: readonly RecipientCandidate[], all = false): Promise<number> {
    return this.seedNow(businessId, sessionId, candidates, all);
  }

  seedNow(businessId: string, sessionId: string, candidates: readonly RecipientCandidate[], all = false): number {
    this.sweep();
    const entry = this.sessions.get(sessionId) ?? { all: false, seeded: false, touchedAt: 0 };
    entry.seeded = true;
    if (all) entry.all = true;
    entry.touchedAt = this.now();
    this.sessions.set(sessionId, entry);
    return this.recordNow(businessId, candidates);
  }

  async isSeeded(sessionId: string): Promise<boolean> {
    return this.sessions.get(sessionId)?.seeded === true;
  }

  async firstSeenInUntrusted(businessId: string, sessionId: string, candidates: readonly RecipientCandidate[]): Promise<RecipientCandidate[]> {
    return this.firstSeenNow(businessId, sessionId, candidates);
  }

  firstSeenNow(businessId: string, sessionId: string, candidates: readonly RecipientCandidate[]): RecipientCandidate[] {
    if (this.sessions.get(sessionId)?.all === true) return [...candidates];
    const values = this.businesses.get(businessId)?.values;
    return values ? candidates.filter((c) => values.has(keyOf(c))) : [];
  }

  async size(businessId: string): Promise<number> {
    return this.businesses.get(businessId)?.values.size ?? 0;
  }

  async clear(businessId: string, sessionId?: string): Promise<void> {
    this.businesses.delete(businessId);
    if (sessionId) this.sessions.delete(sessionId);
  }

  private sweep(): void {
    const cutoff = this.now() - this.ttlMs;
    for (const [id, entry] of this.businesses) if (entry.touchedAt < cutoff) this.businesses.delete(id);
    for (const [id, entry] of this.sessions) if (entry.touchedAt < cutoff) this.sessions.delete(id);
  }
}

/** The ioredis surface the shared register uses (structural, so tests can stub it). */
export interface RedisSetClient {
  sadd(key: string, ...members: string[]): Promise<number>;
  sismember(key: string, member: string): Promise<number>;
  scard(key: string): Promise<number>;
  set(key: string, value: string, mode: "PX", ttlMs: number): Promise<unknown>;
  get(key: string): Promise<string | null>;
  pexpire(key: string, ttlMs: number): Promise<unknown>;
  del(...keys: string[]): Promise<unknown>;
}

export interface RedisUntrustedRegisterOptions extends UntrustedRecipientRegistryOptions {
  /** Called once per outage when Redis fails and the register answers from this process's memory. */
  onFallback?: (error: unknown) => void;
  prefix?: string;
}

/**
 * The register every replica shares (`gw:untrusted:<businessId>`, a Redis set with a TTL), so an address one session saw in
 * untrusted content cannot be contacted from another session, another replica, or after a restart. Every write also goes
 * to this process's memory, and when Redis does not answer the register answers from memory: an outage never forgets
 * what this process saw and never blocks a call.
 */
export class RedisUntrustedRegister implements UntrustedRegister {
  private readonly local: UntrustedRecipientRegistry;
  private readonly ttlMs: number;
  private readonly prefix: string;
  private failed = false;

  constructor(
    private readonly redis: RedisSetClient,
    private readonly options: RedisUntrustedRegisterOptions = {},
  ) {
    this.local = new UntrustedRecipientRegistry(options);
    this.ttlMs = options.ttlMs ?? 12 * 60 * 60 * 1000;
    this.prefix = options.prefix ?? "gw:untrusted:";
  }

  private businessKey = (businessId: string) => `${this.prefix}${businessId}`;
  private sessionKey = (kind: "seeded" | "all", sessionId: string) => `${this.prefix}session:${kind}:${sessionId}`;

  private async guarded<T>(viaRedis: () => Promise<T>, fallback: () => T): Promise<T> {
    try {
      const out = await viaRedis();
      this.failed = false;
      return out;
    } catch (err) {
      if (!this.failed) this.options.onFallback?.(err);
      this.failed = true;
      return fallback();
    }
  }

  async record(businessId: string, candidates: readonly RecipientCandidate[]): Promise<number> {
    const localAdded = this.local.recordNow(businessId, candidates);
    if (candidates.length === 0) return 0;
    return this.guarded(
      async () => {
        const key = this.businessKey(businessId);
        const added = await this.redis.sadd(key, ...candidates.map(keyOf));
        await this.redis.pexpire(key, this.ttlMs);
        return added;
      },
      () => localAdded,
    );
  }

  async seed(businessId: string, sessionId: string, candidates: readonly RecipientCandidate[], all = false): Promise<number> {
    const localAdded = this.local.seedNow(businessId, sessionId, candidates, all);
    return this.guarded(
      async () => {
        await this.redis.set(this.sessionKey("seeded", sessionId), "1", "PX", this.ttlMs);
        if (all) await this.redis.set(this.sessionKey("all", sessionId), "1", "PX", this.ttlMs);
        if (candidates.length === 0) return 0;
        const key = this.businessKey(businessId);
        const added = await this.redis.sadd(key, ...candidates.map(keyOf));
        await this.redis.pexpire(key, this.ttlMs);
        return added;
      },
      () => localAdded,
    );
  }

  async isSeeded(sessionId: string): Promise<boolean> {
    if (await this.local.isSeeded(sessionId)) return true;
    return this.guarded(
      async () => (await this.redis.get(this.sessionKey("seeded", sessionId))) !== null,
      () => false,
    );
  }

  async firstSeenInUntrusted(businessId: string, sessionId: string, candidates: readonly RecipientCandidate[]): Promise<RecipientCandidate[]> {
    const seenHere = this.local.firstSeenNow(businessId, sessionId, candidates);
    if (candidates.length === 0) return [];
    return this.guarded(
      async () => {
        if ((await this.redis.get(this.sessionKey("all", sessionId))) !== null) return [...candidates];
        const key = this.businessKey(businessId);
        const flags = await Promise.all(candidates.map((c) => this.redis.sismember(key, keyOf(c))));
        const known = new Set([...seenHere, ...candidates.filter((_, i) => flags[i] === 1)].map(keyOf));
        return candidates.filter((c) => known.has(keyOf(c)));
      },
      () => seenHere,
    );
  }

  async size(businessId: string): Promise<number> {
    const shared = await this.guarded(
      () => this.redis.scard(this.businessKey(businessId)),
      () => 0,
    );
    return Math.max(shared, await this.local.size(businessId));
  }

  async clear(businessId: string, sessionId?: string): Promise<void> {
    await this.local.clear(businessId, sessionId);
    await this.guarded(
      async () => {
        await this.redis.del(this.businessKey(businessId), ...(sessionId ? [this.sessionKey("seeded", sessionId), this.sessionKey("all", sessionId)] : []));
      },
      () => undefined,
    );
  }
}
