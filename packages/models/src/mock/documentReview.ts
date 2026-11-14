/**
 * Mock second read of a long document (packages/agents second-read.ts, route `documentReview`). Reads the sections in the
 * prompt's JSON (`document.sections[]` of `{id, heading, text}`) and raises, deterministically:
 * - an inconsistency when the same price per period (or the same launch month) is stated with two different values;
 * - an unlabeled figure when a sentence about the future carries a number without "Forecast" or "Estimate";
 * - a claim that needs a source (a market size, "studies show", a share of people) that cites none.
 * In a fact-check round (`claims_to_check[]` and `sources[]`), a claim with sources is `supported` only when one of them
 * is not simulated; a claim whose only sources are simulated is `unverifiable`. It never rewrites the document: every
 * suggestion is one short instruction.
 */
import type { Severity } from "@foundmill/shared";
import type { DocumentReviewIssue, DocumentReviewOutput } from "../schemas";
import type { MockContext } from "./inputs";

interface Section {
  id: string;
  heading: string;
  text: string;
}

interface SourceRef {
  id: string;
  claimId: string;
  simulated: boolean;
}

const LABEL_RE = /\b(?:estimates?|estimated|forecasts?|forecasted)\b/i;
const FIGURE_RE = /[€$£]\s?\d|\d\s?%|\b\d[\d,.]*\s?(?:k|m|bn|million|billion|thousand)?\s+(?:[a-z-]+\s+)?(?:customers?|users?|subscribers?|sign-?ups?|orders?|members?|clients?)\b|\b(?:MRR|ARR|revenue)\b[^.]*\d/i;
const FUTURE_RE = /\b(?:will|by\s+(?:the\s+end|end|month|year|20\d\d)|within\s+\w+\s+(?:weeks?|months?|years?)|in\s+(?:\d+|one|two|three|six|twelve)\s+(?:weeks?|months?|years?)|projected|expect(?:s|ed)?\s+to|next\s+year|year\s+(?:one|two|1|2))\b/i;
const SOURCE_CLAIM_RE = /\b(?:market\s+(?:is|size|worth)|worth\s+[€$£]?\d[\d,.]*\s?(?:k|m|bn|million|billion)|studies\s+show|research\s+shows|surveys?\s+show|according\s+to|\d+\s?%\s+of\s+(?:people|consumers|customers|businesses|students|adults|founders|shoppers)|(?:largest|fastest-growing)\s+(?:market|segment|industry))\b/i;
const CITED_RE = /\((?:source|see)[:\s][^)]+\)|https?:\/\//i;
const PRICE_RE = /([€$£]\s?\d[\d,.]*)\s*(?:a|per|\/)\s*(month|year|week)\b/gi;
const LAUNCH_RE = /\blaunch(?:es|ing)?\s+(?:in|on|by)\s+(January|February|March|April|May|June|July|August|September|October|November|December)\b/i;

const sentencesOf = (text: string): string[] =>
  text
    .split(/(?<=[.!?])\s+|\n+/)
    .map((s) => s.trim())
    .filter(Boolean);

const clip = (s: string, max: number) => (s.length > max ? `${s.slice(0, max - 1).trimEnd()}…` : s);

function sectionsOf(ctx: MockContext): Section[] {
  const doc = ctx.getRecord("document");
  const raw = (Array.isArray(doc?.sections) ? doc.sections : ctx.getArray("sections")) as unknown[];
  return raw
    .map((s, i) => {
      const r = (s ?? {}) as Record<string, unknown>;
      return { id: typeof r.id === "string" ? r.id : `s${i + 1}`, heading: typeof r.heading === "string" ? r.heading : `Section ${i + 1}`, text: typeof r.text === "string" ? r.text : "" };
    })
    .filter((s) => s.text.trim());
}

