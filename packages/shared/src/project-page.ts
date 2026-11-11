/**
 * A project's public page (docs/THESIS_REVIEW.md package 1.1; migration 0077 `project_pages`): the one page a founder
 * publishes and sends to anyone, served signed-out at `/p/<slug>` from 390 px.
 *
 * Pure, no Zod: browser code imports this from "@foundmill/shared/project-page". The Zod schemas of the same shape
 * (`ProjectPageContent`, `ProjectPageDraft`, `ProjectPageSlug`) live in ./types and are built from these constants.
 *
 * - The content is plain text only. `about` splits into paragraphs on blank lines (`pageParagraphs`); nothing is ever
 *   read as markdown or HTML, and the page renders every string as a text node.
 * - The address is a slug, 3 to 40 lowercase letters, digits and hyphens, never one of `PAGE_RESERVED_SLUGS`.
 * - `starterPageDraft` builds the first draft from what the project already has, with no model call.
 */

export const PAGE_STAGES = ["idea", "building", "live"] as const;
export type PageStage = (typeof PAGE_STAGES)[number];

/** The stage chip's words. */
export const PAGE_STAGE_LABELS: Readonly<Record<PageStage, string>> = { idea: "Idea", building: "Being built", live: "Live" };

export const PAGE_PITCH_MAX = 140;
export const PAGE_ABOUT_MAX = 1500;
export const PAGE_FOR_WHOM_MAX = 300;
export const PAGE_SLUG_MIN = 3;
export const PAGE_SLUG_MAX = 40;

/** Lowercase letters, digits and hyphens, 3 to 40 characters, never starting or ending with a hyphen (0077 check). */
export const PAGE_SLUG_PATTERN = /^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$/;

/** Addresses the product keeps for itself (0077 repeats the list in its check constraint; a test compares the two). */
export const PAGE_RESERVED_SLUGS: readonly string[] = [
  "new", "login", "api", "p", "b", "admin", "settings", "foundmill", "www", "app", "help", "about", "terms", "privacy", "auth",
  "start", "examples", "businesses", "onboarding", "support", "network", "communities", "profiles", "milestones",
];

/** The route segment every public page lives under. */
export const PAGE_PATH_PREFIX = "/p/";

/** What a published page says. Every field is plain text. */
export interface ProjectPageContent {
  /** One line, 1 to 140 characters: the page's headline. */
  pitch: string;
  /** 1 to 1,500 characters; paragraphs split on blank lines. */
  about: string;
  /** "Who it is for", 0 to 300 characters; left out of the page when empty. */
  forWhom: string;
  stage: PageStage;
  /** Whether the page names the people building it. Off until the founder turns it on. */
  showFounders: boolean;
}

export type PageField = "pitch" | "about" | "forWhom" | "stage";
export type PageFieldErrors = Partial<Record<PageField, string>>;

/** The slug rule in one plain sentence (the console shows it under "Change address"). */
export const PAGE_SLUG_RULE = `Use ${PAGE_SLUG_MIN} to ${PAGE_SLUG_MAX} lowercase letters, numbers and hyphens, starting and ending with a letter or a number.`;

export const PAGE_SLUG_TAKEN = "That address is taken. Try another one.";

/** `/p/<slug>` */
export function pagePath(slug: string): string {
  return `${PAGE_PATH_PREFIX}${slug}`;
}

/** The page's full address on `origin` (the web app's own origin). */
export function pageUrl(origin: string, slug: string): string {
  return `${origin.replace(/\/+$/, "")}${pagePath(slug)}`;
}

/** Why a slug cannot be used, in the founder's words, or null when it can. */
export function pageSlugProblem(slug: string): string | null {
  if (slug.length < PAGE_SLUG_MIN) return `The address needs at least ${PAGE_SLUG_MIN} characters.`;
  if (slug.length > PAGE_SLUG_MAX) return `The address can be at most ${PAGE_SLUG_MAX} characters.`;
  if (!PAGE_SLUG_PATTERN.test(slug)) return PAGE_SLUG_RULE;
  if (PAGE_RESERVED_SLUGS.includes(slug)) return "That address is kept for the product itself. Try another one.";
  return null;
}

export const isPageSlug = (slug: unknown): slug is string => typeof slug === "string" && pageSlugProblem(slug) === null;

/**
 * A usable slug from any text (a business's own slug, its name): lowercased, everything else turned into hyphens,
 * cut to 40 characters; a result that is too short or reserved gets "-project" so it always passes `pageSlugProblem`.
 */
