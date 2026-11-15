/**
 * product — spec blocks, spec versions, change proposals + hunks, roadmap, sources
 * (BUILD §11.5; routers product.spec.*, product.roadmap.*, product.proposals.*).
 */
import { INPUT_LIMITS } from "@foundmill/config";
import { boundedRecord, HUNK_DECISIONS, NotFoundError, ROADMAP_HORIZONS, SEVERITIES, SOURCE_KINDS, ValidationError, type PROPOSAL_STATUSES } from "@foundmill/shared";
import { and, asc, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import {
  AUTHOR_KINDS, changeProposals, proposalHunks, roadmapDependencies, roadmapItems, sources, specBlocks, specVersions,
  type ChangeProposal, type ProposalHunk, type RoadmapDependency, type RoadmapItem, type Source, type SpecBlock, type SpecVersion,
} from "../schema";
import { assertOwnerRef, assertSpecBlocksOwned } from "./_refs";
import { changes, defined, Id, JsonObject, maybeOne, one, PageInput, parseInput, timeKeyset, toPage, type Executor, type Page, patchSchema } from "./_shared";
import { docText, mergeBlockContent, sameContent, textDoc } from "./spec-merge";

const OwnerRef = z.object({ kind: z.enum(["agent", "user", "department"]), id: Id });

// --- spec blocks ----------------------------------------------------------------------------------------------------

export const CreateSpecBlockInput = z.object({
  section: z.string().trim().min(1).max(80),
  position: z.number().int().min(0).optional(),
  content: JsonObject.default({ type: "doc", content: [] }),
  sources: z.array(Id).default([]),
  authoredByKind: z.enum(AUTHOR_KINDS).default("user"),
  authoredBy: Id.nullable().optional(),
  pinned: z.boolean().default(false),
});
export type CreateSpecBlockInput = z.input<typeof CreateSpecBlockInput>;

export const EditSpecBlockInput = z.object({
  content: boundedRecord(INPUT_LIMITS.jsonObjectKeys, JsonObject).optional(),
  sources: z.array(Id).max(INPUT_LIMITS.linkedIds).optional(),
  position: z.number().int().min(0).optional(),
  pinned: z.boolean().optional(),
  authoredByKind: z.enum(AUTHOR_KINDS).optional(),
  authoredBy: Id.nullable().optional(),
});
export type EditSpecBlockInput = z.input<typeof EditSpecBlockInput>;

// --- proposals --------------------------------------------------------------------------------------------------------

export const ProposalHunkInput = z
  .object({
    specBlockId: Id.nullable().optional(),
    roadmapItemId: Id.nullable().optional(),
    base: JsonObject.nullable().optional(),
    ours: JsonObject.nullable().optional(),
    theirs: JsonObject.nullable().optional(),
    position: z.number().int().min(0).optional(),
  })
  .refine((h) => Boolean(h.specBlockId) !== Boolean(h.roadmapItemId), { message: "a hunk targets exactly one spec block or roadmap item" });

export const CreateProposalInput = z.object({
  title: z.string().trim().max(200).default(""),
  rationaleMd: z.string().default(""),
  evidence: z.array(Id).default([]),
  impact: JsonObject.default({}),
  severity: z.enum(SEVERITIES).default("normal"),
  proposedByAgentId: Id.nullable().optional(),
  inboxItemId: Id.nullable().optional(),
  hunks: z.array(ProposalHunkInput).min(1),
});
export type CreateProposalInput = z.input<typeof CreateProposalInput>;

// --- roadmap ----------------------------------------------------------------------------------------------------------

export const UpsertRoadmapItemInput = z.object({
  id: Id.optional(),
  title: z.string().trim().min(1).max(200),
  descriptionMd: z.string().default(""),
  horizon: z.enum(ROADMAP_HORIZONS).default("next"),
  targetStart: z.string().date().nullable().optional(),
  targetEnd: z.string().date().nullable().optional(),
  confidence: z.number().int().min(1).max(5).default(3),
  ownerRef: OwnerRef.nullable().optional(),
  specBlockIds: z.array(Id).max(INPUT_LIMITS.linkedIds).default([]),
  status: z.string().max(40).default("planned"),
  position: z.number().int().min(0).optional(),
});
export type UpsertRoadmapItemInput = z.input<typeof UpsertRoadmapItemInput>;

/** The department a roadmap item's tasks are filed under: its owner when that owner is a department, else none. */
export function roadmapItemDepartmentId(item: { ownerRef: unknown } | null | undefined): string | null {
  const ref = item?.ownerRef as { kind?: string; id?: string } | null | undefined;
  return ref && ref.kind === "department" && typeof ref.id === "string" ? ref.id : null;
}

// --- sources ----------------------------------------------------------------------------------------------------------

export const CreateSourceInput = z.object({
  kind: z.enum(SOURCE_KINDS),
  uri: z.string().max(2048).nullable().optional(),
  title: z.string().max(400).default(""),
  contentRef: z.string().max(2048).nullable().optional(),
  embedding: z.array(z.number()).length(1024).nullable().optional(),
  relevance: JsonObject.default({}),
  fetchedAt: z.coerce.date().nullable().optional(),
});
export type CreateSourceInput = z.input<typeof CreateSourceInput>;

export interface ProposalWithHunks extends ChangeProposal {
  hunks: ProposalHunk[];
}

/** What deciding one hunk did to its target (audited by the caller). */
export interface AppliedHunk {
  hunkId: string;
  decision: "accepted" | "edited";
  target: { kind: "spec_block" | "roadmap_item"; id: string };
  /** False when the target was archived or the change was already in it. */
  changed: boolean;
  /** The live content had changed since the proposal was drafted, so the change was merged into it (three-way). */
  merged: boolean;
  conflicts: number;
  skipped: "archived" | "no_content" | null;
}

/** The version a settled proposal published (none when every hunk was rejected). */
export interface PublishedFromProposal {
  version: SpecVersion;
  previousVersion: number | null;
  changedBlockIds: string[];
  counts: { accepted: number; rejected: number; edited: number };
}

export interface ProposalDecisionResult extends ProposalWithHunks {
  applied: AppliedHunk[];
  published: PublishedFromProposal | null;
}

export interface DecideOptions {
  /** The user deciding (publishes the version, authors an edited block). */
  decidedBy?: string | null;
}

const DECISION_WORDS: Record<string, string> = { accepted: "accepted", edited: "accepted as edited", rejected: "rejected" };

/** One line for the version history: which proposal, and what happened to each of its changes. */
export function proposalChangelog<H extends Pick<ProposalHunk, "decision" | "position">>(title: string, hunks: readonly H[], labelOf: (h: H) => string): string {
  const parts = [...hunks].sort((a, b) => a.position - b.position).map((h) => `${labelOf(h)} ${DECISION_WORDS[h.decision] ?? h.decision}`);
  const name = title.trim() ? `Change proposal "${title.trim()}"` : "Change proposal";
  return `${name}: ${parts.join("; ")}.`.slice(0, 4000);
}

export const productRepo = {
  // spec ------------------------------------------------------------------------------------------------------------
  async listBlocks(db: Executor, businessId: string, filter: { section?: string } = {}): Promise<SpecBlock[]> {
    return db
      .select()
      .from(specBlocks)
      .where(and(eq(specBlocks.businessId, businessId), isNull(specBlocks.archivedAt), filter.section ? eq(specBlocks.section, filter.section) : undefined))
      .orderBy(asc(specBlocks.section), asc(specBlocks.position), asc(specBlocks.createdAt));
  },

  async getBlock(db: Executor, businessId: string, blockId: string): Promise<SpecBlock> {
    return one(await db.select().from(specBlocks).where(and(eq(specBlocks.businessId, businessId), eq(specBlocks.id, blockId))).limit(1), "spec block", blockId);
  },

  /**
   * Without a position, a block goes after the last block of its section, and a block that opens a new section goes
   * after every block of the business, so the outline (ordered by each section's first position) shows a new section
   * last instead of next to the first one.
   */
  async createBlock(db: Executor, businessId: string, input: CreateSpecBlockInput): Promise<SpecBlock> {
    const v = parseInput(CreateSpecBlockInput, input, "spec block");
    const position =
      v.position ??
      Number(
        one(
          await db
            .select({ n: sql<number>`coalesce(max(${specBlocks.position}) filter (where ${specBlocks.section} = ${v.section}) + 1, max(${specBlocks.position}) + 1, 0)` })
            .from(specBlocks)
            .where(eq(specBlocks.businessId, businessId)),
          "position",
        ).n,
      );
    return one(
      await db.insert(specBlocks).values({ businessId, section: v.section, position, content: v.content, sources: v.sources, authoredByKind: v.authoredByKind, authoredBy: v.authoredBy ?? null, pinned: v.pinned }).returning(),
      "spec block",
    );
  },

  /** Edits a block and bumps its version (the Yjs collab server calls this on every persisted change). */
  async editBlock(db: Executor, businessId: string, blockId: string, input: EditSpecBlockInput): Promise<SpecBlock> {
    const v = parseInput(EditSpecBlockInput, input, "spec block edit");
    return one(
      await db
        .update(specBlocks)
        .set({ ...defined(v), version: sql`${specBlocks.version} + 1` })
        .where(and(eq(specBlocks.businessId, businessId), eq(specBlocks.id, blockId), isNull(specBlocks.archivedAt)))
        .returning(),
      "spec block",
      blockId,
    );
  },

  /**
   * An agent's draft of a block (the foundations drafting): written only while the block is live, not pinned and still
   * at `expectedVersion` (the version the caller read when it found the block empty), all in the same statement, so a
   * human edit or any other write a moment earlier always wins (AC-11.5.3). Null when not written.
   */
  async writeAgentDraft(db: Executor, businessId: string, blockId: string, input: { content: Record<string, unknown>; sources?: string[]; authoredBy?: string | null; expectedVersion: number }): Promise<SpecBlock | null> {
    const v = parseInput(EditSpecBlockInput, { content: input.content, sources: input.sources, authoredByKind: "agent", authoredBy: input.authoredBy ?? null }, "spec block draft");
    const rows = await db
      .update(specBlocks)
      .set({ ...defined(v), version: sql`${specBlocks.version} + 1` })
      .where(and(eq(specBlocks.businessId, businessId), eq(specBlocks.id, blockId), isNull(specBlocks.archivedAt), eq(specBlocks.pinned, false), eq(specBlocks.version, input.expectedVersion)))
      .returning();
    return rows[0] ?? null;
  },

  async archiveBlock(db: Executor, businessId: string, blockId: string): Promise<SpecBlock> {
    return one(await db.update(specBlocks).set({ archivedAt: new Date() }).where(and(eq(specBlocks.businessId, businessId), eq(specBlocks.id, blockId))).returning(), "spec block", blockId);
  },

  async listVersions(db: Executor, businessId: string): Promise<SpecVersion[]> {
    return db.select().from(specVersions).where(eq(specVersions.businessId, businessId)).orderBy(desc(specVersions.version));
  },

  async getVersion(db: Executor, businessId: string, version: number): Promise<SpecVersion> {
    return one(await db.select().from(specVersions).where(and(eq(specVersions.businessId, businessId), eq(specVersions.version, version))).limit(1), "spec version", String(version));
  },

  /**
   * Publishes a snapshot as the next version number (max + 1). Without a snapshot, the live blocks are snapshotted.
   * Numbering is serialised per business (a transaction-scoped advisory lock taken before the max is read), so two
   * publishes at once (two tabs, two members, a proposal settling) get consecutive numbers instead of one of them
   * failing on the unique (business_id, version) index.
   */
  async publishVersion(db: Executor, businessId: string, input: { snapshot?: Record<string, unknown>; changelogMd?: string; publishedBy?: string | null }): Promise<SpecVersion> {
    return (await productRepo.publish(db, businessId, input)).version;
  },

  /**
   * `publishVersion` that says what happened. With `unlessUnchanged`, a publish whose snapshot and changelog equal the
   * latest version's returns that version (`created: false`) instead of numbering a duplicate: the second of two
   * simultaneous Publish presses publishes nothing new. `previousVersion` is the latest number before this call, read
   * under the same lock.
   */
  async publish(
    db: Executor,
    businessId: string,
    input: { snapshot?: Record<string, unknown>; changelogMd?: string; publishedBy?: string | null; unlessUnchanged?: boolean },
  ): Promise<{ version: SpecVersion; created: boolean; previousVersion: number | null }> {
    const v = parseInput(z.object({ snapshot: JsonObject.optional(), changelogMd: z.string().default(""), publishedBy: Id.nullable().optional(), unlessUnchanged: z.boolean().default(false) }), input, "spec version");
    return db.transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext('spec_versions'), hashtext(${businessId}::text))`);
      const snapshot = v.snapshot ?? { blocks: await productRepo.listBlocks(tx, businessId) };
      const [latest] = await tx.select().from(specVersions).where(eq(specVersions.businessId, businessId)).orderBy(desc(specVersions.version)).limit(1);
      if (latest && v.unlessUnchanged && latest.changelogMd === v.changelogMd) {
        const [same] = await tx
          .select({ id: specVersions.id })
          .from(specVersions)
          .where(and(eq(specVersions.id, latest.id), sql`${specVersions.snapshot} = ${JSON.stringify(snapshot)}::jsonb`));
        if (same) return { version: latest, created: false, previousVersion: latest.version };
      }
      const version = one(
        await tx.insert(specVersions).values({ businessId, version: (latest?.version ?? 0) + 1, snapshot, changelogMd: v.changelogMd, publishedBy: v.publishedBy ?? null }).returning(),
        "spec version",
      );
      return { version, created: true, previousVersion: latest?.version ?? null };
    });
  },

  /** Restores every block from a published snapshot (blocks absent from the snapshot are archived). */
  async restoreVersion(db: Executor, businessId: string, version: number): Promise<SpecBlock[]> {
    return db.transaction(async (tx) => {
      const snap = await productRepo.getVersion(tx, businessId, version);
      const blocks = (snap.snapshot as { blocks?: SpecBlock[] }).blocks ?? [];
      if (!Array.isArray(blocks)) throw new ValidationError("Snapshot has no blocks", { version });
      const now = new Date();
      await tx.update(specBlocks).set({ archivedAt: now }).where(and(eq(specBlocks.businessId, businessId), isNull(specBlocks.archivedAt)));
      const restored: SpecBlock[] = [];
      for (const b of blocks) {
        const row = one(
          await tx
            .insert(specBlocks)
            .values({
              id: b.id,
              businessId,
              section: b.section,
              position: b.position,
              content: b.content,
              sources: b.sources ?? [],
              authoredByKind: b.authoredByKind ?? "system",
              authoredBy: b.authoredBy ?? null,
              pinned: b.pinned ?? false,
              version: (b.version ?? 0) + 1,
            })
            .onConflictDoUpdate({
              target: specBlocks.id,
              set: { section: b.section, position: b.position, content: b.content, sources: b.sources ?? [], pinned: b.pinned ?? false, archivedAt: null, version: sql`${specBlocks.version} + 1` },
            })
            .returning(),
          "spec block",
        );
        restored.push(row);
      }
      return restored;
    });
  },

  // proposals ---------------------------------------------------------------------------------------------------------
  async listProposals(db: Executor, businessId: string, filter: { status?: (typeof PROPOSAL_STATUSES)[number]; severity?: (typeof SEVERITIES)[number] } & PageInput = {}): Promise<Page<ChangeProposal>> {
    const p = parseInput(PageInput, filter, "page");
    const ks = timeKeyset<ChangeProposal>(changeProposals.createdAt, changeProposals.id, (r) => ({ at: r.createdAt, id: r.id }));
    const rows = await db
      .select()
      .from(changeProposals)
      .where(
        and(
          eq(changeProposals.businessId, businessId),
          isNull(changeProposals.archivedAt),
          filter.status ? eq(changeProposals.status, filter.status) : undefined,
          filter.severity ? eq(changeProposals.severity, filter.severity) : undefined,
          ks.after(p.cursor),
        ),
      )
      .orderBy(...ks.orderBy)
      .limit(p.limit + 1);
    return toPage(rows, p, ks);
  },

  async getProposal(db: Executor, businessId: string, proposalId: string): Promise<ProposalWithHunks> {
    const proposal = one(await db.select().from(changeProposals).where(and(eq(changeProposals.businessId, businessId), eq(changeProposals.id, proposalId))).limit(1), "proposal", proposalId);
    const hunks = await db.select().from(proposalHunks).where(and(eq(proposalHunks.businessId, businessId), eq(proposalHunks.proposalId, proposalId))).orderBy(asc(proposalHunks.position));
    return { ...proposal, hunks };
  },

  /**
   * Creates a proposal with its hunks. A hunk drafted without `base` / `ours` gets the target's current content for both
   * (the version it was proposed against), so the Changes tab shows a real diff and accepting it can merge (three-way)
   * with whatever changes in the block before it is decided. Every target must belong to the business.
   */
  async createProposal(db: Executor, businessId: string, input: CreateProposalInput): Promise<ProposalWithHunks> {
    const v = parseInput(CreateProposalInput, input, "proposal");
    return db.transaction(async (tx) => {
      const blockIds = [...new Set(v.hunks.map((h) => h.specBlockId).filter((x): x is string => Boolean(x)))];
      const itemIds = [...new Set(v.hunks.map((h) => h.roadmapItemId).filter((x): x is string => Boolean(x)))];
      const blocks = blockIds.length ? await tx.select().from(specBlocks).where(and(eq(specBlocks.businessId, businessId), inArray(specBlocks.id, blockIds))) : [];
      const items = itemIds.length ? await tx.select().from(roadmapItems).where(and(eq(roadmapItems.businessId, businessId), inArray(roadmapItems.id, itemIds))) : [];
      if (blocks.length !== blockIds.length || items.length !== itemIds.length) throw new ValidationError("Every change must target a spec block or roadmap item of this business", { blockIds, itemIds });
      const currentOf = (h: (typeof v.hunks)[number]): Record<string, unknown> | null => {
        if (h.specBlockId) return blocks.find((b) => b.id === h.specBlockId)?.content ?? null;
        const item = items.find((i) => i.id === h.roadmapItemId);
        return item ? textDoc(item.descriptionMd) : null;
      };
      const proposal = one(
        await tx
          .insert(changeProposals)
          .values({ businessId, title: v.title, rationaleMd: v.rationaleMd, evidence: v.evidence, impact: v.impact, severity: v.severity, proposedByAgentId: v.proposedByAgentId ?? null, inboxItemId: v.inboxItemId ?? null })
          .returning(),
        "proposal",
      );
      const hunks = await tx
        .insert(proposalHunks)
        .values(
          v.hunks.map((h, i) => {
            const current = currentOf(h);
            return {
              businessId,
              proposalId: proposal.id,
              specBlockId: h.specBlockId ?? null,
              roadmapItemId: h.roadmapItemId ?? null,
              base: h.base ?? h.ours ?? current,
              ours: h.ours ?? current,
              theirs: h.theirs ?? null,
              position: h.position ?? i,
            };
          }),
        )
        .returning();
      return { ...proposal, hunks };
    });
  },

  /**
   * Decides one pending hunk of an open proposal. Accepting (or saving an edit) applies the hunk's `theirs` to its spec
   * block or roadmap item through a three-way merge with the live content (`spec-merge.ts`); the block's version is
   * bumped and an edit by the founder pins it. When this was the last pending hunk the proposal settles (accepted /
   * partially_accepted / rejected) and, if any hunk changed the spec, the next immutable version is published with a
   * changelog naming each change. The proposal row is locked for the whole decision, so two decisions at once can
   * never both settle it (or neither). Deciding a hunk again with the same decision is a no-op; changing a decision
   * is refused (an applied change is not undone by a click).
   */
  async decideHunk(db: Executor, businessId: string, hunkId: string, decision: (typeof HUNK_DECISIONS)[number], edited?: Record<string, unknown>, opts: DecideOptions = {}): Promise<ProposalDecisionResult> {
    const d = parseInput(z.enum(HUNK_DECISIONS), decision, "hunk decision");
    if (d === "pending") throw new ValidationError("Choose accept, reject or edited");
    if (d === "edited" && !edited) throw new ValidationError("An edited change needs its edited text");
    return db.transaction(async (tx) => {
      const located = one(await tx.select({ proposalId: proposalHunks.proposalId }).from(proposalHunks).where(and(eq(proposalHunks.businessId, businessId), eq(proposalHunks.id, hunkId))).limit(1), "hunk", hunkId);
      const proposal = await lockProposal(tx, businessId, located.proposalId);
      const hunk = one(await tx.select().from(proposalHunks).where(and(eq(proposalHunks.businessId, businessId), eq(proposalHunks.id, hunkId))).limit(1), "hunk", hunkId);
      if (hunk.decision !== "pending") {
        if (hunk.decision === d) return { ...(await productRepo.getProposal(tx, businessId, proposal.id)), applied: [], published: null };
        throw new ValidationError("This change was already decided", { hunkId, decision: hunk.decision });
      }
      if (proposal.status !== "open") throw new ValidationError("This proposal is already settled", { proposalId: proposal.id, status: proposal.status });
      const decided = one(
        await tx
          .update(proposalHunks)
          .set({ decision: d, ...(d === "edited" && edited ? { theirs: edited } : {}) })
          .where(and(eq(proposalHunks.businessId, businessId), eq(proposalHunks.id, hunkId)))
          .returning(),
        "hunk",
        hunkId,
      );
      const applied = d === "rejected" ? [] : [await applyHunk(tx, businessId, proposal, decided, d, opts)];
      return finishDecision(tx, businessId, proposal, applied, opts);
    });
  },

  /** Recomputes the proposal status from its hunks (open while any hunk is pending). */
  async settleProposal(db: Executor, businessId: string, proposalId: string): Promise<ProposalWithHunks> {
    const current = await productRepo.getProposal(db, businessId, proposalId);
    const decisions = current.hunks.map((h) => h.decision);
    let status: (typeof PROPOSAL_STATUSES)[number] = "open";
    if (decisions.length && !decisions.includes("pending")) {
      const accepted = decisions.filter((x) => x === "accepted" || x === "edited").length;
      status = accepted === decisions.length ? "accepted" : accepted === 0 ? "rejected" : "partially_accepted";
    }
    if (status !== current.status) {
      await db
        .update(changeProposals)
        .set({ status, resolvedAt: status === "open" ? null : new Date() })
        .where(and(eq(changeProposals.businessId, businessId), eq(changeProposals.id, proposalId)));
      return { ...current, status, resolvedAt: status === "open" ? null : new Date() };
    }
    return current;
  },

  /** Accepts every pending hunk (each applied as in `decideHunk`), settles the proposal and publishes the version. */
  async acceptAll(db: Executor, businessId: string, proposalId: string, opts: DecideOptions = {}): Promise<ProposalDecisionResult> {
    return db.transaction(async (tx) => {
      const proposal = await lockProposal(tx, businessId, proposalId);
      if (proposal.status !== "open") return { ...(await productRepo.getProposal(tx, businessId, proposalId)), applied: [], published: null };
      const pending = await tx
        .update(proposalHunks)
        .set({ decision: "accepted" })
        .where(and(eq(proposalHunks.businessId, businessId), eq(proposalHunks.proposalId, proposalId), eq(proposalHunks.decision, "pending")))
        .returning();
      const applied: AppliedHunk[] = [];
      for (const hunk of pending.sort((a, b) => a.position - b.position)) applied.push(await applyHunk(tx, businessId, proposal, hunk, "accepted", opts));
      return finishDecision(tx, businessId, proposal, applied, opts);
    });
  },

  /**
   * Rejects every pending hunk. Hunks already accepted stay applied, so a proposal with accepted hunks settles as
   * partially accepted and publishes the version those hunks made; one with none is rejected and publishes nothing.
   */
  async rejectProposal(db: Executor, businessId: string, proposalId: string, opts: DecideOptions = {}): Promise<ProposalDecisionResult> {
    return db.transaction(async (tx) => {
      const proposal = await lockProposal(tx, businessId, proposalId);
      if (proposal.status !== "open") return { ...(await productRepo.getProposal(tx, businessId, proposalId)), applied: [], published: null };
      await tx.update(proposalHunks).set({ decision: "rejected" }).where(and(eq(proposalHunks.businessId, businessId), eq(proposalHunks.proposalId, proposalId), eq(proposalHunks.decision, "pending")));
      return finishDecision(tx, businessId, proposal, [], opts);
    });
  },

  // roadmap -----------------------------------------------------------------------------------------------------------
  async listRoadmap(db: Executor, businessId: string, filter: { horizon?: (typeof ROADMAP_HORIZONS)[number]; status?: string } = {}): Promise<RoadmapItem[]> {
    return db
      .select()
      .from(roadmapItems)
      .where(
        and(
          eq(roadmapItems.businessId, businessId),
          isNull(roadmapItems.archivedAt),
          filter.horizon ? eq(roadmapItems.horizon, filter.horizon) : undefined,
          filter.status ? eq(roadmapItems.status, filter.status) : undefined,
        ),
      )
      .orderBy(asc(roadmapItems.horizon), asc(roadmapItems.position), asc(roadmapItems.createdAt));
  },

  /**
   * Roadmap items nobody has turned into tasks yet (no task, live or finished, links to them), Now first, then by
   * position: what the Chief of Staff's brief shows as work waiting for a task graph (audit OL-10).
   */
  async untaskedRoadmap(db: Executor, businessId: string, limit = 20): Promise<Pick<RoadmapItem, "id" | "title" | "horizon" | "status">[]> {
    return db
      .select({ id: roadmapItems.id, title: roadmapItems.title, horizon: roadmapItems.horizon, status: roadmapItems.status })
      .from(roadmapItems)
      .where(
        and(
          eq(roadmapItems.businessId, businessId),
          isNull(roadmapItems.archivedAt),
          sql`${roadmapItems.status} not in ('done', 'shipped', 'dropped')`,
          sql`not exists (select 1 from tasks t where t.business_id = ${roadmapItems.businessId} and t.roadmap_item_id = ${roadmapItems.id} and t.archived_at is null)`,
        ),
      )
      .orderBy(sql`case ${roadmapItems.horizon} when 'now' then 0 when 'next' then 1 else 2 end`, asc(roadmapItems.position), asc(roadmapItems.createdAt))
      .limit(Math.min(Math.max(Math.trunc(limit), 1), 200));
  },

  /**
   * Live roadmap items nobody has started: not done (`done`, `shipped`), and no task linked to them (live or archived)
   * has left `planned`. What an imported plan may retire (`product.plan.import` with `replaceUnstarted`); an item with
   * work in progress or finished is never among them.
   */
  async unstartedRoadmap(db: Executor, businessId: string): Promise<RoadmapItem[]> {
    return db
      .select()
      .from(roadmapItems)
      .where(
        and(
          eq(roadmapItems.businessId, businessId),
          isNull(roadmapItems.archivedAt),
          sql`${roadmapItems.status} not in ('done', 'shipped')`,
          sql`not exists (select 1 from tasks t where t.business_id = ${roadmapItems.businessId} and t.roadmap_item_id = ${roadmapItems.id} and t.status <> 'planned')`,
        ),
      )
      .orderBy(asc(roadmapItems.horizon), asc(roadmapItems.position), asc(roadmapItems.createdAt));
  },

  async getRoadmapItem(db: Executor, businessId: string, itemId: string): Promise<RoadmapItem> {
    return one(await db.select().from(roadmapItems).where(and(eq(roadmapItems.businessId, businessId), eq(roadmapItems.id, itemId))).limit(1), "roadmap item", itemId);
  },

  async upsertRoadmapItem(db: Executor, businessId: string, input: UpsertRoadmapItemInput): Promise<RoadmapItem> {
    const v = parseInput(UpsertRoadmapItemInput, input, "roadmap item");
    // References to other tenants are refused (audit ARB-23): the spec blocks and the owner must be this business's own.
    await assertSpecBlocksOwned(db, businessId, v.specBlockIds, "specBlockIds");
    await assertOwnerRef(db, businessId, v.ownerRef);
    const values = {
      title: v.title,
      descriptionMd: v.descriptionMd,
      horizon: v.horizon,
      targetStart: v.targetStart ?? null,
      targetEnd: v.targetEnd ?? null,
      confidence: v.confidence,
      ownerRef: v.ownerRef ?? null,
      specBlockIds: v.specBlockIds,
      status: v.status,
      ...(v.position !== undefined ? { position: v.position } : {}),
    };
    if (v.id) {
      // An id names an item to change. One that is not in this business is a 404, never an insert under the caller's id:
      // that would collide with another tenant's primary key (a 500) or let the caller choose ids.
      const existing = await db.select({ id: roadmapItems.id }).from(roadmapItems).where(and(eq(roadmapItems.businessId, businessId), eq(roadmapItems.id, v.id))).limit(1);
      if (!existing.length) throw new NotFoundError("roadmap item", v.id);
      return one(await db.update(roadmapItems).set(values).where(and(eq(roadmapItems.businessId, businessId), eq(roadmapItems.id, v.id))).returning(), "roadmap item", v.id);
    }
    return one(await db.insert(roadmapItems).values({ businessId, ...values }).returning(), "roadmap item");
  },

  /**
   * Moves an item to `horizon` at `index` among that column's other items (board order: position, then title) and
   * renumbers the column 0..n-1, so a card lands exactly where it was dropped, a move and its reverse bring it back,
   * and a move inside one column reorders it. Only horizon and position change: dates, confidence, owner and links stay
   * as they are (TPD-34).
   */
  async moveRoadmapItem(db: Executor, businessId: string, itemId: string, input: { horizon: (typeof ROADMAP_HORIZONS)[number]; index: number }): Promise<RoadmapItem> {
    const v = parseInput(z.object({ horizon: z.enum(ROADMAP_HORIZONS), index: z.number().int().min(0) }), input, "roadmap move");
    return db.transaction(async (tx) => {
      const item = one(await tx.select().from(roadmapItems).where(and(eq(roadmapItems.businessId, businessId), eq(roadmapItems.id, itemId), isNull(roadmapItems.archivedAt))).for("update").limit(1), "roadmap item", itemId);
      const column = await tx
        .select({ id: roadmapItems.id, position: roadmapItems.position })
        .from(roadmapItems)
        .where(and(eq(roadmapItems.businessId, businessId), eq(roadmapItems.horizon, v.horizon), isNull(roadmapItems.archivedAt)))
        .orderBy(asc(roadmapItems.position), asc(roadmapItems.title))
        .for("update");
      const others = column.filter((c) => c.id !== item.id);
      const at = Math.min(v.index, others.length);
      const order = [...others.slice(0, at), { id: item.id, position: item.position }, ...others.slice(at)];
      for (const [position, row] of order.entries()) {
        if (row.id !== item.id && row.position !== position) await tx.update(roadmapItems).set({ position }).where(and(eq(roadmapItems.businessId, businessId), eq(roadmapItems.id, row.id)));
      }
      return one(await tx.update(roadmapItems).set({ horizon: v.horizon, position: at }).where(and(eq(roadmapItems.businessId, businessId), eq(roadmapItems.id, item.id))).returning(), "roadmap item", itemId);
    });
  },

  /**
   * Adds spec blocks to an item's links and changes nothing else (`roadmap.link`; the upsert would reset the fields it
   * was not given). Every block must be a live block of the business.
   */
  async addRoadmapSpecBlocks(db: Executor, businessId: string, itemId: string, specBlockIds: readonly string[]): Promise<RoadmapItem> {
    const ids = [...new Set(parseInput(z.array(Id), specBlockIds, "spec block ids"))];
    return db.transaction(async (tx) => {
      const item = one(await tx.select().from(roadmapItems).where(and(eq(roadmapItems.businessId, businessId), eq(roadmapItems.id, itemId))).for("update").limit(1), "roadmap item", itemId);
      if (ids.length === 0) return item;
      // Another business's block is a 400 like every reference field (audit ARB-23); an archived block of this one is a 404.
      await assertSpecBlocksOwned(tx, businessId, ids, "specBlockIds");
      const owned = await tx.select({ id: specBlocks.id }).from(specBlocks).where(and(eq(specBlocks.businessId, businessId), inArray(specBlocks.id, ids), isNull(specBlocks.archivedAt)));
      const missing = ids.filter((id) => !owned.some((b) => b.id === id));
      if (missing.length) throw new NotFoundError("spec block", missing[0]!);
      const merged = [...new Set([...item.specBlockIds, ...ids])];
      return one(await tx.update(roadmapItems).set({ specBlockIds: merged }).where(and(eq(roadmapItems.businessId, businessId), eq(roadmapItems.id, item.id))).returning(), "roadmap item", itemId);
    });
  },

  async archiveRoadmapItem(db: Executor, businessId: string, itemId: string): Promise<RoadmapItem> {
    return one(await db.update(roadmapItems).set({ archivedAt: new Date() }).where(and(eq(roadmapItems.businessId, businessId), eq(roadmapItems.id, itemId))).returning(), "roadmap item", itemId);
  },

  /** Links `fromItem → toItem` (from depends on to). Both items must belong to the business. */
  async linkRoadmap(db: Executor, businessId: string, fromItem: string, toItem: string): Promise<RoadmapDependency> {
    if (fromItem === toItem) throw new ValidationError("A roadmap item cannot depend on itself");
    const owned = await db.select({ id: roadmapItems.id }).from(roadmapItems).where(and(eq(roadmapItems.businessId, businessId), inArray(roadmapItems.id, [fromItem, toItem])));
    if (owned.length !== 2) throw new ValidationError("Both roadmap items must belong to the business", { fromItem, toItem });
    return one(
      await db
        .insert(roadmapDependencies)
        .values({ businessId, fromItem, toItem })
        .onConflictDoUpdate({ target: [roadmapDependencies.fromItem, roadmapDependencies.toItem], set: { businessId } })
        .returning(),
      "roadmap dependency",
    );
  },

  async unlinkRoadmap(db: Executor, businessId: string, fromItem: string, toItem: string): Promise<void> {
    await db.delete(roadmapDependencies).where(and(eq(roadmapDependencies.businessId, businessId), eq(roadmapDependencies.fromItem, fromItem), eq(roadmapDependencies.toItem, toItem)));
  },

  async listDependencies(db: Executor, businessId: string): Promise<RoadmapDependency[]> {
    return db.select().from(roadmapDependencies).where(eq(roadmapDependencies.businessId, businessId));
  },

  // sources -----------------------------------------------------------------------------------------------------------
  async listSources(db: Executor, businessId: string, filter: { kind?: (typeof SOURCE_KINDS)[number] } & PageInput = {}): Promise<Page<Source>> {
    const p = parseInput(PageInput, filter, "page");
    const ks = timeKeyset<Source>(sources.createdAt, sources.id, (r) => ({ at: r.createdAt, id: r.id }));
    const rows = await db
      .select()
      .from(sources)
      .where(and(eq(sources.businessId, businessId), isNull(sources.archivedAt), filter.kind ? eq(sources.kind, filter.kind) : undefined, ks.after(p.cursor)))
      .orderBy(...ks.orderBy)
      .limit(p.limit + 1);
    return toPage(rows, p, ks);
  },

  async getSource(db: Executor, businessId: string, sourceId: string): Promise<Source> {
    return one(await db.select().from(sources).where(and(eq(sources.businessId, businessId), eq(sources.id, sourceId))).limit(1), "source", sourceId);
  },

  async createSource(db: Executor, businessId: string, input: CreateSourceInput): Promise<Source> {
    const v = parseInput(CreateSourceInput, input, "source");
    return one(
      await db
        .insert(sources)
        .values({ businessId, kind: v.kind, uri: v.uri ?? null, title: v.title, contentRef: v.contentRef ?? null, embedding: v.embedding ?? null, relevance: v.relevance, fetchedAt: v.fetchedAt ?? null })
        .returning(),
      "source",
    );
  },

  async updateSource(db: Executor, businessId: string, sourceId: string, input: Partial<CreateSourceInput>): Promise<Source> {
    const v = parseInput(patchSchema(CreateSourceInput), input, "source update");
    return one(await db.update(sources).set(changes(v, "source")).where(and(eq(sources.businessId, businessId), eq(sources.id, sourceId))).returning(), "source", sourceId);
  },

  async archiveSource(db: Executor, businessId: string, sourceId: string): Promise<Source> {
    return one(await db.update(sources).set({ archivedAt: new Date() }).where(and(eq(sources.businessId, businessId), eq(sources.id, sourceId))).returning(), "source", sourceId);
  },

  /** The source row locked until the transaction ends (two Source Watcher reads of one source write one after the other). */
  async lockSource(db: Executor, businessId: string, sourceId: string): Promise<Source> {
    return one(await db.select().from(sources).where(and(eq(sources.businessId, businessId), eq(sources.id, sourceId))).for("update").limit(1), "source", sourceId);
  },

  /**
   * Sources the Source Watcher should (re)read: live ones it never read (no `relevance.watch`, which includes rows
   * written before it existed in the old `{ score, sections }` shape, so the Sources and Research tabs fill in for
   * them too), reads that failed (whatever the kind: the Sources tab promises a failed read is tried again on the next
   * sweep), and web pages (which change) last checked (read, or found unreadable: `relevance.watch.checkedAt`) before
   * `staleBefore`, oldest first. A note or a file that was read is not read again. Import sources (read once by the
   * import, `relevance.import`) are left to it.
   */
  async listSourcesToWatch(db: Executor, businessId: string, input: { staleBefore: Date; limit?: number }): Promise<Source[]> {
    const limit = Math.min(Math.max(Math.trunc(input.limit ?? 20), 1), 200);
    const checkedAt = sql`coalesce((${sources.relevance} -> 'watch' ->> 'checkedAt')::timestamptz, ${sources.fetchedAt})`;
    const neverWatched = sql`(${sources.relevance} -> 'watch') is null`;
    const failed = sql`(${sources.relevance} -> 'watch' ->> 'status') = 'failed'`;
    return db
      .select()
      .from(sources)
      .where(
        and(
          eq(sources.businessId, businessId),
          isNull(sources.archivedAt),
          sql`(${sources.relevance} -> 'import') is null`,
          sql`(${checkedAt} is null or ${neverWatched} or ${failed} or (${sources.uri} ~* '^https?://' and ${checkedAt} < ${input.staleBefore.toISOString()}::timestamptz))`,
        ),
      )
      .orderBy(sql`${checkedAt} asc nulls first`, asc(sources.createdAt))
      .limit(limit);
  },

  /** Convenience for the Source Watcher: the most recently fetched source per uri (null when never fetched). */
  async findSourceByUri(db: Executor, businessId: string, uri: string): Promise<Source | null> {
    return maybeOne(await db.select().from(sources).where(and(eq(sources.businessId, businessId), eq(sources.uri, uri), isNull(sources.archivedAt))).orderBy(desc(sources.createdAt)).limit(1));
  },
};

// --- deciding proposals -----------------------------------------------------------------------------------------------

/** The proposal row, locked until the transaction ends (decisions on one proposal run one at a time). */
async function lockProposal(tx: Executor, businessId: string, proposalId: string): Promise<ChangeProposal> {
  return one(await tx.select().from(changeProposals).where(and(eq(changeProposals.businessId, businessId), eq(changeProposals.id, proposalId))).for("update").limit(1), "proposal", proposalId);
}

/** Writes an accepted (or edited) hunk into its spec block or roadmap item; see `decideHunk`. */
async function applyHunk(tx: Executor, businessId: string, proposal: ChangeProposal, hunk: ProposalHunk, decision: "accepted" | "edited", opts: DecideOptions): Promise<AppliedHunk> {
  const target = hunk.specBlockId ? ({ kind: "spec_block", id: hunk.specBlockId } as const) : ({ kind: "roadmap_item", id: hunk.roadmapItemId! } as const);
  const result: AppliedHunk = { hunkId: hunk.id, decision, target, changed: false, merged: false, conflicts: 0, skipped: null };
  if (!hunk.theirs) return { ...result, skipped: "no_content" };
  const base = hunk.base ?? hunk.ours;

  if (target.kind === "spec_block") {
    const block = maybeOne(await tx.select().from(specBlocks).where(and(eq(specBlocks.businessId, businessId), eq(specBlocks.id, target.id))).limit(1));
    if (!block || block.archivedAt) return { ...result, skipped: "archived" };
    const merge = mergeBlockContent(base, block.content, hunk.theirs);
    if (sameContent(merge.content, block.content)) return { ...result, merged: merge.merged, conflicts: merge.conflicts };
    // Accepting writes the proposer's text (an agent's, or the system's); saving an edit writes the founder's and pins it.
    const author =
      decision === "edited"
        ? { authoredByKind: "user" as const, authoredBy: opts.decidedBy ?? null, pinned: true }
        : { authoredByKind: proposal.proposedByAgentId ? ("agent" as const) : ("system" as const), authoredBy: proposal.proposedByAgentId ?? null };
    await tx
      .update(specBlocks)
      .set({ content: merge.content, ...author, version: sql`${specBlocks.version} + 1` })
      .where(and(eq(specBlocks.businessId, businessId), eq(specBlocks.id, block.id)));
    return { ...result, changed: true, merged: merge.merged, conflicts: merge.conflicts };
  }

  const item = maybeOne(await tx.select().from(roadmapItems).where(and(eq(roadmapItems.businessId, businessId), eq(roadmapItems.id, target.id))).limit(1));
  if (!item || item.archivedAt) return { ...result, skipped: "archived" };
  const merge = mergeBlockContent(base, textDoc(item.descriptionMd), hunk.theirs);
  const descriptionMd = docText(merge.content);
  if (descriptionMd === item.descriptionMd) return { ...result, merged: merge.merged, conflicts: merge.conflicts };
  await tx.update(roadmapItems).set({ descriptionMd }).where(and(eq(roadmapItems.businessId, businessId), eq(roadmapItems.id, item.id)));
  return { ...result, changed: true, merged: merge.merged, conflicts: merge.conflicts };
}

/** Settles the proposal from its hunks and, when this decision settled it with something accepted, publishes the version. */
async function finishDecision(tx: Executor, businessId: string, proposal: ChangeProposal, applied: AppliedHunk[], opts: DecideOptions): Promise<ProposalDecisionResult> {
  const settled = await productRepo.settleProposal(tx, businessId, proposal.id);
  if (settled.status === "open" || proposal.status !== "open") return { ...settled, applied, published: null };
  const counts = { accepted: 0, rejected: 0, edited: 0 };
  for (const h of settled.hunks) if (h.decision !== "pending") counts[h.decision] += 1;
  if (counts.accepted + counts.edited === 0) return { ...settled, applied, published: null };

  const blockIds = [...new Set(settled.hunks.map((h) => h.specBlockId).filter((x): x is string => Boolean(x)))];
  const itemIds = [...new Set(settled.hunks.map((h) => h.roadmapItemId).filter((x): x is string => Boolean(x)))];
  const blocks = blockIds.length ? await tx.select({ id: specBlocks.id, section: specBlocks.section }).from(specBlocks).where(and(eq(specBlocks.businessId, businessId), inArray(specBlocks.id, blockIds))) : [];
  const items = itemIds.length ? await tx.select({ id: roadmapItems.id, title: roadmapItems.title }).from(roadmapItems).where(and(eq(roadmapItems.businessId, businessId), inArray(roadmapItems.id, itemIds))) : [];
  const labelOf = (h: Pick<ProposalHunk, "specBlockId" | "roadmapItemId">) =>
    h.specBlockId ? (blocks.find((b) => b.id === h.specBlockId)?.section ?? "A spec block") : `Roadmap: ${items.find((i) => i.id === h.roadmapItemId)?.title ?? "an item"}`;
  const changelogMd = proposalChangelog(settled.title, settled.hunks, labelOf);

  const { version, previousVersion } = await productRepo.publish(tx, businessId, { changelogMd, publishedBy: opts.decidedBy ?? null });
  const changedBlockIds = [...new Set(settled.hunks.filter((h) => h.specBlockId && (h.decision === "accepted" || h.decision === "edited")).map((h) => h.specBlockId!))];
  return { ...settled, applied, published: { version, previousVersion, changedBlockIds, counts } };
}
