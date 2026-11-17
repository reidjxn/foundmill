/**
 * Source Watcher (BUILD §11.5 "Source Watcher → Haiku relevance → Opus drafts per-block three-way diffs + rationale +
 * evidence + impact"): the requests it sends and the pure post-processing of the answers. Like the rest of this package
 * nothing here calls a model or a connector: apps/orchestrator fetches the source through the gateway, sends these
 * requests through its models client and writes what `finaliseRelevance` / `finaliseProposal` return.
 *
 * - `candidateBlocks` pre-filters the spec by word overlap with the source (the embedding step of BUILD §11.5 until a
 *   business has embeddings), so the classifier sees at most `SOURCE_CANDIDATE_LIMIT` blocks.
 * - The classifier (`source_relevance`, Haiku) scores the candidates and writes the summary and topics the Sources and
 *   Research tabs show. The drafter (`source_watcher`, Opus) runs only for blocks scored at or above
 *   `SOURCE_RELEVANCE_THRESHOLD` and returns the whole proposed text of each block; `finaliseProposal` keeps the
 *   current nodes for every paragraph the drafter left alone, so the three-way diff and merge stay minimal.
 * - The source (page text, the founder's notes, its title and link) and everything the classifier derived from it only
 *   ever travel inside an <untrusted_content> block (BUILD §9.8); every string the models write is stored as plain text.
 */
import { z } from "zod";
import { APP_NAME } from "@foundmill/config";
import { SEVERITIES, type Severity, type SourceKind } from "@foundmill/shared";
import { agentPromptFields, buildSystemPrompt, type AgentPromptParts } from "./club-rules";
import { docText, inertJson, plainLine, plainModelText, untrustedBlock } from "./foundations";
import { sourceRelevancePrompt, sourceWatcherPrompt } from "./prompts/source-watcher";
import { getTemplate } from "./registry";

/** The Source Watcher speaks as the Product lead (the template whose instructions own the specification). */
export const SOURCE_WATCH_TEMPLATE_KEY = "product_lead";
/** A block scored at or above this is out of date or incomplete because of the source: the drafter proposes a change. */
export const SOURCE_RELEVANCE_THRESHOLD = 0.6;
export const SOURCE_CANDIDATE_LIMIT = 8;
/** Source text sent to the classifier / the drafter (characters). */
export const SOURCE_TEXT_LIMIT = 12_000;
export const SOURCE_DRAFT_TEXT_LIMIT = 6_000;
export const SOURCE_RELEVANCE_MAX_TOKENS = 1_500;
export const SOURCE_PROPOSAL_MAX_TOKENS = 6_000;
/** At most this many blocks are changed by one proposal (the best scored). */
export const SOURCE_PROPOSAL_MAX_HUNKS = 4;

export interface SourceWatchBlock {
  id: string;
  section: string;
  pinned: boolean;
  /** The block's ProseMirror content. */
  content: Record<string, unknown>;
}

export interface SourceWatchSource {
  id: string;
  kind: SourceKind;
  title: string;
  uri: string | null;
}

/** What was read: the page (through the gateway) and/or the founder's notes. Untrusted, always. */
export interface SourceContent {
  title: string | null;
  text: string;
  notes: string | null;
}

// ---------------------------------------------------------------------------------------------------------------------
// Candidates
// ---------------------------------------------------------------------------------------------------------------------

const STOP = new Set(
  "the and for with that this from are was were has have had not but you your our their its they them what when where which who why how all any can will would should could into onto than then there here about over under more most less very also just only each per via such been being out off use used using one two three new now get got make made does did done".split(" "),
);

export function wordsOf(text: string): string[] {
  return (text.toLowerCase().match(/[a-z][a-z0-9]{2,}/g) ?? []).filter((w) => !STOP.has(w)).map((w) => (w.length > 4 && w.endsWith("s") ? w.slice(0, -1) : w));
}

/**
 * The blocks most worth classifying against: word overlap with the source, weighted by how rare each word is across
 * the spec, with the section name counting double. Falls back to the first blocks when nothing overlaps.
 */
