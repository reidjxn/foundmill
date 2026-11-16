/**
 * Agent / club state enforcement (SECURITY_REVIEW SEC-1).
 *
 * A session token lives up to 12 h; the kill switch (`business.stopAllAgents`), a key revoke (`keys.revoke`),
 * a release (`team.agents.release`) and a club archive only change rows in the database. The gateway therefore
 * re-reads that state on every call and refuses before Cedar is consulted, so no permit can out-vote it:
 *
 *   business.archivedAt set        → deny `business-archived`
 *   business.agentsStoppedAt set   → deny `agents-stopped`     (Stop all agents, key revoked, credits used up: 0023)
 *   agent.archivedAt set           → deny `agent-archived`     (released)
 *   agent.status === "paused"      → deny `agent-paused`       (manual pause, wage cap)
 *   BYOK club, key-bearing tool,
 *   no live Anthropic credential   → deny `key-revoked`
 *
 * The business's stop flag is read, not only the agents' pause, because an agent can be idle while the team is stopped
 * (hired, or set idle by a path that missed the stop) and the plan executor calls tools as the acting agent.
 *
 * The agent and business rows are loaded for the Cedar request anyway, so the first four checks cost nothing
 * and take effect on the very next call. The credential check needs two more queries, so its verdict is cached
 * per session for at most `STATE_CACHE_TTL_MS` (DECISIONS "Policy hot-path test budgets": treat a tool call as
 * a 1–20 ms budget and never add queries to the hot path without a cache).
 */
import { repos, type Agent, type Business, type Db } from "@foundmill/db";

export const AGENT_PAUSED_POLICY_ID = "agent-paused";
export const AGENTS_STOPPED_POLICY_ID = "agents-stopped";
export const AGENT_ARCHIVED_POLICY_ID = "agent-archived";
export const BUSINESS_ARCHIVED_POLICY_ID = "business-archived";
export const KEY_REVOKED_POLICY_ID = "key-revoked";

export type StatePolicyId = typeof AGENT_PAUSED_POLICY_ID | typeof AGENTS_STOPPED_POLICY_ID | typeof AGENT_ARCHIVED_POLICY_ID | typeof BUSINESS_ARCHIVED_POLICY_ID | typeof KEY_REVOKED_POLICY_ID;

/** Error codes used by `POST /v1/session-tokens` when it refuses to mint for the same reasons. */
export const STATE_ERROR_CODES: Readonly<Record<StatePolicyId, string>> = {
  [AGENT_PAUSED_POLICY_ID]: "agent_paused",
  [AGENTS_STOPPED_POLICY_ID]: "agents_stopped",
  [AGENT_ARCHIVED_POLICY_ID]: "agent_archived",
  [BUSINESS_ARCHIVED_POLICY_ID]: "business_archived",
  [KEY_REVOKED_POLICY_ID]: "key_revoked",
};

/** The connector whose tools run on the club's own Anthropic key when `modelBilling` is `byok` (BUILD §10.2). */
export const ANTHROPIC_CONNECTOR_KEY = "anthropic";
/**
 * The built-in quarantined reader: its model call runs on the club's own key too when `modelBilling` is `byok`, as does
 * the pipeline's digest (builtins.ts `readerClientFor`). Web search is not listed: it runs on the platform key and is
 * charged to credits for every business (WP-09 T3).
 */
export const QUARANTINE_CONNECTOR_KEY = "quarantine";
/** Gateway-owned, like `FINANCE_CONNECTORS`: connectors that need the club's BYOK key, never a connector hint. */
export const BYOK_KEY_CONNECTORS: ReadonlySet<string> = new Set([ANTHROPIC_CONNECTOR_KEY, QUARANTINE_CONNECTOR_KEY]);

/** How long a per-session credential verdict may be reused. A revoked key is refused within this window. */
export const STATE_CACHE_TTL_MS = 5_000;

export interface StateDenial {
  policyId: StatePolicyId;
  reasons: string[];
}

const STOP_WORDS: Record<NonNullable<Business["agentsStoppedReason"]>, string> = {
  kill_switch: "Stop all agents",
  key_revoked: "the Anthropic key was revoked",
  credits_exhausted: "the credits ran out",
};

