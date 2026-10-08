/**
 * Deterministic note generator for AC-11.3.1 ("100 consecutive generated notes have 100% valid entity links").
 *
 * Produces composer-style notes (fact → why it matters → ask, 60–180 words) whose mentions are drawn from a manifest.
 * `corrupt` options inject the failure modes the validator must catch: an unknown id, an invisible entity, malformed
 * markup. Everything is seeded so a failing case can be reproduced from its seed.
 */
import { formatEntityMarkup } from "../markup";
import type { Manifest, ManifestEntity } from "../types";

export interface Rng {
  next(): number;
  int(min: number, max: number): number;
  pick<T>(items: readonly T[]): T;
  sample<T>(items: readonly T[], n: number): T[];
  chance(p: number): boolean;
}

/** mulberry32 seeded from a string hash. */
export function createRng(seed: string | number): Rng {
  let h = 2166136261 >>> 0;
  for (const ch of String(seed)) {
    h ^= ch.charCodeAt(0);
    h = Math.imul(h, 16777619) >>> 0;
  }
  let state = h || 1;
  const next = (): number => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const rng: Rng = {
    next,
    int: (min, max) => min + Math.floor(next() * (max - min + 1)),
    pick: (items) => {
      if (items.length === 0) throw new Error("createRng.pick: empty list");
      return items[Math.floor(next() * items.length)] as (typeof items)[number];
    },
    sample: (items, n) => {
      const copy = [...items];
      for (let i = copy.length - 1; i > 0; i--) {
        const j = Math.floor(next() * (i + 1));
        const a = copy[i] as (typeof copy)[number];
        copy[i] = copy[j] as (typeof copy)[number];
        copy[j] = a;
      }
      return copy.slice(0, Math.min(n, copy.length));
    },
    chance: (p) => next() < p,
  };
  return rng;
}

export interface GeneratedNote {
  body_md: string;
  /** Ids the note mentions with markup, deduplicated. */
  mentionIds: string[];
  /** Proper nouns written as plain text (for sweep tests): manifest names, aliases and unknown names. */
  plainMentions: string[];
  wordCount: number;
}

export interface GenerateOptions {
  /** 2–5 by default. */
  mentions?: { min: number; max: number };
  /** Also write some manifest names as plain text (what the sweep later links). Default false. */
  plainNames?: boolean;
  /** Extra unknown proper nouns written as plain text (what the sweep later drafts). */
  unknownNames?: readonly string[];
  corrupt?: {
    /** Insert one mention with an id that is not in the manifest. */
    unknownId?: boolean;
    /** Insert one mention of an invisible manifest entity, if the manifest has one. */
    invisible?: boolean;
    /** Insert one malformed `[[ent:` sequence. */
    malformed?: boolean;
  };
}

const FACTS = [
  "{a} replied to the outreach sequence and asked for pricing on the annual plan.",
  "{a} confirmed the revised quote from {b} and wants samples by the end of the month.",
  "The onboarding flow for {a} completed its first paid conversion overnight.",
  "{a} moved the launch date forward after reviewing the roadmap with {b}.",
  "Three leads from {a} reached the demo stage this week; {b} is handling the follow-up.",
  "{a} flagged a billing dispute that touches the retainer agreed with {b}.",
  "The dunning sequence recovered the overdue invoice from {a} without manual work.",
  "{a} published a comparison that names the product; {b} drafted a response.",
];
const WHY = [
  "This matters because the pipeline for the quarter depends on the next two conversions landing before the renewal window closes, and the current cash position gives little room for a slip.",
  "It matters because the cost per customer on this channel has been drifting upward since the creative refresh, and a confirmed order resets the baseline we plan against.",
  "This is relevant now because the supplier timeline and the marketing calendar were planned together, and either one moving means re-sequencing the other.",
  "The timing matters: the renewal conversation is scheduled for the start of next month, and the support history will shape the terms we can ask for.",
  "It changes the plan because the forecast assumed a slower ramp on this segment, and the actual numbers suggest the team should shift effort toward it.",
];
const ASKS = [
  "Do you want me to prepare the proposal now, or wait until the second reference call is done?",
  "Should the lead agent take this over, or stay on the current campaign until the week closes?",
  "I recommend approving the sample order; the alternative is a two-week delay while we re-source.",
  "Say the word and I will draft the reply for your review before anything is sent.",
  "Pick an option below, or tell me how you would like to proceed.",
];
const FILLERS = [
  "Nothing else in the queue depends on this.",
  "The related tasks are already on the board and nothing has been sent yet.",
  "All numbers above come from the connected ledger and the channel reports.",
  "The team will keep working on the agreed plan in the meantime.",
  "No budget has been committed beyond what you already approved.",
  "I have kept the draft in your voice and under two short paragraphs.",
];