export function candidateBlocks(sourceText: string, blocks: readonly SourceWatchBlock[], limit = SOURCE_CANDIDATE_LIMIT): SourceWatchBlock[] {
  const source = new Set(wordsOf(sourceText));
  const docs = blocks.map((b) => ({ b, words: new Set(wordsOf(`${b.section} ${docText(b.content)}`)), section: new Set(wordsOf(b.section)) }));
  const df = new Map<string, number>();
  for (const d of docs) for (const w of d.words) df.set(w, (df.get(w) ?? 0) + 1);
  const scored = docs.map((d, i) => {
    let score = 0;
    for (const w of d.words) if (source.has(w)) score += Math.log(1 + docs.length / (df.get(w) ?? 1)) * (d.section.has(w) ? 2 : 1);
    return { b: d.b, i, score: score / Math.sqrt(Math.max(4, d.words.size)) };
  });
  const hits = scored.filter((s) => s.score > 0).sort((a, b) => b.score - a.score || a.i - b.i);
  return (hits.length ? hits : scored).slice(0, limit).map((s) => s.b);
}

// ---------------------------------------------------------------------------------------------------------------------
// Requests
// ---------------------------------------------------------------------------------------------------------------------

export const SourceRelevanceOutput = z.object({
  relevant: z.array(z.object({ block_id: z.string().max(64), relevance: z.number().min(0).max(1), reason: z.string().max(400).default("") })).max(20).default([]),
  severity: z.enum(SEVERITIES).default("low"),
  summary: z.string().max(800).default(""),
  topics: z.array(z.string().max(80)).max(10).default([]),
  pricing: z.string().max(400).nullable().default(null),
  strengths: z.array(z.string().max(200)).max(6).default([]),
  weaknesses: z.array(z.string().max(200)).max(6).default([]),
});
export type SourceRelevanceOutput = z.output<typeof SourceRelevanceOutput>;

export const SourceProposalOutput = z.object({
  title: z.string().max(300).default(""),
  rationale_md: z.string().max(6000).default(""),
  hunks: z.array(z.object({ block_id: z.string().max(64), proposed_text: z.string().max(12_000), evidence: z.array(z.string().max(64)).max(10).default([]) })).max(12).default([]),
  impact: z.object({ dates: z.string().max(300).nullable().default(null), tasks: z.array(z.string().max(200)).max(10).default([]), cost_text: z.string().max(300).nullable().default(null) }).default({ dates: null, tasks: [], cost_text: null }),
  notify: z.array(z.string().max(40)).max(5).default([]),
});
export type SourceProposalOutput = z.output<typeof SourceProposalOutput>;

export interface SourceWatchRequest<T> {
  route: "classifier" | "departmentLead";
  system: string[];
  messages: { role: "user"; content: string }[];
  schema: z.ZodType<T>;
  maxTokens: number;
}

const excerpt = (text: string, chars: number) => (text.length > chars ? `${text.slice(0, chars).trimEnd()}…` : text);
const label = (b: SourceWatchBlock) => `${b.id} (${b.section}${b.pinned ? ", pinned" : ""})`;

function system(businessName: string, agent?: AgentPromptParts): string[] {
  return [buildSystemPrompt({ businessName, appName: APP_NAME, ...agentPromptFields(agent, getTemplate(SOURCE_WATCH_TEMPLATE_KEY)) })];
}

function sourceBlock(source: SourceWatchSource, content: SourceContent, chars: number, extra: Record<string, unknown> = {}): string {
  return untrustedBlock("source", { source_content: { id: source.id, title: content.title ?? source.title, uri: source.uri, notes: content.notes ? excerpt(content.notes, 4_000) : null, text: excerpt(content.text, chars), ...extra } });
}

/** Step 1 (Haiku): which candidate blocks the source speaks to, its severity, summary and topics. */
export function buildSourceRelevanceRequest(input: { businessName: string; source: SourceWatchSource; content: SourceContent; candidates: readonly SourceWatchBlock[]; agent?: AgentPromptParts }): SourceWatchRequest<SourceRelevanceOutput> {
  const prompt = sourceRelevancePrompt.render({ source_kind: input.source.kind, candidate_blocks: input.candidates.map(label) });
  const trusted = { source: { id: input.source.id, kind: input.source.kind }, candidate_blocks: input.candidates.map((b) => ({ id: b.id, section: b.section, pinned: b.pinned, excerpt: excerpt(docText(b.content), 600) })) };
  return {
    route: "classifier",
    system: system(input.businessName, input.agent),
    messages: [{ role: "user", content: [prompt, "```json\n" + inertJson(trusted) + "\n```", sourceBlock(input.source, input.content, SOURCE_TEXT_LIMIT)].join("\n\n") }],
    schema: SourceRelevanceOutput,
    maxTokens: SOURCE_RELEVANCE_MAX_TOKENS,
  };
}

