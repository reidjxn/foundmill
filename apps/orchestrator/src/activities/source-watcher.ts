/**
 * Source Watcher activities (BUILD §11.5 change proposals): read one source, score it against the specification and,
 * when a block is out of date because of it, draft a change proposal.
 *
 * - The page is read through the gateway's `web.fetch` (public pages within robots.txt, as the Product lead, scoped to
 *   that one tool); nothing here calls a vendor. The founder's notes (or pasted text) are read with it.
 * - The classifier (packages/agents `buildSourceRelevanceRequest`, Haiku) writes what the Sources and Research tabs
 *   show: `relevance.summary`, `relevance.blocks` ([{ blockId, score }]), `relevance.topics`, competitor pricing,
 *   strengths and weaknesses, with `fetched_at` and `source.scored` (outbox) in the same transaction.
 * - Blocks scored at or above the threshold go to the drafter (Opus); a draft that changes something becomes a
 *   proposal (`repos.product.createProposal`, base/ours = the blocks as read) with `spec.proposal_created` in the same
 *   transaction as the source's `relevance.watch.proposalId`, so a retried activity never proposes twice. A critical
 *   proposal (legal, safety, security) is narrated at once; the others wait for the Inbox Composer's refresh (batched).
 * - Content that has not changed since the last read (same hash) is not scored again.
 * Every model call is booked to the business (usage ledger, an Estimate). Failures the founder can read end the read
 * as `unreachable` (robots.txt, a login, not a web page); transient ones are retried by Temporal and, when retries run
 * out, `failSourceWatch` records the read as failed so the nightly sweep tries again.
 */
import { createHash } from "node:crypto";
import { Context } from "@temporalio/activity";
import { ApplicationFailure } from "@temporalio/common";
import { z } from "zod";
import {
  SOURCE_TEXT_LIMIT,
  SOURCE_WATCH_TEMPLATE_KEY,
  blocksToPropose,
  buildSourceProposalRequest,
  buildSourceRelevanceRequest,
  candidateBlocks,
  finaliseProposal,
  finaliseRelevance,
  type SourceContent,
  type SourceRelevance,
  type SourceWatchBlock,
  type SourceWatchSource,
} from "@foundmill/agents";
import { repos, resolveAgentPrompt, type ResolvedAgentPrompt, type Source } from "@foundmill/db";
import type { OrchestratorDeps } from "../deps";
import { agentActor, emitEvent, systemActor } from "../events";

export type SourceWatchReason = "added" | "schedule" | "manual";

export interface SourceWatchInput {
  businessId: string;
  sourceId: string;
  reason: SourceWatchReason;
}

export interface SourceWatchResult {
  sourceId: string;
  /** `unchanged`: same content as the last read, nothing scored; `skipped`: archived source, no agent to read as, or agents stopped. */
  status: "scored" | "unchanged" | "unreachable" | "skipped";
  reason: string | null;
  relevantBlockIds: string[];
  proposalId: string | null;
  /** Model cost of this read (USD minor units, an Estimate). */
  costMinor: number;
}

/** The workflow input: one or more sources of one business (the `sourceWatch` workflow; apps/api starts it on add). */
export interface SourceWatchWorkflowInput {
  businessId: string;
  sourceIds: string[];
  reason: SourceWatchReason;
}

export interface SourceWatchWorkflowResult {
  results: SourceWatchResult[];
}

/** The scheduled sweep (`sourceWatchSweep`): the schedule's business ids, plus how stale a read may be. */
export interface SourceWatchSweepInput {
  /** Omitted by the registered schedule: the sweep lists the businesses whose team may work when it runs. */
  businessIds?: string[];
  /** Re-read sources last checked more than this many hours ago (default 24). */
  staleAfterHours?: number;
  /** At most this many sources per business per sweep (default 10). */
  perBusiness?: number;
  at?: string;
}

/** The only failure type whose message is stored as the reason the founder reads (never raw worker or vendor text). */
export const SOURCE_WATCH_ERROR = "SourceWatchError";
export const SOURCE_WATCH_HEARTBEAT_MS = 15_000;
export const SOURCE_WATCH_FAILED = "The Source Watcher could not finish reading this source. It tries again on the next sweep.";

const NON_RETRYABLE_MODEL_CODES = new Set(["auth", "refusal", "request"]);

/** Founder-readable reasons for a page the web reader refused (codes from packages/connectors web/reader.ts). */
const PAGE_REASONS: Record<string, string> = {
  robots_disallowed: "The site's robots.txt does not allow reading this page.",
  login_required: "The page needs a login, which is never bypassed.",
  blocked_address: "This link is not a public web page.",
  blocked_url: "This link is not a public web page.",
  invalid_url: "This link is not a public web page.",
  invalid_args: "This link is not a public web page.",
  unsupported_content: "The page is not readable text (for example a PDF or an image).",
  not_found: "The page was not found.",
  too_many_redirects: "The page redirects too many times.",
};
const RETRYABLE_PAGE_CODES = new Set(["timeout", "unreachable", "robots_unreachable", "vendor_error", "rate_limited", "tool_failed"]);

