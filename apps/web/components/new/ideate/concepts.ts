/**
 * Ideation Studio logic (BUILD §11.1 Door A, AC-11.1.2/3/4). Pure: the API's idea rows → Dugout `Concept`,
 * version metadata (the colour seed, lineage, Q&A travel as one tagged entry in `research.citations`, mirroring
 * apps/api/src/routers/idea.ts), Compare selection, hrefs and the per-user studio state kept in localStorage
 * (shortlist, the discard tray's snapshots, restored cards kept in view), settled against the API's deck.
 */
import { CREDITS_CURRENCY } from "@foundmill/config";
import { ARCHETYPE_LABELS, type Archetype } from "@foundmill/shared";
import { TERMS } from "@foundmill/shared/terms";
import { CONCEPT_ATTRIBUTE_KEYS, CONCEPT_ATTRIBUTE_LABELS, createRng, hslToRgb, kitOnPrimaryDetail, rgbToHex, type Concept, type ConceptAttribute, type ConceptEvidence, type Kit, type TermDefinition } from "@foundmill/dugout";
import { DISPLAY_LOCALE } from "@/lib/format";

export const META_KIND = "foundmill:meta";

export interface IdeaVersionLike {
  id: string;
  version: number;
  title: string;
  pitch: string;
  attributes: Record<string, { value: number; evidence?: string }>;
  starsCurrent: string | number;
  starsPotential: string | number;
  research: { citations: unknown[] } | null;
  parentVersionId: string | null;
  action: string;
  createdAt: Date | string;
}

export interface IdeaLike {
  id: string;
  title: string;
  pitch: string;
  archetype: Archetype | null;
  current: IdeaVersionLike | null;
  createdAt?: Date | string;
}

export interface Citation {
  title: string;
  url: string;
  note?: string;
}

export interface IdeaMeta {
  crest_seed?: string;
  merged_from?: string[];
  merged_into?: string;
  forked_from?: string;
  forked_to?: string;
  qa?: QaEntry[];
  /** The founder's own description of the business, verbatim (a card they wrote with "Use my idea as written" or edited). */
  founder_words?: string;
  /** The brief the founder typed when the card was drafted. */
  brief?: string;
  /** The sample (mock) model wrote the card: every screen says so. */
  sample?: boolean;
}

/** One Ask exchange stored on a version (`meta.qa`): the question, the answer, and the conversation when it has one. */
export interface QaEntry {
  question: string;
  answer: string;
  /** The Research agent's reply as bubbles (answers stored before the conversation have only `answer`). */
  bubbles?: string[];
  quick_replies?: { id: string; label: string; say?: string; kind?: string; option_id?: string | null; recommended?: boolean }[];
  quick_reply_id?: string | null;
  reaction?: string;
}

const isRecord = (v: unknown): v is Record<string, unknown> => Boolean(v) && typeof v === "object" && !Array.isArray(v);
const isMeta = (c: unknown): c is Record<string, unknown> => isRecord(c) && c.kind === META_KIND;

export function readMeta(research: { citations: unknown[] } | null | undefined): IdeaMeta {
  const found = (research?.citations ?? []).find(isMeta);
  if (!found) return {};
  const meta: IdeaMeta = {};
  if (typeof found.crest_seed === "string") meta.crest_seed = found.crest_seed;
  if (Array.isArray(found.merged_from)) meta.merged_from = found.merged_from.filter((x): x is string => typeof x === "string");
  if (typeof found.merged_into === "string") meta.merged_into = found.merged_into;
  if (typeof found.forked_from === "string") meta.forked_from = found.forked_from;
  if (typeof found.forked_to === "string") meta.forked_to = found.forked_to;
  if (Array.isArray(found.qa)) meta.qa = found.qa.filter((q): q is QaEntry => isRecord(q) && typeof q.question === "string" && typeof q.answer === "string");
  if (typeof found.founder_words === "string" && found.founder_words.trim()) meta.founder_words = found.founder_words;
  if (typeof found.brief === "string" && found.brief.trim()) meta.brief = found.brief;
  if (found.sample === true) meta.sample = true;
  return meta;
}

