/**
 * product.foundations.* / product.spec.* / product.roadmap.* / product.proposals.* / product.sources.* (BUILD §11.1
 * first open, §11.5; AC-11.5.2, AC-11.5.3).
 */
import { EditSpecBlockInput, UpsertRoadmapItemInput, repos, type AppliedHunk, type Executor, type ProposalDecisionResult } from "@foundmill/db";
import { HUNK_DECISIONS, SOURCE_KINDS, ValidationError, WRITE_ROLES } from "@foundmill/shared";
import { z } from "zod";
import { ensureFoundations, foundationsView, isStale, retryFoundations } from "../services/foundations";
import { modelLimited } from "../services/model-limits";
import { WORKFLOWS, workflowIds } from "../services/temporal";
import { Id, audit, businessProcedure, effectivePermission, emit, router, sectionRead, sectionWrite, type BusinessContext } from "../trpc";

const read = sectionRead("product");
const write = sectionWrite("product");

/** How much of the founder's notes reads as the summary before the Source Watcher writes its own. */
const SUMMARY_PREVIEW_CHARS = 400;

/**
 * What a member may say about a source they add: its kind, link, title and notes (or pasted text). Relevance, fetch
 * times and embeddings are the Source Watcher's to write, never the client's.
 */
const AddSourceInput = z.object({
  kind: z.enum(SOURCE_KINDS),
  uri: z
    .string()
    .trim()
    .max(2048)
    .refine((u) => !u || /^https?:\/\//i.test(u), "Links must start with http:// or https://")
    .nullish(),
  title: z.string().max(400).default(""),
  contentRef: z.string().max(2048).nullish(),
  relevance: z.object({ notes: z.string().max(20_000).optional(), summary: z.string().max(20_000).optional() }).optional(),
});

/** What each accepted hunk did, for the audit row (merged into edits made since the proposal, archived target...). */
function appliedDetails(applied: readonly AppliedHunk[]) {
  return applied.map((a) => ({ hunkId: a.hunkId, target: a.target, changed: a.changed, merged: a.merged, conflicts: a.conflicts, skipped: a.skipped }));
}

/**
 * A decision that settled the proposal with accepted hunks published a version: announce it through the outbox in the
 * same transaction (Development re-plans and Distribution reviews messaging from it) and audit the publish. Returns the
 * proposal with the version it published, if any.
 */
async function settleResult(tx: Executor, ctx: Pick<BusinessContext, "businessId" | "userId">, result: ProposalDecisionResult) {
  const { applied: _applied, published, ...proposal } = result;
  if (published) {
    const { version, previousVersion, changedBlockIds, counts } = published;
    await emit(tx, ctx, { type: "spec.version_published", payload: { specVersionId: version.id, version: version.version, previousVersion, proposalId: proposal.id, changedBlockIds, changelog: version.changelogMd.slice(0, 4000), hunksAccepted: counts.accepted, hunksRejected: counts.rejected, hunksEdited: counts.edited } });
    await audit(tx, ctx, { action: "product.spec.publish", target: { kind: "spec_version", id: version.id }, details: { version: version.version, proposalId: proposal.id } });
  }
  return { ...proposal, publishedVersion: published?.version ?? null };
}

export const productRouter = router({
  /**
   * The business's foundations: the vision, the first specification and the first roadmap, drafted once on the first
   * open. `ensure` is what the business shell calls on load (any member; idempotent: a member with product write
   * claims a pending draft exactly once and never waits for the drafting); `retry` re-runs a failed one.
   */
  foundations: router({
    get: read.query(async ({ ctx }) => {
      const row = await ctx.rls((tx) => repos.foundations.get(tx, ctx.businessId));
      return { ...foundationsView(row), stale: row ? isStale(row, new Date()) : false };
    }),
    ensure: businessProcedure.mutation(async ({ ctx }) => {
      // Only a member who can write the product claims and starts the drafting (a viewer opening first leaves it
      // pending for the founder). Everyone gets where it stands, and nothing more: the vision, the summary and the
      // reason of a failure are read through `get` (product read permission).
      const canStart = WRITE_ROLES.includes(ctx.role) && effectivePermission(ctx.membership, "product") === "write";
      const { view, started } = await ensureFoundations({ db: ctx.db, models: ctx.models, temporal: ctx.temporal, log: ctx.log }, ctx.businessId, { userId: ctx.userId, canStart });
      return { status: view.status, door: view.door, attempt: view.attempt, startedAt: view.startedAt, finishedAt: view.finishedAt, started };
    }),
    retry: write.use(modelLimited("foundations")).mutation(async ({ ctx }) => {
      const result = await retryFoundations({ db: ctx.db, models: ctx.models, temporal: ctx.temporal, log: ctx.log }, ctx.businessId, { userId: ctx.userId });
      if (!result.started && result.view.status !== "drafting") throw new ValidationError(result.view.status === "none" ? "This business has no drafting to retry" : `Nothing to retry: the drafting is ${result.view.status}`);
      return { ...result.view, started: result.started, stale: false };
    }),
  }),

  spec: router({
    get: read.input(z.object({ section: z.string().max(80).optional() })).query(({ ctx, input }) =>
      ctx.rls(async (tx) => {
        const [blocks, versions] = await Promise.all([repos.product.listBlocks(tx, ctx.businessId, input ?? {}), repos.product.listVersions(tx, ctx.businessId)]);
        return { blocks, latestVersion: versions[0] ?? null, versionCount: versions.length };
      }),
    ),
    /** Human edit of a block (pins it: agents never overwrite pinned blocks without an accepted hunk, AC-11.5.3). */
    editBlock: write.input(z.object({ blockId: Id, patch: EditSpecBlockInput })).mutation(({ ctx, input }) =>
      ctx.rls(async (tx) => {
        const block = await repos.product.editBlock(tx, ctx.businessId, input.blockId, { ...input.patch, authoredByKind: "user", authoredBy: ctx.userId, pinned: input.patch.pinned ?? true });
        await audit(tx, ctx, { action: "product.spec.edit_block", target: { kind: "spec_block", id: block.id }, details: { fields: Object.keys(input.patch) } });
        return block;
      }),
    ),
    versions: read.query(({ ctx }) => ctx.rls((tx) => repos.product.listVersions(tx, ctx.businessId))),
    compare: read.input(z.object({ from: z.number().int().positive(), to: z.number().int().positive() })).query(({ ctx, input }) =>
      ctx.rls(async (tx) => {
        const [from, to] = await Promise.all([repos.product.getVersion(tx, ctx.businessId, input.from), repos.product.getVersion(tx, ctx.businessId, input.to)]);
        return { from, to };
      }),
    ),
    publish: write.input(z.object({ changelogMd: z.string().max(4000).default("") })).mutation(({ ctx, input }) =>
      ctx.rls(async (tx) => {
        const versions = await repos.product.listVersions(tx, ctx.businessId);
        const blocks = await repos.product.listBlocks(tx, ctx.businessId);
        const version = await repos.product.publishVersion(tx, ctx.businessId, { changelogMd: input.changelogMd, publishedBy: ctx.userId });
        await emit(tx, ctx, { type: "spec.version_published", payload: { specVersionId: version.id, version: version.version, previousVersion: versions[0]?.version ?? null, changedBlockIds: blocks.map((b) => b.id), changelog: input.changelogMd, hunksAccepted: 0, hunksRejected: 0, hunksEdited: 0 } });
        await audit(tx, ctx, { action: "product.spec.publish", target: { kind: "spec_version", id: version.id }, details: { version: version.version } });
        return version;
      }),
    ),
    restore: write.input(z.object({ version: z.number().int().positive() })).mutation(({ ctx, input }) =>
      ctx.rls(async (tx) => {
        const blocks = await repos.product.restoreVersion(tx, ctx.businessId, input.version);
        await audit(tx, ctx, { action: "product.spec.restore", target: { kind: "spec_version", id: String(input.version) }, details: { blocks: blocks.length } });
        return blocks;
      }),
    ),
  }),

  roadmap: router({
    list: read.input(z.object({ horizon: z.enum(["now", "next", "later"]).optional(), status: z.string().max(40).optional() })).query(({ ctx, input }) =>
      ctx.rls(async (tx) => {
        const [items, dependencies, tasks] = await Promise.all([repos.product.listRoadmap(tx, ctx.businessId, input ?? {}), repos.product.listDependencies(tx, ctx.businessId), repos.tasks.list(tx, ctx.businessId, { limit: 500 })]);
        return { items: items.map((i) => ({ ...i, tasks: tasks.items.filter((t) => t.roadmapItemId === i.id).map((t) => ({ id: t.id, title: t.title, status: t.status, progress: t.progress })) })), dependencies };
      }),
    ),
    upsert: write.input(UpsertRoadmapItemInput).mutation(({ ctx, input }) =>
      ctx.rls(async (tx) => {
        const item = await repos.product.upsertRoadmapItem(tx, ctx.businessId, input);
        await audit(tx, ctx, { action: "product.roadmap.upsert", target: { kind: "roadmap_item", id: item.id }, details: { horizon: item.horizon } });
        return item;
      }),
    ),
    /** Link two items (dependency) or a block/task to an item. */
    link: write.input(z.object({ itemId: Id, dependsOn: Id.optional(), specBlockIds: z.array(Id).optional(), taskIds: z.array(Id).optional() })).mutation(({ ctx, input }) =>
      ctx.rls(async (tx) => {
        const item = await repos.product.getRoadmapItem(tx, ctx.businessId, input.itemId);
        if (input.dependsOn) await repos.product.linkRoadmap(tx, ctx.businessId, input.dependsOn, input.itemId);
        if (input.specBlockIds) await repos.product.upsertRoadmapItem(tx, ctx.businessId, { id: item.id, title: item.title, descriptionMd: item.descriptionMd, horizon: item.horizon, specBlockIds: [...new Set([...item.specBlockIds, ...input.specBlockIds])], status: item.status });
        for (const taskId of input.taskIds ?? []) await repos.tasks.update(tx, ctx.businessId, taskId, { roadmapItemId: item.id });
        await audit(tx, ctx, { action: "product.roadmap.link", target: { kind: "roadmap_item", id: item.id }, details: { dependsOn: input.dependsOn ?? null, specBlocks: input.specBlockIds?.length ?? 0, tasks: input.taskIds?.length ?? 0 } });
        return repos.product.getRoadmapItem(tx, ctx.businessId, item.id);
      }),
    ),
  }),

  /** Sources the Source Watcher reads (docs, issues, feedback, transcripts, competitor pages, legal, finance). */
  sources: router({
    list: read.input(z.object({ kind: z.enum(SOURCE_KINDS).optional(), limit: z.number().int().min(1).max(500).default(100), cursor: z.string().nullish() })).query(({ ctx, input }) => ctx.rls((tx) => repos.product.listSources(tx, ctx.businessId, input ?? {}))),
    get: read.input(z.object({ sourceId: Id })).query(({ ctx, input }) => ctx.rls((tx) => repos.product.getSource(tx, ctx.businessId, input.sourceId))),
    /**
     * Add by hand (a link, a pasted note, a competitor page); the title falls back to the uri. The founder's notes are
     * kept as `notes` and read as the summary until the Source Watcher has read the source: `source.added` goes through
     * the outbox with the row, then the `sourceWatch` workflow fetches it through the gateway, scores it against the
     * spec and may raise a change proposal. When Temporal is unreachable the nightly sweep picks the source up instead.
     */
    add: write.input(AddSourceInput).mutation(async ({ ctx, input }) => {
      const title = input.title?.trim() || input.uri?.trim() || "";
      if (!title) throw new ValidationError("Give the source a title or a link");
      const notes = (input.relevance?.notes ?? input.relevance?.summary ?? "").trim();
      const source = await ctx.rls(async (tx) => {
        const row = await repos.product.createSource(tx, ctx.businessId, {
          kind: input.kind,
          uri: input.uri?.trim() || null,
          title: title.slice(0, 400),
          contentRef: input.contentRef ?? null,
          relevance: { ...(notes ? { notes, summary: notes.slice(0, SUMMARY_PREVIEW_CHARS) } : {}), addedBy: "user" },
        });
        await emit(tx, ctx, { type: "source.added", payload: { sourceId: row.id, kind: row.kind, title: row.title, uri: row.uri, addedBy: "user" } });
        await audit(tx, ctx, { action: "product.sources.add", target: { kind: "source", id: row.id }, details: { kind: row.kind, uri: row.uri } });
        return row;
      });
      const watch = await ctx.temporal.start(WORKFLOWS.sourceWatch, { workflowId: workflowIds.sourceWatch(source.id), args: [{ businessId: ctx.businessId, sourceIds: [source.id], reason: "added" }] });
      return { ...source, watch: { queued: watch.queued, ...(watch.reason ? { reason: watch.reason } : {}) } };
    }),
    remove: write.input(z.object({ sourceId: Id })).mutation(({ ctx, input }) =>
      ctx.rls(async (tx) => {
        const source = await repos.product.archiveSource(tx, ctx.businessId, input.sourceId);
        await audit(tx, ctx, { action: "product.sources.remove", target: { kind: "source", id: source.id } });
        return source;
      }),
    ),
  }),

  proposals: router({
    list: read.input(z.object({ status: z.enum(["open", "accepted", "partially_accepted", "rejected"]).optional(), limit: z.number().int().min(1).max(200).default(50), cursor: z.string().nullish() })).query(({ ctx, input }) => ctx.rls((tx) => repos.product.listProposals(tx, ctx.businessId, input ?? {}))),
    get: read.input(z.object({ proposalId: Id })).query(({ ctx, input }) => ctx.rls((tx) => repos.product.getProposal(tx, ctx.businessId, input.proposalId))),
    /**
     * Accepting (or saving an edit of) a hunk writes it into its block or roadmap item; deciding the last pending hunk
     * settles the proposal and, when anything was accepted, publishes the next spec version (`spec.version_published`).
     */
    decideHunk: write.input(z.object({ hunkId: Id, decision: z.enum(HUNK_DECISIONS), edited: z.record(z.string(), z.unknown()).optional() })).mutation(({ ctx, input }) =>
      ctx.rls(async (tx) => {
        if (input.decision === "pending") throw new ValidationError("Choose accept, reject or edited");
        const result = await repos.product.decideHunk(tx, ctx.businessId, input.hunkId, input.decision, input.edited, { decidedBy: ctx.userId });
        await audit(tx, ctx, { action: "product.proposals.decide_hunk", target: { kind: "proposal_hunk", id: input.hunkId }, details: { decision: input.decision, proposalId: result.id, applied: appliedDetails(result.applied) } });
        return settleResult(tx, ctx, result);
      }),
    ),
    acceptAll: write.input(z.object({ proposalId: Id })).mutation(({ ctx, input }) =>
      ctx.rls(async (tx) => {
        const result = await repos.product.acceptAll(tx, ctx.businessId, input.proposalId, { decidedBy: ctx.userId });
        await audit(tx, ctx, { action: "product.proposals.accept_all", target: { kind: "proposal", id: result.id }, details: { applied: appliedDetails(result.applied) } });
        return settleResult(tx, ctx, result);
      }),
    ),
    reject: write.input(z.object({ proposalId: Id })).mutation(({ ctx, input }) =>
      ctx.rls(async (tx) => {
        const result = await repos.product.rejectProposal(tx, ctx.businessId, input.proposalId, { decidedBy: ctx.userId });
        await audit(tx, ctx, { action: "product.proposals.reject", target: { kind: "proposal", id: result.id } });
        return settleResult(tx, ctx, result);
      }),
    ),
  }),
});
