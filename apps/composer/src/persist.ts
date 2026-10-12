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
