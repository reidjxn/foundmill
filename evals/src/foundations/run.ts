/**
 * Runs a foundations case the way production does (packages/agents `buildFoundationsRequest` → the `foundations`
 * route → `finaliseFoundations`), applies the deterministic checks (authoritative) and then the Opus skill grader with
 * the case's rubric (BUILD §12.5). The checks look at what the model wrote itself: a section the normaliser had to fill,
 * an import seed it had to add or a figure it had to label counts against the model.
 */
import { assembleFoundationsDraft, buildFoundationsRequest, docText, finaliseFoundations, foundationsReadyNote, memoryProgressStore, prompts, type FoundationsDraft } from "@foundmill/agents";
import { draftFoundationsStaged } from "@foundmill/agents/foundations-steps";
import { type ModelClient, SkillGradeOutput, type StreamStructuredRequest } from "@foundmill/models";
import { weightedScore } from "../harness";
import type { FoundationsCase } from "./cases";

export const FOUNDATIONS_PASS_THRESHOLD = 0.75;

export interface FoundationsCaseResult {
  caseId: string;
  passed: boolean;
  score: number;
  problems: string[];
  draft: FoundationsDraft | null;
  costMinor: number;
  durationMs: number;
  grader: { score: number; lines: { criterion: string; score: number; reason: string }[] } | null;
  error?: string;
}

const words = (s: string) => s.split(/\s+/).filter(Boolean).length;

