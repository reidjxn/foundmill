/**
 * Per-subscription membership checks (docs/ARCHITECTURE.md §12): `ev:<businessId>` needs a membership of that
 * business; `as:<sessionId>` needs a membership of the business the session belongs to. The service role reaches
 * the database only through repositories (`repos.memberships`, `repos.agents`), never raw queries.
 *
 * Decisions are cached per (user, channel) for a short time so a Training Ground with 16 tiles does not issue 16
 * identical membership queries per tab; a denial is cached for less time than an allowance so a newly added member
 * is let in quickly. A database failure denies with `unavailable` (fail closed) and is not cached.
 */
import { repos, type Db } from "@foundmill/db";
import { NotFoundError } from "@foundmill/shared";
import { parseChannel, type StreamErrorCode } from "./protocol";

export type AuthorizationResult = { ok: true } | { ok: false; code: StreamErrorCode; message: string };

export interface Authorizer {
  canSubscribe(userId: string, channel: string): Promise<AuthorizationResult>;
}

const deny = (code: StreamErrorCode, message: string): AuthorizationResult => ({ ok: false, code, message });
const ALLOW: AuthorizationResult = { ok: true };

/** Repo-backed authorizer used in production. */
export function createRepoAuthorizer(db: Db, opts: { log?: { warn(o: unknown, m?: string): void } } = {}): Authorizer {
  return {
    async canSubscribe(userId, channel) {
      const parsed = parseChannel(channel);
      if (!parsed) return deny("invalid_channel", `unknown channel "${channel}"`);
      try {
        if (parsed.kind === "business") {
          const membership = await repos.memberships.get(db, parsed.id, userId);
          return membership ? ALLOW : deny("forbidden", "not a member of this business");
        }
        // Session: the user must be a member of the business the session belongs to. Sessions are only addressable
        // through their business, so walk the user's memberships (a handful per user) and look the session up in each.
        const memberships = await repos.memberships.listForUser(db, userId);
        for (const m of memberships) {
          try {
            await repos.agents.getSession(db, m.businessId, parsed.id);
            return ALLOW;
          } catch (err) {
            if (err instanceof NotFoundError) continue;
            throw err;
          }
        }
        return deny("forbidden", "session is not in one of your businesses");
      } catch (err) {
        opts.log?.warn({ err, channel }, "membership check failed");
        return deny("unavailable", "membership check unavailable");
      }
    },
  };
}

export interface CachedAuthorizerOptions {
  allowTtlMs?: number;
  denyTtlMs?: number;
  now?: () => number;
  maxEntries?: number;
}

/** Wraps an authorizer with a (user, channel) decision cache. `unavailable` is never cached. */
export function createCachedAuthorizer(inner: Authorizer, opts: CachedAuthorizerOptions = {}): Authorizer & { invalidate(userId?: string): void; size: number } {
  const allowTtl = opts.allowTtlMs ?? 30_000;
  const denyTtl = opts.denyTtlMs ?? 5_000;
  const now = opts.now ?? (() => Date.now());
  const maxEntries = opts.maxEntries ?? 10_000;
  const cache = new Map<string, { until: number; result: AuthorizationResult }>();
  const inflight = new Map<string, Promise<AuthorizationResult>>();

  return {
    get size() {
      return cache.size;
    },
    invalidate(userId) {
      if (!userId) return cache.clear();
      for (const key of cache.keys()) if (key.startsWith(`${userId}|`)) cache.delete(key);
    },
    async canSubscribe(userId, channel) {
      const key = `${userId}|${channel}`;
      const hit = cache.get(key);
      if (hit && hit.until > now()) return hit.result;
      const pending = inflight.get(key);
      if (pending) return pending;
      const p = inner
        .canSubscribe(userId, channel)
        .then((result) => {
          if (result.ok || result.code !== "unavailable") {
            if (cache.size >= maxEntries) cache.delete(cache.keys().next().value as string);
            cache.set(key, { until: now() + (result.ok ? allowTtl : denyTtl), result });
          }
          return result;
        })
        .finally(() => inflight.delete(key));
      inflight.set(key, p);
      return p;
    },
  };
}

/** In-memory authorizer for tests and the mock golden path: a map of userId → business ids, plus session → business. */
export function createMemoryAuthorizer(input: { members: Record<string, readonly string[]>; sessions?: Record<string, string> }): Authorizer {
  return {
    async canSubscribe(userId, channel) {
      const parsed = parseChannel(channel);
      if (!parsed) return deny("invalid_channel", `unknown channel "${channel}"`);
      const businesses = input.members[userId] ?? [];
      if (parsed.kind === "business") return businesses.includes(parsed.id) ? ALLOW : deny("forbidden", "not a member of this business");
      const businessId = input.sessions?.[parsed.id];
      return businessId && businesses.includes(businessId) ? ALLOW : deny("forbidden", "session is not in one of your businesses");
    },
  };
}
