/**
 * Identity resolution (BUILD §11.12): strong identifiers first (email, domain, LinkedIn URL, registration number,
 * Stripe id); then a fuzzy name + organisation score; ≥ 0.95 auto-merge, 0.75–0.95 Inbox suggestion. Merges fill empty
 * fields only and are reversible: `planMerge` returns the merged record and a snapshot that `unmerge` restores exactly
 * (AC-11.12.3). Everything here is pure; `packages/db` persists and audits the result.
 */
import type { EntityKind } from "@founder-manager/shared";
import { normalizeName } from "./manifest";
import { foldText, similarity } from "./trigram";
import type { LinkerModelClient } from "./types";
import { z } from "zod";

export const STRONG_IDENTIFIERS = ["email", "domain", "linkedin", "reg_no", "stripe_id"] as const;
export type StrongIdentifier = (typeof STRONG_IDENTIFIERS)[number];

/** Thresholds from BUILD §11.12. Equal to the threshold counts as reaching it. */
export const AUTO_MERGE_THRESHOLD = 0.95;
export const SUGGEST_THRESHOLD = 0.75;

export type Identifiers = Partial<Record<StrongIdentifier, string | null | undefined>> & Record<string, unknown>;

/** The fields identity resolution reads. Matches the `entities` columns plus an optional organisation for people. */
export interface IdentityRecord {
  id?: string;
  kind: EntityKind;
  name: string;
  aliases?: readonly string[];
  identifiers?: Identifiers;
  /** The organisation a person belongs to (display name or domain), when known. */
  org?: string | null;
}

export type ResolutionDecision = "merge" | "suggest" | "none";

export interface ScoredMatch {
  /** Index of the existing record in the list passed to `resolveIdentity`. */
  index: number;
  id?: string;
  score: number;
  matchedOn: "identifier" | "name_org";
  /** Strong identifiers that matched (empty for a name+org match). */
  identifiers: StrongIdentifier[];
  nameScore: number;
  orgScore: number | null;
}

export interface Resolution {
  decision: ResolutionDecision;
  /** The best match, when `decision` is not `none`. */
  match?: ScoredMatch;
  /** Every candidate at or above the suggest threshold, best first. */
  candidates: ScoredMatch[];
}

// ---------------------------------------------------------------------------------------------------------------------
// Identifier normalisation
// ---------------------------------------------------------------------------------------------------------------------

