/**
 * Founder profile form logic (BUILD §11.1 "Founder profile", AC-11.1.1; docs/UX_AUDIT_AND_PLAN.md §7.3). Pure: option
 * lists, the form ↔ API mapping (`founder.profile.update` takes the FounderProfilePatch shape from packages/db),
 * validation (the four first-pass answers: name, experience and time are required, where you live derives the
 * currency and the first market), the two-pass sections and chips. The screen (OnboardingScreen.tsx) only renders this.
 */
import { formatNumber } from "@/lib/format";

export const SKILL_KEYS = ["engineering", "sales", "design", "finance", "domain"] as const;
export type SkillKey = (typeof SKILL_KEYS)[number];

export const SKILL_LABELS: Record<SkillKey, { label: string; hint: string }> = {
  engineering: { label: "Engineering", hint: "Can you ship, review and run software?" },
  sales: { label: "Sales", hint: "Can you find, pitch and close customers?" },
  design: { label: "Design", hint: "Product, brand and interface judgment." },
  finance: { label: "Finance", hint: "Cash, pricing, forecasts, fundraising." },
  domain: { label: "Domain", hint: "How deep is your knowledge of the market you will enter?" },
};

export interface Option<V extends string = string> {
  value: V;
  label: string;
  description?: string;
}

export const EXPERIENCE_OPTIONS: Option[] = [
  { value: "first_time", label: "First-time founder", description: "This is the first business you run." },
  { value: "exited", label: "Exited founder", description: "You have built and sold or closed a business before." },
  { value: "operator", label: "Operator", description: "You have run teams, budgets or a business unit inside someone else's company." },
  { value: "domain_expert", label: "Domain expert", description: "Deep expertise in one field; the business is the vehicle." },
];

export const TIME_OPTIONS: Option[] = [
  { value: "full_time", label: "Full time", description: "40 hours a week or more." },
  { value: "part_time", label: "Part time", description: "15 to 30 hours a week." },
  { value: "evenings_weekends", label: "Evenings and weekends", description: "Around 10 hours a week." },
  { value: "few_hours", label: "A few hours a week", description: "The team does most of the work." },
];

export const RISK_OPTIONS: Option[] = [
  { value: "low", label: "Low", description: "Prefer steady, reversible moves and plenty of cash in hand." },
  { value: "medium", label: "Medium", description: "Take measured bets when the evidence is there." },
  { value: "high", label: "High", description: "Move fast, accept bigger swings for bigger outcomes." },
];

/** The currencies a profile (and a business, Settings › Business) can use: one list, in @foundmill/shared. */
export { CURRENCIES } from "@foundmill/shared/constants";

export const MARKET_SUGGESTIONS = ["EU", "UK", "US", "Nordics", "DACH", "France", "Benelux", "Canada", "Australia", "Global"] as const;

export const CONSTRAINT_SUGGESTIONS = ["Bootstrapped, no outside funding", "Remote only", "No physical inventory", "B2B only", "Must be profitable within a year", "Keep my day job for now", "No regulated industries", "English-speaking markets only"] as const;

/** A compact country list for citizenship and residence (free text is also accepted). */
export const COUNTRIES: readonly string[] = [
  "Austria", "Australia", "Belgium", "Brazil", "Canada", "Czechia", "Denmark", "Estonia", "Finland", "France", "Germany", "Greece", "Hungary", "Iceland", "India", "Ireland", "Israel", "Italy", "Japan", "Latvia", "Lithuania", "Luxembourg", "Mexico", "Netherlands", "New Zealand", "Nigeria", "Norway", "Poland", "Portugal", "Romania", "Singapore", "Slovakia", "Slovenia", "South Africa", "South Korea", "Spain", "Sweden", "Switzerland", "Türkiye", "Ukraine", "United Arab Emirates", "United Kingdom", "United States",
];