/** True when the card's pitch is the founder's own words (written or edited by them), as the version's meta records it. */
export function founderWrote(idea: Pick<IdeaLike, "current" | "pitch">): boolean {
  const meta = readMeta(idea.current?.research);
  return Boolean(meta.founder_words) && meta.founder_words === (idea.current?.pitch ?? idea.pitch);
}

export function citationsOf(research: { citations: unknown[] } | null | undefined): Citation[] {
  return (research?.citations ?? [])
    .filter((c): c is Record<string, unknown> => isRecord(c) && !isMeta(c))
    .map((c) => ({ title: typeof c.title === "string" ? c.title : "Source", url: typeof c.url === "string" ? c.url : "", note: typeof c.note === "string" ? c.note : undefined }))
    .filter((c) => c.url.length > 0 || c.title !== "Source");
}

/**
 * Brand colours derived from the idea's seed: a saturated hue and its offset partner, deterministic. The primary is
 * darkened until text on it passes APCA Lc ≥ 75 (DESIGN §5), so a generated kit never fails the Commit screen's check.
 */
export function kitFromSeed(seed: string | number): Kit {
  const rng = createRng(`kit:${seed}`);
  const hue = rng.int(0, 359);
  let primary = "";
  for (let l = 0.42; l >= 0.18; l -= 0.04) {
    primary = rgbToHex(hslToRgb({ h: hue, s: 0.62, l })).toLowerCase();
    if (kitOnPrimaryDetail(primary).passes) break;
  }
  const secondary = rgbToHex(hslToRgb({ h: (hue + rng.pick([150, 180, 210])) % 360, s: 0.7, l: 0.58 })).toLowerCase();
  return { primary, secondary };
}

export function num(v: string | number | null | undefined): number {
  if (typeof v === "number") return v;
  const n = Number(v ?? 0);
  return Number.isFinite(n) ? n : 0;
}

function attributesFrom(attrs: Record<string, { value: number; evidence?: string }> | undefined, citations: Citation[]): ConceptAttribute[] {
  return CONCEPT_ATTRIBUTE_KEYS.map((key) => {
    const a = attrs?.[key];
    const evidence: ConceptEvidence[] = [];
    if (a?.evidence) evidence.push({ text: a.evidence, source: "Research agent" });
    for (const c of citations.slice(0, 2)) evidence.push({ text: c.note ?? c.title, source: c.title, url: c.url || undefined });
    return { key, value: a ? Math.max(1, Math.min(20, Math.round(a.value))) : 1, evidence };
  });
}

/** The card the Studio renders for an idea's current version. */
export function toConcept(idea: IdeaLike, opts: { verdict?: string } = {}): Concept {
  const v = idea.current;
  const meta = readMeta(v?.research);
  const citations = citationsOf(v?.research);
  const seed = meta.crest_seed ?? idea.id;
  return {
    id: idea.id,
    name: v?.title ?? idea.title,
    pitch: v?.pitch ?? idea.pitch,
    kit: kitFromSeed(seed),
    currentStars: num(v?.starsCurrent),
    potentialStars: num(v?.starsPotential),
    attributes: attributesFrom(v?.attributes, citations),
    citations: citations.length,
    archetypeLabel: idea.archetype ? ARCHETYPE_LABELS[idea.archetype] : undefined,
    version: v?.version,
    verdict: opts.verdict,
    ...(founderWrote(idea) ? { yourWords: true } : {}),
    ...(meta.sample ? { sample: true } : {}),
  };
}

/** A snapshot card for one historical version (History drawer, AC-11.1.3). */
export function versionToConcept(idea: IdeaLike, version: IdeaVersionLike): Concept {
  return toConcept({ ...idea, current: version });
}

export interface Lineage {
  mergedFrom: string[];
  mergedInto: string | null;
  forkedFrom: string | null;
  forkedTo: string | null;
}

