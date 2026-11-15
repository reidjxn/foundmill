/**
 * A person's own public profile (docs/THESIS_REVIEW.md package 2.3, first part; migration 0080 on `founder_profiles`):
 * a page about the person that exists without any project, at `/u/<handle>`, public only when the person publishes it.
 * Signed out and from 390 px, like a project's page (./project-page).
 *
 * Pure, no Zod: browser code imports this from "@foundmill/shared/person-profile". The Zod schemas of the same shape
 * (`PersonProfileContent`, `PersonHandle`) live in ./types and are built from these constants.
 *
 * - Every field is plain text: nothing is ever read as markdown or HTML, and the page renders each string as a text node.
 * - The handle follows the project page's address rule (`pageSlugProblem`: 3 to 40 lowercase letters, digits and
 *   hyphens, never a reserved word). Handles live under /u/ and addresses under /p/, so the two never collide.
 * - "What are you here for?" has four answers. "Building on my own" is the default and a complete answer: the public
 *   page then says nothing at all about people (`lookingForLine` is null), and nothing on the edit screen asks more.
 */
import { PAGE_RESERVED_SLUGS, PAGE_SLUG_MAX, PAGE_SLUG_MIN, clipText, normalizePageText, pageSlugProblem } from "./project-page";

export const PERSON_HEADLINE_MAX = 80;
export const PERSON_ABOUT_MAX = 600;
export const PERSON_PLACE_MAX = 60;
/** At most this many tags in "Good at" and in "Wants to learn". */
export const PERSON_TAGS_MAX = 8;
/** Each tag is 1 to 30 characters. */
export const PERSON_TAG_MAX = 30;

export const PERSON_LOOKING_FOR = ["on_my_own", "open_to_people", "looking_for_cofounder", "looking_to_join"] as const;
export type PersonLookingFor = (typeof PERSON_LOOKING_FOR)[number];

/** "What are you here for?" and its answers, as the edit screen reads them. The first is the default. */
export const LOOKING_FOR_QUESTION = "What are you here for?";
export const LOOKING_FOR_OPTIONS: readonly { value: PersonLookingFor; label: string }[] = [
  { value: "on_my_own", label: "Building on my own" },
  { value: "open_to_people", label: "Open to building with people" },
  { value: "looking_for_cofounder", label: "Looking for a cofounder" },
  { value: "looking_to_join", label: "Looking to join a project" },
];

/** The public page's line for the answer, or null for "Building on my own": the page then says nothing about people. */
export function lookingForLine(value: PersonLookingFor | string | null | undefined): string | null {
  switch (value) {
    case "open_to_people":
      return "Open to building with people";
    case "looking_for_cofounder":
      return "Looking for a cofounder";
    case "looking_to_join":
      return "Looking to join a project";
    default:
      return null;
  }
}

/** What the person writes on their public profile. Every field is plain text. */
export interface PersonProfileContent {
  /** One line, 0 to 80 characters, under the name. */
  headline: string;
  /** 0 to 600 characters; paragraphs split on blank lines. */
  about: string;
  /** "Good at": 0 to 8 short tags, 1 to 30 characters each. */
  strengths: string[];
  /** "Wants to learn": 0 to 8 short tags. */
  wantsToLearn: string[];
  lookingFor: PersonLookingFor;
  /** Free text, 0 to 60 characters ("Manchester, UK"); left off the page when empty. */
  place: string;
}

export type PersonProfileField = "headline" | "about" | "strengths" | "wantsToLearn" | "place";
export type PersonProfileErrors = Partial<Record<PersonProfileField, string>>;

/** Suggestions the edit screen offers as tags; the person can type any of their own. */
export const STRENGTH_SUGGESTIONS: readonly string[] = ["Talking to people", "Writing", "Design", "Selling", "Building websites", "Coding", "Organizing", "Social media", "Numbers", "Making things by hand", "Photography", "Teaching"];
export const LEARN_SUGGESTIONS: readonly string[] = ["Selling", "Marketing", "Pricing", "Coding", "Design", "Writing", "Bookkeeping", "Talking to customers", "Building websites", "Public speaking"];

