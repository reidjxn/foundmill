/**
 * Chapter titles (BUILD §11.2 "Chapters: one per quarter, titled by Opus"; ARCHITECTURE §11 `POST /v1/chapter-title`).
 * The quarter's facts are read from repositories (conversions, milestones, decisions, events) and handed to the
 * `chapter_title` prompt on the locked `inboxComposer` route. A title that does not meet the prompt's own rules (3–6
 * words, no numbers outside the facts) falls back to a deterministic provisional title built from the same facts, so
 * the Ribbon always has a chapter name and never an invented one.
 */
import { prompts } from "@foundmill/agents";
import { repos, type Db } from "@foundmill/db";
import type { ModelClient, ModelLogger } from "@foundmill/models";
import { ValidationError } from "@foundmill/shared";
import { z } from "zod";

export const QUARTER_RE = /^(\d{4})-Q([1-4])$/;

export const CHAPTER_MOODS = ["rising", "steady", "turbulent", "breakthrough"] as const;
export type ChapterMood = (typeof CHAPTER_MOODS)[number];

export const ChapterTitleOutput = z.object({
  title: z.string().min(1).max(80),
  subtitle: z.string().max(200).default(""),
  mood: z.enum(CHAPTER_MOODS).default("steady"),
});
export type ChapterTitleOutput = z.infer<typeof ChapterTitleOutput>;

export interface QuarterFacts {
  quarter: string;
  label: string;
  from: string;
  to: string;
  signups: number;
  activations: number;
  customersWon: number;
  milestones: string[];
  decisionsMade: number;
  events: number;
  inboxItems: number;
}

export interface ChapterTitleResult {
  quarter: string;
  label: string;
  title: string;
  subtitle: string;
  mood: ChapterMood;
  facts: QuarterFacts;
  /** `model` when the route's answer passed the checks, `provisional` when the deterministic fallback was used. */
  source: "model" | "provisional";
  costMinor: number;
}

export function parseQuarter(quarter: string): { year: number; q: number; from: Date; to: Date; label: string } {
  const m = QUARTER_RE.exec(quarter);
  if (!m) throw new ValidationError("quarter must look like 2026-Q3", { quarter });
  const year = Number(m[1]);
  const q = Number(m[2]);
  const from = new Date(Date.UTC(year, (q - 1) * 3, 1));
  const to = new Date(Date.UTC(year, q * 3, 1));
  return { year, q, from, to, label: `Q${q} ${year}` };
}

export function quarterOf(date: Date): string {
  return `${date.getUTCFullYear()}-Q${Math.floor(date.getUTCMonth() / 3) + 1}`;
}

export async function loadQuarterFacts(db: Db, businessId: string, quarter: string): Promise<QuarterFacts> {
  const { from, to, label } = parseQuarter(quarter);
  const range = { from, to };
  const [conversions, milestones, byType, inbox] = await Promise.all([
    repos.journeys.countConversions(db, businessId, range),
    repos.journeys.listMilestones(db, businessId, range),
    repos.events.countByType(db, businessId, range),
    repos.inbox.list(db, businessId, { limit: 1 }),
  ]);
  return {
    quarter,
    label,
    from: from.toISOString().slice(0, 10),
    to: new Date(to.getTime() - 1).toISOString().slice(0, 10),
    signups: conversions.signup,
    activations: conversions.activation,
    customersWon: conversions.payment,
    milestones: milestones.map((m) => m.label),
    decisionsMade: byType["decision.made"] ?? 0,
    events: Object.values(byType).reduce((n, v) => n + v, 0),
    inboxItems: inbox.items.length,
  };
}

export function factsSentence(f: QuarterFacts): string {
  const parts = [
    `customers won: ${f.customersWon}`,
    `signups: ${f.signups}`,
    `activations: ${f.activations}`,
    `decisions made: ${f.decisionsMade}`,
    `platform events: ${f.events}`,
    f.milestones.length ? `milestones: ${f.milestones.slice(0, 6).join(", ")}` : "milestones: none",
  ];
  return parts.join("; ");
}

