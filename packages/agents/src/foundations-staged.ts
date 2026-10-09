/**
 * Staged foundations drafting (audit P3; BUILD §11.1 first open, §11.5): the pure half.
 *
 * The single 24k-token call of `buildFoundationsRequest` becomes three steps that the founder can watch:
 * 1. a short plan on the `foundationsSkeleton` route (the full vision, one thesis per outline section, the roadmap's
 *    titles): the vision is stored as soon as it has streamed, within seconds;
 * 2. the specification sections in parallel batches of two or three, each written from the plan (bounded output);
 * 3. the roadmap, in parallel with step 2.
 * Every call shares one system prefix (house rules, the Product lead's instructions, the `foundations_brief` and the
 * trusted inputs) sent with a cache breakpoint; the untrusted inputs, the plan (model-written, so untrusted too) and the
 * step's instruction travel in the user turn.
 *
 * What each step produced is stored on the `business_foundations` row as it lands (`FoundationsProgress`, already
 * plain text with figures labelled), which is what the screens show while drafting and what a retry resumes from. The
 * final apply stays one transaction: `assembleFoundationsDraft` turns the stored progress into the same
 * `FoundationsDraft` `finaliseFoundations` produces, so every guarantee of the single call holds (one block per section
 * opening with a heading, import seeds on the roadmap, Estimate/Forecast labels, pinned blocks left alone by apply).
 *
 * Nothing here calls a model: ./foundations-steps.ts runs the steps through the client it is given.
 */
import { z } from "zod";
import { ROADMAP_HORIZONS, type RoadmapHorizon } from "@foundmill/shared";
import {
  FIGURE_LABELS,
  FoundationsRoadmapItem,
  FoundationsSection,
  FoundationsSkeletonOutput,
  TiptapDoc,
  type TiptapDoc as TiptapDocT,
} from "@foundmill/models/schemas";
import {
  FOUNDATIONS_ROUTE,
  docText,
  finaliseOpenQuestions,
  finaliseRoadmap,
  finaliseSection,
  finaliseVision,
  foundationsPromptVariables,
  foundationsSystem,
  foundationsTrustedBlock,
  foundationsUntrustedBlocks,
  knownNumbers,
  missingSectionDraft,
  normKey,
  plainLine,
  untrustedBlock,
  type FoundationsDraft,
  type FoundationsInputs,
  type FoundationsSectionDraft,
  type FoundationsVisionRecord,
} from "./foundations";
import { foundationsBriefPrompt, foundationsRoadmapPrompt, foundationsSectionsPrompt, foundationsSkeletonPrompt } from "./prompts/foundations";
import type { RouteKey } from "./types";

// ---------------------------------------------------------------------------------------------------------------------
// Budgets
// ---------------------------------------------------------------------------------------------------------------------

export const FOUNDATIONS_SKELETON_ROUTE = "foundationsSkeleton" as const satisfies RouteKey;
/** The plan is short (≈1.5k tokens); the rest is headroom for the (low-effort) thinking that precedes it. */
export const FOUNDATIONS_SKELETON_MAX_TOKENS = 6_000;
/** Output tokens one section may take (80-250 words of Tiptap JSON), and the thinking headroom of every call. */
export const FOUNDATIONS_SECTION_MAX_TOKENS = 2_500;
export const FOUNDATIONS_THINKING_HEADROOM = 2_000;
export const FOUNDATIONS_ROADMAP_MAX_TOKENS = 8_000;
/** What the limiter books per call (what a call really writes), so the parallel calls do not reserve their caps. */
export const FOUNDATIONS_SKELETON_RESERVE = 2_000;
export const FOUNDATIONS_SECTION_RESERVE = 1_200;
export const FOUNDATIONS_ROADMAP_RESERVE = 3_000;
/** At most this many section calls run at once (batches of two, three when the outline is long). */
export const FOUNDATIONS_MAX_SECTION_CALLS = 6;
export const FOUNDATIONS_MIN_SECTIONS_PER_CALL = 2;