/** Pure: the denial the loaded rows imply, or null when the agent may work. Order: club (archived, stopped), then release, then pause. */
export function stateDenial(business: Pick<Business, "archivedAt" | "agentsStoppedAt" | "agentsStoppedReason">, agent: Pick<Agent, "status" | "archivedAt" | "name">): StateDenial | null {
  if (business.archivedAt) {
    return { policyId: BUSINESS_ARCHIVED_POLICY_ID, reasons: ["This business is archived; its team cannot call tools"] };
  }
  if (business.agentsStoppedAt) {
    return { policyId: AGENTS_STOPPED_POLICY_ID, reasons: [`Agents are stopped for this business (${STOP_WORDS[business.agentsStoppedReason ?? "kill_switch"]}); tool calls are refused until an owner or admin resumes them`] };
  }
  if (agent.archivedAt) {
    return { policyId: AGENT_ARCHIVED_POLICY_ID, reasons: [`${agent.name} has been released from the team; tool calls are refused`] };
  }
  if (agent.status === "paused") {
    return { policyId: AGENT_PAUSED_POLICY_ID, reasons: [`${agent.name} is paused (Stop all agents, key revoked, wage cap or paused by the founder); tool calls are refused until the agent is resumed`] };
  }
  return null;
}

/** True when this call can only run on the club's own Anthropic key. */
export function toolNeedsByokKey(business: Pick<Business, "modelBilling">, connectorKey: string): boolean {
  return business.modelBilling === "byok" && BYOK_KEY_CONNECTORS.has(connectorKey);
}

/**
 * Does the club hold a live Anthropic credential? `keys.revoke` (apps/api) archives every credential of the
 * `anthropic` integration and disconnects it, so "no non-archived credential row" is the revoked state.
 */
export async function byokKeyPresent(db: Db, businessId: string): Promise<boolean> {
  const integration = await repos.integrations.getByKey(db, businessId, ANTHROPIC_CONNECTOR_KEY);
  if (!integration || integration.archivedAt) return false;
  const live = await repos.credentials.listMetadata(db, businessId, { integrationId: integration.id });
  return live.length > 0;
}

export const keyRevokedDenial = (): StateDenial => ({
  policyId: KEY_REVOKED_POLICY_ID,
  reasons: ["This business runs on its own Anthropic key and no live key is stored (revoked or never set); set a key in Settings → Keys to resume"],
});

interface CacheEntry {
  value: boolean;
  expiresAt: number;
}

/**
 * Per-session memo of the BYOK credential verdict. Keyed by `businessId:sessionId`, bounded, time-based on the
 * caller's clock (`deps.now`) so tests can advance it. Never caches anything but a boolean.
 */
export class SessionStateCache {
  private readonly entries = new Map<string, CacheEntry>();

  constructor(
    readonly ttlMs: number = STATE_CACHE_TTL_MS,
    private readonly maxEntries = 10_000,
  ) {
    if (!(ttlMs >= 0 && ttlMs <= STATE_CACHE_TTL_MS)) throw new RangeError(`state cache ttl must be between 0 and ${STATE_CACHE_TTL_MS} ms`);
  }

  static key(businessId: string, sessionId: string): string {
    return `${businessId}:${sessionId}`;
  }

  get(key: string, nowMs: number): boolean | undefined {
    const entry = this.entries.get(key);
    if (!entry) return undefined;
    if (entry.expiresAt <= nowMs) {
      this.entries.delete(key);
      return undefined;
    }
    return entry.value;
  }

  set(key: string, value: boolean, nowMs: number): void {
    if (this.ttlMs === 0) return;
    if (this.entries.size >= this.maxEntries) this.sweep(nowMs);
    this.entries.set(key, { value, expiresAt: nowMs + this.ttlMs });
  }

  /** Forgets one session (or everything): the next call re-reads the database. */
  invalidate(key?: string): void {
    if (key === undefined) this.entries.clear();
    else this.entries.delete(key);
  }

  get size(): number {
    return this.entries.size;
  }

  private sweep(nowMs: number): void {
    for (const [k, e] of this.entries) if (e.expiresAt <= nowMs) this.entries.delete(k);
    // Still full after dropping the expired entries: drop the oldest insertions rather than grow without bound.
    if (this.entries.size >= this.maxEntries) {
      const drop = Math.ceil(this.maxEntries / 10);
      let i = 0;
      for (const k of this.entries.keys()) {
        if (i++ >= drop) break;
        this.entries.delete(k);
      }
    }
  }
}

/** The cached-or-fresh verdict for a session; `null` when the tool does not need the club's key. */
export async function checkByokKey(
  db: Db,
  cache: SessionStateCache,
  input: { businessId: string; sessionId: string; business: Pick<Business, "modelBilling">; connectorKey: string },
  nowMs: number,
): Promise<StateDenial | null> {
  if (!toolNeedsByokKey(input.business, input.connectorKey)) return null;
  const key = SessionStateCache.key(input.businessId, input.sessionId);
  let present = cache.get(key, nowMs);
  if (present === undefined) {
    present = await byokKeyPresent(db, input.businessId);
    cache.set(key, present, nowMs);
  }
  return present ? null : keyRevokedDenial();
}
