/**
 * Ideation eval (packages/agents `ideation.ts`; routes `ideationSlate` then `ideation`, Opus, audit P2). The Studio
 * drafts a set as a short slate, then one card per slate item in parallel. A set passes when
 *   1. the slate holds 6–12 concepts with distinct names and distinct angles;
 *   2. every slate item got a card that keeps its name and archetype;
 *   3. every card is tight (pitch at most 50 words, each attribute's evidence at most 30: the prompt asks for 40 and
 *      25), has at least two citations, and a potential no lower than its current stars;
 *   4. no card uses an archetype the founder ruled out (the brief's `forbiddenArchetypes`).
 * It also reports how many card calls read the shared system prefix from the prompt cache (the fan-out's cost and
 * latency rest on it), as a measurement rather than a gate.
 * `runIdeationEval` drives the real requests through a model client (live in `pnpm evals`; the unit suite feeds it the mock).
 */
import { buildIdeationCardRequest, buildIdeationSlateRequest, IDEATION_MAX_CONCEPTS, IDEATION_MIN_CONCEPTS, type IdeationBrief } from "@foundmill/agents";
import { streamStructured, type ConceptCard, type IdeationSlateItem, type ModelClient } from "@foundmill/models";
import type { Archetype } from "@foundmill/shared";

export interface IdeationEvalBrief {
  id: string;
  brief: IdeationBrief;
  /** Archetypes the founder's constraints rule out. */
  forbiddenArchetypes: Archetype[];
}

export const IDEATION_BRIEFS: readonly IdeationEvalBrief[] = [
  {
    id: "freelance_bookkeeping",
    brief: {
      prompt: "bookkeeping for freelancers in the EU",
      archetypeHint: "b2b_saas",
      founder: { experience: "operator", skills: { engineering: 14, sales: 8, design: 9, finance: 15, domain: 13 }, time_commitment: "Full time", budget_minor: 2_500_000, citizenship: "SE", residence: "SE", target_markets: ["EU"], constraints: ["bootstrapped", "no cold calling"], risk_appetite: "medium" },
    },
    forbiddenArchetypes: [],
  },
  {
    id: "surprise_no_inventory",
    brief: {
      prompt: "surprise me within my constraints",
      archetypeHint: null,
      founder: { experience: "first_time", skills: { engineering: 6, sales: 13, design: 12, finance: 8, domain: 11 }, time_commitment: "Evenings and weekends", budget_minor: 300_000, citizenship: "DE", residence: "DE", target_markets: ["Germany", "Austria"], constraints: ["no physical products or inventory", "no hardware"], risk_appetite: "low" },
    },
    forbiddenArchetypes: ["dtc_physical", "hardware"],
  },
  {
    id: "no_profile",
    brief: { prompt: "tools for independent physiotherapy clinics", archetypeHint: null, founder: null },
    forbiddenArchetypes: [],
  },
];

export type IdeationProblemKind = "slate" | "card" | "constraint";

export interface IdeationProblem {
  kind: IdeationProblemKind;
  message: string;
}

export interface IdeationSetCheck {
  passed: boolean;
  slateSize: number;
  cards: number;
  problems: IdeationProblem[];
}

const words = (s: string) => s.trim().split(/\s+/).filter(Boolean).length;
const norm = (s: string) => s.trim().toLowerCase();

