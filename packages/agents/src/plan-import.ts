/**
 * Import a plan (founder-only, Product › Vision): a founder who already has a written plan uploads one Markdown file
 * and Foundmill writes it into the business. This module is the pure half: `parsePlanFile` reads the file into a
 * `ParsedPlan` (validated by its Zod schema) or a list of errors that name the line, and `markdownToPlanDoc` converts a
 * specification section's Markdown body into the Tiptap document spec blocks are stored in. apps/api
 * (services/plan-import.ts) matches the parsed plan to the business and writes it.
 *
 * The file format:
 *
 * ```
 * # Vision            (optional)
 * ## Statement / ## For whom / ## Problem / ## Why now      one paragraph each
 * ## Principles       - **Title**: detail
 * ## North star       - Metric: … / - Definition: … / - Target: …
 * # Specification     (optional)
 * ## <Section name>   Markdown: ### and #### headings, paragraphs, "- " and "1. " lists, **bold**, *italic*, `code`
 * # Roadmap           (optional)
 * ## Now / ## Next / ## Later
 * ### <Item title>    paragraphs (kept as Markdown), then "Acceptance:" and "- " criteria
 * ```
 *
 * The three parts appear in that order and at least one is present. The text is the founder's own (it is written as
 * their edit), so it is kept as written; only the Markdown subset above is read, and nothing in it becomes a link.
 */
import { z } from "zod";
import { LIMITS } from "@foundmill/config";
import { ROADMAP_HORIZONS, type RoadmapHorizon } from "@foundmill/shared";
import { FIGURE_LABELS, type FigureLabel } from "@foundmill/models/schemas";
import { MAX_ROADMAP_ITEMS, normKey } from "./foundations";

// ---------------------------------------------------------------------------------------------------------------------
// Limits and schema
// ---------------------------------------------------------------------------------------------------------------------

export const PLAN_IMPORT_LIMITS = {
  /** The whole file, UTF-8 bytes. */
  fileBytes: LIMITS.planFileMaxBytes,
  /** One specification section's body, UTF-8 bytes. */
  sectionBytes: LIMITS.planSectionMaxBytes,
  sections: 30,
  /** A spec block's section name (`CreateSpecBlockInput.section`). */
  sectionName: 80,
  roadmapItems: MAX_ROADMAP_ITEMS,
  itemTitle: 200,
  acceptanceCriteria: 12,
  /** Vision fields. */
  visionField: 2000,
  principles: 10,
  principleTitle: 120,
  principleDetail: 1000,
  northStarField: 500,
  /** Errors reported for one file (the rest are dropped, so a wrong file does not flood the dialog). */
  errors: 20,
} as const;

export const PLAN_TEXT_MARKS = ["bold", "italic", "code"] as const;
export type PlanTextMark = (typeof PLAN_TEXT_MARKS)[number];

/**
 * The Tiptap subset an imported section is written in: the foundations subset (packages/models `TiptapDoc`) plus the
 * `code` mark (inline code; the editor's StarterKit and the Vision tab's PlainDoc both read it) and an ordered list's
 * `start` when it is not 1.
 */
export const PlanText = z.object({ type: z.literal("text"), text: z.string().min(1), marks: z.array(z.object({ type: z.enum(PLAN_TEXT_MARKS) })).min(1).optional() });
export const PlanParagraph = z.object({ type: z.literal("paragraph"), content: z.array(PlanText).min(1) });
export const PlanHeading = z.object({ type: z.literal("heading"), attrs: z.object({ level: z.number().int().min(2).max(4) }), content: z.array(PlanText).min(1) });
export const PlanListItem = z.object({ type: z.literal("listItem"), content: z.array(PlanParagraph).min(1) });
export const PlanBulletList = z.object({ type: z.literal("bulletList"), content: z.array(PlanListItem).min(1) });
export const PlanOrderedList = z.object({ type: z.literal("orderedList"), attrs: z.object({ start: z.number().int().min(0) }).optional(), content: z.array(PlanListItem).min(1) });
export const PlanBlock = z.discriminatedUnion("type", [PlanHeading, PlanParagraph, PlanBulletList, PlanOrderedList]);
export const PlanDoc = z.object({ type: z.literal("doc"), content: z.array(PlanBlock).min(1) });
export type PlanText = z.infer<typeof PlanText>;
export type PlanParagraph = z.infer<typeof PlanParagraph>;
export type PlanListItem = z.infer<typeof PlanListItem>;
export type PlanBlock = z.infer<typeof PlanBlock>;
export type PlanDoc = z.infer<typeof PlanDoc>;

