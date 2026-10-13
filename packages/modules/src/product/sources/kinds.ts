/** Source kinds (packages/shared SOURCE_KINDS) with their display word, icon and chip tone, shared by Sources and Research. */
import { Bug, FileText, Landmark, MessageSquareText, Mic, Scale, Swords, type LucideIcon } from "lucide-react";
import type { ChipTone } from "@foundmill/dugout";
import { SOURCE_KINDS, type SourceKind } from "@foundmill/shared";
import type { SourceRelevance, SourceRow, SpecBlockRow } from "../types";

export const SOURCE_KIND_META: Record<SourceKind, { word: string; icon: LucideIcon; tone: ChipTone; hint: string }> = {
  doc: { word: "Document", icon: FileText, tone: "neutral", hint: "Docs, decks, pages and notes" },
  issue: { word: "Issue", icon: Bug, tone: "warn", hint: "Bug reports and tickets" },
  feedback: { word: "Feedback", icon: MessageSquareText, tone: "info", hint: "Reviews, support threads, surveys" },
  transcript: { word: "Interview", icon: Mic, tone: "info", hint: "Customer interviews and call transcripts" },
  competitor: { word: "Competitor", icon: Swords, tone: "bad", hint: "Competitor pages and pricing" },
  legal: { word: "Legal", icon: Scale, tone: "neutral", hint: "Regulation, terms and compliance notes" },
  finance: { word: "Finance", icon: Landmark, tone: "good", hint: "Statements, invoices and bank notes" },
};

export const SOURCE_KIND_OPTIONS = SOURCE_KINDS.map((k) => ({ value: k, label: SOURCE_KIND_META[k].word }));

export function isSourceKind(v: unknown): v is SourceKind {
  return typeof v === "string" && (SOURCE_KINDS as readonly string[]).includes(v);
}

/** Research notes are the sources that carry a human-readable summary and are not competitor pages. */
export const RESEARCH_NOTE_KINDS: readonly SourceKind[] = ["transcript", "feedback", "doc", "issue", "legal", "finance"];

export function relevance(s: Pick<SourceRow, "relevance">): SourceRelevance {
  return s.relevance && typeof s.relevance === "object" ? s.relevance : {};
}

/** Linked block ids with their relevance score, best first. */
export function linkedBlocks(s: Pick<SourceRow, "relevance">): { blockId: string; score: number }[] {
  const blocks = relevance(s).blocks;
  return Array.isArray(blocks) ? blocks.filter((b) => b && typeof b.blockId === "string").map((b) => ({ blockId: b.blockId, score: Number(b.score) || 0 })).sort((a, b) => b.score - a.score) : [];
}

export type ReadState = "read" | "waiting" | "unreachable" | "failed";

/** Where the Source Watcher is with a source: read, still waiting, unreadable (with the reason) or failed (retried later). */
export function readState(s: Pick<SourceRow, "relevance" | "fetchedAt">): { state: ReadState; reason: string | null } {
  const watch = relevance(s).watch;
  if (watch?.status === "unreachable") return { state: "unreachable", reason: typeof watch.reason === "string" ? watch.reason : null };
  if (watch?.status === "failed") return { state: "failed", reason: typeof watch.reason === "string" ? watch.reason : null };
  if (watch?.status === "scored" || s.fetchedAt) return { state: "read", reason: null };
  return { state: "waiting", reason: null };
}

/** The "What it says" line: the summary, or where the read stands when there is none yet. */
export function summaryLine(s: Pick<SourceRow, "relevance" | "fetchedAt">): string {
  const summary = relevance(s).summary;
  if (typeof summary === "string" && summary.trim()) return summary;
  const { state, reason } = readState(s);
  if (state === "unreachable") return `Could not read it: ${reason ?? "the page is not readable."}`;
  if (state === "failed") return "The read did not finish; the Source Watcher tries again on the next sweep.";
  if (state === "waiting") return "Waiting for the Source Watcher to read it";
  return "";
}

export function topics(s: Pick<SourceRow, "relevance">): string[] {
  const t = relevance(s).topics;
  return Array.isArray(t) ? t.filter((x): x is string => typeof x === "string") : [];
}

/** Count of sources touching each spec section (for the coverage chart); sections with no source are included at 0. */
export function coverageBySection(sources: readonly SourceRow[], blocks: readonly SpecBlockRow[]): { section: string; count: number }[] {
  const sectionOf = new Map(blocks.map((b) => [b.id, b.section]));
  const counts = new Map<string, number>();
  for (const b of blocks) counts.set(b.section, 0);
  for (const s of sources) {
    const seen = new Set<string>();
    for (const { blockId } of linkedBlocks(s)) {
      const section = sectionOf.get(blockId);
      if (section && !seen.has(section)) {
        seen.add(section);
        counts.set(section, (counts.get(section) ?? 0) + 1);
      }
    }
  }
  return [...counts.entries()].map(([section, count]) => ({ section, count }));
}

export function topicCounts(sources: readonly SourceRow[]): { topic: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const s of sources) for (const t of topics(s)) counts.set(t, (counts.get(t) ?? 0) + 1);
  return [...counts.entries()].map(([topic, count]) => ({ topic, count })).sort((a, b) => b.count - a.count || a.topic.localeCompare(b.topic));
}

/** Only http(s) links are opened from the browser; a stored `javascript:`, `data:` or `s3:` uri never reaches `window.open`. */
export function isWebUri(uri: string | null | undefined): uri is string {
  return !!uri && /^https?:\/\//i.test(uri.trim());
}

export function hostOf(uri: string | null | undefined): string | null {
  if (!uri) return null;
  try {
    return new URL(uri).host;
  } catch {
    return null;
  }
}