const oneLine = (s: string): string => s.replace(/\s+/g, " ").trim();

/** Tags tidied: each on one line and trimmed, empty ones dropped, repeats (any letter case) dropped, in the order given. */
export function normalizeTags(tags: readonly string[]): string[] {
  const out: string[] = [];
  for (const raw of tags) {
    const tag = oneLine(String(raw ?? ""));
    if (!tag || out.some((t) => t.toLowerCase() === tag.toLowerCase())) continue;
    out.push(tag);
  }
  return out;
}

/** What the fields hold once tidied: the headline and the place on one line, about normalized, the tags tidied. */
export function normalizePersonProfile(content: PersonProfileContent): PersonProfileContent {
  return {
    headline: oneLine(content.headline ?? ""),
    about: normalizePageText(content.about ?? ""),
    strengths: normalizeTags(content.strengths ?? []),
    wantsToLearn: normalizeTags(content.wantsToLearn ?? []),
    lookingFor: (PERSON_LOOKING_FOR as readonly string[]).includes(content.lookingFor) ? content.lookingFor : "on_my_own",
    place: oneLine(content.place ?? ""),
  };
}

function tagProblem(tags: readonly string[]): string | undefined {
  if (tags.length > PERSON_TAGS_MAX) return `Keep this to ${PERSON_TAGS_MAX} tags.`;
  if (tags.some((t) => t.length > PERSON_TAG_MAX)) return `Keep each tag to ${PERSON_TAG_MAX} characters.`;
  return undefined;
}

/** What is over a limit, by field, in the person's words. Empty when the profile can be saved and published. */
export function personProfileProblems(content: PersonProfileContent): PersonProfileErrors {
  const c = normalizePersonProfile(content);
  const errors: PersonProfileErrors = {};
  if (c.headline.length > PERSON_HEADLINE_MAX) errors.headline = `Keep the headline to ${PERSON_HEADLINE_MAX} characters.`;
  if (c.about.length > PERSON_ABOUT_MAX) errors.about = `Keep this to ${PERSON_ABOUT_MAX} characters.`;
  if (c.place.length > PERSON_PLACE_MAX) errors.place = `Keep this to ${PERSON_PLACE_MAX} characters.`;
  const strengths = tagProblem(c.strengths);
  if (strengths) errors.strengths = strengths;
  const learn = tagProblem(c.wantsToLearn);
  if (learn) errors.wantsToLearn = learn;
  return errors;
}

/** A profile with nothing written yet: every field empty and "Building on my own". */
export const EMPTY_PERSON_PROFILE: PersonProfileContent = { headline: "", about: "", strengths: [], wantsToLearn: [], lookingFor: "on_my_own", place: "" };

/** A stored row's fields read defensively (a row written outside the api). */
export function readPersonProfile(value: Partial<Record<keyof PersonProfileContent, unknown>> | null | undefined): PersonProfileContent {
  const v = value ?? {};
  const str = (x: unknown) => (typeof x === "string" ? x : "");
  const tags = (x: unknown) => (Array.isArray(x) ? x.filter((t): t is string => typeof t === "string") : []);
  const lookingFor = (PERSON_LOOKING_FOR as readonly string[]).includes(v.lookingFor as string) ? (v.lookingFor as PersonLookingFor) : "on_my_own";
  return { headline: str(v.headline), about: str(v.about), strengths: tags(v.strengths), wantsToLearn: tags(v.wantsToLearn), lookingFor, place: str(v.place) };
}

/** True when two profiles read the same once tidied. */
export function samePersonProfile(a: PersonProfileContent, b: PersonProfileContent): boolean {
  const x = normalizePersonProfile(a);
  const y = normalizePersonProfile(b);
  const sameTags = (p: string[], q: string[]) => p.length === q.length && p.every((t, i) => t === q[i]);
  return x.headline === y.headline && x.about === y.about && x.place === y.place && x.lookingFor === y.lookingFor && sameTags(x.strengths, y.strengths) && sameTags(x.wantsToLearn, y.wantsToLearn);
}

/** The route segment every person's page lives under. */
export const PERSON_PATH_PREFIX = "/u/";

