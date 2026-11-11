/**
 * Project page eval (docs/THESIS_REVIEW.md package 1.2): the Product lead drafts a new project's public page from the
 * founder's own words on the `projectPage` route, through the request apps/api and the orchestrator send
 * (packages/agents `buildProjectPageRequest`) and the same check of the answer (`finaliseProjectPage`). Each case is
 * scored on the rubric deterministically:
 *   1. it keeps the founder's words (most of their content words, and the audience and place names they wrote);
 *   2. it invents no number, date, customer, result or superlative that the input does not carry;
 *   3. it stays within the shared page schema's limits (and is plain text);
 *   4. it reads in plain US English;
 * plus "Who it is for" only when the words name an audience, and the stage the words imply. `runProjectPageCase` drives
 * the real route (live in `pnpm evals`; the unit suite feeds it the mock, what mock-mode founders get).
 */
import { buildProjectPageRequest, finaliseProjectPage, inventedFigures, type FoundationsInputs } from "@foundmill/agents";
import type { ModelClient } from "@foundmill/models";
import { usSpelling, type PageStage, type ProjectPageContent } from "@foundmill/shared";

export interface ProjectPageCase {
  id: string;
  businessName: string;
  /** The idea as the founder wrote it ("Use my idea as written"). */
  founderWords: string;
  /** The Ideation agent's card pitch (untrusted; may embellish: the page must not take its extras). */
  cardPitch: string;
  /** Phrases the page must keep as written (audience, place, product). */
  keep: string[];
  /** Whether the words name an audience ("Who it is for" filled) or not (left empty). */
  audience: boolean;
  stage: PageStage;
}

export const PROJECT_PAGE_CASES: readonly ProjectPageCase[] = Object.freeze([
  {
    id: "pp01",
    businessName: "Shiftly",
    founderWords: "Same-day cafe shifts for students in Manchester. Cafes post a shift in the morning and a student who wants a few hours of work picks it up by lunch.",
    cardPitch: "Shiftly is the leading marketplace connecting 500+ Manchester cafes with student workers, cutting hiring time by 80%.",
    keep: ["students", "Manchester", "cafe"],
    audience: true,
    stage: "idea",
  },
  {
    id: "pp02",
    businessName: "Loom & Ember",
    founderWords: "Hand-poured candles that smell like a walk in the woods. I make them in small batches in my kitchen and want to sell them online.",
    cardPitch: "Loom & Ember crafts premium artisanal candles, already loved by hundreds of customers since 2024.",
    keep: ["candles", "small batches", "walk in the woods"],
    audience: false,
    stage: "idea",
  },
  {
    id: "pp03",
    businessName: "Plotwise",
    founderWords: "A simple planner for allotment gardeners to track what they sowed and when. I'm already building a first version for the 12 plots on my site in Leeds.",
    cardPitch: "Plotwise is the best garden planner in the UK, with AI that doubles your harvest.",
    keep: ["allotment gardeners", "Leeds"],
    audience: true,
    stage: "building",
  },
]);

/** The inputs the drafting reads, as `repos.foundations.inputs` gives them for a card the founder wrote. */
export function projectPageInputs(c: ProjectPageCase): FoundationsInputs {
  return {
    businessId: "00000000-0000-4000-8000-0000000000aa",
    businessName: c.businessName,
    archetype: null,
    currency: "USD",
    door: "ideation",
    outline: [],
    idea: { title: c.businessName, pitch: c.cardPitch, founderWords: c.founderWords, brief: null, archetype: null, starsCurrent: 3, starsPotential: 4, attributes: [], citations: [], qa: [] },
    founder: null,
    importReport: null,
    importedSources: [],
    authorAgentId: null,
  };
}

const STOP = new Set("that this with they them their there what when want wants from have into about your just like make made some will would could also than then only very more most each".split(" "));
const contentWords = (s: string): string[] => (s.toLowerCase().match(/[a-z][a-z'-]{3,}/g) ?? []).filter((w) => !STOP.has(w));
const MONTHS = /\b(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?|20\d\d)\b/i;
/** Claims and hype a draft must never add: traction, social proof, superlatives, exclamation marks. */
const CLAIMS = /\b(?:customers? (?:love|trust)|loved by|trusted by|used by|thousands|hundreds|award|testimonial|best|leading|#1|number one|revolutionary|world-class|premium|cutting-edge|game-?changing)\b|!/i;

/** What a draft breaks of the rubric, in a few words each; empty when it passes. */
export function projectPageProblems(c: ProjectPageCase, draft: ProjectPageContent): string[] {
  const problems: string[] = [];
  const text = [draft.pitch, draft.about, draft.forWhom].join("\n");
  const lower = text.toLowerCase();
  // 1. The founder's words.
  const own = [...new Set(contentWords(c.founderWords))];
  const kept = own.filter((w) => lower.includes(w)).length / Math.max(1, own.length);
  if (kept < 0.5) problems.push(`kept only ${Math.round(kept * 100)}% of the founder's words`);
  for (const k of c.keep) if (!lower.includes(k.toLowerCase())) problems.push(`dropped "${k}"`);
  // 2. Nothing invented.
  const figures = inventedFigures(draft, projectPageInputs(c));
  if (figures.length) problems.push(`invented figures ${figures.join(", ")}`);
  if (MONTHS.test(text) && !MONTHS.test(c.founderWords)) problems.push("a date the founder did not give");
  const claim = CLAIMS.exec(text);
  if (claim && !new RegExp(claim[0].replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i").test(c.founderWords)) problems.push(`a claim or superlative ("${claim[0]}")`);
  // 4. US English.
  if (usSpelling(text) !== text) problems.push("British spelling");
  // The audience only when named, and the stage the words imply.
  if (c.audience && !draft.forWhom.trim()) problems.push("left out the audience the words name");
  if (!c.audience && draft.forWhom.trim()) problems.push(`named an audience the words do not ("${draft.forWhom}")`);
  if (draft.stage !== c.stage) problems.push(`stage ${draft.stage}, expected ${c.stage}`);
  if (draft.showFounders) problems.push("named the founders");
  return problems;
}

export interface ProjectPageCaseResult {
  caseId: string;
  draft: ProjectPageContent | null;
  problems: string[];
  passed: boolean;
  costMinor: number;
  error?: string;
}

/** One route call for a case, the answer checked as the product checks it (3: limits and plain text) and on the rubric. */
export async function runProjectPageCase(client: ModelClient, c: ProjectPageCase): Promise<ProjectPageCaseResult> {
  try {
    const inputs = projectPageInputs(c);
    const req = buildProjectPageRequest(inputs);
    const result = await client.complete({ ...req, scope: "eval:project-page" });
    const fin = finaliseProjectPage(result.json, inputs);
    if ("refused" in fin) return { caseId: c.id, draft: null, problems: [`not usable (${fin.refused}): ${JSON.stringify(result.json).slice(0, 400)}`], passed: false, costMinor: result.cost.costMinorInt };
    const problems = projectPageProblems(c, fin.draft);
    return { caseId: c.id, draft: fin.draft, problems, passed: problems.length === 0, costMinor: result.cost.costMinorInt };
  } catch (err) {
    return { caseId: c.id, draft: null, problems: ["no answer"], passed: false, costMinor: 0, error: err instanceof Error ? err.message : String(err) };
  }
}