export interface ProfileForm {
  displayName: string;
  experience: string;
  skills: Record<SkillKey, number>;
  timeCommitment: string;
  /** Major units as typed ("25000", "25 000", "25k" are all accepted). */
  budget: string;
  /** "I have no budget yet": empty is a choice, not an omission (A11). Clears and disables the budget. */
  noBudget: boolean;
  currency: string;
  citizenship: string;
  residence: string;
  targetMarkets: string[];
  constraints: string[];
  riskAppetite: string;
}

/** The subset of the API's profile record the form reads. */
export interface ProfileLike {
  displayName: string;
  experience: string | null;
  skills: Record<string, number>;
  timeCommitment: string | null;
  budgetMinor: number | null;
  currency: string;
  citizenship: string | null;
  residence: string | null;
  targetMarkets: string[];
  constraints: string[];
  riskAppetite: string | null;
}

export const DEFAULT_SKILL = 10;

/* ---------- currency from where the founder lives (A11) ---------- */

/** The currency the profile starts on when neither the residence nor the browser's locale says otherwise. */
export const FALLBACK_CURRENCY = "USD";

const EURO_AREA = ["AT", "BE", "BG", "CY", "DE", "EE", "ES", "FI", "FR", "GR", "HR", "IE", "IT", "LT", "LU", "LV", "MT", "NL", "PT", "SI", "SK"] as const;
/** EU members outside the euro whose own currency the list does not offer: the euro is the nearest it has. */
const EU_WITHOUT_EURO = ["CZ", "HU", "PL", "RO"] as const;

/** Region code → the currency the profile offers (`CURRENCIES`); regions without a listed currency are absent. */
const REGION_CURRENCY: Record<string, string> = {
  GB: "GBP",
  US: "USD",
  SE: "SEK",
  NO: "NOK",
  DK: "DKK",
  CH: "CHF",
  CA: "CAD",
  AU: "AUD",
  ...Object.fromEntries([...EURO_AREA, ...EU_WITHOUT_EURO].map((r) => [r, "EUR"])),
};

/** Country names as typed in Residence (the `COUNTRIES` list and the usual short forms) → region code. */
const COUNTRY_REGION: Record<string, string> = {
  "united kingdom": "GB",
  uk: "GB",
  "great britain": "GB",
  britain: "GB",
  england: "GB",
  scotland: "GB",
  wales: "GB",
  "northern ireland": "GB",
  "united states": "US",
  "united states of america": "US",
  usa: "US",
  america: "US",
  austria: "AT",
  australia: "AU",
  belgium: "BE",
  bulgaria: "BG",
  brazil: "BR",
  canada: "CA",
  croatia: "HR",
  cyprus: "CY",
  czechia: "CZ",
  "czech republic": "CZ",
  denmark: "DK",
  estonia: "EE",
  finland: "FI",
  france: "FR",
  germany: "DE",
  greece: "GR",
  hungary: "HU",
  iceland: "IS",
  india: "IN",
  ireland: "IE",
  israel: "IL",
  italy: "IT",
  japan: "JP",
  latvia: "LV",
  lithuania: "LT",
  luxembourg: "LU",
  malta: "MT",
  mexico: "MX",
  netherlands: "NL",
  "the netherlands": "NL",
  "new zealand": "NZ",
  nigeria: "NG",
  norway: "NO",
  poland: "PL",
  portugal: "PT",
  romania: "RO",
  singapore: "SG",
  slovakia: "SK",
  slovenia: "SI",
  "south africa": "ZA",
  "south korea": "KR",
  spain: "ES",
  sweden: "SE",
  switzerland: "CH",
  türkiye: "TR",
  turkey: "TR",
  ukraine: "UA",
  "united arab emirates": "AE",
};

/** The currency for a residence as typed ("United Kingdom", "UK", "gb" → "GBP"; "Germany" → "EUR"); null when unknown or unlisted. */
export function currencyForCountry(country: string | null | undefined): string | null {
  const s = (country ?? "").trim().toLowerCase();
  if (!s) return null;
  const region = COUNTRY_REGION[s] ?? (/^[a-z]{2}$/.test(s) ? s.toUpperCase() : null);
  return region ? (REGION_CURRENCY[region] ?? null) : null;
}