/** `/u/<handle>` */
export function personPath(handle: string): string {
  return `${PERSON_PATH_PREFIX}${handle}`;
}

/** The profile's full address on `origin` (the web app's own origin). */
export function personUrl(origin: string, handle: string): string {
  return `${origin.replace(/\/+$/, "")}${personPath(handle)}`;
}

/** Why a handle cannot be used, in the person's words, or null when it can: the project page's address rule. */
export function personHandleProblem(handle: string): string | null {
  return pageSlugProblem(handle);
}

export const isPersonHandle = (handle: unknown): handle is string => typeof handle === "string" && personHandleProblem(handle) === null;

export const PERSON_HANDLE_TAKEN = "That address is taken. Try another one.";

/** An address that poses as the product or its staff ("foundmill-support", "admin-team"). */
export const PERSON_HANDLE_RESERVED = "That address is kept for the product itself. Try another one.";

/**
 * How long a handle a person leaves (renamed or cleared) stays theirs: nobody else can take it in that time, so a link
 * people already have never starts pointing at someone else (migration 0080 `person_handle_releases` says the same).
 */
export const PERSON_HANDLE_HOLD_DAYS = 90;

/**
 * A usable handle from a name: lowercased, accents dropped, everything else turned into hyphens, cut to 40 characters;
 * a result that is too short or reserved gets "-profile" so it always passes `personHandleProblem`.
 */
export function suggestPersonHandle(name: string): string {
  const clean = (s: string): string => s.replace(/-{2,}/g, "-").replace(/^-+|-+$/g, "");
  const base = clean(
    (name ?? "")
      .normalize("NFKD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-"),
  );
  let handle = clean(base.slice(0, PAGE_SLUG_MAX));
  if (handle.length < PAGE_SLUG_MIN || PAGE_RESERVED_SLUGS.includes(handle)) handle = clean(`${handle ? `${handle}-` : ""}profile`.slice(0, PAGE_SLUG_MAX));
  return handle;
}

/** Up to two initials for the avatar ("Maya Okafor" → "MO", "maya" → "M"); "?" when the name has no letter or digit. */
export function personInitials(name: string): string {
  const words = oneLine(name ?? "")
    .split(" ")
    .map((w) => w.replace(/[^\p{L}\p{N}]/gu, ""))
    .filter(Boolean);
  if (words.length === 0) return "?";
  const first = [...words[0]!][0] ?? "";
  const last = words.length > 1 ? ([...words[words.length - 1]!][0] ?? "") : "";
  return `${first}${last}`.toUpperCase();
}

/** The browser and share title: "{name}: {headline}", or the name alone, cut to about 70 characters at a word. */
export function personTitle(name: string, headline: string, max = 70): string {
  const n = oneLine(name);
  const h = oneLine(headline);
  return clipText(h ? `${n}: ${h}` : n, max);
}

/** The description for search and share cards: the start of about, else the headline, else a plain line with the name. */
export function personDescription(name: string, about: string, headline: string, appName: string, max = 160): string {
  return clipText(oneLine(about) || oneLine(headline) || `${oneLine(name)} on ${appName}`, max);
}

/**
 * Why a profile was held back when the person pressed Publish or saved a public one: the deterministic checks of the
 * community screen (markup, email addresses, phone numbers), the same ones a project page goes through. No model reads it.
 */
export const PERSON_HOLD_REASONS = ["personal_data", "markup"] as const;
export type PersonHoldReason = (typeof PERSON_HOLD_REASONS)[number];

export const PERSON_HOLD_MESSAGES: Readonly<Record<PersonHoldReason, string>> = {
  personal_data: "Something on your profile looks like an email address or a phone number. A public profile is open to everyone, so take it out and try again.",
  markup: "Something on your profile looks like code or a script link. A public profile shows plain text only, so take it out and try again.",
};

/** The edit screen's state line ("Public since Oct 7, 2026" / "Only you can see this"); the date comes formatted. */
export function personStateLine(state: { public: boolean; publishedOn?: string | null }): string {
  return state.public ? `Public since ${state.publishedOn ?? "today"}` : "Only you can see this";
}
