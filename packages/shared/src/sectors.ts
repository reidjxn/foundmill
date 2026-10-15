/**
 * Regulated-sector gates (BUILD §11.11, §15: health, finance, legal services, food, cosmetics, children): what each
 * sector's gate covers, what the team does not do while it is open, and its checklist. One catalogue for Legal ›
 * Regulatory (packages/modules), the api that stores the founder's choices (`legal.regulatory.*`) and the
 * orchestrator's business brief, which tells the team about every open gate.
 */
import { ARCHETYPE_LABELS, type Archetype } from "./constants";

export type SectorKey = "health" | "finance" | "legal_services" | "food" | "cosmetics" | "children";
export const SECTOR_KEYS: readonly SectorKey[] = ["health", "finance", "legal_services", "food", "cosmetics", "children"];

export interface SectorChecklistItem {
  id: string;
  title: string;
  /** The founder performs identity-bound steps; the team prepares ("squad" is the stored key). */
  owner: "founder" | "squad";
  detail: string;
}

export interface SectorGate {
  key: SectorKey;
  label: string;
  /** What triggers the gate. */
  summary: string;
  /**
   * Words in the business name, pitch or glossary that suggest the sector, matched as whole words (a plural "s" or
   * "es" allowed); a trailing `*` matches the start of a word ("diagnos*" → "diagnosis"), and a phrase matches its
   * words in a row. "tea" never matches "team", nor "hair" "chair".
   */
  keywords: readonly string[];
  /** Archetypes that often fall into the sector. */
  archetypes: readonly Archetype[];
  /** What the team will not do until the gate is cleared. */
  blocked: readonly string[];
  checklist: readonly SectorChecklistItem[];
}