export function lineageOf(idea: IdeaLike): Lineage {
  const meta = readMeta(idea.current?.research);
  return { mergedFrom: meta.merged_from ?? [], mergedInto: meta.merged_into ?? null, forkedFrom: meta.forked_from ?? null, forkedTo: meta.forked_to ?? null };
}

export function qaOf(idea: IdeaLike): QaEntry[] {
  return readMeta(idea.current?.research).qa ?? [];
}

/** The bubbles of a stored answer: its conversation bubbles, else the single answer. */
export function qaBubbles(qa: QaEntry): string[] {
  const bubbles = Array.isArray(qa.bubbles) ? qa.bubbles.filter((b): b is string => typeof b === "string" && b.trim().length > 0) : [];
  return bubbles.length ? bubbles : [qa.answer];
}

const attributeLabel = (key: string): string => (CONCEPT_ATTRIBUTE_LABELS as Record<string, string>)[key] ?? key.replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase());

/** Attributes a new version moved ("Market size 12 → 14"), by key, in the card's order. */
export function attributeChanges(before: IdeaVersionLike["attributes"] | null | undefined, after: IdeaVersionLike["attributes"] | null | undefined): { key: string; label: string; from: number; to: number }[] {
  if (!before || !after) return [];
  return Object.keys(after).flatMap((key) => {
    const a = before[key]?.value;
    const b = after[key]?.value;
    return typeof a === "number" && typeof b === "number" && a !== b ? [{ key, label: attributeLabel(key), from: a, to: b }] : [];
  });
}

/**
 * A concept attribute as a defined word (UX plan §7.5, A6): the `Term` id is `attr_<key>` ("attr_market_pull" …
 * "attr_distribution_clarity"), the entry the shared definitions map holds for every attribute, its sentence carrying
 * the direction ("How crowded the market is; higher means less crowded."). An unknown key has no entry, so the word
 * stays plain text.
 */
export function attributeTermId(key: string): string {
  return `attr_${key}`;
}

/** The map's definition of an attribute (TERMS), for a Term rendered outside the app's provider; undefined for an unknown key. */
export function attributeTerm(key: string): TermDefinition | undefined {
  return (TERMS as Record<string, TermDefinition>)[attributeTermId(key)];
}

export const VERSION_ACTION_LABELS: Record<string, string> = { generated: "Generated", merged: "Merged", forked: "Variant made", edited: "Edited" };

/** How a version came to be; a first version the founder wrote themselves reads "Written by you". */
export function versionActionLabel(action: string, version?: Pick<IdeaVersionLike, "version" | "research">): string {
  if (action === "edited" && version?.version === 1 && readMeta(version.research).founder_words) return "Written by you";
  return VERSION_ACTION_LABELS[action] ?? action;
}

export const COMPARE_MIN = 2;
export const COMPARE_MAX = 4;

/** Toggle an id in the Compare selection; a fifth pick is ignored (AC-11.1.4: 2–4 cards). */
export function toggleSelection(ids: readonly string[], id: string, max = COMPARE_MAX): string[] {
  if (ids.includes(id)) return ids.filter((x) => x !== id);
  if (ids.length >= max) return [...ids];
  return [...ids, id];
}

export function compareHref(ids: readonly string[]): string {
  return `/new/compare?ids=${ids.map(encodeURIComponent).join(",")}`;
}

/**
 * The label of the button that takes an idea to its setup (the Commit step): what the press does, in plain words
 * (first-time founder report, Nov 2026: "Commit" said nothing). Choosing opens the name, logo and how-it-runs form;
 * Take charge there starts the business, so the card never says "Start" (DECISIONS 2026-11-10).
 */
export const CHOOSE_IDEA_LABEL = "Choose this idea";

