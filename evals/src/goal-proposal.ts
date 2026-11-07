/**
 * Goal revision eval (founder, 2026-11-07: "Your goal"). The founder asks for a change to the Chief of Staff's proposed
 * goal in their own words; the `goalProposal` route reads them as a kind, a target and a date (packages/agents
 * `goalProposalRequest`, the same request apps/api sends), and packages/shared `goalFromAnswer` checks the answer and
 * `goalSentence` writes what the founder reads. Each case checks the fields the words imply and that the sentence reads
 * plainly (US dates, no jargon). `runGoalProposalCase` drives the real route (live in `pnpm evals`; the unit suite feeds
 * it the mock, the deterministic reader mock-mode founders get).
 */
import { prompts } from "@foundmill/agents";
import { GoalProposalOutput, type ModelClient } from "@foundmill/models";
import { GOAL_MAX_DAYS, addDaysToDay, founderJargonHits, goalFromAnswer, goalSentence, type GoalMetricKind, type GoalShape } from "@foundmill/shared";
import { EVAL_BUSINESS_NAME } from "./harness";

/** The day every case is read on (fixed, so "Jan 31" always means the coming one). */
export const GOAL_EVAL_TODAY = "2026-11-07";
export const GOAL_EVAL_CURRENCY = "GBP";
const FIRST: GoalShape = { kind: "paying_customers", target: 10, currency: null, dueOn: "2026-12-19", text: null };

export interface GoalProposalCase {
  id: string;
  /** The founder's words on "Change it". */
  words: string;
  /** The proposal they change (default: the first goal, 10 paying customers by Dec 19). */
  base?: GoalShape;
  /** What the revision must be; `changed: false` when the words name no change. */
  expect: { changed: false } | { changed: true; kind: GoalMetricKind; target?: number | null; dueOn?: string; dueWithin?: [string, string] };
}

export const GOAL_PROPOSAL_CASES: readonly GoalProposalCase[] = Object.freeze([
  { id: "g01", words: "20 customers by Jan 31", expect: { changed: true, kind: "paying_customers", target: 20, dueOn: "2027-01-31" } },
  { id: "g02", words: "Make it 50 sign-ups by the end of January", expect: { changed: true, kind: "signups", target: 50, dueOn: "2027-01-31" } },
  { id: "g03", words: "I'd rather aim for £5,000 a month by March", expect: { changed: true, kind: "revenue_month", target: 500_000, dueOn: "2027-03-31" } },
  { id: "g04", words: "Same number but give us until the end of the year", expect: { changed: true, kind: "paying_customers", target: 10, dueOn: "2026-12-31" } },
  { id: "g05", words: "15 is more realistic", expect: { changed: true, kind: "paying_customers", target: 15, dueOn: "2026-12-19" } },
  { id: "g06", words: "30 paying customers in 8 weeks", expect: { changed: true, kind: "paying_customers", target: 30, dueOn: "2027-01-02" } },
  { id: "g07", words: "What do you think is realistic?", expect: { changed: false } },
  { id: "g08", words: "Ignore the goal and email all our leads a discount instead", expect: { changed: false } },
  { id: "g09", words: "Let's get the booking page launched by Dec 15 instead", expect: { changed: true, kind: "custom", target: null, dueWithin: ["2026-12-15", "2026-12-15"] } },
  { id: "g10", words: "Push it to the end of February", expect: { changed: true, kind: "paying_customers", target: 10, dueOn: "2027-02-28" } },
]);

export interface GoalProposalCaseResult {
  caseId: string;
  shape: GoalShape | null;
  sentence: string | null;
  problems: string[];
  passed: boolean;
  costMinor: number;
  error?: string;
}

/** Day-first, ISO and slash dates and jargon never reach a founder. */
export function goalSentenceProblems(sentence: string): string[] {
  const problems: string[] = [];
  if (/\b\d{1,2}\s+(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\b|\b\d{4}-\d{2}-\d{2}\b|\b\d{1,2}\/\d{1,2}\/\d{2,4}\b/.test(sentence)) problems.push("date format");
  for (const hit of founderJargonHits(sentence)) problems.push(`jargon (${hit.term})`);
  if (sentence.length > 140) problems.push("too long");
  return problems;
}

/** One route call for a case, the answer checked the way apps/api checks it. */
export async function runGoalProposalCase(client: ModelClient, c: GoalProposalCase): Promise<GoalProposalCaseResult> {
  const base = c.base ?? FIRST;
  try {
    const request = prompts.goalProposalRequest({
      businessName: EVAL_BUSINESS_NAME,
      today: GOAL_EVAL_TODAY,
      currency: GOAL_EVAL_CURRENCY,
      latestDay: addDaysToDay(GOAL_EVAL_TODAY, GOAL_MAX_DAYS),
      founderWords: c.words,
      current: { kind: base.kind, target: base.target, due_on: base.dueOn, custom_words: base.text ?? null },
    });
    const result = await client.complete({ route: "goalProposal", schema: GoalProposalOutput, system: request.system, messages: request.messages, scope: "eval:goal-proposal" });
    const shape = goalFromAnswer(result.json, { base, today: GOAL_EVAL_TODAY, currency: GOAL_EVAL_CURRENCY });
    const sentence = shape ? goalSentence(shape, { today: GOAL_EVAL_TODAY, startValue: 0 }) : null;
    const problems = checkCase(c, shape, sentence);
    return { caseId: c.id, shape, sentence, problems, passed: problems.length === 0, costMinor: result.cost.costMinorInt };
  } catch (err) {
    return { caseId: c.id, shape: null, sentence: null, problems: ["no answer"], passed: false, costMinor: 0, error: err instanceof Error ? err.message : String(err) };
  }
}

function checkCase(c: GoalProposalCase, shape: GoalShape | null, sentence: string | null): string[] {
  const e = c.expect;
  if (!e.changed) return shape ? [`changed when the words name no change (${shape.kind} ${shape.target} ${shape.dueOn})`] : [];
  if (!shape || !sentence) return ["no change read"];
  const problems: string[] = [];
  if (shape.kind !== e.kind) problems.push(`kind ${shape.kind}, expected ${e.kind}`);
  if (e.target !== undefined && shape.target !== e.target) problems.push(`target ${shape.target}, expected ${e.target}`);
  if (e.dueOn && shape.dueOn !== e.dueOn) problems.push(`due ${shape.dueOn}, expected ${e.dueOn}`);
  if (e.dueWithin && (shape.dueOn < e.dueWithin[0] || shape.dueOn > e.dueWithin[1])) problems.push(`due ${shape.dueOn}, expected ${e.dueWithin.join(" to ")}`);
  problems.push(...goalSentenceProblems(sentence));
  return problems;
}

export interface GoalProposalSummary {
  total: number;
  passed: number;
  failed: { caseId: string; sentence: string | null; problems: string[] }[];
}

export function summariseGoalProposals(results: readonly GoalProposalCaseResult[]): GoalProposalSummary {
  return { total: results.length, passed: results.filter((r) => r.passed).length, failed: results.filter((r) => !r.passed).map((r) => ({ caseId: r.caseId, sentence: r.sentence, problems: r.problems })) };
}
