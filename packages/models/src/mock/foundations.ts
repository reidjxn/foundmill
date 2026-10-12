/**
 * Mock foundations drafter (BUILD §11.1 first open, §11.5): the vision, content for every outline section in Tiptap
 * JSON, and a Now / Next / Later roadmap, shaped by the real input (packages/agents `buildFoundationsRequest`):
 * the business, the outline, the idea (its scores trusted, its text read from the untrusted `idea_text` block) and the
 * founder profile (Door A), and the Import report with its roadmap seeds (Door B, read from the `imported` block inside
 * the untrusted wrapper). Deterministic in the input; every figure that
 * is not in the input carries "Estimate" or "Forecast".
 */
import { ARCHETYPES, ARCHETYPE_LABELS, DEFAULT_BUSINESS_CURRENCY, MONEY_LOCALE, type Archetype } from "@foundmill/shared";
import type { FoundationsOutput, FoundationsRoadmapItem, FoundationsSection, TiptapBlock, TiptapDoc, TiptapParagraph } from "../schemas";
import { type MockContext, isRecord, keywords, sentenceCase, truncate } from "./inputs";

const str = (v: unknown): string | undefined => (typeof v === "string" && v.trim() ? v.trim() : undefined);
const strings = (v: unknown): string[] => (Array.isArray(v) ? v.map((x) => str(x)).filter((x): x is string => Boolean(x)) : []);
const records = (v: unknown): Record<string, unknown>[] => (Array.isArray(v) ? v.filter(isRecord) : []);
const pick = (r: Record<string, unknown> | undefined, ...keys: string[]): unknown => {
  if (!r) return undefined;
  for (const k of keys) if (r[k] !== undefined) return r[k];
  return undefined;
};

const text = (t: string): TiptapParagraph => ({ type: "paragraph", content: [{ type: "text", text: t }] });
const lead = (label: string, t: string): TiptapParagraph => ({ type: "paragraph", content: [{ type: "text", text: `${label} `, marks: [{ type: "bold" }] }, { type: "text", text: t }] });
const heading = (t: string, level = 3): TiptapBlock => ({ type: "heading", attrs: { level }, content: [{ type: "text", text: t }] });
const bullets = (items: string[]): TiptapBlock => ({ type: "bulletList", content: items.map((i) => ({ type: "listItem", content: [text(i)] })) });
const doc = (...content: TiptapBlock[]): TiptapDoc => ({ type: "doc", content });

const NORTH_STAR: Record<Archetype, { metric: string; definition: string; unit: string; range: [number, number] }> = {
  b2b_saas: { metric: "Weekly active paying teams", definition: "Paying teams with at least one member who completed the core workflow in the last seven days.", unit: "paying teams", range: [20, 60] },
  consumer_app: { metric: "Weekly activated users", definition: "Users who reached the activation event at least once in the last seven days.", unit: "weekly activated users", range: [500, 3000] },
  marketplace: { metric: "Completed transactions per week", definition: "Transactions paid by a buyer and confirmed by a seller in the last seven days.", unit: "transactions a week", range: [40, 200] },
  dtc_physical: { metric: "Repeat orders per month", definition: "Orders from customers who had already ordered at least once, per calendar month.", unit: "repeat orders a month", range: [80, 400] },
  hardware: { metric: "Units in active use", definition: "Shipped units that reported data in the last seven days.", unit: "units in active use", range: [50, 300] },
  services: { metric: "Retained clients per month", definition: "Clients billed this month who were also billed last month.", unit: "retained clients", range: [8, 30] },
  content_media: { metric: "Paying subscribers", definition: "Subscribers on a paid plan at the end of the week.", unit: "paying subscribers", range: [150, 900] },
};

const DEFAULT_AUDIENCE: Record<Archetype, string> = {
  b2b_saas: "small teams that run the work by hand today",
  consumer_app: "people who want a habit to stick",
  marketplace: "independent providers and the buyers looking for them",
  dtc_physical: "customers who care about what goes into the product",
  hardware: "operators who need a reliable measurement",
  services: "small businesses without an in-house specialist",
  content_media: "professionals who want a trusted weekly read",
};

