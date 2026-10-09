/**
 * Recipients and the untrusted-content register (BUILD §2.3 suppression, §9.8 step 4).
 *
 * Every third-party result that comes back through the gateway is scanned with the connectors package's
 * `extractCandidateRecipients`; the emails, URLs and phone numbers it finds are remembered per agent session
 * as "first seen in untrusted content". A later outbound call whose arguments carry one of them gets
 * `recipientFirstSeenInUntrusted: true`, which the untrusted-recipient policy forbids until a founder approves.
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

export interface UntrustedRecipientRegistryOptions {
  /** How long a session's register lives after its last write. Default 12 hours (longer than any session token). */
  ttlMs?: number;
  now?: () => number;
}

/**
 * Per-session memory of recipients first seen in untrusted content. In-process: what one replica saw is not known to
 * another, nor after a restart (SEC-6 moves it to Redis). Seeds given at mint are marked, and the session token says
 * a seed was given (`untrustedSeeded`), so a replica without the seed fails closed instead of forgetting it.
 */
export class UntrustedRecipientRegistry {
  private readonly sessions = new Map<string, { values: Set<string>; touchedAt: number; all?: boolean; seeded?: boolean }>();
  private readonly ttlMs: number;
  private readonly now: () => number;

  constructor(options: UntrustedRecipientRegistryOptions = {}) {
    this.ttlMs = options.ttlMs ?? 12 * 60 * 60 * 1000;
    this.now = options.now ?? (() => Date.now());
  }

  /** Records candidates found in untrusted content; returns how many were new. */
  record(sessionId: string, candidates: readonly RecipientCandidate[]): number {
    if (candidates.length === 0) return 0;
    this.sweep();
    const entry = this.sessions.get(sessionId) ?? { values: new Set<string>(), touchedAt: 0 };
    let added = 0;
    for (const c of candidates) {
      const k = `${c.kind}:${c.value}`;
      if (!entry.values.has(k)) {
        entry.values.add(k);
        added += 1;
      }
    }
    entry.touchedAt = this.now();
    this.sessions.set(sessionId, entry);
    return added;
  }

  /**
   * Records the seed a session starts with (recipients in files restored from earlier sessions); `all` marks every
   * recipient of the session. Returns how many values were new.
   */
  seed(sessionId: string, candidates: readonly RecipientCandidate[], all = false): number {
    this.sweep();
    const entry = this.sessions.get(sessionId) ?? { values: new Set<string>(), touchedAt: 0 };
    entry.seeded = true;
    if (all) entry.all = true;
    entry.touchedAt = this.now();
    this.sessions.set(sessionId, entry);
    return this.record(sessionId, candidates);
  }

  /** Whether this replica holds the seed the session was minted with. */
  isSeeded(sessionId: string): boolean {
    return this.sessions.get(sessionId)?.seeded === true;
  }

  has(sessionId: string, candidate: RecipientCandidate): boolean {
    const entry = this.sessions.get(sessionId);
    if (!entry) return false;
    return entry.all === true || entry.values.has(`${candidate.kind}:${candidate.value}`);
  }

  /** The subset of `candidates` this session first saw inside untrusted content. */
  firstSeenInUntrusted(sessionId: string, candidates: readonly RecipientCandidate[]): RecipientCandidate[] {
    return candidates.filter((c) => this.has(sessionId, c));
  }

  size(sessionId: string): number {
    return this.sessions.get(sessionId)?.values.size ?? 0;
  }

  clear(sessionId: string): void {
    this.sessions.delete(sessionId);
  }

  private sweep(): void {
    const cutoff = this.now() - this.ttlMs;
    for (const [id, entry] of this.sessions) if (entry.touchedAt < cutoff) this.sessions.delete(id);
  }
}