export const SECTOR_GATES: Record<SectorKey, SectorGate> = {
  health: {
    key: "health",
    label: "Health",
    summary: "Products or advice that touch diagnosis, treatment, supplements or medical devices.",
    keywords: ["health", "medical", "clinic", "patient", "therapy", "therapies", "doctor", "pharma*", "supplement", "diagnos*", "wellness", "mental"],
    archetypes: [],
    blocked: ["Publishing health claims", "Collecting health data before a lawful basis is recorded", "Running paid acquisition for medical claims"],
    checklist: [
      { id: "classification", title: "Classify the product (medical device, supplement, wellness, software as a medical device)", owner: "squad", detail: "Prepares a classification memo with the regulator's definitions (MDR/FDA) for a professional to confirm." },
      { id: "claims", title: "Review every health claim against the allowed list", owner: "squad", detail: "Flags claims that imply diagnosis, cure or treatment; the founder decides what stays." },
      { id: "health-data", title: "Record the lawful basis for health data and a DPIA", owner: "founder", detail: "Special-category data needs explicit consent or another Article 9 basis; the DPIA is signed by the founder." },
      { id: "professional", title: "Appoint a regulatory professional", owner: "founder", detail: "Partner professionals are offered; the engagement letter is signed by the founder." },
    ],
  },
  finance: {
    key: "finance",
    label: "Finance",
    summary: "Holding, moving or advising on other people's money: payments, lending, investments, crypto.",
    keywords: ["bank", "banking", "lending", "loan", "invest*", "payment", "wallet", "crypto", "insurance", "credit", "fintech", "trading", "remittance"],
    archetypes: [],
    blocked: ["Taking customer funds before a license or an agent arrangement exists", "Marketing regulated products", "Giving investment advice"],
    checklist: [
      { id: "perimeter", title: "Map the activity against the licensing perimeter", owner: "squad", detail: "Prepares a perimeter memo: which activities need authorization (payments, e-money, lending, advice) and which can run under a partner's license." },
      { id: "partner", title: "Choose a licensed partner or apply for authorization", owner: "founder", detail: "Applications and agent agreements are filed and signed by the founder." },
      { id: "aml", title: "Write the AML/KYC policy and appoint an MLRO", owner: "founder", detail: "The team drafts; the founder appoints the officer and adopts the policy." },
      { id: "promotions", title: "Financial promotions sign-off", owner: "founder", detail: "Every public claim about returns, rates or safety is approved by a person before publication." },
    ],
  },
  legal_services: {
    key: "legal_services",
    label: "Legal services",
    summary: "Advice, documents or representation that count as reserved legal activities.",
    keywords: ["legal", "law", "lawyer", "attorney", "solicitor", "notary", "contract review", "litigation", "immigration"],
    archetypes: [],
    blocked: ["Presenting agent output as legal advice", "Reserved activities such as representation or conveyancing"],
    checklist: [
      { id: "reserved", title: "Separate information from reserved legal activities", owner: "squad", detail: "Lists what the product does and marks anything a regulator reserves for licensed practitioners." },
      { id: "supervision", title: "Name the supervising qualified lawyer", owner: "founder", detail: "Where advice is given, a qualified person supervises and is named on the site." },
      { id: "disclaimers", title: "Information-not-advice wording on every output", owner: "squad", detail: "The caption is mandatory in the product, emails and agent prose." },
      { id: "insurance", title: "Professional indemnity insurance", owner: "founder", detail: "Quotes prepared by the team; the policy is taken out by the founder." },
    ],
  },
  food: {
    key: "food",
    label: "Food and drink",
    summary: "Making, labeling or selling food, drink or supplements.",
    keywords: ["food", "drink", "beverage", "snack", "coffee", "tea", "meal", "kitchen", "restaurant", "grocery", "nutrition"],
    archetypes: ["dtc_physical"],
    blocked: ["Selling before registration with the food authority", "Publishing nutrition or health claims that are not on the permitted list"],
    checklist: [
      { id: "registration", title: "Register the food business with the local authority", owner: "founder", detail: "Registration is in the founder's name; the team prepares the form." },
      { id: "labelling", title: "Labeling check: allergens, ingredients, nutrition, origin", owner: "squad", detail: "Prepares a label checklist per product against the rules of each target market." },
      { id: "haccp", title: "Food safety plan (HACCP)", owner: "squad", detail: "Drafts the hazard analysis for the founder to adopt and train staff on." },
      { id: "claims", title: "Nutrition and health claims review", owner: "squad", detail: "Flags claims that need authorization before use." },
    ],
  },
  cosmetics: {
    key: "cosmetics",
    label: "Cosmetics",
    summary: "Skincare, make-up, fragrance and personal care products.",
    keywords: ["skincare", "skin", "cosmetic", "beauty", "serum", "cream", "fragrance", "perfume", "make up", "makeup", "hair", "haircare", "lotion"],
    archetypes: ["dtc_physical"],
    blocked: ["Selling before the product information file and safety assessment exist", "Claims that imply a medicinal effect"],
    checklist: [
      { id: "safety", title: "Cosmetic product safety report by a qualified assessor", owner: "founder", detail: "The team briefs the assessor; the founder engages them and signs the responsible-person declaration." },
      { id: "pif", title: "Product information file", owner: "squad", detail: "Assembles formulation, manufacturing method, safety report and labeling evidence per product." },
      { id: "notification", title: "Notify the product (CPNP / SCPN / FDA listing)", owner: "founder", detail: "Portal accounts and notifications are in the responsible person's name." },
      { id: "claims", title: "Claims and labeling review", owner: "squad", detail: "INCI list, warnings, period after opening, and substantiation for every claim." },
    ],
  },
  children: {
    key: "children",
    label: "Children's products",
    summary: "Products or services for children, or an audience that includes under-16s.",
    keywords: ["kids", "child", "children", "toy", "toys", "school", "teen", "baby", "infant", "parent", "family"],
    archetypes: [],
    blocked: ["Collecting personal data from children without verified parental consent", "Behavioral advertising to children", "Selling toys before safety testing and marking"],
    checklist: [
      { id: "age", title: "Age gate and parental consent flow", owner: "squad", detail: "Designs the age check and consent flow; the founder decides the age threshold per market (13 to 16)." },
      { id: "data", title: "Children's data: minimize, no profiling, age-appropriate design", owner: "squad", detail: "Checks every data flow against the age-appropriate design code and COPPA." },
      { id: "safety", title: "Toy or product safety testing and marking (CE/UKCA/ASTM)", owner: "founder", detail: "Test reports are commissioned and the declaration of conformity is signed by the founder." },
      { id: "marketing", title: "No behavioral advertising to children", owner: "squad", detail: "Campaign agents are configured with the restriction." },
    ],
  },
};