/** The starting price per archetype, in the business's own currency (`m` formats whole units: "$49", "£1,200"). */
const PRICE: Record<Archetype, (m: (major: number) => string) => string> = {
  b2b_saas: (m) => `${m(49)} per team per month`,
  consumer_app: (m) => `${m(6)} per month or ${m(48)} a year`,
  marketplace: () => "a 10% commission on completed transactions",
  dtc_physical: (m) => `${m(34)} per unit, ${m(29)} on subscription`,
  hardware: (m) => `${m(249)} per unit plus ${m(9)} per month for the service`,
  services: (m) => `a fixed ${m(1200)} monthly retainer`,
  content_media: (m) => `${m(8)} per month or ${m(80)} a year`,
};

/** Whole units with the currency's narrow symbol, en-US grouping (the product's money format). */
function wholeMoney(currency: string): (major: number) => string {
  try {
    const f = new Intl.NumberFormat(MONEY_LOCALE, { style: "currency", currency, currencyDisplay: "narrowSymbol", maximumFractionDigits: 0 });
    return (major) => f.format(major);
  } catch {
    return (major) => `${major.toLocaleString(MONEY_LOCALE)} ${currency}`;
  }
}

const priceOf = (b: Brief): string => PRICE[b.archetype](wholeMoney(b.currency));

const BASE_OUTLINE = ["Problem", "Customers", "Value proposition", "Features", "Non-functional requirements", "Data", "Integrations", "Pricing", "Metrics", "Risks"];

interface Brief {
  name: string;
  archetype: Archetype;
  /** The business's own currency (ISO 4217): every price the drafts suggest is in it. */
  currency: string;
  archetypeLabel: string;
  audience: string;
  outcome: string;
  pitch: string;
  markets: string;
  constraints: string[];
  strengths: string[];
  risks: string[];
  seeds: { title: string; source: string }[];
  imported: boolean;
  missing: string[];
  exists: string[];
}

