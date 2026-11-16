/**
 * The project's positioning notes (0117; WP-08 T1; @foundmill/shared `positioning.ts`). Two copies on the business's
 * foundations row: `positioning`, the one the founders approved and every marketing call reads, and
 * `positioning_draft`, one waiting for them (the team's first draft, a member's edit, or an agent's proposed change).
 * Nothing an agent writes is read by a prompt until a founder approves it.
 *
 * Reads and writes run on the caller's connection: the api's under the member's RLS, the orchestrator and the gateway
 * on the service connection (the table's tenant policy holds either way).
 */
import { POSITIONING_NOTE, positioningSectionsChanged, readPositioning, renderPositioning, type PositioningNotes } from "@foundmill/shared";
import { and, eq, inArray } from "drizzle-orm";
import { businessFoundations, inboxItems, type InboxItem } from "../schema";
import { inboxRepo } from "./inbox";
import { maybeOne, type Executor } from "./_shared";

export interface PositioningCopies {
  approved: PositioningNotes | null;
  draft: PositioningNotes | null;
  approvedAt: Date | null;
}

/** What a real person said, recorded by the founder (WP-08 T5 fills it); always untrusted text. */
export interface PositioningHeard {
  words: string;
  on: string;
}

const today = (at: Date): string => at.toISOString().slice(0, 10);

/** The note's body: what the notes are for, where to read them, and that nothing changes until a founder approves. */
export const POSITIONING_NOTE_BODY =
  "I wrote down how the team will describe your project: who it is for, the problem in their words, what they use today and what is different. Every line says how sure we are, and most are guesses until people tell us. Read it in Product › Vision and approve it when it reads right. Until you do, the team writes from your own words only.";

export const positioningRepo = {
  async get(db: Executor, businessId: string): Promise<PositioningCopies> {
    const row = maybeOne(
      await db
        .select({ positioning: businessFoundations.positioning, draft: businessFoundations.positioningDraft, approvedAt: businessFoundations.positioningApprovedAt })
        .from(businessFoundations)
        .where(eq(businessFoundations.businessId, businessId))
        .limit(1),
    );
    return { approved: readPositioning(row?.positioning ?? null), draft: readPositioning(row?.draft ?? null), approvedAt: row?.approvedAt ?? null };
  },

  /** The text prompts receive: the approved copy, or null when the founders have approved none (a draft is never read by a prompt). */
  async approvedText(db: Executor, businessId: string, max?: number): Promise<string | null> {
    const { approved } = await positioningRepo.get(db, businessId);
    return approved ? renderPositioning(approved, max) : null;
  },

  /** The team's open note about the notes (unread or read), else null. */
  async openNote(db: Executor, businessId: string): Promise<InboxItem | null> {
    return maybeOne(
      await db
        .select()
        .from(inboxItems)
        .where(and(eq(inboxItems.businessId, businessId), inArray(inboxItems.state, ["unread", "read"]), eq(inboxItems.subject, POSITIONING_NOTE.subject)))
        .limit(1),
    );
  },

  /**
   * Writes the waiting copy (over any earlier one). With `note` and an agent, raises the team's note unless one is still
   * open. `written: false` when the business has no foundations row (a project that never committed an idea).
   * `onlyIfEmpty`: write only when the project has neither copy (the first draft; a second run writes nothing).
   */
  async writeDraft(db: Executor, businessId: string, input: { notes: PositioningNotes; agentId: string | null; note: boolean; onlyIfEmpty?: boolean; onInboxItem?: (tx: Executor, item: InboxItem) => Promise<unknown> }): Promise<{ written: boolean; item: InboxItem | null }> {
    return db.transaction(async (tx) => {
      const current = await positioningRepo.get(tx, businessId);
      if (input.onlyIfEmpty && (current.approved || current.draft)) return { written: false, item: null };
      const rows = await tx
        .update(businessFoundations)
        .set({ positioningDraft: input.notes as unknown as Record<string, unknown>, updatedAt: new Date() })
        .where(eq(businessFoundations.businessId, businessId))
        .returning({ id: businessFoundations.id });
      if (!rows.length) return { written: false, item: null };
      let item: InboxItem | null = null;
      if (input.note && input.agentId && !(await positioningRepo.openNote(tx, businessId))) {
        item = await inboxRepo.createItem(tx, businessId, {
          type: "update",
          from_agent_id: input.agentId,
          subject: POSITIONING_NOTE.subject,
          body_md: POSITIONING_NOTE_BODY,
          status_strip: [],
          exhibit: { kind: "none", spec_ref: null },
          decision: null,
          blocks_continue: false,
          source_event_ids: [],
          entity_ids: [],
        });
        await input.onInboxItem?.(tx, item);
      }
      return { written: true, item };
    });
  },

  /**
   * A founder approves a copy: it becomes the one prompts read, its version goes up by one, a Changes line is added, and
   * the waiting copy is cleared. Returns the stored copy and the sections that changed (for `positioning.approved`).
   */
  async approve(db: Executor, businessId: string, input: { notes: PositioningNotes; userId: string; at?: Date }): Promise<{ notes: PositioningNotes; sectionsChanged: string[] } | null> {
    const at = input.at ?? new Date();
    const current = await positioningRepo.get(db, businessId);
    const before = current.approved;
    const version = (before?.version ?? 0) + 1;
    const sectionsChanged = positioningSectionsChanged(before, input.notes);
    const note = before ? `Changed: ${sectionsChanged.join(", ") || "wording"}.` : "First version approved.";
    const notes: PositioningNotes = { ...input.notes, version, updatedOn: today(at), changes: [{ version, on: today(at), note }, ...(before?.changes ?? input.notes.changes.filter((c) => c.version < version))].slice(0, 20) };
    const rows = await db
      .update(businessFoundations)
      .set({ positioning: notes as unknown as Record<string, unknown>, positioningDraft: null, positioningApprovedAt: at, positioningApprovedBy: input.userId, updatedAt: at })
      .where(eq(businessFoundations.businessId, businessId))
      .returning({ id: businessFoundations.id });
    if (!rows.length) return null;
    return { notes, sectionsChanged: sectionsChanged.slice(0, 10) };
  },

  /** What real people said, newest first (the founder's "Said:" notes on the First ten board, WP-08 T5). Empty until T5. */
  async heard(_db: Executor, _businessId: string, _limit = 20): Promise<PositioningHeard[]> {
    return [];
  },
};
