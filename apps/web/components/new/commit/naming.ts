/**
 * Commit screen logic (BUILD §11.1 "Commit screen", AC-11.1.6, AC-11.1.7). Pure.
 *
 * Name suggestions, domain candidates, the USPTO/EUIPO quick screen ("screen, not legal clearance"), hex handling,
 * the kit-on-primary contrast check (APCA Lc ≥ 75 from Dugout), colour extraction from an uploaded logo's pixels, and
 * the mode/archetype catalogues. The domain and trademark screens are local heuristics labelled "Estimate" until the
 * API gains `idea.domainCheck` / `idea.trademarkScreen` (the screen tries those first and falls back here).
 */
import { LIMITS } from "@foundmill/config";
import { apcaLc, createRng, hexToRgb, hslToRgb, isHexColour, kitOnPrimaryDetail, rgbToHex, rgbToHsl, type Kit } from "@foundmill/dugout";
import { ARCHETYPE_LABELS, slugify, type Archetype, type BusinessMode, type GameMode } from "@foundmill/shared";

export const HEX_RE = /^#[0-9a-fA-F]{6}$/;

/** "1b4fd8", "#1B4FD8", "#1b4" → "#1b4fd8" / "#11bb44"; null when it is not a colour. */
export function normaliseHex(input: string): string | null {
  let s = input.trim();
  if (!s.startsWith("#")) s = `#${s}`;
  if (/^#[0-9a-fA-F]{3}$/.test(s)) s = `#${s[1]}${s[1]}${s[2]}${s[2]}${s[3]}${s[3]}`;
  return HEX_RE.test(s) ? s.toLowerCase() : null;
}

/* ---------- names ---------- */

const STOP = new Set(["the", "a", "an", "for", "of", "and", "to", "in", "on", "with", "by", "that", "who", "their", "your", "our", "is", "are", "it", "at", "as", "or", "from", "into", "through", "helps", "help", "built", "around", "every", "each", "this"]);
const SUFFIXES = ["Labs", "HQ", "Works", "Studio", "Base"];

export function keywordsOf(text: string, max = 6): string[] {
  const out: string[] = [];
  for (const raw of text.toLowerCase().split(/[^a-z0-9]+/)) {
    if (raw.length < 4 || STOP.has(raw) || out.includes(raw)) continue;
    out.push(raw);
    if (out.length >= max) break;
  }
  return out;
}

function cap(s: string): string {
  return s ? s[0]!.toUpperCase() + s.slice(1) : s;
}

/** Six deterministic name suggestions from the concept title, pitch and archetype. */
export function nameSuggestions(title: string, pitch: string, archetype: Archetype | null): string[] {
  const base = title.trim().replace(/\s*\(fork\)\s*$/i, "").replace(/\s*×\s*.*$/, "").trim();
  const rng = createRng(`names:${base}:${archetype ?? ""}`);
  const kws = keywordsOf(pitch).filter((k) => !base.toLowerCase().includes(k));
  const first = base.split(/\s+/)[0] ?? base;
  const candidates: string[] = [];
  const push = (s: string) => {
    const v = s.trim();
    if (v && v.length <= 40 && !candidates.some((c) => c.toLowerCase() === v.toLowerCase())) candidates.push(v);
  };
  push(base);
  push(`${first} ${rng.pick(SUFFIXES)}`);
  if (kws[0]) push(`${cap(kws[0])} ${first}`);
  if (kws[1]) push(`${first} ${cap(kws[1])}`);
  push(`Get ${first}`);
  if (archetype === "b2b_saas" || archetype === "marketplace") push(`${first} Cloud`);
  if (archetype === "dtc_physical" || archetype === "hardware") push(`${first} & Co`);
  if (archetype === "content_media") push(`The ${first} Letter`);
  if (archetype === "services") push(`${first} Partners`);
  if (archetype === "consumer_app") push(`${first} App`);
  push(`${first}ly`.replace(/yly$/, "ily"));
  return candidates.slice(0, 6);
}

/* ---------- domains ---------- */

export const DOMAIN_TLDS = [".com", ".io", ".co", ".app", ".ai"] as const;

export function domainSlug(name: string): string {
  if (!name.trim()) return "";
  return slugify(name).replace(/-/g, "");
}

export function domainCandidates(name: string): string[] {
  const slug = domainSlug(name);
  if (!slug) return [];
  return DOMAIN_TLDS.map((tld) => `${slug}${tld}`);
}

export type DomainStatus = "available" | "taken" | "premium";

export interface DomainCheck {
  domain: string;
  status: DomainStatus;
  /** Local heuristics are estimates; a registrar answer is "Registrar". */
  provenance: "Estimate" | "Registrar";
}

const COMMON_WORDS = new Set(["app", "cloud", "shop", "store", "bank", "pay", "mail", "news", "home", "work", "team", "data", "code", "labs", "studio", "base", "get", "my", "the", "go", "one", "hub", "box", "bit", "net", "web", "air", "sky", "sun", "fit", "run", "ledger", "northwind"]);

/** Deterministic screen: short or common names read as taken on .com, long specific ones as available. */
export function screenDomain(domain: string): DomainCheck {
  const [label = "", tld = ""] = domain.split(/\.(?=[a-z]+$)/);
  const rng = createRng(`domain:${domain}`);
  const common = COMMON_WORDS.has(label) || label.length <= 4;
  let status: DomainStatus;
  if (tld === "com") status = common ? "taken" : label.length <= 7 ? (rng.bool(0.6) ? "taken" : "premium") : rng.bool(0.25) ? "taken" : "available";
  else if (tld === "io" || tld === "ai") status = common ? (rng.bool(0.7) ? "taken" : "premium") : rng.bool(0.2) ? "taken" : "available";
  else status = common ? (rng.bool(0.4) ? "taken" : "available") : "available";
  return { domain, status, provenance: "Estimate" };
}

/* ---------- trademark quick screen ---------- */

export type TrademarkRegistry = "USPTO" | "EUIPO";
export type TrademarkStatus = "clear" | "similar" | "conflict";

export interface TrademarkScreen {
  registry: TrademarkRegistry;
  status: TrademarkStatus;
  /** Similar marks found (words), empty when clear. */
  similar: string[];
  /** Always shown next to the result. */
  caveat: "Screen, not legal clearance";
  provenance: "Estimate" | "Registry";
}

const KNOWN_MARKS = ["apple", "stripe", "shopify", "notion", "linear", "slack", "google", "amazon", "nike", "tesla", "ledger", "mint", "wave", "sage", "xero", "intuit", "square", "atlas", "monzo", "revolut"];

export function trademarkScreen(name: string): TrademarkScreen[] {
  const words = name.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length >= 3);
  return (["USPTO", "EUIPO"] as const).map((registry) => {
    const rng = createRng(`tm:${registry}:${name.toLowerCase()}`);
    const conflicts = words.filter((w) => KNOWN_MARKS.includes(w));
    if (conflicts.length) return { registry, status: "conflict", similar: conflicts.map((c) => c.toUpperCase()), caveat: "Screen, not legal clearance", provenance: "Estimate" };
    const near = words.filter((w) => KNOWN_MARKS.some((m) => m.startsWith(w.slice(0, 4)) && Math.abs(m.length - w.length) <= 2));
    if (near.length || rng.bool(0.15)) return { registry, status: "similar", similar: near.length ? near.map((w) => `${w.toUpperCase()}*`) : [`${(words[0] ?? name).toUpperCase()}IFY`], caveat: "Screen, not legal clearance", provenance: "Estimate" };
    return { registry, status: "clear", similar: [], caveat: "Screen, not legal clearance", provenance: "Estimate" };
  });
}