function readBrief(ctx: MockContext): Brief {
  const business = ctx.getRecord("business");
  const idea = ctx.getRecord("idea");
  const founder = ctx.getRecord("founder", "founder_profile");
  // The idea card's own text (title, summary, evidence) travels in an untrusted block as `idea_text`.
  const ideaText = ctx.getRecord("idea_text");
  const imported = ctx.getRecord("imported");
  const report = isRecord(imported?.report) ? imported.report : undefined;
  const archetypeRaw = str(pick(business, "archetype")) ?? str(pick(idea, "archetype"));
  const archetype: Archetype = (ARCHETYPES as readonly string[]).includes(archetypeRaw ?? "") ? (archetypeRaw as Archetype) : "b2b_saas";
  const name = str(pick(business, "name")) ?? str(pick(ideaText, "title")) ?? str(pick(idea, "title")) ?? str(pick(report, "suggested_name", "suggestedName")) ?? (keywords(ctx.userText, 1)[0] ? sentenceCase(keywords(ctx.userText, 1)[0]!) : "The business");
  const pitch = str(pick(ideaText, "pitch")) ?? str(pick(idea, "pitch")) ?? str(pick(report, "summary")) ?? `${name} is a ${ARCHETYPE_LABELS[archetype]} business.`;
  const helps = /helps\s+(.+?)\s+(cut|see|stop|get|replace|turn|prove|run|find|keep|save|ship|sell|book|learn|reach)\s+([^.,;]+)/i.exec(pitch);
  const audience = helps ? helps[1]!.trim() : DEFAULT_AUDIENCE[archetype];
  // "… helps X get to a first customer through a narrow workflow, built around …": the outcome stops at "through".
  const outcome = helps ? `${helps[2]!.toLowerCase()} ${helps[3]!.split(/\s+(?:through|by|with|using)\s+/)[0]!.trim()}` : "get the result they came for with less effort";
  const markets = strings(pick(founder, "target_markets", "targetMarkets"));
  const evidence = new Map(records(pick(ideaText, "evidence")).map((e) => [str(e.key) ?? str(e.label) ?? "", str(e.evidence)] as const));
  const attributes = records(pick(idea, "attributes"))
    .map((a) => ({ label: str(a.label) ?? str(a.key) ?? "", value: typeof a.value === "number" ? a.value : 10, evidence: str(a.evidence) ?? evidence.get(str(a.key) ?? "") ?? evidence.get(str(a.label) ?? "") }))
    .filter((a) => a.label);
  const sorted = [...attributes].sort((a, b) => b.value - a.value);
  const strengths = [...sorted.slice(0, 2).map((a) => `${a.label}: ${a.evidence ?? "scored high on the concept card"}`), ...strings(pick(report, "strengths")).slice(0, 2)];
  const risks = [...sorted.slice(-2).reverse().map((a) => `${a.label} is the weakest attribute on the concept card${a.evidence ? `: ${a.evidence}` : ""}`), ...strings(pick(report, "weaknesses")).slice(0, 2)];
  const seeds = records(pick(report, "roadmap_seeds", "roadmapSeeds"))
    .map((s) => ({ title: str(s.title) ?? "", source: str(s.source) ?? "" }))
    .filter((s) => s.title);
  return {
    name,
    archetype,
    currency: (str(pick(business, "currency")) ?? DEFAULT_BUSINESS_CURRENCY).toUpperCase(),
    archetypeLabel: ARCHETYPE_LABELS[archetype],
    audience,
    outcome,
    pitch,
    markets: markets.length ? markets.join(", ") : "its first market",
    constraints: strings(pick(founder, "constraints")),
    strengths: strengths.length ? strengths : [`A clear ${ARCHETYPE_LABELS[archetype]} model with a short path to a first customer`],
    risks: risks.length ? risks : ["Distribution: the first channel that reaches customers at an acceptable cost is not proven yet"],
    seeds,
    imported: str(ctx.get("door")) === "import" || Boolean(report),
    missing: strings(pick(report, "what_is_missing", "whatIsMissing")),
    exists: strings(pick(report, "what_exists", "whatExists")),
  };
}

/**
 * The outline sections to write. A staged section call (packages/agents `buildFoundationsSectionsRequest`, audit P3)
 * names the few it wants in `write_sections`; the single call and the roadmap call read the whole outline.
 */
function outlineOf(ctx: MockContext): string[] {
  const wanted = strings(ctx.get("write_sections"));
  if (wanted.length) return [...new Set(wanted)];
  const raw = ctx.getArray<unknown>("outline", "sections", "spec_outline");
  const names = raw.map((r) => (typeof r === "string" ? r : isRecord(r) ? str(r.section) ?? str(r.name) : undefined)).filter((x): x is string => Boolean(x));
  return names.length ? [...new Set(names)] : BASE_OUTLINE;
}

const FEATURES = (b: Brief): { title: string; story: string; criteria: string[] }[] => [
  { title: "Guided first run", story: `As one of ${b.audience}, I want to reach a first result in one session, so that I see the value before I pay.`, criteria: ["A new account reaches the first result without help", "Every step can be resumed after closing the tab"] },
  { title: "The core workflow", story: `As a returning user, I want ${b.name} to ${b.outcome}, so that I stop doing it by hand.`, criteria: ["The workflow completes end to end with real data", "Errors say what happened and what to do next"] },
  { title: "Weekly summary", story: "As a customer, I want a short weekly summary of what changed, so that I know the product is working for me.", criteria: ["The summary is sent once a week to every active account", "Each figure in it links to its source"] },
];

