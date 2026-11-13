/**
 * Design review eval (item 13): the reviewer that critiques a code agent's UI change from screenshots, through the
 * request the orchestrator sends (packages/agents `buildDesignReviewRequest`, route `designReview`) and the same check of
 * the answer (`finaliseDesignReview`). The fixtures (./fixtures/design-shots.json) are real screenshots and browser
 * descriptions of small pages with planted problems, rendered once with Chromium through the sandbox's own capture
 * (packages/sandbox `capturePages`). Each case is scored deterministically:
 *   1. it flags every planted problem, on the right page, under the right principle;
 *   2. it never praises (no fix is a compliment) and never judges a page it was not shown (no fix on another page);
 *   3. a blank screenshot gets no fix, and a check whose pages could not be shown calls no reviewer and says nothing was
 *      reviewed.
 * `runDesignReviewCase` drives the real route (live in `pnpm evals`; the unit suite feeds it the mock, what mock-mode
 * founders get).
 */
import { readFileSync } from "node:fs";
import { buildDesignReviewRequest, finaliseDesignReview, type FinalisedDesignReview, type ReviewShot } from "@foundmill/agents";
import { DesignReviewOutput, type ModelClient } from "@foundmill/models";
import { designCheckHeadline, PageDescription, type DesignPrinciple, type DesignViewport } from "@foundmill/shared";

interface FixtureShot {
  page: string;
  viewport: DesignViewport;
  width: number;
  height: number;
  cut: boolean;
  pngBase64: string;
  description: unknown;
}

let fixtures: Record<string, FixtureShot> | null = null;
/** The fixture screenshots, by key (contrast, spacing, pricing, generic, blank). */
export function designFixtures(): Record<string, FixtureShot> {
  fixtures ??= JSON.parse(readFileSync(new URL("./fixtures/design-shots.json", import.meta.url), "utf8")) as Record<string, FixtureShot>;
  return fixtures;
}

export function fixtureShot(key: string, id = `before-${key}`): ReviewShot {
  const f = designFixtures()[key];
  if (!f) throw new Error(`no design fixture ${key}`);
  const description = PageDescription.safeParse(f.description);
  return { id, page: f.page, viewport: f.viewport, width: f.width, height: f.height, cut: f.cut, pngBase64: f.pngBase64, description: description.success ? description.data : null };
}

export interface DesignReviewCase {
  id: string;
  /** Fixture keys shown to the reviewer; empty when the sandbox could not show the pages. */
  shots: string[];
  /** Planted problems: each must come back as a fix on that page under that principle. */
  planted: { page: string; principle: DesignPrinciple; what: string }[];
  /** The page is blank: nothing on it may be judged. */
  blank?: boolean;
}

export const DESIGN_REVIEW_CASES: readonly DesignReviewCase[] = Object.freeze([
  { id: "dr01", shots: ["contrast"], planted: [{ page: "/", principle: "contrast", what: "light gray body text (#b5b5b5 on white)" }] },
  { id: "dr02", shots: ["spacing"], planted: [{ page: "/features", principle: "spacing", what: "list items padded 7, 13, 18, 22 and 27 px" }] },
  {
    id: "dr03",
    shots: ["pricing"],
    planted: [
      { page: "/pricing", principle: "responsive", what: "a 900 px row of plans that scrolls sideways at 390 px" },
    ],
  },
  {
    id: "dr04",
    shots: ["generic"],
    planted: [
      { page: "/", principle: "real_content", what: "lorem ipsum and “Your text here”" },
      { page: "/", principle: "hierarchy", what: "a 16 px headline the size of the body" },
    ],
  },
  { id: "dr05", shots: ["blank"], planted: [], blank: true },
  { id: "dr06", shots: [], planted: [] },
]);

/** Words a review must never use about a page: it lists what to change, nothing else. */
export const PRAISE = /\b(?:great|good job|looks? (?:good|great|nice|clean|fine)|well[- ]done|polished|beautiful|excellent|perfect|nicely|stunning|impressive|solid design)\b/i;

/** What a finalised review breaks of the rubric, in a few words each; empty when it passes. */
export function designReviewProblems(c: DesignReviewCase, fin: FinalisedDesignReview): string[] {
  const problems: string[] = [];
  const shown = new Set(c.shots.map((k) => designFixtures()[k]!.page));
  for (const p of c.planted) if (!fin.fixes.some((f) => f.page === p.page && f.principle === p.principle)) problems.push(`missed ${p.principle} on ${p.page} (${p.what})`);
  for (const f of fin.fixes) {
    if (!shown.has(f.page)) problems.push(`judged ${f.page}, which it was not shown`);
    const text = `${f.element} ${f.problem} ${f.fix}`;
    if (PRAISE.test(text)) problems.push(`praise in a fix ("${PRAISE.exec(text)![0]}")`);
  }
  if (c.blank && fin.fixes.length > 0) problems.push(`judged a blank page (${fin.fixes.length} fixes)`);
  return problems;
}

export interface DesignReviewCaseResult {
  caseId: string;
  review: FinalisedDesignReview | null;
  problems: string[];
  passed: boolean;
  costMinor: number;
  /** Whether a model was called (never for a case whose pages could not be shown). */
  called: boolean;
  error?: string;
}

/** One route call for a case, the answer checked as the product checks it, then on the rubric. */
export async function runDesignReviewCase(client: ModelClient, c: DesignReviewCase): Promise<DesignReviewCaseResult> {
  if (c.shots.length === 0) {
    // The sandbox could not render: the product calls no reviewer and the record says nothing was seen.
    const headline = designCheckHeadline({ status: "not_seen", reason: "the sandbox has no browser", pages: ["/"], fixes: [], unreadable: [], before: [], after: [], fixesAsked: false });
    const problems = [...(PRAISE.test(headline) ? ["praise for a page nobody saw"] : []), ...(/nothing was reviewed/.test(headline) ? [] : ["does not say nothing was reviewed"])];
    return { caseId: c.id, review: null, problems, passed: problems.length === 0, costMinor: 0, called: false };
  }
  try {
    const shots = c.shots.map((k) => fixtureShot(k));
    const result = await client.complete({ ...buildDesignReviewRequest({ businessName: "Loaf", taskTitle: "Build the page", shots }), schema: DesignReviewOutput, scope: "eval:design-review" });
    const review = finaliseDesignReview(result.json, shots);
    const problems = designReviewProblems(c, review);
    return { caseId: c.id, review, problems, passed: problems.length === 0, costMinor: result.cost.costMinorInt, called: true };
  } catch (err) {
    return { caseId: c.id, review: null, problems: ["no answer"], passed: false, costMinor: 0, called: true, error: err instanceof Error ? err.message : String(err) };
  }
}