export function suggestPageSlug(text: string): string {
  const clean = (s: string): string => s.replace(/-{2,}/g, "-").replace(/^-+|-+$/g, "");
  const base = clean(
    text
      .normalize("NFKD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-"),
  );
  let slug = clean(base.slice(0, PAGE_SLUG_MAX));
  if (slug.length < PAGE_SLUG_MIN || PAGE_RESERVED_SLUGS.includes(slug)) slug = clean(`${slug ? `${slug}-` : ""}project`.slice(0, PAGE_SLUG_MAX));
  return slug;
}

/** `slug` with a short suffix (the suggestion when another project already has the plain one), still within 40 characters. */
export function suffixPageSlug(slug: string, suffix: string): string {
  const tail = suffix.toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 8) || "2";
  return `${slug.slice(0, PAGE_SLUG_MAX - tail.length - 1).replace(/-+$/g, "")}-${tail}`;
}

const oneLine = (s: string): string => s.replace(/\s+/g, " ").trim();

/** Cuts at a word boundary within `max` characters, with an ellipsis when something was cut. */
export function clipText(text: string, max: number): string {
  if (text.length <= max) return text;
  const cut = text.slice(0, max - 1);
  const space = cut.lastIndexOf(" ");
  return `${(space >= max * 0.5 ? cut.slice(0, space) : cut).replace(/[\s,;:.-]+$/g, "")}…`;
}

/** The first sentence of a text, on one line (the whole line when it has no sentence end). */
export function firstSentence(text: string): string {
  const line = oneLine(text);
  const end = /[.!?](?=\s|$)/.exec(line);
  return end ? line.slice(0, end.index + 1) : line;
}

/** Line endings as "\n", no trailing spaces, at most one blank line between paragraphs, trimmed. */
export function normalizePageText(text: string): string {
  return text
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((l) => l.replace(/[ \t]+$/g, ""))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** What the fields hold once tidied: the pitch on one line, the texts normalized. What is saved and what is validated. */
export function normalizePageContent(content: ProjectPageContent): ProjectPageContent {
  return { pitch: oneLine(content.pitch), about: normalizePageText(content.about), forWhom: normalizePageText(content.forWhom), stage: content.stage, showFounders: content.showFounders === true };
}

/** The paragraphs of a plain text: split on blank lines; a single line break stays inside its paragraph. */
export function pageParagraphs(text: string): string[] {
  return normalizePageText(text)
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean);
}

/** What stops a page from being published, by field, in the founder's words. Empty when it can go out. */
export function pageContentProblems(content: ProjectPageContent): PageFieldErrors {
  const c = normalizePageContent(content);
  const errors: PageFieldErrors = {};
  if (!c.pitch) errors.pitch = "Say what it is in one line.";
  else if (c.pitch.length > PAGE_PITCH_MAX) errors.pitch = `Keep the one-line pitch to ${PAGE_PITCH_MAX} characters.`;
  if (!c.about) errors.about = "Say a little about the project.";
  else if (c.about.length > PAGE_ABOUT_MAX) errors.about = `Keep this to ${PAGE_ABOUT_MAX.toLocaleString("en-US")} characters.`;
  if (c.forWhom.length > PAGE_FOR_WHOM_MAX) errors.forWhom = `Keep this to ${PAGE_FOR_WHOM_MAX} characters.`;
  if (!(PAGE_STAGES as readonly string[]).includes(c.stage)) errors.stage = "Pick a stage.";
  return errors;
}

export const isPublishablePage = (content: ProjectPageContent): boolean => Object.keys(pageContentProblems(content)).length === 0;

/** True when two page contents read the same once tidied (the draft against what is published). */
export function samePageContent(a: ProjectPageContent, b: ProjectPageContent): boolean {
  const x = normalizePageContent(a);
  const y = normalizePageContent(b);
  return x.pitch === y.pitch && x.about === y.about && x.forWhom === y.forWhom && x.stage === y.stage && x.showFounders === y.showFounders;
}

/** A stored `draft` or `published` value read defensively (a row written outside the api): null when it is not a page. */
export function readPageContent(value: unknown): ProjectPageContent | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const v = value as Record<string, unknown>;
  if (typeof v.pitch !== "string" || typeof v.about !== "string") return null;
  const stage = (PAGE_STAGES as readonly string[]).includes(v.stage as string) ? (v.stage as PageStage) : "idea";
  return { pitch: v.pitch, about: v.about, forWhom: typeof v.forWhom === "string" ? v.forWhom : "", stage, showFounders: v.showFounders === true };
}