function sectionDoc(section: string, b: Brief): TiptapDoc {
  const key = section.toLowerCase();
  const ns = NORTH_STAR[b.archetype];
  if (key.includes("problem"))
    return doc(text(`${sentenceCase(b.audience)} cannot ${b.outcome} without slow, manual work today. ${b.pitch}`), bullets([`The job is done by hand or with tools that were not built for it`, `Mistakes are found late, when they are expensive`, ...(b.imported && b.missing.length ? [`From the import: ${b.missing[0]}`] : [])]));
  if (key.includes("customer"))
    return doc(lead("Primary segment:", `${b.audience} in ${b.markets}.`), bullets([`Early adopters: the ones who already pay for a workaround`, `Buyer and user are the same person at first`, `Not for: large organizations with their own team for this`]));
  if (key.includes("value"))
    return doc(text(`${b.name} helps ${b.audience} ${b.outcome}.`), bullets([...b.strengths.slice(0, 3), "Agents do the repetitive work; the customer keeps every decision"]));
  if (key.includes("feature"))
    return doc(
      text(`The first release is the smallest product that delivers the value proposition end to end.${b.seeds.length ? ` It also absorbs ${b.seeds.length} open issues from the imported backlog.` : ""}`),
      ...FEATURES(b).flatMap((f) => [heading(f.title), text(f.story), lead("Acceptance criteria:", f.criteria.join("; ") + ".")] as TiptapBlock[]),
      ...(b.seeds.length ? [heading("From the imported backlog"), bullets(b.seeds.map((s) => `${s.title} (${s.source})`))] : []),
    );
  if (key.includes("non-functional") || key.includes("nonfunctional"))
    return doc(bullets(["Pages answer within one second for a normal account", "Customer data stays in the EU and is encrypted at rest", "Keyboard access and readable contrast on every screen", "Every action an agent takes is logged and reversible where possible"]));
  if (key === "data" || key.startsWith("data"))
    return doc(text("The product keeps only what the workflow needs, stores it in the EU and deletes it when a customer leaves."), bullets(["Accounts, members and their roles", "The records the core workflow creates, with their history", "Usage events for the north-star metric"]));
  if (key.includes("integration"))
    return doc(bullets([...(b.imported && b.exists.some((e) => /github/i.test(e)) ? ["GitHub: the existing repository is the starting point for Development"] : []), "Stripe for payments (test mode until the founder approves going live)", "Email for sign-up, receipts and the weekly summary"]));
  if (key.includes("pric"))
    return doc(text(`Starting price: ${priceOf(b)} (Estimate).`), bullets(["One plan at launch; tiers once usage shows where value concentrates", "A free trial long enough to reach the first result", "Annual billing at two months free once retention is proven"]));
  if (key.includes("metric")) {
    const target = Math.round((ns.range[0] + ns.range[1]) / 2);
    return doc(lead("North star:", `${ns.metric}. ${ns.definition}`), bullets([`Target: ${target} ${ns.unit} by the end of the second chapter (Forecast)`, "Activation rate of new accounts in their first week", "Cost per paying customer by channel"]));
  }
  if (key.includes("risk")) return doc(bullets([...b.risks.slice(0, 4), "Cash: spending before the first paying customer shortens the runway, so every spend above the approval threshold waits for the founder"]));
  if (key.includes("onboarding") || key.includes("activation")) return doc(text("Activation is the first time a new user completes the core workflow."), bullets(["Ask for the minimum at sign-up", "Show progress towards the first result", "Nudge once by email if the user stops halfway"]));
  if (key.includes("retention")) return doc(bullets(["The weekly summary brings users back", "Saved work makes the second session faster than the first", "Streaks are never used to pressure the user"]));
  if (key.includes("supply")) return doc(text("Supply is recruited by hand first, then through referrals."), bullets(["Verified profiles before the first listing goes live", "Fair, visible fees"]));
  if (key.includes("demand")) return doc(text("Demand starts in one city or niche where supply is dense enough."), bullets(["Search that returns a useful result on day one", "Reviews from verified transactions only"]));
  if (key.includes("matching") || key.includes("trust")) return doc(bullets(["Payment held until both sides confirm", "A dispute route with a clear deadline", "Identity checks for providers"]));
  if (key.includes("formulation") || key.includes("bom")) return doc(text("The first formulation and bill of materials are agreed with a contract manufacturer."), bullets(["Every component has a supplier quote or is marked Estimate", "Two suppliers for each critical component"]));
  if (key.includes("manufactur")) return doc(bullets(["Samples before the first production run", "A minimum order quantity the budget can carry", "Quality checks agreed in writing"]));
  if (key.includes("packag")) return doc(bullets(["Packaging that survives the post without a second box", "Labels that meet the rules of every target market, checked before printing", "Recyclable materials where the unit cost allows it"]));
  if (key.includes("complian")) return doc(bullets(["List the regulations per target market before launch", "Keep test reports and declarations with their dates"]));
  if (key.includes("fulfil")) return doc(bullets(["One fulfillment partner at launch, chosen on quotes the founder approves", "The delivery promise is shown at checkout", "Returns are accepted for thirty days"]));
  if (key.includes("firmware") || key.includes("app")) return doc(bullets(["Updates over the air with a rollback", "The app works offline and syncs later"]));
  return doc(text(`What ${b.name} needs for ${section.toLowerCase()} at launch.`), bullets(["Decide the minimum for the first customer", "List the open questions as research tasks"]));
}

