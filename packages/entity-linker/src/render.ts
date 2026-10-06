/**
 * Framework-free render tree (BUILD §2.1 rule 3 "renders through <EntityLink>"). Dugout's `EntityLink` consumes
 * `EntityNode`; the other nodes carry everything the Inbox needs to draw a dotted "Which one?" underline or an
 * "Unverified" draft chip. Unknown or invisible ids never become entity nodes: when a manifest is given they degrade
 * to text, because by the time text reaches render it must have been validated.
 */
import { parseEntityMarkup } from "./markup";
import type { Manifest, RenderNode, SweepSegment } from "./types";

export const AMBIGUOUS_PROMPT = "Which one?";

export interface RenderOptions {
  /** Business id used by the default `href` (`/b/{bid}/crm/{entityId}/overview`, BUILD §6.2). */
  businessId?: string;
  /** Custom link builder; wins over `businessId`. Return undefined for no href. */
  hrefFor?: (entityId: string) => string | undefined;
  /** The chooser prompt. Default "Which one?". */
  ambiguousPrompt?: string;
}

/** Build the render tree from validated markup text or from sweep segments. */
export function toRenderTree(input: string | readonly SweepSegment[], manifest?: Manifest, options: RenderOptions = {}): RenderNode[] {
  const segments = typeof input === "string" ? parseEntityMarkup(input) : input;
  const href = (id: string): string | undefined => (options.hrefFor ? options.hrefFor(id) : options.businessId ? `/b/${options.businessId}/crm/${id}/overview` : undefined);
  const nodes: RenderNode[] = [];
  const push = (node: RenderNode): void => {
    const last = nodes[nodes.length - 1];
    if (node.type === "text") {
      if (node.text.length === 0) return;
      if (last && last.type === "text") {
        nodes[nodes.length - 1] = { type: "text", text: last.text + node.text };
        return;
      }
    }
    nodes.push(node);
  };

  for (const seg of segments) {
    switch (seg.kind) {
      case "text":
        push({ type: "text", text: seg.text });
        break;
      case "entity": {
        if (manifest) {
          const entity = manifest.get(seg.id);
          if (!entity || !entity.visible) {
            push({ type: "text", text: seg.display });
            break;
          }
          const link = href(seg.id);
          push({ type: "entity", id: seg.id, display: seg.display, kind: entity.kind, name: entity.name, ...(link ? { href: link } : {}) });
          break;
        }
        const link = href(seg.id);
        push({ type: "entity", id: seg.id, display: seg.display, ...(link ? { href: link } : {}) });
        break;
      }
      case "ambiguous":
        push({ type: "ambiguous", text: seg.text, candidates: seg.candidates, prompt: options.ambiguousPrompt ?? AMBIGUOUS_PROMPT, decoration: "dotted-underline" });
        break;
      case "draft":
        push({ type: "draft", name: seg.name, kindGuess: seg.kindGuess, flag: "unverified" });
        break;
    }
  }
  return nodes;
}

/** Ids of every entity node, deduplicated, in order (what the Inbox header lists as related entities). */
export function entityIdsInTree(nodes: readonly RenderNode[]): string[] {
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

/** Plain text of a render tree (for tests and previews). */
export function renderTreeToPlain(nodes: readonly RenderNode[]): string {
  return nodes.map((n) => (n.type === "text" ? n.text : n.type === "entity" ? n.display : n.type === "ambiguous" ? n.text : n.name)).join("");
}