const L = PLAN_IMPORT_LIMITS;

/** The vision as stored on the foundations row (packages/agents `FoundationsVisionRecord`). */
export const PlanVision = z.object({
  statement: z.string().min(1).max(L.visionField),
  forWhom: z.string().min(1).max(L.visionField),
  problem: z.string().min(1).max(L.visionField),
  whyNow: z.string().min(1).max(L.visionField),
  principles: z.array(z.object({ title: z.string().min(1).max(L.principleTitle), detail: z.string().min(1).max(L.principleDetail) })).min(1).max(L.principles),
  northStar: z.object({ metric: z.string().min(1).max(L.northStarField), definition: z.string().min(1).max(L.northStarField), target: z.string().min(1).max(L.northStarField), label: z.enum(FIGURE_LABELS) }),
});
export type PlanVision = z.infer<typeof PlanVision>;

export const PlanSection = z.object({
  /** As written in the file (matched to the business's sections with `normKey`). */
  name: z.string().min(1).max(L.sectionName),
  /** The line of its `## ` heading. */
  line: z.number().int().positive(),
  /** Opens with a level-2 heading carrying `name`. */
  content: PlanDoc,
});
export type PlanSection = z.infer<typeof PlanSection>;

export const PlanRoadmapItem = z.object({
  title: z.string().min(1).max(L.itemTitle),
  line: z.number().int().positive(),
  horizon: z.enum(ROADMAP_HORIZONS),
  /** The item's paragraphs as written (Markdown), without the acceptance criteria. */
  descriptionMd: z.string(),
  acceptance: z.array(z.string().min(1)).max(L.acceptanceCriteria),
});
export type PlanRoadmapItem = z.infer<typeof PlanRoadmapItem>;

export const ParsedPlan = z
  .object({
    vision: PlanVision.nullable(),
    sections: z.array(PlanSection).max(L.sections),
    roadmap: z.array(PlanRoadmapItem).max(L.roadmapItems),
    /** Which parts the file has (a part may be present with nothing in it only when the file says so, which is an error). */
    parts: z.object({ vision: z.boolean(), specification: z.boolean(), roadmap: z.boolean() }),
  })
  .refine((p) => p.parts.vision || p.parts.specification || p.parts.roadmap, "A plan has at least one part");
export type ParsedPlan = z.infer<typeof ParsedPlan>;

/** One problem in the file; `line` is 1-based, null when it is about the file as a whole. */
export interface PlanImportError {
  line: number | null;
  message: string;
}

export type ParsePlanResult = { ok: true; plan: ParsedPlan } | { ok: false; errors: PlanImportError[] };

/** The roadmap item's description as stored: its paragraphs, then the acceptance criteria as an "Acceptance:" list. */
export function roadmapItemDescription(item: Pick<PlanRoadmapItem, "descriptionMd" | "acceptance">): string {
  const parts = [item.descriptionMd.trim()].filter(Boolean);
  if (item.acceptance.length) parts.push(["Acceptance:", ...item.acceptance.map((c) => `- ${c}`)].join("\n"));
  return parts.join("\n\n");
}

/** "Estimate" unless the target already says it is a forecast or an estimate (CLAUDE.md: label every non-real number). */
export function northStarLabel(target: string): FigureLabel {
  const m = /\b(forecast(?:s|ed)?|estimate[sd]?)\b/i.exec(target);
  return m && /^forecast/i.test(m[1]!) ? "Forecast" : "Estimate";
}

export function utf8Bytes(text: string): number {
  return new TextEncoder().encode(text).length;
}

// ---------------------------------------------------------------------------------------------------------------------
// Inline Markdown: **bold**, *italic*, `code`
// ---------------------------------------------------------------------------------------------------------------------

interface Char {
  ch: string;
  code: boolean;
  /** A literal character (escaped, or inside code): never a delimiter. */
  literal: boolean;
  bold: boolean;
  italic: boolean;
  removed: boolean;
}