export interface SectorHit {
  key: SectorKey;
  /** Why the sector was suggested. */
  reasons: string[];
}

/** Lower case, accents and punctuation gone, single spaces: "Northwind Skin-Care, Ltd." → "northwind skin care ltd". */
function normalizeText(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9 ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Whether `keyword` (see `SectorGate.keywords`) occurs as a word or phrase in the normalized `text`. */
export function mentionsKeyword(text: string, keyword: string): boolean {
  const words = text.split(" ").filter(Boolean);
  if (keyword.endsWith("*")) {
    const stem = keyword.slice(0, -1);
    return words.some((w) => w.startsWith(stem));
  }
  if (keyword.includes(" ")) return ` ${text} `.includes(` ${keyword} `);
  return words.some((w) => w === keyword || w === `${keyword}s` || w === `${keyword}es`);
}

/** Sectors the business's name, pitch, glossary and archetype suggest. The founder confirms; this never decides alone. */
export function detectSectors(input: { name: string; pitch?: string | null; archetype: Archetype | null; glossary?: Record<string, string> }): SectorHit[] {
  const text = normalizeText([input.name, input.pitch ?? "", ...Object.values(input.glossary ?? {})].join(" "));
  const hits: SectorHit[] = [];
  for (const key of SECTOR_KEYS) {
    const gate = SECTOR_GATES[key];
    const reasons: string[] = [];
    const words = gate.keywords.filter((k) => mentionsKeyword(text, k)).map((k) => k.replace(/\*$/, ""));
    if (words.length) reasons.push(`mentions ${words.map((w) => `"${w}"`).join(", ")}`);
    if (input.archetype && gate.archetypes.includes(input.archetype)) reasons.push(`common for ${ARCHETYPE_LABELS[input.archetype] ?? input.archetype} businesses`);
    if (reasons.length) hits.push({ key, reasons });
  }
  return hits;
}

export type GateState = "clear" | "open" | "not_applicable";

/** A gate is open while any checklist item is unchecked; clear once all are done; not applicable when the sector is off. */
export function gateState(key: SectorKey, selected: ReadonlySet<SectorKey>, done: ReadonlySet<string>): GateState {
  if (!selected.has(key)) return "not_applicable";
  const items = SECTOR_GATES[key].checklist;
  return items.every((i) => done.has(`${key}:${i.id}`)) ? "clear" : "open";
}

/** A business's stored choice for one sector (`regulatory_gates`): whether it applies, and the checklist items done. */
export interface SectorChoice {
  sector: string;
  applies: boolean;
  done: readonly string[];
}

/**
 * The sectors that apply and the checklist items done, from the founder's stored choices; a sector without a choice
 * falls back to the suggestion (`detected`), so a suggested gate is open until the founder says otherwise.
 */
export function sectorSelection(choices: readonly SectorChoice[], detected: readonly SectorKey[]): { selected: Set<SectorKey>; done: Set<string> } {
  const byKey = new Map(choices.map((c) => [c.sector, c]));
  const selected = new Set<SectorKey>(SECTOR_KEYS.filter((k) => byKey.get(k)?.applies ?? detected.includes(k)));
  const done = new Set<string>(choices.flatMap((c) => c.done.map((id) => `${c.sector}:${id}`)));
  return { selected, done };
}

/** The open gates of a business and what the team must not do under each (for the brief and the screen). */
export function openSectorGates(choices: readonly SectorChoice[], detected: readonly SectorKey[]): SectorGate[] {
  const { selected, done } = sectorSelection(choices, detected);
  return SECTOR_KEYS.filter((k) => gateState(k, selected, done) === "open").map((k) => SECTOR_GATES[k]);
}