/* ---------- kit ---------- */

export interface KitContrast {
  /** Text colour on the primary (white or near-black). */
  onPrimary: string;
  lc: number;
  /** APCA Lc ≥ 75 (DESIGN §5). */
  passes: boolean;
  /** The two colours read as different (Lc between them ≥ 15). */
  distinct: boolean;
  secondaryLc: number;
}

export const KIT_DISTINCT_MIN_LC = 15;

export function kitContrast(kit: Kit): KitContrast {
  const primary = normaliseHex(kit.primary) ?? "#1b4fd8";
  const secondary = normaliseHex(kit.secondary) ?? "#f5c400";
  const d = kitOnPrimaryDetail(primary);
  const secondaryLc = Math.abs(apcaLc(secondary, primary));
  return { onPrimary: d.colour, lc: Math.round(d.lc), passes: d.passes, distinct: secondaryLc >= KIT_DISTINCT_MIN_LC, secondaryLc: Math.round(secondaryLc) };
}

export const DEFAULT_KIT: Kit = { primary: "#1b4fd8", secondary: "#f5c400" };

/**
 * Two brand colours from a logo's pixels (RGBA, as `ImageData.data`): the most frequent saturated colour wins
 * primary; secondary is the most frequent colour at least 60° of hue away, else a lighter hue-shifted partner.
 * Near-white, near-black and transparent pixels are ignored. Pure so it is testable without a canvas.
 */