/**
 * Inline Markdown to Tiptap text nodes. Code spans (`` `x` ``) come first and are read literally; then `*` runs pair up
 * as in CommonMark (an opener is followed by a non-space, a closer follows one; `**` is bold, `*` italic, `***` both).
 * A backslash makes the next `*`, `` ` `` or `\` literal. Unpaired markers stay as text. Code text carries only the
 * code mark (the editor's code mark excludes the others). Whitespace runs collapse to one space.
 */
export function inlineMarkdown(input: string): PlanText[] {
  const text = input.replace(/\s+/g, " ").trim();
  const chars: Char[] = [];
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    if (ch === "\\" && i + 1 < text.length && "*`\\_".includes(text[i + 1]!)) {
      chars.push({ ch: text[i + 1]!, code: false, literal: true, bold: false, italic: false, removed: false });
      i++;
      continue;
    }
    if (ch === "`") {
      const close = text.indexOf("`", i + 1);
      if (close > i + 1) {
        for (const c of text.slice(i + 1, close)) chars.push({ ch: c, code: true, literal: true, bold: false, italic: false, removed: false });
        i = close;
        continue;
      }
    }
    chars.push({ ch, code: false, literal: false, bold: false, italic: false, removed: false });
  }

  // Delimiter runs of `*`.
  interface Run {
    start: number;
    length: number;
    /** Unused delimiters left at the run's inner edges: an opener spends from its right end, a closer from its left. */
    left: number;
    canOpen: boolean;
    canClose: boolean;
    closerUsed: number;
  }
  const runs: Run[] = [];
  for (let i = 0; i < chars.length; ) {
    if (chars[i]!.ch !== "*" || chars[i]!.literal) {
      i++;
      continue;
    }
    let j = i;
    while (j < chars.length && chars[j]!.ch === "*" && !chars[j]!.literal) j++;
    const before = i > 0 ? chars[i - 1]!.ch : " ";
    const after = j < chars.length ? chars[j]!.ch : " ";
    runs.push({ start: i, length: j - i, left: j - i, canOpen: !/\s/.test(after), canClose: !/\s/.test(before), closerUsed: 0 });
    i = j;
  }
  const openers: Run[] = [];
  for (const run of runs) {
    if (run.canClose) {
      while (run.left > 0) {
        let k = openers.length - 1;
        while (k >= 0 && openers[k]!.left === 0) k--;
        if (k < 0) break;
        const opener = openers[k]!;
        const use = opener.left >= 2 && run.left >= 2 ? 2 : 1;
        const from = opener.start + opener.left; // first content character
        const to = run.start + run.closerUsed; // one past the last content character
        for (let c = from; c < to; c++) {
          if (use === 2) chars[c]!.bold = true;
          else chars[c]!.italic = true;
        }
        for (let c = opener.start + opener.left - use; c < opener.start + opener.left; c++) chars[c]!.removed = true;
        for (let c = run.start + run.closerUsed; c < run.start + run.closerUsed + use; c++) chars[c]!.removed = true;
        opener.left -= use;
        run.left -= use;
        run.closerUsed += use;
        // Openers between the matched one and this closer can no longer pair across it.
        openers.length = k + 1;
        if (opener.left === 0) openers.pop();
      }
    }
    if (run.left > 0 && run.canOpen) openers.push(run);
  }

  // Consecutive characters with the same marks make one text node.
  const nodes: PlanText[] = [];
  const keys: string[] = [];
  const keyOf = (c: Char) => (c.code ? "code" : `${c.bold ? "b" : ""}${c.italic ? "i" : ""}`);
  for (const c of chars) {
    if (c.removed) continue;
    const key = keyOf(c);
    const last = nodes[nodes.length - 1];
    if (last && keys[keys.length - 1] === key) {
      last.text += c.ch;
      continue;
    }
    const marks: { type: PlanTextMark }[] = c.code ? [{ type: "code" }] : [...(c.bold ? [{ type: "bold" as const }] : []), ...(c.italic ? [{ type: "italic" as const }] : [])];
    nodes.push({ type: "text", text: c.ch, ...(marks.length ? { marks } : {}) });
    keys.push(key);
  }
  return nodes;
}

/** The plain text of inline Markdown (vision fields, principles): the markers go, the words stay. */
export function inlinePlain(input: string): string {
  return inlineMarkdown(input)
    .map((n) => n.text)
    .join("")
    .trim();
}

// ---------------------------------------------------------------------------------------------------------------------
// Block Markdown → Tiptap (a section body)
// ---------------------------------------------------------------------------------------------------------------------

