/**
 * product_research and research_artifacts — the Product Researcher's plan to test the specification with the ICP, and
 * its artifacts (BUILD §11.5 Research tab; migration 0063).
 *
 * Lifecycle of the plan row (one per business): `ensureRow` creates it pending on the first ask → `claim` turns it
 * drafting (attempt + 1, exactly once: the update is conditional on the status) once the foundations are ready → the
 * run reads `inputs`, asks the model and calls `ready` (drafting → ready with the artifacts in one transaction; the
 * caller writes its tasks, note and events inside through `onWritten`) or `fail` (drafting → failed; a retry claims it
 * again). `ready` and `fail` act only for the current attempt, so a slow run of an earlier attempt never overwrites a
 * newer one. The row is service-written (read-only policy); the artifacts are the team's (members read and write them).
 */
import { and, asc, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import type { ResearchPlanInputs, ResearchPlanSection } from "@foundmill/agents";
import { RESEARCH_ARTIFACT_KINDS, RESEARCH_ARTIFACT_STATUSES, RESEARCH_STATUSES, type Archetype, type ResearchArtifactKind, type ResearchStatus } from "@foundmill/shared";
import { z } from "zod";
import { agents, productResearch, researchArtifacts, type ProductResearchRow, type ResearchArtifact } from "../schema";
import { agentsRepo } from "./agents";
import { auditRepo } from "./audit";
import { businessesRepo } from "./businesses";
import { departmentsRepo } from "./departments";
import { foundationsRepo, pmText } from "./foundations";
import { foundersRepo } from "./founders";
import { productRepo } from "./product";
import { Id, JsonObject, maybeOne, one, parseInput, type Executor } from "./_shared";

/** The specification text the plan reads, in all (the sections are cut to fit, the longest first to go). */
export const RESEARCH_INPUT_SPEC_CHARS = 6_000;
/** The agent types the plan is attributed to, most specific first. */
export const RESEARCH_AUTHOR_TYPES = ["product_researcher", "researcher"] as const;

export const CreateResearchArtifactInput = z.object({
  kind: z.enum(RESEARCH_ARTIFACT_KINDS),
  title: z.string().trim().min(1).max(200),
  summary: z.string().max(1000).default(""),
  bodyMd: z.string().max(20_000).default(""),
  status: z.enum(RESEARCH_ARTIFACT_STATUSES).default("draft"),
  /** The plan's order; defaults to the order of insertion within one call. */
  position: z.number().int().min(0).optional(),
  specBlockIds: z.array(Id).max(50).default([]),
  taskId: Id.nullable().optional(),
  createdByAgentId: Id.nullable().optional(),
});
export type CreateResearchArtifactInput = z.input<typeof CreateResearchArtifactInput>;

export const UpdateResearchArtifactInput = z.object({
  status: z.enum(RESEARCH_ARTIFACT_STATUSES).optional(),
  taskId: Id.nullable().optional(),
  specBlockIds: z.array(Id).max(50).optional(),
});
export type UpdateResearchArtifactInput = z.input<typeof UpdateResearchArtifactInput>;

export interface ReadyResearchInput {
  icp: string;
  specVersion: number | null;
  agentId: string | null;
  summary: Record<string, unknown>;
  artifacts: CreateResearchArtifactInput[];
  /** Runs inside the transaction once the row and the artifacts are written (tasks, the Inbox note, events through the outbox). */
  onWritten?: (tx: Executor, written: { row: ProductResearchRow; artifacts: ResearchArtifact[] }) => Promise<Record<string, unknown> | void>;
}

export interface ReadyResearchResult {
  applied: boolean;
  row: ProductResearchRow | null;
  artifacts: ResearchArtifact[];
}

/** The text of a Tiptap document's paragraphs and list items, headings left out (the ICP never reads as a block title). */
export function pmBodyText(doc: unknown): string {
  const lines: string[] = [];
  const inline = (n: { text?: unknown; content?: unknown }): string => (typeof n.text === "string" ? n.text : Array.isArray(n.content) ? (n.content as object[]).map((c) => inline(c)).join("") : "");
  const walk = (n: unknown) => {
    if (!n || typeof n !== "object") return;
    const node = n as { type?: unknown; content?: unknown };
    if (node.type === "heading") return;
    if (node.type === "paragraph") {
      const t = inline(node).trim();
      if (t) lines.push(t);
    } else if (Array.isArray(node.content)) for (const c of node.content) walk(c);
  };
  walk(doc);
  return lines.join("\n");
}

/** The first sentence of a text, bounded (the ICP line from the Customers section). */
export function firstSentence(text: string, max = 300): string {
  const cleaned = text.replace(/\s+/g, " ").trim();
  const m = cleaned.match(/^.*?[.!?](?=\s|$)/);
  const s = (m ? m[0] : cleaned).trim();
  return s.length <= max ? s : `${s.slice(0, max - 1).trimEnd()}…`;
}

/** Sections cut to a total budget: the longest lose text first, none disappears. */
export function fitSections(sections: ResearchPlanSection[], budget = RESEARCH_INPUT_SPEC_CHARS): ResearchPlanSection[] {
  const out = sections.map((s) => ({ section: s.section, text: s.text.replace(/\s+/g, " ").trim() }));
  const total = () => out.reduce((n, s) => n + s.text.length, 0);
  while (total() > budget) {
    const longest = out.reduce((a, b) => (b.text.length > a.text.length ? b : a));
    if (longest.text.length <= 80) break;
    longest.text = `${longest.text.slice(0, Math.max(80, Math.floor(longest.text.length * 0.8)) - 1).trimEnd()}…`;
  }
  return out;
}

export const researchRepo = {
  async get(db: Executor, businessId: string): Promise<ProductResearchRow | null> {
    return maybeOne(await db.select().from(productResearch).where(eq(productResearch.businessId, businessId)).limit(1));
  },

  /** The row in status pending, created on the first ask. Idempotent (one row per business). */
  async ensureRow(db: Executor, businessId: string): Promise<ProductResearchRow> {
    const inserted = await db.insert(productResearch).values({ businessId, status: "pending" }).onConflictDoNothing({ target: productResearch.businessId }).returning();
    return inserted[0] ?? (await researchRepo.get(db, businessId))!;
  },

  /** Claim the drafting: `from` → drafting, attempt + 1. Null when the row is not in one of the `from` statuses. */
  async claim(db: Executor, businessId: string, from: readonly ResearchStatus[] = ["pending"]): Promise<ProductResearchRow | null> {
    const rows = await db
      .update(productResearch)
      .set({ status: "drafting", attempt: sql`${productResearch.attempt} + 1`, startedAt: new Date(), finishedAt: null, error: null })
      .where(and(eq(productResearch.businessId, businessId), inArray(productResearch.status, [...from])))
      .returning();
    return rows[0] ?? null;
  },

  /** drafting → failed for the current attempt (a later retry claims it again). */
  async fail(db: Executor, businessId: string, attempt: number, error: string): Promise<ProductResearchRow | null> {
    const rows = await db
      .update(productResearch)
      .set({ status: "failed", error: error.slice(0, 1000), finishedAt: new Date() })
      .where(and(eq(productResearch.businessId, businessId), eq(productResearch.attempt, attempt), eq(productResearch.status, "drafting")))
      .returning();
    const row = rows[0] ?? null;
    if (row) await auditRepo.append(db, businessId, { actorKind: "system", action: "product.research.failed", target: { kind: "product_research", id: row.id }, details: { attempt, error: error.slice(0, 300) } });
    return row;
  },

  /** The agent the plan is attributed to: the Product Researcher, else the Researcher, else the Product lead. */
  async author(db: Executor, businessId: string): Promise<{ id: string; name: string } | null> {
    for (const agentType of RESEARCH_AUTHOR_TYPES) {
      const rows = await db
        .select({ id: agents.id, name: agents.name })
        .from(agents)
        .where(and(eq(agents.businessId, businessId), eq(agents.agentType, agentType), isNull(agents.archivedAt)))
        .orderBy(asc(agents.createdAt), asc(agents.id))
        .limit(1);
      if (rows[0]) return rows[0];
    }
    const departments = await departmentsRepo.list(db, businessId, { includeHidden: true });
    const leadId = departments.find((d) => (d.moduleKeys as string[]).includes("product"))?.leadAgentId ?? null;
    if (!leadId) return null;
    const lead = await agentsRepo.get(db, businessId, leadId);
    return { id: lead.id, name: lead.name };
  },

  /** Everything the plan's drafting reads, from the business's own rows. */
  async inputs(db: Executor, businessId: string): Promise<ResearchPlanInputs> {
    const [business, foundations, blocks, roadmapNow, versions, author] = await Promise.all([
      businessesRepo.get(db, businessId),
      foundationsRepo.get(db, businessId),
      productRepo.listBlocks(db, businessId),
      productRepo.listRoadmap(db, businessId, { horizon: "now" }),
      productRepo.listVersions(db, businessId),
      researchRepo.author(db, businessId),
    ]);
    const profile = business.createdBy ? await foundersRepo.get(db, business.createdBy) : null;
    const bySection = new Map<string, { position: number; createdAt: number; texts: string[]; body: string[] }>();
    for (const b of [...blocks].sort((a, c) => a.position - c.position || a.createdAt.getTime() - c.createdAt.getTime())) {
      const entry = bySection.get(b.section) ?? { position: b.position, createdAt: b.createdAt.getTime(), texts: [], body: [] };
      const text = pmText(b.content).trim();
      if (text) entry.texts.push(text);
      const body = pmBodyText(b.content).trim();
      if (body) entry.body.push(body);
      bySection.set(b.section, entry);
    }
    const sections = fitSections(
      [...bySection.entries()]
        .sort((a, b) => a[1].position - b[1].position || a[1].createdAt - b[1].createdAt)
        .map(([section, e]) => ({ section, text: e.texts.join("\n") }))
        .filter((s) => s.text),
    );
    const vision = (foundations?.vision ?? null) as { statement?: unknown; forWhom?: unknown } | null;
    const customersBody = [...bySection.entries()].find(([section]) => section.toLowerCase() === "customers")?.[1].body.join("\n") ?? "";
    const icp = customersBody ? firstSentence(customersBody) : typeof vision?.forWhom === "string" ? firstSentence(vision.forWhom) : "";
    return {
      businessId,
      businessName: business.name,
      archetype: (business.archetype ?? null) as Archetype | null,
      currency: business.currency,
      icp,
      visionStatement: typeof vision?.statement === "string" ? vision.statement : null,
      targetMarkets: profile?.targetMarkets ?? [],
      constraints: profile?.constraints ?? [],
      roadmapNow: roadmapNow.map((i) => i.title),
      sections,
      specVersion: versions[0]?.version ?? null,
      researcherAgentId: author?.id ?? null,
      researcherName: author?.name ?? null,
    };
  },

  /**
   * drafting → ready with the artifacts in one transaction, for the current attempt only (a stale attempt writes
   * nothing). `onWritten` runs in the same transaction and may return fields merged into the stored summary (task and
   * note ids), so what the row says exists always does.
   */
  async ready(db: Executor, businessId: string, attempt: number, input: ReadyResearchInput): Promise<ReadyResearchResult> {
    return db.transaction(async (tx) => {
      const locked = await tx
        .update(productResearch)
        .set({ updatedAt: new Date() })
        .where(and(eq(productResearch.businessId, businessId), eq(productResearch.attempt, attempt), eq(productResearch.status, "drafting")))
        .returning();
      const current = locked[0];
      if (!current) return { applied: false, row: await researchRepo.get(tx, businessId), artifacts: [] };
      const artifacts: ResearchArtifact[] = [];
      for (const [i, a] of input.artifacts.entries()) {
        const v = parseInput(CreateResearchArtifactInput, a, "research artifact");
        artifacts.push(one(await tx.insert(researchArtifacts).values({ businessId, researchId: current.id, kind: v.kind, title: v.title, summary: v.summary, bodyMd: v.bodyMd, status: v.status, position: v.position ?? i, specBlockIds: v.specBlockIds, taskId: v.taskId ?? null, createdByAgentId: v.createdByAgentId ?? input.agentId ?? null }).returning(), "research artifact"));
      }
      const ready = one(
        await tx
          .update(productResearch)
          .set({ status: "ready", icp: input.icp.slice(0, 400), specVersion: input.specVersion, agentId: input.agentId, summary: { ...input.summary, artifactIds: artifacts.map((a) => a.id) }, error: null, finishedAt: new Date() })
          .where(and(eq(productResearch.businessId, businessId), eq(productResearch.id, current.id)))
          .returning(),
        "product research",
      );
      let row = ready;
      if (input.onWritten) {
        const more = await input.onWritten(tx, { row: ready, artifacts });
        if (more && Object.keys(more).length) row = one(await tx.update(productResearch).set({ summary: { ...(ready.summary ?? {}), ...more } }).where(eq(productResearch.id, ready.id)).returning(), "product research");
      }
      await auditRepo.append(tx, businessId, {
        actorKind: input.agentId ? "agent" : "system",
        actorId: input.agentId ?? undefined,
        action: "product.research.ready",
        target: { kind: "product_research", id: current.id },
        details: { attempt, artifacts: artifacts.length, kinds: artifacts.map((a) => a.kind), icp: input.icp.slice(0, 200) },
      });
      return { applied: true, row, artifacts };
    });
  },

  async listArtifacts(db: Executor, businessId: string, filter: { kind?: ResearchArtifactKind; includeArchived?: boolean } = {}): Promise<ResearchArtifact[]> {
    return db
      .select()
      .from(researchArtifacts)
      .where(and(eq(researchArtifacts.businessId, businessId), filter.includeArchived ? undefined : isNull(researchArtifacts.archivedAt), filter.kind ? eq(researchArtifacts.kind, filter.kind) : undefined))
      .orderBy(asc(researchArtifacts.createdAt), asc(researchArtifacts.position), asc(researchArtifacts.id));
  },

  async getArtifact(db: Executor, businessId: string, artifactId: string): Promise<ResearchArtifact> {
    return one(await db.select().from(researchArtifacts).where(and(eq(researchArtifacts.businessId, businessId), eq(researchArtifacts.id, artifactId))).limit(1), "research artifact", artifactId);
  },

  /** An artifact written outside the plan (a findings note, a demo recording): by an agent's task or by hand. */
  async createArtifact(db: Executor, businessId: string, input: CreateResearchArtifactInput): Promise<ResearchArtifact> {
    const v = parseInput(CreateResearchArtifactInput, input, "research artifact");
    const row = await researchRepo.get(db, businessId);
    return one(await db.insert(researchArtifacts).values({ businessId, researchId: row?.id ?? null, kind: v.kind, title: v.title, summary: v.summary, bodyMd: v.bodyMd, status: v.status, position: v.position ?? 0, specBlockIds: v.specBlockIds, taskId: v.taskId ?? null, createdByAgentId: v.createdByAgentId ?? null }).returning(), "research artifact");
  },

  async updateArtifact(db: Executor, businessId: string, artifactId: string, input: UpdateResearchArtifactInput): Promise<ResearchArtifact> {
    const v = parseInput(UpdateResearchArtifactInput, input, "research artifact update");
    const patch: Partial<typeof researchArtifacts.$inferInsert> = { updatedAt: new Date() };
    if (v.status !== undefined) patch.status = v.status;
    if (v.taskId !== undefined) patch.taskId = v.taskId;
    if (v.specBlockIds !== undefined) patch.specBlockIds = v.specBlockIds;
    return one(await db.update(researchArtifacts).set(patch).where(and(eq(researchArtifacts.businessId, businessId), eq(researchArtifacts.id, artifactId), isNull(researchArtifacts.archivedAt))).returning(), "research artifact", artifactId);
  },

  async archiveArtifact(db: Executor, businessId: string, artifactId: string): Promise<ResearchArtifact> {
    return one(await db.update(researchArtifacts).set({ archivedAt: new Date(), updatedAt: new Date() }).where(and(eq(researchArtifacts.businessId, businessId), eq(researchArtifacts.id, artifactId))).returning(), "research artifact", artifactId);
  },

  /** The latest artifacts by kind (the Research tab's cards read the live ones; this is for the brief and tests). */
  async latestByKind(db: Executor, businessId: string): Promise<Partial<Record<ResearchArtifactKind, ResearchArtifact>>> {
    const rows = await db.select().from(researchArtifacts).where(and(eq(researchArtifacts.businessId, businessId), isNull(researchArtifacts.archivedAt))).orderBy(desc(researchArtifacts.createdAt));
    const out: Partial<Record<ResearchArtifactKind, ResearchArtifact>> = {};
    for (const r of rows) if (!out[r.kind]) out[r.kind] = r;
    return out;
  },

  /**
   * The demo seeds: a plan already ready, with its artifacts, as a business that has run for a while reads (one
   * transaction; replaces an earlier seeded plan of the business).
   */
  async seedReady(db: Executor, businessId: string, input: { icp: string; agentId: string | null; specVersion?: number | null; summary?: Record<string, unknown>; artifacts: CreateResearchArtifactInput[]; at: Date }): Promise<ReadyResearchResult> {
    return db.transaction(async (tx) => {
      await tx.delete(researchArtifacts).where(eq(researchArtifacts.businessId, businessId));
      await tx.delete(productResearch).where(eq(productResearch.businessId, businessId));
      const row = one(await tx.insert(productResearch).values({ businessId, status: "ready", attempt: 1, agentId: input.agentId, icp: input.icp.slice(0, 400), specVersion: input.specVersion ?? null, startedAt: input.at, finishedAt: new Date(input.at.getTime() + 90_000), summary: parseInput(JsonObject, input.summary ?? {}, "research summary"), createdAt: input.at, updatedAt: input.at }).returning(), "product research");
      const artifacts: ResearchArtifact[] = [];
      for (const [i, a] of input.artifacts.entries()) {
        const v = parseInput(CreateResearchArtifactInput, a, "research artifact");
        const at = new Date(input.at.getTime() + 60_000 + i * 1_000);
        artifacts.push(one(await tx.insert(researchArtifacts).values({ businessId, researchId: row.id, kind: v.kind, title: v.title, summary: v.summary, bodyMd: v.bodyMd, status: v.status, position: v.position ?? i, specBlockIds: v.specBlockIds, taskId: v.taskId ?? null, createdByAgentId: v.createdByAgentId ?? input.agentId ?? null, createdAt: at, updatedAt: at }).returning(), "research artifact"));
      }
      const updated = one(await tx.update(productResearch).set({ summary: { ...(row.summary ?? {}), artifactIds: artifacts.map((a) => a.id) } }).where(eq(productResearch.id, row.id)).returning(), "product research");
      return { applied: true, row: updated, artifacts };
    });
  },
};

export type { ProductResearchRow, ResearchArtifact };
export { RESEARCH_STATUSES };
