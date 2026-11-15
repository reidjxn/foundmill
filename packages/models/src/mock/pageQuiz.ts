/**
 * Mock page quiz (migration 0105; packages/agents `page-quiz.ts`): the Product lead's quiz drafted from the same facts
 * the live request carries (`buildPageQuizRequest`) and within the same rules, so the local stack and the Playwright
 * suite exercise the whole path without a key. Deterministic and honest:
 *   - customers are grouped by the first thing they bought; a group is a type only with at least `min_per_type`
 *     customers. With fewer than two such groups, people and organizations are tried instead;
 *   - with fewer than two types, the answer is `too_little_data`;
 *   - names, questions and answers come from the offers' own titles and the kind of contact, never from a reply, and
 *     carry no count, price or claim.
 *
 * Input: `{ project_name, min_per_type, follow_available, offer_refs }` (trusted JSON) and the untrusted blocks
 * `{ offers: [{ ref, title }] }` and `{ customers: [{ ref, kind, bought, replies }] }`.
 */
import type { PageQuizOutput } from "../schemas";
import type { MockContext } from "./inputs";

const text = (v: unknown): string => (typeof v === "string" ? v.replace(/\s+/g, " ").trim() : "");
const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const clip = (s: string, max: number): string => (s.length <= max ? s : `${s.slice(0, max - 1).trimEnd()}…`);

/** The quiz request: the schema asks for `outcome` and `questions`. */
export function isPageQuizRequest(ctx: MockContext): boolean {
  return ctx.schemaKeys.includes("outcome") && ctx.schemaKeys.includes("questions") && ctx.schemaKeys.includes("types");
}

interface Customer {
  ref: string;
  kind: "person" | "organization";
  bought: string[];
}

interface Group {
  name: string;
  summary: string;
  refs: string[];
  offer: string;
  answer: string;
}

export function generatePageQuiz(ctx: MockContext): PageQuizOutput {
  const min = Math.max(1, ctx.getNumber("min_per_type") ?? 2);
  const follow = ctx.getBoolean("follow_available") === true;
  const offers = ctx.getArray<unknown>("offers").filter(isRecord).map((o) => ({ ref: text(o.ref), title: text(o.title) })).filter((o) => o.ref && o.title);
  const titleOf = new Map(offers.map((o) => [o.ref, o.title]));
  const customers: Customer[] = ctx
    .getArray<unknown>("customers")
    .filter(isRecord)
    .map((c) => ({ ref: text(c.ref), kind: c.kind === "organization" ? ("organization" as const) : ("person" as const), bought: Array.isArray(c.bought) ? c.bought.map(text).filter((r) => titleOf.has(r)) : [] }))
    .filter((c) => c.ref);
  const none = (reason: string): PageQuizOutput => ({ outcome: "too_little_data", reason, types: [], questions: [] });
  if (customers.length === 0) return none("There are no customers on record to draw types from.");

  // 1. By what they bought.
  const byOffer = new Map<string, string[]>();
  for (const c of customers) {
    const first = c.bought[0];
    if (first) byOffer.set(first, [...(byOffer.get(first) ?? []), c.ref]);
  }
  let groups: Group[] = [...byOffer.entries()]
    .filter(([, refs]) => refs.length >= min)
    .sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0]))
    .slice(0, 4)
    .map(([ref, refs]) => {
      const title = titleOf.get(ref)!;
      return { name: clip(`Customers who chose ${title}`, 60), summary: clip(`They bought ${title}.`, 200), refs, offer: ref, answer: clip(title, 80) };
    });
  let question = "Which of these is closest to what you want?";

  // 2. Else by the kind of contact, each pointed to what that kind bought most, or the Follow form.
  if (groups.length < 2) {
    const fallbackOffer = (refs: string[]): string | null => {
      const counts = new Map<string, number>();
      for (const c of customers) if (refs.includes(c.ref)) for (const b of c.bought) counts.set(b, (counts.get(b) ?? 0) + 1);
      const best = [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]?.[0];
      return best ?? (follow ? "follow" : null);
    };
    const people = customers.filter((c) => c.kind === "person").map((c) => c.ref);
    const orgs = customers.filter((c) => c.kind === "organization").map((c) => c.ref);
    const kinds: Group[] = [];
    if (people.length >= min) {
      const offer = fallbackOffer(people);
      if (offer) kinds.push({ name: "Individual customers", summary: "Customers who are people rather than organizations.", refs: people, offer, answer: "Me" });
    }
    if (orgs.length >= min) {
      const offer = fallbackOffer(orgs);
      if (offer) kinds.push({ name: "Organizations", summary: "Customers who are businesses or other organizations.", refs: orgs, offer, answer: "An organization" });
    }
    if (kinds.length >= 2) {
      groups = kinds;
      question = "Who would it be for?";
    }
  }
  if (groups.length < 2) return none(`The ${customers.length} customers on record do not fall into two or more groups of at least ${min}.`);

  return {
    outcome: "draft",
    reason: groups.every((g) => g.answer !== "Me" && g.answer !== "An organization") ? "Drawn from what customers bought." : "Drawn from whether customers are people or organizations.",
    types: groups.map((g) => ({ name: g.name, summary: g.summary, customer_refs: g.refs, offer_ref: g.offer })),
    questions: [
      { text: question, answers: groups.map((g, i) => ({ text: g.answer, type_index: i })) },
      { text: "Which sounds more like you?", answers: groups.map((g, i) => ({ text: clip(g.name, 80), type_index: i })) },
    ],
  };
}
