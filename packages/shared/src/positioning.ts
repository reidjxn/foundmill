/**
 * The project's positioning notes (WP-08 T1; audit a5 GTM-08): one record of who the project is for, their problem,
 * what they use today and what is different, which every marketing call reads first. The layout is the
 * `positioning_notes` skill's (docs/holistic-plan/skills/marketing/positioning_notes.md step 1): a header and eight
 * sections, names and order kept.
 *
 * Every line carries a label so a reader knows how far to trust it: `founder` (they said or decided it), `customer`
 * (someone it is for said it), `observed` (seen on a public page), `assumption` (nobody has confirmed it yet). Stored
 * as jsonb on `business_foundations` (`positioning` approved, `positioning_draft` waiting for the founder, 0116); read
 * here defensively, like `readPageContent`.
 */
import { z } from "zod";

export const POSITIONING_LABELS = ["founder", "customer", "observed", "assumption"] as const;
export type PositioningLabel = (typeof POSITIONING_LABELS)[number];

/** The one step the project asks a stranger for. */
export const POSITIONING_STEPS = ["follow", "waitlist", "book", "buy"] as const;
export type PositioningStep = (typeof POSITIONING_STEPS)[number];

export const POSITIONING_STEP_LABELS: Readonly<Record<PositioningStep, string>> = {
  follow: "Follow",
  waitlist: "Join the waitlist",
  book: "Book",
  buy: "Buy",
};

export const POSITIONING_LIMITS = { line: 300, oneLine: 200, source: 300, perSection: 8, objections: 3, traits: 3, words: 12, learned: 20, changes: 20, short: 200 } as const;

export interface PositioningLine {
  text: string;
  label: PositioningLabel;
  /** The record, address and date it comes from; for an assumption, the cheapest way to find out. */
  source: string | null;
}

export interface PositioningObjection {
  doubt: string;
  answer: string;
  label: PositioningLabel;
}

export interface PositioningTrait {
  trait: string;
  means: string;
  notMeans: string;
  line: string;
}

export const POSITIONING_LEARNED_STATUSES = ["active", "watch", "retired"] as const;
export type PositioningLearnedStatus = (typeof POSITIONING_LEARNED_STATUSES)[number];

export interface PositioningLearned {
  on: string;
  lesson: string;
  evidence: string;
  appliesTo: string;
  status: PositioningLearnedStatus;
}

export interface PositioningNotes {
  version: number;
  /** YYYY-MM-DD. */
  updatedOn: string;
  oneLine: string;
  step: PositioningStep;
  forWhom: PositioningLine[];
  problem: PositioningLine[];
  today: PositioningLine[];
  different: PositioningLine[];
  proof: PositioningLine[];
  objections: PositioningObjection[];
  voice: { traits: PositioningTrait[]; uses: string[]; never: string[] };
  learned: PositioningLearned[];
  changes: { version: number; on: string; note: string }[];
}

/** The five sections made of labeled lines, in the layout's order, with their headings. */
export const POSITIONING_LINE_SECTIONS = [
  { key: "forWhom", heading: "1. Who it is for" },
  { key: "problem", heading: "2. The problem, in their words" },
  { key: "today", heading: "3. What they use today" },
  { key: "different", heading: "4. What is different" },
  { key: "proof", heading: "5. Proof that exists today" },
] as const satisfies readonly { key: keyof PositioningNotes; heading: string }[];
export type PositioningLineSection = (typeof POSITIONING_LINE_SECTIONS)[number]["key"];

export const POSITIONING_HEADINGS = {
  objections: "6. Objections",
  voice: "7. Voice",
  learned: "8. Learned so far",
  changes: "Changes",
} as const;

/** The note the team raises once a draft is waiting (one while it is open). */
export const POSITIONING_NOTE = { key: "positioning_ready", subject: "This is how your team will describe your project" } as const;

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

const str = (v: unknown, max: number): string => (typeof v === "string" ? v.replace(/\s+/g, " ").trim().slice(0, max) : "");
const oneOf = <T extends string>(v: unknown, all: readonly T[], fallback: T): T => ((all as readonly string[]).includes(v as string) ? (v as T) : fallback);
const list = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const obj = (v: unknown): Record<string, unknown> => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {});

function readLines(v: unknown): PositioningLine[] {
  const out: PositioningLine[] = [];
  for (const item of list(v)) {
    const o = obj(item);
    const text = str(o.text, POSITIONING_LIMITS.line);
    if (!text) continue;
    const source = str(o.source, POSITIONING_LIMITS.source);
    out.push({ text, label: oneOf(o.label, POSITIONING_LABELS, "assumption"), source: source || null });
    if (out.length >= POSITIONING_LIMITS.perSection) break;
  }
  return out;
}

const readWords = (v: unknown): string[] =>
  list(v)
    .map((w) => str(w, 60))
    .filter(Boolean)
    .slice(0, POSITIONING_LIMITS.words);

