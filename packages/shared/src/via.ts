/**
 * Who or what brought a visitor (docs/NETWORK.md §5 "Attribution is part of every loop"). Every public address accepts
 * `?via=<reference>`; the web keeps the first one a visitor arrives with in a cookie, and when that visitor becomes a
 * person the api records it once (`attributions`, with the account events `signup.attributed` for the new person and
 * `referral.arrived` for the person credited). It is how the growth loops are measured and how credit for bringing
 * someone is paid.
 *
 * A reference names a public thing by its public address, never by an internal id:
 *   - `p.<slug>`   a project's public page (`/p/<slug>`)
 *   - `u.<handle>` a person's public profile (`/u/<handle>`)
 *   - `s.<code>`   a post the team drafted and the founder shared (packages/db `post_links`, item 8): ten random
 *                  characters from `a-z2-7`, one per post and network, minted when the draft is written. A code is
 *                  public (it was in a shared link) and is not an internal id. Only `p.` and `u.` are recorded in
 *                  `attributions`: a first touch through `s.<code>` is recorded as the `p.<slug>` of the post's project
 *                  (`ATTRIBUTION_VIA_KINDS`), so no post code reaches an account event.
 * More kinds (a card, a feedback link, an invitation) add a letter here. Anything else is not a reference and is
 * dropped without an error: a `via` is a hint a stranger typed into an address, never something to trust.
 */
import { PAGE_SLUG_MAX, PAGE_SLUG_MIN } from "./project-page";

/** The query parameter every public address accepts. */
export const VIA_PARAM = "via";
/** The cookie the web keeps the first reference in. */
export const VIA_COOKIE = "fm_via";
/** How long a reference is remembered between the visit and the sign-up. */
export const VIA_MAX_AGE_SECONDS = 30 * 24 * 60 * 60;

/**
 * What `attributions` (0088) records and the account events `signup.attributed` / `referral.arrived` carry. Unchanged
 * by post codes: a post's code resolves to its project's page before anything is recorded.
 */
export const ATTRIBUTION_VIA_KINDS = ["project_page", "person_profile"] as const;
export type AttributionViaKind = (typeof ATTRIBUTION_VIA_KINDS)[number];

/** Every kind of reference an address may carry. */
export const VIA_KINDS = [...ATTRIBUTION_VIA_KINDS, "post"] as const;
export type ViaKind = (typeof VIA_KINDS)[number];

/** The cookie that remembers the last post code a visitor arrived with (last touch; httpOnly, lax). */
export const VIA_POST_COOKIE = "fm_post";
/** How long the last post code is remembered: a follow or a payment within this window is credited to the post. */
export const VIA_POST_MAX_AGE_SECONDS = 7 * 24 * 60 * 60;
/** A post code: ten characters from the RFC 4648 base32 alphabet, lowercase (`a-z2-7`). */
export const POST_CODE_LENGTH = 10;
export const POST_CODE_ALPHABET = "abcdefghijklmnopqrstuvwxyz234567";
const POST_CODE_RE = new RegExp(`^[a-z2-7]{${POST_CODE_LENGTH}}$`);
/** Whether `value` has the shape of a post code. */
export const isPostCode = (value: unknown): value is string => typeof value === "string" && POST_CODE_RE.test(value);

export interface ViaRef {
  kind: ViaKind;
  /** The slug or handle, as the public address spells it. */
  ref: string;
}

const LETTER: Record<ViaKind, string> = { project_page: "p", person_profile: "u", post: "s" };
const KIND_BY_LETTER: Record<string, ViaKind> = { p: "project_page", u: "person_profile", s: "post" };
/** Slugs and handles share one shape (0077, 0080): lowercase letters, digits and hyphens, never a hyphen at either end. */
const ADDRESS = new RegExp(`^[a-z0-9][a-z0-9-]{${PAGE_SLUG_MIN - 2},${PAGE_SLUG_MAX - 2}}[a-z0-9]$`);
/** The longest reference there can be ("p." and a 40-character slug); anything longer is not read at all. */
export const VIA_MAX_LENGTH = 2 + PAGE_SLUG_MAX;

/** "p.maple-bakes" for a project page, "u.maya" for a person, "s.k3m7qa2xpw" for a shared post. */
export function formatVia(ref: ViaRef): string {
  return `${LETTER[ref.kind]}.${ref.ref}`;
}

/** The reference a `via` value names, or null when it is not one. Never throws. */
export function parseVia(value: unknown): ViaRef | null {
  if (typeof value !== "string" || value.length > VIA_MAX_LENGTH) return null;
  const dot = value.indexOf(".");
  if (dot !== 1) return null;
  const kind = KIND_BY_LETTER[value.slice(0, 1)];
  const ref = value.slice(2);
  if (!kind || !ADDRESS.test(ref)) return null;
  // A post code also has its own shape (it fits the address shape above).
  if (kind === "post" && !isPostCode(ref)) return null;
  return { kind, ref };
}

/** `href` with the reference added (or replaced). Works on a path ("/", "/start?x=1") and on a whole URL; a fragment stays last. */
export function withVia(href: string, ref: ViaRef): string {
  const hashAt = href.indexOf("#");
  const hash = hashAt >= 0 ? href.slice(hashAt) : "";
  const rest = hashAt >= 0 ? href.slice(0, hashAt) : href;
  const queryAt = rest.indexOf("?");
  const path = queryAt >= 0 ? rest.slice(0, queryAt) : rest;
  const params = new URLSearchParams(queryAt >= 0 ? rest.slice(queryAt + 1) : "");
  params.set(VIA_PARAM, formatVia(ref));
  return `${path}?${params.toString()}${hash}`;
}
