/**
 * Door A's research, carried into the new business (BUILD §11.1 "Take charge"; audit FR-24). The concept card the
 * founder commits cites what the Research agent read (`idea_versions.research.citations`, at least two per card); at
 * commit each cited web page becomes one of the business's `sources` (kind `doc`), so Product › Sources and the Source
 * Watcher start from the card's evidence instead of from nothing. The card's note is the Research agent's summary, so it
 * is labeled Estimate. Door B seeds its own sources from the Import job (services/foundations.ts).
 */
import { repos, type DbTx, type Source } from "@foundmill/db";
import { META_KIND } from "./ideation";

/** At most this many citations become sources (a card cites a handful; a merged card can carry several cards' worth). */
export const CONCEPT_SOURCES_MAX = 12;

export interface ConceptCitation {
  title: string;
  url: string;
  note: string | null;
}

/** The card's citations that point at a web page (http or https), each address once, in the card's order. */
export function conceptCitations(research: unknown): ConceptCitation[] {
  const citations = (research as { citations?: unknown[] } | null | undefined)?.citations ?? [];
  const out: ConceptCitation[] = [];
  const seen = new Set<string>();
  for (const c of citations) {
    if (!c || typeof c !== "object" || (c as { kind?: unknown }).kind === META_KIND) continue;
    const { title, url, note } = c as { title?: unknown; url?: unknown; note?: unknown };
    if (typeof url !== "string" || !isWebPage(url) || seen.has(url)) continue;
    seen.add(url);
    out.push({ title: typeof title === "string" && title.trim() ? title.trim() : url, url, note: typeof note === "string" && note.trim() ? note.trim() : null });
  }
  return out.slice(0, CONCEPT_SOURCES_MAX);
}

function isWebPage(uri: string): boolean {
  try {
    const u = new URL(uri);
    return (u.protocol === "https:" || u.protocol === "http:") && uri.length <= 2048;
  } catch {
    return false;
  }
}

/** Inside the commit transaction: one `doc` source per cited web page of the committed version. */
export async function seedConceptSources(tx: DbTx, businessId: string, input: { ideaId: string; research: unknown }): Promise<Source[]> {
  const sources: Source[] = [];
  for (const c of conceptCitations(input.research)) {
    sources.push(
      await repos.product.createSource(tx, businessId, {
        kind: "doc",
        uri: c.url,
        title: c.title.slice(0, 400),
        relevance: { ...(c.note ? { summary: c.note.slice(0, 1000) } : {}), provenance: "Estimate", origin: { kind: "concept_card", ideaId: input.ideaId } },
      }),
    );
  }
  return sources;
}