/** The notes as stored or sent, read defensively: unknown labels become `assumption`, long text is cut; null when not notes at all. */
export function readPositioning(value: unknown): PositioningNotes | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const v = value as Record<string, unknown>;
  if (typeof v.oneLine !== "string") return null;
  const version = typeof v.version === "number" && Number.isInteger(v.version) && v.version >= 0 ? v.version : 0;
  const voice = obj(v.voice);
  return {
    version,
    updatedOn: typeof v.updatedOn === "string" && DAY_RE.test(v.updatedOn) ? v.updatedOn : "",
    oneLine: str(v.oneLine, POSITIONING_LIMITS.oneLine),
    step: oneOf(v.step, POSITIONING_STEPS, "follow"),
    forWhom: readLines(v.forWhom),
    problem: readLines(v.problem),
    today: readLines(v.today),
    different: readLines(v.different),
    proof: readLines(v.proof),
    objections: list(v.objections)
      .map((o) => obj(o))
      .map((o) => ({ doubt: str(o.doubt, POSITIONING_LIMITS.line), answer: str(o.answer, POSITIONING_LIMITS.line), label: oneOf(o.label, POSITIONING_LABELS, "assumption") }))
      .filter((o) => o.doubt)
      .slice(0, POSITIONING_LIMITS.objections),
    voice: {
      traits: list(voice.traits)
        .map((t) => obj(t))
        .map((t) => ({ trait: str(t.trait, 60), means: str(t.means, POSITIONING_LIMITS.short), notMeans: str(t.notMeans, POSITIONING_LIMITS.short), line: str(t.line, POSITIONING_LIMITS.line) }))
        .filter((t) => t.trait)
        .slice(0, POSITIONING_LIMITS.traits),
      uses: readWords(voice.uses),
      never: readWords(voice.never),
    },
    learned: list(v.learned)
      .map((l) => obj(l))
      .map((l) => ({ on: typeof l.on === "string" && DAY_RE.test(l.on) ? l.on : "", lesson: str(l.lesson, POSITIONING_LIMITS.line), evidence: str(l.evidence, POSITIONING_LIMITS.line), appliesTo: str(l.appliesTo, POSITIONING_LIMITS.short), status: oneOf(l.status, POSITIONING_LEARNED_STATUSES, "watch") }))
      .filter((l) => l.lesson)
      .slice(0, POSITIONING_LIMITS.learned),
    changes: list(v.changes)
      .map((c) => obj(c))
      .map((c) => ({ version: typeof c.version === "number" && Number.isInteger(c.version) ? c.version : 0, on: typeof c.on === "string" && DAY_RE.test(c.on) ? c.on : "", note: str(c.note, POSITIONING_LIMITS.line) }))
      .filter((c) => c.note)
      .slice(0, POSITIONING_LIMITS.changes),
  };
}

/** Empty notes with only the one line (the starter when the team's call fails). */
export function emptyPositioning(oneLine: string, updatedOn: string): PositioningNotes {
  return { version: 0, updatedOn, oneLine: str(oneLine, POSITIONING_LIMITS.oneLine), step: "follow", forWhom: [], problem: [], today: [], different: [], proof: [], objections: [], voice: { traits: [], uses: [], never: [] }, learned: [], changes: [] };
}

/**
 * What keeps the notes from being approved, in reading order: a one line, every line labeled (the reader does that),
 * every line that is not an assumption names its source, at most eight lines a section. Empty when they may be approved.
 */
export function positioningProblems(n: PositioningNotes): string[] {
  const problems: string[] = [];
  if (!n.oneLine.trim()) problems.push("Write the one line: what it is and who it is for.");
  for (const { key, heading } of POSITIONING_LINE_SECTIONS) {
    const lines = n[key];
    if (lines.length > POSITIONING_LIMITS.perSection) problems.push(`${heading} has more than ${POSITIONING_LIMITS.perSection} lines.`);
    lines.forEach((line, i) => {
      if (!(POSITIONING_LABELS as readonly string[]).includes(line.label)) problems.push(`${heading}, line ${i + 1}: choose a label.`);
      else if (line.label !== "assumption" && !line.source?.trim()) problems.push(`${heading}, line ${i + 1}: say where it comes from, or mark it as an assumption.`);
    });
  }
  return problems;
}

const LABEL_WORDS: Readonly<Record<PositioningLabel, string>> = { founder: "founder", customer: "customer", observed: "observed", assumption: "assumption" };