/** Outline sections in batches: two per call, more only when the outline is long, at most `maxCalls` batches. */
export function chunkSections(sections: readonly string[], maxCalls = FOUNDATIONS_MAX_SECTION_CALLS): string[][] {
  if (!sections.length) return [];
  const size = Math.max(FOUNDATIONS_MIN_SECTIONS_PER_CALL, Math.ceil(sections.length / Math.max(1, maxCalls)));
  const out: string[][] = [];
  for (let i = 0; i < sections.length; i += size) out.push(sections.slice(i, i + size));
  return out;
}

// ---------------------------------------------------------------------------------------------------------------------
// Stored progress
// ---------------------------------------------------------------------------------------------------------------------

export const FOUNDATIONS_PROGRESS_VERSION = 1 as const;

const VisionRecord = z.object({
  statement: z.string(),
  forWhom: z.string(),
  problem: z.string(),
  whyNow: z.string(),
  principles: z.array(z.object({ title: z.string(), detail: z.string() })),
  northStar: z.object({ metric: z.string(), definition: z.string(), target: z.string(), label: z.enum(FIGURE_LABELS) }),
});

/** One finalised section (plain text, figures labelled, opening with a heading), keyed by its outline name. */
export const StoredFoundationsSection = z.object({
  section: z.string().min(1),
  content: TiptapDoc,
  sourceRefs: z.array(z.string()).default([]),
  /** Figures labelled when it was finalised (summed into the draft's notes). */
  labelled: z.number().int().nonnegative().default(0),
});
export type StoredFoundationsSection = z.output<typeof StoredFoundationsSection>;

export const FoundationsProgressAuthor = z.object({ agentId: z.string().nullable(), name: z.string().nullable(), role: z.string().nullable() });
export type FoundationsProgressAuthor = z.output<typeof FoundationsProgressAuthor>;

/**
 * What a drafting run has stored so far (`business_foundations.progress`). Kept across attempts of the same business,
 * so Try again resumes where the failed attempt stopped; another outline starts over. Written only by the drafting
 * (service role), read by members through `product.foundations.get` (projected by `foundationsProgressView`).
 */
export const FoundationsProgress = z.object({
  v: z.literal(FOUNDATIONS_PROGRESS_VERSION),
  /** The outline (section names, in order) this progress was drafted for. */
  outline: z.array(z.string()),
  author: FoundationsProgressAuthor.nullable().default(null),
  vision: VisionRecord.nullable().default(null),
  visionLabelled: z.number().int().nonnegative().default(0),
  /** Step 1: one thesis per section and the planned roadmap titles (plain text). Empty until the plan is complete. */
  theses: z.array(z.object({ section: z.string(), thesis: z.string() })).default([]),
  planned: z.array(z.object({ title: z.string(), horizon: z.enum(ROADMAP_HORIZONS) })).default([]),
  planDone: z.boolean().default(false),
  /** Step 2: finalised sections by outline name. */
  sections: z.record(z.string(), StoredFoundationsSection).default({}),
  /** Step 3: the roadmap items as the model wrote them (finalised as a whole at apply), and the open questions. */
  roadmap: z.array(FoundationsRoadmapItem).default([]),
  openQuestions: z.array(z.string()).default([]),
  roadmapDone: z.boolean().default(false),
});
export type FoundationsProgress = z.output<typeof FoundationsProgress>;

/** The stored progress, re-validated (it is JSON on the row); null when absent, unreadable or of another version. */
export function readFoundationsProgress(raw: unknown): FoundationsProgress | null {
  if (!raw || typeof raw !== "object") return null;
  const parsed = FoundationsProgress.safeParse(raw);
  return parsed.success ? parsed.data : null;
}