export function generateDocumentReview(ctx: MockContext): DocumentReviewOutput {
  const sections = sectionsOf(ctx);
  const claims = ctx.getArray<Record<string, unknown>>("claims_to_check").filter((c) => c && typeof c.quote === "string");
  const sources = ctx.getArray<Record<string, unknown>>("sources").map((s): SourceRef => ({ id: String(s?.id ?? ""), claimId: String(s?.claimId ?? s?.claim_id ?? ""), simulated: s?.simulated !== false }));
  const issues: DocumentReviewIssue[] = [];
  const add = (kind: DocumentReviewIssue["kind"], severity: Severity, section: Section, quote: string, detail: string, suggestion: string) =>
    issues.push({ kind, severity, location: section.id, quote: clip(quote, 400), detail: clip(detail, 600), suggestion: clip(suggestion, 400), check: "not_checked", sourceIds: [] });

  // Inconsistencies: the same price per period, or the launch month, stated two ways.
  const prices = new Map<string, { value: string; section: Section; sentence: string }>();
  let launch: { month: string; section: Section } | null = null;
  for (const section of sections) {
    for (const sentence of sentencesOf(section.text)) {
      for (const m of sentence.matchAll(PRICE_RE)) {
        const value = m[1]!.replace(/\s+/g, "");
        const period = m[2]!.toLowerCase();
        const seen = prices.get(period);
        if (!seen) prices.set(period, { value, section, sentence });
        else if (seen.value !== value) add("inconsistency", "normal", section, sentence, `The price is ${value} a ${period} here but ${seen.value} a ${period} in "${seen.section.heading}".`, `Use one price in both places, or say why they differ.`);
      }
      const l = LAUNCH_RE.exec(sentence);
      if (l) {
        const month = l[1]!;
        if (!launch) launch = { month, section };
        else if (launch.month !== month) add("inconsistency", "normal", section, sentence, `The launch is in ${month} here but in ${launch.month} in "${launch.section.heading}".`, `Pick one launch month and use it in both places.`);
      }
    }
  }

  for (const section of sections) {
    for (const sentence of sentencesOf(section.text)) {
      if (FIGURE_RE.test(sentence) && FUTURE_RE.test(sentence) && !LABEL_RE.test(sentence)) add("unlabeled_figure", "normal", section, sentence, "This figure is about the future but is not labeled, so it reads as a fact.", `Add "(Forecast)" after the figure.`);
      if (SOURCE_CLAIM_RE.test(sentence) && !CITED_RE.test(sentence)) add("needs_source", "normal", section, sentence, "This claim states a fact about the world and cites nothing.", "Name the source, or mark it as an Estimate.");
    }
  }

  // A fact-check round: what the sources say about each claim.
  for (const claim of claims) {
    const quote = String(claim.quote);
    const own = sources.filter((s) => s.claimId === String(claim.id ?? ""));
    const issue = issues.find((i) => i.kind === "needs_source" && (i.quote === quote || quote.includes(i.quote) || i.quote.includes(quote)));
    if (!issue) continue;
    if (own.length === 0) {
      issue.check = "unverifiable";
      issue.detail = clip(`${issue.detail} No source was found for it.`, 600);
    } else if (own.every((s) => s.simulated)) {
      issue.check = "unverifiable";
      issue.detail = clip(`${issue.detail} The only source was a simulated result, so it was not checked.`, 600);
      issue.sourceIds = own.map((s) => s.id).slice(0, 6);
    } else {
      issue.check = "supported";
      issue.sourceIds = own.filter((s) => !s.simulated).map((s) => s.id).slice(0, 6);
    }
  }

  const out = issues.slice(0, 20);
  const summary =
    out.length === 0
      ? `Read ${sections.length} section${sections.length === 1 ? "" : "s"}: nothing to fix.`
      : `Read ${sections.length} section${sections.length === 1 ? "" : "s"}: ${out.length} thing${out.length === 1 ? "" : "s"} to look at (${[...new Set(out.map((i) => i.kind.replace(/_/g, " ")))].join(", ")}).`;
  return { summary, issues: out };
}