/** Canonical form per identifier so "WWW.Acme.com/", "acme.com" and "https://acme.com" compare equal. */
export function normalizeIdentifier(key: StrongIdentifier, value: string | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  const raw = String(value).trim();
  if (!raw) return null;
  switch (key) {
    case "email": {
      const v = raw.toLowerCase().replace(/^mailto:/, "");
      return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v) ? v : null;
    }
    case "domain": {
      let v = raw.toLowerCase();
      v = v.replace(/^[a-z]+:\/\//, "").replace(/^www\./, "");
      v = v.split(/[/?#]/)[0] ?? "";
      v = v.replace(/:\d+$/, "").replace(/\.+$/, "");
      // An e-mail address given as a domain: keep the domain part.
      if (v.includes("@")) v = v.slice(v.lastIndexOf("@") + 1);
      return /^[a-z0-9.-]+\.[a-z]{2,}$/.test(v) ? v : null;
    }
    case "linkedin": {
      let v = raw.toLowerCase().replace(/^[a-z]+:\/\//, "").replace(/^www\./, "").replace(/^[a-z]{2}\.linkedin\.com/, "linkedin.com");
      v = v.split(/[?#]/)[0] ?? "";
      v = v.replace(/\/+$/, "");
      const m = /^linkedin\.com\/(in|company|school)\/([^/]+)$/.exec(v);
      if (m) return `linkedin.com/${m[1]}/${m[2]}`;
      // A bare slug.
      if (/^[a-z0-9][a-z0-9-_.%]*$/.test(v)) return `linkedin.com/in/${v}`;
      return null;
    }
    case "reg_no": {
      const v = raw.toUpperCase().replace(/[\s.\-/]/g, "");
      return v.length >= 4 ? v : null;
    }
    case "stripe_id": {
      // Stripe ids are case-sensitive (`cus_…`, `acct_…`).
      return /^[a-z]{2,6}_[A-Za-z0-9]{8,}$/.test(raw) ? raw : null;
    }
  }
}

export function normalizeIdentifiers(ids: Identifiers | undefined): Partial<Record<StrongIdentifier, string>> {
  const out: Partial<Record<StrongIdentifier, string>> = {};
  if (!ids) return out;
  for (const key of STRONG_IDENTIFIERS) {
    const v = normalizeIdentifier(key, ids[key] as string | null | undefined);
    if (v) out[key] = v;
  }
  return out;
}

/** Strong identifiers the two records share with the same canonical value. */
export function matchStrongIdentifiers(a: IdentityRecord, b: IdentityRecord): StrongIdentifier[] {
  const na = normalizeIdentifiers(a.identifiers);
  const nb = normalizeIdentifiers(b.identifiers);
  const out: StrongIdentifier[] = [];
  for (const key of STRONG_IDENTIFIERS) {
    const va = na[key];
    const vb = nb[key];
    if (va && vb && va === vb) {
      // A shared company domain does not make two people the same person.
      if (key === "domain" && a.kind === "person" && b.kind === "person") continue;
      out.push(key);
    }
  }
  return out;
}

// ---------------------------------------------------------------------------------------------------------------------
// Name + organisation scoring
// ---------------------------------------------------------------------------------------------------------------------

/**
 * Similarity of two personal or organisation names in [0, 1]: the best of trigram similarity, a token-set score that
 * handles reordering ("Lindqvist, Sara" vs "Sara Lindqvist") and initials ("S. Lindqvist"), over the names and aliases.
 */
export function nameSimilarity(a: IdentityRecord | string, b: IdentityRecord | string): number {
  const namesA = namesOf(a);
  const namesB = namesOf(b);
  let best = 0;
  for (const x of namesA) for (const y of namesB) best = Math.max(best, Math.max(similarity(x, y), tokenScore(x, y)));
  return round(best);
}

function namesOf(r: IdentityRecord | string): string[] {
  if (typeof r === "string") return [normalizeName(r)].filter(Boolean);
  return [r.name, ...(r.aliases ?? [])].map(normalizeName).filter((n) => n.length > 0);
}

function tokenScore(a: string, b: string): number {
  const ta = a.split(" ").filter(Boolean);
  const tb = b.split(" ").filter(Boolean);
  if (ta.length === 0 || tb.length === 0) return 0;
  const sa = new Set(ta);
  const sb = new Set(tb);
  let shared = 0;
  for (const t of sa) if (sb.has(t)) shared++;
  const union = sa.size + sb.size - shared;
  const jaccard = union === 0 ? 0 : shared / union;
  if (jaccard === 1) return 1;
  // Initials: every token of the shorter name is a prefix (≥ 1 char) of a distinct token of the longer one, and the
  // surname (last token) is identical.
  const [short, long] = ta.length <= tb.length ? [ta, tb] : [tb, ta];
  const lastShort = short[short.length - 1] as string;
  const lastLong = long[long.length - 1] as string;
  if (lastShort === lastLong && short.length >= 2) {
    const used = new Set<number>();
    const ok = short.slice(0, -1).every((tok) => {
      const idx = long.findIndex((l, i) => !used.has(i) && i < long.length - 1 && l.startsWith(tok.replace(/\.$/, "")));
      if (idx === -1) return false;
      used.add(idx);
      return true;
    });
    if (ok) return 0.9;
  }
  return jaccard;
}

/** Organisation similarity: 1 when either side's domain or name matches, else trigram/token similarity of the names. */
export function orgSimilarity(a: IdentityRecord, b: IdentityRecord): number | null {
  const oa = a.org ? normalizeName(a.org) : "";
  const ob = b.org ? normalizeName(b.org) : "";
  if (!oa || !ob) return null;
  const da = normalizeIdentifier("domain", oa);
  const db = normalizeIdentifier("domain", ob);
  if (da && db) return da === db ? 1 : 0;
  return round(Math.max(similarity(oa, ob), tokenScore(oa, ob)));
}

export interface NameOrgScore {
  score: number;
  nameScore: number;
  orgScore: number | null;
}

/**
 * Fuzzy name + organisation score (BUILD §11.12). Different kinds never match. For organisations the score is the name
 * similarity; for people with an organisation on both sides it is 0.75 × name + 0.25 × org, and without one it is
 * name × 0.9, so two people with the same name and no shared organisation can be suggested but never auto-merged.
 */
export function scoreNameOrg(a: IdentityRecord, b: IdentityRecord): NameOrgScore {
  if (a.kind !== b.kind) return { score: 0, nameScore: 0, orgScore: null };
  const nameScore = nameSimilarity(a, b);
  if (a.kind !== "person") return { score: nameScore, nameScore, orgScore: null };
  const orgScore = orgSimilarity(a, b);
  if (orgScore === null) return { score: round(nameScore * 0.9), nameScore, orgScore };
  return { score: round(0.75 * nameScore + 0.25 * orgScore), nameScore, orgScore };
}

// ---------------------------------------------------------------------------------------------------------------------
// Resolution
// ---------------------------------------------------------------------------------------------------------------------

export interface ResolveOptions {
  autoMergeThreshold?: number;
  suggestThreshold?: number;
  /**
   * Optional model scorer for the fuzzy band (Haiku, BUILD §11.12 "scored by Haiku"). Called for every candidate whose
   * local score is between the suggest threshold and 1; the final score is the mean of the local and model scores, so
   * the model can confirm or soften a match but cannot invent one.
   */
  modelScore?: (candidate: IdentityRecord, existing: IdentityRecord) => Promise<number | null>;
}

export function decide(score: number, options: ResolveOptions = {}): ResolutionDecision {
  const merge = options.autoMergeThreshold ?? AUTO_MERGE_THRESHOLD;
  const suggest = options.suggestThreshold ?? SUGGEST_THRESHOLD;
  if (score >= merge) return "merge";
  if (score >= suggest) return "suggest";
  return "none";
}

/** Score `candidate` against every `existing` record and decide. Synchronous and local. */
export function resolveIdentity(candidate: IdentityRecord, existing: readonly IdentityRecord[], options: ResolveOptions = {}): Resolution {
  const scored = existing.map((rec, index) => scorePair(candidate, rec, index)).filter((m): m is ScoredMatch => m !== null);
  return finish(scored, options);
}

/** Same as `resolveIdentity`, but lets a model refine scores in the fuzzy band when `options.modelScore` is given. */
export async function resolveIdentityWithModel(candidate: IdentityRecord, existing: readonly IdentityRecord[], options: ResolveOptions = {}): Promise<Resolution> {
  const suggest = options.suggestThreshold ?? SUGGEST_THRESHOLD;
  const scored: ScoredMatch[] = [];
  for (const [index, rec] of existing.entries()) {
    const local = scorePair(candidate, rec, index);
    if (!local) continue;
    if (options.modelScore && local.matchedOn === "name_org" && local.score >= suggest && local.score < 1) {
      let modelScore: number | null;
      try {
        modelScore = await options.modelScore(candidate, rec);
      } catch {
        modelScore = null;
      }
      if (typeof modelScore === "number" && Number.isFinite(modelScore)) {
        const clamped = Math.max(0, Math.min(1, modelScore));
        scored.push({ ...local, score: round((local.score + clamped) / 2) });
        continue;
      }
    }
    scored.push(local);
  }
  return finish(scored, options);
}

function scorePair(candidate: IdentityRecord, rec: IdentityRecord, index: number): ScoredMatch | null {
  if (candidate.id && rec.id && candidate.id === rec.id) return null;
  const identifiers = matchStrongIdentifiers(candidate, rec);
  const { score, nameScore, orgScore } = scoreNameOrg(candidate, rec);
  if (identifiers.length > 0) {
    // A strong identifier is decisive, unless the kinds disagree (a person with a company's Stripe id): then suggest.
    const kindsAgree = candidate.kind === rec.kind;
    return { index, id: rec.id, score: kindsAgree ? 1 : Math.max(SUGGEST_THRESHOLD, score), matchedOn: "identifier", identifiers, nameScore, orgScore };
  }
  if (score <= 0) return null;
  return { index, id: rec.id, score, matchedOn: "name_org", identifiers: [], nameScore, orgScore };
}

function finish(scored: ScoredMatch[], options: ResolveOptions): Resolution {
  const suggest = options.suggestThreshold ?? SUGGEST_THRESHOLD;
  const candidates = scored.filter((m) => m.score >= suggest).sort((a, b) => b.score - a.score || a.index - b.index);
  const best = candidates[0];
  if (!best) return { decision: "none", candidates };
  return { decision: decide(best.score, options), match: best, candidates };
}

// ---------------------------------------------------------------------------------------------------------------------
// Model scorer for the fuzzy band (Haiku route)
// ---------------------------------------------------------------------------------------------------------------------

const IdentityScore = z.object({ same_entity_probability: z.number().min(0).max(1), reason: z.string() });

/**
 * Build a `modelScore` hook from a model client. In mock mode it returns null (no model opinion) so decisions stay
 * deterministic and local; a synthetic probability must never drive an auto-merge.
 */
export function createModelScorer(client: LinkerModelClient, attribution?: { businessId?: string }): ResolveOptions["modelScore"] {
  return async (candidate, existing) => {
    if (client.mode === "mock") return null;
    try {
      const result = await client.complete({
        route: "linker",
        system:
          "You judge whether two CRM records describe the same real-world person or organisation. Use only the fields given; " +
          "do not assume. Return JSON {\"same_entity_probability\": 0-1, \"reason\": string} only.",
        messages: [{ role: "user", content: JSON.stringify({ a: publicFields(candidate), b: publicFields(existing) }, null, 2) }],
        schema: IdentityScore,
        maxTokens: 200,
        temperature: 0,
        attribution: { ...(attribution ?? {}), kind: "identity_resolution" },
      });
      return result.json?.same_entity_probability ?? null;
    } catch {
      return null;
    }
  };
}

function publicFields(r: IdentityRecord): Record<string, unknown> {
  return { kind: r.kind, name: r.name, aliases: r.aliases ?? [], org: r.org ?? null, identifiers: normalizeIdentifiers(r.identifiers) };
}

// ---------------------------------------------------------------------------------------------------------------------
// Merge planning (enrichment fills empty fields only; reversible)
// ---------------------------------------------------------------------------------------------------------------------

export interface MergeableEntity extends IdentityRecord {
  id: string;
  [field: string]: unknown;
}

export interface MergePlan<T extends MergeableEntity> {
  /** The kept record with empty fields filled from the merged one, aliases and identifiers unioned. */
  kept: T;
  /** Fields of `kept` that changed, with their previous and new values. */
  changes: Array<{ field: string; before: unknown; after: unknown }>;
  /** Exact copies of both records before the merge: what `merge_log.reversible_snapshot` stores. */
  snapshot: { kept: T; merged: T };
}

const isEmpty = (v: unknown): boolean => v === null || v === undefined || (typeof v === "string" && v.trim() === "") || (Array.isArray(v) && v.length === 0) || (typeof v === "object" && v !== null && !Array.isArray(v) && Object.keys(v as object).length === 0);

/** Merge `merged` into `kept`: fills empty fields only, unions aliases (adding the merged name) and identifiers. */
export function planMerge<T extends MergeableEntity>(kept: T, merged: T): MergePlan<T> {
  const snapshot = { kept: structuredClone(kept), merged: structuredClone(merged) };
  const next: Record<string, unknown> = { ...structuredClone(kept) };
  const changes: MergePlan<T>["changes"] = [];
  const RESERVED = new Set(["id", "aliases", "identifiers", "name"]);
  for (const [field, value] of Object.entries(merged)) {
    if (RESERVED.has(field) || isEmpty(value)) continue;
    if (isEmpty(next[field])) {
      changes.push({ field, before: next[field], after: structuredClone(value) });
      next[field] = structuredClone(value);
    }
  }
  const aliasSet = new Map<string, string>();
  for (const a of [...(kept.aliases ?? []), merged.name, ...(merged.aliases ?? [])]) {
    const key = normalizeName(a);
    if (!key || key === normalizeName(kept.name) || aliasSet.has(key)) continue;
    aliasSet.set(key, a);
  }
  const aliases = [...aliasSet.values()];
  if (JSON.stringify(aliases) !== JSON.stringify(kept.aliases ?? [])) {
    changes.push({ field: "aliases", before: kept.aliases ?? [], after: aliases });
    next.aliases = aliases;
  }
  const identifiers: Identifiers = { ...(kept.identifiers ?? {}) };
  for (const [k, v] of Object.entries(merged.identifiers ?? {})) {
    if (isEmpty(v) || !isEmpty(identifiers[k])) continue;
    identifiers[k] = v;
  }
  if (JSON.stringify(identifiers) !== JSON.stringify(kept.identifiers ?? {})) {
    changes.push({ field: "identifiers", before: kept.identifiers ?? {}, after: identifiers });
    next.identifiers = identifiers;
  }
  return { kept: next as T, changes, snapshot };
}

/** Restore both records exactly as they were before `planMerge` (AC-11.12.3). */
export function unmerge<T extends MergeableEntity>(snapshot: MergePlan<T>["snapshot"]): { kept: T; merged: T } {
  return { kept: structuredClone(snapshot.kept), merged: structuredClone(snapshot.merged) };
}

const round = (n: number): number => Math.round(n * 1000) / 1000;

export { foldText as foldIdentityText };