export interface StarterPageInputs {
  businessName: string;
  /** The idea as the founder typed it, when the project keeps it. */
  founderWords?: string | null;
  /** The vision's statement and "for whom", when the project has a vision. */
  visionStatement?: string | null;
  visionForWhom?: string | null;
}

/**
 * The first draft, from what the project already has and nothing else: the pitch is the first sentence of the idea in
 * the founder's own words (else the project's name), `about` is the vision's statement (else the founder's own words,
 * else empty, for the founder to write), "Who it is for" is the vision's, the stage is "idea" and the founders are not
 * named. It is also what the team's draft falls back to when the model cannot write one (package 1.2), before any
 * vision exists, so the founder's words are what the page says.
 */
export function starterPageDraft(input: StarterPageInputs): ProjectPageContent {
  const words = firstSentence(input.founderWords ?? "");
  return {
    pitch: clipText(words || oneLine(input.businessName), PAGE_PITCH_MAX),
    about: clipText(normalizePageText(input.visionStatement ?? "") || normalizePageText(input.founderWords ?? ""), PAGE_ABOUT_MAX),
    forWhom: clipText(normalizePageText(input.visionForWhom ?? ""), PAGE_FOR_WHOM_MAX),
    stage: "idea",
    showFounders: false,
  };
}

/** "Maya", "Maya and Sam", "Maya, Sam and Lee": the people a page names, never a count and never a role. */
export function joinNames(names: readonly string[]): string {
  const list = names.map((n) => n.trim()).filter(Boolean);
  if (list.length <= 1) return list[0] ?? "";
  return `${list.slice(0, -1).join(", ")} and ${list[list.length - 1]}`;
}

/** "Built by Maya and Sam", or null when the page names nobody. */
export function builtByLine(names: readonly string[] | null | undefined): string | null {
  const joined = joinNames(names ?? []);
  return joined ? `Built by ${joined}` : null;
}

/** The browser title and share title: "{name}: {pitch}", cut to about 70 characters at a word. */
export function pageTitle(name: string, pitch: string, max = 70): string {
  const n = oneLine(name);
  const p = oneLine(pitch);
  if (!p || p.toLowerCase() === n.toLowerCase()) return clipText(n, max);
  return clipText(`${n}: ${p}`, max);
}

/** The description for search and share cards: the start of `about` on one line, cut to about 160 characters. */
export function pageDescription(about: string, fallback: string, max = 160): string {
  return clipText(oneLine(about) || oneLine(fallback), max);
}

/**
 * Why a page was held back when the founder pressed Publish (apps/api services/pages.ts): the deterministic checks of
 * the community screen. No model reads a page, so there is no other reason.
 */
export const PAGE_HOLD_REASONS = ["personal_data", "markup"] as const;
export type PageHoldReason = (typeof PAGE_HOLD_REASONS)[number];

/** What the founder reads for each reason. The page stays unpublished and nothing left the product. */
export const PAGE_HOLD_MESSAGES: Readonly<Record<PageHoldReason, string>> = {
  personal_data: "The page has an email address or a phone number in it. A public page is open to everyone, so take it out and publish again.",
  markup: "The page has code or a script link in it. A public page shows plain text only, so take it out and publish again.",
};

/**
 * The Product lead's note once the team has drafted the page (package 1.3): the first thing a new founder is asked.
 * It is a decision note that never holds Continue and is not a sign-off; `key` marks it (`decision.key`), so the api
 * decides it in-process (open the Public page tab, or Later) and Today shows it in Needs you instead of its quiet line.
 */
export const PAGE_READY_NOTE = {
  key: "project_page.ready",
  subject: "Your project's page is ready",
  options: { check: "page_check", later: "page_later" },
  checkLabel: "Check it and publish",
  laterLabel: "Later",
} as const;

export type PageReadyOption = (typeof PAGE_READY_NOTE.options)[keyof typeof PAGE_READY_NOTE.options];

/** Whether a note's decision block is the page note's (its `decision.key`). */
export function isPageReadyDecision(decision: unknown): boolean {
  return !!decision && typeof decision === "object" && (decision as { key?: unknown }).key === PAGE_READY_NOTE.key;
}

/** The console's state line for a page (the dates are already formatted, "Oct 7, 2026"). */
export function pageStateLine(state: { published: boolean; publishedOn?: string | null; changed?: boolean; takenDownOn?: string | null }): string {
  if (state.published) return state.changed ? "Live, with changes not yet published" : `Live since ${state.publishedOn ?? "today"}`;
  return state.takenDownOn ? `Taken down on ${state.takenDownOn}. Not public now.` : "Not published yet";
}