export function emptyFoundationsProgress(inputs: Pick<FoundationsInputs, "outline">, author: FoundationsProgressAuthor | null): FoundationsProgress {
  return FoundationsProgress.parse({ v: FOUNDATIONS_PROGRESS_VERSION, outline: inputs.outline.map((o) => o.section), author });
}

/** Whether stored progress can be resumed for these inputs: same outline, in the same order. */
export function progressMatches(progress: FoundationsProgress | null, inputs: Pick<FoundationsInputs, "outline">): progress is FoundationsProgress {
  if (!progress) return false;
  const outline = inputs.outline.map((o) => o.section);
  return progress.outline.length === outline.length && progress.outline.every((s, i) => s === outline[i]);
}

export const skeletonDone = (p: FoundationsProgress) => p.vision !== null && p.planDone;
export const sectionsDone = (p: FoundationsProgress) => p.outline.filter((s) => p.sections[s]).length;
/** Outline sections not stored yet, in outline order. */
export const sectionsToWrite = (p: FoundationsProgress) => p.outline.filter((s) => !p.sections[s]);

/**
 * A change to the stored progress. `replace` starts over; `set` replaces top-level keys; `section` adds one section
 * (merged into `sections` on its own, so parallel batches never overwrite each other).
 */
export type FoundationsProgressPatch = { replace: FoundationsProgress } | { set: Partial<Omit<FoundationsProgress, "v" | "sections">> } | { section: StoredFoundationsSection };

/** What a stored patch was (the `foundations.progressed` event's `step`). */
export type FoundationsProgressStep = "started" | "vision" | "plan" | "section" | "roadmap";

/** Apply a patch in memory (what the database does with its jsonb operators; tests and in-process stores). */
export function applyProgressPatch(progress: FoundationsProgress | null, patch: FoundationsProgressPatch): FoundationsProgress {
  if ("replace" in patch) return patch.replace;
  const base = progress ?? FoundationsProgress.parse({ v: FOUNDATIONS_PROGRESS_VERSION, outline: [] });
  if ("set" in patch) return { ...base, ...patch.set };
  return { ...base, sections: { ...base.sections, [patch.section.section]: patch.section } };
}

/** The `foundations.progressed` payload for what was just stored. */
export function progressEventPayload(attempt: number, step: FoundationsProgressStep, progress: FoundationsProgress, section: string | null = null) {
  return {
    attempt,
    step,
    section: section ? section.slice(0, 200) : null,
    sectionsDone: sectionsDone(progress),
    sectionsTotal: progress.outline.length,
    roadmapItems: progress.roadmap.length,
    visionReady: progress.vision !== null,
  };
}

/** The `foundations.progressed` payload of the apply that wrote it all (step `ready`). */
export function readyEventPayload(attempt: number, draft: Pick<FoundationsDraft, "sections" | "roadmap">) {
  return { attempt, step: "ready" as const, section: null, sectionsDone: draft.sections.filter((s) => s.drafted).length, sectionsTotal: draft.sections.length, roadmapItems: draft.roadmap.length, visionReady: true };
}

/**
 * Where a drafting run stores what it produced. `save` returns the progress as stored, or null when the attempt is no
 * longer the current drafting one (retried, failed or finished elsewhere): the run then stops.
 */
export interface FoundationsProgressStore {
  save(patch: FoundationsProgressPatch, step: FoundationsProgressStep, section?: string | null): Promise<FoundationsProgress | null>;
}

/** An in-memory store (tests, evals). */
export function memoryProgressStore(initial: FoundationsProgress | null = null): FoundationsProgressStore & { progress: FoundationsProgress | null; saves: { step: FoundationsProgressStep; section: string | null }[] } {
  const store = {
    progress: initial,
    saves: [] as { step: FoundationsProgressStep; section: string | null }[],
    async save(patch: FoundationsProgressPatch, step: FoundationsProgressStep, section: string | null = null) {
      store.progress = applyProgressPatch(store.progress, patch);
      store.saves.push({ step, section });
      return store.progress;
    },
  };
  return store;
}

