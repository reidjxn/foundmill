/**
 * Line diff for DiffView (BUILD §5.4, §11.5 "per-hunk accept/reject/edit", three-way merges).
 *
 * `diffLines` is Myers' O(ND) shortest-edit-script algorithm with a trace so the script is exact (no heuristics), on
 * the scale of spec blocks and code files (thousands of lines). `buildHunks` groups edits with N lines of context the
 * way `diff -u` does; `applyDecisions` produces the merged text for a set of per-hunk decisions; `threeWay` aligns a
 * base against two revisions and flags hunks where both sides touched the same base lines.
 */
import type { HunkDecision } from "@founder-manager/shared";

export type DiffOpKind = "equal" | "insert" | "delete";

export interface DiffOp {
  kind: DiffOpKind;
  /** Line text (without its newline). */
  text: string;
  /** 1-based line number in the old text (equal and delete). */
  oldLine?: number;
  /** 1-based line number in the new text (equal and insert). */
  newLine?: number;
}

export interface DiffLine extends DiffOp {
  /** Stable key inside its hunk. */
  key: string;
}

export interface Hunk {
  /** `h<index>` — stable for a given pair of texts, which is what decisions key on. */
  id: string;
  index: number;
  oldStart: number;
  oldLines: number;
  newStart: number;
  newLines: number;
  lines: DiffLine[];
  /** Counts of changed lines, for the hunk header and the summary. */
  added: number;
  removed: number;
}

export interface HunkDecisionState {
  decision: HunkDecision;
  /** Replacement for the hunk's new side when `decision` is `edited`. */
  text?: string;
}

export type HunkDecisions = Record<string, HunkDecisionState | undefined>;

/** Split keeping an exact round trip: a trailing newline does not add an empty last line. */
export function splitLines(text: string): string[] {
  if (text.length === 0) return [];
  const lines = text.split(/\r?\n/);
  if (lines[lines.length - 1] === "") lines.pop();
  return lines;
}

/** Myers diff over arrays of lines. */
export function diffLines(
  oldText: string | readonly string[],
  newText: string | readonly string[],
): DiffOp[] {
  const a = typeof oldText === "string" ? splitLines(oldText) : [...oldText];
  const b = typeof newText === "string" ? splitLines(newText) : [...newText];
  const n = a.length;
  const m = b.length;

  // Trim the common prefix and suffix first: cheap and keeps the edit graph small.
  let prefix = 0;
  while (prefix < n && prefix < m && a[prefix] === b[prefix]) prefix++;
  let suffix = 0;
  while (suffix < n - prefix && suffix < m - prefix && a[n - 1 - suffix] === b[m - 1 - suffix])
    suffix++;

  const core = myers(a.slice(prefix, n - suffix), b.slice(prefix, m - suffix));
  const ops: DiffOp[] = [];
  for (let i = 0; i < prefix; i++) ops.push({ kind: "equal", text: a[i] as string });
  ops.push(...core);
  for (let i = n - suffix; i < n; i++) ops.push({ kind: "equal", text: a[i] as string });

  let oldLine = 0;
  let newLine = 0;
  for (const op of ops) {
    if (op.kind !== "insert") op.oldLine = ++oldLine;
    if (op.kind !== "delete") op.newLine = ++newLine;
  }
  return ops;
}