export function extractPalette(data: Uint8ClampedArray | number[], opts: { sampleEvery?: number } = {}): Kit | null {
  const step = Math.max(1, opts.sampleEvery ?? 1) * 4;
  const buckets = new Map<string, { r: number; g: number; b: number; n: number; h: number; s: number; l: number }>();
  for (let i = 0; i + 3 < data.length; i += step) {
    const a = data[i + 3]!;
    if (a < 128) continue;
    const r = data[i]!;
    const g = data[i + 1]!;
    const b = data[i + 2]!;
    const { h, s, l } = rgbToHsl({ r, g, b });
    if (l > 0.93 || l < 0.08) continue;
    if (s < 0.18) continue;
    const key = `${Math.round(h / 12)}:${Math.round(s * 4)}:${Math.round(l * 4)}`;
    const bucket = buckets.get(key);
    if (bucket) {
      bucket.n += 1;
      bucket.r += r;
      bucket.g += g;
      bucket.b += b;
    } else buckets.set(key, { r, g, b, n: 1, h, s, l });
  }
  const ranked = [...buckets.values()].sort((x, y) => y.n - x.n);
  const top = ranked[0];
  if (!top) return null;
  const avg = (bk: (typeof ranked)[number]) => rgbToHex({ r: bk.r / bk.n, g: bk.g / bk.n, b: bk.b / bk.n }).toLowerCase();
  const primary = avg(top);
  const hueDiff = (a: number, b: number) => Math.min(Math.abs(a - b), 360 - Math.abs(a - b));
  const second = ranked.find((bk) => hueDiff(bk.h, top.h) >= 60);
  if (second) return { primary, secondary: avg(second) };
  const { h, s, l } = rgbToHsl(hexToRgb(primary));
  const shifted = { h: (h + 180) % 360, s: Math.max(0.5, s), l: Math.min(0.68, Math.max(0.45, l + 0.15)) };
  return { primary, secondary: rgbToHex(hslToRgb(shifted)).toLowerCase() };
}

export function isValidKit(kit: Kit): boolean {
  return isHexColour(kit.primary) && isHexColour(kit.secondary) && HEX_RE.test(kit.primary) && HEX_RE.test(kit.secondary);
}

/* ---------- modes and archetypes ---------- */

export interface ModeCard<V extends string> {
  value: V;
  label: string;
  tagline: string;
  details: string[];
}

export const GAME_MODE_CARDS: ModeCard<GameMode>[] = [
  { value: "personal", label: "Personal", tagline: "Private. Just you and the team.", details: ["Nothing is shared outside the business", "Switch to LIVE later from Settings"] },
  { value: "live", label: "LIVE", tagline: "Public profile, leaderboards, communities.", details: ["Your logo and milestones appear in the network", "Numbers you mark private stay private"] },
];

export const BUSINESS_MODE_CARDS: ModeCard<BusinessMode>[] = [
  { value: "augmented", label: "Augmented", tagline: "Agents prepare, you execute.", details: ["Every external action asks first", "Best when you want to learn the ropes"] },
  { value: "assisted", label: "Assisted", tagline: "Agents act inside limits; you decide the rest.", details: ["Spend under the cap runs without asking", "Money, signatures and identity always ask"] },
  { value: "automated", label: "Automated", tagline: "The Chief of Staff runs the day.", details: ["You review outcomes, not actions", "Hard gates still stop at you"] },
];