/** A lead sentence for sections that are otherwise only a list, so every section reads as prose first. */
function introFor(section: string, b: Brief): string {
  const key = section.toLowerCase();
  const intros: [RegExp, string][] = [
    [/non-?functional/, `The bar ${b.name} holds from the first release, before any feature counts as done.`],
    [/integration/, `Every integration runs through the platform gateway with ${b.name}'s own credentials, and none is required before the first paying customer.`],
    [/risk/, "The risks the team watches from day one, each with the evidence that would retire it."],
    [/retention/, "Customers come back when the product keeps paying off after the first week."],
    [/matching|trust/, "Both sides need to trust a stranger before the first transaction can happen."],
    [/manufactur/, "Production starts small and only after the samples pass the founder's review."],
    [/packag/, "Packaging protects the product in transit and carries the information the law requires."],
    [/complian/, "Compliance work that must be finished before the first sale; the founder signs where the law requires a person."],
    [/fulfil/, "How an order reaches the customer, and what the customer is promised at checkout."],
    [/firmware|app/, "The device and the app ship together and are updated together."],
  ];
  return intros.find(([re]) => re.test(key))?.[1] ?? `What ${b.name} commits to for ${section.toLowerCase()} in the first release, and what is still open.`;
}

/** A short block title per section (the prompt asks every section to open with one). */
function titleFor(section: string, b: Brief): string {
  const key = section.toLowerCase();
  const titles: [RegExp, string][] = [
    [/problem/, "The problem today"],
    [/customer/, "Who buys first"],
    [/value/, `Why ${b.name}`],
    [/feature/, "The first release"],
    [/non-?functional/, "The quality bar"],
    [/^data/, "What we keep"],
    [/integration/, "What we connect to"],
    [/pric/, "Starting price"],
    [/metric/, "How progress is measured"],
    [/risk/, "What could go wrong"],
    [/onboarding|activation/, "From sign-up to first result"],
    [/retention/, "Why customers come back"],
    [/fulfil/, "Getting it to customers"],
    [/manufactur/, "Making it"],
    [/formulation|bom/, "Formulation and parts"],
  ];
  return titles.find(([re]) => re.test(key))?.[1] ?? section;
}