export function commitHref(ideaId: string): string {
  return `/new/commit/${encodeURIComponent(ideaId)}`;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** `?ids=a,b,c` → unique uuids, at most four. */
export function parseCompareIds(param: string | null | undefined): string[] {
  if (!param) return [];
  const out: string[] = [];
  for (const raw of param.split(",")) {
    const id = decodeURIComponent(raw.trim());
    if (UUID_RE.test(id) && !out.includes(id)) out.push(id);
    if (out.length >= COMPARE_MAX) break;
  }
  return out;
}

/* ---------- studio state (per user, this browser) ---------- */

export interface DiscardedSnapshot {
  idea: IdeaLike;
  discardedAt: string;
}

export interface StudioState {
  shortlist: string[];
  discarded: DiscardedSnapshot[];
  /**
   * Cards restored from the tray (idea.restore put them back on the API), kept in view until the deck's own pages carry
   * them: a restored card can be older than every page loaded so far.
   */
  restored: IdeaLike[];
  lastPrompt: string;
}

export const EMPTY_STUDIO_STATE: StudioState = { shortlist: [], discarded: [], restored: [], lastPrompt: "" };

export const STUDIO_STORAGE_PREFIX = "fm_studio:";

export function studioStorageKey(userKey: string): string {
  return `${STUDIO_STORAGE_PREFIX}${userKey}`;
}

export function parseStudioState(raw: string | null): StudioState {
  if (!raw) return EMPTY_STUDIO_STATE;
  try {
    const v = JSON.parse(raw) as Partial<StudioState>;
    return {
      shortlist: Array.isArray(v.shortlist) ? v.shortlist.filter((x): x is string => typeof x === "string") : [],
      discarded: Array.isArray(v.discarded) ? v.discarded.filter((d): d is DiscardedSnapshot => isRecord(d) && isRecord(d.idea) && typeof d.idea.id === "string") : [],
      restored: Array.isArray(v.restored) ? v.restored.filter((i): i is IdeaLike => isRecord(i) && typeof i.id === "string") : [],
      lastPrompt: typeof v.lastPrompt === "string" ? v.lastPrompt : "",
    };
  } catch {
    return EMPTY_STUDIO_STATE;
  }
}

export function readStudioState(storage: Pick<Storage, "getItem"> | undefined, userKey: string): StudioState {
  try {
    return parseStudioState(storage?.getItem(studioStorageKey(userKey)) ?? null);
  } catch {
    return EMPTY_STUDIO_STATE;
  }
}

export function writeStudioState(storage: Pick<Storage, "setItem"> | undefined, userKey: string, state: StudioState): void {
  try {
    storage?.setItem(studioStorageKey(userKey), JSON.stringify(state));
  } catch {
    /* private mode or quota: the state is per-session then */
  }
}

/** Discard: move the card into the tray (reversible, AC-11.1.3). */
export function discardLocally(state: StudioState, idea: IdeaLike, now = new Date()): StudioState {
  return {
    ...state,
    shortlist: state.shortlist.filter((id) => id !== idea.id),
    restored: state.restored.filter((i) => i.id !== idea.id),
    discarded: [{ idea, discardedAt: now.toISOString() }, ...state.discarded.filter((d) => d.idea.id !== idea.id)],
  };
}

/**
 * Out of the tray. `restored`: the card idea.restore answered with, kept in view (`restored`) until the deck's pages carry
 * it. Without it the card only leaves the tray: a discard the API refused, so the card never left the API's deck.
 */
export function restoreLocally(state: StudioState, ideaId: string, restored?: IdeaLike | null): StudioState {
  const next = { ...state, discarded: state.discarded.filter((d) => d.idea.id !== ideaId) };
  if (restored) next.restored = [...state.restored.filter((i) => i.id !== ideaId), restored];
  return next;
}

/** At most this many pinned cards are asked for at once (the API's `idea.listByIds` limit). */
export const PINNED_MAX = 100;

/**
 * The shortlisted and restored cards the loaded pages do not carry (they are older than every page so far): the Studio
 * asks the API for these by id (`idea.listByIds`) so they stay pinned and counted (audit FR-22).
 */
export function pinnedIdsToLoad(state: StudioState, loaded: ReadonlySet<string>): string[] {
  const tray = new Set(state.discarded.map((d) => d.idea.id));
  const ids: string[] = [];
  for (const id of [...state.shortlist, ...state.restored.map((i) => i.id)]) {
    if (!loaded.has(id) && !tray.has(id) && !ids.includes(id)) ids.push(id);
  }
  return ids.slice(0, PINNED_MAX);
}

/** The loaded pages plus the pinned cards the API returned (each card once; the pages win). */
export function withPinned(serverIdeas: readonly IdeaLike[], pinned: readonly IdeaLike[] | undefined): IdeaLike[] {
  if (!pinned?.length) return [...serverIdeas];
  const seen = new Set(serverIdeas.map((i) => i.id));
  return [...serverIdeas, ...pinned.filter((i) => !seen.has(i.id))];
}

/**
 * Keep the browser's studio state true to the API's deck. A restored card the pages now carry needs no copy here. When
 * the API has answered for the pinned ids (`answer`): a shortlisted card it no longer has (discarded elsewhere, or now a
 * business) leaves the shortlist, so the count matches the cards shown; a restored card the API still holds as
 * discarded (one restored only in this browser, before the API could restore) goes back to the tray, where Restore
 * brings it back for real; one that is gone altogether is dropped. Returns the same object when nothing changes.
 */
export function settlePinned(state: StudioState, loaded: ReadonlySet<string>, answer: { asked: readonly string[]; found: readonly string[]; discarded: readonly string[] } | null, now = new Date()): StudioState {
  const found = new Set(answer?.found ?? []);
  const missing = new Set((answer?.asked ?? []).filter((id) => !found.has(id) && !loaded.has(id)));
  const discarded = new Set(answer?.discarded ?? []);
  const shortlist = state.shortlist.filter((id) => !missing.has(id));
  const backToTray = state.restored.filter((i) => missing.has(i.id) && discarded.has(i.id));
  const restored = state.restored.filter((i) => !loaded.has(i.id) && !missing.has(i.id));
  if (shortlist.length === state.shortlist.length && restored.length === state.restored.length) return state;
  return {
    ...state,
    shortlist,
    restored,
    discarded: [...backToTray.map((idea) => ({ idea, discardedAt: now.toISOString() })), ...state.discarded.filter((d) => !backToTray.some((i) => i.id === d.idea.id))],
  };
}

/** The deck the Studio shows: the API's live ideas plus restored ones not loaded yet, minus anything in the tray. */
export function buildDeck(serverIdeas: readonly IdeaLike[], state: StudioState): IdeaLike[] {
  const trayIds = new Set(state.discarded.map((d) => d.idea.id));
  const seen = new Set<string>();
  const out: IdeaLike[] = [];
  for (const idea of serverIdeas) {
    if (trayIds.has(idea.id) || seen.has(idea.id)) continue;
    seen.add(idea.id);
    out.push(idea);
  }
  for (const idea of state.restored) {
    if (trayIds.has(idea.id) || seen.has(idea.id)) continue;
    seen.add(idea.id);
    out.push(idea);
  }
  return out;
}

/** Cards ordered: shortlisted first, then newest. */
export function orderDeck(deck: readonly IdeaLike[], shortlist: readonly string[]): IdeaLike[] {
  const time = (i: IdeaLike) => new Date(i.current?.createdAt ?? i.createdAt ?? 0).getTime();
  return [...deck].sort((a, b) => {
    const sa = shortlist.includes(a.id) ? 1 : 0;
    const sb = shortlist.includes(b.id) ? 1 : 0;
    if (sa !== sb) return sb - sa;
    return time(b) - time(a);
  });
}

/**
 * Money label for the generation cost ("$0.12", shown with Estimate). Model costs are metered in US dollars, the model
 * price list's currency (`CREDITS_CURRENCY`), whatever the founder's own currency.
 */
export function costLabel(costMinor: number, currency: string = CREDITS_CURRENCY): string {
  try {
    return new Intl.NumberFormat(DISPLAY_LOCALE, { style: "currency", currency, currencyDisplay: "narrowSymbol", minimumFractionDigits: 2 }).format(costMinor / 100);
  } catch {
    return `${(costMinor / 100).toFixed(2)} ${currency}`;
  }
}
