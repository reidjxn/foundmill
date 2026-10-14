/**
 * Runs a channel creative case the way apps/orchestrator's `channelStep` "create" does (`buildChannelCreativeRequest` →
 * the worker route → `finaliseCreative`), applies the deterministic checks (authoritative) and then the skill grader
 * with the case's rubric (BUILD §12.5).
 */
import { buildChannelCreativeRequest, finaliseCreative, prompts, type FinalisedAsset } from "@foundmill/agents";
import { type ModelClient, SkillGradeOutput } from "@foundmill/models";
import { weightedScore } from "../harness";
import type { ChannelCreativeCase } from "./cases";

export const CHANNEL_CREATIVE_PASS_THRESHOLD = 0.75;

export interface ChannelCreativeCaseResult {
  caseId: string;
  passed: boolean;
  score: number;
  problems: string[];
  assets: FinalisedAsset[];
  costMinor: number;
  grader: { score: number; lines: { criterion: string; score: number; reason: string }[] } | null;
  error?: string;
}

/** Deterministic checks over what would be stored. Empty = pass. */
export function checkChannelCreative(c: ChannelCreativeCase, assets: readonly FinalisedAsset[]): string[] {
  const problems: string[] = [];
  if (assets.length === 0) problems.push("no creative was drafted");
  for (const a of assets) {
    if (!c.kinds.includes(a.kind)) problems.push(`an asset of kind ${a.kind}, expected ${c.kinds.join(" or ")}`);
    if (!a.body.trim()) problems.push(`"${a.title}" has no body`);
  }
  const text = assets.map((a) => `${a.title}\n${a.body}`).join("\n").toLowerCase();
  for (const must of c.mustContain) if (!text.includes(must.toLowerCase())) problems.push(`no draft contains "${must}"`);
  for (const bad of c.mustNotContain) if (text.includes(bad.toLowerCase())) problems.push(`a draft contains "${bad}"`);
  return problems;
}

function graderMessage(c: ChannelCreativeCase, assets: readonly FinalisedAsset[], problems: string[]): string {
  const rubric = c.rubric.map((r, i) => `${i + 1}. ${r}`).join("\n");
  const checks = problems.length ? problems.map((p) => `- FAILED: ${p}`).join("\n") : "- all deterministic checks passed";
  return `Task given to the agent:\nDraft this week's ${c.input.channelKey} creative for ${c.input.businessName} (case ${c.id}: ${c.title}).\n\nBrief:\n${c.input.brief ?? "(none)"}\n\nRubric:\n${rubric}\n\nDeterministic check results (authoritative):\n${checks}\n\nAgent output:\n<output>\n${JSON.stringify(assets, null, 2).slice(0, 40_000)}\n</output>`;
}

/** One case end to end. Never throws; errors land in `error`. */
export async function runChannelCreativeCase(c: ChannelCreativeCase, opts: { client: ModelClient; grade?: boolean }): Promise<ChannelCreativeCaseResult> {
  try {
    const drafted = await opts.client.complete({ ...buildChannelCreativeRequest(c.input), scope: `eval:${c.id}` });
    let costMinor = drafted.cost.costMinorInt;
    const assets = finaliseCreative(drafted.json, { channelKey: c.input.channelKey });
    const problems = checkChannelCreative(c, assets);
    let grader: ChannelCreativeCaseResult["grader"] = null;
    let score = problems.length ? 0 : 1;
    if (opts.grade !== false) {
      const graded = await opts.client.complete({ route: "skillGrader", system: prompts.skillGraderPrompt.render({}), messages: [{ role: "user", content: graderMessage(c, assets, problems) }], schema: SkillGradeOutput, scope: `eval:${c.id}:grader` });
      costMinor += graded.cost.costMinorInt;
      grader = graded.json;
      score = problems.length ? 0 : Math.min(graded.json.score, weightedScore(graded.json.lines, graded.json.score));
    }
    return { caseId: c.id, passed: problems.length === 0 && score >= CHANNEL_CREATIVE_PASS_THRESHOLD, score, problems, assets, costMinor, grader };
  } catch (err) {
    return { caseId: c.id, passed: false, score: 0, problems: [], assets: [], costMinor: 0, grader: null, error: err instanceof Error ? err.message : String(err) };
  }
}
