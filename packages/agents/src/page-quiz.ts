/**
 * The optional "which one is for you" quiz on a project's public page (migration 0105), drafted by the Product lead
 * from the project's real customers. Drafting is the founder's request; approving and turning it on are their own
 * presses (no agent tool reaches them).
 *
 * Pure, like the rest of this package:
 * - `pageQuizReadiness`: whether there is enough to draft from at all, before any call. Fewer than
 *   `PAGE_QUIZ_MIN_CUSTOMERS` real customers, or nothing to point a visitor to, is a plain refusal with the real count.
 * - `buildPageQuizRequest`: the house rules, the Product lead's instructions and the prompt; the offers and the
 *   customers (opaque refs, what they bought, their own replies) as untrusted data. No name, address or identifier.
 * - `finalisePageQuiz`: the check of the answer. A type must name at least `PAGE_QUIZ_MIN_PER_TYPE` customers from the
 *   input, an offer must be one of the input's, no figure the inputs do not carry may appear, nothing may push, and the
 *   shape must be one a visitor can answer. What the draft rested on (`PageQuizEvidence`) is counted here from the refs,
 *   never taken from the model.
 * - `runPageQuizDraft`: one call, one retry with the reason when the answer is refused for something fixable, then a
 *   definition or a refusal with one plain sentence for the founder.
 */
import { APP_NAME } from "@foundmill/config";
import type { CompleteResult, ModelClient, UsageAttribution } from "@foundmill/models";
import { PageQuizOutput } from "@foundmill/models/schemas";
import {
  PAGE_QUIZ_ANSWER_KEYS,
  PAGE_QUIZ_LIMITS,
  PAGE_QUIZ_MIN_CUSTOMERS,
  PAGE_QUIZ_MIN_PER_TYPE,
  PAGE_QUIZ_OFFER_KEYS,
  PAGE_QUIZ_QUESTION_KEYS,
  PAGE_QUIZ_TYPE_KEYS,
  pageQuizPressure,
  pageQuizProblems,
  type PageQuizDefinition,
  type PageQuizEvidence,
  type PageQuizOffer,
} from "@foundmill/shared";
import { agentPromptFields, buildSystemPrompt, type AgentPromptParts } from "./club-rules";
import { inertJson, plainModelText, untrustedBlock } from "./foundations";
import { pageQuizPrompt } from "./prompts/page-quiz";
import { NO_PERSONAL_TERMS, namePatterns, personalHit, personalHitKind, personalHitLine, redactPersonal, type PersonalHit, type PersonalTerms } from "./page-quiz-personal";
import { getTemplate } from "./registry";
import type { RouteKey } from "./types";

/** The route the draft runs on (packages/models `routing.ts`: Sonnet at low effort, shared with the project page). */
export const PAGE_QUIZ_ROUTE = "projectPage" as const satisfies RouteKey;
/** The usage ledger's `kind` for the quiz's calls: booked to the business like every other model call (an Estimate). */
export const PAGE_QUIZ_USAGE_KIND = "page_quiz";
/** What the limiter books for the call: a few hundred tokens of JSON after a short, low-effort think. */
export const PAGE_QUIZ_RESERVE_TOKENS = 1_600;
export const PAGE_QUIZ_MAX_CALLS = 2;
/** The ref of the page's own Follow form among the offers. */
export const PAGE_QUIZ_FOLLOW_REF = "follow";

/** One customer as the team sees them (packages/db `pageQuizzes.facts`). */
export interface PageQuizCustomerInput {
  ref: string;
  kind: "person" | "organization";
  bought: readonly string[];
  replies: readonly string[];
}

/** Something customers paid for, with how many of them. */
export interface PageQuizOfferInput {
  ref: string;
  title: string;
  buyers: number;
}

export interface PageQuizFacts {
  businessName: string;
  /** The page's published copy (else its draft): what the project says it is, and whether it carries the Follow form. */
  page: { pitch: string; about: string; forWhom: string; followForm: boolean };
  customers: readonly PageQuizCustomerInput[];
  offers: readonly PageQuizOfferInput[];
  totals: { customers: number; replies: number; purchases: number };
  /** The business's Product lead as it is now (its live instructions and skills); the template when absent. */
  agent?: AgentPromptParts;
}