/** The currency for a browser locale ("en-GB" → "GBP", "sv-SE" → "SEK", "de" → "EUR"); null when it says nothing usable. */
export function currencyForLocale(locale: string | null | undefined): string | null {
  if (!locale) return null;
  try {
    const region = new Intl.Locale(locale).maximize().region;
    return region ? (REGION_CURRENCY[region] ?? null) : null;
  } catch {
    return null;
  }
}

/** Residence first, then the browser's locale, then US dollars (A11). */
export function defaultCurrency(residence: string | null | undefined, locale?: string | null): string {
  return currencyForCountry(residence) ?? currencyForLocale(locale) ?? FALLBACK_CURRENCY;
}

/* ---------- the first market from where the founder lives (UX plan §7.3, two passes) ---------- */

/** The region code for a residence as typed ("United Kingdom", "uk", "GB" → "GB"); null when unknown. */
function regionOfCountry(country: string | null | undefined): string | null {
  const s = (country ?? "").trim().toLowerCase();
  if (!s) return null;
  return COUNTRY_REGION[s] ?? (/^[a-z]{2}$/.test(s) ? s.toUpperCase() : null);
}

const NORDIC_REGIONS: readonly string[] = ["SE", "NO", "DK", "FI", "IS"];
const DACH_REGIONS: readonly string[] = ["DE", "AT", "CH"];
const BENELUX_REGIONS: readonly string[] = ["BE", "NL", "LU"];
/** Region → market, in the suggestion list's own words, for the regions a group names. */
const REGION_MARKET: Record<string, string> = {
  GB: "UK",
  US: "US",
  CA: "Canada",
  AU: "Australia",
  FR: "France",
  ...Object.fromEntries(NORDIC_REGIONS.map((r) => [r, "Nordics"])),
  ...Object.fromEntries(DACH_REGIONS.map((r) => [r, "DACH"])),
  ...Object.fromEntries(BENELUX_REGIONS.map((r) => [r, "Benelux"])),
  ...Object.fromEntries([...EURO_AREA, ...EU_WITHOUT_EURO].filter((r) => !NORDIC_REGIONS.includes(r) && !DACH_REGIONS.includes(r) && !BENELUX_REGIONS.includes(r) && r !== "FR").map((r) => [r, "EU"])),
};

/** Region → the country's name as the `COUNTRIES` list spells it, for a residence outside every group ("JP" → "Japan"). */
const REGION_COUNTRY_NAME: Record<string, string> = Object.fromEntries(COUNTRIES.map((name) => [COUNTRY_REGION[name.toLowerCase()] ?? "", name]).filter(([region]) => region));

/**
 * The market the ideas aim at first when the founder names none (UX plan §7.3: where you live derives a default
 * market): the group a residence belongs to in the suggestion list's words ("United Kingdom" → "UK", "Germany" →
 * "DACH", "Spain" → "EU", "Sweden" → "Nordics"), else the country itself ("Japan"); null when the residence is empty
 * or unknown, so nothing is invented from a typo.
 */
export function defaultMarket(residence: string | null | undefined): string | null {
  const region = regionOfCountry(residence);
  if (!region) return null;
  return REGION_MARKET[region] ?? REGION_COUNTRY_NAME[region] ?? null;
}

/** The markets the profile saves: the founder's own, or the one derived from where they live, or none. */
export function effectiveTargetMarkets(form: Pick<ProfileForm, "targetMarkets" | "residence">): string[] {
  if (form.targetMarkets.length > 0) return form.targetMarkets;
  const derived = defaultMarket(form.residence);
  return derived ? [derived] : [];
}

export function emptyProfileForm(email?: string | null): ProfileForm {
  return {
    displayName: email ? displayNameFromEmail(email) : "",
    experience: "",
    skills: { engineering: DEFAULT_SKILL, sales: DEFAULT_SKILL, design: DEFAULT_SKILL, finance: DEFAULT_SKILL, domain: DEFAULT_SKILL },
    timeCommitment: "",
    budget: "",
    noBudget: false,
    currency: FALLBACK_CURRENCY,
    citizenship: "",
    residence: "",
    targetMarkets: [],
    constraints: [],
    riskAppetite: "medium",
  };
}

