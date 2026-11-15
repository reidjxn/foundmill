/**
 * Mock Ideation agent (BUILD §11.1): 6–12 concept cards with 10 attributes (1–20) + evidence and ≥ 2 citations each,
 * seeded by the prompt hash and shaped by the prompt's keywords and the founder profile.
 */
import { ARCHETYPES, ARCHETYPE_LABELS, type Archetype } from "@foundmill/shared";
import { uuidFromSeed } from "../hash";
import { IDEA_ATTRIBUTE_KEYS, type ConceptCard, type IdeaAttributeKey, type IdeationOutput } from "../schemas";
import { type BriefFacts, type MockContext, briefFacts, isRecord, keywords, titleCase } from "./inputs";

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
  /** What the founder's own brief names (audiences, outcomes, the product), when it names anything. */
  facts: BriefFacts;
}

function draftInputs(ctx: MockContext): DraftInputs {
  // Import's single card: the brief is a fixed instruction and the report travels as untrusted data; the card is shaped
  // by the report, as a model would shape it.
  const prompt = ctx.getString("import_report") ?? ctx.getString("prompt", "concept", "brief", "idea") ?? ctx.lastUser;
  const founder = ctx.getRecord("founder", "founder_profile", "profile");
  const imported = Boolean(ctx.getString("import_report"));
  return {
    prompt,
    kws: keywords(prompt, 8),
    constraints: founder && Array.isArray(founder.constraints) ? founder.constraints.filter((c): c is string => typeof c === "string") : [],
    skills: founder && isRecord(founder.skills) ? founder.skills : undefined,
    hinted: ARCHETYPE_HINTS.filter(([, re]) => re.test(prompt)).map(([a]) => a),
    facts: imported ? { audiences: [], outcomes: [], mechanism: null, specific: false } : briefFacts(prompt),
  };
}

/**
 * Who a card serves and what it does for them. A brief that names its people and their struggle is echoed, card by
 * card (first-time founder report, Nov 8, 2026: a founder who typed "students … cafes … same-day shifts" read ten cards
 * about renters and fitness instructors). Every fourth card still roams to an adjacent audience, so a set stays a set
 * of different ideas; a brief that names nobody draws from the archetype's audiences as before.
 */
function castOf(i: number, archetype: Archetype, inputs: DraftInputs, rng: MockContext["rng"]): { audience: string; outcome: string; mechanism: string } {
  const { facts } = inputs;
  const roam = facts.specific && i % 4 === 3;
  const audience = facts.audiences.length && !roam ? facts.audiences[i % facts.audiences.length]! : rng.pick(AUDIENCES[archetype]);
  const outcome = facts.outcomes.length && !roam ? facts.outcomes[i % facts.outcomes.length]! : rng.pick(OUTCOMES);
  // The founder's own product sentence leads the first card; the others try another mechanism on the same people.
  const mechanism = facts.mechanism && i === 0 ? facts.mechanism : rng.pick(MECHANISMS);
  return { audience, outcome, mechanism };
}

