/**
 * Design review output (route `designReview`, item 13): the reviewer's ranked fixes for the pages a code agent changed
 * in a founder's project, each tied to the screenshots that show it. There is no field for praise or an overall verdict:
 * the reviewer only lists what to change, and a page it could not read goes in `unreadable`, so the product never says
 * a page looks good on the reviewer's word (packages/agents `finaliseDesignReview` writes every sentence a person reads).
 */
import { DESIGN_PRINCIPLES, DESIGN_SEVERITIES } from "@foundmill/shared";
import { z } from "zod";

/** Most fixes one review returns; the product keeps the top five. */
export const DESIGN_REVIEW_MAX_FIXES = 8;

export const DesignReviewFix = z.object({
  /** The route, as given in the request ("/", "/pricing"). */
  page: z.string().min(1).max(300),
  viewport: z.enum(["desktop", "phone", "both"]),
  /** The element in words a founder can find on the page ("the Order now button in the header"). */
  element: z.string().min(1).max(200),
  problem: z.string().min(1).max(300),
  /** One concrete change (a value, a size, a color pair), not advice. */
  fix: z.string().min(1).max(300),
  principle: z.enum(DESIGN_PRINCIPLES),
  severity: z.enum(DESIGN_SEVERITIES),
  /** Ids of the screenshots that show it (from the request). */
  shots: z.array(z.string().min(1).max(80)).min(1).max(8),
});
export type DesignReviewFix = z.infer<typeof DesignReviewFix>;

export const DesignReviewOutput = z.object({
  /** Most important first. */
  fixes: z.array(DesignReviewFix).max(DESIGN_REVIEW_MAX_FIXES),
  /** Screenshots the reviewer could not judge (blank, cut off, an error or sign-in page instead of the change). */
  unreadable: z.array(z.object({ shot: z.string().min(1).max(80), why: z.string().min(1).max(200) })).max(8),
});
export type DesignReviewOutput = z.infer<typeof DesignReviewOutput>;