/** The checks above, on a slate and the cards drafted from it (cards by slate position; undefined = no card). */
export function checkIdeationSet(slate: readonly IdeationSlateItem[], cards: readonly (ConceptCard | undefined)[], forbidden: readonly Archetype[] = []): IdeationSetCheck {
  const problems: IdeationProblem[] = [];
  const add = (kind: IdeationProblemKind, message: string) => problems.push({ kind, message });
  if (slate.length < IDEATION_MIN_CONCEPTS || slate.length > IDEATION_MAX_CONCEPTS) add("slate", `slate has ${slate.length} concepts (want ${IDEATION_MIN_CONCEPTS}-${IDEATION_MAX_CONCEPTS})`);
  const names = slate.map((s) => norm(s.name));
  if (new Set(names).size !== names.length) add("slate", "two slate items share a name");
  const angles = slate.map((s) => norm(s.angle));
  if (new Set(angles).size !== angles.length) add("slate", "two slate items share an angle");
  slate.forEach((item, i) => {
    const card = cards[i];
    if (!card) return add("card", `no card for "${item.name}"`);
    if (norm(card.name) !== norm(item.name)) add("card", `card ${i} is named "${card.name}", slate said "${item.name}"`);
    if (card.archetype !== item.archetype) add("card", `card ${i} changed archetype ${item.archetype} → ${card.archetype}`);
    if (words(card.pitch) > 50) add("card", `card ${i} pitch runs ${words(card.pitch)} words`);
    const long = card.attributes.filter((a) => words(a.evidence) > 30).map((a) => a.key);
    if (long.length) add("card", `card ${i} evidence too long: ${long.join(", ")}`);
    if (card.citations.length < 2) add("card", `card ${i} has ${card.citations.length} citations`);
    if (card.stars_potential < card.stars_current) add("card", `card ${i} potential below current`);
    if (forbidden.includes(card.archetype)) add("constraint", `card ${i} ("${card.name}") is ${card.archetype}, which the founder ruled out`);
  });
  for (const item of slate) if (forbidden.includes(item.archetype)) add("constraint", `slate item "${item.name}" is ${item.archetype}, which the founder ruled out`);
  return { passed: problems.length === 0, slateSize: slate.length, cards: cards.filter(Boolean).length, problems };
}

export interface IdeationEvalResult {
  briefId: string;
  check: IdeationSetCheck;
  costMinor: number;
  /** Card calls that read the shared system prefix from the prompt cache, of all card calls. */
  cacheReads: number;
  cardCalls: number;
  /** Wall time of the whole set and until the first card, in ms (live: the founder's wait). */
  totalMs: number;
  firstCardMs: number | null;
  error?: string;
}

/** Drafts one set the way the api does (slate streamed, cards started as their slate items arrive) and checks it. */
export async function runIdeationEval(entry: IdeationEvalBrief, client: ModelClient): Promise<IdeationEvalResult> {
  const started = Date.now();
  const scope = `eval:ideation:${entry.id}`;
  let cost = 0;
  let cacheReads = 0;
  let firstCardMs: number | null = null;
  const cards: (ConceptCard | undefined)[] = [];
  const pending: Promise<void>[] = [];
  const draftCard = async (index: number, item: IdeationSlateItem) => {
    const res = await client.complete({ ...buildIdeationCardRequest(entry.brief, item), scope });
    cost += res.cost.costMinor;
    if (res.usage.cacheReadInputTokens > 0) cacheReads++;
    firstCardMs ??= Date.now() - started;
    cards[index] = res.json;
  };
  try {
    const slate = await streamStructured(client, {
      ...buildIdeationSlateRequest(entry.brief),
      scope,
      onElement: ({ index, value }) => void pending.push(draftCard(index, value).catch(() => undefined)),
    });
    cost += slate.cost.costMinor;
    await Promise.all(pending);
    return { briefId: entry.id, check: checkIdeationSet(slate.elements, cards, entry.forbiddenArchetypes), costMinor: Math.round(cost), cacheReads, cardCalls: slate.elements.length, totalMs: Date.now() - started, firstCardMs };
  } catch (err) {
    await Promise.allSettled(pending);
    const message = err instanceof Error ? err.message : String(err);
    return { briefId: entry.id, check: { passed: false, slateSize: 0, cards: cards.filter(Boolean).length, problems: [{ kind: "slate", message }] }, costMinor: Math.round(cost), cacheReads, cardCalls: 0, totalMs: Date.now() - started, firstCardMs, error: message };
  }
}