/** "reid.jackson@…" → "Reid Jackson". */
export function displayNameFromEmail(email: string): string {
  const local = email.split("@")[0] ?? "";
  return local
    .split(/[._\-+]+/)
    .filter(Boolean)
    .map((w) => w[0]!.toUpperCase() + w.slice(1))
    .join(" ");
}

export function clampSkill(v: number): number {
  if (!Number.isFinite(v)) return DEFAULT_SKILL;
  return Math.min(20, Math.max(1, Math.round(v)));
}

export function formFromProfile(profile: ProfileLike | null | undefined, email?: string | null): ProfileForm {
  const base = emptyProfileForm(email);
  if (!profile) return base;
  const skills = { ...base.skills };
  for (const key of SKILL_KEYS) if (typeof profile.skills?.[key] === "number") skills[key] = clampSkill(profile.skills[key]!);
  return {
    displayName: profile.displayName || base.displayName,
    experience: profile.experience ?? "",
    skills,
    timeCommitment: profile.timeCommitment ?? "",
    budget: profile.budgetMinor === null || profile.budgetMinor === undefined ? "" : String(profile.budgetMinor / 100),
    // A saved profile without a budget made that choice: it reads as "I have no budget yet".
    noBudget: profile.budgetMinor === null || profile.budgetMinor === undefined,
    currency: profile.currency || FALLBACK_CURRENCY,
    citizenship: profile.citizenship ?? "",
    residence: profile.residence ?? "",
    targetMarkets: [...(profile.targetMarkets ?? [])],
    constraints: [...(profile.constraints ?? [])],
    riskAppetite: profile.riskAppetite ?? "medium",
  };
}

/** "25k" → 2_500_000 minor; "25 000.50" → 2_500_050; "" → null; garbage → NaN. */
export function parseBudgetMinor(input: string): number | null {
  const s = input.trim().toLowerCase().replace(/[\s,_]/g, "");
  if (!s) return null;
  const m = /^(\d+(?:\.\d+)?)(k|m)?$/.exec(s);
  if (!m) return Number.NaN;
  let major = Number(m[1]);
  if (m[2] === "k") major *= 1_000;
  if (m[2] === "m") major *= 1_000_000;
  return Math.round(major * 100);
}

/** The longest each answer can be: the same limits packages/db/src/repos/founders.ts enforces, so the form refuses first. */
export const PROFILE_LIMITS = {
  displayName: 120,
  /** Citizenship, residence and each target market. */
  place: 80,
  /** Each constraint. */
  constraint: 400,
  /** The budget in whole currency units (the API stores it in minor units as a safe integer). */
  budgetMajor: 1_000_000_000_000,
} as const;

export type ProfileErrors = Partial<Record<keyof ProfileForm, string>>;

export function validateProfileForm(form: ProfileForm): ProfileErrors {
  const errors: ProfileErrors = {};
  if (form.displayName.trim().length === 0) errors.displayName = "Tell the team what to call you.";
  if (form.displayName.trim().length > PROFILE_LIMITS.displayName) errors.displayName = `Keep it under ${PROFILE_LIMITS.displayName} characters.`;
  if (!form.experience) errors.experience = "Pick the one that fits best.";
  if (!form.timeCommitment) errors.timeCommitment = "How much of your week does this get?";
  const budget = form.noBudget ? null : parseBudgetMinor(form.budget);
  if (Number.isNaN(budget)) errors.budget = "Use a number, like 25000 or 25k.";
  else if (budget !== null && budget < 0) errors.budget = "The budget cannot be negative.";
  else if (budget !== null && budget / 100 > PROFILE_LIMITS.budgetMajor) errors.budget = `Use a budget below ${formatNumber(PROFILE_LIMITS.budgetMajor, { maximumFractionDigits: 0 })}.`;
  if (form.citizenship.trim().length > PROFILE_LIMITS.place) errors.citizenship = `Keep it under ${PROFILE_LIMITS.place} characters.`;
  if (form.residence.trim().length > PROFILE_LIMITS.place) errors.residence = `Keep it under ${PROFILE_LIMITS.place} characters.`;
  if (!/^[A-Z]{3}$/.test(form.currency)) errors.currency = "Pick a currency.";
  // Markets are optional on the first pass: an empty list starts from where the founder lives (`effectiveTargetMarkets`).
  if (form.targetMarkets.some((m) => m.length > PROFILE_LIMITS.place)) errors.targetMarkets = `Keep each market under ${PROFILE_LIMITS.place} characters.`;
  if (form.constraints.some((c) => c.length > PROFILE_LIMITS.constraint)) errors.constraints = `Keep each constraint under ${PROFILE_LIMITS.constraint} characters.`;
  if (!form.riskAppetite) errors.riskAppetite = "Pick a risk appetite.";
  return errors;
}