/** Step 2 (Opus): the proposed text of each relevant block. The classifier's summary travels with the source, as data. */
export function buildSourceProposalRequest(input: { businessName: string; source: SourceWatchSource; content: SourceContent; relevance: SourceRelevance; blocks: readonly SourceWatchBlock[]; agent?: AgentPromptParts }): SourceWatchRequest<SourceProposalOutput> {
  const severity: Severity = input.relevance.severity;
  const prompt = sourceWatcherPrompt.render({ business_name: input.businessName, severity, blocks: input.blocks.map(label) });
  const scores = new Map(input.relevance.blocks.map((b) => [b.blockId, b]));
  const trusted = { source: { id: input.source.id, kind: input.source.kind }, blocks: input.blocks.map((b) => ({ id: b.id, section: b.section, pinned: b.pinned, relevance: scores.get(b.id)?.score ?? null, text: docText(b.content).split("\n").join("\n\n") })) };
  const classified = { summary: input.relevance.summary, reasons: input.blocks.map((b) => ({ block_id: b.id, reason: scores.get(b.id)?.reason ?? "" })) };
  return {
    route: "departmentLead",
    system: system(input.businessName, input.agent),
    messages: [{ role: "user", content: [prompt, "```json\n" + inertJson(trusted) + "\n```", sourceBlock(input.source, input.content, SOURCE_DRAFT_TEXT_LIMIT, { classifier: classified })].join("\n\n") }],
    schema: SourceProposalOutput,
    maxTokens: SOURCE_PROPOSAL_MAX_TOKENS,
  };
}

// ---------------------------------------------------------------------------------------------------------------------
// Answers
// ---------------------------------------------------------------------------------------------------------------------

/** What the Sources and Research tabs read from `sources.relevance` (packages/modules `SourceRelevance`). */
export interface SourceRelevance {
  summary: string | null;
  /** Relevant blocks, best first; scores are the classifier's (an Estimate). */
  blocks: { blockId: string; score: number; reason: string }[];
  topics: string[];
  severity: Severity;
  pricing?: string;
  strengths?: string[];
  weaknesses?: string[];
}

const plainList = (xs: readonly string[], max: number, chars: number) => [...new Set(xs.map((x) => plainLine(x).slice(0, chars)).filter(Boolean))].slice(0, max);

/** Keeps candidate ids only (each once, the best score), clamps scores and stores every string as plain text. */
export function finaliseRelevance(out: SourceRelevanceOutput, ctx: { source: SourceWatchSource; candidates: readonly SourceWatchBlock[] }): SourceRelevance {
  const known = new Set(ctx.candidates.map((b) => b.id));
  const best = new Map<string, { blockId: string; score: number; reason: string }>();
  for (const r of out.relevant) {
    if (!known.has(r.block_id)) continue;
    const score = Math.round(Math.min(1, Math.max(0, r.relevance)) * 100) / 100;
    if (score <= 0) continue;
    const prev = best.get(r.block_id);
    if (!prev || score > prev.score) best.set(r.block_id, { blockId: r.block_id, score, reason: plainLine(r.reason).slice(0, 200) });
  }
  const summary = plainLine(out.summary).slice(0, 400);
  const relevance: SourceRelevance = {
    summary: summary || null,
    blocks: [...best.values()].sort((a, b) => b.score - a.score),
    topics: plainList(out.topics.map((t) => t.toLowerCase()), 5, 40),
    severity: out.severity,
  };
  if (ctx.source.kind === "competitor") {
    const pricing = out.pricing ? plainLine(out.pricing).slice(0, 200) : "";
    if (pricing) relevance.pricing = pricing;
    const strengths = plainList(out.strengths, 3, 120);
    const weaknesses = plainList(out.weaknesses, 3, 120);
    if (strengths.length) relevance.strengths = strengths;
    if (weaknesses.length) relevance.weaknesses = weaknesses;
  }
  return relevance;
}

