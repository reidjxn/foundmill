/**
 * Re-ask protocol (BUILD §11.3 "validator rejects unknown/invisible ids and re-asks once").
 *
 * Pure functions. The composer calls the model, validates, and when the output is invalid appends the assistant's
 * output and `buildReask(...).message` to the conversation and calls once more. A second failure is final: the composer
 * then demotes the offending mentions to plain text with `stripInvalidMentions` so no unknown id reaches render.
 */
import { lookupByName } from "./manifest";
import { findMalformedMarkup, formatEntityMarkup, parseEntityMarkup, serializeSegments, validateMarkup } from "./markup";
import type { Manifest, ValidationResult } from "./types";

/** Only one re-ask per note. */
export const MAX_REASKS = 1;

export interface ReaskSuggestion {
  /** The display text the model used. */
  display: string;
  /** The id it wrote. */
  badId: string;
  /** The manifest id whose name or alias equals the display, when exactly one does. */
  suggestedId: string | null;
  reason: "unknown" | "invisible";
}

export interface Reask {
  /** The follow-up prompt, ready to send as the next user turn. */
  prompt: string;
  message: { role: "user"; content: string };
  /** Every offending id (unknown then invisible), deduplicated. */
  offendingIds: string[];
  suggestions: ReaskSuggestion[];
  malformed: string[];
}

export interface ReaskOptions {
  /** Which attempt this re-ask is for (0 = first re-ask). Only used in the prompt wording. */
  attempt?: number;
  /** When true (default) the manifest lines are repeated in the prompt so the model does not have to scroll back. */
  includeManifest?: boolean;
  /** The wrapper the output must keep ("the complete JSON object" by default; the commentary route uses other words). */
  outputNoun?: string;
}

/** Display text that cannot open Markdown's image or link syntax (`![…](…)`, `[…](…)`, `[…][…]`). */
const inertDisplay = (display: string): string => display.replace(/\[/g, "(").replace(/\]/g, ")");

/** True when the output is invalid and the composer has not yet used its single re-ask. */
export function shouldReask(validation: ValidationResult, reasksSoFar: number): boolean {
  return !validation.valid && reasksSoFar < MAX_REASKS;
}