export function isProfileValid(form: ProfileForm): boolean {
  return Object.keys(validateProfileForm(form)).length === 0;
}

/** The `founder.profile.update` input (every field optional on the wire; we send the whole form). */
export interface ProfilePatch {
  displayName: string;
  experience: string | null;
  skills: Record<string, number>;
  timeCommitment: string | null;
  budgetMinor: number | null;
  currency: string;
  citizenship: string | null;
  residence: string | null;
  targetMarkets: string[];
  constraints: string[];
  riskAppetite: string | null;
}

export function profilePatch(form: ProfileForm): ProfilePatch {
  const budget = form.noBudget ? null : parseBudgetMinor(form.budget);
  return {
    displayName: form.displayName.trim(),
    experience: form.experience || null,
    skills: Object.fromEntries(SKILL_KEYS.map((k) => [k, clampSkill(form.skills[k])])),
    timeCommitment: form.timeCommitment || null,
    budgetMinor: budget === null || Number.isNaN(budget) ? null : budget,
    currency: form.currency,
    citizenship: form.citizenship.trim() || null,
    residence: form.residence.trim() || null,
    targetMarkets: effectiveTargetMarkets(form),
    constraints: form.constraints,
    riskAppetite: form.riskAppetite || null,
  };
}

export const MAX_CHIPS = 20;

/** Add a chip: trimmed, de-duplicated case-insensitively, capped. Returns the same array when nothing changes. */
export function addChip(list: readonly string[], raw: string, max = MAX_CHIPS, maxLength: number = PROFILE_LIMITS.constraint): string[] {
  const value = raw.trim().replace(/\s+/g, " ");
  if (!value || value.length > maxLength) return [...list];
  if (list.some((x) => x.toLowerCase() === value.toLowerCase())) return [...list];
  if (list.length >= max) return [...list];
  return [...list, value];
}

export function removeChip(list: readonly string[], value: string): string[] {
  return list.filter((x) => x !== value);
}

export function toggleChip(list: readonly string[], value: string, max = MAX_CHIPS, maxLength: number = PROFILE_LIMITS.constraint): string[] {
  return list.some((x) => x.toLowerCase() === value.toLowerCase()) ? removeChip(list, list.find((x) => x.toLowerCase() === value.toLowerCase())!) : addChip(list, value, max, maxLength);
}

/** The answers the API names in its validation issues, in the founder's words (never the API's field names). */
const ANSWER_NAMES: Record<string, string> = {
  displayName: "your name",
  experience: "experience",
  skills: "skills",
  timeCommitment: "time commitment",
  budgetMinor: "budget",
  currency: "currency",
  citizenship: "citizenship",
  residence: "residence",
  targetMarkets: "target markets",
  constraints: "constraints",
  riskAppetite: "risk appetite",
};

/**
 * What a refused save says: the answers the API did not accept, once each, by name ("budget, citizenship"), with what to
 * do. The API's own Zod text ("budgetMinor: Too big: expected int to be <=9007199254740991") never reaches the screen.
 */
