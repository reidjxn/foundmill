/**
 * Showcase videos of real projects (docs/THESIS_REVIEW.md §13 item 15; approved by the network session, Nov 13, 2026).
 *
 * - `HOUSE_BUSINESS_ID`: Foundmill's own business on the platform. Only people with an owner's standing there
 *   (`isOwnerRole`) may ask a project to be featured, and its social agent writes the script and makes the video. The
 *   operator creates the house business with this id; on a stack without it, nobody can ask (the api checks the
 *   membership, not this constant alone).
 * - `SHOWCASE_MAY_ASK_DEFAULT`: the project setting "Foundmill may ask to feature this project" where its founders have
 *   not chosen. Off (founder, Nov 14, 2026): only a project whose founders turned it on is ever asked. The one place
 *   the default lives: flipping it is this one line. Even on, it only lets Foundmill ask; nothing is ever posted
 *   without every founder's yes to the final video.
 */
export const HOUSE_BUSINESS_ID = "f0f0f0f0-0000-4000-8000-00000000f00d" as const;

export const SHOWCASE_MAY_ASK_DEFAULT: boolean = false;

/** The setting as a project reads it: its founders' own choice, else the default above. */
export const showcaseMayAsk = (stored: boolean | null | undefined): boolean => (typeof stored === "boolean" ? stored : SHOWCASE_MAY_ASK_DEFAULT);
