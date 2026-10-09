/**
 * business_foundations — the vision, first specification and first roadmap of a new business (BUILD §11.1 "Take
 * charge" → first open, §11.5; migration 0018).
 *
 * Lifecycle: `create` at commit (status pending) → `claim` on the first open (pending → drafting, attempt + 1, exactly
 * once: the update is conditional on the status, so two tabs or a reload never claim twice) → the drafting run reads
 * `inputs`, asks the model and calls `apply` (drafting → ready, in one transaction with every write) or `fail`
 * (drafting → failed). A failed row is claimed again by a retry. `apply` and `fail` only act for the attempt that is
 * current, so a slow run of an earlier attempt can never overwrite a newer one. While drafting, `writeProgress` stores
 * each part as it lands (0019; kept across attempts so a retry resumes, cleared by `apply`). Service-written (read-only policy):
 * the api writes it after its membership check, the orchestrator through its service role.
 */
import { and, eq, inArray, sql } from "drizzle-orm";
import type { FoundationsDraft, FoundationsInputs, FoundationsNoteStats, FoundationsOutlineEntry, FoundationsProgressAuthor, FoundationsProgressPatch, ImportReportSnapshot } from "@foundmill/agents";
import { FOUNDATIONS_DOORS, ROADMAP_HORIZONS, type Archetype, type FoundationsRunner, type FoundationsStatus, type RoadmapHorizon } from "@foundmill/shared";
import { z } from "zod";
import { agents, businessFoundations, type BusinessFoundationsRow, type InboxItem, type SpecBlock } from "../schema";
import { agentsRepo } from "./agents";
import { auditRepo } from "./audit";
import { businessesRepo } from "./businesses";
import { departmentsRepo } from "./departments";
import { foundersRepo } from "./founders";
import { ideasRepo } from "./ideas";
import { inboxRepo } from "./inbox";
import { productRepo } from "./product";
import { Id, JsonObject, maybeOne, parseInput, type Executor } from "./_shared";

export const CreateFoundationsInput = z.object({
  door: z.enum(FOUNDATIONS_DOORS),
  ideaId: Id.nullable().optional(),
  importJobId: z.string().min(8).max(8192).nullable().optional(),
  importReport: JsonObject.nullable().optional(),
});
export type CreateFoundationsInput = z.input<typeof CreateFoundationsInput>;

/** Plain text of a Tiptap document (one line per paragraph, heading or list item). */
function pmText(doc: unknown): string {
  const lines: string[] = [];
  const inline = (n: { text?: unknown; content?: unknown }): string => (typeof n.text === "string" ? n.text : Array.isArray(n.content) ? (n.content as object[]).map((c) => inline(c)).join("") : "");
  const walk = (n: unknown) => {
    if (!n || typeof n !== "object") return;
    const node = n as { type?: unknown; content?: unknown };
    if (node.type === "paragraph" || node.type === "heading") {
      const t = inline(node).trim();
      if (t) lines.push(t);
    } else if (Array.isArray(node.content)) for (const c of node.content) walk(c);
  };
  walk(doc);
  return lines.join("\n");
}

const META_KIND = "foundmill:meta";
const str = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : null);

export interface ApplyFoundationsOptions {
  /** The Inbox update posted when the foundations are ready (from the author agent); null posts none. */
  note: ((stats: FoundationsNoteStats) => { subject: string; bodyMd: string }) | null;
  /** Model metadata kept in the summary (route, model id, mode, cost in minor units as an Estimate). */
  model?: Record<string, unknown>;
  /**
   * Called inside the transaction right after the Inbox note is created, to write its `inbox.item_created` event
   * through the outbox (`repos.events.write` on the same `tx`): the item and its event commit or roll back together.
   */
  onInboxItem?: (tx: Executor, item: InboxItem) => Promise<unknown>;
  /** Called inside the transaction once everything is written (the `foundations.progressed` "ready" event, outbox). */
  onApplied?: (tx: Executor, stats: FoundationsNoteStats) => Promise<unknown>;
}

