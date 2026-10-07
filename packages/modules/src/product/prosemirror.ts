/**
 * ProseMirror JSON ↔ plain text for spec blocks (BUILD §11.5). The collab server stores blocks as ProseMirror JSON
 * (apps/collab prosemirror.ts); diffs, excerpts, the outline and the plain fallback editor need text. The text form is a
 * small Markdown subset (headings, bullet and ordered lists, paragraphs) so `textToPm(pmToText(doc))` keeps structure.
 */
import type { PmDoc } from "./types";

export interface PmNode {
  type: string;
  attrs?: Record<string, unknown>;
  content?: PmNode[];
  text?: string;
  marks?: { type: string; attrs?: Record<string, unknown> }[];
}

function isNode(v: unknown): v is PmNode {
  return typeof v === "object" && v !== null && typeof (v as PmNode).type === "string";
}

function inlineText(node: PmNode): string {
  if (node.type === "text") return node.text ?? "";
  if (node.type === "hardBreak" || node.type === "hard_break") return "\n";
  return (node.content ?? []).map(inlineText).join("");
}

function blockLines(node: PmNode, depth = 0, ordinal?: number): string[] {
  const indent = "  ".repeat(depth);
  switch (node.type) {
    case "heading": {
      const level = Math.min(6, Math.max(1, Number(node.attrs?.level ?? 1)));
      return [`${indent}${"#".repeat(level)} ${inlineText(node)}`.trimEnd()];
    }
    case "paragraph": {
      const text = inlineText(node);
      const prefix = ordinal !== undefined ? `${ordinal}. ` : "";
      return [`${indent}${prefix}${text}`.trimEnd()];
    }
    case "bulletList":
    case "bullet_list":
      return (node.content ?? []).flatMap((item) => listItemLines(item, depth, "- "));
    case "orderedList":
    case "ordered_list": {
      const start = Number(node.attrs?.start ?? 1);
      return (node.content ?? []).flatMap((item, i) => listItemLines(item, depth, `${start + i}. `));
    }
    case "blockquote":
      return (node.content ?? []).flatMap((c) => blockLines(c, depth)).map((l) => `> ${l}`);
    case "codeBlock":
    case "code_block":
      return [`${indent}\`\`\``, ...inlineText(node).split("\n").map((l) => `${indent}${l}`), `${indent}\`\`\``];
    case "horizontalRule":
    case "horizontal_rule":
      return [`${indent}---`];
    default: {
      if (node.content?.length) return node.content.flatMap((c) => blockLines(c, depth));
      const text = inlineText(node);
      return text ? [`${indent}${text}`] : [];
    }
  }
}

function listItemLines(item: PmNode, depth: number, marker: string): string[] {
  const children = item.content ?? [];
  const [first, ...rest] = children;
  const indent = "  ".repeat(depth);
  const head = first ? `${indent}${marker}${inlineText(first)}`.trimEnd() : `${indent}${marker}`.trimEnd();
  const tail = rest.flatMap((c) => blockLines(c, depth + 1));
  return [head, ...tail];
}

/** Multi-line text with a blank line between top-level blocks. Empty doc → "". */
export function pmToText(doc: PmDoc | null | undefined): string {
  if (!isNode(doc)) return "";
  if (doc.type !== "doc") return blockLines(doc).join("\n");
  return (doc.content ?? []).map((n) => blockLines(n).join("\n")).filter((s) => s.length > 0).join("\n\n");
}

