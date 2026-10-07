/**
 * ProseMirror JSON ⇄ Yjs (y-prosemirror layout) without a ProseMirror schema.
 *
 * `spec_blocks.content` is ProseMirror JSON (jsonb) and there is no Yjs state column (see DECISIONS.md
 * "apps/collab: spec blocks round-trip through ProseMirror JSON"), so the server converts on load and on store.
 * The layout is exactly what y-prosemirror / Tiptap's Collaboration extension produce in the `default`
 * XmlFragment: one `Y.XmlElement` per block/inline node (nodeName = node type, attributes = non-null attrs),
 * consecutive text nodes collapsed into one `Y.XmlText` whose formatting attributes are the marks
 * (`{ [mark.type]: mark.attrs }`). Decoding mirrors y-prosemirror's `yXmlFragmentToProsemirrorJSON`, emitting
 * `attrs` only when non-empty, which is also what `Node.toJSON()` does.
 */
import * as Y from "yjs";

export const DEFAULT_FRAGMENT = "default" as const;

export interface PmMark {
  type: string;
  attrs?: Record<string, unknown>;
}

export interface PmNode {
  type: string;
  attrs?: Record<string, unknown>;
  content?: PmNode[];
  marks?: PmMark[];
  text?: string;
}

export const EMPTY_DOC: PmNode = { type: "doc", content: [] };

export class InvalidProseMirrorJsonError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidProseMirrorJsonError";
  }
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

/** Structural validation of a ProseMirror document (no schema): the shape `Node.fromJSON` can read. */
export function parsePmDoc(input: unknown): PmNode {
  if (!isRecord(input)) throw new InvalidProseMirrorJsonError("document must be an object");
  const node = parsePmNode(input, "doc");
  if (node.type !== "doc") throw new InvalidProseMirrorJsonError(`root node must be "doc", got ${JSON.stringify(node.type)}`);
  return node;
}

function parsePmNode(input: unknown, path: string): PmNode {
  if (!isRecord(input)) throw new InvalidProseMirrorJsonError(`${path}: node must be an object`);
  const type = input.type;
  if (typeof type !== "string" || type.length === 0) throw new InvalidProseMirrorJsonError(`${path}: node has no type`);
  const node: PmNode = { type };
  if (input.attrs !== undefined) {
    if (!isRecord(input.attrs)) throw new InvalidProseMirrorJsonError(`${path}: attrs must be an object`);
    node.attrs = input.attrs;
  }
  if (type === "text") {
    if (typeof input.text !== "string") throw new InvalidProseMirrorJsonError(`${path}: text node has no text`);
    node.text = input.text;
    if (input.marks !== undefined) {
      if (!Array.isArray(input.marks)) throw new InvalidProseMirrorJsonError(`${path}: marks must be an array`);
      node.marks = input.marks.map((m, i) => {
        if (!isRecord(m) || typeof m.type !== "string") throw new InvalidProseMirrorJsonError(`${path}.marks[${i}]: mark has no type`);
        const mark: PmMark = { type: m.type };
        if (m.attrs !== undefined) {
          if (!isRecord(m.attrs)) throw new InvalidProseMirrorJsonError(`${path}.marks[${i}]: attrs must be an object`);
          mark.attrs = m.attrs;
        }
        return mark;
      });
    }
    if (input.content !== undefined) throw new InvalidProseMirrorJsonError(`${path}: text nodes have no content`);
    return node;
  }
  if (input.content !== undefined) {
    if (!Array.isArray(input.content)) throw new InvalidProseMirrorJsonError(`${path}: content must be an array`);
    node.content = input.content.map((c, i) => parsePmNode(c, `${path}.content[${i}]`));
  }
  return node;
}

// --- encode: ProseMirror JSON → Yjs ------------------------------------------------------------------------------------

function marksToAttributes(marks: PmMark[] | undefined): Record<string, unknown> | undefined {
  if (!marks || marks.length === 0) return undefined;
  const attrs: Record<string, unknown> = {};
  for (const mark of marks) if (mark.type !== "ychange") attrs[mark.type] = mark.attrs ?? {};
  return attrs;
}

