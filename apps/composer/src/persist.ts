/**
 * Writes one composed note: `inbox_items` row (Composer shape validated again by the repo, every referenced id checked
 * against the business), source events marked narrated, `inbox.item_created` through the outbox and entity mentions —
 * all in one transaction (BUILD §2.1 rule 4). Sweep drafts become unverified CRM entities afterwards. With an
 * idempotency key (narrate) at most one note is written per key, even across composer instances.
 */
import { repos, sqlState, type ComposerItem, type Db, type Executor, type InboxItem } from "@foundmill/db";
import { buildEvent, type WriteEventInput } from "@foundmill/events";
import type { ModelLogger } from "@foundmill/models";
import type { EntityKind, EventType } from "@foundmill/shared";

/**
 * `@foundmill/events`' `writeEvent` inserts `outbox (event_id)` only while the schema's `outbox` carries a NOT NULL
 * `business_id`, so (as apps/api does) the payload is validated with the catalogue and the rows are written through
 * `repos.events.write`, which fills both tables (see openIssues in the composer report).
 */
export async function writeEventRow<T extends EventType>(tx: Executor, input: WriteEventInput<T>, idempotencyKey?: string): Promise<string> {
  const event = buildEvent(input);
  const row = await repos.events.write(tx, event.businessId, {
    id: event.id,
    type: event.type,
    actor: event.actor,
    entityIds: event.entityIds,
    payload: event.payload as Record<string, unknown>,
    occurredAt: event.occurredAt,
    idempotencyKey: idempotencyKey ?? null,
  });
  // The repo answers a known key with the earlier row: another writer committed first, so this one must roll back.
  if (idempotencyKey && row.id !== event.id) throw new AlreadyWrittenError(idempotencyKey);
  return row.id;
}

/** An event with this idempotency key was committed by another writer while this transaction ran. */
export class AlreadyWrittenError extends Error {
  constructor(readonly idempotencyKey: string) {
    super(`An event with idempotency key ${idempotencyKey} was already written`);
    this.name = "AlreadyWrittenError";
  }
}

export interface PersistInput {
  businessId: string;
  item: ComposerItem;
  eventIds: readonly string[];
  /** The events themselves, when the caller has them: a warning about a problem an open warning already covers revises that note. */
  events?: readonly { payload: unknown }[];
  now?: Date;
  costMinorInt: number;
  costCurrency: string;
  /** Extra detail on the `inbox.item_created` payload is not allowed by the catalogue; this goes to the log only. */
  slot: string;
  /**
   * At most one note per key (narrate passes `narrationKey(eventIds)`): it is stored on the note's `inbox.item_created`
   * event, and a note already written under it is returned (`replayed`) instead of a second one.
   */
  idempotencyKey?: string;
}

export interface Persisted {
  item: InboxItem;
  eventId: string;
  narrated: number;
  /** True when a note was already written under the idempotency key: that note is returned and nothing is written. */
  replayed: boolean;
  /** True when an open warning about the same problem was revised in place instead of a second note being written. */
  revised?: boolean;
}

/** How far back an open warning counts as the same problem's note. */
export const REVISE_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
/** How much of the earlier text a revised note keeps under the new one. */
const EARLIER_MAX = 700;

/** The task ids the events speak of (`taskId`, `blockedByTaskId`, `taskIds`): what makes two warnings the same problem. */
export function taskIdsOf(events: readonly { payload: unknown }[]): Set<string> {
  const ids = new Set<string>();
  for (const e of events) {
    const p = e.payload as { taskId?: unknown; blockedByTaskId?: unknown; taskIds?: unknown } | null;
    if (typeof p?.taskId === "string") ids.add(p.taskId);
    if (typeof p?.blockedByTaskId === "string") ids.add(p.blockedByTaskId);
    if (Array.isArray(p?.taskIds)) for (const id of p.taskIds) if (typeof id === "string") ids.add(id);
  }
  return ids;
}