function myers(a: string[], b: string[]): DiffOp[] {
  const n = a.length;
  const m = b.length;
  if (n === 0 && m === 0) return [];
  if (n === 0) return b.map((text) => ({ kind: "insert" as const, text }));
  if (m === 0) return a.map((text) => ({ kind: "delete" as const, text }));

  const max = n + m;
  const offset = max;
  const size = 2 * max + 1;
  let v = new Int32Array(size).fill(0);
  const trace: Int32Array[] = [];

  outer: for (let d = 0; d <= max; d++) {
    trace.push(v);
    const next = new Int32Array(v);
    for (let k = -d; k <= d; k += 2) {
      const kIdx = k + offset;
      let x: number;
      if (k === -d || (k !== d && (v[kIdx - 1] as number) < (v[kIdx + 1] as number))) {
        x = v[kIdx + 1] as number; // move down (insert)
      } else {
        x = (v[kIdx - 1] as number) + 1; // move right (delete)
      }
      let y = x - k;
      while (x < n && y < m && a[x] === b[y]) {
        x++;
        y++;
      }
      next[kIdx] = x;
      if (x >= n && y >= m) break outer;
    }
    v = next;
  }

  // Backtrack: trace[d] is the frontier before round d.
  const ops: DiffOp[] = [];
  let x = n;
  let y = m;
  for (let d = trace.length - 1; d >= 0; d--) {
    const vd = trace[d] as Int32Array;
    const k = x - y;
    const kIdx = k + offset;
    let prevK: number;
    if (k === -d || (k !== d && (vd[kIdx - 1] as number) < (vd[kIdx + 1] as number))) prevK = k + 1;
    else prevK = k - 1;
    const prevX = vd[prevK + offset] as number;
    const prevY = prevX - prevK;
    while (x > prevX && y > prevY) {
      ops.push({ kind: "equal", text: a[x - 1] as string });
      x--;
      y--;
    }
    if (d > 0) {
      if (x === prevX) ops.push({ kind: "insert", text: b[y - 1] as string });
      else ops.push({ kind: "delete", text: a[x - 1] as string });
    }
    x = prevX;
    y = prevY;
  }
  ops.reverse();
  return ops;
}

/** Group ops into hunks with `context` equal lines around each run of changes (unified-diff style). */
export function buildHunks(ops: readonly DiffOp[], context = 3): Hunk[] {
  const changed: number[] = [];
  ops.forEach((op, i) => {
    if (op.kind !== "equal") changed.push(i);
  });
  if (changed.length === 0) return [];

  const ranges: Array<[number, number]> = [];
  let start = Math.max(0, (changed[0] as number) - context);
  let end = Math.min(ops.length - 1, (changed[0] as number) + context);
  for (let i = 1; i < changed.length; i++) {
    const c = changed[i] as number;
    if (c - context <= end + 1) {
      end = Math.min(ops.length - 1, c + context);
    } else {
      ranges.push([start, end]);
      start = Math.max(0, c - context);
      end = Math.min(ops.length - 1, c + context);
    }
  }
  ranges.push([start, end]);

  return ranges.map(([s, e], index) => {
    const lines: DiffLine[] = [];
    let oldStart = 0;
    let newStart = 0;
    let oldLines = 0;
    let newLines = 0;
    let added = 0;
    let removed = 0;
    for (let i = s; i <= e; i++) {
      const op = ops[i] as DiffOp;
      if (op.kind !== "insert") {
        if (oldLines === 0) oldStart = op.oldLine ?? 0;
        oldLines++;
      }
      if (op.kind !== "delete") {
        if (newLines === 0) newStart = op.newLine ?? 0;
        newLines++;
      }
      if (op.kind === "insert") added++;
      if (op.kind === "delete") removed++;
      lines.push({ ...op, key: `${index}:${i}` });
    }
    // A hunk with no old lines starts "after" the previous old line (diff -u convention).
    if (oldLines === 0) {
      const before = ops
        .slice(0, s)
        .reverse()
        .find((o) => o.oldLine !== undefined);
      oldStart = before?.oldLine ?? 0;
    }
    if (newLines === 0) {
      const before = ops
        .slice(0, s)
        .reverse()
        .find((o) => o.newLine !== undefined);
      newStart = before?.newLine ?? 0;
    }
    return {
      id: `h${index}`,
      index,
      oldStart,
      oldLines,
      newStart,
      newLines,
      lines,
      added,
      removed,
    };
  });
}

/** `@@ -a,b +c,d @@` */
export function hunkHeader(h: Hunk): string {
  return `@@ -${h.oldStart},${h.oldLines} +${h.newStart},${h.newLines} @@`;
}

