/**
 * "On {APP_NAME}": public profiles found by name (BUILD §11.12, §11.14) in the palette, the CRM search and /network.
 * Pure helpers over the `live.people.search` hit; the screens own the query. Server-safe: no React.
 */
import type { PaletteItem } from "@foundmill/dugout";
import type { RouterOutputs } from "@/lib/trpc";

export type PublicHit = RouterOutputs["live"]["people"]["search"]["hits"][number];

/** A founder's profile is addressed by the person, a business's by the business. */
export function publicProfileHref(hit: Pick<PublicHit, "kind" | "businessId" | "userId">): string {
  return hit.kind === "founder" && hit.userId ? `/profiles/founder/${hit.userId}` : `/profiles/business/${hit.businessId}`;
}

/** The search needs two characters; shorter text asks nothing. */
export const PUBLIC_SEARCH_MIN = 2;

export function publicSearchText(text: string): string | null {
  const t = text.trim();
  return t.length >= PUBLIC_SEARCH_MIN ? t : null;
}

/** One line under a hit's name: what it is. */
export function publicHitDescription(hit: Pick<PublicHit, "kind" | "archetype"> & { headline?: string | null }): string {
  if (hit.kind === "founder") return hit.headline || "Founder";
  return hit.archetype ? `Business · ${hit.archetype.replace(/_/g, " ")}` : "Business";
}

/** Palette rows for the hits; the palette labels each "On {APP_NAME}" itself (`public`). */
export function publicPaletteItems(hits: readonly PublicHit[]): PaletteItem[] {
  return hits.map((h) => ({
    id: `public:${h.kind}:${h.kind === "founder" ? h.userId : h.businessId}`,
    kind: h.kind === "founder" ? "person" : "organisation",
    label: h.name,
    description: publicHitDescription(h),
    href: publicProfileHref(h),
    public: true,
  }));
}
