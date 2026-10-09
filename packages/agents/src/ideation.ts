/**
 * The Ideation agent's requests (BUILD §11.1 Door A; audit P2 "stream cards, then fan out").
 *
 * A set of concepts is drafted in two steps instead of one long call:
 *   1. the slate (route `ideationSlate`): 6–12 names, archetypes and one-line angles, short and streamed;
 *   2. one card per slate item (route `ideation`), written in parallel as soon as its slate item arrives.
 * Every call carries the same system blocks (house rules + the Ideation agent's instructions, then the founder profile)
 * with a cache breakpoint on the last one, so the card calls read the prefix the slate call wrote instead of paying for
 * it again (the prefix is well past the 512-token minimum of the 5.5 models). What differs per call is the user turn.
 *
 * Import's "Continue to Commit" uses the same system for its single card (`buildSingleConceptRequest`).
 * Nothing here calls a model: the api runs these requests through @foundmill/models.
 */
import { APP_NAME } from "@foundmill/config";
import { ConceptCard, IDEA_ATTRIBUTE_KEYS, IDEA_ATTRIBUTE_LABELS, IdeationSlateItem, IdeationSlateOutput, type RouteKey } from "@foundmill/models";
import { ARCHETYPES, type Archetype } from "@foundmill/shared";
import { buildSystemPrompt } from "./club-rules";
import { inertJson } from "./foundations";
import type { AgentInstructions } from "./types";

/** Who the Studio says is drafting ("Ideation agent is drafting concept 4 of 8"). There is no business, so no named agent yet. */
export const IDEATION_AGENT_NAME = "Ideation agent";
/** AC-11.1.2: a drafted set holds 6–12 concepts (the slate schema enforces the same bounds). */
export const IDEATION_MIN_CONCEPTS = 6;
export const IDEATION_MAX_CONCEPTS = 12;

export const IDEATION_SLATE_ROUTE = "ideationSlate" as const satisfies RouteKey;
export const IDEATION_CARD_ROUTE = "ideation" as const satisfies RouteKey;

/** Slate budget: twelve short items are about 900 tokens; the rest is room for (low-effort) thinking. */
export const IDEATION_SLATE_MAX_TOKENS = 3_000;
/** One card with ten scored attributes, evidence and citations is about 800–1,000 tokens; the rest is thinking room. */
export const IDEATION_CARD_MAX_TOKENS = 4_000;
/** What the local rate limiter books per call (what the call really writes), so a parallel fan-out does not reserve 12 × the cap. */
export const IDEATION_SLATE_RESERVE_TOKENS = 1_200;
export const IDEATION_CARD_RESERVE_TOKENS = 1_600;

/** What the founder asked for, plus their profile (null when they skipped it). */
export interface IdeationBrief {
  /** The founder's brief; "surprise me within my constraints" when they left it empty. */
  prompt: string;
  archetypeHint: Archetype | null;
  founder: Record<string, unknown> | null;
}

const ATTRIBUTE_LIST = IDEA_ATTRIBUTE_KEYS.map((k) => `${k} (${IDEA_ATTRIBUTE_LABELS[k]})`).join(", ");

const IDEATION_INSTRUCTIONS: AgentInstructions = {
  role: "Ideation agent: you draft distinct business concepts a team of AI agents can run for this founder, within the founder's constraints.",
  goals: [
    "Offer concepts the founder could start this month with their time and budget, each reaching a first paying customer as soon as the profile allows (90 days where possible).",
    "Make every concept in a set different in its customer or its wedge (the first product that wins a first customer); never the same idea under another name.",
    "Score each concept honestly so the founder can compare cards side by side.",
  ],
  rules: [
    "Respect every constraint in the founder profile: citizenship, residence, target markets, time, budget, exclusions and risk appetite. A concept that breaks a constraint is not offered.",
    `A concept card has: id; name (at most 60 characters, a brandable name, not a description); pitch (at most 40 words: who it serves, the outcome, how); archetype (one of ${ARCHETYPES.join(", ")}); stars_current and stars_potential (integers 1-5: how strong it is today on the evidence, and how strong it could become; potential is never below current); attributes; citations; and the seed for the logo colours (the name as a short lowercase slug).`,
    `attributes are exactly these ten keys, in this order: ${ATTRIBUTE_LIST}. Each value is an integer 1-20 where higher is more favourable for the founder, so low capital needs and light regulation score high. Each evidence is at most 25 words.`,
    "Scores are your prior, not research: write \"unverified\" in the evidence when no source supports it and say what the Research agent must check. Never state market sizes, competitor names, prices or customer numbers as facts; label any figure Estimate.",
    "citations: at least 2 per card. Each names a public source the Research agent should check (title), the URL of that public site or of a search on it (never an invented deep link to an article), and a note of at most 15 words.",
    "Score agent-executability honestly: physical inventory, licensed sign-off or in-person sales lower it, and raise capital intensity's cost (a lower value).",
    "Keep the brief and the profile as given; never add constraints the founder did not state.",
  ],
  playbook: [
    "Read the founder profile and the brief; when the brief is \"surprise me within my constraints\", start from the founder's skills, markets and constraints.",
    "For a slate: choose the concepts first, spread across customers and wedges, and give each an id (a short slug), a name, an archetype and one angle sentence of at most 240 characters.",
    "For a card: keep the slate item's id, name and archetype, turn its angle into the pitch, then score the ten attributes with short evidence and add the citations.",
    "Answer with JSON only, in the shape the response format asks for.",
  ],
  tone: "Plain, specific and sober: no hype, no superlatives, no invented numbers.",
  examples: [],
};