export function profileSaveMessage(issues: readonly { path?: readonly (string | number)[] }[] | null, fallback: string): string {
  if (!issues?.length) return fallback;
  const names = [...new Set(issues.map((i) => ANSWER_NAMES[String(i.path?.[0] ?? "")]).filter((n): n is string => Boolean(n)))];
  if (names.length === 0) return fallback;
  return `These answers were not accepted: ${names.join(", ")}. Shorten or correct them, then save again.`;
}

/**
 * The two passes of the profile (UX plan §7.3, A1): four questions first (your name, experience, time, where you live),
 * then one optional section, "Add detail", with skills, budget, target markets, constraints and risk. The rail lists
 * the four and the optional section as one: "N of 5 done".
 */
export const PROFILE_SECTIONS = [
  { id: "name", label: "Your name" },
  { id: "experience", label: "Experience" },
  { id: "time", label: "Time you can give" },
  { id: "place", label: "Where you live" },
  { id: "detail", label: "Add detail (optional)" },
] as const;
export type ProfileSectionId = (typeof PROFILE_SECTIONS)[number]["id"];

/** The optional section's title on the form. */
export const DETAIL_SECTION_TITLE = "Add detail (optional, improves the ideas)";

/** The experiences for which "Add detail" opens by default: a founder who has done this before has the answers ready. */
export const DETAIL_OPEN_EXPERIENCES: readonly string[] = ["exited", "operator"];

export function detailOpenByDefault(experience: string | null | undefined): boolean {
  return typeof experience === "string" && DETAIL_OPEN_EXPERIENCES.includes(experience);
}

/** The browser key under which an account's own choice to open or close "Add detail" is kept (one per account). */
export function detailStorageKey(accountId: string | null | undefined): string {
  return `foundmill.profile.detail.${accountId ?? "account"}`;
}

/** True once the founder answered anything in "Add detail": a skill moved, a budget (or none) given, a market or a constraint added. */
export function detailAnswered(form: ProfileForm): boolean {
  return form.noBudget || form.budget.trim().length > 0 || form.targetMarkets.length > 0 || form.constraints.length > 0 || SKILL_KEYS.some((k) => form.skills[k] !== DEFAULT_SKILL);
}

/** Which sections are complete, for the progress rail: the four questions by their answers, the optional one once anything in it is answered. */
export function sectionStatus(form: ProfileForm): Record<ProfileSectionId, boolean> {
  const errors = validateProfileForm(form);
  return {
    name: !errors.displayName,
    experience: !errors.experience,
    time: !errors.timeCommitment,
    place: !errors.residence && !errors.citizenship && form.residence.trim().length > 0,
    detail: detailAnswered(form) && !errors.budget && !errors.currency && !errors.targetMarkets && !errors.constraints && !errors.riskAppetite,
  };
}

/** The section that holds each answer, for scrolling to the first one that refuses to save. */
const SECTION_OF_FIELD: Record<keyof ProfileErrors, ProfileSectionId> = {
  displayName: "name",
  experience: "experience",
  timeCommitment: "time",
  citizenship: "place",
  residence: "place",
  skills: "detail",
  budget: "detail",
  noBudget: "detail",
  currency: "detail",
  targetMarkets: "detail",
  constraints: "detail",
  riskAppetite: "detail",
};

/** The first section, in page order, with an answer that refuses to save; null when every answer is fine. */
export function firstInvalidSection(errors: ProfileErrors): ProfileSectionId | null {
  const sections = new Set((Object.keys(errors) as (keyof ProfileErrors)[]).map((k) => SECTION_OF_FIELD[k]));
  return PROFILE_SECTIONS.find((s) => sections.has(s.id))?.id ?? null;
}

/* ---------- the example founder (UX plan §6.2 ExampleToggle, Phase 3) ---------- */

/** The answers "Show me an example" fills: every one but the founder's own name. */
export const EXAMPLE_PROFILE_KEYS = ["experience", "timeCommitment", "citizenship", "residence", "skills", "budget", "noBudget", "currency", "targetMarkets", "constraints", "riskAppetite"] as const;
export type ExampleProfileKey = (typeof EXAMPLE_PROFILE_KEYS)[number];