export function buildReask(validation: ValidationResult, manifest: Manifest, options: ReaskOptions = {}): Reask {
  const includeManifest = options.includeManifest ?? true;
  const outputNoun = options.outputNoun ?? "the complete JSON object";
  const invisible = new Set(validation.invisibleIds);

  const suggestions: ReaskSuggestion[] = [];
  const seen = new Set<string>();
  for (const p of validation.problems) {
    const key = `${p.id}|${p.display}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const reason: ReaskSuggestion["reason"] = invisible.has(p.id) ? "invisible" : "unknown";
    const matches = reason === "unknown" ? lookupByName(manifest, p.display) : [];
    suggestions.push({ display: p.display, badId: p.id, suggestedId: matches.length === 1 ? (matches[0]?.id ?? null) : null, reason });
  }

  const lines: string[] = [];
  lines.push("Your note used entity markup that fails validation. Fix only the mentions listed below and return " + outputNoun + " again, unchanged otherwise.");

  const unknownLines = suggestions.filter((s) => s.reason === "unknown");
  if (unknownLines.length > 0) {
    lines.push("", "Ids that are not in the manifest (never use these ids):");
    for (const s of unknownLines) {
      const fix = s.suggestedId
        ? `use ${formatEntityMarkup(s.suggestedId, s.display)}`
        : `"${s.display}" has no manifest entry; write it as plain text without markup`;
      lines.push(`- ${formatEntityMarkup(s.badId, s.display)} → ${fix}`);
    }
  }

  const invisibleLines = suggestions.filter((s) => s.reason === "invisible");
  if (invisibleLines.length > 0) {
    lines.push("", "Entities the founder must not see from this note (remove the mention; do not name them in plain text either):");
    for (const s of invisibleLines) lines.push(`- ${formatEntityMarkup(s.badId, s.display)}`);
  }

  const malformed = validation.malformed.map((m) => m.raw);
  if (malformed.length > 0) {
    lines.push("", "Malformed markup (a mention is exactly [[ent:<uuid>|Name]] with a lowercase uuid from the manifest):");
    for (const raw of malformed) lines.push(`- ${raw}`);
  }

  if (includeManifest) {
    lines.push("", "Manifest (the only ids you may use):");
    lines.push(manifest.text.length > 0 ? manifest.text : "(empty — mention no entities)");
  }

  lines.push(
    "",
    "Rules: mention entities only as [[ent:<id>|Name]] with ids from this manifest; do not invent ids; keep every other field exactly as it was; return " + outputNoun + " only, no prose.",
  );

  const prompt = lines.join("\n");
  return {
    prompt,
    message: { role: "user", content: prompt },
    offendingIds: [...new Set([...validation.unknownIds, ...validation.invisibleIds])],
    suggestions,
    malformed,
  };
}

/**
 * Final fallback after the re-ask also failed: unknown-id mentions become their display text, invisible-entity mentions
 * are removed entirely (the founder must not see them), and malformed `[[ent:` openings are reduced to their display.
 * The result always validates against the manifest. A recovered display keeps no square brackets (they become
 * parentheses, as `formatEntityMarkup` does with `]`): it can be a name someone outside the business chose (a customer's
 * name at checkout), and it must stay text in the note, never an image or a link.
 */
/**
 * The final fallback: text that always validates. One pass can join the words around a removed token into a new
 * mention (`[[[[ent:x]]ent:<id>|Name]]` loses `[[ent:x]]` and leaves `[[ent:<id>|Name]]`), so passes repeat until the
 * text validates or stops changing; every pass that changes the text makes it shorter, so this ends. Anything still
 * invalid after that loses every remaining `[[ent:` opening.
 */
export function stripInvalidMentions(text: string, manifest: Manifest): string {
  let out = text;
  for (let pass = 0; pass < STRIP_PASSES; pass++) {
    const next = stripOnce(out, manifest);
    if (validateMarkup(next, manifest).valid) return next;
    if (next === out) break;
    out = next;
  }
  return stripOnce(out.split("[[ent:").join(""), manifest);
}

/** At most this many passes; real text needs one, a nested splice two or three. */
const STRIP_PASSES = 8;

function stripOnce(text: string, manifest: Manifest): string {
  const segments = parseEntityMarkup(text).map((seg) => {
    if (seg.kind !== "entity") return seg;
    const entity = manifest.get(seg.id);
    if (!entity) return { kind: "text" as const, text: inertDisplay(seg.display) };
    if (!entity.visible) return { kind: "text" as const, text: "" };
    return seg;
  });
  let out = serializeSegments(segments);
  // Malformed openings: keep whatever display text is recoverable. Valid markup is untouched. Each span is read from the
  // text as it was before any replacement (its whole length, not the 120 characters of `raw`), and spans never overlap
  // (one ends where the next opening starts), so replacing from the last to the first keeps every earlier index right.
  const before = out;
  for (const bad of findMalformedMarkup(before).sort((a, b) => b.index - a.index)) {
    const span = before.slice(bad.index, bad.end);
    const id = /^\[\[ent:[^\s|\]]*/.exec(span)![0];
    if (span[id.length] !== "|") {
      // No display to recover (a `|` further on is the note's own: a table, "A | B"): only the `[[ent:…` token goes, with
      // its `]]` when it closes at once, never the words after it.
      const token = span.startsWith("]]", id.length) ? id.length + 2 : id.length;
      out = out.slice(0, bad.index) + out.slice(bad.index + token);
      continue;
    }
    // The display runs to the `]]`; with none, to the end of its line, and the lines after it stay as they are.
    const close = span.indexOf("]]");
    const lineEnd = span.indexOf("\n");
    const stop = close !== -1 ? close : lineEnd !== -1 ? lineEnd : span.length;
    // trimStart only: a space before the next mention or word stays (`x [[ent:abc| [[ent:<id>|Ana]]` keeps `x [[…`).
    const display = span.slice(id.length + 1, stop).trimStart();
    const rest = close !== -1 ? bad.end : bad.index + stop;
    out = out.slice(0, bad.index) + inertDisplay(display) + out.slice(rest);
  }
  return out.replace(/[ \t]{2,}/g, " ").replace(/ +([,.;:!?])/g, "$1");
}
