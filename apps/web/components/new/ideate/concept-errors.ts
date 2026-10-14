/**
 * What a concept action that failed says (Ideation Studio, Compare, Commit). A card the API no longer has in the deck
 * (discarded, or already a business) reads in plain words, never as "idea <uuid> not found"; anything else keeps the
 * API's own sentence.
 */
import { errorMessage, trpcErrorCode } from "@/lib/trpc";

export const CONCEPT_GONE_MESSAGE = "This concept is no longer in your deck: it was discarded or has already become a business.";

/** True when the API answered that the concept is not in the founder's deck. */
export function isConceptGone(err: unknown): boolean {
  return trpcErrorCode(err) === "NOT_FOUND";
}

export function conceptErrorMessage(err: unknown): string {
  return isConceptGone(err) ? CONCEPT_GONE_MESSAGE : errorMessage(err);
}
