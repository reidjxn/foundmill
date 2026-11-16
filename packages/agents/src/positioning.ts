/**
 * The project's positioning notes (WP-08 T1; @foundmill/shared `positioning.ts`): the first draft, its check, and the
 * one data block every marketing request carries once the founders approve the notes.
 *
 * - `buildPositioningRequest` / `finalisePositioning` / `starterPositioning` / `runPositioningDraft`: the Product lead's
 *   one-shot draft from the founder's own words (route `projectPage`, no new route). The check is strict: a line the
 *   founder's words do not support is an assumption, proof that is not the founder's own is dropped, and a line with a
 *   figure the inputs do not give is dropped. Any failure falls back to the starter (the one line only).
 * - `positioningBlock`: the approved notes as an <untrusted_content> block with a fixed heading. The notes hold the
 *   founders' words and, once approved, lines an agent proposed: data for the call, never instructions.
 * - `MARKETING_REQUEST_BUILDERS`: the names of every builder that must carry the block (the contract test fails when one
 *   is added without it).
 */
import { z } from "zod";
import { emptyPositioning, POSITIONING_LABELS, POSITIONING_STEPS, readPositioning, type PositioningLabel, type PositioningLine, type PositioningNotes } from "@foundmill/shared";
import type { CompleteResult, ModelClient, UsageAttribution } from "@foundmill/models/types";
import { foundationsSystem, inertJson, plainModelText, untrustedBlock, type FoundationsInputs } from "./foundations";
import { positioningPrompt } from "./prompts/positioning";
import type { RouteKey } from "./types";

export const POSITIONING_ROUTE = "projectPage" as const satisfies RouteKey;
export const POSITIONING_USAGE_KIND = "positioning";
export const POSITIONING_RESERVE_TOKENS = 1_600;
/** The most characters of the notes a prompt receives. */
export const POSITIONING_PROMPT_MAX = 4_000;

/** The heading of the block every marketing call carries. */
export const POSITIONING_BLOCK_HEADING = "Positioning notes (the founders' record; use only facts in it)";

/** Every request builder that drafts marketing words. Each takes `positioning?: string | null` and renders `positioningBlock`. */
export const MARKETING_REQUEST_BUILDERS = ["buildChannelCreativeRequest", "buildPostDraftRequest", "buildProjectPageRequest", "distributionStrategistMessage"] as const;

/** The approved notes as a data block, or null when the founders have approved none (nothing is added). */
export function positioningBlock(text: string | null | undefined): string | null {
  const t = text?.trim();
  if (!t) return null;
  return untrustedBlock("positioning_notes", { heading: POSITIONING_BLOCK_HEADING, notes: t.slice(0, POSITIONING_PROMPT_MAX) });
}

/** A request's user turn with the block added before its closing line, when there is one. */
export function withPositioning(parts: string[], text: string | null | undefined): string[] {
  const block = positioningBlock(text);
  if (!block) return parts;
  return [...parts.slice(0, -1), block, ...parts.slice(-1)];
}

// ---------------------------------------------------------------------------------------------------------------------
// The first draft
// ---------------------------------------------------------------------------------------------------------------------

const Line = z.object({ text: z.string().max(400).default(""), label: z.string().max(20).default("assumption"), source: z.string().max(400).nullable().default(null) });
export const PositioningOutput = z.object({
  one_line: z.string().max(400).default(""),
  step: z.string().max(20).default("follow"),
  for_whom: z.array(Line).max(10).default([]),
  problem: z.array(Line).max(10).default([]),
  today: z.array(Line).max(10).default([]),
  different: z.array(Line).max(10).default([]),
  proof: z.array(Line).max(10).default([]),
  objections: z.array(z.object({ doubt: z.string().max(400).default(""), answer: z.string().max(400).default(""), label: z.string().max(20).default("assumption") })).max(6).default([]),
  voice: z
    .object({
      traits: z.array(z.object({ trait: z.string().max(80).default(""), means: z.string().max(300).default(""), not_means: z.string().max(300).default(""), line: z.string().max(400).default("") })).max(6).default([]),
      uses: z.array(z.string().max(80)).max(20).default([]),
      never: z.array(z.string().max(80)).max(20).default([]),
    })
    .default({ traits: [], uses: [], never: [] }),
});
export type PositioningOutput = z.output<typeof PositioningOutput>;