const WebPageContent = z.object({ text: z.string(), title: z.string().nullable(), description: z.string().nullable().optional(), finalUrl: z.string().optional(), truncated: z.boolean().optional() });

type PageRead = { ok: true; text: string; title: string | null } | { ok: false; reason: string };

const isWebUri = (uri: string | null): uri is string => Boolean(uri && /^https?:\/\//i.test(uri));
const asRecord = (v: unknown): Record<string, unknown> => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
const str = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v : null);

function activityContext(): Context | null {
  try {
    return Context.current();
  } catch {
    return null;
  }
}

function retryable(message: string): never {
  throw ApplicationFailure.create({ message, type: SOURCE_WATCH_ERROR, nonRetryable: false });
}

export function createSourceWatcherActivities(deps: OrchestratorDeps) {
  /** The agent the watcher reads and drafts as: the Product lead, else the Chief of Staff. */
  async function watcherAgent(businessId: string) {
    const departments = await repos.departments.list(deps.db, businessId, { includeHidden: true });
    const leadId = departments.find((d) => (d.moduleKeys as string[]).includes("product"))?.leadAgentId ?? null;
    const lead = leadId ? await repos.agents.get(deps.db, businessId, leadId).catch(() => null) : null;
    if (lead && !lead.archivedAt) return lead;
    return repos.agents.chiefOfStaff(deps.db, businessId);
  }

  /** Read a public page through the gateway (`web.fetch`). Transient failures throw so Temporal retries the activity. */
  async function readPage(businessId: string, agentId: string, url: string): Promise<PageRead> {
    const minted = await deps.gateway.mintSessionToken({ businessId, agentId, sessionId: null, allowedTools: ["web:fetch"], ttlSeconds: 300 });
    const res = await deps.gateway.call(minted.token, { connector: "web", tool: "fetch", args: { url, maxChars: SOURCE_TEXT_LIMIT } });
    if (res.outcome === "rate_limited") retryable("The web reader is rate limited; trying again shortly.");
    if (res.outcome !== "allow") return { ok: false, reason: "The gateway did not allow reading this page." };
    const result = asRecord(res.result);
    if (result.ok === false) {
      const error = asRecord(result.error);
      const code = String(error.code ?? "");
      // A site answering with a lasting refusal (410, 400 and the like: `retryable: false`) is unreadable, not retried.
      if (RETRYABLE_PAGE_CODES.has(code) && error.retryable !== false) retryable(`The page could not be read (${code}); trying again.`);
      return { ok: false, reason: PAGE_REASONS[code] ?? "The page could not be read." };
    }
    const page = WebPageContent.safeParse(asRecord(result.data).content);
    if (!page.success) return { ok: false, reason: "The page could not be read." };
    const text = [page.data.description ?? "", page.data.text].filter((t) => t.trim()).join("\n\n");
    return { ok: true, text, title: page.data.title };
  }

  async function writeUnreachable(source: Source, agentId: string | null, reason: string, status: "unreachable" | "failed"): Promise<void> {
    await deps.db.transaction(async (tx) => {
      const row = await repos.product.lockSource(tx, source.businessId, source.id);
      const relevance = asRecord(row.relevance);
      await repos.product.updateSource(tx, source.businessId, source.id, { relevance: { ...relevance, watch: { ...asRecord(relevance.watch), status, reason, checkedAt: deps.clock.now().toISOString() } } });
      await emitEvent(tx, { businessId: source.businessId, type: "source.scored", actor: agentId ? agentActor(agentId) : systemActor, payload: { sourceId: source.id, kind: source.kind, status, relevantBlockIds: [], topScore: null, severity: null } });
    });
  }

  return {
    /** Read, score and (when it matters) propose for one source. See the file header. */
    async watchSource(input: SourceWatchInput): Promise<SourceWatchResult> {
      const ctx = activityContext();
      const beat = ctx ? setInterval(() => ctx.heartbeat({ sourceId: input.sourceId }), SOURCE_WATCH_HEARTBEAT_MS) : null;
      const skipped = (reason: string): SourceWatchResult => ({ sourceId: input.sourceId, status: "skipped", reason, relevantBlockIds: [], proposalId: null, costMinor: 0 });
      let costMinor = 0;
      try {
        const { db } = deps;
        const business = await repos.businesses.get(db, input.businessId).catch(() => null);
        if (!business) return skipped("business archived");
        const source = await repos.product.getSource(db, input.businessId, input.sourceId);
        if (source.archivedAt) return skipped("source archived");
        const agent = await watcherAgent(input.businessId);
        if (!agent) return skipped("no agent to read as");
        // Stop all agents and the credits pause leave every agent paused: the watcher waits for the resume (the sweep).
        if (agent.status === "paused") return skipped("agents stopped");

        const relevance0 = asRecord(source.relevance);
        const watch0 = asRecord(relevance0.watch);
        // Sources added by hand before notes had their own key kept them as the summary until a first read.
        const notes = str(relevance0.notes) ?? (relevance0.addedBy === "user" && !watch0.status ? str(relevance0.summary) : null);
        const read = isWebUri(source.uri) ? await readPage(input.businessId, agent.id, source.uri) : null;
        const page: PageRead | null = read?.ok && !read.text.trim() ? { ok: false, reason: "The page has no readable text." } : read;
        if (page && !page.ok && !notes) {
          await writeUnreachable(source, agent.id, page.reason, "unreachable");
          return { sourceId: source.id, status: "unreachable", reason: page.reason, relevantBlockIds: [], proposalId: null, costMinor };
        }
        const content: SourceContent = { title: page?.ok ? page.title : null, text: page?.ok ? page.text : notes ? "" : source.title, notes };
        const contentHash = createHash("sha256").update(`${content.text}\n\n${notes ?? ""}`).digest("hex").slice(0, 32);
        const blocks: SourceWatchBlock[] = (await repos.product.listBlocks(db, input.businessId)).map((b) => ({ id: b.id, section: b.section, pinned: b.pinned, content: b.content }));
        const src: SourceWatchSource = { id: source.id, kind: source.kind, title: source.title, uri: source.uri };
        const attribution = { businessId: input.businessId, agentId: agent.id, kind: "source_watch" };
        const scope = `source-watch:${input.businessId}`;
        // The Product lead as it is now (its live instructions and skills, WP-06 T1), read once and only when a model is asked.
        let prompted: Promise<ResolvedAgentPrompt> | null = null;
        const promptAgent = () => (prompted ??= resolveAgentPrompt(db, input.businessId, { templateKey: SOURCE_WATCH_TEMPLATE_KEY }));

        // 1. Relevance (skipped when this exact content was scored before).
        let relevance: SourceRelevance;
        let status: SourceWatchResult["status"] = "scored";
        if (relevance0.contentHash === contentHash && watch0.status === "scored" && Array.isArray(relevance0.blocks)) {
          relevance = { summary: str(relevance0.summary), blocks: relevance0.blocks as SourceRelevance["blocks"], topics: (relevance0.topics as string[]) ?? [], severity: (relevance0.severity as SourceRelevance["severity"]) ?? "low" };
          status = "unchanged";
          await repos.product.updateSource(db, input.businessId, source.id, { fetchedAt: page?.ok ? deps.clock.now() : source.fetchedAt, relevance: { ...relevance0, watch: { ...watch0, checkedAt: deps.clock.now().toISOString() } } });
        } else if (blocks.length === 0) {
          return skipped("no specification yet");
        } else {
          const candidates = candidateBlocks(`${content.title ?? ""}\n${content.text}\n${notes ?? ""}`, blocks);
          const scored = await deps.models.complete({ ...buildSourceRelevanceRequest({ businessName: business.name, source: src, content, candidates, agent: await promptAgent() }), signal: ctx?.cancellationSignal, scope, attribution });
          costMinor += scored.cost.costMinorInt;
          relevance = finaliseRelevance(scored.json, { source: src, candidates });
          const topScore = relevance.blocks[0]?.score ?? null;
          await db.transaction(async (tx) => {
            const row = await repos.product.lockSource(tx, input.businessId, source.id);
            const { pricing: _p, strengths: _s, weaknesses: _w, ...kept } = asRecord(row.relevance);
            const pageTitle = content.title?.trim().slice(0, 400);
            await repos.product.updateSource(tx, input.businessId, source.id, {
              // A source added by link only takes the page's title.
              ...(pageTitle && row.title === row.uri ? { title: pageTitle } : {}),
              fetchedAt: page?.ok ? deps.clock.now() : row.fetchedAt,
              relevance: {
                ...kept,
                ...relevance,
                ...(notes ? { notes } : {}),
                summary: relevance.summary ?? str(kept.summary),
                contentHash,
                watch: { status: "scored", reason: page && !page.ok ? page.reason : null, page: page ? (page.ok ? "read" : "unreadable") : "none", checkedAt: deps.clock.now().toISOString(), route: scored.route, model: scored.model, costLabel: "Estimate", ...(asRecord(kept.watch).proposalHash === contentHash ? { proposalId: asRecord(kept.watch).proposalId, proposalHash: contentHash } : {}) },
              },
            });
            await emitEvent(tx, {
              businessId: input.businessId,
              type: "source.scored",
              actor: agentActor(agent.id),
              payload: { sourceId: source.id, kind: source.kind, status: "scored", relevantBlockIds: blocksToPropose(relevance, blocks).map((b) => b.id), topScore, severity: relevance.severity },
            });
          });
        }

        // 2. A proposal for the blocks it makes out of date (once per content).
        const toPropose = blocksToPropose(relevance, blocks);
        const result = (proposalId: string | null): SourceWatchResult => ({ sourceId: source.id, status, reason: null, relevantBlockIds: toPropose.map((b) => b.id), proposalId, costMinor });
        const current = asRecord(asRecord((await repos.product.getSource(db, input.businessId, source.id)).relevance).watch);
        if (current.proposalHash === contentHash) return result(str(current.proposalId));
        if (toPropose.length === 0) return result(null);
        const drafted = await deps.models.complete({ ...buildSourceProposalRequest({ businessName: business.name, source: src, content, relevance, blocks: toPropose, agent: await promptAgent() }), signal: ctx?.cancellationSignal, scope, attribution });
        costMinor += drafted.cost.costMinorInt;
        const proposal = finaliseProposal(drafted.json, { source: src, blocks: toPropose, relevance });
        const created = await db.transaction(async (tx) => {
          const row = await repos.product.lockSource(tx, input.businessId, source.id);
          const watch = asRecord(asRecord(row.relevance).watch);
          if (watch.proposalHash === contentHash) return { proposalId: str(watch.proposalId), eventId: null };
          let proposalId: string | null = null;
          let eventId: string | null = null;
          if (proposal) {
            const p = await repos.product.createProposal(tx, input.businessId, { ...proposal, proposedByAgentId: agent.id });
            proposalId = p.id;
            const ev = await emitEvent(tx, {
              businessId: input.businessId,
              type: "spec.proposal_created",
              actor: agentActor(agent.id),
              payload: { proposalId: p.id, sourceIds: [source.id], hunkCount: p.hunks.length, affectedBlockIds: p.hunks.map((h) => h.specBlockId!).filter(Boolean), severity: p.severity, summary: p.title.slice(0, 280) || "A source changes the specification", inboxItemId: null },
            });
            eventId = ev.id;
          }
          await repos.product.updateSource(tx, input.businessId, source.id, { relevance: { ...asRecord(row.relevance), watch: { ...watch, proposalId, proposalHash: contentHash } } });
          return { proposalId, eventId };
        });
        // Legal, safety and security changes reach the Inbox now; the rest is batched by the composer's refresh.
        if (created.eventId && proposal?.severity === "critical") {
          await deps.composer.narrate({ businessId: input.businessId, eventIds: [created.eventId] }).catch((err: unknown) => deps.log.warn({ businessId: input.businessId, err: (err as Error).message }, "critical proposal not narrated now; the composer's refresh will"));
        }
        return result(created.proposalId);
      } catch (err) {
        if (err instanceof ApplicationFailure) throw err;
        deps.log.warn({ businessId: input.businessId, sourceId: input.sourceId, err: (err as Error)?.message }, "source watch failed");
        throw ApplicationFailure.create({ message: SOURCE_WATCH_FAILED, type: SOURCE_WATCH_ERROR, nonRetryable: NON_RETRYABLE_MODEL_CODES.has(String((err as { code?: unknown })?.code)) });
      } finally {
        if (beat) clearInterval(beat);
      }
    },

    /** Retries ran out: record the read as failed (the founder sees it; the next sweep tries again). */
    async failSourceWatch(input: { businessId: string; sourceId: string; error: string }): Promise<void> {
      const source = await repos.product.getSource(deps.db, input.businessId, input.sourceId).catch(() => null);
      if (!source || source.archivedAt) return;
      await writeUnreachable(source, null, input.error || SOURCE_WATCH_FAILED, "failed");
    },

    /** The sources of one business the sweep should read now (never checked, or checked before the stale line). */
    async listSourcesToWatch(input: { businessId: string; staleAfterHours?: number; limit?: number; at?: string }): Promise<{ sourceIds: string[] }> {
      const now = input.at ? new Date(input.at) : deps.clock.now();
      const staleBefore = new Date(now.getTime() - (input.staleAfterHours ?? 24) * 3_600_000);
      const rows = await repos.product.listSourcesToWatch(deps.db, input.businessId, { staleBefore, limit: input.limit ?? 10 });
      return { sourceIds: rows.map((r) => r.id) };
    },
  };
}

export type SourceWatcherActivities = ReturnType<typeof createSourceWatcherActivities>;
