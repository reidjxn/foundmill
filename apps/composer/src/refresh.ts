/**
 * Refresh (BUILD §11.3 "Refresh (button, R): always exactly one new message", §10.4):
 *
 *   priority (1) highest-priority un-narrated event → (2) data-change insight from thresholds → (3) next-best decision
 *   grounded in current state; served from `composer_buffer` (pre-written candidates), invalidated when the inputs
 *   behind a candidate change, refilled asynchronously after every serve, debounced per business, cost metered.
 *
 * Buffer rows are keyed by a slot key stored in `composer_buffer.source_hash` (unique per business):
 *   `event:<eventId>`                      valid while that event is still un-narrated
 *   `insight:<kind>:<hash of its facts>`   valid while the snapshot still produces that exact insight
 *   `decision:<kind>:<hash of facts+n>`    valid while the state still produces that decision (n rotates per serve)
 * so consuming the event candidate never invalidates the insight and decision candidates behind it, and the next
 * refresh is warm (AC-11.3.7) while the refill writes the next event candidate in the background.
 *
 * A decision the founder has not answered is never written twice (audit CML-02): its kind and facts are stored on the
 * note (`decision.key`), the plan leaves out any grounded decision that is already open, and when everything the state
 * calls for is open and nothing else is new, Refresh answers with that open decision instead of another copy of it.
 *
 * A served slot key stays served: its row keeps `consumed_at` (a note written on demand is recorded the same way), the
 * plan leaves out an insight whose key was served and moves the decision on to a variant not yet served. An insight
 * that holds for weeks is therefore one note, not one per press (audit CML-01), and Refresh falls through to the
 * decision; the insight comes back only when its facts change (a new key).
 */
import { LIMITS } from "@foundmill/config";
import { repos, type ComposerBufferRow, type ComposerItem, type Db, type InboxItem } from "@foundmill/db";
import { stableHash, type ModelClient, type ModelLogger } from "@foundmill/models";
import { composeNote, type ComposeBrief, type ComposedNote, type ComposeSlot } from "./compose";
import { loadContext, type ComposeContext } from "./context";
import { nextBestDecision, type NextBestDecision } from "./decisions";
import { computeInsights, DEFAULT_INSIGHT_THRESHOLDS, type InsightThresholds } from "./insights";
import { persistDrafts, persistNote } from "./persist";

export interface RefreshEngineOptions {
  debounceMs?: number;
  bufferSize?: number;
  insightThresholds?: InsightThresholds;
  /** Create unverified CRM entities for sweep drafts (default true). */
  persistDrafts?: boolean;
  /** Longest one note may take before it is abandoned unwritten (default `LIMITS.composerDeadlineMs`). */
  composeDeadlineMs?: number;
  now?: () => Date;
}

export interface RefreshResult {
  item: InboxItem;
  /** Which Refresh rule produced the note. */
  slot: ComposeSlot;
  /**
   * `buffer` = pre-written candidate (warm path); `generated` = written on demand (cold path); `open` = nothing new and
   * every decision the state calls for is still waiting for the founder, so that decision is returned and none written.
   */
  source: "buffer" | "generated" | "open";
  /** True when this call fell inside the debounce window and returned the item of the previous call. */
  debounced: boolean;
  costMinor: number;
  buffer: { remaining: number; refilling: boolean };
  durationMs: number;
}

interface Slot {
  key: string;
  priority: number;
  brief: ComposeBrief;
}

interface Plan {
  slots: Slot[];
  keys: Set<string>;
  /** The decision variant the plan's decision slot was written for. */
  decisionVariant: number;
  /** The decision the founder still has open when the state calls for nothing else (the plan then has no decision slot). */
  open: InboxItem | null;
}

/** How many decision variants past the current one the plan looks at for one not yet served. */
const DECISION_LOOKAHEAD = 8;

interface Pending {
  at: number;
  result: RefreshResult;
}

export interface RefreshDeps {
  db: Db;
  models: ModelClient;
  log: ModelLogger;
}

export class RefreshEngine {
  private readonly debounceMs: number;
  private readonly bufferSize: number;
  private readonly thresholds: InsightThresholds;
  private readonly draftsOn: boolean;
  private readonly deadlineMs: number;
  private readonly now: () => Date;
  private readonly recent = new Map<string, Pending>();
  private readonly inflight = new Map<string, Promise<RefreshResult>>();
  private readonly refills = new Map<string, Promise<void>>();
  private readonly refillAgain = new Set<string>();
  /** Metered cost of each pre-written candidate (buffer row id → minor units); the ledger row was written at pre-write time. */
  private readonly costs = new Map<string, { costMinorInt: number; currency: string }>();
  private readonly decisionVariant = new Map<string, number>();