function roadmapOf(b: Brief, outline: string[]): FoundationsRoadmapItem[] {
  const has = (word: string) => outline.find((s) => s.toLowerCase().includes(word));
  const features = has("feature") ?? outline[0]!;
  const metrics = has("metric");
  const pricing = has("pric");
  const customers = has("customer");
  const ns = NORTH_STAR[b.archetype];
  const [f1, f2, f3] = FEATURES(b);
  const items: FoundationsRoadmapItem[] = [
    { title: f1!.title, description: f1!.story, horizon: "now", sections: [features], acceptance_criteria: f1!.criteria, source_ref: null, confidence: 4 },
    { title: f2!.title, description: f2!.story, horizon: "now", sections: [features], acceptance_criteria: f2!.criteria, source_ref: null, confidence: 3 },
    { title: `Instrument ${ns.metric.toLowerCase()}`, description: `Record the events behind the north-star metric so progress is measured from day one.`, horizon: "now", sections: metrics ? [metrics] : [], acceptance_criteria: ["The metric is computed daily from real events", "The Home dashboard shows it with its definition"], source_ref: null, confidence: 4 },
  ];
  b.seeds.slice(0, 12).forEach((s, i) =>
    items.push({ title: s.title, description: `Imported from ${s.source}. Confirm the scope before it moves to Now.`, horizon: i < 2 ? "now" : "next", sections: [features], acceptance_criteria: [`The issue's expected behavior is covered by a test`, `${s.source} can be closed with a link to the change`], source_ref: s.source, confidence: 3 }),
  );
  items.push(
    { title: f3!.title, description: f3!.story, horizon: "next", sections: [features], acceptance_criteria: f3!.criteria, source_ref: null, confidence: 3 },
    { title: "Pricing experiment", description: `Test ${priceOf(b)} (Estimate) against one alternative with new sign-ups.`, horizon: "later", sections: pricing ? [pricing] : [], acceptance_criteria: [], source_ref: null, confidence: 2 },
    { title: "Second customer segment", description: `Decide whether to widen beyond ${b.audience} once the first segment retains.`, horizon: "later", sections: customers ? [customers] : [], acceptance_criteria: [], source_ref: null, confidence: 2 },
  );
  return items;
}

export function generateFoundations(ctx: MockContext): FoundationsOutput {
  const b = readBrief(ctx);
  const outline = outlineOf(ctx);
  const ns = NORTH_STAR[b.archetype];
  const target = ctx.rng.int(ns.range[0], ns.range[1]);
  const sections: FoundationsSection[] = outline.map((section) => {
    const body = sectionDoc(section, b).content;
    const lead = body[0]?.type === "paragraph" ? [] : [text(introFor(section, b))];
    return {
      section,
      content: { type: "doc", content: [heading(titleFor(section, b), 2), ...lead, ...body] } as TiptapDoc,
      source_refs: [...(b.imported ? ["Import report"] : ["Concept card"]), ...(section.toLowerCase().includes("feature") ? b.seeds.slice(0, 4).map((s) => s.source).filter(Boolean) : [])],
    };
  });
  return {
    vision: {
      statement: truncate(`${b.name} exists so that ${b.audience} can ${b.outcome}.`, 600),
      for_whom: truncate(`${sentenceCase(b.audience)} in ${b.markets}${b.constraints.length ? `, served within the founder's constraints (${b.constraints.slice(0, 2).join("; ")})` : ""}.`, 600),
      problem: truncate(`${sentenceCase(b.audience)} lose time and money doing this by hand, and the tools they have were built for someone else. ${b.risks[0] ?? ""}`.trim(), 1000),
      why_now: truncate(`AI agents can now do the repetitive part of the work reliably and cheaply, so a small team can serve this market well.${b.imported && b.exists.length ? ` ${b.name} is not starting from zero: ${b.exists.length} imported sources already describe the product and its customers.` : ""}`, 1000),
      principles: [
        { title: "First customer before scale", detail: "Every piece of work in the first chapter must move a real customer closer to paying." },
        { title: "Agents act, the founder decides", detail: "The team does the work inside clear limits; spending, signing and anything irreversible waits for the founder." },
        { title: "Every number has a source or a label", detail: "Facts cite where they came from; anything else says Estimate or Forecast." },
        { title: "Small, measured steps", detail: "Ship the smallest useful change, measure it, then widen." },
      ],
      north_star: { metric: ns.metric, definition: ns.definition, target: `${target} ${ns.unit} by the end of the second chapter (Forecast)`, label: "Forecast" },
    },
    sections,
    roadmap: roadmapOf(b, outline),
    open_questions: [`Which channel reaches ${b.audience} at an acceptable cost?`, "What would make a first customer pay on day one rather than after a trial?"],
  };
}