export interface ApplyFoundationsResult {
  applied: boolean;
  row: BusinessFoundationsRow | null;
  stats: FoundationsNoteStats | null;
  inboxItem: InboxItem | null;
  writtenBlockIds: string[];
  roadmapItemIds: string[];
}

export const foundationsRepo = {
  async get(db: Executor, businessId: string): Promise<BusinessFoundationsRow | null> {
    return maybeOne(await db.select().from(businessFoundations).where(eq(businessFoundations.businessId, businessId)).limit(1));
  },

  /** Commit: the row in status pending. Idempotent (one row per business; a second call returns the first row). */
  async create(db: Executor, businessId: string, input: CreateFoundationsInput): Promise<BusinessFoundationsRow> {
    const v = parseInput(CreateFoundationsInput, input, "business foundations");
    const inserted = await db
      .insert(businessFoundations)
      .values({ businessId, door: v.door, ideaId: v.ideaId ?? null, importJobId: v.importJobId ?? null, importReport: v.importReport ?? null, status: "pending" })
      .onConflictDoNothing({ target: businessFoundations.businessId })
      .returning();
    return inserted[0] ?? (await foundationsRepo.get(db, businessId))!;
  },

  /**
   * Claim the drafting: `from` → drafting, attempt + 1, timestamps and error reset. Returns the claimed row, or null
   * when the row is not in one of the `from` statuses (someone else claimed it, or there is nothing to draft).
   */
  async claim(db: Executor, businessId: string, from: readonly FoundationsStatus[] = ["pending"]): Promise<BusinessFoundationsRow | null> {
    const rows = await db
      .update(businessFoundations)
      .set({ status: "drafting", attempt: sql`${businessFoundations.attempt} + 1`, startedAt: new Date(), finishedAt: null, error: null, runner: null, workflowId: null })
      .where(and(eq(businessFoundations.businessId, businessId), inArray(businessFoundations.status, [...from])))
      .returning();
    return rows[0] ?? null;
  },

  /** Record where the claimed attempt runs (Temporal workflow id, or the api's in-process fallback). */
  async setRunner(db: Executor, businessId: string, attempt: number, runner: { runner: FoundationsRunner; workflowId: string | null }): Promise<BusinessFoundationsRow | null> {
    const rows = await db
      .update(businessFoundations)
      .set({ runner: runner.runner, workflowId: runner.workflowId })
      .where(and(eq(businessFoundations.businessId, businessId), eq(businessFoundations.attempt, attempt), eq(businessFoundations.status, "drafting")))
      .returning();
    return rows[0] ?? null;
  },

  /**
   * Store what the drafting produced so far (audit P3), for the current drafting attempt only and atomically: `replace`
   * starts over, `set` replaces top-level keys, `section` merges one section into `sections` on its own, so parallel
   * batches (separate api calls or orchestrator activities) never overwrite each other. `onWritten` runs in the same
   * transaction with the stored progress (the `foundations.progressed` event goes through the outbox with it). Returns
   * the stored progress, or null when the attempt is no longer the current drafting one (nothing is written).
   */
  async writeProgress(db: Executor, businessId: string, attempt: number, patch: FoundationsProgressPatch, options: { onWritten?: (tx: Executor, progress: Record<string, unknown>) => Promise<unknown> } = {}): Promise<Record<string, unknown> | null> {
    const t = businessFoundations;
    const current = sql`coalesce(${t.progress}, '{}'::jsonb)`;
    const value =
      "replace" in patch
        ? sql`${JSON.stringify(patch.replace)}::jsonb`
        : "set" in patch
          ? sql`${current} || ${JSON.stringify(patch.set)}::jsonb`
          : sql`jsonb_set(${current}, '{sections}', coalesce(${t.progress} -> 'sections', '{}'::jsonb) || jsonb_build_object(${patch.section.section}::text, ${JSON.stringify(patch.section)}::jsonb))`;
    return db.transaction(async (tx) => {
      const rows = await tx
        .update(t)
        .set({ progress: value })
        .where(and(eq(t.businessId, businessId), eq(t.attempt, attempt), eq(t.status, "drafting")))
        .returning({ progress: t.progress });
      const progress = rows[0]?.progress ?? null;
      if (progress && options.onWritten) await options.onWritten(tx, progress);
      return progress;
    });
  },

  /** The drafting's author as the screens name it ("Mira, Product lead, is writing the vision"); null when unknown. */
  async author(db: Executor, businessId: string, agentId: string | null): Promise<FoundationsProgressAuthor | null> {
    if (!agentId) return null;
    const rows = await db.select({ id: agents.id, name: agents.name, role: agents.role }).from(agents).where(and(eq(agents.businessId, businessId), eq(agents.id, agentId))).limit(1);
    const a = rows[0];
    return a ? { agentId: a.id, name: a.name || null, role: a.role || null } : null;
  },

  /** drafting → failed for the current attempt (a later retry claims it again). */
  async fail(db: Executor, businessId: string, attempt: number, error: string): Promise<BusinessFoundationsRow | null> {
    const rows = await db
      .update(businessFoundations)
      .set({ status: "failed", error: error.slice(0, 1000), finishedAt: new Date() })
      .where(and(eq(businessFoundations.businessId, businessId), eq(businessFoundations.attempt, attempt), eq(businessFoundations.status, "drafting")))
      .returning();
    const row = rows[0] ?? null;
    if (row) await auditRepo.append(db, businessId, { actorKind: "system", action: "foundations.failed", target: { kind: "business_foundations", id: row.id }, details: { attempt, error: error.slice(0, 300) } });
    return row;
  },

  /** Everything the drafting reads, from the business's own rows (BUILD §11.1 Door A and Door B inputs). */
  async inputs(db: Executor, businessId: string): Promise<FoundationsInputs> {
    const [business, row] = await Promise.all([businessesRepo.get(db, businessId), foundationsRepo.get(db, businessId)]);
    const door = row?.door ?? "ideation";

    // The committed idea (Door A's card; Door B's card drafted from the Import report).
    const committed = await ideasRepo.forBusiness(db, businessId);
    const version = committed ? (committed.versions.find((v) => v.id === committed.idea.currentVersionId) ?? committed.versions[committed.versions.length - 1] ?? null) : null;
    const citations = ((version?.research as { citations?: unknown[] } | undefined)?.citations ?? []).filter((c): c is Record<string, unknown> => Boolean(c) && typeof c === "object");
    const meta = citations.find((c) => c.kind === META_KIND) ?? {};
    const attributes = Object.entries((version?.attributes ?? {}) as Record<string, { value?: number; evidence?: string }>).map(([key, a]) => ({ key, label: key, value: Number(a?.value ?? 0), evidence: str(a?.evidence) }));
    const idea = committed
      ? {
          title: version?.title ?? committed.idea.title,
          pitch: version?.pitch ?? committed.idea.pitch,
          archetype: (committed.idea.archetype ?? null) as Archetype | null,
          starsCurrent: Number(version?.starsCurrent ?? 0),
          starsPotential: Number(version?.starsPotential ?? 0),
          attributes,
          citations: citations.filter((c) => c.kind !== META_KIND).map((c) => ({ title: str(c.title) ?? "", url: str(c.url) ?? "", note: str(c.note) ?? "" })),
          qa: (Array.isArray(meta.qa) ? (meta.qa as Record<string, unknown>[]) : []).map((q) => ({ question: str(q?.question) ?? "", answer: str(q?.answer) ?? "" })).filter((q) => q.question),
        }
      : null;

    const profile = business.createdBy ? await foundersRepo.get(db, business.createdBy) : null;
    const founder = profile
      ? {
          experience: profile.experience,
          skills: profile.skills ?? {},
          timeCommitment: profile.timeCommitment,
          budget: profile.budgetMinor !== null && profile.budgetMinor !== undefined ? { amountMinor: Number(profile.budgetMinor), currency: profile.currency } : null,
          citizenship: profile.citizenship,
          residence: profile.residence,
          targetMarkets: profile.targetMarkets ?? [],
          constraints: profile.constraints ?? [],
          riskAppetite: profile.riskAppetite,
        }
      : null;

    // The outline: one entry per section, in the order commit wrote it, targeting the section's first block.
    const blocks = await productRepo.listBlocks(db, businessId);
    const bySection = new Map<string, SpecBlock[]>();
    for (const b of blocks) bySection.set(b.section, [...(bySection.get(b.section) ?? []), b]);
    const outline: FoundationsOutlineEntry[] = [...bySection.entries()]
      .map(([section, list]) => ({ section, list: [...list].sort((a, b) => a.position - b.position || a.createdAt.getTime() - b.createdAt.getTime()) }))
      .sort((a, b) => a.list[0]!.position - b.list[0]!.position || a.list[0]!.createdAt.getTime() - b.list[0]!.createdAt.getTime())
      .map(({ section, list }) => {
        const target = list[0]!;
        const text = list.map((b) => pmText(b.content)).filter(Boolean).join("\n");
        return { section, blockId: target.id, pinned: target.pinned, currentText: text || null };
      });

    // Imported sources (Door B): what commit linked from the Import job.
    const sources = await productRepo.listSources(db, businessId, { limit: 200 });
    const importedSources = sources.items
      .filter((s) => (s.relevance as Record<string, unknown>)?.import !== undefined)
      .map((s) => {
        const rel = s.relevance as Record<string, unknown>;
        const imp = (rel.import ?? {}) as Record<string, unknown>;
        return { id: s.id, kind: s.kind, title: s.title, uri: s.uri, summary: str(imp.summary) ?? str(rel.summary) };
      });

    const departments = await departmentsRepo.list(db, businessId, { includeHidden: true });
    const productLead = departments.find((d) => (d.moduleKeys as string[]).includes("product"))?.leadAgentId ?? null;
    const authorAgentId = productLead ?? (await agentsRepo.chiefOfStaff(db, businessId))?.id ?? null;

    return {
      businessId,
      businessName: business.name,
      archetype: (business.archetype ?? null) as Archetype | null,
      currency: profile?.currency ?? "EUR",
      door,
      outline,
      idea,
      founder,
      importReport: (row?.importReport ?? null) as ImportReportSnapshot | null,
      importedSources,
      authorAgentId,
    };
  },

  /**
   * drafting → ready with every write in one transaction: spec blocks through `repos.product` (never a pinned block,
   * never a block someone already wrote), roadmap items through `repos.product`, the vision on the row, the Inbox note
   * and the audit entry. Applies only while `attempt` is the current drafting attempt; otherwise writes nothing.
   */
  async apply(db: Executor, businessId: string, attempt: number, draft: FoundationsDraft, options: ApplyFoundationsOptions): Promise<ApplyFoundationsResult> {
    return db.transaction(async (tx) => {
      // Lock the row for this attempt; a stale or finished attempt writes nothing.
      const locked = await tx
        .update(businessFoundations)
        .set({ updatedAt: new Date() })
        .where(and(eq(businessFoundations.businessId, businessId), eq(businessFoundations.attempt, attempt), eq(businessFoundations.status, "drafting")))
        .returning();
      const current = locked[0];
      if (!current) return { applied: false, row: await foundationsRepo.get(tx, businessId), stats: null, inboxItem: null, writtenBlockIds: [], roadmapItemIds: [] };

      const inputs = await foundationsRepo.inputs(tx, businessId);
      const author = inputs.authorAgentId;
      const importedIds = new Map(inputs.importedSources.map((s) => [s.id, s] as const));
      const writtenBlockIds: string[] = [];
      const kept: { section: string; reason: "pinned" | "written" | "removed" }[] = [];
      const blocksNow = new Map((await productRepo.listBlocks(tx, businessId)).map((b) => [b.id, b] as const));
      for (const s of draft.sections) {
        if (!s.drafted) continue;
        const sources = [...importedIds.values()].filter((src) => s.sourceRefs.some((r) => r === src.id || r === src.title || (src.uri && r === src.uri))).map((src) => src.id);
        if (!s.blockId) {
          const created = await productRepo.createBlock(tx, businessId, { section: s.section, content: s.content, sources, authoredByKind: "agent", authoredBy: author });
          writtenBlockIds.push(created.id);
          continue;
        }
        const block = blocksNow.get(s.blockId);
        // Removed (archived) since the drafting read it, pinned by a human edit, or already written: left alone.
        const reason = !block ? "removed" : block.pinned ? "pinned" : pmText(block.content).trim() ? "written" : null;
        // The emptiness read above is re-checked inside the UPDATE through the block's version (L5): a block someone
        // wrote in between has a newer version and is left alone.
        const written = reason === null ? await productRepo.writeAgentDraft(tx, businessId, s.blockId, { content: s.content, sources, authoredBy: author, expectedVersion: block!.version }) : null;
        if (written) writtenBlockIds.push(written.id);
        else kept.push({ section: s.section, reason: reason ?? "written" });
      }

      // Roadmap items after whatever already sits in each horizon.
      const existing = await productRepo.listRoadmap(tx, businessId);
      const offset: Record<RoadmapHorizon, number> = { now: 0, next: 0, later: 0 };
      for (const i of existing) offset[i.horizon] = Math.max(offset[i.horizon], i.position + 1);
      const liveBlocks = new Set((await productRepo.listBlocks(tx, businessId)).map((b) => b.id));
      const roadmapItemIds: string[] = [];
      for (const r of draft.roadmap) {
        const item = await productRepo.upsertRoadmapItem(tx, businessId, {
          title: r.title,
          descriptionMd: r.descriptionMd,
          horizon: r.horizon,
          confidence: r.confidence,
          specBlockIds: r.specBlockIds.filter((id) => liveBlocks.has(id)),
          ownerRef: author ? { kind: "agent", id: author } : null,
          status: "planned",
          position: offset[r.horizon] + r.position,
        });
        roadmapItemIds.push(item.id);
      }

      const counts = Object.fromEntries(ROADMAP_HORIZONS.map((h) => [h, draft.roadmap.filter((r) => r.horizon === h).length])) as Record<RoadmapHorizon, number>;
      const stats: FoundationsNoteStats = {
        sectionsWritten: writtenBlockIds.length,
        sectionsTotal: draft.sections.length,
        sectionsKept: kept.length,
        roadmap: counts,
        importedIssues: draft.roadmap.filter((r) => r.imported).length,
      };

      const note = options.note && author ? options.note(stats) : null;
      const inboxItem = note
        ? await inboxRepo.createItem(tx, businessId, { type: "update", from_agent_id: author, subject: note.subject.slice(0, 80), body_md: note.bodyMd, status_strip: [], exhibit: { kind: "none", spec_ref: null }, decision: null, blocks_continue: false, source_event_ids: [], entity_ids: [] })
        : null;
      if (inboxItem && options.onInboxItem) await options.onInboxItem(tx, inboxItem);

      const summary = {
        sectionsWritten: writtenBlockIds.length,
        sectionsTotal: draft.sections.length,
        sectionsKept: kept,
        roadmap: counts,
        importedIssues: stats.importedIssues,
        openQuestions: draft.openQuestions,
        notes: draft.notes,
        inboxItemId: inboxItem?.id ?? null,
        model: options.model ?? null,
      };
      const ready = await tx
        .update(businessFoundations)
        // The progress the drafting stored is now in the blocks, the roadmap and `vision`: cleared with the same write.
        .set({ status: "ready", vision: { ...draft.vision }, summary, progress: null, error: null, finishedAt: new Date() })
        .where(and(eq(businessFoundations.businessId, businessId), eq(businessFoundations.id, current.id)))
        .returning();
      if (options.onApplied) await options.onApplied(tx, stats);
      await auditRepo.append(tx, businessId, {
        actorKind: author ? "agent" : "system",
        actorId: author ?? undefined,
        action: "foundations.ready",
        target: { kind: "business_foundations", id: current.id },
        details: { attempt, door: current.door, sectionsWritten: writtenBlockIds.length, sectionsKept: kept.length, roadmapItems: roadmapItemIds.length, importedIssues: stats.importedIssues },
      });
      return { applied: true, row: ready[0] ?? null, stats, inboxItem, writtenBlockIds, roadmapItemIds };
    });
  },
};
