/**
 * Per-subscription membership checks (docs/ARCHITECTURE.md §12): `ev:<businessId>` needs a membership of that
 * business (not archived); `u:<userId>` is the person's own channel, open to that signed-in user only (no database
 * lookup, no section walls: it carries content-free LIVE signals); `ae:<userId>` is the person's own account events,
 * open to that signed-in account only by the same comparison (no membership of any business opens it: a cofounder in
 * the same project is another account), and the server then delivers only entries that are that person's own account
 * events (walls.ts `viewAccountEvent`); `as:<sessionId>` needs a membership of the business the session belongs to and read access
 * to every section the session's work belongs to (`sessionSections`: Development plus its department's modules, the
 * same wall as dev.sessions.* in apps/api). An allowed decision carries the business and the membership: the server
 * filters business events through the membership's section walls (walls.ts). The service role reaches the database
 * only through repositories (`repos.memberships`, `repos.agents`), never raw queries.
 *
 * Decisions are cached per (user, channel) for a short time so a Live sessions screen with 16 tiles does not issue 16
 * identical membership queries per tab; a denial is cached for less time than an allowance so a newly added member
 * is let in quickly, and `invalidate(userId)` drops a person's decisions at once when their membership changes. A
 * database failure denies with `unavailable` (fail closed) and is not cached.
 */
import { repos, type Db } from "@foundmill/db";
import { hasSectionAccess, NotFoundError, sessionSections, type SectionMembership } from "@foundmill/shared";
import { parseChannel, type StreamErrorCode } from "./protocol";

export type AuthorizationResult =
  | {
      ok: true;
      /** The business the channel belongs to. */
      businessId?: string;
      /** The reader's membership of it: business events are filtered through its section walls. */
      membership?: SectionMembership;
    }
  | { ok: false; code: StreamErrorCode; message: string };

export interface Authorizer {
  canSubscribe(userId: string, channel: string): Promise<AuthorizationResult>;
  /** Forget cached decisions for one person (their membership changed) or for everyone. */
  invalidate?(userId?: string): void;
}

const deny = (code: StreamErrorCode, message: string): AuthorizationResult => ({ ok: false, code, message });
const allow = (businessId: string, membership: SectionMembership): AuthorizationResult => ({ ok: true, businessId, membership: { role: membership.role, sectionPermissions: membership.sectionPermissions } });

/** The sections of a session the membership may not read (empty: it may watch the session). */
const walledFrom = (membership: SectionMembership, moduleKeys: readonly string[]) => sessionSections(moduleKeys).filter((section) => !hasSectionAccess(membership, section, "read"));

const sessionWalled = (walled: readonly string[]) => deny("forbidden", `this session's work belongs to ${walled.join(" and ")}, which you cannot read`);

export interface RepoAuthorizerOptions {
  log?: { warn(o: unknown, m?: string): void };
  /** How long a session's business and modules are remembered (default 5 minutes; they rarely change). */
  sessionScopeTtlMs?: number;
  now?: () => number;
}

/**
 * `u:<userId>` and `ae:<userId>`: a person reads only their own signals and their own account events. User ids are
 * compared case-insensitively (they are uuids). Nothing else is consulted: no membership, role or section opens them.
 */
const ownChannel = (userId: string, channelUserId: string): AuthorizationResult =>
  userId.toLowerCase() === channelUserId.toLowerCase() ? { ok: true } : deny("forbidden", "this is another person's channel");
const personal = (kind: string): boolean => kind === "user" || kind === "account";

