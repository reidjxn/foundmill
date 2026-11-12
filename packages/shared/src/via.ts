/**
 * Who or what brought a visitor (docs/NETWORK.md §5 "Attribution is part of every loop"). Every public address accepts
 * `?via=<reference>`; the web keeps the first one a visitor arrives with in a cookie, and when that visitor becomes a
 * person the api records it once (`attributions`, `signup.attributed`). It is how the growth loops are measured and how
 * credit for bringing someone is paid.
 *
 * A reference names a public thing by its public address, never by an internal id:
 *   - `p.<slug>`   a project's public page (`/p/<slug>`)
 *   - `u.<handle>` a person's public profile (`/u/<handle>`)
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

export const VIA_KINDS = ["project_page", "person_profile"] as const;
export type ViaKind = (typeof VIA_KINDS)[number];

export interface ViaRef {
  kind: ViaKind;
  /** The slug or handle, as the public address spells it. */
  ref: string;
}

const LETTER: Record<ViaKind, string> = { project_page: "p", person_profile: "u" };
const KIND_BY_LETTER: Record<string, ViaKind> = { p: "project_page", u: "person_profile" };
/** Slugs and handles share one shape (0077, 0080): lowercase letters, digits and hyphens, never a hyphen at either end. */
const ADDRESS = new RegExp(`^[a-z0-9][a-z0-9-]{${PAGE_SLUG_MIN - 2},${PAGE_SLUG_MAX - 2}}[a-z0-9]$`);
/** The longest reference there can be ("p." and a 40-character slug); anything longer is not read at all. */
export const VIA_MAX_LENGTH = 2 + PAGE_SLUG_MAX;

/** "p.maple-bakes" for a project page, "u.maya" for a person. */
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
