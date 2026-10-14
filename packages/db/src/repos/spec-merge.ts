/**
 * Three-way merge of spec content for accepted change-proposal hunks (BUILD §11.5 "three-way merges", AC-11.5.3).
 *
 * A hunk records `base` (the block when the proposal was drafted) and `theirs` (what the proposal, or the founder's
 * edit of it, wants the block to say). The block may have changed since (a human edit, another accepted proposal), so
 * accepting a hunk applies the change from `base` to `theirs` onto the live content instead of overwriting it:
 * top-level nodes (paragraphs, headings, lists) are diffed against `base` on both sides (diff3 over an LCS of node
 * keys). A region only one side changed takes that side; a region both sides changed the same way is taken once;
 * paragraphs both sides only added at the same place are all kept (the live ones first); a region both changed
 * differently is a conflict and takes `theirs`, because the founder has just decided this hunk with the live text in
 * front of them. Pure functions, no database access.
 */

export type PmNode = Record<string, unknown>;

export interface MergeResult {
  content: PmNode;
  /** Regions where the live content and the hunk changed the same nodes differently (resolved to the hunk's side). */
  conflicts: number;
  /** True when the live content had changed since the hunk's base (the result is a merge, not a plain replace). */
  merged: boolean;
}

/** Deterministic JSON (sorted keys) so equal nodes always compare equal. */
function canonical(value: unknown): string {
  return JSON.stringify(sortKeys(value)) ?? "null";
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(value as Record<string, unknown>).sort()) out[k] = sortKeys((value as Record<string, unknown>)[k]);
    return out;
  }
  return value;
}

export function sameContent(a: unknown, b: unknown): boolean {
  return canonical(a ?? null) === canonical(b ?? null);
}

function topNodes(doc: unknown): unknown[] | null {
  if (!doc || typeof doc !== "object") return null;
  const content = (doc as { content?: unknown }).content;
  return Array.isArray(content) ? content : null;
}

/** Index pairs of a longest common subsequence of two key lists (classic DP; blocks have tens of nodes, not thousands). */
function lcsPairs(a: readonly string[], b: readonly string[]): [number, number][] {
  const n = a.length;
  const m = b.length;
  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) dp[i]![j] = a[i] === b[j] ? dp[i + 1]![j + 1]! + 1 : Math.max(dp[i + 1]![j]!, dp[i]![j + 1]!);
  }
  const pairs: [number, number][] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      pairs.push([i, j]);
      i++;
      j++;
    } else if (dp[i + 1]![j]! >= dp[i]![j + 1]!) i++;
    else j++;
  }
  return pairs;
}

/**
 * Merge `theirs` into `current` relative to `base`. Without a usable base (a hunk drafted before bases were recorded,
 * or content that is not a document) the hunk replaces the block, which is what accepting it has always promised.
 */
export function mergeBlockContent(base: PmNode | null | undefined, current: PmNode, theirs: PmNode): MergeResult {
  if (!base || sameContent(base, current)) return { content: theirs, conflicts: 0, merged: false };
  if (sameContent(base, theirs) || sameContent(current, theirs)) return { content: current, conflicts: 0, merged: true };
  const B = topNodes(base);
  const C = topNodes(current);
  const T = topNodes(theirs);
  if (!B || !C || !T) return { content: theirs, conflicts: 1, merged: true };

  const kb = B.map(canonical);
  const kc = C.map(canonical);
  const kt = T.map(canonical);
  const toC = new Map(lcsPairs(kb, kc));
  const toT = new Map(lcsPairs(kb, kt));

  const out: unknown[] = [];
  let conflicts = 0;
  const same = (x: string[], y: string[]) => x.length === y.length && x.every((k, i) => k === y[i]);
  const resolve = (b: string[], c: unknown[], t: unknown[], cKeys: string[], tKeys: string[]) => {
    if (same(cKeys, b)) out.push(...t);
    else if (same(tKeys, b) || same(cKeys, tKeys)) out.push(...c);
    // Both sides added paragraphs at the same place and removed nothing: keep the live ones, then the hunk's.
    else if (b.length === 0) out.push(...c, ...t);
    else if (b.length === cKeys.length && b.length === tKeys.length) {
      // Adjacent paragraphs edited in place on each side (no node added or removed): settle them one by one.
      b.forEach((k, i) => {
        if (cKeys[i] === k || cKeys[i] === tKeys[i]) out.push(t[i]);
        else if (tKeys[i] === k) out.push(c[i]);
        else {
          conflicts += 1;
          out.push(t[i]);
        }
      });
    } else {
      conflicts += 1;
      out.push(...t);
    }
  };

  let ib = 0;
  let ic = 0;
  let it = 0;
  for (let k = 0; k < B.length; k++) {
    const c = toC.get(k);
    const t = toT.get(k);
    // A stable anchor: the base node survives, in order, on both sides.
    if (c === undefined || t === undefined || c < ic || t < it) continue;
    resolve(kb.slice(ib, k), C.slice(ic, c), T.slice(it, t), kc.slice(ic, c), kt.slice(it, t));
    out.push(B[k]);
    ib = k + 1;
    ic = c + 1;
    it = t + 1;
  }
  resolve(kb.slice(ib), C.slice(ic), T.slice(it), kc.slice(ic), kt.slice(it));
  return { content: { ...current, ...theirs, content: out }, conflicts, merged: true };
}

/** Plain text of a document: one line per paragraph or heading, blank-line separated (roadmap descriptions are Markdown). */
export function docText(doc: unknown): string {
  const lines: string[] = [];
  const inline = (n: { text?: unknown; content?: unknown }): string => (typeof n.text === "string" ? n.text : Array.isArray(n.content) ? (n.content as object[]).map((c) => inline(c)).join("") : "");
  const walk = (n: unknown) => {
    if (!n || typeof n !== "object") return;
    const node = n as { type?: unknown; content?: unknown };
    if (node.type === "paragraph" || node.type === "heading") {
      const t = inline(node).trim();
      if (t) lines.push(t);
    } else if (Array.isArray(node.content)) for (const c of node.content) walk(c);
  };
  walk(doc);
  return lines.join("\n\n");
}

/** A document of plain paragraphs from text (blank lines separate paragraphs). */
export function textDoc(text: string): PmNode {
  const paragraphs = text
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter(Boolean);
  return { type: "doc", content: paragraphs.map((p) => ({ type: "paragraph", content: [{ type: "text", text: p }] })) };
}