/**
 * A labeled example founder: first time, evenings and weekends, £5,000 of their own money, living in the United
 * Kingdom and aiming at the UK and Ireland, keeping their day job and holding no stock, with a low appetite for risk.
 * The skills show one of each band word, so the legend has something to point at.
 */
export const EXAMPLE_PROFILE: Readonly<Pick<ProfileForm, ExampleProfileKey>> = {
  experience: "first_time",
  timeCommitment: "evenings_weekends",
  citizenship: "United Kingdom",
  residence: "United Kingdom",
  skills: { engineering: 8, sales: 12, design: 7, finance: 4, domain: 16 },
  budget: "5000",
  noBudget: false,
  currency: "GBP",
  targetMarkets: ["UK", "Ireland"],
  constraints: ["Keep my day job for now", "No physical inventory"],
  riskAppetite: "low",
};

const sameList = (a: readonly string[], b: readonly string[]) => a.length === b.length && a.every((x, i) => x === b[i]);

/** The form with the example founder's answers in place of the founder's own; the name stays theirs. */
export function fillExampleProfile(form: ProfileForm): ProfileForm {
  return { ...form, ...EXAMPLE_PROFILE, skills: { ...EXAMPLE_PROFILE.skills }, targetMarkets: [...EXAMPLE_PROFILE.targetMarkets], constraints: [...EXAMPLE_PROFILE.constraints] };
}

/**
 * The form after "Hide the example": every answer still holding the example's value goes back to what it was before
 * the example (`before`), skill by skill; an answer the founder changed while the example was in stays theirs.
 */
export function clearExampleProfile(form: ProfileForm, before: ProfileForm): ProfileForm {
  const next: ProfileForm = { ...form, skills: { ...form.skills } };
  for (const key of SKILL_KEYS) if (form.skills[key] === EXAMPLE_PROFILE.skills[key]) next.skills[key] = before.skills[key];
  if (form.experience === EXAMPLE_PROFILE.experience) next.experience = before.experience;
  if (form.timeCommitment === EXAMPLE_PROFILE.timeCommitment) next.timeCommitment = before.timeCommitment;
  if (form.citizenship === EXAMPLE_PROFILE.citizenship) next.citizenship = before.citizenship;
  if (form.residence === EXAMPLE_PROFILE.residence) next.residence = before.residence;
  // The budget and "I have no budget yet" are one answer.
  if (form.budget === EXAMPLE_PROFILE.budget && form.noBudget === EXAMPLE_PROFILE.noBudget) {
    next.budget = before.budget;
    next.noBudget = before.noBudget;
  }
  if (form.currency === EXAMPLE_PROFILE.currency) next.currency = before.currency;
  if (sameList(form.targetMarkets, EXAMPLE_PROFILE.targetMarkets)) next.targetMarkets = [...before.targetMarkets];
  if (sameList(form.constraints, EXAMPLE_PROFILE.constraints)) next.constraints = [...before.constraints];
  if (form.riskAppetite === EXAMPLE_PROFILE.riskAppetite) next.riskAppetite = before.riskAppetite;
  return next;
}

/** One line the Ideation Studio shows back: "First-time founder · full time · EUR 25,000 · EU, UK". */
export function profileSummary(form: ProfileForm): string {
  const parts: string[] = [];
  const exp = EXPERIENCE_OPTIONS.find((o) => o.value === form.experience)?.label;
  if (exp) parts.push(exp);
  const time = TIME_OPTIONS.find((o) => o.value === form.timeCommitment)?.label;
  if (time) parts.push(time.toLowerCase());
  const budget = form.noBudget ? null : parseBudgetMinor(form.budget);
  if (budget !== null && !Number.isNaN(budget)) parts.push(`${form.currency} ${formatNumber(budget / 100, { maximumFractionDigits: 0 })}`);
  const markets = effectiveTargetMarkets(form);
  if (markets.length) parts.push(markets.join(", "));
  return parts.join(" · ");
}