export interface PositioningRequest {
  route: typeof POSITIONING_ROUTE;
  system: string[];
  messages: { role: "user"; content: string }[];
  schema: typeof PositioningOutput;
  reserveTokens: number;
}

/** The founder's own words: what a `founder` line must come from. The idea card is the Ideation agent's, not theirs. */
export function positioningFounderText(inputs: Pick<FoundationsInputs, "idea">): string {
  return [inputs.idea?.founderWords ?? "", inputs.idea?.brief ?? ""].join("\n");
}

export function buildPositioningRequest(inputs: FoundationsInputs): PositioningRequest {
  const idea = inputs.idea;
  const trusted = { business_name: inputs.businessName, founder_words: idea?.founderWords ?? null, brief: idea?.brief ?? null };
  const parts = ["```json\n" + inertJson(trusted) + "\n```"];
  if (idea && (idea.title || idea.pitch)) parts.push(untrustedBlock("idea", { idea_card: { title: idea.title, pitch: idea.pitch } }));
  parts.push("Draft the positioning notes now.");
  return {
    route: POSITIONING_ROUTE,
    system: [foundationsSystem(inputs), positioningPrompt.render({ business_name: inputs.businessName })],
    messages: [{ role: "user", content: parts.join("\n\n") }],
    schema: PositioningOutput,
    reserveTokens: POSITIONING_RESERVE_TOKENS,
  };
}