  constructor(
    private readonly deps: RefreshDeps,
    options: RefreshEngineOptions = {},
  ) {
    this.debounceMs = options.debounceMs ?? LIMITS.inboxRefreshDebounceMs;
    this.bufferSize = options.bufferSize ?? LIMITS.inboxBufferSize;
    this.thresholds = options.insightThresholds ?? DEFAULT_INSIGHT_THRESHOLDS;
    this.draftsOn = options.persistDrafts ?? true;
    this.deadlineMs = options.composeDeadlineMs ?? LIMITS.composerDeadlineMs;
    this.now = options.now ?? (() => new Date());
  }

  /** Exactly one new item (AC-11.3.2). */
  refresh(businessId: string): Promise<RefreshResult> {
    const pending = this.recent.get(businessId);
    if (pending && this.now().getTime() - pending.at < this.debounceMs) {
      return Promise.resolve({ ...pending.result, debounced: true, durationMs: 0 });
    }
    const running = this.inflight.get(businessId);
    if (running) return running.then((r) => ({ ...r, debounced: true }));
    const p = this.run(businessId).finally(() => this.inflight.delete(businessId));
    this.inflight.set(businessId, p);
    return p;
  }

  /** Pre-writes candidates until the buffer holds `bufferSize` valid ones; returns how many were written. */
  async warm(businessId: string): Promise<number> {
    const ctx = await loadContext(this.deps.db, businessId, { now: this.now() });
    const plan = await this.plan(ctx);
    const rows = await this.reconcile(businessId, plan);
    return this.fill(businessId, ctx, plan, rows.map((r) => r.sourceHash));
  }

  /** Waits for background refills (tests, graceful shutdown). */
  async drain(businessId?: string): Promise<void> {
    const keys = businessId ? [businessId] : [...this.refills.keys()];
    for (const k of keys) {
      // A refill scheduled while one was running re-runs once it finishes; loop until quiet.
      let p = this.refills.get(k);
      while (p) {
        await p.catch(() => undefined);
        p = this.refills.get(k) !== p ? this.refills.get(k) : undefined;
      }
    }
  }

  isRefilling(businessId: string): boolean {
    return this.refills.has(businessId);
  }

  /** Forgets the debounce window for a business (tests). */
  resetDebounce(businessId?: string): void {
    if (businessId) this.recent.delete(businessId);
    else this.recent.clear();
  }

  // --- the Refresh pipeline ----------------------------------------------------------------------------------------

  private async run(businessId: string): Promise<RefreshResult> {
    const started = Date.now();
    const ctx = await loadContext(this.deps.db, businessId, { now: this.now() });
    const plan = await this.plan(ctx);
    const rows = await this.reconcile(businessId, plan);

    const top = plan.slots[0];
    if (!top) {
      // Nothing new, and every decision the state calls for is already on the founder's desk: point at it.
      const open = plan.open;
      if (!open) throw new Error("Refresh has nothing to write and no open decision to return");
      const result: RefreshResult = { item: open, slot: "decision", source: "open", debounced: false, costMinor: 0, buffer: { remaining: 0, refilling: false }, durationMs: Date.now() - started };
      this.recent.set(businessId, { at: this.now().getTime(), result });
      return result;
    }

    let composed: ComposedNote | null = null;
    let source: RefreshResult["source"] = "buffer";
    let candidate: { item: ComposerItem; slot: ComposeSlot; eventIds: string[]; costMinorInt: number; currency: string };

    // Rule 1 beats the buffer: when the top candidate is an un-narrated event and no event candidate is pre-written
    // (the event arrived after the last refill), write it now rather than serving a lower-priority buffered note.
    const bufferedEvent = rows.some((r) => r.sourceHash.startsWith("event:"));
    const useBuffer = rows.length > 0 && (top.brief.mode !== "events" || bufferedEvent);
    const row = useBuffer ? await repos.inbox.bufferConsume(this.deps.db, businessId) : null;
    if (row) {
      const cost = this.costs.get(row.id) ?? { costMinorInt: 0, currency: "USD" };
      this.costs.delete(row.id);
      const item = row.candidate as unknown as ComposerItem;
      candidate = { item, slot: slotKind(row.sourceHash), eventIds: [...(item.source_event_ids ?? [])], costMinorInt: cost.costMinorInt, currency: cost.currency };
    } else {
      source = "generated";
      // Cold path (empty buffer, or a new event): one Opus call the caller waits on, bounded by the compose deadline,
      // which sits below the api's wait, so the founder hears either the note or why there is none (audit CML-04).
      composed = await composeNote(this.deps, ctx, top.brief, { onInvalidLinks: "strip", deadlineMs: this.deadlineMs });
      candidate = { item: composed.item, slot: composed.slot, eventIds: composed.eventIds, costMinorInt: composed.costMinorInt, currency: composed.costCurrency };
    }

    const persisted = await persistNote(this.deps.db, this.deps.log, {
      businessId,
      item: candidate.item,
      eventIds: candidate.eventIds,
      costMinorInt: candidate.costMinorInt,
      costCurrency: candidate.currency,
      slot: candidate.slot,
    });
    // A note written on demand is served under its slot key too, so the refill does not write (and pay for) it again.
    if (!row) await repos.inbox.bufferMarkServed(this.deps.db, businessId, { candidate: candidate.item, sourceHash: top.key, priority: top.priority });
    if (composed && this.draftsOn && composed.drafts.length) await persistDrafts(this.deps.db, this.deps.log, businessId, composed.drafts, persisted.item.id, persisted.item.bodyMd);
    if (candidate.slot === "decision") this.decisionVariant.set(businessId, plan.decisionVariant + 1);

    const remaining = Math.max(0, rows.length - (row ? 1 : 0));
    const result: RefreshResult = {
      item: persisted.item,
      slot: candidate.slot,
      source,
      debounced: false,
      costMinor: candidate.costMinorInt,
      buffer: { remaining, refilling: true },
      durationMs: Date.now() - started,
    };
    this.recent.set(businessId, { at: this.now().getTime(), result });
    this.scheduleRefill(businessId);
    return result;
  }