/** The hunk's old-side and new-side lines (context included). */
export function hunkSideLines(h: Hunk): { oldLines: string[]; newLines: string[] } {
  return {
    oldLines: h.lines.filter((l) => l.kind !== "insert").map((l) => l.text),
    newLines: h.lines.filter((l) => l.kind !== "delete").map((l) => l.text),
  };
}

/** The hunk's old-side and new-side texts (context included). */
export function hunkSides(h: Hunk): { oldText: string; newText: string } {
  const { oldLines, newLines } = hunkSideLines(h);
  return { oldText: oldLines.join("\n"), newText: newLines.join("\n") };
}

/**
 * Merge: walk the ops; for each hunk use its new side when accepted, its old side when rejected or pending, or the
 * edited text when edited. Equal lines outside hunks pass through. Returns the merged lines joined with "\n".
 */
export function applyDecisions(
  ops: readonly DiffOp[],
  hunks: readonly Hunk[],
  decisions: HunkDecisions,
  options: { pendingAs?: "old" | "new" } = {},
): string {
  const pendingAs = options.pendingAs ?? "old";
  const out: string[] = [];
  const byStart = new Map<string, Hunk>();
  for (const h of hunks) {
    const firstKey = h.lines[0]?.key;
    if (firstKey) byStart.set(firstKey.split(":")[1] as string, h);
  }
  let i = 0;
  while (i < ops.length) {
    const h = byStart.get(String(i));
    if (!h) {
      const op = ops[i] as DiffOp;
      if (op.kind === "equal") out.push(op.text);
      i++;
      continue;
    }
    const state = decisions[h.id];
    const decision = state?.decision ?? "pending";
    if (decision === "edited" && state?.text !== undefined) {
      out.push(...splitLines(state.text));
    } else {
      const side = decision === "accepted" ? "new" : decision === "rejected" ? "old" : pendingAs;
      const { oldLines, newLines } = hunkSideLines(h);
      out.push(...(side === "new" ? newLines : oldLines));
    }
    i += h.lines.length;
  }
  return out.join("\n");
}

export interface DiffSummary {
  added: number;
  removed: number;
  hunks: number;
  accepted: number;
  rejected: number;
  edited: number;
  pending: number;
}

export function summariseDiff(hunks: readonly Hunk[], decisions: HunkDecisions = {}): DiffSummary {
  const s: DiffSummary = {
    added: 0,
    removed: 0,
    hunks: hunks.length,
    accepted: 0,
    rejected: 0,
    edited: 0,
    pending: 0,
  };
  for (const h of hunks) {
    s.added += h.added;
    s.removed += h.removed;
    const d = decisions[h.id]?.decision ?? "pending";
    s[d]++;
  }
  return s;
}

// ---------------------------------------------------------------------------------------------------------------------
// Three-way
// ---------------------------------------------------------------------------------------------------------------------

export interface ThreeWayRow {
  /** 1-based base line this row aligns to; undefined for lines inserted by a side. */
  baseLine?: number;
  /** `equal` = same as base (or no line here), `changed` = replaced, `missing` = deleted by this side, `added` = inserted. */
  base?: string;
  ours?: string;
  theirs?: string;
  oursKind: "equal" | "changed" | "missing" | "added";
  theirsKind: "equal" | "changed" | "missing" | "added";
}

export interface ThreeWayHunk {
  id: string;
  index: number;
  /** Base line range touched (1-based, inclusive; `baseEnd < baseStart` for a pure insertion). */
  baseStart: number;
  baseEnd: number;
  rows: ThreeWayRow[];
  /** Both sides changed the same base lines. */
  conflict: boolean;
  oursChanged: boolean;
  theirsChanged: boolean;
}

interface SideMap {
  /** Base line → replacement lines from this side (`[]` when deleted); absent when unchanged. */
  changes: Map<number, string[]>;
  /** Base line → lines inserted after it (0 = before the first). */
  inserts: Map<number, string[]>;
}

