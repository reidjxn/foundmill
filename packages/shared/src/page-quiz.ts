/**
 * The "which one is for you" quiz on a project's public page (migration 0105 `page_quizzes`). Optional and off until
 * the founder turns it on. A visitor answers 2 to 4 short questions and sees which of the project's offers probably fits
 * them, with the page's own Follow form or the founder's own pay link; every offer stays in view the whole time.
 *
 * Honest by construction (the hims quiz is the cautionary tale):
 *   - the types come from the project's real customers: the team drafts them only from Customers rows, their replies
 *     and their purchases, each type resting on at least `PAGE_QUIZ_MIN_PER_TYPE` real customers, and refuses with too
 *     little data (`PAGE_QUIZ_MIN_CUSTOMERS`); the founder approves every word before anything is public;
 *   - no pressure: no urgency, scarcity or crowd words (`pageQuizPressure`), no count of other visitors, no timer;
 *   - answers are kept only as an anonymous count per result type, for the founder, never shown on the page.
 *
 * Pure, no Zod: browser code imports this from "@foundmill/shared/page-quiz".
 */
import { normalizePageText } from "./project-page";

export const PAGE_QUIZ_STATUSES = ["draft", "approved", "live"] as const;
export type PageQuizStatus = (typeof PAGE_QUIZ_STATUSES)[number];

export const PAGE_QUIZ_LIMITS = {
  types: { min: 2, max: 4 },
  questions: { min: 2, max: 4 },
  answers: { min: 2, max: 4 },
  offers: { min: 1, max: 4 },
  introMax: 200,
  nameMax: 60,
  summaryMax: 200,
  questionMax: 120,
  answerMax: 80,
  offerTitleMax: 80,
  offerDetailMax: 200,
  linkLabelMax: 40,
  urlMax: 500,
} as const;

/** The team drafts a quiz only from at least this many real customers on record. */
export const PAGE_QUIZ_MIN_CUSTOMERS = 6;
/** Every type rests on at least this many of them. */
export const PAGE_QUIZ_MIN_PER_TYPE = 2;

export const PAGE_QUIZ_TYPE_KEYS = ["t1", "t2", "t3", "t4"] as const;
export const PAGE_QUIZ_OFFER_KEYS = ["o1", "o2", "o3", "o4"] as const;
export const PAGE_QUIZ_QUESTION_KEYS = ["q1", "q2", "q3", "q4"] as const;
export const PAGE_QUIZ_ANSWER_KEYS = ["a1", "a2", "a3", "a4"] as const;

/** What the offer's button does: the page's own Follow form, or the founder's own link (a pay link they already have). */
export type PageQuizOfferAction = { kind: "follow" } | { kind: "link"; url: string; label: string };

export interface PageQuizOffer {
  key: string;
  /** What it is, in the project's own words (a thing customers bought, or following the project). */
  title: string;
  /** One or two plain lines; may be empty. */
  detail: string;
  action: PageQuizOfferAction;
}

export interface PageQuizType {
  key: string;
  /** A short name for this kind of customer ("Cafe owners who order every week"). */
  name: string;
  /** What they have in common, from the records. */
  summary: string;
  /** The offer that fits them (`PageQuizOffer.key`). */
  offer: string;
}

export interface PageQuizAnswer {
  key: string;
  text: string;
  /** The type this answer points to (`PageQuizType.key`). */
  type: string;
}

export interface PageQuizQuestion {
  key: string;
  text: string;
  answers: PageQuizAnswer[];
}

/** Everything the public page shows. Plain text only; nothing is read as markdown or HTML. */
export interface PageQuizDefinition {
  /** One optional line above the questions. */
  intro: string;
  types: PageQuizType[];
  offers: PageQuizOffer[];
  questions: PageQuizQuestion[];
}

/**
 * What the team's draft rested on: real counts of the project's own records, kept for the founder only and never
 * public. `perType` is how many customers each type was drawn from.
 */