// ---------------------------------------------------------------------------------------------------------------------
// Finalising what each step returns (plain text first, figures labelled: M1, CLAUDE.md)
// ---------------------------------------------------------------------------------------------------------------------

/** The section of `names` a model entry is for (case and punctuation ignored), or null. */
export function matchSection(written: string, names: readonly string[]): string | null {
  const key = normKey(written);
  return names.find((n) => normKey(n) === key) ?? null;
}

/** A model section as stored, under its outline name. */
export function storedSection(found: FoundationsSection, section: string, inputs: FoundationsInputs, known: ReadonlySet<string> = knownNumbers(inputs)): StoredFoundationsSection {
  const fin = finaliseSection(found, section, known);
  return { section, content: fin.content, sourceRefs: fin.sourceRefs, labelled: fin.labelled };
}

/** The plan as stored: the theses of the outline sections (in outline order) and the planned roadmap titles. */
export function skeletonPatch(output: FoundationsSkeletonOutput, inputs: FoundationsInputs, known: ReadonlySet<string> = knownNumbers(inputs)): Pick<FoundationsProgress, "visionLabelled" | "theses" | "planned" | "planDone"> & { vision: FoundationsVisionRecord } {
  const v = finaliseVision(output.vision, known);
  const outline = inputs.outline.map((o) => o.section);
  const theses: FoundationsProgress["theses"] = [];
  for (const s of output.sections) {
    const section = matchSection(s.section, outline);
    if (section && !theses.some((t) => t.section === section)) theses.push({ section, thesis: plainLine(s.thesis).slice(0, 400) });
  }
  theses.sort((a, b) => outline.indexOf(a.section) - outline.indexOf(b.section));
  const seen = new Set<string>();
  const planned: FoundationsProgress["planned"] = [];
  for (const r of output.roadmap) {
    const title = plainLine(r.title).slice(0, 200);
    if (!title || seen.has(normKey(title))) continue;
    seen.add(normKey(title));
    planned.push({ title, horizon: r.horizon });
  }
  return { vision: v.vision, visionLabelled: v.labelled, theses, planned, planDone: true };
}

// ---------------------------------------------------------------------------------------------------------------------
// Requests
// ---------------------------------------------------------------------------------------------------------------------

export interface FoundationsStageRequest<T> {
  route: RouteKey;
  system: string[];
  /** The system prefix is the same for every call of a run: cached after the first (the plan). */
  cacheSystem: true;
  messages: { role: "user"; content: string }[];
  schema: z.ZodType<T>;
  maxTokens: number;
  reserveTokens: number;
}

/** The shared prefix: house rules + Product lead instructions, then the brief with the trusted inputs. */
export function foundationsStagedSystem(inputs: FoundationsInputs): string[] {
  return [foundationsSystem(inputs), `${foundationsBriefPrompt.render(foundationsPromptVariables(inputs))}\n\n${foundationsTrustedBlock(inputs)}`];
}

/** The plan as the later steps read it: model-written, so inside an <untrusted_content> block like the inputs. */
export function planBlock(progress: FoundationsProgress): string {
  return untrustedBlock("plan", {
    plan: {
      vision: progress.vision,
      sections: progress.theses.filter((t) => t.thesis).map((t) => ({ section: t.section, thesis: t.thesis })),
      roadmap: progress.planned,
    },
  });
}

/** Step 1: the vision, the theses and the roadmap's titles. Streams `sections`; the vision is complete before them. */
export function buildFoundationsSkeletonRequest(inputs: FoundationsInputs): FoundationsStageRequest<FoundationsSkeletonOutput> {
  const instruction = foundationsSkeletonPrompt.render({ section_count: Math.max(1, inputs.outline.length) });
  return {
    route: FOUNDATIONS_SKELETON_ROUTE,
    system: foundationsStagedSystem(inputs),
    cacheSystem: true,
    messages: [{ role: "user", content: [...foundationsUntrustedBlocks(inputs), instruction].join("\n\n") }],
    schema: FoundationsSkeletonOutput,
    maxTokens: FOUNDATIONS_SKELETON_MAX_TOKENS,
    reserveTokens: FOUNDATIONS_SKELETON_RESERVE,
  };
}

