/**
 * Incremental JSON scanner for streamed structured output (docs/ARCHITECTURE.md §6, audit P1).
 *
 * `messages.stream()` delivers the JSON a structured-output call writes a few characters at a time. This scanner reads
 * those chunks once, in order (linear in the total length, no re-parsing), and reports every element of ONE array as
 * soon as its closing character arrives, e.g. `concepts[3]` while `concepts[4]` is still being written. It also keeps
 * enough state to return a best-effort snapshot of the whole document (completed members only) at any moment.
 *
 * Why not the SDK's vendored partial-JSON parser: it lives under `@anthropic-ai/sdk/_vendor/` (private by convention),
 * re-parses the whole text on every call (quadratic over a 20k-token reply) and cannot say which elements are complete.
 *
 * Tolerance: anything before the first `{` or `[` (a code fence, a stray word) is skipped, and so is anything after the
 * root value closes. The scanner does not validate JSON grammar; a malformed element is reported anyway and fails
 * `JSON.parse` in the caller, which treats it as a failed element.
 */

export interface ScannedElement {
  /** Position in the target array (0-based). */
  index: number;
  /** The element's exact JSON text. */
  raw: string;
  /** Offsets of `raw` within everything fed so far. */
  start: number;
  end: number;
}

export interface JsonElementScannerOptions {
  /**
   * Dotted key path of the array whose elements are reported: `"concepts"`, `"sections"`, `"roadmap.items"`. The empty
   * string means the root value itself is the array. Keys only: a path cannot pass through an array.
   */
  path: string;
  /** Called synchronously from `feed()` for each completed element, in order. */
  onElement?: (element: ScannedElement) => void;
}

type Expect = "key" | "colon" | "value" | "comma";

interface Frame {
  kind: "object" | "array";
  /** Offset of the opening bracket. */
  openAt: number;
  /** Key path from the root (keys joined by "."; arrays contribute "[]"). */
  keyPath: string;
  /** Object: what comes next. Arrays only use "value"/"comma". */
  expect: Expect;
  /** Object: the key whose value is being read. */
  key: string | null;
  /** Array: number of elements started. */
  count: number;
  /** Offset just after the last completed member (or after the opening bracket): a cut that keeps the text valid. */
  safeEnd: number;
  isTarget: boolean;
}

const WHITESPACE = new Set([" ", "\t", "\n", "\r"]);
const join = (a: string, b: string) => (a ? `${a}.${b}` : b);

/** Splits a dotted element path into keys (`""` → `[]`). */
export function elementPathKeys(path: string): string[] {
  return path.split(".").map((k) => k.trim()).filter(Boolean);
}

export class JsonElementScanner {
  private buf = "";
  private pos = 0;
  private readonly target: string;
  private readonly stack: Frame[] = [];
  private inString = false;
  private escape = false;
  private stringStart = 0;
  private stringIsKey = false;
  /** Start offset of a number/literal being read, or -1. */
  private primStart = -1;
  /** Start offset of the target element being read, or -1. */
  private elementStart = -1;
  private elementIndex = -1;
  private rootStart = -1;
  private rootEnd = -1;
  private elementsDone = 0;
  private readonly onElement?: (element: ScannedElement) => void;

  constructor(opts: JsonElementScannerOptions) {
    this.target = elementPathKeys(opts.path).join(".");
    this.onElement = opts.onElement;
  }

  /** Everything fed so far. */
  get text(): string {
    return this.buf;
  }

  /** True once the root value has closed. */
  get done(): boolean {
    return this.rootEnd >= 0;
  }

  /** Elements reported so far. */
  get completed(): number {
    return this.elementsDone;
  }

  /** Index of the target element currently being written, or null (before the array, between elements, after it). */
  get writingIndex(): number | null {
    return this.elementStart >= 0 ? this.elementIndex : null;
  }

  /** True while the scanner is inside the target array. */
  get inTarget(): boolean {
    return this.stack.some((f) => f.isTarget);
  }

