/**
 * `[[ent:<uuid>|Display]]` markup: parse, validate, strip (BUILD §2.1 rule 3, §11.3).
 *
 * The regex is the shared `ENTITY_MARKUP_RE` so every package agrees on what a mention looks like. It is a global
 * regex, so each call here works on a fresh copy and never leaks `lastIndex` state between callers.
 */
import { ENTITY_MARKUP_RE } from "@foundmill/shared";
import { normalizeName } from "./manifest";
import type {
  DisplayMismatch,
  EntitySegment,
  MalformedMarkup,
  Manifest,
  ManifestEntity,
  MentionProblem,
  Segment,
  SweepSegment,
  ValidationResult,
} from "./types";

const MARKUP_OPEN = "[[ent:";

function markupRe(): RegExp {
  return new RegExp(ENTITY_MARKUP_RE.source, ENTITY_MARKUP_RE.flags.includes("g") ? ENTITY_MARKUP_RE.flags : `${ENTITY_MARKUP_RE.flags}g`);
}

/** Write one mention. The display must not contain `]` (it would end the markup early), so it is replaced with `)`. */
export function formatEntityMarkup(id: string, display: string): string {
  const safe = display.replace(/\]/g, ")").replace(/\|/g, "/").trim() || id;
  return `[[ent:${id}|${safe}]]`;
}

/**
 * Split `text` into text and entity segments. Adjacent text is merged, empty text segments are dropped, and the
 * output round-trips through `serializeSegments` to the exact input.
 */
export function parseEntityMarkup(text: string): Segment[] {
  const segments: Segment[] = [];
  const re = markupRe();
  let cursor = 0;
  for (const m of text.matchAll(re)) {
    const start = m.index ?? 0;
    if (start > cursor) segments.push({ kind: "text", text: text.slice(cursor, start) });
    segments.push({ kind: "entity", id: m[1] as string, display: m[2] as string, source: "markup", confidence: 1 });
    cursor = start + m[0].length;
  }
  if (cursor < text.length) segments.push({ kind: "text", text: text.slice(cursor) });
  return segments;
}

/** Inverse of `parseEntityMarkup`. Ambiguous and draft segments serialise as their plain text. */
export function serializeSegments(segments: readonly SweepSegment[]): string {
  let out = "";
  for (const s of segments) {
    switch (s.kind) {
      case "text":
        out += s.text;
        break;
      case "entity":
        out += formatEntityMarkup(s.id, s.display);
        break;
      case "ambiguous":
        out += s.text;
        break;
      case "draft":
        out += s.name;
        break;
    }
  }
  return out;
}

/** `[[ent:` openings that the regex did not consume: a malformed mention must never reach render as a link or as text. */
export function findMalformedMarkup(text: string): MalformedMarkup[] {
  const valid = new Set<number>();
  for (const m of text.matchAll(markupRe())) valid.add(m.index ?? 0);
  const out: MalformedMarkup[] = [];
  let from = 0;
  for (;;) {
    const idx = text.indexOf(MARKUP_OPEN, from);
    if (idx === -1) break;
    if (!valid.has(idx)) {
      const close = text.indexOf("]]", idx);
      const nextOpen = text.indexOf(MARKUP_OPEN, idx + MARKUP_OPEN.length);
      let end = close === -1 ? text.length : close + 2;
      if (nextOpen !== -1 && nextOpen < end) end = nextOpen;
      out.push({ raw: text.slice(idx, Math.min(end, idx + 120)), index: idx });
    }
    from = idx + MARKUP_OPEN.length;
  }
  return out;
}

/** Every mention id in document order, deduplicated. Does not validate. */
export function extractEntityIds(text: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const seg of parseEntityMarkup(text)) {
    if (seg.kind === "entity" && !seen.has(seg.id)) {
      seen.add(seg.id);
      out.push(seg.id);
    }
  }
  return out;
}

/**
 * Validate agent-written text against the manifest (BUILD §11.3 "validator rejects unknown/invisible ids").
 * Invalid when any mention points at an id that is not in the manifest, at an invisible entity, or when a `[[ent:`
 * opening does not parse. Display mismatches are advisory and never make the text invalid.
 */
export function validateMarkup(text: string, manifest: Manifest): ValidationResult {
  const segments = parseEntityMarkup(text);
  const unknown = new Set<string>();
  const invisible = new Set<string>();
  const problems: MentionProblem[] = [];
  const displayMismatches: DisplayMismatch[] = [];
  const entityIds: string[] = [];
  const seenIds = new Set<string>();
  let mentionCount = 0;

  for (const seg of segments) {
    if (seg.kind !== "entity") continue;
    mentionCount++;
    const entity = manifest.get(seg.id);
    if (!entity) {
      unknown.add(seg.id);
      problems.push({ id: seg.id, display: seg.display });
      continue;
    }
    if (!entity.visible) {
      invisible.add(seg.id);
      problems.push({ id: seg.id, display: seg.display });
      continue;
    }
    if (!seenIds.has(seg.id)) {
      seenIds.add(seg.id);
      entityIds.push(seg.id);
    }
    if (!displayMatches(seg, entity)) displayMismatches.push({ id: seg.id, display: seg.display, name: entity.name });
  }

  const malformed = findMalformedMarkup(text);
  return {
    valid: unknown.size === 0 && invisible.size === 0 && malformed.length === 0,
    unknownIds: [...unknown],
    invisibleIds: [...invisible],
    problems,
    malformed,
    displayMismatches,
    entityIds,
    mentionCount,
  };
}

/** The display is the name, an alias, a leading part of the name, or made only of the name's words ("Sara", "Lindqvist"). */
export function displayMatches(seg: Pick<EntitySegment, "display">, entity: ManifestEntity): boolean {
  const display = normalizeName(seg.display.replace(/(?:'|\u2019)s$/u, ""));
  if (!display) return false;
  if (entity.keys.includes(display)) return true;
  const nameKey = normalizeName(entity.name);
  if (nameKey.startsWith(display)) return true;
  const nameWords = new Set(nameKey.split(" "));
  for (const alias of entity.aliases) for (const w of normalizeName(alias).split(" ")) nameWords.add(w);
  const displayWords = display.split(" ");
  return displayWords.every((w) => nameWords.has(w));
}

/** Replace every mention with its display text. Unknown ids are not special-cased: the display is all that remains. */
export function stripMarkup(text: string): string {
  return text.replace(markupRe(), (_m, _id: string, display: string) => display);
}

/**
 * Plain text for previews, search indexing and notifications: mentions become their display, ambiguous spans and
 * drafts their text, and any malformed `[[ent:` leftovers are reduced to their display part or dropped. Works on a
 * raw string or on segments from `parseEntityMarkup`/`sweep`.
 */
export function renderPlain(input: string | readonly SweepSegment[]): string {
  if (typeof input !== "string") return serializeToPlain(input);
  let out = stripMarkup(input);
  for (const bad of findMalformedMarkup(out).sort((a, b) => b.index - a.index)) {
    const pipe = bad.raw.indexOf("|");
    const close = bad.raw.indexOf("]]");
    const display = pipe !== -1 ? bad.raw.slice(pipe + 1, close === -1 ? undefined : close).trim() : "";
    out = out.slice(0, bad.index) + display + out.slice(bad.index + bad.raw.length);
  }
  return out;
}

function serializeToPlain(segments: readonly SweepSegment[]): string {
  let out = "";
  for (const s of segments) {
    if (s.kind === "text" || s.kind === "ambiguous") out += s.text;
    else if (s.kind === "entity") out += s.display;
    else out += s.name;
  }
  return out;
}