function sideMap(base: string[], side: string[]): SideMap {
  const ops = diffLines(base, side);
  const changes = new Map<number, string[]>();
  const inserts = new Map<number, string[]>();
  let lastBase = 0;
  let pendingDelete: number[] = [];
  for (const op of ops) {
    if (op.kind === "equal") {
      pendingDelete = [];
      lastBase = op.oldLine as number;
    } else if (op.kind === "delete") {
      changes.set(op.oldLine as number, []);
      pendingDelete.push(op.oldLine as number);
      lastBase = op.oldLine as number;
    } else {
      const target = pendingDelete.shift();
      if (target !== undefined) {
        changes.set(target, [op.text]);
      } else {
        const list = inserts.get(lastBase) ?? [];
        list.push(op.text);
        inserts.set(lastBase, list);
      }
    }
  }
  return { changes, inserts };
}

/** Align base, ours and theirs by base line; group changed regions into hunks with `context` lines. */
export function threeWay(
  baseText: string,
  oursText: string,
  theirsText: string,
  context = 3,
): ThreeWayHunk[] {
  const base = splitLines(baseText);
  const ours = sideMap(base, splitLines(oursText));
  const theirs = sideMap(base, splitLines(theirsText));

  const rows: ThreeWayRow[] = [];
  const pushInserts = (at: number): void => {
    const o = ours.inserts.get(at) ?? [];
    const t = theirs.inserts.get(at) ?? [];
    const len = Math.max(o.length, t.length);
    for (let i = 0; i < len; i++) {
      // A side that did not insert here is simply unchanged (blank cell), not "missing".
      rows.push({
        ours: o[i],
        theirs: t[i],
        oursKind: o[i] !== undefined ? "added" : "equal",
        theirsKind: t[i] !== undefined ? "added" : "equal",
      });
    }
  };
  pushInserts(0);
  base.forEach((line, idx) => {
    const n = idx + 1;
    const o = ours.changes.get(n);
    const t = theirs.changes.get(n);
    rows.push({
      baseLine: n,
      base: line,
      ours: o ? o[0] : line,
      theirs: t ? t[0] : line,
      oursKind: o ? (o.length ? "changed" : "missing") : "equal",
      theirsKind: t ? (t.length ? "changed" : "missing") : "equal",
    });
    pushInserts(n);
  });

  const isChanged = (r: ThreeWayRow): boolean => r.oursKind !== "equal" || r.theirsKind !== "equal";
  const changed: number[] = [];
  rows.forEach((r, i) => {
    if (isChanged(r)) changed.push(i);
  });
  if (changed.length === 0) return [];
  const ranges: Array<[number, number]> = [];
  let s = Math.max(0, (changed[0] as number) - context);
  let e = Math.min(rows.length - 1, (changed[0] as number) + context);
  for (let i = 1; i < changed.length; i++) {
    const c = changed[i] as number;
    if (c - context <= e + 1) e = Math.min(rows.length - 1, c + context);
    else {
      ranges.push([s, e]);
      s = Math.max(0, c - context);
      e = Math.min(rows.length - 1, c + context);
    }
  }
  ranges.push([s, e]);
  return ranges.map(([from, to], index) => {
    const slice = rows.slice(from, to + 1);
    const touched = slice.filter(isChanged);
    const oursChanged = touched.some((r) => r.oursKind !== "equal");
    const theirsChanged = touched.some((r) => r.theirsKind !== "equal");
    const conflict = touched.some(
      (r) => r.oursKind !== "equal" && r.theirsKind !== "equal" && r.ours !== r.theirs,
    );
    const baseLines = slice.map((r) => r.baseLine).filter((n): n is number => n !== undefined);
    const baseStart = baseLines[0] ?? 0;
    const baseEnd = baseLines[baseLines.length - 1] ?? -1;
    return {
      id: `t${index}`,
      index,
      baseStart,
      baseEnd,
      rows: slice,
      conflict,
      oursChanged,
      theirsChanged,
    };
  });
}
