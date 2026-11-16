/**
 * Positioning notes eval (WP-08 T1): the Product lead drafts a new project's positioning notes from the founder's own
 * words on the `projectPage` route, through the request the orchestrator and apps/api send (packages/agents
 * `buildPositioningRequest`) and the same check of the answer (`finalisePositioning`). Scored deterministically:
 *   - `positioning.from_founder_words`: no proof line, quotation or number that the input does not carry, and every
 *     line not supported by the founder's words is labeled `assumption`;
 *   - `positioning.one_person`: section 1 names one kind of person (one or two lines, none listing several audiences).
 * `runPositioningCase` drives the real route (live in `pnpm evals`; the unit suite feeds it the mock).
 */
import { buildPositioningRequest, finalisePositioning, founderSupports, positioningFounderText } from "@foundmill/agents";
import type { ModelClient } from "@foundmill/models";
import type { PositioningNotes } from "@foundmill/shared";
import { projectPageInputs, PROJECT_PAGE_CASES, type ProjectPageCase } from "./project-page";

export const POSITIONING_EVAL_IDS = ["positioning.from_founder_words", "positioning.one_person"] as const;

/** The three founder ideas of the page eval: an audience named, none named, and a project already being built. */
export const POSITIONING_CASES: readonly ProjectPageCase[] = PROJECT_PAGE_CASES;

const NUMBER_RE = /\d+(?:[.,]\d+)*/g;
const allLines = (n: PositioningNotes) => [...n.forWhom, ...n.problem, ...n.today, ...n.different, ...n.proof];

/** What a draft breaks, in a few words each; empty when it passes. */
export function positioningProblems(c: ProjectPageCase, n: PositioningNotes): string[] {
  const problems: string[] = [];
  const inputs = projectPageInputs(c);
  const founder = positioningFounderText(inputs);
  const known = new Set([c.businessName, founder].join("\n").match(NUMBER_RE) ?? []);
  // positioning.from_founder_words
  for (const l of n.proof) if (l.label !== "founder" || !founderSupports(l.text, founder)) problems.push(`proof not in the founder's words ("${l.text}")`);
  for (const l of allLines(n)) {
    for (const num of l.text.match(NUMBER_RE) ?? []) if (!known.has(num)) problems.push(`invented figure ${num}`);
    if (/["“”]/.test(l.text)) problems.push(`a quotation nobody said ("${l.text}")`);
    if (l.label !== "assumption" && !(l.label === "founder" && founderSupports(l.text, founder))) problems.push(`unsupported line labeled ${l.label} ("${l.text}")`);
  }
  // positioning.one_person
  if (n.forWhom.length === 0) problems.push("section 1 names nobody");
  if (n.forWhom.length > 2) problems.push("section 1 names several audiences");
  if (!n.oneLine.trim()) problems.push("no one line");
  return problems;
}

export interface PositioningCaseResult {
  caseId: string;
  notes: PositioningNotes | null;
  problems: string[];
  passed: boolean;
  costMinor: number;
  error?: string;
}

export async function runPositioningCase(client: ModelClient, c: ProjectPageCase): Promise<PositioningCaseResult> {
  try {
    const inputs = projectPageInputs(c);
    const result = await client.complete({ ...buildPositioningRequest(inputs), scope: "eval:positioning" });
    const notes = finalisePositioning(result.json, inputs, "2026-11-16");
    if (!notes) return { caseId: c.id, notes: null, problems: [`not usable: ${JSON.stringify(result.json).slice(0, 400)}`], passed: false, costMinor: result.cost.costMinorInt };
    const problems = positioningProblems(c, notes);
    return { caseId: c.id, notes, problems, passed: problems.length === 0, costMinor: result.cost.costMinorInt };
  } catch (err) {
    return { caseId: c.id, notes: null, problems: ["no answer"], passed: false, costMinor: 0, error: err instanceof Error ? err.message : String(err) };
  }
}