function textFromNodes(nodes: PmNode[]): Y.XmlText {
  const text = new Y.XmlText();
  const delta = nodes.map((n) => {
    const attributes = marksToAttributes(n.marks);
    return attributes ? { insert: n.text ?? "", attributes } : { insert: n.text ?? "" };
  });
  text.applyDelta(delta);
  return text;
}

function elementFromNode(node: PmNode): Y.XmlElement {
  const el = new Y.XmlElement(node.type);
  if (node.attrs) {
    for (const [key, value] of Object.entries(node.attrs)) {
      if (value !== null && value !== undefined && key !== "ychange") el.setAttribute(key, value as string);
    }
  }
  el.insert(0, typesFromNodes(node.content ?? []));
  return el;
}

/** Converts a node list into Yjs types, collapsing runs of text nodes into one XmlText (y-prosemirror's normalisation). */
export function typesFromNodes(nodes: PmNode[]): Array<Y.XmlElement | Y.XmlText> {
  const out: Array<Y.XmlElement | Y.XmlText> = [];
  let run: PmNode[] = [];
  const flush = () => {
    if (run.length) out.push(textFromNodes(run));
    run = [];
  };
  for (const node of nodes) {
    if (node.type === "text") run.push(node);
    else {
      flush();
      out.push(elementFromNode(node));
    }
  }
  flush();
  return out;
}

/** Fills an (empty) fragment with the document's children. Call inside a transaction when the fragment is integrated. */
export function fillFragment(fragment: Y.XmlFragment, doc: PmNode): void {
  fragment.insert(fragment.length, typesFromNodes(doc.content ?? []));
}

// --- decode: Yjs → ProseMirror JSON ------------------------------------------------------------------------------------

type DeltaOp = { insert: unknown; attributes?: Record<string, unknown> };

function serializeType(item: Y.XmlElement | Y.XmlText | Y.XmlHook): PmNode[] {
  if (item instanceof Y.XmlText) {
    const delta = item.toDelta() as DeltaOp[];
    const nodes: PmNode[] = [];
    for (const op of delta) {
      if (typeof op.insert !== "string" || op.insert.length === 0) continue;
      const node: PmNode = { type: "text", text: op.insert };
      if (op.attributes) {
        const marks = Object.entries(op.attributes).map(([type, attrs]) => {
          const mark: PmMark = { type };
          if (isRecord(attrs) && Object.keys(attrs).length > 0) mark.attrs = attrs;
          return mark;
        });
        if (marks.length) node.marks = marks;
      }
      nodes.push(node);
    }
    return nodes;
  }
  if (item instanceof Y.XmlElement) {
    const node: PmNode = { type: item.nodeName };
    const attrs = item.getAttributes() as Record<string, unknown>;
    const kept = Object.fromEntries(Object.entries(attrs).filter(([, v]) => v !== undefined));
    if (Object.keys(kept).length) node.attrs = kept;
    const children = item.toArray().flatMap((child) => serializeType(child));
    if (children.length) node.content = children;
    return [node];
  }
  return [];
}

/** The ProseMirror JSON document held in a fragment (root `doc`). */
export function fragmentToPmDoc(fragment: Y.XmlFragment): PmNode {
  return { type: "doc", content: fragment.toArray().flatMap((item) => serializeType(item)) };
}

export function docToPmDoc(ydoc: Y.Doc, field: string = DEFAULT_FRAGMENT): PmNode {
  return fragmentToPmDoc(ydoc.getXmlFragment(field));
}

/** A new Y.Doc holding the given ProseMirror document (used for tests and for `onLoadDocument`). */
export function pmDocToYDoc(doc: PmNode, field: string = DEFAULT_FRAGMENT): Y.Doc {
  const ydoc = new Y.Doc();
  ydoc.transact(() => fillFragment(ydoc.getXmlFragment(field), doc));
  return ydoc;
}


// --- reconcile: apply a new ProseMirror document as a minimal edit -------------------------------------------------------

