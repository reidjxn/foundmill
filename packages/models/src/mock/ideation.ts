/**
 * Mock Ideation agent (BUILD §11.1): 6–12 concept cards with 10 attributes (1–20) + evidence and ≥ 2 citations each,
 * seeded by the prompt hash and shaped by the prompt's keywords and the founder profile.
 */
import { ARCHETYPES, ARCHETYPE_LABELS, type Archetype } from "@foundmill/shared";
import { uuidFromSeed } from "../hash";
import { IDEA_ATTRIBUTE_KEYS, type ConceptCard, type IdeaAttributeKey, type IdeationOutput } from "../schemas";
import { type MockContext, isRecord, keywords, titleCase } from "./inputs";

const ARCHETYPE_HINTS: Array<[Archetype, RegExp]> = [
  ["b2b_saas", /\b(saas|b2b|software|platform|dashboard|workflow|api|teams?|enterprise|smb|accounting|crm|analytics)\b/i],
  ["consumer_app", /\b(app|consumer|mobile|habit|fitness|wellness|social|dating|game|parents?|students?)\b/i],
  ["marketplace", /\b(marketplace|two-sided|buyers?|sellers?|booking|freelanc|gig|rental)\b/i],
  ["dtc_physical", /\b(skincare|cosmetic|supplement|food|drink|coffee|apparel|clothing|physical|product line|dtc|e-?commerce|shopify|brand)\b/i],
  ["hardware", /\b(hardware|device|sensor|iot|robot|wearable|gadget|machine)\b/i],
  ["services", /\b(agency|consult|service|studio|coaching|bookkeeping|legal services|managed)\b/i],
  ["content_media", /\b(newsletter|podcast|media|content|course|community|youtube|creator|publication)\b/i],
];

/** Favourable baseline per archetype on the 1–20 scale (higher = better for the founder). */
const BASELINE: Record<Archetype, Record<IdeaAttributeKey, number>> = {
  b2b_saas: { market_pull: 13, market_size: 13, competition: 9, speed_to_first_customer: 12, capital_intensity: 15, agent_executability: 17, founder_fit: 12, defensibility: 11, regulatory_load: 15, distribution_clarity: 13 },
  consumer_app: { market_pull: 12, market_size: 16, competition: 7, speed_to_first_customer: 14, capital_intensity: 14, agent_executability: 15, founder_fit: 11, defensibility: 7, regulatory_load: 14, distribution_clarity: 8 },
  marketplace: { market_pull: 12, market_size: 15, competition: 9, speed_to_first_customer: 8, capital_intensity: 12, agent_executability: 13, founder_fit: 11, defensibility: 14, regulatory_load: 12, distribution_clarity: 9 },
  dtc_physical: { market_pull: 13, market_size: 12, competition: 7, speed_to_first_customer: 9, capital_intensity: 7, agent_executability: 10, founder_fit: 12, defensibility: 9, regulatory_load: 9, distribution_clarity: 13 },
  hardware: { market_pull: 11, market_size: 12, competition: 11, speed_to_first_customer: 5, capital_intensity: 4, agent_executability: 7, founder_fit: 10, defensibility: 15, regulatory_load: 8, distribution_clarity: 9 },
  services: { market_pull: 14, market_size: 9, competition: 8, speed_to_first_customer: 17, capital_intensity: 18, agent_executability: 14, founder_fit: 13, defensibility: 6, regulatory_load: 15, distribution_clarity: 14 },
  content_media: { market_pull: 11, market_size: 11, competition: 6, speed_to_first_customer: 15, capital_intensity: 17, agent_executability: 16, founder_fit: 12, defensibility: 8, regulatory_load: 17, distribution_clarity: 12 },
};