/** Default spend cap per business mode, in minor units of the founder's currency (labelled an estimate in the UI). */
export const DEFAULT_SPEND_CAP_MINOR: Record<BusinessMode, number> = {
  augmented: 0,
  assisted: LIMITS.approvalThresholdMinorDefault,
  automated: LIMITS.approvalThresholdMinorDefault * 4,
};

export interface ArchetypeCard {
  value: Archetype;
  label: string;
  tagline: string;
  firstWin: string;
}

export const ARCHETYPE_CARDS: ArchetypeCard[] = [
  { value: "b2b_saas", label: ARCHETYPE_LABELS.b2b_saas, tagline: "Software sold to teams on subscription.", firstWin: "A paying workspace" },
  { value: "consumer_app", label: ARCHETYPE_LABELS.consumer_app, tagline: "An app people pick up for themselves.", firstWin: "A retained weekly user" },
  { value: "marketplace", label: ARCHETYPE_LABELS.marketplace, tagline: "Two sides, matched and paid through you.", firstWin: "A completed transaction" },
  { value: "dtc_physical", label: ARCHETYPE_LABELS.dtc_physical, tagline: "A physical product sold direct.", firstWin: "An order shipped" },
  { value: "hardware", label: ARCHETYPE_LABELS.hardware, tagline: "A device, from prototype to units.", firstWin: "A pre-order" },
  { value: "services", label: ARCHETYPE_LABELS.services, tagline: "Expertise sold as engagements.", firstWin: "A signed engagement" },
  { value: "content_media", label: ARCHETYPE_LABELS.content_media, tagline: "An audience that pays for what you make.", firstWin: "A paid subscriber" },
];

/* ---------- the form ---------- */

export interface CommitForm {
  name: string;
  kit: Kit;
  gameMode: GameMode;
  archetype: Archetype | null;
  businessMode: BusinessMode;
  /** Major units as typed. */
  spendCap: string;
  currency: string;
}

export function initialCommitForm(idea: { title: string; archetype: Archetype | null; crestSeed?: string }, kit: Kit, currency: string): CommitForm {
  return {
    name: idea.title.replace(/\s*\(fork\)\s*$/i, "").trim(),
    kit,
    gameMode: "personal",
    archetype: idea.archetype,
    businessMode: "assisted",
    spendCap: String(DEFAULT_SPEND_CAP_MINOR.assisted / 100),
    currency,
  };
}

export type CommitErrors = Partial<Record<keyof CommitForm, string>>;

export function parseSpendCapMinor(input: string): number | null {
  const s = input.trim().replace(/[\s,_]/g, "");
  if (!s) return null;
  if (!/^\d+(\.\d+)?$/.test(s)) return Number.NaN;
  return Math.round(Number(s) * 100);
}

export function validateCommitForm(form: CommitForm): CommitErrors {
  const errors: CommitErrors = {};
  if (form.name.trim().length === 0) errors.name = "Give the business a name.";
  if (form.name.trim().length > 120) errors.name = "Keep the name under 120 characters.";
  if (!isValidKit(form.kit)) errors.kit = "Both brand colours need a 6-digit hex value.";
  if (!form.archetype) errors.archetype = "Pick the archetype that fits best; it seeds departments and agents.";
  const cap = parseSpendCapMinor(form.spendCap);
  if (Number.isNaN(cap) || (cap !== null && cap < 0)) errors.spendCap = "Use a number, like 250.";
  return errors;
}

export function isCommitValid(form: CommitForm): boolean {
  return Object.keys(validateCommitForm(form)).length === 0;
}

/** The `idea.commit` input. */
export function commitInput(ideaId: string, form: CommitForm) {
  const cap = parseSpendCapMinor(form.spendCap);
  return {
    ideaId,
    name: form.name.trim(),
    gameMode: form.gameMode,
    archetype: form.archetype as Archetype,
    businessMode: form.businessMode,
    kit: { primary: normaliseHex(form.kit.primary) ?? DEFAULT_KIT.primary, secondary: normaliseHex(form.kit.secondary) ?? DEFAULT_KIT.secondary },
    currency: form.currency,
    spendCapMinor: cap === null || Number.isNaN(cap) ? null : cap,
  };
}

/** Crest seed for the preview: the slug of the name (the API slugs the name the same way, plus a suffix). */
export function crestSeedFor(name: string, fallback: string): string {
  return name.trim() ? slugify(name) : fallback;
}