export interface NumberedLine {
  /** 1-based line number in the file. */
  n: number;
  text: string;
}

const HEADING_RE = /^ {0,3}(#{1,6})[ \t]+(.*?)(?:[ \t]+#+)?[ \t]*$/;
const BULLET_RE = /^([ \t]*)[-*+][ \t]+(.*)$/;
const ORDERED_RE = /^([ \t]*)(\d{1,9})[.)][ \t]+(.*)$/;
const FENCE_RE = /^ {0,3}(```|~~~)/;
const RULE_RE = /^ {0,3}([-*_])(?:[ \t]*\1){2,}[ \t]*$/;
const blank = (s: string) => s.trim() === "";

function paragraphOf(text: string): PlanParagraph | null {
  const content = inlineMarkdown(text);
  return content.length ? { type: "paragraph", content } : null;
}

/**
 * A section body's Markdown to Tiptap blocks: `###` / `####` headings (levels 3 and 4), paragraphs (lines joined with
 * a space), `- ` bullet lists and `1. ` numbered lists (an indented line continues the item above it; nested markers
 * join the same list, since spec blocks keep lists one level deep), horizontal rules dropped. Code fences and `#####`
 * headings are errors, reported against their line.
 */
export function markdownToPlanBlocks(lines: readonly NumberedLine[], errors: PlanImportError[]): PlanBlock[] {
  const blocks: PlanBlock[] = [];
  let i = 0;
  const kindOf = (s: string): "bullet" | "ordered" | null => (RULE_RE.test(s) ? null : BULLET_RE.test(s) ? "bullet" : ORDERED_RE.test(s) ? "ordered" : null);
  while (i < lines.length) {
    const { n, text } = lines[i]!;
    if (blank(text) || RULE_RE.test(text)) {
      i++;
      continue;
    }
    if (FENCE_RE.test(text)) {
      errors.push({ line: n, message: "Code blocks are not supported in a plan file. Use `inline code` or a list instead." });
      // Skip to the closing fence so the code inside is not read as headings or lists.
      i++;
      while (i < lines.length && !FENCE_RE.test(lines[i]!.text)) i++;
      i++;
      continue;
    }
    const heading = HEADING_RE.exec(text);
    if (heading) {
      const level = heading[1]!.length;
      const content = inlineMarkdown(heading[2]!);
      if (level < 3 || level > 4) errors.push({ line: n, message: `Use ### or #### for headings inside a section (this one has ${level} #).` });
      else if (!content.length) errors.push({ line: n, message: "This heading has no text." });
      else blocks.push({ type: "heading", attrs: { level }, content });
      i++;
      continue;
    }
    const kind = kindOf(text);
    if (kind) {
      const items: string[] = [];
      let start = 1;
      while (i < lines.length) {
        const line = lines[i]!.text;
        if (blank(line)) {
          // A blank line between two items of the same kind keeps one list (a "loose" list).
          let j = i;
          while (j < lines.length && blank(lines[j]!.text)) j++;
          if (j < lines.length && kindOf(lines[j]!.text) === kind) {
            i = j;
            continue;
          }
          break;
        }
        const k = kindOf(line);
        if (k === kind) {
          const m = kind === "bullet" ? BULLET_RE.exec(line)! : ORDERED_RE.exec(line)!;
          if (kind === "ordered" && items.length === 0) start = Number(m[2]);
          items.push(kind === "bullet" ? m[2]! : m[3]!);
          i++;
          continue;
        }
        if (k !== null || HEADING_RE.test(line) || FENCE_RE.test(line) || RULE_RE.test(line)) break;
        // An indented line continues the item above it; an unindented one ends the list (as a lazy continuation would
        // be read by most renderers, it is joined to the item too, so no words are lost).
        if (items.length) items[items.length - 1] += ` ${line.trim()}`;
        i++;
      }
      const content: PlanListItem[] = items.map(paragraphOf).filter((p): p is PlanParagraph => p !== null).map((p) => ({ type: "listItem", content: [p] }));
      if (content.length) blocks.push(kind === "bullet" ? { type: "bulletList", content } : { type: "orderedList", ...(start !== 1 ? { attrs: { start } } : {}), content });
      continue;
    }
    const para: string[] = [];
    while (i < lines.length) {
      const line = lines[i]!.text;
      if (blank(line) || HEADING_RE.test(line) || FENCE_RE.test(line) || RULE_RE.test(line) || kindOf(line)) break;
      para.push(line.trim());
      i++;
    }
    const p = paragraphOf(para.join(" "));
    if (p) blocks.push(p);
  }
  return blocks;
}

