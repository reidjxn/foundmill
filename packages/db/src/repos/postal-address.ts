/**
 * project_postal_addresses (0097): the founders' postal address for the project's marketing email (US CAN-SPAM; founder,
 * Nov 13, 2026), and the reads the gateway makes before a send from the project's Foundmill address.
 *
 * The founders (owner or admin) read and write the row through RLS (`get`, `set` and `clear` inside `withRls`, from
 * Settings › Integrations); collaborators see nothing. The gateway reads it on the service connection for the footer and
 * raises the founders' note when a commercial send was refused for want of it (`raiseNote`: one while open, and after
 * "Later" no other for `POSTAL_ADDRESS_NOTE.quietMs`). Saving an address answers the open note (apps/api
 * `setPostalAddress`, through `openNote`).
 *
 * The relationship proofs that make a message transactional (packages/shared `projectMailClass`) read the event log:
 * `wroteFirst` (a verified reply from this person reached the project's address: ingest writes `lead.replied` only for
 * a reply whose SPF or DKIM passed) and `paid` (a `payment.received` from this address).
 */
import { normalizePostalAddress, POSTAL_ADDRESS_NOTE, postalAddressProblem, ValidationError } from "@foundmill/shared";
import { and, desc, eq, gte, ne, sql } from "drizzle-orm";
import { events, inboxItems, projectPostalAddresses, type InboxItem, type ProjectPostalAddress } from "../schema";
import { inboxRepo } from "./inbox";
import { maybeOne, one, type Executor } from "./_shared";

const noteKey = sql`${inboxItems.decision}->>'key' = ${POSTAL_ADDRESS_NOTE.key}`;

export const postalAddressRepo = {
  async get(db: Executor, businessId: string): Promise<ProjectPostalAddress | null> {
    return maybeOne(await db.select().from(projectPostalAddresses).where(eq(projectPostalAddresses.businessId, businessId)).limit(1));
  },

  /** The address the footer shows, or null when none is entered. */
  async addressOf(db: Executor, businessId: string): Promise<string | null> {
    return (await postalAddressRepo.get(db, businessId))?.address ?? null;
  },

  /** Enters or changes the address (one line; refused in plain words when it is not a postal address). */
  async set(db: Executor, businessId: string, input: { address: string; userId: string | null }): Promise<ProjectPostalAddress> {
    const problem = postalAddressProblem(input.address);
    if (problem) throw new ValidationError(problem, { field: "address" });
    const address = normalizePostalAddress(input.address);
    return one(
      await db
        .insert(projectPostalAddresses)
        .values({ businessId, address, updatedBy: input.userId })
        .onConflictDoUpdate({ target: projectPostalAddresses.businessId, set: { address, updatedBy: input.userId } })
        .returning(),
      "postal address",
    );
  },

  /** Removes the address; marketing email from the project's address waits again until one is entered. */
  async clear(db: Executor, businessId: string): Promise<boolean> {
    return (await db.delete(projectPostalAddresses).where(eq(projectPostalAddresses.businessId, businessId)).returning({ id: projectPostalAddresses.id })).length > 0;
  },

  /** The founders' note while it is open (unread or read), else null. */
  async openNote(db: Executor, businessId: string): Promise<InboxItem | null> {
    return maybeOne(
      await db
        .select()
        .from(inboxItems)
        .where(and(eq(inboxItems.businessId, businessId), sql`${inboxItems.state} in ('unread', 'read')`, noteKey))
        .orderBy(desc(inboxItems.createdAt))
        .limit(1),
    );
  },

  /**
   * Posts the founders' note once: nothing when one is open, or when one was answered or put aside within `quietMs`.
   * Serialized per business (a transaction-scoped advisory lock), so two refusals at once post one note.
   * `onCreated` runs in the same transaction (the caller writes `inbox.item_created` through the outbox).
   */
  async raiseNote(db: Executor, businessId: string, input: { fromAgentId: string; now: Date; onCreated?: (tx: Executor, item: InboxItem) => Promise<void> }): Promise<InboxItem | null> {
    return db.transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`postal-address-note:${businessId}`}))`);
      const latest = maybeOne(await tx.select().from(inboxItems).where(and(eq(inboxItems.businessId, businessId), noteKey)).orderBy(desc(inboxItems.createdAt)).limit(1));
      if (latest && (latest.state === "unread" || latest.state === "read")) return null;
      if (latest && input.now.getTime() - latest.createdAt.getTime() < POSTAL_ADDRESS_NOTE.quietMs) return null;
      const item = await inboxRepo.createItem(tx, businessId, {
        type: "decision",
        from_agent_id: input.fromAgentId,
        subject: POSTAL_ADDRESS_NOTE.subject,
        body_md: POSTAL_ADDRESS_NOTE.body,
        status_strip: [],
        exhibit: { kind: "none", spec_ref: null },
        decision: {
          options: [
            { id: POSTAL_ADDRESS_NOTE.options.add, label: POSTAL_ADDRESS_NOTE.addLabel, recommended: true, consequence: "Opens Settings › Integrations, where you add the address. Marketing emails go out with it from then on.", because: "Recommended because it takes a minute, and a PO box is fine.", cost_minor: 0, reversible: true },
            { id: POSTAL_ADDRESS_NOTE.options.later, label: POSTAL_ADDRESS_NOTE.laterLabel, recommended: false, consequence: "Marketing emails from the project's address stay unsent. Replies to people who wrote first and receipts still go out.", cost_minor: 0, reversible: true },
          ],
          free_text: false,
          expires_at: null,
          key: POSTAL_ADDRESS_NOTE.key,
        },
        blocks_continue: false,
        source_event_ids: [],
        entity_ids: [],
      });
      await input.onCreated?.(tx, item);
      return item;
    });
  },

  /**
   * Whether this person wrote to the project first: a verified reply from them (`lead.replied` on the entity ingest
   * derives from their address, `entityId`) since `since`, other than one asking to stop.
   */
  async wroteFirst(db: Executor, businessId: string, input: { entityId: string; since: Date }): Promise<boolean> {
    const rows = await db
      .select({ id: events.id })
      .from(events)
      .where(and(eq(events.businessId, businessId), eq(events.type, "lead.replied"), gte(events.occurredAt, input.since), sql`${events.entityIds} @> array[${input.entityId}::uuid]`, ne(sql`coalesce(${events.payload}->>'sentiment', '')`, "unsubscribe")))
      .limit(1);
    return rows.length > 0;
  },

  /** Whether a payment from this address (`payment.received`'s customer email) reached the project since `since`. */
  async paid(db: Executor, businessId: string, input: { email: string; since: Date }): Promise<boolean> {
    const rows = await db
      .select({ id: events.id })
      .from(events)
      .where(and(eq(events.businessId, businessId), eq(events.type, "payment.received"), gte(events.occurredAt, input.since), sql`lower(${events.payload}->'customer'->>'email') = ${input.email.trim().toLowerCase()}`))
      .limit(1);
    return rows.length > 0;
  },
};
