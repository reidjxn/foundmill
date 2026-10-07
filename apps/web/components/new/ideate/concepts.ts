/**
 * Ideation Studio logic (BUILD §11.1 Door A, AC-11.1.2/3/4). Pure: the API's idea rows → Dugout `Concept`,
 * version metadata (crest seed, lineage, Q&A travel as one tagged entry in `research.citations`, mirroring
 * apps/api/src/routers/idea.ts), Compare selection, hrefs and the per-user studio state kept in localStorage
 * (shortlist, discarded-card snapshots) that the API has no procedure for.
 */
import { ARCHETYPE_LABELS, type Archetype } from "@foundmill/shared";
import { CONCEPT_ATTRIBUTE_KEYS, createRng, hslToRgb, kitOnPrimaryDetail, rgbToHex, type Concept, type ConceptAttribute, type ConceptEvidence, type Kit } from "@foundmill/dugout";

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
  qa?: { question: string; answer: string }[];
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
  if (Array.isArray(found.qa)) meta.qa = found.qa.filter((q): q is { question: string; answer: string } => isRecord(q) && typeof q.question === "string" && typeof q.answer === "string");
  return meta;
}

export function citationsOf(research: { citations: unknown[] } | null | undefined): Citation[] {
  return (research?.citations ?? [])
    .filter((c): c is Record<string, unknown> => isRecord(c) && !isMeta(c))
    .map((c) => ({ title: typeof c.title === "string" ? c.title : "Source", url: typeof c.url === "string" ? c.url : "", note: typeof c.note === "string" ? c.note : undefined }))
    .filter((c) => c.url.length > 0 || c.title !== "Source");
}

/**
 * Brand colours derived from the crest seed: a saturated hue and its offset partner, deterministic. The primary is
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
    crestSeed: seed,
    kit: kitFromSeed(seed),
    currentStars: num(v?.starsCurrent),
    potentialStars: num(v?.starsPotential),
    attributes: attributesFrom(v?.attributes, citations),
    citations: citations.length,
    archetypeLabel: idea.archetype ? ARCHETYPE_LABELS[idea.archetype] : undefined,
    version: v?.version,
    verdict: opts.verdict,
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

export function qaOf(idea: IdeaLike): { question: string; answer: string }[] {
  return readMeta(idea.current?.research).qa ?? [];
}

export const VERSION_ACTION_LABELS: Record<string, string> = { generated: "Generated", merged: "Merged", forked: "Forked", edited: "Edited" };

export function versionActionLabel(action: string): string {
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
  /** Cards restored locally because the API has no idea.restore yet (kept in the deck until a reload). */
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

/** Restore from the tray. `serverRestored` = the API un-archived it (so the list query will carry it again). */
export function restoreLocally(state: StudioState, ideaId: string, serverRestored: boolean): StudioState {
  const entry = state.discarded.find((d) => d.idea.id === ideaId);
  const next = { ...state, discarded: state.discarded.filter((d) => d.idea.id !== ideaId) };
  if (entry && !serverRestored) next.restored = [...state.restored.filter((i) => i.id !== ideaId), entry.idea];
  return next;
}

/** The deck the Studio shows: the API's live ideas plus locally restored ones, minus anything in the tray. */
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

/** Money label for the generation cost ("Estimate · €0.12"). */
export function costLabel(costMinor: number, currency = "EUR"): string {
  try {
    return new Intl.NumberFormat("en-GB", { style: "currency", currency, minimumFractionDigits: 2 }).format(costMinor / 100);
  } catch {
    return `${(costMinor / 100).toFixed(2)} ${currency}`;
  }
}
