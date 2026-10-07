/**
 * `[[ent:<uuid>|Display]]` markup → render nodes for `EntityText` (BUILD §2.1 rule 3, §11.3).
 *
 * The node shapes are structurally identical to `@founder-manager/entity-linker`'s `RenderNode` family (TextNode,
 * EntityNode, AmbiguousNode, DraftNode), so an Inbox can hand `toRenderTree()` output straight to `EntityText`.
 * Dugout does not depend on the linker package (docs/NEEDED_DEPS.md); the parser here is the display-side half only:
 * it uses the shared `ENTITY_MARKUP_RE` so both sides agree on what a mention looks like, and it never validates ids
 * (that is the linker's job before text is stored).
 */
import { ENTITY_MARKUP_RE, type EntityKind } from "@founder-manager/shared";

export interface EntityTextNode {
  type: "text";
  text: string;
}

export interface EntityNode {
  type: "entity";
  id: string;
  display: string;
  kind?: EntityKind;
  /** Display name in the manifest (hover card title) when known. */
  name?: string;
  href?: string;
}

export interface AmbiguousCandidate {
  id: string;
  name: string;
  kind: EntityKind;
  /** Match score 0–1. */
  score: number;
  tier?: string;
}

export interface AmbiguousNode {
  type: "ambiguous";
  text: string;
  candidates: readonly AmbiguousCandidate[];
  prompt: string;
  decoration: "dotted-underline";
}

export interface DraftNode {
  type: "draft";
  name: string;
  kindGuess: EntityKind;
  flag: "unverified";
}

export type EntityRenderNode = EntityTextNode | EntityNode | AmbiguousNode | DraftNode;

export const AMBIGUOUS_PROMPT = "Which one?";
const MARKUP_OPEN = "[[ent:";

function markupRe(): RegExp {
  return new RegExp(
    ENTITY_MARKUP_RE.source,
    ENTITY_MARKUP_RE.flags.includes("g") ? ENTITY_MARKUP_RE.flags : `${ENTITY_MARKUP_RE.flags}g`,
  );
}

/** Does the string contain at least one well-formed mention? Cheap pre-check used by Markdown. */
export function hasEntityMarkup(text: string): boolean {
  return text.includes(MARKUP_OPEN) && markupRe().test(text);
}

/**
 * Parse text into text and entity nodes. Adjacent text is merged and empty text dropped. A malformed `[[ent:` opening
 * (bad id, missing display or closing) is kept as plain text, never as a link, so a broken mention can never look
 * like a verified one.
 */
export function parseEntityText(
  text: string,
  options: { hrefFor?: (id: string) => string | undefined } = {},
): EntityRenderNode[] {
  const nodes: EntityRenderNode[] = [];
  const push = (node: EntityRenderNode): void => {
    if (node.type === "text") {
      if (node.text.length === 0) return;
      const last = nodes[nodes.length - 1];
      if (last && last.type === "text") {
        nodes[nodes.length - 1] = { type: "text", text: last.text + node.text };
        return;
      }
    }
    nodes.push(node);
  };
  let cursor = 0;
  for (const m of text.matchAll(markupRe())) {
    const start = m.index ?? 0;
    if (start > cursor) push({ type: "text", text: text.slice(cursor, start) });
    const id = m[1] as string;
    const href = options.hrefFor?.(id);
    push({ type: "entity", id, display: m[2] as string, ...(href ? { href } : {}) });
    cursor = start + m[0].length;
  }
  if (cursor < text.length) push({ type: "text", text: text.slice(cursor) });
  return nodes;
}

/** Plain text of a node list (accessible names, previews, tests). */
export function entityNodesToPlain(nodes: readonly EntityRenderNode[]): string {
  return nodes
    .map((n) =>
      n.type === "text"
        ? n.text
        : n.type === "entity"
          ? n.display
          : n.type === "ambiguous"
            ? n.text
            : n.name,
    )
    .join("");
}

/** Ids of every entity node, deduplicated, in order. */
export function entityIdsIn(nodes: readonly EntityRenderNode[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const n of nodes) {
    if (n.type === "entity" && !seen.has(n.id)) {
      seen.add(n.id);
      out.push(n.id);
    }
  }
  return out;
}

/** Strip markup to display text (what a title attribute or a CSV cell should carry). */
export function stripEntityMarkup(text: string): string {
  return entityNodesToPlain(parseEntityText(text));
}
