/**
 * The hyperlinking pipeline as one call for the composer (BUILD §11.3): validate → (the caller re-asks once) → sweep →
 * render tree. `checkComposerText` is the step between model calls; `linkComposerText` is the step after the text is
 * accepted. Both are pure apart from the optional model client passed to the sweep.
 */
import { buildReask, shouldReask, stripInvalidMentions, type Reask } from "./reask";
import { toRenderTree, type RenderOptions } from "./render";
import { sweep, type SweepOptions } from "./sweep";
import { validateMarkup } from "./markup";
import type { LinkerModelClient, Manifest, RenderNode, SweepResult, ValidationResult } from "./types";

export type ComposerCheck =
  | { ok: true; validation: ValidationResult }
  | { ok: false; validation: ValidationResult; reask: Reask | null; fallbackText: string };

/**
 * Validate a model output. When invalid and a re-ask is still allowed, `reask` carries the follow-up message; when the
 * single re-ask has been used, `reask` is null and `fallbackText` is the text with offending mentions demoted so the
 * note can still ship with no unknown id reaching render.
 */
export function checkComposerText(text: string, manifest: Manifest, reasksSoFar = 0): ComposerCheck {
  const validation = validateMarkup(text, manifest);
  if (validation.valid) return { ok: true, validation };
  const reask = shouldReask(validation, reasksSoFar) ? buildReask(validation, manifest, { attempt: reasksSoFar }) : null;
  return { ok: false, validation, reask, fallbackText: stripInvalidMentions(text, manifest) };
}

export interface LinkedText {
  /** Text with every link as markup, ready for `inbox_items.body_md`. */
  text: string;
  /** Deduplicated ids of every linked entity (markup and sweep), for `inbox_items.entity_ids` and `mentions`. */
  entityIds: string[];
  sweep: SweepResult;
  tree: RenderNode[];
}

/**
 * Sweep validated text and build the render tree. Throws if the text does not validate: callers must run
 * `checkComposerText` first (the sweep must never run on text with unknown ids).
 */
export async function linkComposerText(text: string, manifest: Manifest, modelClient?: LinkerModelClient | null, options: SweepOptions & RenderOptions = {}): Promise<LinkedText> {
  const validation = validateMarkup(text, manifest);
  if (!validation.valid) {
    throw new Error(`linkComposerText: text has invalid entity markup (unknown: ${validation.unknownIds.join(", ") || "-"}; invisible: ${validation.invisibleIds.join(", ") || "-"}; malformed: ${validation.malformed.length})`);
  }
  const result = await sweep(text, manifest, modelClient, options);
  const tree = toRenderTree(result.segments, manifest, options);
  const ids: string[] = [];
  const seen = new Set<string>();
  for (const seg of result.segments) {
    if (seg.kind === "entity" && !seen.has(seg.id)) {
      seen.add(seg.id);
      ids.push(seg.id);
    }
  }
  return { text: result.text, entityIds: ids, sweep: result, tree };
}