/** Repo-backed authorizer used in production. */
export function createRepoAuthorizer(db: Db, opts: RepoAuthorizerOptions = {}): Authorizer {
  const now = opts.now ?? (() => Date.now());
  const scopeTtl = opts.sessionScopeTtlMs ?? 5 * 60_000;
  /**
   * Session → its business and the modules its work is filed under. Remembered so a re-check (every live tile, every
   * 30 s) costs one membership query instead of a walk through the person's businesses.
   */
  const scopes = new Map<string, { until: number; businessId: string; moduleKeys: string[] }>();

  /** Finds the session through the person's own memberships (sessions are only addressable through their business). */
  async function findScope(userId: string, sessionId: string) {
    const hit = scopes.get(sessionId);
    if (hit && hit.until > now()) return hit;
    for (const m of await repos.memberships.listForUser(db, userId)) {
      let session;
      try {
        session = await repos.agents.getSession(db, m.businessId, sessionId);
      } catch (err) {
        if (err instanceof NotFoundError) continue;
        throw err;
      }
      const scope = { until: now() + scopeTtl, businessId: m.businessId, moduleKeys: await repos.agents.sessionModuleKeys(db, m.businessId, session) };
      if (scopes.size >= 10_000) scopes.delete(scopes.keys().next().value as string);
      scopes.set(sessionId, scope);
      return scope;
    }
    return null;
  }

  return {
    invalidate(userId) {
      // A person's access changed, not where a session's work belongs; only a full reset forgets the sessions.
      if (!userId) scopes.clear();
    },
    async canSubscribe(userId, channel) {
      const parsed = parseChannel(channel);
      if (!parsed) return deny("invalid_channel", `unknown channel "${channel}"`);
      if (personal(parsed.kind)) return ownChannel(userId, parsed.id);
      try {
        const scope = parsed.kind === "business" ? { businessId: parsed.id, moduleKeys: null } : await findScope(userId, parsed.id);
        if (!scope) return deny("forbidden", "session is not in one of your businesses");
        const { membership, business } = await repos.memberships.access(db, scope.businessId, userId);
        if (!membership) return deny("forbidden", parsed.kind === "business" ? "not a member of this business" : "session is not in one of your businesses");
        if (!business) return deny("forbidden", "this business is archived");
        // Session: the same walls as dev.sessions.* (Development plus the modules of the session's department).
        const walled = scope.moduleKeys ? walledFrom(membership, scope.moduleKeys) : [];
        if (walled.length > 0) return sessionWalled(walled);
        return allow(scope.businessId, membership);
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
  /** Bumped by `invalidate`: a check that started before it must not refill the cache with a stale answer. */
  let generation = 0;

  return {
    get size() {
      return cache.size;
    },
    invalidate(userId) {
      generation += 1;
      inner.invalidate?.(userId);
      if (!userId) {
        cache.clear();
        inflight.clear();
        return;
      }
      const prefix = `${userId.toLowerCase()}|`;
      for (const key of cache.keys()) if (key.startsWith(prefix)) cache.delete(key);
      for (const key of inflight.keys()) if (key.startsWith(prefix)) inflight.delete(key);
    },
    async canSubscribe(userId, channel) {
      const key = `${userId.toLowerCase()}|${channel}`;
      const hit = cache.get(key);
      if (hit && hit.until > now()) return hit.result;
      const pending = inflight.get(key);
      if (pending) return pending;
      const startedAt = generation;
      const p = inner
        .canSubscribe(userId, channel)
        .then((result) => {
          if (startedAt === generation && (result.ok || result.code !== "unavailable")) {
            if (cache.size >= maxEntries) cache.delete(cache.keys().next().value as string);
            cache.set(key, { until: now() + (result.ok ? allowTtl : denyTtl), result });
          }
          return result;
        })
        .finally(() => {
          if (inflight.get(key) === p) inflight.delete(key);
        });
      inflight.set(key, p);
      return p;
    },
  };
}

/**
 * In-memory authorizer for tests and the mock golden path: a map of userId → business ids, plus session → business.
 * `access` sets a member's role and section permissions per business (an owner when absent); `sessionModules` files a
 * session's work under modules, like a department does.
 */
export function createMemoryAuthorizer(input: {
  members: Record<string, readonly string[]>;
  sessions?: Record<string, string>;
  access?: Record<string, Record<string, SectionMembership>>;
  sessionModules?: Record<string, readonly string[]>;
}): Authorizer {
  const membershipOf = (userId: string, businessId: string): SectionMembership => input.access?.[userId]?.[businessId] ?? { role: "owner", sectionPermissions: {} };
  return {
    async canSubscribe(userId, channel) {
      const parsed = parseChannel(channel);
      if (!parsed) return deny("invalid_channel", `unknown channel "${channel}"`);
      if (personal(parsed.kind)) return ownChannel(userId, parsed.id);
      const businesses = input.members[userId] ?? [];
      if (parsed.kind === "business") return businesses.includes(parsed.id) ? allow(parsed.id, membershipOf(userId, parsed.id)) : deny("forbidden", "not a member of this business");
      const businessId = input.sessions?.[parsed.id];
      if (!businessId || !businesses.includes(businessId)) return deny("forbidden", "session is not in one of your businesses");
      const membership = membershipOf(userId, businessId);
      const walled = walledFrom(membership, input.sessionModules?.[parsed.id] ?? []);
      return walled.length > 0 ? sessionWalled(walled) : allow(businessId, membership);
    },
  };
}