export interface PageQuizEvidence {
  customers: number;
  replies: number;
  purchases: number;
  perType: Record<string, number>;
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const str = (v: unknown): string | null => (typeof v === "string" ? v : null);
const oneLine = (s: string): string => s.replace(/\s+/g, " ").trim();
const block = (s: string): string => normalizePageText(s);

function readAction(v: unknown): PageQuizOfferAction | null {
  if (!isRecord(v)) return null;
  if (v.kind === "follow") return { kind: "follow" };
  if (v.kind === "link") {
    const url = str(v.url);
    const label = str(v.label);
    if (url === null || label === null) return null;
    return { kind: "link", url: url.trim(), label: oneLine(label) };
  }
  return null;
}

/**
 * A stored or sent definition read defensively, its texts tidied (one line for names, questions, answers and titles).
 * Null when the shape is wrong; the limits and the links are `pageQuizProblems`' to judge.
 */
export function readPageQuiz(value: unknown): PageQuizDefinition | null {
  if (!isRecord(value)) return null;
  const { types, offers, questions } = value;
  if (!Array.isArray(types) || !Array.isArray(offers) || !Array.isArray(questions)) return null;
  if (types.length > 8 || offers.length > 8 || questions.length > 8) return null;
  const outTypes: PageQuizType[] = [];
  for (const t of types) {
    if (!isRecord(t)) return null;
    const key = str(t.key), name = str(t.name), summary = str(t.summary), offer = str(t.offer);
    if (key === null || name === null || summary === null || offer === null) return null;
    outTypes.push({ key, name: oneLine(name), summary: block(summary), offer });
  }
  const outOffers: PageQuizOffer[] = [];
  for (const o of offers) {
    if (!isRecord(o)) return null;
    const key = str(o.key), title = str(o.title), detail = str(o.detail) ?? "";
    const action = readAction(o.action);
    if (key === null || title === null || action === null) return null;
    outOffers.push({ key, title: oneLine(title), detail: block(detail), action });
  }
  const outQuestions: PageQuizQuestion[] = [];
  for (const q of questions) {
    if (!isRecord(q) || !Array.isArray(q.answers) || q.answers.length > 8) return null;
    const key = str(q.key), text = str(q.text);
    if (key === null || text === null) return null;
    const answers: PageQuizAnswer[] = [];
    for (const a of q.answers) {
      if (!isRecord(a)) return null;
      const ak = str(a.key), at = str(a.text), type = str(a.type);
      if (ak === null || at === null || type === null) return null;
      answers.push({ key: ak, text: oneLine(at), type });
    }
    outQuestions.push({ key, text: oneLine(text), answers });
  }
  return { intro: oneLine(str(value.intro) ?? ""), types: outTypes, offers: outOffers, questions: outQuestions };
}

/**
 * Words that push rather than inform: urgency, scarcity, a crowd, a promise. A quiz that sorts people into offers is
 * where these do harm (the FTC's case against a telehealth quiz), so neither the team nor the founder can put one on the
 * page. Returns the first phrase found, or null.
 */
const PRESSURE_RE =
  /\b(?:hurry|act (?:now|fast)|limited[- ]time|(?:only|just) (?:\w+ )?(?:left|remaining)|spots? (?:left|remaining)|last chance|don'?t miss|before it'?s gone|ends (?:today|tonight|soon)|today only|selling (?:fast|out)|almost gone|while (?:stocks|supplies) last|people like you|everyone (?:is|else)|most popular|best[- ]?sell(?:er|ing)|thousands of|hundreds of|guarantee[ds]?|risk[- ]free|you need this|don'?t wait|countdown)\b/i;

export function pageQuizPressure(text: string): string | null {
  const m = PRESSURE_RE.exec(text);
  return m ? m[0] : null;
}

/** A link a visitor may be sent to: https, no user name or password in it, a real host. Null when it is fine. */
export function pageQuizLinkProblem(url: string): string | null {
  const value = url.trim();
  if (!value) return "Add the link, starting with https://.";
  if (value.length > PAGE_QUIZ_LIMITS.urlMax) return `Keep the link to ${PAGE_QUIZ_LIMITS.urlMax} characters.`;
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    return "That does not look like a link. It should start with https://.";
  }
  if (parsed.protocol !== "https:") return "Use a link that starts with https://.";
  if (parsed.username || parsed.password) return "Use a link without a user name or password in it.";
  if (!parsed.hostname.includes(".") || parsed.hostname.endsWith(".")) return "Use the full link, with the site's address.";
  return null;
}

/** One problem with a definition: where it is (for the editor) and one plain sentence. */
export interface PageQuizProblem {
  path: string;
  message: string;
}

const tooLong = (what: string, max: number) => `Keep ${what} to ${max.toLocaleString("en-US")} characters.`;

/**
 * Everything that keeps a definition from being approved, in reading order; empty when it may go out. `followForm`:
 * whether the page carries its Follow form (an offer that points to it needs it).
 */
export function pageQuizProblems(def: PageQuizDefinition, opts: { followForm: boolean }): PageQuizProblem[] {
  const L = PAGE_QUIZ_LIMITS;
  const out: PageQuizProblem[] = [];
  const add = (path: string, message: string) => out.push({ path, message });
  const words = (path: string, text: string) => {
    const p = pageQuizPressure(text);
    if (p) add(path, `Take out "${p}". The quiz informs; it never hurries or crowds anyone.`);
  };

  if (def.intro.length > L.introMax) add("intro", tooLong("the opening line", L.introMax));
  words("intro", def.intro);

  if (def.types.length < L.types.min || def.types.length > L.types.max) add("types", `A quiz has ${L.types.min} to ${L.types.max} types of customer.`);
  if (def.offers.length < L.offers.min || def.offers.length > L.offers.max) add("offers", `A quiz has ${L.offers.min} to ${L.offers.max} offers.`);
  if (def.questions.length < L.questions.min || def.questions.length > L.questions.max) add("questions", `A quiz has ${L.questions.min} to ${L.questions.max} questions.`);

  const typeKeys = new Set<string>();
  const offerKeys = new Set(def.offers.map((o) => o.key));
  def.offers.forEach((o, i) => {
    const path = `offers.${i}`;
    if (!(PAGE_QUIZ_OFFER_KEYS as readonly string[]).includes(o.key) || def.offers.findIndex((x) => x.key === o.key) !== i) add(path, "Each offer needs its own key.");
    if (!o.title) add(`${path}.title`, "Name the offer.");
    else if (o.title.length > L.offerTitleMax) add(`${path}.title`, tooLong("the offer's name", L.offerTitleMax));
    if (o.detail.length > L.offerDetailMax) add(`${path}.detail`, tooLong("the offer's details", L.offerDetailMax));
    words(`${path}.title`, o.title);
    words(`${path}.detail`, o.detail);
    if (o.action.kind === "follow" && !opts.followForm) add(`${path}.action`, "Your page has no Follow form. Turn it on in the page above, or give this offer a link.");
    if (o.action.kind === "link") {
      const problem = pageQuizLinkProblem(o.action.url);
      if (problem) add(`${path}.action`, problem);
      if (!o.action.label) add(`${path}.action`, "Give the link's button a few words, such as “Order”.");
      else if (o.action.label.length > L.linkLabelMax) add(`${path}.action`, tooLong("the button's words", L.linkLabelMax));
      words(`${path}.action`, o.action.label);
    }
  });

  def.types.forEach((t, i) => {
    const path = `types.${i}`;
    if (!(PAGE_QUIZ_TYPE_KEYS as readonly string[]).includes(t.key) || typeKeys.has(t.key)) add(path, "Each type needs its own key.");
    typeKeys.add(t.key);
    if (!t.name) add(`${path}.name`, "Name this type.");
    else if (t.name.length > L.nameMax) add(`${path}.name`, tooLong("the type's name", L.nameMax));
    if (t.summary.length > L.summaryMax) add(`${path}.summary`, tooLong("what they have in common", L.summaryMax));
    words(`${path}.name`, t.name);
    words(`${path}.summary`, t.summary);
    if (!offerKeys.has(t.offer)) add(`${path}.offer`, "Choose the offer that fits this type.");
  });

  const reached = new Set<string>();
  def.questions.forEach((q, i) => {
    const path = `questions.${i}`;
    if (!(PAGE_QUIZ_QUESTION_KEYS as readonly string[]).includes(q.key) || def.questions.findIndex((x) => x.key === q.key) !== i) add(path, "Each question needs its own key.");
    if (!q.text) add(`${path}.text`, "Write the question.");
    else if (q.text.length > L.questionMax) add(`${path}.text`, tooLong("the question", L.questionMax));
    words(`${path}.text`, q.text);
    if (q.answers.length < L.answers.min || q.answers.length > L.answers.max) add(`${path}.answers`, `Each question has ${L.answers.min} to ${L.answers.max} answers.`);
    q.answers.forEach((a, j) => {
      const apath = `${path}.answers.${j}`;
      if (!(PAGE_QUIZ_ANSWER_KEYS as readonly string[]).includes(a.key) || q.answers.findIndex((x) => x.key === a.key) !== j) add(apath, "Each answer needs its own key.");
      if (!a.text) add(`${apath}.text`, "Write the answer.");
      else if (a.text.length > L.answerMax) add(`${apath}.text`, tooLong("the answer", L.answerMax));
      words(`${apath}.text`, a.text);
      if (!typeKeys.has(a.type)) add(`${apath}.type`, "Choose the type this answer points to.");
      else reached.add(a.type);
    });
    if (new Set(q.answers.map((a) => a.type)).size < 2) add(`${path}.answers`, "Point this question's answers to at least two different types, or it tells nobody apart.");
  });
  def.types.forEach((t, i) => {
    if (typeKeys.has(t.key) && !reached.has(t.key)) add(`types.${i}`, `No answer leads to “${t.name || "this type"}”. Point at least one answer to it, or remove it.`);
  });
  return out;
}

/**
 * The type a visitor's answers point to, or null until every question is answered with one of its own answers. Each
 * answer counts one for its type; a tie goes to the type listed first, so the same answers always give the same result.
 */
export function scorePageQuiz(def: PageQuizDefinition, answers: Readonly<Record<string, string>>): string | null {
  const tally = new Map<string, number>();
  for (const q of def.questions) {
    const chosen = q.answers.find((a) => a.key === answers[q.key]);
    if (!chosen) return null;
    tally.set(chosen.type, (tally.get(chosen.type) ?? 0) + 1);
  }
  let best: string | null = null;
  let bestCount = 0;
  for (const t of def.types) {
    const n = tally.get(t.key) ?? 0;
    if (n > bestCount) {
      best = t.key;
      bestCount = n;
    }
  }
  return best;
}

/** Two definitions that would show the same quiz. */
export function samePageQuiz(a: PageQuizDefinition, b: PageQuizDefinition): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/** Takes a type out with every answer that points to it. Never below the minimum. */
export function removePageQuizType(def: PageQuizDefinition, key: string): PageQuizDefinition {
  if (def.types.length <= PAGE_QUIZ_LIMITS.types.min) return def;
  return { ...def, types: def.types.filter((t) => t.key !== key), questions: def.questions.map((q) => ({ ...q, answers: q.answers.filter((a) => a.type !== key) })) };
}

/** The words a visitor reads. */
export const PAGE_QUIZ_WORDS = {
  heading: "Which one is for you?",
  intro: "A few quick questions. Your answer shows which option probably fits you. You can see every option below either way.",
  submit: "See which one fits",
  result: "This one is probably for you",
  again: "Start again",
  allOffers: "Every option",
  follow: "Follow",
  privacy: "Only the result is counted, never who you are or what else you chose.",
  unanswered: "Answer every question to see which one fits.",
  changed: "This quiz changed a moment ago. Start again to see the new questions.",
  busy: "The quiz is busy right now. Try again in a minute.",
  previewNote: "Preview: answers are not sent.",
} as const;

/** The founder's line for where the quiz stands. */
export function pageQuizStatusLine(state: { status: PageQuizStatus | null; pageLive: boolean }): string {
  if (state.status === null) return "No quiz yet";
  if (state.status === "draft") return "Draft, not public";
  if (state.status === "approved") return "Approved, turned off";
  return state.pageLive ? "On your page" : "Turned on, shows once your page is live";
}

/** "Rests on 3 of your customers": a real count of the founder's own records, shown to them alone. */
export function pageQuizBasisLine(n: number): string {
  return n === 1 ? "Rests on 1 of your customers" : `Rests on ${n.toLocaleString("en-US")} of your customers`;
}

/** What the team's draft was drawn from, in one line (real counts). */
export function pageQuizEvidenceLine(e: Pick<PageQuizEvidence, "customers" | "replies" | "purchases">): string {
  const n = (v: number, one: string, many: string) => `${v.toLocaleString("en-US")} ${v === 1 ? one : many}`;
  return `Drafted from ${n(e.customers, "customer", "customers")}, ${n(e.replies, "reply", "replies")} and ${n(e.purchases, "purchase", "purchases")} on record.`;
}

/** Why there is no draft yet, before the team is asked: too few customers on record. */
export function pageQuizNotReadyLine(customers: number, need = PAGE_QUIZ_MIN_CUSTOMERS): string {
  const have = customers === 1 ? "1 customer" : `${customers.toLocaleString("en-US")} customers`;
  return `You have ${have} on record. The team drafts a quiz from at least ${need} real customers, so every type in it rests on real people.`;
}

/** The count line beside each type: visitors who finished the quiz with this result, counted without names. */
export function pageQuizCountLine(n: number): string {
  return n === 1 ? "1 visitor got this result" : `${n.toLocaleString("en-US")} visitors got this result`;
}