/** What a section call returns: the named sections (an extra or a missing one is handled by the caller). */
export function foundationsSectionsSchema(count: number) {
  return z.object({ sections: z.array(FoundationsSection).min(1).max(Math.max(1, count) + 2) });
}
export type FoundationsSectionsStepOutput = z.output<ReturnType<typeof foundationsSectionsSchema>>;

/** Step 2: a batch of sections, written from the plan. The names also travel as `write_sections` (the mock reads it). */
export function buildFoundationsSectionsRequest(inputs: FoundationsInputs, progress: FoundationsProgress, sections: readonly string[]): FoundationsStageRequest<FoundationsSectionsStepOutput> {
  const instruction = foundationsSectionsPrompt.render({ sections: [...sections] });
  return {
    route: FOUNDATIONS_ROUTE,
    system: foundationsStagedSystem(inputs),
    cacheSystem: true,
    messages: [{ role: "user", content: [...foundationsUntrustedBlocks(inputs), planBlock(progress), instruction, "```json\n" + JSON.stringify({ write_sections: sections }) + "\n```"].join("\n\n") }],
    schema: foundationsSectionsSchema(sections.length),
    maxTokens: FOUNDATIONS_SECTION_MAX_TOKENS * sections.length + FOUNDATIONS_THINKING_HEADROOM,
    reserveTokens: FOUNDATIONS_SECTION_RESERVE * sections.length,
  };
}

export const FoundationsRoadmapStepOutput = z.object({
  roadmap: z.array(FoundationsRoadmapItem).min(3).max(40),
  open_questions: z.array(z.string().min(1).max(400)).max(10),
});
export type FoundationsRoadmapStepOutput = z.output<typeof FoundationsRoadmapStepOutput>;

/** Step 3: the roadmap items for the plan's titles, and the open questions. Streams `roadmap`. */
export function buildFoundationsRoadmapRequest(inputs: FoundationsInputs, progress: FoundationsProgress): FoundationsStageRequest<FoundationsRoadmapStepOutput> {
  return {
    route: FOUNDATIONS_ROUTE,
    system: foundationsStagedSystem(inputs),
    cacheSystem: true,
    messages: [{ role: "user", content: [...foundationsUntrustedBlocks(inputs), planBlock(progress), foundationsRoadmapPrompt.render({})].join("\n\n") }],
    schema: FoundationsRoadmapStepOutput,
    maxTokens: FOUNDATIONS_ROADMAP_MAX_TOKENS,
    reserveTokens: FOUNDATIONS_ROADMAP_RESERVE,
  };
}

// ---------------------------------------------------------------------------------------------------------------------
// Assembly: stored progress → the draft apply writes in one transaction
// ---------------------------------------------------------------------------------------------------------------------

export class FoundationsIncompleteError extends Error {
  constructor(readonly missing: "vision" | "roadmap") {
    super(`The foundations drafting has no ${missing} to apply yet`);
    this.name = "FoundationsIncompleteError";
  }
}

/**
 * The draft from what the steps stored, with the same guarantees as `finaliseFoundations`: one entry per outline
 * section in outline order (a placeholder, an open question and an empty block for a section the steps never stored),
 * every section normalised again (idempotent), the roadmap finalised as a whole (dedupe, block links, every import
 * seed, at least one item in Now) and every figure labelled.
 */