const PREFIXES = ["Nor", "Led", "Vel", "Quar", "Bri", "Hal", "Ost", "Fen", "Mar", "Sol", "Kin", "Tess", "Lum", "Ard", "Pel", "Cair", "Wren", "Juno", "Oak", "Mica"];
const SUFFIXES = ["ly", "wind", "forge", "loop", "mint", "stack", "well", "nest", "path", "board", "scope", "desk", "lane", "wave", "grove", "flow", "base", "line"];

const AUDIENCES: Record<Archetype, string[]> = {
  b2b_saas: ["finance teams at seed-stage startups", "independent accountants", "ops leads at ten-person agencies", "founders running their first payroll", "customer-success teams"],
  consumer_app: ["new parents", "people learning a second language", "amateur runners", "renters in big cities", "first-time investors"],
  marketplace: ["independent repair technicians", "small event venues", "boutique fitness instructors", "specialist translators", "local food producers"],
  dtc_physical: ["people with sensitive skin", "home baristas", "cyclists who commute", "new dog owners", "night-shift workers"],
  hardware: ["small greenhouse growers", "boutique hotels", "makerspaces", "independent coffee roasters", "cold-chain couriers"],
  services: ["solo founders", "clinics with two to five staff", "e-commerce brands under ten people", "architecture studios", "non-profits"],
  content_media: ["operators in climate tech", "indie game developers", "bootstrapped SaaS founders", "first-time managers", "procurement professionals"],
};

const OUTCOMES = [
  "cut a weekly chore to minutes",
  "see the one number that matters each morning",
  "stop losing money to a problem they cannot see",
  "get to a first paying customer without a sales team",
  "replace a spreadsheet they secretly hate",
  "turn a recurring panic into a routine",
  "prove value in the first session",
];

const MECHANISMS = [
  "an agent that watches their existing tools and acts within set limits",
  "a narrow, opinionated workflow instead of a general tool",
  "a subscription box designed around one ritual",
  "a two-sided match with escrow and verified reviews",
  "a single sensor and a weekly report",
  "a done-for-you service with a transparent fixed fee",
  "a paid newsletter plus a members' community",
];

/** What a per-card request (or the slate it came from) fixes about a card; the rest is drafted from the seed. */
export interface MockCardSpec {
  id?: string;
  name?: string;
  archetype?: Archetype;
  /** One-line angle from the slate; becomes the pitch. */
  angle?: string;
}

interface DraftInputs {
  prompt: string;
  kws: string[];
  constraints: string[];
  skills: Record<string, unknown> | undefined;
  hinted: Archetype[];
}

function draftInputs(ctx: MockContext): DraftInputs {
  // Import's single card: the brief is a fixed instruction and the report travels as untrusted data; the card is shaped
  // by the report, as a model would shape it.
  const prompt = ctx.getString("import_report") ?? ctx.getString("prompt", "concept", "brief", "idea") ?? ctx.lastUser;
  const founder = ctx.getRecord("founder", "founder_profile", "profile");
  return {
    prompt,
    kws: keywords(prompt, 8),
    constraints: founder && Array.isArray(founder.constraints) ? founder.constraints.filter((c): c is string => typeof c === "string") : [],
    skills: founder && isRecord(founder.skills) ? founder.skills : undefined,
    hinted: ARCHETYPE_HINTS.filter(([, re]) => re.test(prompt)).map(([a]) => a),
  };
}