/** "Nov 15, 2026" from "2026-11-15"; the text as it is when it is not a day. */
export function positioningDay(day: string): string {
  if (!DAY_RE.test(day)) return day;
  return new Date(`${day}T12:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
}

const lineText = (l: PositioningLine): string => `- ${l.text} (${LABEL_WORDS[l.label]}${l.source ? `; ${l.source}` : ""})`;

/**
 * The one text block prompts receive: the header, the eight sections in order with each line's label, then the last
 * changes. Cut at `max` characters on a line boundary, so a prompt never carries half a line.
 */
export function renderPositioning(n: PositioningNotes, max = 4_000): string {
  const out: string[] = ["Positioning notes", `Version: v${n.version}${n.updatedOn ? `, ${positioningDay(n.updatedOn)}` : ""}`, `One line: ${n.oneLine || "(not written yet)"}`, `The step we ask for: ${POSITIONING_STEP_LABELS[n.step]}`];
  for (const { key, heading } of POSITIONING_LINE_SECTIONS) {
    out.push("", heading);
    const lines = n[key];
    if (!lines.length) out.push("- None yet.");
    for (const l of lines) out.push(lineText(l));
  }
  out.push("", POSITIONING_HEADINGS.objections);
  if (!n.objections.length) out.push("- None yet.");
  for (const o of n.objections) out.push(`- ${o.doubt} Answer: ${o.answer || "Not yet."} (${LABEL_WORDS[o.label]})`);
  out.push("", POSITIONING_HEADINGS.voice);
  if (!n.voice.traits.length && !n.voice.uses.length && !n.voice.never.length) out.push("- None yet.");
  for (const t of n.voice.traits) out.push(`- ${t.trait}: ${t.means}${t.notMeans ? ` Not: ${t.notMeans}` : ""}${t.line ? ` Example: "${t.line}"` : ""}`);
  if (n.voice.uses.length) out.push(`- Words we use: ${n.voice.uses.join(", ")}`);
  if (n.voice.never.length) out.push(`- Words we never use: ${n.voice.never.join(", ")}`);
  out.push("", POSITIONING_HEADINGS.learned);
  if (!n.learned.length) out.push("- None yet.");
  for (const l of n.learned) out.push(`- ${l.on ? `${positioningDay(l.on)}: ` : ""}${l.lesson}${l.evidence ? ` Evidence: ${l.evidence}` : ""}${l.appliesTo ? ` Applies to: ${l.appliesTo}` : ""} (${l.status})`);
  if (n.changes.length) {
    out.push("", POSITIONING_HEADINGS.changes);
    for (const c of n.changes.slice(0, 5)) out.push(`- v${c.version}${c.on ? `, ${positioningDay(c.on)}` : ""}: ${c.note}`);
  }
  let text = "";
  for (const line of out) {
    const next = text ? `${text}\n${line}` : line;
    if (next.length > max) break;
    text = next;
  }
  return text;
}

/** The sections whose content differs between two copies (for the `positioning.approved` event and the Changes line). */
export function positioningSectionsChanged(before: PositioningNotes | null, after: PositioningNotes): string[] {
  const keys = ["oneLine", "step", ...POSITIONING_LINE_SECTIONS.map((s) => s.key), "objections", "voice", "learned"] as const;
  return keys.filter((k) => JSON.stringify(before?.[k] ?? null) !== JSON.stringify(after[k]));
}

const ZLine = z.object({ text: z.string().max(400), label: z.enum(POSITIONING_LABELS), source: z.string().max(400).nullable().optional() });
const ZList = z.array(ZLine).max(POSITIONING_LIMITS.perSection);
/**
 * The notes as a client or an agent sends them: bounded here, then read with `readPositioning` (which trims and cuts).
 * The version, the date and the Changes list are never taken from the sender: approving sets them.
 */
export const PositioningNotesInput = z.object({
  oneLine: z.string().max(400),
  step: z.enum(POSITIONING_STEPS),
  forWhom: ZList,
  problem: ZList,
  today: ZList,
  different: ZList,
  proof: ZList,
  objections: z.array(z.object({ doubt: z.string().max(400), answer: z.string().max(400), label: z.enum(POSITIONING_LABELS) })).max(POSITIONING_LIMITS.objections).default([]),
  voice: z
    .object({
      traits: z.array(z.object({ trait: z.string().max(80), means: z.string().max(300), notMeans: z.string().max(300), line: z.string().max(400) })).max(POSITIONING_LIMITS.traits).default([]),
      uses: z.array(z.string().max(80)).max(POSITIONING_LIMITS.words).default([]),
      never: z.array(z.string().max(80)).max(POSITIONING_LIMITS.words).default([]),
    })
    .default({ traits: [], uses: [], never: [] }),
  learned: z
    .array(z.object({ on: z.string().max(10), lesson: z.string().max(400), evidence: z.string().max(400), appliesTo: z.string().max(300), status: z.enum(POSITIONING_LEARNED_STATUSES) }))
    .max(POSITIONING_LIMITS.learned)
    .default([]),
});
export type PositioningNotesInput = z.input<typeof PositioningNotesInput>;

/** Sent notes as stored notes: the sender's content with the stored version, date and Changes list kept. */
export function positioningFromInput(input: z.output<typeof PositioningNotesInput>, base: Pick<PositioningNotes, "version" | "updatedOn" | "changes"> | null, today: string): PositioningNotes {
  return readPositioning({ ...input, version: base?.version ?? 0, updatedOn: base?.updatedOn || today, changes: base?.changes ?? [] })!;
}