/** A section's document: a level-2 heading carrying the section name (its title in the outline), then the body. */
export function markdownToPlanDoc(section: string, lines: readonly NumberedLine[], errors: PlanImportError[]): PlanDoc {
  const body = markdownToPlanBlocks(lines, errors);
  return { type: "doc", content: [{ type: "heading", attrs: { level: 2 }, content: [{ type: "text", text: section }] }, ...body] };
}

// ---------------------------------------------------------------------------------------------------------------------
// The file
// ---------------------------------------------------------------------------------------------------------------------

const PARTS = ["vision", "specification", "roadmap"] as const;
type Part = (typeof PARTS)[number];
const PART_TITLES: Record<Part, string> = { vision: "Vision", specification: "Specification", roadmap: "Roadmap" };

const VISION_FIELDS = { statement: "Statement", "for whom": "For whom", problem: "Problem", "why now": "Why now", principles: "Principles", "north star": "North star" } as const;
type VisionKey = keyof typeof VISION_FIELDS;

interface Heading {
  level: number;
  title: string;
  line: number;
  index: number;
}

/** Split `lines` at headings of exactly `level`; what comes before the first one is `lead`. */
function splitAt(lines: readonly NumberedLine[], level: number): { lead: NumberedLine[]; parts: { heading: Heading; body: NumberedLine[] }[] } {
  const lead: NumberedLine[] = [];
  const parts: { heading: Heading; body: NumberedLine[] }[] = [];
  let inFence = false;
  lines.forEach((l, index) => {
    if (FENCE_RE.test(l.text)) inFence = !inFence;
    const m = inFence ? null : HEADING_RE.exec(l.text);
    if (m && m[1]!.length === level) {
      parts.push({ heading: { level, title: m[2]!.trim(), line: l.n, index }, body: [] });
      return;
    }
    if (parts.length) parts[parts.length - 1]!.body.push(l);
    else lead.push(l);
  });
  return { lead, parts };
}

const firstText = (lines: readonly NumberedLine[]) => lines.find((l) => !blank(l.text));

/** Parse a plan file. Pure: the same text always gives the same result. */
export function parsePlanFile(fileText: string): ParsePlanResult {
  const errors: PlanImportError[] = [];
  const fail = (): ParsePlanResult => ({ ok: false, errors: errors.slice(0, L.errors) });
  if (utf8Bytes(fileText) > L.fileBytes) {
    errors.push({ line: null, message: `The file is larger than ${L.fileBytes / 1024} KB. Split the plan, or shorten the specification.` });
    return fail();
  }
  const text = fileText.replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n");
  if (!text.trim()) {
    errors.push({ line: null, message: "The file is empty." });
    return fail();
  }
  const lines: NumberedLine[] = text.split("\n").map((t, i) => ({ n: i + 1, text: t }));
  const top = splitAt(lines, 1);
  const stray = firstText(top.lead);
  if (stray) errors.push({ line: stray.n, message: "A plan file starts with # Vision, # Specification or # Roadmap. Move this text under one of them." });

  const seen: Partial<Record<Part, { line: number; body: NumberedLine[] }>> = {};
  let lastOrder = -1;
  for (const { heading, body } of top.parts) {
    const key = PARTS.find((p) => normKey(heading.title) === p);
    if (!key) {
      errors.push({ line: heading.line, message: `"# ${heading.title}" is not a part of a plan file. Use # Vision, # Specification or # Roadmap.` });
      continue;
    }
    if (seen[key]) {
      errors.push({ line: heading.line, message: `# ${PART_TITLES[key]} appears twice (first on line ${seen[key]!.line}).` });
      continue;
    }
    const order = PARTS.indexOf(key);
    if (order < lastOrder) errors.push({ line: heading.line, message: "The parts must come in this order: # Vision, # Specification, # Roadmap." });
    lastOrder = Math.max(lastOrder, order);
    seen[key] = { line: heading.line, body };
  }
  if (!seen.vision && !seen.specification && !seen.roadmap) {
    if (!errors.length) errors.push({ line: null, message: "The file has none of # Vision, # Specification or # Roadmap." });
    return fail();
  }

  const vision = seen.vision ? parseVision(seen.vision.line, seen.vision.body, errors) : null;
  const sections = seen.specification ? parseSpecification(seen.specification.line, seen.specification.body, errors) : [];
  const roadmap = seen.roadmap ? parseRoadmap(seen.roadmap.line, seen.roadmap.body, errors) : [];
  if (errors.length) return fail();

  const parsed = ParsedPlan.safeParse({ vision, sections, roadmap, parts: { vision: Boolean(seen.vision), specification: Boolean(seen.specification), roadmap: Boolean(seen.roadmap) } });
  if (!parsed.success) {
    // Every limit is checked above with its line; this is a safety net.
    errors.push({ line: null, message: `The plan could not be read: ${parsed.error.issues[0]?.message ?? "unknown problem"}.` });
    return fail();
  }
  return { ok: true, plan: parsed.data };
}

