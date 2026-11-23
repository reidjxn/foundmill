/**
 * Runs a Source Watcher case the way apps/orchestrator does (packages/agents `candidateBlocks` → the classifier →
 * `finaliseRelevance` → `blocksToPropose` → the drafter → `finaliseProposal`), applies the deterministic checks
 * (authoritative) and then the Opus skill grader with the case's rubric (BUILD §12.5).
 */
import {
  blocksToPropose,
  buildSourceProposalRequest,
  buildSourceRelevanceRequest,
  candidateBlocks,
  docText,
  finaliseProposal,
  finaliseRelevance,
  prompts,
  type DraftedProposal,
  type SourceRelevance,
} from "@foundmill/agents";
import { type ModelClient, SkillGradeOutput } from "@foundmill/models";
import { weightedScore } from "../harness";
import type { SourceWatchCase } from "./cases";

export const SOURCE_WATCH_PASS_THRESHOLD = 0.75;

export interface SourceWatchCaseResult {
  caseId: string;
  passed: boolean;
  score: number;
  problems: string[];
  relevance: SourceRelevance | null;
  proposal: DraftedProposal | null;
  costMinor: number;
  grader: { score: number; lines: { criterion: string; score: number; reason: string }[] } | null;
  error?: string;
}

/** Deterministic checks over what would be stored. Empty = pass. */
export function checkSourceWatch(c: SourceWatchCase, relevance: SourceRelevance, proposal: DraftedProposal | null): string[] {
  const problems: string[] = [];
  const flagged = new Set(blocksToPropose(relevance, c.blocks).map((b) => b.id));
  const section = (id: string) => c.blocks.find((b) => b.id === id)?.section ?? id;
  for (const id of c.mustFlag) if (!flagged.has(id)) problems.push(`${section(id)} was not flagged as out of date`);
  for (const id of c.mustNotFlag) if (flagged.has(id)) problems.push(`${section(id)} was flagged although the source does not affect it`);
  if (!relevance.summary) problems.push("no summary");
  if (c.expectSeverity && relevance.severity !== c.expectSeverity) problems.push(`severity ${relevance.severity}, expected ${c.expectSeverity}`);
  if (c.expectProposal && !proposal) problems.push("no proposal was drafted");
  if (!c.expectProposal && proposal) problems.push("a proposal was drafted for a source that changes nothing");
  if (proposal) {
    const changed = new Set(proposal.hunks.map((h) => h.specBlockId));
    for (const id of c.mustFlag) if (!changed.has(id)) problems.push(`the proposal does not change ${section(id)}`);
    if (!proposal.evidence.includes(c.source.id)) problems.push("the proposal does not cite the source");
    for (const h of proposal.hunks) if (!docText(h.theirs).trim()) problems.push(`the proposal empties ${section(h.specBlockId)}`);
  }
  const stored = JSON.stringify({ relevance, proposal }).toLowerCase();
  for (const bad of c.mustNotContain) if (stored.includes(bad.toLowerCase())) problems.push(`stored text contains "${bad}" from the untrusted source`);
  return problems;
}

/** The source with its title and notes, as the agent got it: the grader read the text alone and called the title's firm name invented (live run of Nov 22, 2026). */
export function sourceForGrader(c: SourceWatchCase): string {
  return [`Title: ${c.content.title ?? c.source.title}`, c.content.notes ? `Notes: ${c.content.notes}` : "", c.content.text].filter(Boolean).join("\n");
}

function graderMessage(c: SourceWatchCase, relevance: SourceRelevance, proposal: DraftedProposal | null, problems: string[]): string {
  const rubric = c.rubric.map((r, i) => `${i + 1}. ${r}`).join("\n");
  const checks = problems.length ? problems.map((p) => `- FAILED: ${p}`).join("\n") : "- all deterministic checks passed";
  const blocks = c.blocks.map((b) => `${b.section}: ${docText(b.content)}`).join("\n");
  const output = JSON.stringify({ relevance, proposal: proposal ? { ...proposal, hunks: proposal.hunks.map((h) => ({ section: c.blocks.find((b) => b.id === h.specBlockId)?.section, before: docText(h.ours), after: docText(h.theirs) })) } : null }, null, 2);
  return `Task given to the agent:\nRead a new ${c.source.kind} source for ${c.businessName}, score it against the specification and, where a block is out of date, propose the smallest change (case ${c.id}: ${c.title}).\n\nThe specification before:\n${blocks}\n\nThe source (untrusted), as the agent read it:\n${sourceForGrader(c)}\n\nRubric:\n${rubric}\n\nDeterministic check results (authoritative):\n${checks}\n\nAgent output:\n<output>\n${output.slice(0, 60_000)}\n</output>`;
}

/** One case end to end. Never throws; errors land in `error`. */
export async function runSourceWatchCase(c: SourceWatchCase, opts: { client: ModelClient; grade?: boolean }): Promise<SourceWatchCaseResult> {
  try {
    const candidates = candidateBlocks(`${c.content.title ?? ""}\n${c.content.text}\n${c.content.notes ?? ""}`, c.blocks);
    const scored = await opts.client.complete({ ...buildSourceRelevanceRequest({ businessName: c.businessName, source: c.source, content: c.content, candidates }), scope: `eval:${c.id}` });
    let costMinor = scored.cost.costMinorInt;
    const relevance = finaliseRelevance(scored.json, { source: c.source, candidates });
    const toPropose = blocksToPropose(relevance, c.blocks);
    let proposal: DraftedProposal | null = null;
    if (toPropose.length) {
      const drafted = await opts.client.complete({ ...buildSourceProposalRequest({ businessName: c.businessName, source: c.source, content: c.content, relevance, blocks: toPropose }), scope: `eval:${c.id}:draft` });
      costMinor += drafted.cost.costMinorInt;
      proposal = finaliseProposal(drafted.json, { source: c.source, blocks: toPropose, relevance });
    }
    const problems = checkSourceWatch(c, relevance, proposal);
    let grader: SourceWatchCaseResult["grader"] = null;
    let score = problems.length ? 0 : 1;
    if (opts.grade !== false) {
      const graded = await opts.client.complete({ route: "skillGrader", system: prompts.skillGraderPrompt.render({}), messages: [{ role: "user", content: graderMessage(c, relevance, proposal, problems) }], schema: SkillGradeOutput, scope: `eval:${c.id}:grader` });
      costMinor += graded.cost.costMinorInt;
      grader = graded.json;
      score = problems.length ? 0 : Math.min(graded.json.score, weightedScore(graded.json.lines, graded.json.score));
    }
    return { caseId: c.id, passed: problems.length === 0 && score >= SOURCE_WATCH_PASS_THRESHOLD, score, problems, relevance, proposal, costMinor, grader };
  } catch (err) {
    return { caseId: c.id, passed: false, score: 0, problems: [], relevance: null, proposal: null, costMinor: 0, grader: null, error: err instanceof Error ? err.message : String(err) };
  }
}