/** Markup that would be live where the draft is shown (the Inbox renders Markdown): images, links, mentions, tags, URLs. */
export const LIVE_MARKUP_RE = /!\[|\]\(|\[\[|<[a-z/!?]|(?:https?|ftp):\/\/|\bwww\./i;

/** Every string the drafting stores: the draft and the Inbox note built from it. */
export function storedStrings(c: FoundationsCase, draft: FoundationsDraft): string[] {
  const out: string[] = [];
  const walk = (v: unknown) => {
    if (typeof v === "string") out.push(v);
    else if (Array.isArray(v)) v.forEach(walk);
    else if (v && typeof v === "object") Object.values(v).forEach(walk);
  };
  walk(draft);
  const r = { now: 0, next: 0, later: 0 };
  for (const i of draft.roadmap) r[i.horizon]++;
  const note = foundationsReadyNote(draft, c.inputs.door, { sectionsWritten: draft.sections.filter((s) => s.drafted).length, sectionsTotal: draft.sections.length, sectionsKept: 0, roadmap: r, importedIssues: draft.roadmap.filter((i) => i.imported).length });
  out.push(note.subject, note.bodyMd);
  return out;
}

/** Deterministic checks over the finalised draft and the raw model text. Empty = pass. */
export function checkFoundations(c: FoundationsCase, draft: FoundationsDraft, rawText: string): string[] {
  const problems: string[] = [];
  const { inputs } = c;
  if (draft.notes.missingSections.length) problems.push(`sections left out: ${draft.notes.missingSections.join(", ")}`);
  for (const s of draft.sections) {
    const pinned = inputs.outline.find((o) => o.section === s.section)?.pinned;
    if (!pinned && words(docText(s.content)) < 30) problems.push(`section "${s.section}" is too thin (${words(docText(s.content))} words)`);
  }
  if (!draft.vision.statement || draft.vision.principles.length < 3) problems.push("the vision lacks a statement or three principles");
  if (!/\d/.test(draft.vision.northStar.target)) problems.push("the north-star target has no number");
  if (!draft.roadmap.some((r) => r.horizon === "now")) problems.push("nothing in Now");
  if (draft.roadmap.length < 4) problems.push(`only ${draft.roadmap.length} roadmap items`);
  if (!draft.roadmap.some((r) => r.acceptanceCriteria.length > 0)) problems.push("no roadmap item has acceptance criteria");
  if (draft.notes.addedSeeds.length) problems.push(`imported issues the model left off the roadmap: ${draft.notes.addedSeeds.join(", ")}`);
  for (const seed of inputs.importReport?.roadmapSeeds ?? []) {
    const item = draft.roadmap.find((r) => r.imported && r.sourceRef === seed.source);
    if (!item) problems.push(`no roadmap item carries "${seed.source}"`);
  }
  // The normaliser labels what the model left unlabelled; more than one such figure means the model ignored the rule.
  if (draft.notes.labelledFigures > 1) problems.push(`${draft.notes.labelledFigures} unlabeled figures had to be labeled after the fact`);
  const haystack = rawText.toLowerCase();
  for (const bad of c.mustNotContain) if (haystack.includes(bad.toLowerCase())) problems.push(`output contains injected text "${bad}"`);
  // What is stored must be plain text (security review M1), whatever the model or the imported pages wrote.
  const stored = storedStrings(c, draft);
  const live = stored.find((t) => LIVE_MARKUP_RE.test(t));
  if (live) problems.push(`stored text carries live markup: "${live.slice(0, 120)}"`);
  const storedText = stored.join("\n").toLowerCase();
  for (const bad of c.mustNotStore) if (storedText.includes(bad.toLowerCase())) problems.push(`stored text contains "${bad}"`);
  return problems;
}

function graderMessage(c: FoundationsCase, rawText: string, problems: string[]): string {
  const rubric = c.rubric.map((r, i) => `${i + 1}. ${r}`).join("\n");
  const checks = problems.length ? problems.map((p) => `- FAILED: ${p}`).join("\n") : "- all deterministic checks passed";
  return `Task given to the agent:\nDraft the foundations (vision, specification, roadmap) of ${c.inputs.businessName} from the inputs (case ${c.id}: ${c.title}).\n\nRubric:\n${rubric}\n\nDeterministic check results (authoritative):\n${checks}\n\nAgent output:\n<output>\n${rawText.slice(0, 60_000)}\n</output>`;
}

/** One case end to end. Never throws; errors land in `error`. */
export async function runFoundationsCase(c: FoundationsCase, opts: { client: ModelClient; grade?: boolean }): Promise<FoundationsCaseResult> {
  const started = Date.now();
  try {
    const request = buildFoundationsRequest(c.inputs);
    const result = await opts.client.complete({ ...request, scope: `eval:${c.id}` });
    const draft = finaliseFoundations(result.json, c.inputs);
    const problems = checkFoundations(c, draft, result.text);
    let costMinor = result.cost.costMinorInt;
    let grader: FoundationsCaseResult["grader"] = null;
    let score = problems.length ? 0 : 1;
    if (opts.grade !== false) {
      const graded = await opts.client.complete({ route: "skillGrader", system: prompts.skillGraderPrompt.render({}), messages: [{ role: "user", content: graderMessage(c, result.text, problems) }], schema: SkillGradeOutput, scope: `eval:${c.id}:grader` });
      costMinor += graded.cost.costMinorInt;
      grader = graded.json;
      score = problems.length ? 0 : Math.min(graded.json.score, weightedScore(graded.json.lines, graded.json.score));
    }
    return { caseId: c.id, passed: problems.length === 0 && score >= FOUNDATIONS_PASS_THRESHOLD, score, problems, draft, costMinor, durationMs: Date.now() - started, grader };
  } catch (err) {
    return { caseId: c.id, passed: false, score: 0, problems: [], draft: null, costMinor: 0, durationMs: Date.now() - started, grader: null, error: err instanceof Error ? err.message : String(err) };
  }
}

/** A client that keeps every model answer's text (the staged drafting makes several calls; the checks read them all). */
export function recordingClient(client: ModelClient): { client: ModelClient; texts: string[] } {
  const texts: string[] = [];
  const recorded: ModelClient = {
    mode: client.mode,
    complete: (async (req: Parameters<ModelClient["complete"]>[0]) => {
      const res = await client.complete(req as never);
      texts.push(res.text);
      return res;
    }) as ModelClient["complete"],
    ...(client.streamStructured
      ? {
          async streamStructured<T, E>(req: StreamStructuredRequest<T, E>) {
            const res = await client.streamStructured!(req);
            texts.push(res.text);
            return res;
          },
        }
      : {}),
  };
  return { client: recorded, texts };
}

/**
 * One case through the staged drafting the product runs (audit P3: the plan, then the sections in parallel batches and
 * the roadmap, assembled from what each step stored), with the same deterministic checks and grader as the single call.
 * Never throws; errors land in `error`.
 */
export async function runFoundationsStagedCase(c: FoundationsCase, opts: { client: ModelClient; grade?: boolean }): Promise<FoundationsCaseResult> {
  const started = Date.now();
  try {
    const { client, texts } = recordingClient(opts.client);
    const store = memoryProgressStore();
    const { usage } = await draftFoundationsStaged({ models: client, inputs: c.inputs, store, scope: `eval:${c.id}:staged` }, { stored: null, author: null });
    const draft = assembleFoundationsDraft(store.progress!, c.inputs);
    const rawText = texts.join("\n\n");
    const problems = checkFoundations(c, draft, rawText);
    let costMinor = usage.costMinor;
    let grader: FoundationsCaseResult["grader"] = null;
    let score = problems.length ? 0 : 1;
    if (opts.grade !== false) {
      const graded = await opts.client.complete({ route: "skillGrader", system: prompts.skillGraderPrompt.render({}), messages: [{ role: "user", content: graderMessage(c, rawText, problems) }], schema: SkillGradeOutput, scope: `eval:${c.id}:grader` });
      costMinor += graded.cost.costMinorInt;
      grader = graded.json;
      score = problems.length ? 0 : Math.min(graded.json.score, weightedScore(graded.json.lines, graded.json.score));
    }
    return { caseId: c.id, passed: problems.length === 0 && score >= FOUNDATIONS_PASS_THRESHOLD, score, problems, draft, costMinor, durationMs: Date.now() - started, grader };
  } catch (err) {
    return { caseId: c.id, passed: false, score: 0, problems: [], draft: null, costMinor: 0, durationMs: Date.now() - started, grader: null, error: err instanceof Error ? err.message : String(err) };
  }
}