/** One card. Without a spec this consumes the seed exactly as the full-set generator always has (fixtures stay stable). */
function draftCard(ctx: MockContext, i: number, inputs: DraftInputs, usedNames: Set<string>, spec: MockCardSpec = {}): ConceptCard {
  const { rng } = ctx;
  const { prompt, kws, constraints, skills, hinted } = inputs;
  const archetype: Archetype = spec.archetype ?? (hinted.length > 0 && rng.chance(0.65) ? rng.pick(hinted) : rng.pick(ARCHETYPES));
  const keyword = kws.length > 0 ? (kws[i % kws.length] as string) : undefined;
  const name = spec.name ?? uniqueName(rng, keyword, usedNames);
  const audience = rng.pick(AUDIENCES[archetype]);
  const outcome = rng.pick(OUTCOMES);
  const mechanism = rng.pick(MECHANISMS);
  const pitch = spec.angle ?? `${name} helps ${audience} ${outcome} through ${mechanism}${keyword ? `, built around ${keyword}` : ""}.`;

  const attributes = IDEA_ATTRIBUTE_KEYS.map((key) => {
    let value = BASELINE[archetype][key] + rng.int(-3, 3);
    if (key === "founder_fit" && skills) value = Math.round((value + founderFit(skills, archetype)) / 2);
    if (key === "regulatory_load" && /\b(medical|health|finance|fintech|crypto|children|alcohol|insurance)\b/i.test(prompt)) value -= 4;
    if (key === "capital_intensity" && constraints.some((c) => /bootstrap|no funding|small budget|low budget/i.test(c)) && archetype === "hardware") value -= 2;
    value = Math.max(1, Math.min(20, value));
    return { key, value, evidence: evidenceFor(key, value, archetype, keyword, rng) };
  });
  const mean = attributes.reduce((acc, a) => acc + a.value, 0) / attributes.length;
  const starsCurrent = Math.max(1, Math.min(5, Math.round(mean / 4)));
  const starsPotential = Math.max(starsCurrent, Math.min(5, starsCurrent + rng.int(0, 2)));
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, "-");
  const citationCount = rng.int(2, 3);
  const citations = Array.from({ length: citationCount }, (_, c) => ({
    title: c === 0 ? `Market note: ${keyword ?? ARCHETYPE_LABELS[archetype].toLowerCase()} (${ARCHETYPE_LABELS[archetype]})` : c === 1 ? `Pricing comparables for ${audience}` : `Competitor scan: ${name}`,
    url: `https://research.mock.invalid/${slug}/${c + 1}`,
    note: "Mock citation — replace with Research agent output in live mode. Labeled estimate.",
  }));

  return {
    id: spec.id ?? uuidFromSeed(`${ctx.hash}:concept:${i}`),
    name,
    pitch,
    archetype,
    stars_current: starsCurrent,
    stars_potential: starsPotential,
    attributes,
    citations,
    crest_seed: `${slug}-${ctx.hash.slice(0, 6)}`,
  };
}

/** The card a per-card request names (`concept: {id, name, archetype, angle}`), if any. */
function cardSpec(ctx: MockContext): MockCardSpec {
  const concept = ctx.getRecord("concept", "slate_item");
  if (!concept) return {};
  const str = (v: unknown, max: number) => (typeof v === "string" && v.trim() ? v.trim().slice(0, max) : undefined);
  const archetype = typeof concept.archetype === "string" && (ARCHETYPES as readonly string[]).includes(concept.archetype) ? (concept.archetype as Archetype) : undefined;
  return { id: str(concept.id, 120), name: str(concept.name, 60), archetype, angle: str(concept.angle, 400) };
}

/** A full set of 6–12 cards (`{ concepts: [...] }`), seeded by the prompt. */
export function generateIdeation(ctx: MockContext): IdeationOutput {
  const inputs = draftInputs(ctx);
  const count = ctx.rng.int(6, 12);
  const usedNames = new Set<string>();
  const concepts: ConceptCard[] = [];
  for (let i = 0; i < count; i++) concepts.push(draftCard(ctx, i, inputs, usedNames));
  return { concepts };
}

/**
 * One card (audit P2: a card of the slate's fan-out, or Import's single card). A request naming a slate item
 * (`concept: {id, name, archetype, angle}`) keeps its id, name, archetype and angle; without one the card is drafted
 * from the prompt.
 */
export function generateConceptCard(ctx: MockContext): ConceptCard {
  return draftCard(ctx, 0, draftInputs(ctx), new Set<string>(), cardSpec(ctx));
}

