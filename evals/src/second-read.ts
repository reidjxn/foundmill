/**
 * Second read eval (packages/agents second-read.ts, route `documentReview`): a different agent reads a long document
 * another agent drafted. Each case plants problems in a short specification and runs the product's own rounds
 * (`runSecondRead`, with the fact-check the case gives), scored deterministically:
 *   1. it flags every planted inconsistency, in the section that holds it;
 *   2. it flags every planted figure about the future that is not labeled Forecast or Estimate, in its section;
 *   3. it never calls a claim supported when the only source for it is a simulated result;
 *   4. it never rewrites the document: the document is unchanged, and no suggestion is a rewrite of a section.
 * `runSecondReadCase` drives the real route (live in `pnpm evals`; the unit suite feeds it the mock, what mock-mode
 * founders get).
 */
import { runSecondRead, SECOND_READ_LIMITS, type FactChecker, type SecondReadDocument, type SecondReadResult, type SecondReadSource } from "@foundmill/agents";
import type { ModelClient } from "@foundmill/models";

export interface SecondReadCase {
  id: string;
  document: SecondReadDocument;
  /** Planted problems: the issue kind and the section ids it may be reported at (an inconsistency has two ends). */
  planted: { kind: "inconsistency" | "unlabeled_figure"; locations: string[] }[];
  /** The web, as the case has it: every source is simulated, or there is no web at all. */
  web: "simulated" | "none";
}

const AUTHOR = "aaaaaaaa-0000-4000-8000-0000000000a1";
const REVIEWER = { id: "aaaaaaaa-0000-4000-8000-0000000000b2", name: "Review Agent", agentType: "review_agent" };

const section = (id: string, heading: string, text: string) => ({ id, heading, text });

export const SECOND_READ_CASES: readonly SecondReadCase[] = Object.freeze([
  {
    id: "sr01",
    web: "simulated",
    planted: [
      { kind: "inconsistency", locations: ["pricing", "plan"] },
      { kind: "unlabeled_figure", locations: ["metrics"] },
    ],
    document: {
      kind: "specification",
      id: "spec:sr01",
      title: "Ledgerly specification",
      authorAgentId: AUTHOR,
      authorName: "Product Lead",
      sections: [
        section("problem", "Problem", "Independent accountants spend a full day each month chasing clients for receipts and bank statements. They keep the list of what is missing in spreadsheets and email threads, and a client who is late holds up the whole month."),
        section("customers", "Customers", "Our first customers are accountants who work alone or in a firm of two or three, with twenty to sixty small-business clients each. They already use accounting software and want the chasing to stop."),
        section("pricing", "Pricing", "Ledgerly has one plan for a firm: $49 a month, billed monthly, with every feature included. A firm that pays for a year gets two months free. Later in the year the plan moves to $59 a month for new firms."),
        section("metrics", "Metrics", "The product works when an accountant closes a client's month without sending a single reminder by hand. We will reach 300 paying firms by the end of year one. The market for accounting tools is worth $12 billion."),
        section("plan", "Plan", "We start with the reminders and the missing-items list, then the client upload page, then the bank feed. Every firm on the one plan pays $49 a month, whenever it joined."),
      ],
    },
  },
  {
    id: "sr02",
    web: "none",
    planted: [
      { kind: "inconsistency", locations: ["launch", "timeline"] },
      { kind: "unlabeled_figure", locations: ["goals"] },
    ],
    document: {
      kind: "pitch",
      id: "pitch:sr02",
      title: "Loom & Ember pitch",
      authorAgentId: AUTHOR,
      authorName: "Product Lead",
      sections: [
        section("story", "Story", "Loom & Ember makes hand-poured candles that smell like a walk in the woods. Every candle is poured in small batches in a home kitchen, from soy wax and oils chosen for how they burn as much as how they smell."),
        section("launch", "Launch", "We launch in March with three scents and a page anyone can order from. The first batch is forty candles, and the founder packs each order by hand."),
        section("goals", "Goals", "Revenue will reach $8,000 a month within six months. Studies show 70% of shoppers prefer candles made by hand."),
        section("timeline", "Timeline", "The scents are tested through the winter, the labels are printed in February and we launch in May, once the first forty candles have cured for two weeks."),
      ],
    },
  },
]);

/** The fact-check of a case: every source simulated (the mock web connector), or none at all. */
export function caseFactChecker(c: SecondReadCase): FactChecker | undefined {
  if (c.web === "none") return undefined;
  return async (claims): Promise<SecondReadSource[]> => claims.map((claim, i) => ({ id: `w${i + 1}`, claimId: claim.id, simulated: true, url: "https://example.com/report", title: "Sample report", content: { text: `${claim.quote} (sample data)` } }));
}

/** What a result breaks of the rubric, in a few words each; empty when it passes. */
export function secondReadProblems(c: SecondReadCase, before: SecondReadDocument, after: SecondReadDocument, r: SecondReadResult): string[] {
  const problems: string[] = [];
  // 1, 2. The planted problems, where they are.
  for (const p of c.planted) {
    const found = r.issues.some((i) => i.kind === p.kind && p.locations.includes(i.location));
    if (!found) problems.push(`missed the ${p.kind.replace(/_/g, " ")} in ${p.locations.join(" or ")}`);
  }
  // 3. Simulated sources never verify anything.
  if (r.issues.some((i) => i.check === "supported" && i.citations.every((s) => s.simulated))) problems.push("called a claim supported on simulated sources only");
  if (c.web === "simulated" && r.factCheck === "checked") problems.push("reported the fact-check as done on simulated sources");
  // 4. Never a rewrite.
  if (JSON.stringify(before) !== JSON.stringify(after)) problems.push("changed the document");
  for (const i of r.issues) {
    if (i.suggestion.length > 400) problems.push(`a suggestion longer than 400 characters in ${i.location}`);
    const s = c.document.sections.find((x) => x.id === i.location);
    if (s && s.text.length > 150 && i.suggestion.length >= s.text.length * 0.8) problems.push(`rewrote the ${s.heading} section in a suggestion`);
  }
  if (r.issues.length > SECOND_READ_LIMITS.maxIssues) problems.push("more issues than the limit");
  if (r.rounds > SECOND_READ_LIMITS.maxRounds) problems.push("more rounds than the limit");
  return problems;
}

export interface SecondReadCaseResult {
  caseId: string;
  result: SecondReadResult | null;
  problems: string[];
  passed: boolean;
  costMinor: number;
  error?: string;
}

/** The product's own second read of a case, scored on the rubric. */
export async function runSecondReadCase(client: ModelClient, c: SecondReadCase): Promise<SecondReadCaseResult> {
  const document = structuredClone(c.document);
  const before = structuredClone(document);
  try {
    const result = await runSecondRead({ models: client, businessName: c.document.title.split(" ")[0]!, document, reviewer: REVIEWER, factCheck: caseFactChecker(c), attribution: { kind: "eval" } });
    const problems = secondReadProblems(c, before, document, result);
    return { caseId: c.id, result, problems, passed: problems.length === 0, costMinor: result.usage.costMinor };
  } catch (err) {
    return { caseId: c.id, result: null, problems: ["the read failed"], passed: false, costMinor: 0, error: (err as Error).message };
  }
}