  /**
   * The candidate plan in priority order: un-narrated events, insights not yet served, the next-best decision (the
   * first variant from the current one that was not served yet, so the decision slot is always there and always new).
   */
  private async plan(ctx: ComposeContext): Promise<Plan> {
    const insights = computeInsights(ctx.metrics, this.thresholds);
    const start = this.decisionVariant.get(ctx.businessId) ?? 0;
    const decisions = Array.from({ length: DECISION_LOOKAHEAD }, (_, i) => nextBestDecision(ctx.metrics, start + i));
    const served = await repos.inbox.bufferServed(this.deps.db, ctx.businessId, [...insights.map((i) => i.key), ...decisions.map((d) => d.key)]);
    // A decision the founder has not answered yet is not offered again (audit CML-02).
    const open = await this.openDecisions(ctx.businessId);
    const wanted = decisions.filter((d) => !open.has(d.identity));

    let decision: NextBestDecision | null = null;
    let decisionVariant = start;
    if (wanted.length > 0) {
      const fresh = decisions.findIndex((d) => !open.has(d.identity) && !served.has(d.key));
      if (fresh === -1) {
        // Every wanted variant was served before: move on to one that was not (a kind that is open is skipped).
        decisionVariant = start + DECISION_LOOKAHEAD;
        decision = nextBestDecision(ctx.metrics, decisionVariant);
        while (open.has(decision.identity)) decision = nextBestDecision(ctx.metrics, ++decisionVariant);
      } else {
        decisionVariant = start + fresh;
        decision = decisions[fresh]!;
      }
      if (decisionVariant !== start) this.decisionVariant.set(ctx.businessId, decisionVariant);
    }

    const slots: Slot[] = [];
    // Wins the volume rule rolled up (`fullMatchDay: false`) are not narrated one by one: each day's become one round-up note.
    const { single, roundups } = splitRoundups(ctx.unnarrated);
    single.forEach((e, i) => slots.push({ key: `event:${e.id}`, priority: 300 - i, brief: { mode: "events", events: [e] } }));
    roundups.forEach((events, i) => slots.push({ key: `event:roundup:${stableHash(events.map((e) => e.id))}`, priority: 250 - i, brief: { mode: "events", events } }));
    for (const insight of insights) if (!served.has(insight.key)) slots.push({ key: insight.key, priority: 200 - insight.rank, brief: { mode: "insight", insight } });
    if (decision) slots.push({ key: decision.key, priority: 100, brief: { mode: "decision", decision } });
    const pressing = decisions.map((d) => open.get(d.identity)).find((i) => i !== undefined) ?? null;
    return { slots, keys: new Set(slots.map((s) => s.key)), decisionVariant, open: decision ? null : pressing };
  }