// ---------------------------------------------------------------------------------------------------------------------
// Whether there is enough to draft from
// ---------------------------------------------------------------------------------------------------------------------

export type PageQuizNotReady = "too_few_customers" | "no_offers";

export function pageQuizReadiness(facts: Pick<PageQuizFacts, "customers" | "offers" | "page">): { ready: true } | { ready: false; reason: PageQuizNotReady; customers: number; need: number } {
  const customers = facts.customers.length;
  if (customers < PAGE_QUIZ_MIN_CUSTOMERS) return { ready: false, reason: "too_few_customers", customers, need: PAGE_QUIZ_MIN_CUSTOMERS };
  if (facts.offers.length === 0 && !facts.page.followForm) return { ready: false, reason: "no_offers", customers, need: PAGE_QUIZ_MIN_CUSTOMERS };
  return { ready: true };
}

// ---------------------------------------------------------------------------------------------------------------------
// The request
// ---------------------------------------------------------------------------------------------------------------------

export interface PageQuizRequest {
  route: typeof PAGE_QUIZ_ROUTE;
  system: string[];
  messages: { role: "user"; content: string }[];
  schema: typeof PageQuizOutput;
  reserveTokens: number;
}

/** The offers the team may point a visitor to: the page's Follow form when it has one, then what customers bought. */
export function pageQuizOfferChoices(facts: Pick<PageQuizFacts, "offers" | "page" | "businessName">): PageQuizOfferInput[] {
  const follow = facts.page.followForm ? [{ ref: PAGE_QUIZ_FOLLOW_REF, title: `Follow ${facts.businessName}`, buyers: 0 }] : [];
  return [...follow, ...facts.offers];
}

export function buildPageQuizRequest(facts: PageQuizFacts, retryReason?: string): PageQuizRequest {
  const offers = pageQuizOfferChoices(facts).map((o) => ({ ref: o.ref, title: o.title, customers_who_chose_it: o.ref === PAGE_QUIZ_FOLLOW_REF ? null : o.buyers }));
  const trusted = { project_name: facts.businessName, min_per_type: PAGE_QUIZ_MIN_PER_TYPE, follow_available: facts.page.followForm, offer_refs: offers.map((o) => o.ref) };
  const parts = [
    "```json\n" + inertJson(trusted) + "\n```",
    untrustedBlock("project_page", { project_page: { pitch: facts.page.pitch, about: facts.page.about, for_whom: facts.page.forWhom } }),
    untrustedBlock("offers", { offers }),
    untrustedBlock("customers", { customers: facts.customers.map((c) => ({ ref: c.ref, kind: c.kind, bought: c.bought, replies: c.replies })) }),
  ];
  if (retryReason) parts.push(`Your last answer could not be used: ${retryReason}. Answer again, within the rules.`);
  parts.push("Draft the quiz now, or say there is too little data.");
  return {
    route: PAGE_QUIZ_ROUTE,
    system: [buildSystemPrompt({ businessName: facts.businessName, appName: APP_NAME, ...agentPromptFields(facts.agent, getTemplate("product_lead")) }), pageQuizPrompt.render({ business_name: facts.businessName, min_per_type: PAGE_QUIZ_MIN_PER_TYPE })],
    messages: [{ role: "user", content: parts.join("\n\n") }],
    schema: PageQuizOutput,
    reserveTokens: PAGE_QUIZ_RESERVE_TOKENS,
  };
}

// ---------------------------------------------------------------------------------------------------------------------
// The check of the answer
// ---------------------------------------------------------------------------------------------------------------------

/** Why an answer was not used. `too_little_data` is the team's own honest answer; the rest are broken rules. */
export type PageQuizRefusal = "too_little_data" | "unsupported_type" | "unknown_offer" | "invented_figure" | "pressure" | "markup" | "personal_data" | "limits";