/** One-line excerpt (first `max` characters of the flattened text). */
export function pmExcerpt(doc: PmDoc | null | undefined, max = 140): string {
  const text = pmToText(doc).replace(/^#+\s*/gm, "").replace(/\s+/g, " ").trim();
  return text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text;
}

/** The first heading's text, else the first line, else the fallback. */
export function pmTitle(doc: PmDoc | null | undefined, fallback = "Untitled block"): string {
  if (!isNode(doc)) return fallback;
  const nodes = doc.type === "doc" ? (doc.content ?? []) : [doc];
  const heading = nodes.find((n) => n.type === "heading");
  const text = (heading ? inlineText(heading) : pmExcerpt(doc, 72)).trim();
  return text || fallback;
}

export function pmWordCount(doc: PmDoc | null | undefined): number {
  const t = pmToText(doc).trim();
  return t ? t.split(/\s+/).length : 0;
}

const para = (text: string): PmNode => ({ type: "paragraph", content: text ? [{ type: "text", text }] : [] });

/** Parse the text subset back into a ProseMirror document. Unknown syntax becomes paragraphs. */
export function textToPm(text: string): PmDoc {
  const lines = text.replace(/\r\n?/g, "\n").split("\n");
  const content: PmNode[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i] ?? "";
    if (!line.trim()) {
      i += 1;
      continue;
    }
    const heading = /^(#{1,6})\s+(.*)$/.exec(line);
    if (heading) {
      content.push({ type: "heading", attrs: { level: heading[1]!.length }, content: heading[2]!.trim() ? [{ type: "text", text: heading[2]!.trim() }] : [] });
      i += 1;
      continue;
    }
    if (line.trim() === "---") {
      content.push({ type: "horizontalRule" });
      i += 1;
      continue;
    }
    if (line.trim() === "```") {
      const code: string[] = [];
      i += 1;
      while (i < lines.length && (lines[i] ?? "").trim() !== "```") {
        code.push(lines[i] ?? "");
        i += 1;
      }
      i += 1;
      content.push({ type: "codeBlock", content: code.length ? [{ type: "text", text: code.join("\n") }] : [] });
      continue;
    }
    const bullet = /^\s*[-*]\s+(.*)$/.exec(line);
    if (bullet) {
      const items: PmNode[] = [];
      while (i < lines.length) {
        const m = /^\s*[-*]\s+(.*)$/.exec(lines[i] ?? "");
        if (!m) break;
        items.push({ type: "listItem", content: [para(m[1]!.trim())] });
        i += 1;
      }
      content.push({ type: "bulletList", content: items });
      continue;
    }
    const ordered = /^\s*(\d+)\.\s+(.*)$/.exec(line);
    if (ordered) {
      const items: PmNode[] = [];
      const start = Number(ordered[1]);
      while (i < lines.length) {
        const m = /^\s*(\d+)\.\s+(.*)$/.exec(lines[i] ?? "");
        if (!m) break;
        items.push({ type: "listItem", content: [para(m[2]!.trim())] });
        i += 1;
      }
      content.push({ type: "orderedList", attrs: { start }, content: items });
      continue;
    }
    if (line.startsWith("> ")) {
      const inner: string[] = [];
      while (i < lines.length && (lines[i] ?? "").startsWith("> ")) {
        inner.push((lines[i] ?? "").slice(2));
        i += 1;
      }
      content.push({ type: "blockquote", content: (textToPm(inner.join("\n")).content as PmNode[]) ?? [] });
      continue;
    }
    // Paragraph: consecutive non-empty, non-structured lines joined with hard breaks.
    const paraLines: string[] = [];
    while (i < lines.length) {
      const l = lines[i] ?? "";
      if (!l.trim() || /^(#{1,6})\s+/.test(l) || /^\s*[-*]\s+/.test(l) || /^\s*\d+\.\s+/.test(l) || l.startsWith("> ") || l.trim() === "```" || l.trim() === "---") break;
      paraLines.push(l.trimEnd());
      i += 1;
    }
    const inline: PmNode[] = [];
    paraLines.forEach((l, idx) => {
      if (idx > 0) inline.push({ type: "hardBreak" });
      if (l) inline.push({ type: "text", text: l });
    });
    content.push({ type: "paragraph", content: inline });
  }
  return { type: "doc", content };
}

export const EMPTY_PM_DOC: PmDoc = { type: "doc", content: [] };
