/**
 * Mock Haiku linker sweep (BUILD §11.3 hyperlinking pipeline): finds proper nouns not already wrapped in
 * [[ent:id|Name]] markup and resolves them against the manifest: exact → alias → fuzzy; ambiguous → candidates;
 * unknown → flagged for a draft CRM entity.
 */
import type { LinkerOutput } from "../schemas";
import { type ManifestEntry, type MockContext } from "./inputs";

const COMMON_CAPITALISED = new Set(
  (
    "I The A An And But Or So If When While Because Although This That These Those It Its He She They We You My Your Our Their His Her " +
    "Monday Tuesday Wednesday Thursday Friday Saturday Sunday January February March April May June July August September October November December " +
    "Yes No Ok Okay Hi Hello Dear Thanks Thank Regards Best Please Note Update Warning Decision Milestone Report Summary Context Why What How Who Which Where " +
    // plain-allow: not prose. The linker's list of capitalized words that are never names; nobody reads it.
    "Today Tomorrow Yesterday Week Month Quarter Year Inbox Continue Refresh Home Settings Team Team Staff Manager Founder Board Chief Of Staff Customer Win Debrief Chapter Leaderboard"
  ).split(/\s+/),
);

const ORG_SUFFIX = /\b(?:Ltd|Inc|GmbH|AB|LLC|Co|Corp|PLC|SA|BV|Oy|AS|Limited)\.?$/;

export function generateLinker(ctx: MockContext): LinkerOutput {
  const text = ctx.getString("text", "body", "body_md", "content", "note") ?? ctx.lastUser.replace(/```[\s\S]*?```/g, " ");
  const manifest = ctx.manifest;
  const markup = [...text.matchAll(/\[\[ent:[^\]]+\]\]/g)].map((m) => [m.index ?? 0, (m.index ?? 0) + m[0].length] as [number, number]);
  const inMarkup = (start: number, end: number) => markup.some(([a, b]) => start < b && end > a);

  const mentions: LinkerOutput["mentions"] = [];
  const seenSpans = new Set<string>();
  const candidateRe = /\b[A-Z][\w'’&.-]*(?:\s+(?:[A-Z][\w'’&.-]*|of|the|and|&|de|van|von))*\b/g;
  for (const m of text.matchAll(candidateRe)) {
    let span = m[0].replace(/[.,;:!?]+$/, "");
    let start = m.index ?? 0;
    // Trim leading common words ("The Northwind Skincare" → "Northwind Skincare").
    const parts = span.split(/\s+/);
    while (parts.length > 1 && COMMON_CAPITALISED.has(parts[0] as string)) {
      start += (parts.shift() as string).length + 1;
    }
    while (parts.length > 1 && /^(?:of|the|and|&|de|van|von)$/.test(parts[parts.length - 1] as string)) parts.pop();
    span = parts.join(" ");
    if (!span) continue;
    const sentenceStart = start === 0 || /[.!?]\s+$/.test(text.slice(Math.max(0, start - 3), start));
    let match = resolve(span, manifest);
    // "Met Mara" at a sentence start: the capitalised verb is not part of the name. Try the remainder.
    if (match.status !== "linked" && parts.length > 1 && sentenceStart) {
      const rest = parts.slice(1).join(" ");
      const alt = resolve(rest, manifest);
      if (alt.status !== "unknown") {
        start += (parts[0] as string).length + 1;
        parts.shift();
        span = rest;
        match = alt;
      }
    }
    const end = start + span.length;
    if (inMarkup(start, end) || seenSpans.has(`${start}:${end}`)) continue;
    if (parts.length === 1 && (COMMON_CAPITALISED.has(span) || span.length < 3)) continue;
    if (match.status === "unknown" && parts.length === 1 && sentenceStart && !ORG_SUFFIX.test(span)) continue; // likely just a capitalised first word
    seenSpans.add(`${start}:${end}`);
    mentions.push({ text: span, start, end, ...match });
  }
  return { mentions };
}

type Resolution = Pick<LinkerOutput["mentions"][number], "entity_id" | "confidence" | "status" | "candidates">;

export function resolve(span: string, manifest: ManifestEntry[]): Resolution {
  const q = norm(span);
  if (!q) return { entity_id: null, confidence: 0, status: "unknown", candidates: [] };
  const exact = manifest.filter((e) => norm(e.name) === q);
  if (exact.length === 1) return { entity_id: (exact[0] as ManifestEntry).id, confidence: 1, status: "linked", candidates: [] };
  if (exact.length > 1) return { entity_id: null, confidence: 0.5, status: "ambiguous", candidates: exact.map((e) => e.id) };
  const alias = manifest.filter((e) => e.aliases.some((a) => norm(a) === q));
  if (alias.length === 1) return { entity_id: (alias[0] as ManifestEntry).id, confidence: 0.92, status: "linked", candidates: [] };
  if (alias.length > 1) return { entity_id: null, confidence: 0.5, status: "ambiguous", candidates: alias.map((e) => e.id) };
  // Prefix / contained word match ("Northwind" → "Northwind Skincare").
  const partial = manifest.filter((e) => norm(e.name).split(" ").includes(q) || e.aliases.some((a) => norm(a).split(" ").includes(q)));
  if (partial.length === 1 && q.length >= 4) return { entity_id: (partial[0] as ManifestEntry).id, confidence: 0.85, status: "linked", candidates: [] };
  if (partial.length > 1) return { entity_id: null, confidence: 0.5, status: "ambiguous", candidates: partial.map((e) => e.id) };
  // Fuzzy (bigram Dice).
  const scored = manifest
    .map((e) => ({ e, score: Math.max(dice(q, norm(e.name)), ...e.aliases.map((a) => dice(q, norm(a)))) }))
    .filter((s) => s.score >= 0.72)
    .sort((a, b) => b.score - a.score);
  if (scored.length === 0) return { entity_id: null, confidence: 0, status: "unknown", candidates: [] };
  const best = scored[0] as { e: ManifestEntry; score: number };
  const close = scored.filter((s) => best.score - s.score < 0.08);
  if (close.length > 1) return { entity_id: null, confidence: Math.round(best.score * 100) / 100, status: "ambiguous", candidates: close.map((s) => s.e.id) };
  return { entity_id: best.e.id, confidence: Math.round(best.score * 100) / 100, status: "linked", candidates: [] };
}

const norm = (s: string) => s.toLowerCase().replace(/[’']/g, "").replace(/[^a-z0-9]+/g, " ").trim();

export function dice(a: string, b: string): number {
  if (a === b) return 1;
  if (a.length < 2 || b.length < 2) return 0;
  const grams = (s: string) => {
    const out = new Map<string, number>();
    for (let i = 0; i < s.length - 1; i++) {
      const g = s.slice(i, i + 2);
      out.set(g, (out.get(g) ?? 0) + 1);
    }
    return out;
  };
  const ga = grams(a);
  const gb = grams(b);
  let inter = 0;
  for (const [g, n] of ga) inter += Math.min(n, gb.get(g) ?? 0);
  return (2 * inter) / (a.length - 1 + (b.length - 1));
}
