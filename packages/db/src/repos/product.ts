/**
 * product — spec blocks, spec versions, change proposals + hunks, roadmap, sources
 * (BUILD §11.5; routers product.spec.*, product.roadmap.*, product.proposals.*).
 */
import { HUNK_DECISIONS, ROADMAP_HORIZONS, SEVERITIES, SOURCE_KINDS, ValidationError, type PROPOSAL_STATUSES } from "@foundmill/shared";
import { and, asc, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import {
  AUTHOR_KINDS, changeProposals, proposalHunks, roadmapDependencies, roadmapItems, sources, specBlocks, specVersions,
  type ChangeProposal, type ProposalHunk, type RoadmapDependency, type RoadmapItem, type Source, type SpecBlock, type SpecVersion,
} from "../schema";
import { defined, Id, JsonObject, maybeOne, one, PageInput, parseInput, timeKeyset, toPage, type Executor, type Page, patchSchema } from "./_shared";

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
  content: JsonObject.optional(),
  sources: z.array(Id).optional(),
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
  specBlockIds: z.array(Id).default([]),
  status: z.string().max(40).default("planned"),
  position: z.number().int().min(0).optional(),
});
export type UpsertRoadmapItemInput = z.input<typeof UpsertRoadmapItemInput>;

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

  async createBlock(db: Executor, businessId: string, input: CreateSpecBlockInput): Promise<SpecBlock> {
    const v = parseInput(CreateSpecBlockInput, input, "spec block");
    const position =
      v.position ??
      Number(
        one(
          await db.select({ n: sql<number>`coalesce(max(${specBlocks.position}), -1) + 1` }).from(specBlocks).where(and(eq(specBlocks.businessId, businessId), eq(specBlocks.section, v.section))),
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

  async archiveBlock(db: Executor, businessId: string, blockId: string): Promise<SpecBlock> {
    return one(await db.update(specBlocks).set({ archivedAt: new Date() }).where(and(eq(specBlocks.businessId, businessId), eq(specBlocks.id, blockId))).returning(), "spec block", blockId);
  },

  async listVersions(db: Executor, businessId: string): Promise<SpecVersion[]> {
    return db.select().from(specVersions).where(eq(specVersions.businessId, businessId)).orderBy(desc(specVersions.version));
  },

  async getVersion(db: Executor, businessId: string, version: number): Promise<SpecVersion> {
    return one(await db.select().from(specVersions).where(and(eq(specVersions.businessId, businessId), eq(specVersions.version, version))).limit(1), "spec version", String(version));
  },

  /** Publishes a snapshot as the next version number (max + 1). Without a snapshot, the live blocks are snapshotted. */
  async publishVersion(db: Executor, businessId: string, input: { snapshot?: Record<string, unknown>; changelogMd?: string; publishedBy?: string | null }): Promise<SpecVersion> {
    const v = parseInput(z.object({ snapshot: JsonObject.optional(), changelogMd: z.string().default(""), publishedBy: Id.nullable().optional() }), input, "spec version");
    return db.transaction(async (tx) => {
      const snapshot = v.snapshot ?? { blocks: await productRepo.listBlocks(tx, businessId) };
      const next = one(await tx.select({ n: sql<number>`coalesce(max(${specVersions.version}), 0) + 1` }).from(specVersions).where(eq(specVersions.businessId, businessId)), "version");
      return one(
        await tx.insert(specVersions).values({ businessId, version: Number(next.n), snapshot, changelogMd: v.changelogMd, publishedBy: v.publishedBy ?? null }).returning(),
        "spec version",
      );
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

  async createProposal(db: Executor, businessId: string, input: CreateProposalInput): Promise<ProposalWithHunks> {
    const v = parseInput(CreateProposalInput, input, "proposal");
    return db.transaction(async (tx) => {
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
          v.hunks.map((h, i) => ({
            businessId,
            proposalId: proposal.id,
            specBlockId: h.specBlockId ?? null,
            roadmapItemId: h.roadmapItemId ?? null,
            base: h.base ?? null,
            ours: h.ours ?? null,
            theirs: h.theirs ?? null,
            position: h.position ?? i,
          })),
        )
        .returning();
      return { ...proposal, hunks };
    });
  },

  /** Decides one hunk; when every hunk is decided the proposal status follows (accepted / partially_accepted / rejected). */
  async decideHunk(db: Executor, businessId: string, hunkId: string, decision: (typeof HUNK_DECISIONS)[number], edited?: Record<string, unknown>): Promise<ProposalWithHunks> {
    const d = parseInput(z.enum(HUNK_DECISIONS), decision, "hunk decision");
    return db.transaction(async (tx) => {
      const hunk = one(
        await tx
          .update(proposalHunks)
          .set({ decision: d, ...(d === "edited" && edited ? { theirs: edited } : {}) })
          .where(and(eq(proposalHunks.businessId, businessId), eq(proposalHunks.id, hunkId)))
          .returning(),
        "hunk",
        hunkId,
      );
      return productRepo.settleProposal(tx, businessId, hunk.proposalId);
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

  async acceptAll(db: Executor, businessId: string, proposalId: string): Promise<ProposalWithHunks> {
    return db.transaction(async (tx) => {
      await tx.update(proposalHunks).set({ decision: "accepted" }).where(and(eq(proposalHunks.businessId, businessId), eq(proposalHunks.proposalId, proposalId), eq(proposalHunks.decision, "pending")));
      return productRepo.settleProposal(tx, businessId, proposalId);
    });
  },

  async rejectProposal(db: Executor, businessId: string, proposalId: string): Promise<ProposalWithHunks> {
    return db.transaction(async (tx) => {
      await tx.update(proposalHunks).set({ decision: "rejected" }).where(and(eq(proposalHunks.businessId, businessId), eq(proposalHunks.proposalId, proposalId), eq(proposalHunks.decision, "pending")));
      await tx.update(changeProposals).set({ status: "rejected", resolvedAt: new Date() }).where(and(eq(changeProposals.businessId, businessId), eq(changeProposals.id, proposalId)));
      return productRepo.getProposal(tx, businessId, proposalId);
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

  async getRoadmapItem(db: Executor, businessId: string, itemId: string): Promise<RoadmapItem> {
    return one(await db.select().from(roadmapItems).where(and(eq(roadmapItems.businessId, businessId), eq(roadmapItems.id, itemId))).limit(1), "roadmap item", itemId);
  },

  async upsertRoadmapItem(db: Executor, businessId: string, input: UpsertRoadmapItemInput): Promise<RoadmapItem> {
    const v = parseInput(UpsertRoadmapItemInput, input, "roadmap item");
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
      const existing = await db.select({ id: roadmapItems.id }).from(roadmapItems).where(and(eq(roadmapItems.businessId, businessId), eq(roadmapItems.id, v.id))).limit(1);
      if (existing.length) {
        return one(await db.update(roadmapItems).set(values).where(and(eq(roadmapItems.businessId, businessId), eq(roadmapItems.id, v.id))).returning(), "roadmap item", v.id);
      }
    }
    return one(await db.insert(roadmapItems).values({ ...(v.id ? { id: v.id } : {}), businessId, ...values }).returning(), "roadmap item");
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
    return one(await db.update(sources).set(defined(v)).where(and(eq(sources.businessId, businessId), eq(sources.id, sourceId))).returning(), "source", sourceId);
  },

  async archiveSource(db: Executor, businessId: string, sourceId: string): Promise<Source> {
    return one(await db.update(sources).set({ archivedAt: new Date() }).where(and(eq(sources.businessId, businessId), eq(sources.id, sourceId))).returning(), "source", sourceId);
  },

  /** Convenience for the Source Watcher: the most recently fetched source per uri (null when never fetched). */
  async findSourceByUri(db: Executor, businessId: string, uri: string): Promise<Source | null> {
    return maybeOne(await db.select().from(sources).where(and(eq(sources.businessId, businessId), eq(sources.uri, uri), isNull(sources.archivedAt))).orderBy(desc(sources.createdAt)).limit(1));
  },
};