function tooLong(errors: PlanImportError[], line: number, what: string, value: string, max: number): boolean {
  if (value.length <= max) return false;
  errors.push({ line, message: `${what} is ${value.length} characters long; keep it to ${max}.` });
  return true;
}

function parseVision(partLine: number, body: NumberedLine[], errors: PlanImportError[]): PlanVision | null {
  const { lead, parts } = splitAt(body, 2);
  const stray = firstText(lead);
  if (stray) errors.push({ line: stray.n, message: "Put this text under one of ## Statement, ## For whom, ## Problem, ## Why now, ## Principles or ## North star." });
  const found = new Map<VisionKey, { line: number; body: NumberedLine[] }>();
  for (const { heading, body: lines } of parts) {
    const key = (Object.keys(VISION_FIELDS) as VisionKey[]).find((k) => normKey(heading.title) === k);
    if (!key) {
      errors.push({ line: heading.line, message: `"## ${heading.title}" is not part of the vision. Use ## Statement, ## For whom, ## Problem, ## Why now, ## Principles and ## North star.` });
      continue;
    }
    if (found.has(key)) {
      errors.push({ line: heading.line, message: `## ${VISION_FIELDS[key]} appears twice in the vision.` });
      continue;
    }
    found.set(key, { line: heading.line, body: lines });
  }
  const missing = (Object.keys(VISION_FIELDS) as VisionKey[]).filter((k) => !found.has(k));
  if (missing.length) {
    errors.push({ line: partLine, message: `The vision is missing ${missing.map((k) => `## ${VISION_FIELDS[k]}`).join(", ")}.` });
    return null;
  }
  const paragraph = (key: VisionKey): string => {
    const f = found.get(key)!;
    const value = inlinePlain(f.body.map((l) => l.text).join(" "));
    if (!value) errors.push({ line: f.line, message: `## ${VISION_FIELDS[key]} has no text.` });
    else tooLong(errors, f.line, `## ${VISION_FIELDS[key]}`, value, L.visionField);
    return value;
  };
  const statement = paragraph("statement");
  const forWhom = paragraph("for whom");
  const problem = paragraph("problem");
  const whyNow = paragraph("why now");

  // Principles: "- **Title**: detail" (or "- **Title:** detail"); an indented line continues the detail above it.
  const principlesAt = found.get("principles")!;
  const principles: { title: string; detail: string; line: number }[] = [];
  const errorsBefore = errors.length;
  for (const l of principlesAt.body) {
    if (blank(l.text)) continue;
    const bullet = BULLET_RE.exec(l.text);
    if (!bullet) {
      if (principles.length && /^[ \t]+/.test(l.text)) principles[principles.length - 1]!.detail += ` ${l.text.trim()}`;
      else errors.push({ line: l.n, message: "Write each principle as - **Title**: what it means." });
      continue;
    }
    const m = /^\*\*(.+?)\*\*\s*:?\s*(.*)$/.exec(bullet[2]!.trim());
    const title = m ? inlinePlain(m[1]!).replace(/:$/, "").trim() : "";
    if (!m || !title) {
      errors.push({ line: l.n, message: "Write each principle as - **Title**: what it means." });
      continue;
    }
    principles.push({ title, detail: m[2]!, line: l.n });
  }
  if (!principles.length && errors.length === errorsBefore) errors.push({ line: principlesAt.line, message: "## Principles has no principles. Write each as - **Title**: what it means." });
  if (principles.length > L.principles) errors.push({ line: principlesAt.line, message: `The vision has ${principles.length} principles; keep it to ${L.principles}.` });
  const cleanPrinciples = principles.map((p) => {
    const detail = inlinePlain(p.detail);
    if (!detail) errors.push({ line: p.line, message: `The principle "${p.title}" has no detail after the colon.` });
    tooLong(errors, p.line, `The principle title "${p.title.slice(0, 40)}"`, p.title, L.principleTitle);
    tooLong(errors, p.line, `The principle "${p.title.slice(0, 40)}"`, detail, L.principleDetail);
    return { title: p.title, detail };
  });

  // North star: "- Metric: …", "- Definition: …", "- Target: …" (the key may be bold).
  const northAt = found.get("north star")!;
  const north: Partial<Record<"metric" | "definition" | "target", { value: string; line: number }>> = {};
  for (const l of northAt.body) {
    if (blank(l.text)) continue;
    const bullet = BULLET_RE.exec(l.text);
    const m = bullet ? /^(?:\*\*)?\s*(metric|definition|target)\s*(?::\s*\*\*|\*\*\s*:|:)\s*(.*)$/i.exec(bullet[2]!.trim()) : null;
    if (!m) {
      errors.push({ line: l.n, message: "Write the north star as three lines: - Metric: …, - Definition: … and - Target: …" });
      continue;
    }
    const key = m[1]!.toLowerCase() as "metric" | "definition" | "target";
    if (north[key]) errors.push({ line: l.n, message: `The north star has two ${key} lines.` });
    const value = inlinePlain(m[2]!);
    if (!value) errors.push({ line: l.n, message: `The north star's ${key} is empty.` });
    else tooLong(errors, l.n, `The north star's ${key}`, value, L.northStarField);
    north[key] = { value, line: l.n };
  }
  const northMissing = (["metric", "definition", "target"] as const).filter((k) => !north[k]);
  if (northMissing.length) errors.push({ line: northAt.line, message: `The north star is missing ${northMissing.map((k) => `- ${k[0]!.toUpperCase()}${k.slice(1)}:`).join(", ")}.` });
  const target = north.target?.value ?? "";
  return {
    statement,
    forWhom,
    problem,
    whyNow,
    principles: cleanPrinciples,
    northStar: { metric: north.metric?.value ?? "", definition: north.definition?.value ?? "", target, label: northStarLabel(target) },
  };
}

function parseSpecification(partLine: number, body: NumberedLine[], errors: PlanImportError[]): PlanSection[] {
  const { lead, parts } = splitAt(body, 2);
  const stray = firstText(lead);
  if (stray) errors.push({ line: stray.n, message: "Put this text under a section heading (## Section name)." });
  if (!parts.length) {
    errors.push({ line: partLine, message: "# Specification has no sections. Start each one with ## Section name." });
    return [];
  }
  if (parts.length > L.sections) errors.push({ line: parts[L.sections]!.heading.line, message: `The specification has ${parts.length} sections; a plan file holds at most ${L.sections}.` });
  const seen = new Map<string, number>();
  const sections: PlanSection[] = [];
  for (const { heading, body: lines } of parts) {
    const name = inlinePlain(heading.title);
    const key = normKey(name);
    if (!key) {
      errors.push({ line: heading.line, message: "This section has no name. Write it as ## Section name." });
      continue;
    }
    if (tooLong(errors, heading.line, `The section name "${name.slice(0, 40)}…"`, name, L.sectionName)) continue;
    if (seen.has(key)) {
      errors.push({ line: heading.line, message: `The section "${name}" appears twice (first on line ${seen.get(key)}).` });
      continue;
    }
    seen.set(key, heading.line);
    const bytes = utf8Bytes(lines.map((l) => l.text).join("\n"));
    if (bytes > L.sectionBytes) {
      errors.push({ line: heading.line, message: `The section "${name}" is larger than ${L.sectionBytes / 1024} KB. Split it into two sections.` });
      continue;
    }
    const before = errors.length;
    const content = markdownToPlanDoc(name, lines, errors);
    if (content.content.length === 1 && errors.length === before) errors.push({ line: heading.line, message: `The section "${name}" has no text.` });
    sections.push({ name, line: heading.line, content });
  }
  return sections;
}

/** The text of a "- " or "1. " list line, else null. */
function listItemText(line: string): string | null {
  if (RULE_RE.test(line)) return null;
  const bullet = BULLET_RE.exec(line);
  if (bullet) return bullet[2]!;
  const ordered = ORDERED_RE.exec(line);
  return ordered ? ordered[3]! : null;
}

const ACCEPTANCE_RE =/^\s*(?:\*\*)?\s*acceptance(?:\s+criteria)?\s*(?::\s*(?:\*\*)?|(?:\*\*)\s*:)\s*$/i;

function parseRoadmap(partLine: number, body: NumberedLine[], errors: PlanImportError[]): PlanRoadmapItem[] {
  const { lead, parts } = splitAt(body, 2);
  const stray = firstText(lead);
  if (stray) errors.push({ line: stray.n, message: "Put roadmap items under ## Now, ## Next or ## Later." });
  if (!parts.length) {
    errors.push({ line: partLine, message: "# Roadmap has no horizons. Use ## Now, ## Next and ## Later." });
    return [];
  }
  const seen = new Map<RoadmapHorizon, number>();
  const items: PlanRoadmapItem[] = [];
  for (const { heading, body: lines } of parts) {
    const horizon = ROADMAP_HORIZONS.find((h) => normKey(heading.title) === h);
    if (!horizon) {
      errors.push({ line: heading.line, message: `"## ${heading.title}" is not a roadmap horizon. Use ## Now, ## Next or ## Later.` });
      continue;
    }
    if (seen.has(horizon)) {
      errors.push({ line: heading.line, message: `## ${heading.title.trim()} appears twice in the roadmap (first on line ${seen.get(horizon)}).` });
      continue;
    }
    seen.set(horizon, heading.line);
    const split = splitAt(lines, 3);
    const loose = firstText(split.lead);
    if (loose) errors.push({ line: loose.n, message: "Start each roadmap item with ### Item title." });
    for (const { heading: itemHeading, body: itemLines } of split.parts) {
      const title = inlinePlain(itemHeading.title);
      if (!title) {
        errors.push({ line: itemHeading.line, message: "This roadmap item has no title." });
        continue;
      }
      if (tooLong(errors, itemHeading.line, `The item title "${title.slice(0, 40)}…"`, title, L.itemTitle)) continue;
      const at = itemLines.findIndex((l) => ACCEPTANCE_RE.test(l.text));
      const description = at === -1 ? itemLines : itemLines.slice(0, at);
      const acceptance: string[] = [];
      if (at !== -1) {
        const before = errors.length;
        for (const l of itemLines.slice(at + 1)) {
          if (blank(l.text)) continue;
          const item = listItemText(l.text);
          if (item !== null) {
            const c = item.replace(/\s+/g, " ").trim();
            if (c) acceptance.push(c);
          } else if (acceptance.length && /^[ \t]+/.test(l.text)) acceptance[acceptance.length - 1] += ` ${l.text.trim()}`;
          else errors.push({ line: l.n, message: `List each acceptance criterion of "${title.slice(0, 60)}" as - criterion.` });
        }
        if (!acceptance.length && errors.length === before) errors.push({ line: itemLines[at]!.n, message: `"${title.slice(0, 60)}" says Acceptance: but lists no criteria.` });
        if (acceptance.length > L.acceptanceCriteria) errors.push({ line: itemLines[at]!.n, message: `"${title.slice(0, 60)}" has ${acceptance.length} acceptance criteria; keep it to ${L.acceptanceCriteria}.` });
      }
      // The description keeps the founder's Markdown as written, without the blank lines around it.
      const descLines = description.map((l) => l.text.replace(/\s+$/, ""));
      while (descLines.length && !descLines[0]!.trim()) descLines.shift();
      while (descLines.length && !descLines[descLines.length - 1]!.trim()) descLines.pop();
      items.push({ title, line: itemHeading.line, horizon, descriptionMd: descLines.join("\n"), acceptance });
    }
  }
  if (items.length > L.roadmapItems) errors.push({ line: items[L.roadmapItems]!.line, message: `The roadmap has ${items.length} items; a plan file holds at most ${L.roadmapItems}.` });
  else if (!items.length && !errors.length) errors.push({ line: partLine, message: "# Roadmap has no items. Start each one with ### Item title under ## Now, ## Next or ## Later." });
  return items;
}
