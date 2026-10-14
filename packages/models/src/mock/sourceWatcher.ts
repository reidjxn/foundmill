/**
 * Mock Source Watcher (BUILD §11.5): the classifier and department-lead routes answer the Source Watcher's two requests
 * (packages/agents source-watcher.ts) when the caller's schema asks for them. Relevance is word overlap between the
 * source and each candidate block; the drafted change keeps every current paragraph and adds the source's most
 * relevant sentence to each block, so mock mode raises small, readable proposals from what the source really says.
 */
import { type MockContext, keywords, truncate } from "./inputs";

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const str = (v: unknown): string => (typeof v === "string" ? v : "");

interface CandidateIn {
  id: string;
  section: string;
  text: string;
}

/** The classifier request: the schema asks for relevant blocks and a severity. */
export function isSourceRelevanceRequest(ctx: MockContext): boolean {
  return ctx.schemaKeys.includes("relevant") && ctx.schemaKeys.includes("severity");
}

/** The drafting request: the schema asks for hunks and a rationale. */
export function isSourceProposalRequest(ctx: MockContext): boolean {
  return ctx.schemaKeys.includes("hunks") && ctx.schemaKeys.includes("rationale_md");
}

function sourceContent(ctx: MockContext): { id: string; title: string; text: string } {
  const c = ctx.getRecord("source_content") ?? {};
  return { id: str(c.id), title: str(c.title), text: [str(c.notes), str(c.text)].filter(Boolean).join("\n\n") };
}

function blocksFrom(raw: unknown[], textKey: "excerpt" | "text"): CandidateIn[] {
  return raw.filter(isRecord).map((b) => ({ id: str(b.id), section: str(b.section), text: str(b[textKey]) })).filter((b) => b.id);
}

const stem = (w: string) => (w.length > 4 && w.endsWith("s") ? w.slice(0, -1) : w);
const wordSet = (text: string) => new Set(keywords(text, 400).map(stem));

function sentences(text: string): string[] {
  return text
    .split(/\n+|(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 12);
}

function overlap(a: Set<string>, b: Set<string>): number {
  let n = 0;
  for (const w of a) if (b.has(w)) n += 1;
  return n;
}

export function generateSourceRelevance(ctx: MockContext): unknown {
  const source = sourceContent(ctx);
  const kind = str(ctx.getRecord("source")?.kind);
  const sourceWords = wordSet(`${source.title} ${source.text}`);
  const candidates = blocksFrom(ctx.getArray("candidate_blocks"), "excerpt");
  // The share of the block's words the source repeats, plus a bonus when it names the section.
  const relevant = candidates
    .map((b) => {
      const words = wordSet(b.text);
      const hits = overlap(sourceWords, words);
      const named = overlap(sourceWords, wordSet(b.section)) > 0;
      return { b, hits, score: Math.min(0.95, Math.round((0.3 + (0.7 * hits) / Math.max(4, words.size) + (named ? 0.35 : 0)) * 100) / 100) };
    })
    .filter((x) => x.hits > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 4)
    .map(({ b, score }) => ({ block_id: b.id, relevance: score, reason: truncate(`Mentions ${b.section.toLowerCase()} in the source`, 120) }));
  const all = `${source.title} ${source.text}`;
  const severity = /\b(recall|lawsuit|breach|unsafe|safety|security|regulat|illegal|fine[ds]?)\b/i.test(all) ? "critical" : relevant.some((r) => r.relevance >= 0.6) ? "normal" : "low";
  const lead = sentences(source.text).slice(0, 2).join(" ");
  const summary = truncate(lead || source.title || "A new source with no readable text.", 240);
  const topics = keywords(all, 5);
  const prices = sentences(source.text).filter((s) => /[$€£]\s?\d/.test(s));
  return {
    relevant,
    severity,
    summary,
    topics,
    pricing: kind === "competitor" && prices.length ? truncate(prices.slice(0, 2).join(" "), 180) : null,
    strengths: kind === "competitor" ? sentences(source.text).filter((s) => /\b(save|saves|free|includes|fast|simple|praise)/i.test(s)).slice(0, 2).map((s) => truncate(s, 80)) : [],
    weaknesses: kind === "competitor" ? sentences(source.text).filter((s) => /\b(slow|missing|lacks|only|limited|no )/i.test(s)).slice(0, 2).map((s) => truncate(s, 80)) : [],
  };
}

export function generateSourceProposal(ctx: MockContext): unknown {
  const source = sourceContent(ctx);
  const blocks = blocksFrom(ctx.getArray("blocks"), "text");
  const lines = sentences(source.text);
  const hunks = blocks.slice(0, 4).flatMap((b) => {
    const words = wordSet(`${b.section} ${b.text}`);
    const best = lines.map((s) => ({ s, n: overlap(wordSet(s), words) })).sort((x, y) => y.n - x.n)[0];
    if (!best) return [];
    const addition = `From the source: ${truncate(best.s, 220)}`;
    if (b.text.includes(addition)) return [];
    return [{ block_id: b.id, proposed_text: [b.text.trim(), addition].filter(Boolean).join("\n\n"), evidence: source.id ? [source.id] : [] }];
  });
  const sections = blocks.slice(0, 4).map((b) => b.section);
  return {
    title: truncate(`${sections.join(", ") || "Spec"}: what ${source.title || "the new source"} changes`, 80),
    rationale_md: `${truncate(lines[0] ?? source.title ?? "The source", 200)} The proposal adds this to ${sections.join(", ") || "the spec"} and leaves the rest of each block as it reads now.`,
    hunks,
    impact: { dates: null, tasks: sections.map((s) => `Review ${s.toLowerCase()} after the change`), cost_text: null },
    notify: sections.some((s) => /pricing|customer|value/i.test(s)) ? ["distribution"] : ["development"],
  };
}