/** The `ideation` route: one card when the caller's schema is a single card (it has `attributes`), else a full set. */
export function generateIdeationRoute(ctx: MockContext): IdeationOutput | ConceptCard {
  return ctx.schemaKeys.includes("attributes") && !ctx.schemaKeys.includes("concepts") ? generateConceptCard(ctx) : generateIdeation(ctx);
}

function uniqueName(rng: MockContext["rng"], keyword: string | undefined, used: Set<string>): string {
  for (let attempt = 0; attempt < 20; attempt++) {
    const base = keyword && rng.chance(0.5) ? titleCase(keyword.replace(/s$/, "")).replace(/[^A-Za-z]/g, "") : rng.pick(PREFIXES);
    const name = `${base}${rng.pick(SUFFIXES)}`.slice(0, 24);
    if (!used.has(name)) {
      used.add(name);
      return name;
    }
  }
  const fallback = `${rng.pick(PREFIXES)}${rng.pick(SUFFIXES)}${used.size + 1}`;
  used.add(fallback);
  return fallback;
}

function founderFit(skills: Record<string, unknown>, archetype: Archetype): number {
  const n = (k: string) => (typeof skills[k] === "number" ? (skills[k] as number) : 10);
  switch (archetype) {
    case "b2b_saas":
      return Math.round((n("engineering") + n("sales")) / 2);
    case "consumer_app":
      return Math.round((n("design") + n("engineering")) / 2);
    case "marketplace":
      return Math.round((n("sales") + n("domain")) / 2);
    case "dtc_physical":
      return Math.round((n("design") + n("domain")) / 2);
    case "hardware":
      return Math.round((n("engineering") + n("domain")) / 2);
    case "services":
      return Math.round((n("domain") + n("sales")) / 2);
    case "content_media":
      return Math.round((n("domain") + n("design")) / 2);
  }
}

function evidenceFor(key: IdeaAttributeKey, value: number, archetype: Archetype, keyword: string | undefined, rng: MockContext["rng"]): string {
  const topic = keyword ?? ARCHETYPE_LABELS[archetype].toLowerCase();
  const strength = value >= 15 ? "strong" : value >= 9 ? "mixed" : "weak";
  const n = rng.int(3, 40);
  switch (key) {
    case "market_pull":
      return `Estimate — ${n} recent forum threads and job posts mention paying for ${topic}; pull looks ${strength} (mock research).`;
    case "market_size":
      return `Estimate — comparable ${ARCHETYPE_LABELS[archetype].toLowerCase()} companies report a serviceable market in the ${value >= 12 ? "hundreds of millions" : "tens of millions"} (mock research).`;
    case "competition":
      return `${n} competitors found; ${strength === "strong" ? "none" : strength === "mixed" ? "a few" : "several"} are well funded (mock research).`;
    case "speed_to_first_customer":
      return `${archetype === "services" ? "A first paid engagement is realistic within weeks" : value >= 12 ? "A pilot customer is reachable within a quarter" : "Expect a long build before the first sale"} (estimate).`;
    case "capital_intensity":
      return value >= 14 ? "Software-only; no inventory or tooling needed up front (estimate)." : "Requires inventory, tooling or certification spend before revenue (estimate).";
    case "agent_executability":
      return value >= 14 ? "Most of the build and distribution work can be run by the team with existing connectors." : "Key steps need humans: physical samples, licensed sign-off or in-person sales.";
    case "founder_fit":
      return `Based on the founder profile skills and constraints; fit reads ${strength}.`;
    case "defensibility":
      return value >= 12 ? "Data network effects or switching costs plausible after the first cohort (estimate)." : "Easy to copy; defensibility would come from brand and distribution, not technology.";
    case "regulatory_load":
      return value >= 14 ? "No licensing or sector regulation identified beyond standard consumer and data law." : "Sector rules apply (claims, safety or financial regulation); budget for compliance.";
    case "distribution_clarity":
      return value >= 12 ? `A clear first channel exists for ${topic} (search intent or a reachable community).` : "No obvious first channel; distribution would need testing across several lines.";
  }
}