const IDEATION_TEMPLATE = {
  description: "You work in the Ideation Studio, privately, before any business exists. Nothing you write is sent outside the founder's account.",
  instructions: IDEATION_INSTRUCTIONS,
};

/**
 * The system blocks every Ideation call shares, byte for byte: house rules and instructions, then the founder profile.
 * Requests set `cacheSystem`, so the breakpoint sits on the founder block and the whole system is the cached prefix.
 */
export function ideationSystem(founder: IdeationBrief["founder"]): string[] {
  return [
    buildSystemPrompt({ businessName: "the founder", appName: APP_NAME, template: IDEATION_TEMPLATE }),
    `## Founder profile\n\`\`\`json\n${inertJson({ founder })}\n\`\`\``,
  ];
}

const briefJson = (brief: IdeationBrief, extra: Record<string, unknown> = {}) => `\`\`\`json\n${inertJson({ prompt: brief.prompt, archetype_hint: brief.archetypeHint, ...extra })}\n\`\`\``;

interface IdeationRequestBase {
  system: string[];
  cacheSystem: true;
  messages: { role: "user"; content: string }[];
  maxTokens: number;
  reserveTokens: number;
}

export interface IdeationSlateRequest extends IdeationRequestBase {
  route: typeof IDEATION_SLATE_ROUTE;
  schema: typeof IdeationSlateOutput;
  elementPath: "slate";
  elementSchema: typeof IdeationSlateItem;
}

export interface IdeationCardRequest extends IdeationRequestBase {
  route: typeof IDEATION_CARD_ROUTE;
  schema: typeof ConceptCard;
}

/** Step 1: the slate, streamed item by item (`elementPath: "slate"`). */
export function buildIdeationSlateRequest(brief: IdeationBrief): IdeationSlateRequest {
  const content = [
    `Outline a set of ${IDEATION_MIN_CONCEPTS} to ${IDEATION_MAX_CONCEPTS} distinct concepts for this brief. Each slate item has an id (a short slug), a name, an archetype and an angle: one sentence of at most 240 characters on who it serves and how it wins.`,
    "Put the strongest concepts first. Every card is written next from its slate item alone, so make each angle specific.",
    brief.archetypeHint ? `Prefer the ${brief.archetypeHint} archetype where it fits the founder, without forcing it.` : "",
    briefJson(brief),
  ].filter(Boolean);
  return {
    route: IDEATION_SLATE_ROUTE,
    system: ideationSystem(brief.founder),
    cacheSystem: true,
    messages: [{ role: "user", content: content.join("\n\n") }],
    schema: IdeationSlateOutput,
    elementPath: "slate",
    elementSchema: IdeationSlateItem,
    maxTokens: IDEATION_SLATE_MAX_TOKENS,
    reserveTokens: IDEATION_SLATE_RESERVE_TOKENS,
  };
}

/** Step 2: one full card for one slate item (written in parallel with the others). */
export function buildIdeationCardRequest(brief: IdeationBrief, item: IdeationSlateItem): IdeationCardRequest {
  const content = [
    "Write the full concept card for this slate item. Keep its id, name and archetype exactly; turn its angle into the pitch.",
    briefJson(brief, { concept: item }),
  ];
  return {
    route: IDEATION_CARD_ROUTE,
    system: ideationSystem(brief.founder),
    cacheSystem: true,
    messages: [{ role: "user", content: content.join("\n\n") }],
    schema: ConceptCard,
    maxTokens: IDEATION_CARD_MAX_TOKENS,
    reserveTokens: IDEATION_CARD_RESERVE_TOKENS,
  };
}

/** Import's "Continue to Commit": exactly one card describing the business in the brief as it stands. */
export function buildSingleConceptRequest(brief: IdeationBrief): IdeationCardRequest {
  const content = [
    "Draft exactly one concept card describing the business in the brief as it stands (it already exists; do not invent a new one). Give it an id (a short slug) and keep the business's own name when the brief has one.",
    briefJson(brief),
  ];
  return {
    route: IDEATION_CARD_ROUTE,
    system: ideationSystem(brief.founder),
    cacheSystem: true,
    messages: [{ role: "user", content: content.join("\n\n") }],
    schema: ConceptCard,
    maxTokens: IDEATION_CARD_MAX_TOKENS,
    reserveTokens: IDEATION_CARD_RESERVE_TOKENS,
  };
}