export function pmEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
    return a.every((x, i) => pmEqual(x, b[i]));
  }
  if (isRecord(a) && isRecord(b)) {
    const ka = Object.keys(a).filter((k) => a[k] !== undefined);
    const kb = Object.keys(b).filter((k) => b[k] !== undefined);
    if (ka.length !== kb.length) return false;
    return ka.every((k) => pmEqual(a[k], b[k]));
  }
  return false;
}

export interface ReconcileResult {
  /** Number of Yjs operations applied (block inserts/deletes, attribute changes, text edits). 0 = already matched. */
  changed: number;
  /** Top-level blocks that were left untouched because they already matched. */
  kept: number;
}

type YItem = Y.XmlElement | Y.XmlText | Y.XmlHook;

/** Longest common subsequence as increasing index pairs. */
function lcsPairs(n: number, m: number, eq: (i: number, j: number) => boolean): Array<[number, number]> {
  if (n === 0 || m === 0) return [];
  const L: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i -= 1) {
    const row = L[i]!;
    const below = L[i + 1]!;
    for (let j = m - 1; j >= 0; j -= 1) row[j] = eq(i, j) ? below[j + 1]! + 1 : Math.max(below[j]!, row[j + 1]!);
  }
  const pairs: Array<[number, number]> = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (eq(i, j)) {
      pairs.push([i, j]);
      i += 1;
      j += 1;
    } else if (L[i + 1]![j]! >= L[i]![j + 1]!) i += 1;
    else j += 1;
  }
  return pairs;
}

/** Groups consecutive text nodes (one Y.XmlText each) the way the encoder lays them out. */
function groupTarget(nodes: PmNode[]): PmNode[][] {
  const groups: PmNode[][] = [];
  for (const node of nodes) {
    const last = groups[groups.length - 1];
    if (node.type === "text" && last && last[0]?.type === "text") last.push(node);
    else groups.push([node]);
  }
  return groups;
}

const stableKey = (v: Record<string, unknown> | undefined): string => (v ? JSON.stringify(Object.keys(v).sort().map((k) => [k, v[k]])) : "");

interface Char {
  ch: string;
  key: string;
  attributes: Record<string, unknown>;
}

function charsOfDelta(delta: DeltaOp[]): Char[] {
  const out: Char[] = [];
  for (const op of delta) {
    if (typeof op.insert !== "string") continue;
    const attributes = op.attributes ?? {};
    const key = stableKey(op.attributes);
    for (const ch of op.insert) out.push({ ch, key, attributes });
  }
  return out;
}

function charsOfNodes(nodes: PmNode[]): Char[] {
  const out: Char[] = [];
  for (const node of nodes) {
    const attributes = marksToAttributes(node.marks) ?? {};
    const key = stableKey(marksToAttributes(node.marks));
    for (const ch of node.text ?? "") out.push({ ch, key, attributes });
  }
  return out;
}

/** Minimal text edit: common prefix/suffix (characters + marks), delete the middle, insert the new middle per mark run. */
function reconcileText(text: Y.XmlText, run: PmNode[], c: ReconcileResult): void {
  const cur = charsOfDelta(text.toDelta() as DeltaOp[]);
  const tgt = charsOfNodes(run);
  const same = (a: Char, b: Char) => a.ch === b.ch && a.key === b.key;
  let p = 0;
  while (p < cur.length && p < tgt.length && same(cur[p]!, tgt[p]!)) p += 1;
  let s = 0;
  while (s < cur.length - p && s < tgt.length - p && same(cur[cur.length - 1 - s]!, tgt[tgt.length - 1 - s]!)) s += 1;
  const deleteCount = cur.length - p - s;
  const middle = tgt.slice(p, tgt.length - s);
  if (deleteCount === 0 && middle.length === 0) return;
  if (deleteCount > 0) text.delete(p, deleteCount);
  let index = p;
  let i = 0;
  while (i < middle.length) {
    const key = middle[i]!.key;
    let piece = "";
    while (i < middle.length && middle[i]!.key === key) {
      piece += middle[i]!.ch;
      i += 1;
    }
    // Explicit attributes ({} for plain) so the insert never inherits the neighbouring run's marks.
    text.insert(index, piece, middle[i - 1]!.attributes);
    index += piece.length;
  }
  c.changed += 1;
}