  /** The decisions still waiting for the founder, by what they are about (`decision.key`, see `NextBestDecision.identity`). */
  private async openDecisions(businessId: string): Promise<Map<string, InboxItem>> {
    const page = await repos.inbox.list(this.deps.db, businessId, { type: "decision", state: ["unread", "read"], limit: 100 });
    const open = new Map<string, InboxItem>();
    for (const item of page.items) {
      const key = (item.decision as { key?: unknown } | null)?.key;
      if (typeof key === "string" && !open.has(key)) open.set(key, item);
    }
    return open;
  }

  /**
   * Drops buffer candidates whose inputs changed (not in the current plan). The repo invalidates per business, so the
   * still-valid rows are pushed back (same slot key → same row, re-validated). Returns the valid rows, highest priority first.
   */
  private async reconcile(businessId: string, plan: Plan): Promise<ComposerBufferRow[]> {
    const rows = await repos.inbox.bufferList(this.deps.db, businessId);
    const valid = rows.filter((r) => plan.keys.has(r.sourceHash));
    if (valid.length === rows.length) return rows;
    const dropped = rows.filter((r) => !plan.keys.has(r.sourceHash));
    this.deps.log.debug({ businessId, dropped: dropped.map((r) => r.sourceHash) }, "buffer candidates invalidated (source changed)");
    await repos.inbox.bufferInvalidate(this.deps.db, businessId);
    for (const r of dropped) this.costs.delete(r.id);
    const kept: ComposerBufferRow[] = [];
    for (const r of valid) kept.push(await repos.inbox.bufferPush(this.deps.db, businessId, { candidate: r.candidate as unknown as ComposerItem, sourceHash: r.sourceHash, priority: r.priority }));
    return kept.sort((a, b) => b.priority - a.priority);
  }

  private scheduleRefill(businessId: string): void {
    if (this.refills.has(businessId)) {
      this.refillAgain.add(businessId);
      return;
    }
    const p = this.refill(businessId)
      .catch((err: Error) => this.deps.log.warn({ err: err.message, businessId }, "buffer refill failed"))
      .finally(() => {
        this.refills.delete(businessId);
        if (this.refillAgain.delete(businessId)) this.scheduleRefill(businessId);
      });
    this.refills.set(businessId, p);
  }

  private async refill(businessId: string): Promise<void> {
    const ctx = await loadContext(this.deps.db, businessId, { now: this.now() });
    const plan = await this.plan(ctx);
    const rows = await this.reconcile(businessId, plan);
    await this.fill(businessId, ctx, plan, rows.map((r) => r.sourceHash));
  }

  private async fill(businessId: string, ctx: ComposeContext, plan: Plan, present: string[]): Promise<number> {
    const have = new Set(present);
    let written = 0;
    for (const slot of plan.slots) {
      if (have.size >= this.bufferSize) break;
      if (have.has(slot.key)) continue;
      const composed = await composeNote(this.deps, ctx, slot.brief, { onInvalidLinks: "strip", deadlineMs: this.deadlineMs });
      const row = await repos.inbox.bufferPush(this.deps.db, businessId, { candidate: composed.item, sourceHash: slot.key, priority: slot.priority });
      // Served while this candidate was being written (a Refresh wrote it on demand): it stays served, not a candidate.
      if (row.consumedAt) continue;
      this.costs.set(row.id, { costMinorInt: composed.costMinorInt, currency: composed.costCurrency });
      have.add(slot.key);
      written += 1;
    }
    return written;
  }
}

/** The most wins one round-up note covers. */
const ROUNDUP_MAX_EVENTS = 50;

/**
 * Separates the un-narrated events into the ones narrated singly and the daily round-ups (BUILD §11.4 volume rules): a
 * `customer.converted` the rule rolled up (`fullMatchDay: false`) joins the round-up of its UTC day, oldest day first.
 * Events stay in the order given within a group.
 */
export function splitRoundups<E extends { id: string; type: string; occurredAt: Date; payload: unknown }>(events: readonly E[]): { single: E[]; roundups: E[][] } {
  const single: E[] = [];
  const byDay = new Map<string, E[]>();
  for (const e of events) {
    const rolled = e.type === "customer.converted" && (e.payload as { fullMatchDay?: unknown } | null)?.fullMatchDay === false;
    if (!rolled) {
      single.push(e);
      continue;
    }
    const day = e.occurredAt.toISOString().slice(0, 10);
    byDay.set(day, [...(byDay.get(day) ?? []), e]);
  }
  const roundups = [...byDay.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([, list]) => list.slice(0, ROUNDUP_MAX_EVENTS));
  return { single, roundups };
}

export function slotKind(key: string): ComposeSlot {
  if (key.startsWith("event:")) return "events";
  if (key.startsWith("insight:")) return "insight";
  return "decision";
}