function words(text: string): number {
  return text.split(/\s+/).filter(Boolean).length;
}

/** Choose the display text for a mention: the name, an alias or a surname-style part of the name. */
function displayFor(e: ManifestEntity, rng: Rng): string {
  const parts = e.name.split(" ");
  const options = [e.name, e.name, ...e.aliases];
  if (parts.length >= 2 && e.kind === "person") options.push(parts[0] as string);
  return rng.pick(options);
}

export function generateNote(manifest: Manifest, rng: Rng, options: GenerateOptions = {}): GeneratedNote {
  const visible = manifest.entities.filter((e) => e.visible);
  if (visible.length === 0) throw new Error("generateNote: manifest has no visible entities");
  const range = options.mentions ?? { min: 2, max: 5 };
  const count = rng.int(range.min, range.max);
  const chosen = rng.sample(visible, Math.max(1, count));
  const a = chosen[0] as ManifestEntity;
  const b = chosen[1] ?? chosen[0] as ManifestEntity;
  const mention = (e: ManifestEntity): string => formatEntityMarkup(e.id, displayFor(e, rng));
  const plainMentions: string[] = [];
  const mentionIds = new Set<string>();
  const render = (template: string): string =>
    template.replace(/\{(a|b)\}/g, (_m, key: string) => {
      const e = key === "a" ? a : b;
      if (options.plainNames && rng.chance(0.5)) {
        const text = rng.chance(0.5) && e.aliases.length > 0 ? (e.aliases[0] as string) : e.name;
        plainMentions.push(text);
        return text;
      }
      mentionIds.add(e.id);
      return mention(e);
    });

  const sentences: string[] = [render(rng.pick(FACTS)), rng.pick(WHY)];
  for (const extra of chosen.slice(2)) {
    mentionIds.add(extra.id);
    sentences.push(`${mention(extra)} has been copied on the thread.`);
  }
  for (const unknown of options.unknownNames ?? []) {
    plainMentions.push(unknown);
    sentences.push(`${unknown} asked to be kept informed.`);
  }
  sentences.push(rng.pick(ASKS));
  let body = sentences.join(" ");
  const fillers = rng.sample(FILLERS, FILLERS.length);
  let fi = 0;
  while (words(body) < 60 && fi < fillers.length) body += ` ${fillers[fi++]}`;
  while (words(body) < 60) body += ` ${rng.pick(FILLERS)}`;
  body = trimToWords(body, 180);

  if (options.corrupt?.unknownId) body += ` ${formatEntityMarkup(fakeUuid(rng), "Unknown Partner")} was also mentioned.`;
  if (options.corrupt?.invisible) {
    const hidden = manifest.entities.find((e) => !e.visible);
    if (hidden) body += ` ${formatEntityMarkup(hidden.id, hidden.name)} is involved.`;
  }
  if (options.corrupt?.malformed) body += " [[ent:not-a-uuid|Broken Link]] was written badly.";

  const paragraphs = splitParagraphs(body);
  return { body_md: paragraphs.join("\n\n"), mentionIds: [...mentionIds], plainMentions, wordCount: words(body) };
}

function trimToWords(text: string, max: number): string {
  const parts = text.split(/\s+/).filter(Boolean);
  if (parts.length <= max) return text;
  // Never cut inside a mention.
  let out = parts.slice(0, max).join(" ");
  const open = out.lastIndexOf("[[");
  if (open !== -1 && out.indexOf("]]", open) === -1) out = out.slice(0, open).trimEnd();
  return out.replace(/[,;:]$/, "") + ".";
}

function splitParagraphs(body: string): string[] {
  const sentences = body.match(/[^.!?]+[.!?]+(\s|$)/g)?.map((s) => s.trim()) ?? [body];
  if (sentences.length < 4) return [body];
  const mid = Math.ceil(sentences.length / 2);
  return [sentences.slice(0, mid).join(" "), sentences.slice(mid).join(" ")];
}

/** A well-formed uuid that is not in any manifest. */
export function fakeUuid(rng: Rng): string {
  const hex = "0123456789abcdef";
  const pick = (n: number): string => Array.from({ length: n }, () => hex[rng.int(0, 15)]).join("");
  return `${pick(8)}-${pick(4)}-4${pick(3)}-a${pick(3)}-${pick(12)}`;
}

/** A deterministic uuid-shaped id for fixtures ("northwind:ent:1" → the same uuid every run). */
export function uuidFor(label: string): string {
  const rng = createRng(label);
  return fakeUuid(rng);
}