const NUMBER_RE = /\d+(?:[.,]\d+)*/g;
const numbersIn = (text: string): string[] => (text.match(NUMBER_RE) ?? []).map((n) => n.replace(/[.,](?=\d{3}\b)/g, ""));
/** Number words that read as a count of people: the quiz never says how many. */
const COUNT_WORDS = /\b(?:dozens|hundreds|thousands|millions|majority|most of (?:our|my|the) (?:customers|clients|buyers)|percent)\b|%/i;

/** Figures in a draft's words that the project's own words and offers do not carry. */
export function pageQuizInventedFigures(texts: readonly string[], facts: Pick<PageQuizFacts, "businessName" | "page" | "offers">): string[] {
  const known = new Set(numbersIn([facts.businessName, facts.page.pitch, facts.page.about, facts.page.forWhom, ...facts.offers.map((o) => o.title)].join("\n")));
  return [...new Set(numbersIn(texts.join("\n")))].filter((n) => !known.has(n));
}

/** How much of a reply the model reads, and the longest offer title: cut only after redaction. */
export const PAGE_QUIZ_REPLY_MAX = 240;
export const PAGE_QUIZ_OFFER_TITLE_MAX = 80;
const clip = (text: string, max: number) => (text.length <= max ? text : text.slice(0, max).trimEnd());

/**
 * The facts as the model may see them (security reviews, Nov 13, 2026): names, email addresses and phone numbers out of
 * every reply, then cut to `PAGE_QUIZ_REPLY_MAX`; a payment description that names anyone is not offered at all (its
 * title would be public), and the customers who bought it keep their other purchases; the other titles are cut to
 * `PAGE_QUIZ_OFFER_TITLE_MAX`. Redaction always comes before the cut, so a shortened address cannot slip past.
 */
export function redactPageQuizFacts(facts: PageQuizFacts, terms: PersonalTerms = NO_PERSONAL_TERMS): PageQuizFacts {
  const patterns = namePatterns(terms, facts.businessName);
  const dropped = new Set(facts.offers.filter((o) => personalHit(o.title, patterns, terms, facts.businessName) !== null).map((o) => o.ref));
  return {
    ...facts,
    offers: facts.offers.filter((o) => !dropped.has(o.ref)).map((o) => ({ ...o, title: clip(o.title, PAGE_QUIZ_OFFER_TITLE_MAX) })),
    customers: facts.customers.map((c) => ({ ...c, bought: c.bought.filter((r) => !dropped.has(r)), replies: c.replies.map((r) => clip(redactPersonal(r, patterns, terms), PAGE_QUIZ_REPLY_MAX)) })),
  };
}

export type PageQuizFinal = { definition: PageQuizDefinition; evidence: PageQuizEvidence; reason: string } | { refused: PageQuizRefusal; detail: string; hit?: PersonalHit };