/** One card. Without a spec this consumes the seed exactly as the full-set generator always has (fixtures stay stable). */
function draftCard(ctx: MockContext, i: number, inputs: DraftInputs, usedNames: Set<string>, spec: MockCardSpec = {}): ConceptCard {
  const { rng } = ctx;
  const { prompt, kws, constraints, skills, hinted } = inputs;
  const archetype: Archetype = spec.archetype ?? (hinted.length > 0 && rng.chance(0.65) ? rng.pick(hinted) : rng.pick(ARCHETYPES));
  const keyword = kws.length > 0 ? (kws[i % kws.length] as string) : undefined;
  const name = spec.name ?? uniqueName(rng, keyword, usedNames);
  const { audience, outcome, mechanism } = castOf(i, archetype, inputs, rng);
  // "built around <keyword>" only pads a pitch whose brief named nobody; a brief that did is already in the sentence.
  const pitch = spec.angle ?? `${name} helps ${audience} ${outcome} through ${mechanism}${keyword && !inputs.facts.specific ? `, built around ${keyword}` : ""}.`;

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
  const topic = keyword ?? ARCHETYPE_LABELS[archetype].toLowerCase();
  // What each source says, in one line, as the Research agent writes it; figures behind the card are estimates.
  const citations = Array.from({ length: citationCount }, (_, c) => ({
    title: c === 0 ? `Market note: ${topic} (${ARCHETYPE_LABELS[archetype]})` : c === 1 ? `Pricing comparables for ${audience}` : `Competitor scan: ${name}`,
    url: `https://research.mock.invalid/${slug}/${c + 1}`,
    note:
      c === 0
        ? `Who buys ${topic} today, what they pay and where they look for help; the market figures are estimates.`
        : c === 1
          ? `Price points of comparable products for ${audience}, with the plan each one leads with.`
          : `The closest competitors to ${name} and where each one is weak.`,
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

/**
 * Import's single card (no slate item; the report travels as `import_report`): the card describes the business the
 * report is about, as a model following `buildSingleConceptRequest` would. It keeps the business's own name ("Existing
 * business import: <name>."), takes the report's archetype (`archetype_hint`) and pitches what exists, instead of a
 * random name, archetype and audience (audit IAE-10).
 */
function importSpec(ctx: MockContext): MockCardSpec {
  const report = ctx.getString("import_report");
  if (!report) return {};
  const hint = ctx.getString("archetype_hint");
  const archetype = hint && (ARCHETYPES as readonly string[]).includes(hint) ? (hint as Archetype) : undefined;
  const line = (label: string) => new RegExp(`^${label}: (.+?)\\.$`, "m").exec(report)?.[1]?.trim();
  const name = line("Existing business import")?.slice(0, 60);
  const exists = line("What exists");
  const kind = archetype ? `${ARCHETYPE_LABELS[archetype]} business` : "business";
  const angle = name ? `${name} is an existing ${kind}${exists ? `: ${exists}` : ""}.`.slice(0, 400) : undefined;
  return { ...(name ? { name } : {}), ...(archetype ? { archetype } : {}), ...(angle ? { angle } : {}) };
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
 * (`concept: {id, name, archetype, angle}`) keeps its id, name, archetype and angle; Import's card keeps the imported
 * business's name and archetype (`importSpec`); otherwise the card is drafted from the prompt.
 */
export function generateConceptCard(ctx: MockContext): ConceptCard {
  const slateItem = cardSpec(ctx);
  return draftCard(ctx, 0, draftInputs(ctx), new Set<string>(), Object.keys(slateItem).length > 0 ? slateItem : importSpec(ctx));
}

/** The `ideation` route: one card when the caller's schema is a single card (it has `attributes`), a Compare verdict when it asks for one (`verdict_md`), else a full set. */
export function generateIdeationRoute(ctx: MockContext): IdeationOutput | ConceptCard | CompareVerdict {
  if (ctx.schemaKeys.includes("verdict_md")) return generateCompareVerdict(ctx);
  return ctx.schemaKeys.includes("attributes") && !ctx.schemaKeys.includes("concepts") ? generateConceptCard(ctx) : generateIdeation(ctx);
}

/** What Compare asks for (apps/api `idea.compare`): a verdict in Markdown and a ranking of the compared cards. */
export interface CompareVerdict {
  verdict_md: string;
  ranking: { idea_id: string; rank: number; reason: string }[];
}

interface ComparedCard {
  id: string;
  title: string;
  pitch: string;
  attributes: { key: string; value: number }[];
}

const ATTRIBUTE_WORDS = (key: string) => key.replace(/_/g, " ").replace(/\bagent executability\b/, "agent-executability");

/** The cards Compare sends (`concepts: [{ id, title, pitch, attributes }]`, attributes as a map or a list). */
function comparedCards(ctx: MockContext): ComparedCard[] {
  return ctx
    .getArray<unknown>("concepts", "ideas", "cards")
    .filter(isRecord)
    .flatMap((c) => {
      const id = typeof c.id === "string" ? c.id : null;
      if (!id) return [];
      const raw = c.attributes;
      const attributes: ComparedCard["attributes"] = Array.isArray(raw)
        ? raw.filter(isRecord).flatMap((a) => (typeof a.key === "string" && typeof a.value === "number" ? [{ key: a.key, value: a.value }] : []))
        : isRecord(raw)
          ? Object.entries(raw).flatMap(([key, a]) => (isRecord(a) && typeof a.value === "number" ? [{ key, value: a.value }] : []))
          : [];
      return [{ id, title: typeof c.title === "string" ? c.title : typeof c.name === "string" ? c.name : "This concept", pitch: typeof c.pitch === "string" ? c.pitch : "", attributes }];
    });
}

/**
 * Compare's verdict, written from the cards' own ratings and nothing else (the first-time founder report, Nov 8, 2026,
 * found the schema synthesizer's "Mock verdict md about distribution" on the Compare screen): where each card leads
 * outright, where it is weakest, which one to commit and why, with every figure quoted from the cards.
 */
export function generateCompareVerdict(ctx: MockContext): CompareVerdict {
  const cards = comparedCards(ctx);
  if (cards.length === 0) return { verdict_md: "Pick two to four concept cards and I compare them attribute by attribute.", ranking: [{ idea_id: "none", rank: 1, reason: "No cards were given to compare." }] };
  const mean = (c: ComparedCard) => (c.attributes.length ? c.attributes.reduce((s, a) => s + a.value, 0) / c.attributes.length : 0);
  const ranked = [...cards].sort((a, b) => mean(b) - mean(a) || a.title.localeCompare(b.title));
  const leadsOf = (c: ComparedCard) =>
    c.attributes
      .filter((a) => cards.every((o) => o === c || (o.attributes.find((x) => x.key === a.key)?.value ?? -Infinity) < a.value))
      .sort((a, b) => b.value - a.value)
      .slice(0, 2);
  const weakestOf = (c: ComparedCard) => [...c.attributes].sort((a, b) => a.value - b.value)[0];
  const lines = ranked.map((c, i) => {
    const leads = leadsOf(c);
    const weakest = weakestOf(c);
    const lead = leads.length ? `leads on ${leads.map((a) => `${ATTRIBUTE_WORDS(a.key)} (${a.value})`).join(" and ")}` : "leads on no attribute outright";
    const weak = weakest ? `; weakest on ${ATTRIBUTE_WORDS(weakest.key)} (${weakest.value})` : "";
    return `${i + 1}. **${c.title}** ${lead}${weak}.`;
  });
  const top = ranked[0]!;
  const runner = ranked[1];
  const topWeak = weakestOf(top);
  const verdict = [
    `Ranked by the mean of the ten ratings, highest first. These are the cards' own ratings (the Ideation agent's priors, not research), so the gaps between them are estimates.`,
    ...lines,
    `**Commit ${top.title}** if you want the strongest card today${runner ? `; ${runner.title} is the one to keep if ${topWeak ? `${ATTRIBUTE_WORDS(topWeak.key)} worries you` : "you want a second route"}` : ""}. ${topWeak ? `Before building, ask the Research agent about ${top.title}'s ${ATTRIBUTE_WORDS(topWeak.key)}: it is the rating most likely to move once checked against a source.` : ""}`.trim(),
  ].join("\n\n");
  return {
    verdict_md: verdict,
    ranking: ranked.map((c, i) => {
      const leads = leadsOf(c);
      const weakest = weakestOf(c);
      return { idea_id: c.id, rank: i + 1, reason: `${leads.length ? `Leads on ${leads.map((a) => `${ATTRIBUTE_WORDS(a.key)} (${a.value})`).join(" and ")}` : "Leads on no attribute outright"}${weakest && !leads.includes(weakest) ? `; weakest on ${ATTRIBUTE_WORDS(weakest.key)} (${weakest.value})` : ""}.` };
    }),
  };
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
      return `Estimate — ${n} recent forum threads and job posts mention paying for ${topic}; pull looks ${strength}.`;
    case "market_size":
      return `Estimate — comparable ${ARCHETYPE_LABELS[archetype].toLowerCase()} companies report a serviceable market in the ${value >= 12 ? "hundreds of millions" : "tens of millions"}.`;
    case "competition":
      return `${n} competitors found; ${strength === "strong" ? "none" : strength === "mixed" ? "a few" : "several"} are well funded.`;
    case "speed_to_first_customer":
      return `${archetype === "services" ? "A first paid engagement is realistic within weeks" : value >= 12 ? "A pilot customer is reachable within a quarter" : "Expect a long build before the first sale"} (Estimate).`;
    case "capital_intensity":
      return value >= 14 ? "Software-only; no inventory or tooling needed up front (Estimate)." : "Requires inventory, tooling or certification spend before revenue (Estimate).";
    case "agent_executability":
      return value >= 14 ? "Most of the build and distribution work can be run by the team with existing connectors." : "Key steps need humans: physical samples, a licensed professional's approval or in-person sales.";
    case "founder_fit":
      return `Based on the founder profile skills and constraints; the match reads ${strength}.`;
    case "defensibility":
      return value >= 12 ? "Data network effects or switching costs plausible after the first cohort (Estimate)." : "Easy to copy; protection from copycats would come from brand and distribution, not technology.";
    case "regulatory_load":
      return value >= 14 ? "No licensing or sector regulation identified beyond standard consumer and data law." : "Sector rules apply (claims, safety or financial regulation); budget for compliance.";
    case "distribution_clarity":
      return value >= 12 ? `A clear first channel exists for ${topic} (search intent or a reachable community).` : "No obvious first channel; distribution would need testing across several lines.";
  }
}