export function assembleFoundationsDraft(progress: FoundationsProgress, inputs: FoundationsInputs): FoundationsDraft {
  if (!progress.vision) throw new FoundationsIncompleteError("vision");
  if (!progress.roadmapDone) throw new FoundationsIncompleteError("roadmap");
  const known = knownNumbers(inputs);
  let labelledFigures = progress.visionLabelled;
  const missingSections: string[] = [];
  const stored = new Map(Object.values(progress.sections).map((s) => [normKey(s.section), s] as const));
  const sections: FoundationsSectionDraft[] = inputs.outline.map((o) => {
    const found = stored.get(normKey(o.section));
    if (!found) {
      missingSections.push(o.section);
      return missingSectionDraft(o);
    }
    const fin = finaliseSection({ content: found.content, source_refs: found.sourceRefs }, o.section, known);
    labelledFigures += found.labelled + fin.labelled;
    return { section: o.section, blockId: o.blockId, content: fin.content, sourceRefs: fin.sourceRefs, drafted: true };
  });
  const r = finaliseRoadmap(progress.roadmap, inputs, known);
  labelledFigures += r.labelled;
  return {
    vision: progress.vision,
    sections,
    roadmap: r.roadmap,
    openQuestions: finaliseOpenQuestions(progress.openQuestions, missingSections),
    notes: { missingSections, ignoredSections: [], addedSeeds: r.addedSeeds, labelledFigures },
  };
}

// ---------------------------------------------------------------------------------------------------------------------
// What the screens read while drafting
// ---------------------------------------------------------------------------------------------------------------------

/** vision → specification (sections and roadmap being written) → roadmap (only the roadmap left) → finishing (applying). */
export const FOUNDATIONS_STAGES = ["vision", "specification", "roadmap", "finishing"] as const;
export type FoundationsStage = (typeof FOUNDATIONS_STAGES)[number];

export interface FoundationsProgressView {
  stage: FoundationsStage;
  author: FoundationsProgressAuthor | null;
  /** Every outline section in order: its title and content once stored, its thesis once planned. */
  sections: { section: string; title: string | null; thesis: string | null; done: boolean; content: TiptapDocT | null }[];
  sectionsDone: number;
  sectionsTotal: number;
  /** Written items first (plain titles), then the planned titles not written yet. */
  roadmap: { title: string; horizon: RoadmapHorizon; written: boolean }[];
  roadmapWritten: number;
  roadmapDone: boolean;
}

function firstHeading(doc: TiptapDocT): string | null {
  const h = doc.content.find((b) => b.type === "heading");
  const text = h && h.type === "heading" ? h.content.map((t) => t.text).join("").trim() : "";
  return text || docText(doc).split("\n")[0]?.slice(0, 120) || null;
}

export function foundationsStage(p: FoundationsProgress): FoundationsStage {
  if (!p.vision) return "vision";
  const allSections = sectionsDone(p) >= p.outline.length;
  if (!allSections) return "specification";
  return p.roadmapDone ? "finishing" : "roadmap";
}

/** Display-safe projection of the stored progress (everything in it is already plain text). */
export function foundationsProgressView(progress: FoundationsProgress): FoundationsProgressView {
  const thesis = new Map(progress.theses.map((t) => [t.section, t.thesis] as const));
  const sections = progress.outline.map((section) => {
    const s = progress.sections[section];
    return { section, title: s ? firstHeading(s.content) : null, thesis: thesis.get(section) || null, done: Boolean(s), content: s ? s.content : null };
  });
  const written = progress.roadmap.map((r) => ({ title: plainLine(r.title).slice(0, 200), horizon: r.horizon, written: true }));
  const writtenKeys = new Set(written.map((w) => normKey(w.title)));
  const planned = progress.roadmapDone ? [] : progress.planned.filter((p) => !writtenKeys.has(normKey(p.title))).map((p) => ({ ...p, written: false }));
  return {
    stage: foundationsStage(progress),
    author: progress.author,
    sections,
    sectionsDone: sections.filter((s) => s.done).length,
    sectionsTotal: sections.length,
    roadmap: [...written, ...planned],
    roadmapWritten: written.length,
    roadmapDone: progress.roadmapDone,
  };
}
