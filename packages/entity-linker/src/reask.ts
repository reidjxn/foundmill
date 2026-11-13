/**
 * Re-ask protocol (BUILD §11.3 "validator rejects unknown/invisible ids and re-asks once").
 *
 * Pure functions. The composer calls the model, validates, and when the output is invalid appends the assistant's
 * output and `buildReask(...).message` to the conversation and calls once more. A second failure is final: the composer
 * then demotes the offending mentions to plain text with `stripInvalidMentions` so no unknown id reaches render.
 */
import { lookupByName } from "./manifest";
import { findMalformedMarkup, formatEntityMarkup, parseEntityMarkup, serializeSegments } from "./markup";
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
export function stripInvalidMentions(text: string, manifest: Manifest): string {
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
    const pipe = span.indexOf("|");
    if (pipe === -1) {
      // No display to recover: only the `[[ent:…` token goes (and its `]]` when it closes at once), not the words after it.
      const token = /^\[\[ent:[^\s|\]]*(?:\]\])?/.exec(span)![0];
      out = out.slice(0, bad.index) + out.slice(bad.index + token.length);
      continue;
    }
    const close = span.indexOf("]]");
    const display = span.slice(pipe + 1, close === -1 ? undefined : close).trim();
    out = out.slice(0, bad.index) + inertDisplay(display) + out.slice(bad.end);
  }
  return out.replace(/[ \t]{2,}/g, " ").replace(/ +([,.;:!?])/g, "$1");
}