/**
 * The open warning this note revises, or null: from the same agent, within the window, still unanswered, whose source
 * events speak of a task this note's events speak of too. One living item per problem (Nov 1, 2026: fifteen
 * "Engineering stalled" warnings in three days, the same message under different headlines), updated with a dated
 * status line instead of a new copy. An answered warning is not revised: what the founder decided stays on record, and
 * a problem that comes back after a decision is a new item.
 */
export async function findSameProblem(tx: Executor, businessId: string, item: ComposerItem, events: readonly { payload: unknown }[], now: Date): Promise<InboxItem | null> {
  if (item.type !== "warning" || !item.from_agent_id) return null;
  const tasks = taskIdsOf(events);
  if (tasks.size === 0) return null;
  const since = now.getTime() - REVISE_WINDOW_MS;
  const open = (await repos.inbox.list(tx, businessId, { type: "warning", state: ["unread", "read"], limit: 50 })).items.filter((n) => n.fromAgentId === item.from_agent_id && new Date(n.createdAt).getTime() >= since && n.sourceEventIds.length > 0);
  for (const candidate of open) {
    const theirs = taskIdsOf(await repos.events.byIds(tx, businessId, candidate.sourceEventIds));
    for (const id of tasks) if (theirs.has(id)) return candidate;
  }
  return null;
}

/** The revised body: the new text under a dated status line, the earlier text (shortened) under it. */
export function revisedBody(newBody: string, earlier: InboxItem, now: Date): string {
  const when = now.toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZone: "UTC" });
  const old = earlier.bodyMd.replace(/^\*\*Updated [^*]+\*\*\s*/, "").split("\n\n---\n\n_Earlier")[0]!.trim();
  const kept = old.length > EARLIER_MAX ? `${old.slice(0, EARLIER_MAX - 3)}...` : old;
  return `**Updated ${when} UTC**\n\n${newBody.trim()}\n\n---\n\n_Earlier (${new Date(earlier.createdAt).toLocaleString("en-US", { month: "short", day: "numeric", timeZone: "UTC" })}):_ ${kept}`;
}

/** The note written under an idempotency key, through its `inbox.item_created` event; null when there is none. */
export async function findPersisted(db: Executor, businessId: string, idempotencyKey: string): Promise<Persisted | null> {
  const event = await repos.events.byIdempotencyKey(db, businessId, idempotencyKey);
  const itemId = (event?.payload as { inboxItemId?: unknown } | undefined)?.inboxItemId;
  if (!event || typeof itemId !== "string") return null;
  return { item: await repos.inbox.get(db, businessId, itemId), eventId: event.id, narrated: 0, replayed: true };
}

