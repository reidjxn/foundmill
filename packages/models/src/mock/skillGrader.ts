/**
 * Mock skill grader (BUILD §11.10, §12.5). Deterministic check results are authoritative; rubric lines without a
 * deterministic result are scored by keyword overlap between the criterion and the agent output, seeded by the hash.
 */
import type { SkillGradeOutput } from "../schemas";
import { type MockContext, isRecord, keywords } from "./inputs";

interface RubricLine {
  criterion: string;
  weight: number;
}

interface Deterministic {
  criterion: string;
  passed: boolean;
  detail?: string;
}

const DEFAULT_RUBRIC: RubricLine[] = [
  { criterion: "Follows the task instructions", weight: 1 },
  { criterion: "Output is complete and well structured", weight: 1 },
  { criterion: "Claims are grounded in the inputs", weight: 1 },
];

export function generateSkillGrader(ctx: MockContext): SkillGradeOutput {
  const rubric = readRubric(ctx);
  const checks = readDeterministic(ctx);
  const output = ctx.getString("output", "agent_output", "answer", "response", "candidate") ?? lastNonJson(ctx);
  const outputTokens = new Set(keywords(output, 200));

  const lines: SkillGradeOutput["lines"] = [];
  const covered = new Set<Deterministic>();
  for (const r of rubric) {
    const det = checks.find((c) => sameCriterion(c.criterion, r.criterion));
    if (det) {
      covered.add(det);
      lines.push({ criterion: r.criterion, score: det.passed ? 1 : 0, reason: `Deterministic check ${det.passed ? "passed" : "failed"}${det.detail ? `: ${det.detail}` : ""}; not overridden.` });
      continue;
    }
    const kws = keywords(r.criterion, 12);
    const hits = kws.filter((k) => outputTokens.has(k) || output.toLowerCase().includes(k));
    const overlap = kws.length === 0 ? 0.5 : hits.length / kws.length;
    const jitter = (ctx.rng.next() - 0.5) * 0.1;
    const score = round2(Math.max(0, Math.min(1, 0.35 + 0.6 * overlap + jitter)));
    lines.push({
      criterion: r.criterion,
      score,
      reason: hits.length > 0 ? `Output addresses ${hits.slice(0, 3).join(", ")}; ${score >= 0.75 ? "meets" : score >= 0.5 ? "partly meets" : "falls short of"} the criterion.` : `No evidence in the output for "${r.criterion}"; scored on structure alone.`,
    });
  }
  for (const det of checks) {
    if (covered.has(det)) continue;
    lines.push({ criterion: det.criterion, score: det.passed ? 1 : 0, reason: `Deterministic check ${det.passed ? "passed" : "failed"}${det.detail ? `: ${det.detail}` : ""}.` });
  }
  if (lines.length === 0) lines.push({ criterion: "Task completed", score: 0.5, reason: "No rubric or checks supplied; neutral score." });

  const weights = lines.map((l) => rubric.find((r) => r.criterion === l.criterion)?.weight ?? 1);
  const total = weights.reduce((a, b) => a + b, 0);
  const score = round2(lines.reduce((acc, l, i) => acc + l.score * (weights[i] as number), 0) / total);
  return { score, lines };
}

function readRubric(ctx: MockContext): RubricLine[] {
  const raw = ctx.get<unknown>("rubric", "criteria", "rubric_lines");
  const out: RubricLine[] = [];
  if (Array.isArray(raw)) {
    for (const r of raw) {
      if (typeof r === "string" && r.trim()) out.push({ criterion: r.trim(), weight: 1 });
      else if (isRecord(r)) {
        const criterion = typeof r.criterion === "string" ? r.criterion : typeof r.name === "string" ? r.name : typeof r.text === "string" ? r.text : undefined;
        if (criterion) out.push({ criterion, weight: typeof r.weight === "number" && r.weight > 0 ? r.weight : 1 });
      }
    }
  } else if (typeof raw === "string") {
    for (const line of raw.split("\n")) {
      const m = /^\s*(?:[-*•]|\d+[.)])\s*(.+)$/.exec(line);
      if (m) out.push({ criterion: (m[1] as string).trim(), weight: 1 });
    }
  }
  return out.length > 0 ? out : DEFAULT_RUBRIC;
}

function readDeterministic(ctx: MockContext): Deterministic[] {
  const raw = ctx.getArray<unknown>("deterministic", "deterministic_checks", "checks", "check_results");
  const out: Deterministic[] = [];
  for (const c of raw) {
    if (!isRecord(c)) continue;
    const criterion = typeof c.criterion === "string" ? c.criterion : typeof c.check === "string" ? c.check : typeof c.name === "string" ? c.name : undefined;
    const passed = typeof c.passed === "boolean" ? c.passed : typeof c.pass === "boolean" ? c.pass : typeof c.ok === "boolean" ? c.ok : undefined;
    if (!criterion || passed === undefined) continue;
    out.push({ criterion, passed, detail: typeof c.detail === "string" ? c.detail : typeof c.message === "string" ? c.message : undefined });
  }
  return out;
}

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
const sameCriterion = (a: string, b: string) => {
  const x = norm(a);
  const y = norm(b);
  return x === y || x.includes(y) || y.includes(x);
};
const round2 = (n: number) => Math.round(n * 100) / 100;
const lastNonJson = (ctx: MockContext) => ctx.lastUser.replace(/```[\s\S]*?```/g, " ").replace(/\{[\s\S]*\}/g, " ").trim();