  /** Feed the next chunk. Reports completed elements through `onElement` before returning. */
  feed(chunk: string): ScannedElement[] {
    const found: ScannedElement[] = [];
    if (!chunk) return found;
    this.buf += chunk;
    const buf = this.buf;
    for (let i = this.pos; i < buf.length; i++) {
      if (this.rootEnd >= 0) break;
      const c = buf[i] as string;
      if (this.inString) {
        if (this.escape) this.escape = false;
        else if (c === "\\") this.escape = true;
        else if (c === '"') {
          this.inString = false;
          this.endString(i, found);
        }
        continue;
      }
      if (this.primStart >= 0) {
        if (isPrimChar(c)) continue;
        const start = this.primStart;
        this.primStart = -1;
        this.endValue(start, i, found);
      }
      if (WHITESPACE.has(c)) continue;
      const top = this.stack[this.stack.length - 1];
      if (!top && this.rootStart < 0 && c !== "{" && c !== "[") continue; // preamble before the root value
      switch (c) {
        case "{":
        case "[": {
          this.beginValue(i);
          const parent = this.stack[this.stack.length - 1];
          const keyPath = parent ? join(parent.keyPath, parent.kind === "object" ? (parent.key ?? "") : "[]") : "";
          if (!parent) this.rootStart = i;
          const kind = c === "{" ? "object" : "array";
          this.stack.push({ kind, openAt: i, keyPath, expect: kind === "object" ? "key" : "value", key: null, count: 0, safeEnd: i + 1, isTarget: kind === "array" && keyPath === this.target });
          break;
        }
        case "}":
        case "]": {
          const frame = this.stack.pop();
          if (!frame) break;
          if (this.stack.length === 0) {
            this.rootEnd = i + 1;
            break;
          }
          this.endValue(frame.openAt, i + 1, found);
          break;
        }
        case '"': {
          this.stringIsKey = top?.kind === "object" && top.expect === "key";
          if (!this.stringIsKey) this.beginValue(i);
          this.inString = true;
          this.escape = false;
          this.stringStart = i;
          break;
        }
        case ":":
          if (top?.kind === "object") top.expect = "value";
          break;
        case ",":
          if (top) top.expect = top.kind === "object" ? "key" : "value";
          break;
        default:
          this.beginValue(i);
          this.primStart = i;
      }
    }
    this.pos = buf.length;
    return found;
  }

  /**
   * Best-effort value of the whole document so far: completed members only (a string, number or element still being
   * written is left out). `undefined` before the root value starts or if the cut does not parse.
   */
  snapshot(): unknown {
    if (this.rootStart < 0) return undefined;
    let text: string;
    if (this.rootEnd >= 0) text = this.buf.slice(this.rootStart, this.rootEnd);
    else {
      const inner = this.stack[this.stack.length - 1];
      if (!inner) return undefined;
      const closers = this.stack.map((f) => (f.kind === "object" ? "}" : "]")).reverse().join("");
      text = this.buf.slice(this.rootStart, inner.safeEnd) + closers;
    }
    try {
      return JSON.parse(text);
    } catch {
      return undefined;
    }
  }

  /** The root value's text once it has closed (undefined before). */
  rootText(): string | undefined {
    return this.rootEnd >= 0 ? this.buf.slice(this.rootStart, this.rootEnd) : undefined;
  }

  private beginValue(at: number): void {
    const parent = this.stack[this.stack.length - 1];
    if (!parent) return;
    if (parent.kind === "array") {
      if (parent.isTarget && this.elementStart < 0) {
        this.elementStart = at;
        this.elementIndex = parent.count;
      }
      parent.count++;
    }
  }

  private endString(closeAt: number, found: ScannedElement[]): void {
    if (this.stringIsKey) {
      const top = this.stack[this.stack.length - 1];
      if (top) {
        top.key = decodeKey(this.buf.slice(this.stringStart, closeAt + 1));
        top.expect = "colon";
      }
      return;
    }
    this.endValue(this.stringStart, closeAt + 1, found);
  }

  /** A value spanning [start, end) just completed inside the frame on top of the stack. */
  private endValue(start: number, end: number, found: ScannedElement[]): void {
    const parent = this.stack[this.stack.length - 1];
    if (!parent) return;
    parent.safeEnd = end;
    parent.expect = "comma";
    if (parent.isTarget && this.elementStart >= 0 && this.elementStart === start) {
      const element: ScannedElement = { index: this.elementIndex, raw: this.buf.slice(start, end), start, end };
      this.elementStart = -1;
      this.elementsDone++;
      found.push(element);
      this.onElement?.(element);
    }
  }
}

function isPrimChar(c: string): boolean {
  const code = c.charCodeAt(0);
  return (code >= 48 && code <= 57) || (code >= 97 && code <= 122) || (code >= 65 && code <= 90) || c === "-" || c === "+" || c === ".";
}

function decodeKey(quoted: string): string {
  try {
    return JSON.parse(quoted) as string;
  } catch {
    return quoted.slice(1, -1);
  }
}

/** Read the value at a dotted key path (`""` = the value itself). */
export function getAtPath(value: unknown, path: string): unknown {
  let cur: unknown = value;
  for (const key of elementPathKeys(path)) {
    if (cur === null || typeof cur !== "object" || Array.isArray(cur)) return undefined;
    cur = (cur as Record<string, unknown>)[key];
  }
  return cur;
}

/**
 * The array at a dotted key path, created (and every missing parent object with it) when absent so pinned elements can
 * be written back into a regenerated document. Returns undefined when something on the path is not an object.
 */
export function arrayAtPath(value: unknown, path: string, create = false): unknown[] | undefined {
  const keys = elementPathKeys(path);
  if (keys.length === 0) return Array.isArray(value) ? value : undefined;
  let cur: unknown = value;
  for (let i = 0; i < keys.length; i++) {
    if (cur === null || typeof cur !== "object" || Array.isArray(cur)) return undefined;
    const rec = cur as Record<string, unknown>;
    const key = keys[i] as string;
    const last = i === keys.length - 1;
    if (rec[key] === undefined && create) rec[key] = last ? [] : {};
    cur = rec[key];
  }
  return Array.isArray(cur) ? cur : undefined;
}