export async function persistNote(db: Db, log: ModelLogger, input: PersistInput): Promise<Persisted> {
  const { businessId, idempotencyKey } = input;
  let out: Persisted;
  try {
    out = await db.transaction(async (tx): Promise<Persisted> => {
      if (idempotencyKey) {
        const existing = await findPersisted(tx, businessId, idempotencyKey);
        if (existing) return existing;
      }
      const same = input.events ? await findSameProblem(tx, businessId, input.item, input.events, input.now ?? new Date()) : null;
      if (same) {
        const revised = await repos.inbox.revise(tx, businessId, same.id, { ...input.item, body_md: revisedBody(input.item.body_md, same, input.now ?? new Date()), source_event_ids: [...input.eventIds] });
        const narrated = input.eventIds.length ? await repos.events.markNarrated(tx, businessId, input.eventIds) : 0;
        const eventId = await writeEventRow(tx, { businessId, type: "inbox.item_updated", actor: revised.fromAgentId ? { kind: "agent", id: revised.fromAgentId } : { kind: "system", id: "composer" }, entityIds: revised.entityIds, payload: { inboxItemId: revised.id, change: "revised", planId: null, followUpItemId: null } }, idempotencyKey);
        await repos.events.markNarrated(tx, businessId, [eventId]);
        return { item: revised, eventId, narrated, replayed: false, revised: true };
      }
      const created = await repos.inbox.createItem(tx, businessId, input.item, { costMinor: input.costMinorInt, currency: input.costCurrency });
      const narrated = input.eventIds.length ? await repos.events.markNarrated(tx, businessId, input.eventIds) : 0;
      const entityIds = created.entityIds;
      const eventId = await writeEventRow(
        tx,
        {
          businessId,
          type: "inbox.item_created",
          actor: created.fromAgentId ? { kind: "agent", id: created.fromAgentId } : { kind: "system", id: "composer" },
          entityIds,
          payload: {
            inboxItemId: created.id,
            type: created.type,
            fromAgentId: created.fromAgentId,
            subject: created.subject,
            blocksContinue: created.blocksContinue,
            sourceEventIds: [...input.eventIds],
            cost: { amountMinor: input.costMinorInt, currency: input.costCurrency },
          },
        },
        idempotencyKey,
      );
      // `inbox.item_created` is not narratable (catalogue); mark it narrated at once so Refresh never narrates its own notes.
      await repos.events.markNarrated(tx, businessId, [eventId]);
      if (entityIds.length) await repos.entities.recordMentions(tx, businessId, "inbox_item", created.id, entityIds);
      return { item: created, eventId, narrated, replayed: false };
    });
  } catch (err) {
    // Two writers raced past the lookup (another composer instance): the unique key let one commit; return its note.
    const raced = err instanceof AlreadyWrittenError || sqlState(err) === "23505";
    const winner = idempotencyKey && raced ? await findPersisted(db, businessId, idempotencyKey) : null;
    if (!winner) throw err;
    out = winner;
  }
  if (out.replayed) log.info({ businessId, inboxItemId: out.item.id, slot: input.slot, idempotencyKey }, "inbox item already written for these events; returning it");
  else if (out.revised) log.info({ businessId, inboxItemId: out.item.id, slot: input.slot, narrated: out.narrated }, "open warning about the same problem revised in place");
  else log.info({ businessId, inboxItemId: out.item.id, type: out.item.type, slot: input.slot, narrated: out.narrated, blocksContinue: out.item.blocksContinue, costMinor: input.costMinorInt }, "inbox item written");
  return out;
}

export const MAX_DRAFTS_PER_NOTE = 3;

/**
 * A draft is worth a CRM row when it looks like a name rather than a capitalised word: at least two words, within
 * length, and not the opening word of a quoted title ("Ship onboarding" is a task, not an organisation).
 */
export function isDraftWorthy(name: string, bodyMd: string): boolean {
  if (name.length < 2 || name.length > 120) return false;
  if (name.split(/\s+/).filter(Boolean).length < 2) return false;
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return !new RegExp(`["“'‘]\\s*${escaped}`).test(bodyMd);
}

/**
 * Unknown proper nouns the sweep found become draft CRM entities flagged unverified (BUILD §11.3 "unknown → draft CRM
 * entity flagged unverified"). Deduplicated against the CRM by name; capped per note so a noisy note cannot flood the CRM.
 */
export async function persistDrafts(db: Db, log: ModelLogger, businessId: string, drafts: readonly { name: string; kindGuess: string }[], inboxItemId: string, bodyMd = ""): Promise<string[]> {
  const created: string[] = [];
  let n = 0;
  for (const d of drafts) {
    if (n >= MAX_DRAFTS_PER_NOTE) break;
    const name = d.name.trim();
    if (!isDraftWorthy(name, bodyMd)) continue;
    try {
      const existing = await repos.entities.search(db, businessId, { q: name, limit: 1, minScore: 0.6 });
      if (existing.hits.length > 0) continue;
      const entity = await repos.entities.create(db, businessId, { kind: d.kindGuess as EntityKind, displayName: name, source: `composer:unverified:${inboxItemId}`, visibility: "private" });
      created.push(entity.id);
      n += 1;
    } catch (err) {
      log.warn({ err: (err as Error).message, businessId, name }, "draft entity not created");
    }
  }
  return created;
}