const NUMBER_RE = /\d+(?:[.,]\d+)*/g;
const numbersIn = (text: string): string[] => (text.match(NUMBER_RE) ?? []).map((n) => n.replace(/[.,](?=\d{3}\b)/g, ""));
const WORD_RE = /[\p{L}\p{N}']+/gu;
const contentWords = (text: string): string[] => (text.toLowerCase().match(WORD_RE) ?? []).filter((w) => w.length >= 4);
/** Quotation marks a model would use for a customer's words: never allowed in a first draft (nobody said anything yet). */
const QUOTE_RE = /["“”]/;

/** Whether the founder's words support a line: most of its content words appear in them. */
export function founderSupports(text: string, founderText: string): boolean {
  const words = contentWords(text);
  if (!words.length) return false;
  const known = new Set(contentWords(founderText));
  return words.filter((w) => known.has(w)).length / words.length >= 0.6;
}

const one = (s: string, max: number): string => plainModelText(s).replace(/\s+/g, " ").trim().slice(0, max);

/**
 * The model's answer as notes the founder can approve. Every line is plain text. A line keeps `founder` only when the
 * founder's words support it; every other label becomes `assumption` (nobody outside has said anything yet). Proof
 * lines that are not the founder's own, quotation marks and figures the inputs do not give are dropped. Null when
 * there is not even a one line.
 */
export function finalisePositioning(json: unknown, inputs: Pick<FoundationsInputs, "idea" | "businessName">, updatedOn: string): PositioningNotes | null {
  const parsed = PositioningOutput.safeParse(json);
  if (!parsed.success) return null;
  const out = parsed.data;
  const founderText = positioningFounderText(inputs);
  const known = new Set(numbersIn([inputs.businessName, founderText].join("\n")));
  const invented = (text: string) => numbersIn(text).some((n) => !known.has(n)) || QUOTE_RE.test(text);
  const label = (text: string, given: string): PositioningLabel => (given === "founder" && founderSupports(text, founderText) ? "founder" : "assumption");
  const lines = (items: PositioningOutput["for_whom"], opts: { founderOnly?: boolean } = {}): PositioningLine[] => {
    const res: PositioningLine[] = [];
    for (const item of items) {
      const text = one(item.text, 300);
      if (!text || invented(text)) continue;
      const l = label(text, (POSITIONING_LABELS as readonly string[]).includes(item.label) ? item.label : "assumption");
      if (opts.founderOnly && l !== "founder") continue;
      const source = one(item.source ?? "", 300);
      res.push({ text, label: l, source: l === "founder" ? "your words" : source || null });
      if (res.length >= 8) break;
    }
    return res;
  };
  const oneLine = one(out.one_line, 200);
  if (!oneLine || invented(oneLine)) return null;
  const notes: PositioningNotes = {
    ...emptyPositioning(oneLine, updatedOn),
    step: (POSITIONING_STEPS as readonly string[]).includes(out.step) ? (out.step as PositioningNotes["step"]) : "follow",
    forWhom: lines(out.for_whom),
    problem: lines(out.problem),
    today: lines(out.today),
    different: lines(out.different),
    proof: lines(out.proof, { founderOnly: true }),
    objections: out.objections
      .map((o) => ({ doubt: one(o.doubt, 300), answer: one(o.answer, 300) }))
      .filter((o) => o.doubt && !invented(o.doubt) && !invented(o.answer))
      .slice(0, 3)
      .map((o) => ({ ...o, label: "assumption" as const })),
    voice: {
      traits: out.voice.traits
        .map((t) => ({ trait: one(t.trait, 60), means: one(t.means, 200), notMeans: one(t.not_means, 200), line: one(t.line, 300) }))
        .filter((t) => t.trait && !invented(t.line))
        .slice(0, 3),
      uses: out.voice.uses.map((w) => one(w, 60)).filter(Boolean).slice(0, 12),
      never: out.voice.never.map((w) => one(w, 60)).filter(Boolean).slice(0, 12),
    },
  };
  return readPositioning(notes);
}

/** The draft every failure falls back to: the one line from the founder's words (else the card's pitch), nothing else. */
export function starterPositioning(inputs: Pick<FoundationsInputs, "idea" | "businessName">, updatedOn: string): PositioningNotes {
  const words = inputs.idea?.founderWords ?? inputs.idea?.pitch ?? "";
  const first = (words.split(/(?<=[.!?])\s/)[0] ?? "").trim();
  return emptyPositioning(first || inputs.businessName, updatedOn);
}

export interface PositioningDrafted {
  notes: PositioningNotes;
  source: "model" | "starter";
  costMinor: number;
}

/** One call; any failure (the call, the answer) gives the starter, so the founder always gets something to read. */
export async function runPositioningDraft(client: ModelClient, inputs: FoundationsInputs, opts: { attribution: UsageAttribution; signal?: AbortSignal; scope?: string; at?: Date }): Promise<PositioningDrafted> {
  const on = (opts.at ?? new Date()).toISOString().slice(0, 10);
  let res: CompleteResult<unknown>;
  try {
    res = await client.complete({ ...buildPositioningRequest(inputs), attribution: opts.attribution, signal: opts.signal, scope: opts.scope });
  } catch (err) {
    if (opts.signal?.aborted) throw err;
    return { notes: starterPositioning(inputs, on), source: "starter", costMinor: 0 };
  }
  const notes = finalisePositioning(res.json, inputs, on);
  return notes ? { notes, source: "model", costMinor: res.cost.costMinorInt } : { notes: starterPositioning(inputs, on), source: "starter", costMinor: res.cost.costMinorInt };
}

/** The Distribution Strategist's user turn (apps/api `distribution.recommend`): its JSON facts, then the notes. */
export function distributionStrategistMessage(data: unknown, positioning?: string | null): string {
  return ["```json\n" + JSON.stringify(data) + "\n```", positioningBlock(positioning)].filter(Boolean).join("\n\n");
}