const WORD_RE = /\S+/g;
const HYPE = /\b(revolutionary|game-changing|unprecedented)\b/i;

/** The prompt's own rules: 3–6 words, no trailing punctuation, no hype, no number that is not in the facts. */
export function titleAcceptable(title: string, facts: QuarterFacts): boolean {
  const words = title.match(WORD_RE) ?? [];
  if (words.length < 3 || words.length > 6) return false;
  if (/[.!?:;,]$/.test(title.trim())) return false;
  if (HYPE.test(title)) return false;
  const allowed = new Set([f(facts.customersWon), f(facts.signups), f(facts.activations), f(facts.decisionsMade), f(facts.events), String(parseQuarter(facts.quarter).year), String(parseQuarter(facts.quarter).q)]);
  for (const n of title.match(/\d+/g) ?? []) if (!allowed.has(n)) return false;
  return true;
}
const f = (n: number) => String(n);

/** Deterministic, digit-free fallback grounded in the facts (labelled `provisional`). */
export function provisionalTitle(facts: QuarterFacts): Pick<ChapterTitleOutput, "title" | "subtitle" | "mood"> {
  const hasTrophy = facts.milestones.length > 0;
  if (facts.customersWon > 0 && hasTrophy) return { title: "A Season Of Firsts", subtitle: `${facts.customersWon} customers won and ${facts.milestones.length} milestones in ${facts.label}.`, mood: "breakthrough" };
  if (facts.customersWon > 0) return { title: "Points On The Board", subtitle: `${facts.customersWon} customers won in ${facts.label}.`, mood: "rising" };
  if (facts.signups > 0 || facts.activations > 0) return { title: "First Names On The Teamsheet", subtitle: `${facts.signups} signups and ${facts.activations} activations in ${facts.label}.`, mood: "rising" };
  if (facts.decisionsMade > 0 || facts.events > 0) return { title: "Building Through The Lines", subtitle: `${facts.decisionsMade} decisions made in ${facts.label}.`, mood: "steady" };
  return { title: "A Quiet Pre-Season", subtitle: `No customer activity recorded in ${facts.label}.`, mood: "steady" };
}

export async function composeChapterTitle(deps: { db: Db; models: ModelClient; log: ModelLogger }, businessId: string, quarter: string): Promise<ChapterTitleResult> {
  const business = await repos.businesses.get(deps.db, businessId);
  const facts = await loadQuarterFacts(deps.db, businessId, quarter);
  const system = prompts.chapterTitlePrompt.render({ business_name: business.name, quarter_label: facts.label, quarter_facts: factsSentence(facts) });
  const result = await deps.models.complete({
    route: "inboxComposer",
    schema: ChapterTitleOutput,
    system,
    messages: [{ role: "user", content: "```json\n" + JSON.stringify({ business_name: business.name, quarter: facts.quarter, quarter_label: facts.label, facts }) + "\n```" }],
    attribution: { businessId, kind: "chapter_title" },
    scope: `composer:${businessId}`,
  });
  // The mock composer route answers in the Composer shape and gets synthesised to this schema (`repaired`); a synthesised
  // or rule-breaking title is replaced by the provisional one so the Ribbon never shows an invented chapter name.
  const ok = !result.repaired && titleAcceptable(result.json.title, facts);
  const chosen = ok ? result.json : provisionalTitle(facts);
  if (!ok) deps.log.debug({ businessId, quarter, repaired: result.repaired }, "chapter title fell back to the provisional title");
  return { quarter: facts.quarter, label: facts.label, title: chosen.title, subtitle: chosen.subtitle, mood: chosen.mood, facts, source: ok ? "model" : "provisional", costMinor: result.cost.costMinorInt };
}