function reconcileAttributes(el: Y.XmlElement, target: PmNode, c: ReconcileResult): void {
  const current = el.getAttributes() as Record<string, unknown>;
  const next = target.attrs ?? {};
  for (const key of Object.keys(current)) {
    if (next[key] === null || next[key] === undefined) {
      el.removeAttribute(key);
      c.changed += 1;
    }
  }
  for (const [key, value] of Object.entries(next)) {
    if (value === null || value === undefined || key === "ychange") continue;
    if (!pmEqual(current[key], value)) {
      el.setAttribute(key, value as string);
      c.changed += 1;
    }
  }
}

function reconcileChildren(parent: Y.XmlFragment | Y.XmlElement, targetNodes: PmNode[], c: ReconcileResult, topLevel: boolean): void {
  const current = parent.toArray() as YItem[];
  const currentJson = current.map((item) => serializeType(item));
  const groups = groupTarget(targetNodes);
  const n = current.length;
  const m = groups.length;
  const deepEq = (i: number, j: number) => pmEqual(currentJson[i], groups[j]);
  const shallowEq = (i: number, j: number) => {
    const item = current[i]!;
    const head = groups[j]![0]!;
    if (item instanceof Y.XmlText) return head.type === "text";
    if (item instanceof Y.XmlElement) return head.type !== "text" && item.nodeName === head.type;
    return false;
  };
  // Pass 1: anchor identical items. Pass 2: inside each gap pair items of the same kind and update them in place.
  const anchors = lcsPairs(n, m, deepEq);
  const pairs: Array<{ i: number; j: number; kind: "keep" | "update" }> = [];
  let gi = 0;
  let gj = 0;
  const fillGap = (endI: number, endJ: number) => {
    const sub = lcsPairs(endI - gi, endJ - gj, (a, b) => shallowEq(gi + a, gj + b));
    for (const [a, b] of sub) pairs.push({ i: gi + a, j: gj + b, kind: "update" });
  };
  for (const [ai, aj] of anchors) {
    fillGap(ai, aj);
    pairs.push({ i: ai, j: aj, kind: "keep" });
    gi = ai + 1;
    gj = aj + 1;
  }
  fillGap(n, m);
  pairs.sort((a, b) => a.i - b.i);

  let pi = 0;
  let i = 0;
  let j = 0;
  let pos = 0;
  while (i < n || j < m) {
    const pair = pairs[pi];
    if (pair && pair.i === i && pair.j === j) {
      const item = current[i]!;
      if (pair.kind === "keep") {
        if (topLevel) c.kept += 1;
      } else if (item instanceof Y.XmlText) reconcileText(item, groups[j]!, c);
      else if (item instanceof Y.XmlElement) {
        const target = groups[j]![0]!;
        reconcileAttributes(item, target, c);
        reconcileChildren(item, target.content ?? [], c, false);
      }
      i += 1;
      j += 1;
      pos += 1;
      pi += 1;
    } else if (pair ? i < pair.i : i < n) {
      parent.delete(pos, 1);
      i += 1;
      c.changed += 1;
    } else {
      const batch: PmNode[] = [];
      while ((pair ? j < pair.j : j < m) && j < m) {
        batch.push(...groups[j]!);
        j += 1;
      }
      const types = typesFromNodes(batch);
      parent.insert(pos, types);
      pos += types.length;
      c.changed += types.length;
    }
  }
}

/**
 * Edits the fragment towards `next` with the smallest change it can express: identical top-level blocks are left
 * alone, blocks of the same type are updated in place (attributes, then children, recursively; text runs get a
 * prefix/suffix diff), and only genuinely new or removed blocks are inserted or deleted. Expressed this way, an
 * agent's rewrite merges with concurrent human typing in the same paragraph instead of replacing it (BUILD §11.5,
 * AC-11.5.1). Must be called inside the owning doc's transaction (or on a prelim fragment).
 */
export function reconcileFragment(fragment: Y.XmlFragment, next: PmNode): ReconcileResult {
  const result: ReconcileResult = { changed: 0, kept: 0 };
  reconcileChildren(fragment, next.content ?? [], result, true);
  return result;
}
