/**
 * Founder profile form logic (BUILD §11.1 "Founder profile", AC-11.1.1). Pure: option lists, the form ↔ API
 * mapping (`founder.profile.update` takes the FounderProfilePatch shape from packages/db), validation and chips.
 * The screen (OnboardingScreen.tsx) only renders this.
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
  { value: "operator", label: "Operator", description: "You have run teams, budgets or P&Ls inside someone else's company." },
  { value: "domain_expert", label: "Domain expert", description: "Deep expertise in one field; the business is the vehicle." },
];

export const TIME_OPTIONS: Option[] = [
  { value: "full_time", label: "Full time", description: "40 hours a week or more." },
  { value: "part_time", label: "Part time", description: "15 to 30 hours a week." },
  { value: "evenings_weekends", label: "Evenings and weekends", description: "Around 10 hours a week." },
  { value: "few_hours", label: "A few hours a week", description: "The team does most of the work." },
];

export const RISK_OPTIONS: Option[] = [
  { value: "low", label: "Low", description: "Prefer steady, reversible moves and a long runway." },
  { value: "medium", label: "Medium", description: "Take measured bets when the evidence is there." },
  { value: "high", label: "High", description: "Move fast, accept bigger swings for bigger outcomes." },
];

export const CURRENCIES = ["EUR", "USD", "GBP", "SEK", "NOK", "DKK", "CHF", "CAD", "AUD"] as const;

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

export function emptyProfileForm(email?: string | null): ProfileForm {
  return {
    displayName: email ? displayNameFromEmail(email) : "",
    experience: "",
    skills: { engineering: DEFAULT_SKILL, sales: DEFAULT_SKILL, design: DEFAULT_SKILL, finance: DEFAULT_SKILL, domain: DEFAULT_SKILL },
    timeCommitment: "",
    budget: "",
    currency: "EUR",
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
    currency: profile.currency || "EUR",
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
  const budget = parseBudgetMinor(form.budget);
  if (Number.isNaN(budget)) errors.budget = "Use a number, like 25000 or 25k.";
  else if (budget !== null && budget < 0) errors.budget = "The budget cannot be negative.";
  else if (budget !== null && budget / 100 > PROFILE_LIMITS.budgetMajor) errors.budget = `Use a budget below ${formatNumber(PROFILE_LIMITS.budgetMajor, { maximumFractionDigits: 0 })}.`;
  if (form.citizenship.trim().length > PROFILE_LIMITS.place) errors.citizenship = `Keep it under ${PROFILE_LIMITS.place} characters.`;
  if (form.residence.trim().length > PROFILE_LIMITS.place) errors.residence = `Keep it under ${PROFILE_LIMITS.place} characters.`;
  if (!/^[A-Z]{3}$/.test(form.currency)) errors.currency = "Pick a currency.";
  if (form.targetMarkets.length === 0) errors.targetMarkets = "Add at least one market.";
  else if (form.targetMarkets.some((m) => m.length > PROFILE_LIMITS.place)) errors.targetMarkets = `Keep each market under ${PROFILE_LIMITS.place} characters.`;
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
  const budget = parseBudgetMinor(form.budget);
  return {
    displayName: form.displayName.trim(),
    experience: form.experience || null,
    skills: Object.fromEntries(SKILL_KEYS.map((k) => [k, clampSkill(form.skills[k])])),
    timeCommitment: form.timeCommitment || null,
    budgetMinor: budget === null || Number.isNaN(budget) ? null : budget,
    currency: form.currency,
    citizenship: form.citizenship.trim() || null,
    residence: form.residence.trim() || null,
    targetMarkets: form.targetMarkets,
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

export const PROFILE_SECTIONS = [
  { id: "identity", label: "Who you are" },
  { id: "skills", label: "Skills" },
  { id: "time", label: "Time and budget" },
  { id: "place", label: "Where you operate" },
  { id: "constraints", label: "Constraints and risk" },
] as const;
export type ProfileSectionId = (typeof PROFILE_SECTIONS)[number]["id"];

/** Which sections are complete, for the progress rail. */
export function sectionStatus(form: ProfileForm): Record<ProfileSectionId, boolean> {
  const errors = validateProfileForm(form);
  return {
    identity: !errors.displayName && !errors.experience,
    skills: true,
    time: !errors.timeCommitment && !errors.budget && !errors.currency,
    place: !errors.targetMarkets && !errors.citizenship && !errors.residence,
    constraints: !errors.riskAppetite && !errors.constraints,
  };
}

/** One line the Ideation Studio shows back: "First-time founder · full time · EUR 25,000 · EU, UK". */
export function profileSummary(form: ProfileForm): string {
  const parts: string[] = [];
  const exp = EXPERIENCE_OPTIONS.find((o) => o.value === form.experience)?.label;
  if (exp) parts.push(exp);
  const time = TIME_OPTIONS.find((o) => o.value === form.timeCommitment)?.label;
  if (time) parts.push(time.toLowerCase());
  const budget = parseBudgetMinor(form.budget);
  if (budget !== null && !Number.isNaN(budget)) parts.push(`${form.currency} ${formatNumber(budget / 100, { maximumFractionDigits: 0 })}`);
  if (form.targetMarkets.length) parts.push(form.targetMarkets.join(", "));
  return parts.join(" · ");
}
