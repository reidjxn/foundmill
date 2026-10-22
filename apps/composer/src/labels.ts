/**
 * The provenance labels a derived figure carries (BUILD §2.1 rule 6, CLAUDE.md "Label every non-real number"): the
 * display words of the shared definitions (packages/shared/src/terms.ts), so the chip the Inbox and Home draw for a
 * label and the definition behind that chip ("Worked out, not measured") come from one source.
 */
import { TERMS } from "@foundmill/shared";

export const ESTIMATE = TERMS.estimate.word;
export const FORECAST = TERMS.forecast.word;
export const EXHIBIT_LABELS = [ESTIMATE, FORECAST] as const;
export type ExhibitLabel = (typeof EXHIBIT_LABELS)[number];
