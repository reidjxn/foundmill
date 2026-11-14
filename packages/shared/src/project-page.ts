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
  /**
   * Whether the page carries the "Follow" form (package 1.6): a visitor leaves an email address, agrees to hear from the
   * project, and becomes a contact in Customers. On for every new page. A copy stored before the switch existed has no
   * such field: a published copy then reads as off (the live page keeps what it showed) and a draft reads as on, so the
   * form goes out the next time the founder publishes (`readPageContent`).
   */
  followForm: boolean;
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
  return { pitch: oneLine(content.pitch), about: normalizePageText(content.about), forWhom: normalizePageText(content.forWhom), stage: content.stage, showFounders: content.showFounders === true, followForm: content.followForm !== false };
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
  return x.pitch === y.pitch && x.about === y.about && x.forWhom === y.forWhom && x.stage === y.stage && x.showFounders === y.showFounders && x.followForm === y.followForm;
}

/**
 * A stored `draft` or `published` value read defensively (a row written outside the api): null when it is not a page.
 * `absentFollowForm` is what a value stored before the follow form existed reads as: false for a published copy (the
 * default: the live page keeps what it showed until the founder publishes again), true for a draft (a page being
 * written gets the form, like every new page).
 */
export function readPageContent(value: unknown, absentFollowForm = false): ProjectPageContent | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const v = value as Record<string, unknown>;
  if (typeof v.pitch !== "string" || typeof v.about !== "string") return null;
  const stage = (PAGE_STAGES as readonly string[]).includes(v.stage as string) ? (v.stage as PageStage) : "idea";
  const followForm = typeof v.followForm === "boolean" ? v.followForm : absentFollowForm;
  return { pitch: v.pitch, about: v.about, forWhom: typeof v.forWhom === "string" ? v.forWhom : "", stage, showFounders: v.showFounders === true, followForm };
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
 * else empty, for the founder to write), "Who it is for" is the vision's, the stage is "idea", the founders are not
 * named and the follow form is on. It is also what the team's draft falls back to when the model cannot write one (package 1.2), before any
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
    followForm: true,
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

/*
 * Following a project (package 1.6): the form on a public page where a visitor leaves an email address and agrees to
 * hear from the project. It is double opt-in: a signup is a consent record that waits for the person to confirm from
 * the one email the platform sends them (`FOLLOW_CONFIRM_EMAIL`), and only a confirmed follower counts, shows "Agreed to
 * email on …" and is a real outcome. The answer never says whether the address was already on the list.
 */

/** The CRM source a follower is recorded with; Customers shows it as `FOLLOW_SOURCE_LABEL`. */
export const FOLLOW_SOURCE = "page";
export const FOLLOW_SOURCE_LABEL = "Public page";
/** What a follower agreed to (the consent record's purpose). */
export const FOLLOW_CONSENT_PURPOSE = "email";
/** Longest address the form takes: the CRM's name limit (a follower's address is its identifier and, masked, its name). */
export const FOLLOW_EMAIL_MAX = 200;
/**
 * The mark a free project's visitors meet (docs/NETWORK.md F2; founder, 2026-11-12): small and unobtrusive, placed on
 * the visitor's path (the page's foot, the line after a follow, the foot of the confirmation email and page, a corner
 * of the share image) and kept off the founder's. `appName` is APP_NAME. A paid plan shows none of it
 * (`tierShowsBuiltOnMark` in @foundmill/config).
 */
export function builtOnWords(appName: string) {
  return {
    /** The mark itself: "Built on Foundmill". */
    mark: `Built on ${appName}`,
    /** Under "Check your email to confirm", for the visitor who just followed. */
    afterFollow: (name: string) => `${oneLine(name)} is built on ${appName}.`,
    /** The link after that sentence. */
    afterFollowLink: "Start your own",
    /** The same link once the project shows a story (`/p/<slug>/story`): it goes there instead (docs/NETWORK.md F2). */
    afterFollowStoryLink: "See how it was made",
    /** The foot of the confirmation email and of the page its link opens. */
    foot: (name: string) => `${oneLine(name)} is built on ${appName}.`,
    /** Beside the console's preview, for the founders of a project on the free plan. */
    previewNote: "The small line at the foot is removed on a paid plan.",
  } as const;
}

/** How long the link in the confirmation email works. */
export const FOLLOW_CONFIRM_TTL_MS = 7 * 24 * 60 * 60_000;

/** The exact sentence a follower agrees to; the consent record stores it as the visitor read it. */
export function followConsentText(name: string): string {
  return `I agree to get email from ${oneLine(name)} about this project. I can unsubscribe at any time.`;
}