/** The model's answer as a definition and what it rested on, or why it cannot be used (see the file's note). */
export function finalisePageQuiz(json: unknown, facts: PageQuizFacts, terms: PersonalTerms = NO_PERSONAL_TERMS): PageQuizFinal {
  const parsed = PageQuizOutput.safeParse(json);
  if (!parsed.success) return { refused: "limits", detail: "the answer did not have the asked shape" };
  const out = parsed.data;
  if (out.outcome === "too_little_data") return { refused: "too_little_data", detail: out.reason };
  const L = PAGE_QUIZ_LIMITS;
  if (out.types.length < L.types.min) return { refused: "too_little_data", detail: out.reason || "fewer than two types" };
  if (out.types.length > L.types.max || out.questions.length < L.questions.min || out.questions.length > L.questions.max) return { refused: "limits", detail: "2 to 4 types and 2 to 4 questions" };

  // Every text a visitor would read, the titles of the offers the types point to included, with where it is (a retry's
  // reason names the place, never the name it found).
  const offerTitles = out.types.map((t) => pageQuizOfferChoices(facts).find((o) => o.ref === t.offer_ref)?.title ?? "");
  const placed: [string, string][] = [
    ...out.types.flatMap((t, i): [string, string][] => [[`the name of type ${i + 1}`, t.name], [`the summary of type ${i + 1}`, t.summary]]),
    ...out.questions.flatMap((q, i): [string, string][] => [[`question ${i + 1}`, q.text], ...q.answers.map((a, j): [string, string] => [`answer ${j + 1} of question ${i + 1}`, a.text])]),
    ...offerTitles.map((title, i): [string, string] => [`the offer type ${i + 1} points to`, title]),
  ];
  const texts = placed.map(([, t]) => t).filter(Boolean);
  const patterns = namePatterns(terms, facts.businessName);
  for (const [where, text] of placed) {
    const hit = text ? personalHit(text, patterns, terms, facts.businessName) : null;
    if (hit) return { refused: "personal_data", detail: `${where} has ${personalHitKind(hit)}; reword it with no names, email addresses or phone numbers`, hit };
  }
  if (texts.some((s) => plainModelText(s) !== s || /https?:|www\.|[<>*`#]|\[\[/.test(s))) return { refused: "markup", detail: "plain text only, no links or markup" };
  const pushed = texts.map((s) => pageQuizPressure(s) ?? (/!/.test(s) ? "!" : null)).find(Boolean);
  if (pushed) return { refused: "pressure", detail: `no pressure words ("${pushed}")` };
  const figures = pageQuizInventedFigures(texts, facts);
  const counted = texts.map((s) => COUNT_WORDS.exec(s)?.[0]).find(Boolean);
  if (figures.length || counted) return { refused: "invented_figure", detail: `no figures or counts the inputs do not carry (${[...figures, counted].filter(Boolean).join(", ")})` };

  const knownCustomers = new Set(facts.customers.map((c) => c.ref));
  const choices = pageQuizOfferChoices(facts);
  const choiceByRef = new Map(choices.map((o) => [o.ref, o]));
  const perType: Record<string, number> = {};
  const usedOffers: string[] = [];
  for (const [i, t] of out.types.entries()) {
    const refs = [...new Set(t.customer_refs)];
    if (refs.some((r) => !knownCustomers.has(r)) || refs.length < PAGE_QUIZ_MIN_PER_TYPE) return { refused: "unsupported_type", detail: `the type "${t.name}" must rest on at least ${PAGE_QUIZ_MIN_PER_TYPE} customers from the input, by their refs` };
    if (!choiceByRef.has(t.offer_ref)) return { refused: "unknown_offer", detail: `the type "${t.name}" points to an offer that is not in the input` };
    perType[PAGE_QUIZ_TYPE_KEYS[i]!] = refs.length;
    if (!usedOffers.includes(t.offer_ref)) usedOffers.push(t.offer_ref);
  }
  if (usedOffers.length > L.offers.max) return { refused: "limits", detail: "at most 4 offers" };

  const offerKey = new Map(usedOffers.map((ref, i) => [ref, PAGE_QUIZ_OFFER_KEYS[i]!]));
  // Every offer's words are the project's own (the Follow form, or a payment's own description). A bought offer gets a
  // link the founder fills in with their own pay link before it can be approved.
  const offers: PageQuizOffer[] = usedOffers.map((ref) => ({
    key: offerKey.get(ref)!,
    title: choiceByRef.get(ref)!.title.slice(0, L.offerTitleMax),
    detail: "",
    action: ref === PAGE_QUIZ_FOLLOW_REF ? { kind: "follow" } : { kind: "link", url: "", label: "Get it" },
  }));
  const definition: PageQuizDefinition = {
    intro: "",
    types: out.types.map((t, i) => ({ key: PAGE_QUIZ_TYPE_KEYS[i]!, name: t.name.replace(/\s+/g, " ").trim(), summary: t.summary.trim(), offer: offerKey.get(t.offer_ref)! })),
    offers,
    questions: out.questions.map((q, i) => ({
      key: PAGE_QUIZ_QUESTION_KEYS[i]!,
      text: q.text.replace(/\s+/g, " ").trim(),
      answers: q.answers.map((a, j) => ({ key: PAGE_QUIZ_ANSWER_KEYS[j]!, text: a.text.replace(/\s+/g, " ").trim(), type: PAGE_QUIZ_TYPE_KEYS[a.type_index] ?? "" })),
    })),
  };
  // The shape a visitor can answer (every type reached, every question telling types apart). An offer's missing pay
  // link is the founder's to add, so it does not refuse the draft.
  const problems = pageQuizProblems(definition, { followForm: facts.page.followForm }).filter((p) => !/^offers\.\d+\.action$/.test(p.path));
  if (problems.length) return { refused: "limits", detail: problems[0]!.message };
  return { definition, evidence: { customers: facts.totals.customers, replies: facts.totals.replies, purchases: facts.totals.purchases, perType }, reason: out.reason };
}

// ---------------------------------------------------------------------------------------------------------------------
// The founder's sentences
// ---------------------------------------------------------------------------------------------------------------------

/** One plain sentence for the founder when there is no draft: the team's honest "too little data", or a broken rule. */
export function pageQuizRefusalMessage(reason: PageQuizRefusal | PageQuizNotReady, facts: Pick<PageQuizFacts, "customers">): string {
  const n = facts.customers.length;
  const have = n === 1 ? "1 customer" : `${n.toLocaleString("en-US")} customers`;
  switch (reason) {
    case "too_few_customers":
      return `You have ${have} on record. The team drafts a quiz from at least ${PAGE_QUIZ_MIN_CUSTOMERS} real customers, so nothing was drafted.`;
    case "no_offers":
      return "There is nothing to point a visitor to yet: no purchases on record and no Follow form on your page. Turn on the Follow form, or record a sale, then ask again.";
    case "personal_data":
      return personalHitLine(null);
    case "too_little_data":
      return `The team read your ${have} and could not tell real types apart yet, so it drafted nothing rather than guess. More purchases and replies on record will help.`;
    default:
      return "The team's draft did not keep to the rules (every type resting on real customers, nothing made up, no pressure), so nothing was saved. Try again in a little while.";
  }
}

// ---------------------------------------------------------------------------------------------------------------------
// One drafting step
// ---------------------------------------------------------------------------------------------------------------------

export type PageQuizDraftResult =
  | { outcome: "drafted"; definition: PageQuizDefinition; evidence: PageQuizEvidence; costMinor: number; calls: number }
  | { outcome: "refused"; reason: PageQuizRefusal | PageQuizNotReady; message: string; costMinor: number; calls: number };

/**
 * Readiness first (no call without enough real customers), then the call, and one retry with the reason when the
 * answer broke a rule. The team's own "too little data" is final: it is never asked to try harder.
 */
export async function runPageQuizDraft(client: ModelClient, input: PageQuizFacts, attribution: UsageAttribution, terms: PersonalTerms = NO_PERSONAL_TERMS): Promise<PageQuizDraftResult> {
  // Names, addresses and phone numbers never reach the model; the terms themselves are never sent.
  const facts = redactPageQuizFacts(input, terms);
  const ready = pageQuizReadiness(facts);
  if (!ready.ready) return { outcome: "refused", reason: ready.reason, message: pageQuizRefusalMessage(ready.reason, facts), costMinor: 0, calls: 0 };
  let costMinor = 0;
  let retry: string | undefined;
  let last: PageQuizRefusal = "limits";
  let lastHit: PersonalHit | null = null;
  for (let call = 1; call <= PAGE_QUIZ_MAX_CALLS; call++) {
    const req = buildPageQuizRequest(facts, retry);
    const result: CompleteResult = await client.complete({ ...req, attribution });
    costMinor += result.cost.costMinorInt;
    const fin = finalisePageQuiz(result.json, facts, terms);
    if ("definition" in fin) return { outcome: "drafted", definition: fin.definition, evidence: fin.evidence, costMinor, calls: call };
    last = fin.refused;
    lastHit = fin.hit ?? null;
    if (fin.refused === "too_little_data") return { outcome: "refused", reason: "too_little_data", message: pageQuizRefusalMessage("too_little_data", facts), costMinor, calls: call };
    retry = fin.detail;
  }
  return { outcome: "refused", reason: last, message: last === "personal_data" ? personalHitLine(lastHit) : pageQuizRefusalMessage(last, facts), costMinor, calls: PAGE_QUIZ_MAX_CALLS };
}
