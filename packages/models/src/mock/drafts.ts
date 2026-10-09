/**
 * Mock generators for the first-draft routes that precede a parallel fan-out (audit P2, P3): the ideation slate and the
 * foundations skeleton. Each is derived from the full mock draft generator run on the same input (with this route's
 * own seed), so a slate reads like a set of ideation cards and a skeleton carries the vision and the outline sections
 * the foundations mock would write for that brief.
 */
import type { FoundationsSkeletonOutput, IdeationSlateOutput, TiptapBlock } from "../schemas";
import { generateFoundations } from "./foundations";
import { generateIdeation } from "./ideation";
import type { MockContext } from "./inputs";

const clip = (s: string, max: number) => (s.length <= max ? s : `${s.slice(0, max - 1).trimEnd()}…`);

export function generateIdeationSlate(ctx: MockContext): IdeationSlateOutput {
  const { concepts } = generateIdeation(ctx);
  return { slate: concepts.map((c) => ({ id: c.id, name: c.name, archetype: c.archetype, angle: clip(c.pitch, 240) })) };
}

/** First paragraph's text of a section (the mock's sections open with a heading, then an intro paragraph). */
function firstParagraph(blocks: readonly TiptapBlock[]): string | undefined {
  for (const b of blocks) if (b.type === "paragraph") return b.content.map((t) => t.text).join("").trim() || undefined;
  return undefined;
}

export function generateFoundationsSkeleton(ctx: MockContext): FoundationsSkeletonOutput {
  const full = generateFoundations(ctx);
  return {
    vision: full.vision,
    sections: full.sections.map((s) => ({ section: s.section, thesis: clip(firstParagraph(s.content.content) ?? `${s.section} for ${full.vision.for_whom}`, 400) })),
    roadmap: full.roadmap.map((r) => ({ title: r.title, horizon: r.horizon })),
  };
}