/** The words of the form, around the project's name. */
export function followWords(name: string) {
  const n = oneLine(name);
  return {
    heading: `Follow ${n}`,
    line: `Leave your email and ${n} will let you know when there is news.`,
    emailLabel: "Your email",
    consent: followConsentText(n),
    button: "Follow",
    done: `Check your email to confirm. ${n} will only write to you after you do.`,
    /** The label of the hidden field people never see (programs that fill in every field fill it in). */
    trap: "Leave this empty",
    /**
     * The bot check's disclosure under the button, on every plan (a legal disclosure, not the "Built on" mark): the
     * line, then "(privacy)" linking Cloudflare's Turnstile Privacy Addendum (`TURNSTILE_PRIVACY_URL`).
     */
    botCheck: "Protected by Cloudflare Turnstile",
    botCheckLink: "privacy",
    botCheckLinkLabel: "Cloudflare Turnstile privacy policy (opens in a new tab)",
  } as const;
}

/** Cloudflare's Turnstile Privacy Addendum, which a site using Turnstile in Invisible mode must link. */
export const TURNSTILE_PRIVACY_URL = "https://www.cloudflare.com/turnstile-privacy-policy/";

/** Why a signup did not go through, in the visitor's words. */
export const FOLLOW_ERRORS = {
  email: "Enter your email address, like name@example.com.",
  consent: "Tick the box to agree to get email about this project.",
  busy: "A lot of people are signing up right now. Try again in a few minutes.",
  closed: "This project is not taking new followers right now.",
  failed: "That did not go through, so you are not following yet. Try again in a moment.",
  /** The bot check (Turnstile) did not pass, or could not run in this browser (no JavaScript). */
  unverified: "We could not check this browser, so you are not following yet. Reload the page and try again.",
  /** The bot check could not be reached: nothing is recorded or sent until it can be. */
  unavailable: "Following is paused for a moment, so you are not following yet. Try again in a few minutes.",
} as const;
/** The action the page's Turnstile widget runs with; the gateway checks Cloudflare reports the same. */
export const FOLLOW_TURNSTILE_ACTION = "page_follow";
export type FollowErrorKind = keyof typeof FOLLOW_ERRORS;

const EMAIL_SHAPE = /^[^\s@<>()[\]\\,;:"]+@[^\s@<>()[\]\\,;:"]+\.[^\s@<>()[\]\\,;:"]{2,}$/;

/** Why an address cannot be used, or null when it can: trimmed, 6 to `FOLLOW_EMAIL_MAX` (200) characters, one @ with a dot after it. */
export function followEmailProblem(email: string): string | null {
  const e = email.trim();
  if (e.length < 6 || e.length > FOLLOW_EMAIL_MAX || !EMAIL_SHAPE.test(e)) return FOLLOW_ERRORS.email;
  return null;
}

/** The Public page tab's line once someone follows: "1 person follows this project", or null for none. */
export function followerCountLine(count: number): string | null {
  if (!Number.isFinite(count) || count <= 0) return null;
  return count === 1 ? "1 person follows this project" : `${count.toLocaleString("en-US")} people follow this project`;
}

/** The founder's line on a confirmed follower's record ("Agreed to email on Oct 7, 2026"); the date comes formatted. */
export function followConsentLine(on: string): string {
  return `Agreed to email on ${on}`;
}

/** The founder's line on a follower who signed up and has not confirmed from the email yet. */
export const FOLLOW_PENDING_LINE = "Not confirmed yet";

/**
 * The name a new follower's contact gets: "Follower" and the address masked ("Follower (ma***@example.com)"), so the
 * whole address lives only in the contact's identifier and never in a name that agents and screens repeat. At most 200
 * characters (the CRM's name limit).
 */
export function followerDisplayName(email: string): string {
  const e = email.trim().toLowerCase();
  const at = e.lastIndexOf("@");
  if (at <= 0) return "Follower";
  const local = e.slice(0, at);
  const shown = local.length <= 2 ? local.slice(0, 1) : local.slice(0, 2);
  const name = `Follower (${shown}***@${e.slice(at + 1)})`;
  return name.length <= 200 ? name : `${name.slice(0, 198)}…)`;
}

/**
 * The one email a person gets after they sign up (sent from the project's Foundmill address by the gateway, never by an
 * agent), and the page its link opens (served by ingest at `/mail/confirm`). `appName` is APP_NAME.
 */
export const FOLLOW_CONFIRM_EMAIL = {
  subject: (name: string) => `Confirm that you want to follow ${oneLine(name)}`,
  /** `foot` is the "Built on" line for a project on the free plan (`builtOnWords().foot`): words only, never a second link. */
  text: (name: string, appName: string, link: string, foot?: string | null) => {
    const n = oneLine(name);
    const body = `Someone, hopefully you, asked to follow ${n} on ${appName} with this address. Confirm to get email from ${n} about this project:\n\n${link}\n\nIf it was not you, ignore this email and nothing will happen.`;
    return foot ? `${body}\n\n${oneLine(foot)}` : body;
  },
} as const;

export const FOLLOW_CONFIRM_PAGE = {
  title: "Confirm",
  body: (name: string) => `Follow ${oneLine(name)} and get email from it about this project?`,
  button: "Confirm",
  done: (name: string) => `You're following ${oneLine(name)}. You can unsubscribe from any email it sends.`,
  invalid: "This link is not valid or has expired, so nothing changed.",
} as const;