/** The blocks worth a proposal: scored at or above the threshold, best first, at most `SOURCE_PROPOSAL_MAX_HUNKS`. */
export function blocksToPropose(relevance: SourceRelevance, blocks: readonly SourceWatchBlock[]): SourceWatchBlock[] {
  const byId = new Map(blocks.map((b) => [b.id, b]));
  return relevance.blocks
    .filter((r) => r.score >= SOURCE_RELEVANCE_THRESHOLD && byId.has(r.blockId))
    .slice(0, SOURCE_PROPOSAL_MAX_HUNKS)
    .map((r) => byId.get(r.blockId)!);
}

type PmNode = Record<string, unknown>;

/**
 * The proposed text as a document: a paragraph the drafter kept word for word keeps the current node (a heading stays a
 * heading, a list stays a list), anything new or changed becomes a plain paragraph.
 */
export function proposedDoc(current: PmNode, proposedText: string): PmNode {
  const norm = (s: string) => s.replace(/\s+/g, " ").trim();
  // Each current node as the paragraphs the drafter saw (a list is one paragraph per item), longest first.
  const nodes = (Array.isArray(current.content) ? (current.content as PmNode[]) : [])
    .map((node) => ({ node, lines: docText({ type: "doc", content: [node] }).split("\n").map(norm).filter(Boolean) }))
    .filter((n) => n.lines.length > 0)
    .sort((a, b) => b.lines.length - a.lines.length);
  const paragraphs = proposedText.split(/\n\s*\n/).map(norm).filter(Boolean);
  const out: PmNode[] = [];
  for (let i = 0; i < paragraphs.length; ) {
    const kept = nodes.find((n) => n.lines.every((line, k) => paragraphs[i + k] === line));
    if (kept) {
      out.push(kept.node);
      i += kept.lines.length;
    } else {
      out.push({ type: "paragraph", content: [{ type: "text", text: paragraphs[i]! }] });
      i += 1;
    }
  }
  return { type: "doc", content: out };
}

export interface DraftedProposal {
  title: string;
  rationaleMd: string;
  evidence: string[];
  impact: Record<string, unknown>;
  severity: Severity;
  hunks: { specBlockId: string; base: PmNode; ours: PmNode; theirs: PmNode }[];
}

/**
 * The proposal to store, or null when the drafter changed nothing: hunks only for the blocks it was given, each
 * different from the current text, as plain text; the source is always the evidence; the impact is labeled Estimate.
 */
export function finaliseProposal(out: SourceProposalOutput, ctx: { source: SourceWatchSource; blocks: readonly SourceWatchBlock[]; relevance: SourceRelevance }): DraftedProposal | null {
  const byId = new Map(ctx.blocks.map((b) => [b.id, b]));
  const seen = new Set<string>();
  const hunks: DraftedProposal["hunks"] = [];
  for (const h of out.hunks) {
    const block = byId.get(h.block_id);
    if (!block || seen.has(block.id)) continue;
    const text = plainModelText(h.proposed_text).trim();
    if (!text) continue;
    const theirs = proposedDoc(block.content, text);
    if (docText(theirs).replace(/\s+/g, " ").trim() === docText(block.content).replace(/\s+/g, " ").trim()) continue;
    seen.add(block.id);
    hunks.push({ specBlockId: block.id, base: block.content, ours: block.content, theirs });
  }
  if (!hunks.length) return null;
  const sections = [...new Set(hunks.map((h) => byId.get(h.specBlockId)!.section))];
  const title = plainLine(out.title).slice(0, 200) || `${sections.join(", ")}: update from ${plainLine(ctx.source.title).slice(0, 120) || "a new source"}`;
  const rationale = plainModelText(out.rationale_md).trim().slice(0, 4000) || ctx.relevance.summary || "";
  const tasks = plainList(out.impact.tasks, 10, 200);
  const notify = out.notify.map((n) => n.toLowerCase()).filter((n) => n === "development" || n === "distribution");
  const impact: Record<string, unknown> = { label: "Estimate" };
  if (out.impact.dates) impact.dates = plainLine(out.impact.dates).slice(0, 200);
  if (tasks.length) impact.tasks = tasks;
  if (out.impact.cost_text) impact.summary = plainLine(out.impact.cost_text).slice(0, 200);
  if (notify.length) impact.notify = [...new Set(notify)];
  return { title, rationaleMd: rationale, evidence: [ctx.source.id], impact, severity: ctx.relevance.severity, hunks };
}
