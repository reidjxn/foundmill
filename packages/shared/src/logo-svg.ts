/**
 * Strict SVG sanitiser for business logos (uploads and generated marks). Subpath: `@foundmill/shared/logo`.
 *
 * A logo is stored and shown only as an image (`<img src="data:image/svg+xml;base64,…">`), never as a live document,
 * and only after this pass on the server. The pass parses the markup with a small, strict XML reader (no DTDs, no
 * entities beyond the five predefined ones and numeric references, quoted attributes only) and re-serialises a new
 * document from an allowlist, so nothing the input says survives unless it is on the list:
 *
 * - Elements: svg, g, defs, path, rect, circle, ellipse, line, polyline, polygon, linearGradient, radialGradient, stop,
 *   clipPath, mask, text, tspan, use. Anything else (script, style once read, foreignObject, image, a, animate, set,
 *   filter, pattern, symbol, iframe, unknown or prefixed names) is dropped with its children.
 * - Attributes: presentation and geometry only, each value capped in length (256 characters; 64 KiB for `d` and
 *   `points`) and then checked against a grammar (numbers, path data, transform functions, colours, enumerations).
 *   No event handlers, no `style` URLs, no class names.
 * - References: `href` only as an internal `#id` (on `use` and gradients); `fill`, `stroke`, `clip-path` and `mask`
 *   accept `url(#id)` only, and only when that id exists in the output. External, `javascript:` and `data:` references
 *   are removed. `mask` and `clip-path` are not allowed inside a mask or clip path.
 * - Render cost: every reference draws a copy of its target, so references can multiply (a chain of `use`, masks or
 *   clip paths). The expanded size is computed (memoised by element, cycles refused) and a logo above
 *   SVG_MAX_RENDER_COST is refused, so no logo can stall the browser that draws it.
 * - `style` attributes and `<style>` sheets are read as data: simple element, class and id rules whose declarations
 *   pass the same grammars become presentation attributes; everything else in them (at-rules, `url(…)`, complex
 *   selectors) is ignored.
 *
 * Every regular expression here runs in linear time on its input (no nested or overlapping quantifiers; the timing
 * tests feed each grammar two million adversarial characters). Pure (no DOM, no Node APIs) so the API, the evals and
 * tests share it.
 */

export const SVG_NAMESPACE = "http://www.w3.org/2000/svg";

/** Raw markup accepted for sanitising (an exported logo with metadata can be large; the output must fit LOGO_MAX_BYTES). */
export const SVG_MAX_INPUT_CHARS = 2 * 1024 * 1024;
export const SVG_MAX_ELEMENTS = 4000;
export const SVG_MAX_DEPTH = 48;
export const SVG_MAX_USE = 100;
/** Style rules read from `<style>` sheets; past this the sheets are ignored (every element is matched against every rule). */
export const SVG_MAX_STYLE_RULES = 400;
/** Longest attribute or declaration value read; longer values are dropped before any grammar runs. */
export const SVG_MAX_VALUE_CHARS = 256;
/** Path data and point lists may be longer. */
export const SVG_MAX_GEOMETRY_CHARS = 64 * 1024;
/** Expanded size (elements, with every reference counted as a copy of its target) above which a logo is refused. */
export const SVG_MAX_RENDER_COST = 5000;
/** At most this many removed names are reported (each cut to 40 characters); counts per kind are always complete. */
export const SVG_MAX_REMOVED_NAMES = 20;
/** Intrinsic size written on the sanitised root: the longer side, in px. */
export const SVG_INTRINSIC_PX = 512;

const NAME_CHARS = 40;
const LONG_VALUE_ATTRS = new Set(["d", "points"]);

/** Cuts a name taken from the input before it is echoed in a message or a report. */
const clip = (s: string, n = NAME_CHARS) => (s.length > n ? `${s.slice(0, n)}…` : s);

export interface SvgSanitiseOptions {
  /** Default SVG_MAX_INPUT_CHARS. */
  maxInputChars?: number;
  /** Largest sanitised document, in characters (the caller passes its storage budget). Default 96 KiB. */
  maxOutputChars?: number;
}

export type SvgSanitiseResult =
  | {
      ok: true;
      /** The sanitised document. */
      svg: string;
      /** Intrinsic size written on the root (the longer side is SVG_INTRINSIC_PX). */
      width: number;
      height: number;
      viewBox: [number, number, number, number];
      /** What was taken out, as `kind:name`: at most SVG_MAX_REMOVED_NAMES entries, names cut to 40 characters. */
      removed: string[];
      /** How many things of each kind (`element`, `attribute`, `value`, `style`, `href`, `reference`) were taken out. */
      removedCounts: Record<string, number>;
      /** Hex colours used by fills, strokes and gradient stops, most used first (brand colour suggestions). */
      colours: string[];
      /** Drawable elements left in the output. */
      shapes: number;
      /** Expanded size the browser draws (see SVG_MAX_RENDER_COST). */
      renderCost: number;
    }
  | { ok: false; reason: string };

class SvgParseError extends Error {}

/** Bounded report of what was removed: complete counts per kind, the first few names. */
class Removed {
  private readonly counts = new Map<string, number>();
  private readonly names = new Set<string>();

  add(entry: string): void {
    const colon = entry.indexOf(":");
    const kind = colon < 0 ? entry : entry.slice(0, colon);
    const name = colon < 0 ? "" : entry.slice(colon + 1);
    this.counts.set(kind, (this.counts.get(kind) ?? 0) + 1);
    if (this.names.size < SVG_MAX_REMOVED_NAMES) this.names.add(name ? `${kind}:${clip(name)}` : kind);
  }

  list(): string[] {
    return [...this.names].sort();
  }

  countsByKind(): Record<string, number> {
    return Object.fromEntries([...this.counts.entries()].sort(([a], [b]) => a.localeCompare(b)));
  }
}

// ---------------------------------------------------------------------------------------------------------------------
// A strict XML reader (just enough for SVG)
// ---------------------------------------------------------------------------------------------------------------------

interface XElement {
  name: string;
  attrs: Map<string, string>;
  children: XNode[];
}
type XNode = XElement | { text: string };

const NAME_RE = /^[A-Za-z_][A-Za-z0-9_.:-]*/;
// Entity names are bounded: a longer one is not one of the five predefined entities anyway.
const ENTITY_RE = /&(#x[0-9a-fA-F]{1,6}|#[0-9]{1,7}|[A-Za-z][A-Za-z0-9]{0,31});?/g;
const PREDEFINED: Record<string, string> = { lt: "<", gt: ">", amp: "&", quot: '"', apos: "'" };

function validCodePoint(cp: number): boolean {
  return cp === 0x9 || cp === 0xa || cp === 0xd || (cp >= 0x20 && cp <= 0xd7ff) || (cp >= 0xe000 && cp <= 0xfffd) || (cp >= 0x10000 && cp <= 0x10ffff);
}

/** Decodes the five predefined entities and numeric references; any other entity means a DTD, which is refused. */
function decodeEntities(raw: string): string {
  if (!raw.includes("&")) return raw;
  return raw.replace(ENTITY_RE, (m, body: string) => {
    if (!m.endsWith(";")) throw new SvgParseError("unterminated character reference");
    if (body.startsWith("#")) {
      const cp = body[1] === "x" ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10);
      if (!Number.isFinite(cp) || !validCodePoint(cp)) throw new SvgParseError("invalid character reference");
      return String.fromCodePoint(cp);
    }
    if (!Object.hasOwn(PREDEFINED, body)) throw new SvgParseError(`entity &${clip(body)}; is not allowed`);
    return PREDEFINED[body]!;
  });
}

function isSpace(c: string | undefined): boolean {
  return c === " " || c === "\t" || c === "\n" || c === "\r";
}

function parseXml(src: string): XElement {
  let i = 0;
  const n = src.length;
  const stack: XElement[] = [];
  let root: XElement | null = null;
  let elements = 0;

  const fail = (msg: string): never => {
    throw new SvgParseError(msg);
  };
  const indexOrFail = (needle: string, from: number, what: string) => {
    const at = src.indexOf(needle, from);
    if (at < 0) fail(`unterminated ${what}`);
    return at;
  };

  while (i < n) {
    const lt = src.indexOf("<", i);
    const textEnd = lt < 0 ? n : lt;
    if (textEnd > i) {
      const text = src.slice(i, textEnd);
      if (stack.length) stack[stack.length - 1]!.children.push({ text: decodeEntities(text) });
      else if (text.trim()) fail("text outside the root element");
      else decodeEntities(text);
      i = textEnd;
      continue;
    }
    // src[i] === "<"
    if (src.startsWith("<?", i)) {
      i = indexOrFail("?>", i + 2, "processing instruction") + 2;
      continue;
    }
    if (src.startsWith("<!--", i)) {
      i = indexOrFail("-->", i + 4, "comment") + 3;
      continue;
    }
    if (src.startsWith("<![CDATA[", i)) {
      const end = indexOrFail("]]>", i + 9, "CDATA section");
      if (!stack.length) fail("CDATA outside the root element");
      stack[stack.length - 1]!.children.push({ text: src.slice(i + 9, end) });
      i = end + 3;
      continue;
    }
    if (src.startsWith("<!", i)) fail("DOCTYPE and other declarations are not allowed");
    if (src.startsWith("</", i)) {
      const end = indexOrFail(">", i + 2, "end tag");
      const name = src.slice(i + 2, end).trim();
      const open = stack.pop();
      if (!open || open.name !== name) fail(`mismatched end tag </${clip(name)}>`);
      i = end + 1;
      continue;
    }
    // Start tag.
    const nameMatch = NAME_RE.exec(src.slice(i + 1, i + 1 + 256));
    if (!nameMatch) fail("malformed tag");
    const name = nameMatch![0];
    let j = i + 1 + name.length;
    const attrs = new Map<string, string>();
    let selfClosing = false;
    for (;;) {
      while (j < n && isSpace(src[j])) j++;
      if (j >= n) fail("unterminated start tag");
      if (src[j] === ">") {
        j++;
        break;
      }
      if (src[j] === "/" && src[j + 1] === ">") {
        selfClosing = true;
        j += 2;
        break;
      }
      const attrMatch = NAME_RE.exec(src.slice(j, j + 256));
      if (!attrMatch) fail("malformed attribute");
      const attrName = attrMatch![0];
      j += attrName.length;
      while (j < n && isSpace(src[j])) j++;
      if (src[j] !== "=") fail(`attribute ${clip(attrName)} has no value`);
      j++;
      while (j < n && isSpace(src[j])) j++;
      const quote = src[j];
      if (quote !== '"' && quote !== "'") fail(`attribute ${clip(attrName)} is not quoted`);
      const close = indexOrFail(quote!, j + 1, "attribute value");
      const raw = src.slice(j + 1, close);
      if (raw.includes("<")) fail("'<' inside an attribute value");
      if (attrs.has(attrName)) fail(`duplicate attribute ${clip(attrName)}`);
      attrs.set(attrName, decodeEntities(raw));
      j = close + 1;
    }
    elements += 1;
    if (elements > SVG_MAX_ELEMENTS) fail(`more than ${SVG_MAX_ELEMENTS} elements`);
    const el: XElement = { name, attrs, children: [] };
    if (stack.length) stack[stack.length - 1]!.children.push(el);
    else if (root) fail("more than one root element");
    else root = el;
    if (!selfClosing) {
      stack.push(el);
      if (stack.length > SVG_MAX_DEPTH) fail(`nested deeper than ${SVG_MAX_DEPTH}`);
    }
    i = j;
  }
  if (stack.length) fail(`unclosed <${clip(stack[stack.length - 1]!.name)}>`);
  if (!root) fail("no root element");
  return root!;
}

// ---------------------------------------------------------------------------------------------------------------------
// Value grammars (each linear in its input)
// ---------------------------------------------------------------------------------------------------------------------

type Check = (v: string) => string | null;

// `\d+(?:\.\d*)?` rather than `\d+\.?\d*`: the latter tries every split of a digit run (quadratic on "111…x").
const NUM = "[+-]?(?:\\d+(?:\\.\\d*)?|\\.\\d+)(?:[eE][+-]?\\d+)?";
const NUM_RE = new RegExp(`^${NUM}$`);
const LENGTH_RE = new RegExp(`^${NUM}(?:px|%|em|ex|pt)?$`);
const PERCENT_RE = /^\d+(?:\.\d+)?%$/;
// Character-set grammars look for one character outside the set: a single pass with nothing to backtrack.
const NUM_LIST_BAD_RE = /[^\d\s,.eE+-]/;
const PATH_BAD_RE = /[^\d\s,.eE+\-MmZzLlHhVvCcSsQqTtAa]/;
const PATH_MOVE_RE = /[Mm]/;
// One transform function at a time (sticky): the whole-list pattern with overlapping `\s*` was exponential.
const TRANSFORM_FN_RE = /\s*(?:matrix|translate|scale|rotate|skewX|skewY)\s*\([\d\s,.eE+-]*\)\s*,?/y;
const NON_BLANK_RE = /\S/;
const isBlank = (s: string) => !NON_BLANK_RE.test(s);
const ID_RE = /^[A-Za-z_][A-Za-z0-9_.-]{0,63}$/;
const HEX_RE = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/;
// No `\s*` before a class that also matches spaces (that was quadratic).
const FUNC_COLOUR_RE = /^(?:rgb|rgba|hsl|hsla)\([\d\s,.%+-]+(?:\/\s*[\d.%]+\s*)?\)$/;
const NAMED_COLOUR_RE = /^[a-zA-Z]{3,24}$/;
const IRI_RE = /^url\(\s*#([A-Za-z_][A-Za-z0-9_.-]{0,63})\s*\)$/;
// The fallback colour after a paint reference is split off by hand (`\s+(.+)` overlapped).
const PAINT_IRI_PREFIX_RE = /^url\(\s*#([A-Za-z_][A-Za-z0-9_.-]{0,63})\s*\)/;
const FONT_FAMILY_RE = /^[A-Za-z0-9 ,'"-]{1,120}$/;
const FONT_FAMILY_BANNED_RE = /url|expression|javascript/i;
const PRESERVE_ASPECT_RE = /^(?:none|x(?:Min|Mid|Max)Y(?:Min|Mid|Max))(?:\s+(?:meet|slice))?$/;
const PAINT_ORDER_RE = /^(?:normal|(?:fill|stroke|markers)(?:\s+(?:fill|stroke|markers)){0,2})$/;
const ROOT_SIZE_RE = /^\+?(?:\d+(?:\.\d*)?|\.\d+)(?:px)?$/;
const WHITESPACE_RUN_RE = /\s+/g;

const squash = (v: string) => v.trim().replace(WHITESPACE_RUN_RE, " ");
const num: Check = (v) => (NUM_RE.test(v.trim()) ? v.trim() : null);
const length: Check = (v) => (LENGTH_RE.test(v.trim()) ? v.trim() : null);
const numList: Check = (v) => (v.length > 0 && !NUM_LIST_BAD_RE.test(v) ? squash(v) : null);
const pathData: Check = (v) => (!PATH_BAD_RE.test(v) && PATH_MOVE_RE.test(v) ? squash(v) : null);
const transform: Check = (v) => {
  let at = 0;
  while (at < v.length) {
    TRANSFORM_FN_RE.lastIndex = at;
    if (!TRANSFORM_FN_RE.exec(v)) return isBlank(v.slice(at)) ? squash(v) : null;
    at = TRANSFORM_FN_RE.lastIndex;
  }
  return squash(v);
};
const id: Check = (v) => (ID_RE.test(v) ? v : null);
const oneOf =
  (...allowed: string[]): Check =>
  (v) =>
    allowed.includes(v.trim()) ? v.trim() : null;
const opacity: Check = (v) => {
  const t = v.trim();
  return NUM_RE.test(t) || PERCENT_RE.test(t) ? t : null;
};
const fontFamily: Check = (v) => (FONT_FAMILY_RE.test(v.trim()) && !FONT_FAMILY_BANNED_RE.test(v) ? v.trim() : null);
const fontWeight = oneOf("normal", "bold", "bolder", "lighter", "100", "200", "300", "400", "500", "600", "700", "800", "900");
const preserveAspect: Check = (v) => (PRESERVE_ASPECT_RE.test(v.trim()) ? v.trim() : null);
const paintOrder: Check = (v) => (PAINT_ORDER_RE.test(v.trim()) ? v.trim() : null);

function colour(v: string): string | null {
  const t = v.trim();
  if (t === "none" || t === "currentColor" || t === "transparent") return t;
  if (HEX_RE.test(t)) return t.toLowerCase();
  if (FUNC_COLOUR_RE.test(t)) return squash(t);
  if (NAMED_COLOUR_RE.test(t) && !/^(?:url|expression|javascript|inherit)$/i.test(t)) return t;
  return null;
}
const paint: Check = (v) => {
  const t = v.trim();
  const ref = PAINT_IRI_PREFIX_RE.exec(t);
  if (!ref) return colour(t);
  const rest = t.slice(ref[0].length);
  if (!rest) return `url(#${ref[1]})`;
  if (!isBlank(rest.slice(0, 1))) return null;
  const fallback = colour(rest);
  return fallback === null ? null : `url(#${ref[1]}) ${fallback}`;
};
const iri: Check = (v) => {
  const t = v.trim();
  if (t === "none") return t;
  const ref = IRI_RE.exec(t);
  return ref ? `url(#${ref[1]})` : null;
};
const href: Check = (v) => {
  const t = v.trim();
  return t.startsWith("#") && ID_RE.test(t.slice(1)) ? t : null;
};

function parseRootSize(v: string | undefined): number | null {
  if (!v) return null;
  const t = v.trim();
  if (!ROOT_SIZE_RE.test(t)) return null;
  const n = Number(t.endsWith("px") ? t.slice(0, -2) : t);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/**
 * The value grammars, exported for the timing tests (each must stay linear on adversarial input). Callers use
 * `sanitiseSvg`, which also caps every value's length before a grammar sees it.
 */
export const SVG_VALUE_GRAMMARS = {
  number: num,
  length,
  numberList: numList,
  pathData,
  transform,
  paint,
  colour,
  reference: iri,
  href,
  opacity,
  fontFamily,
  preserveAspectRatio: preserveAspect,
  paintOrder,
  id,
  rootSize: (v: string) => (parseRootSize(v) === null ? null : v),
} as const;

/** Attributes allowed on every kept element, with their grammar. */
const PRESENTATION: Record<string, Check> = {
  id,
  fill: paint,
  stroke: paint,
  color: (v) => colour(v),
  "fill-opacity": opacity,
  "stroke-opacity": opacity,
  opacity,
  "fill-rule": oneOf("nonzero", "evenodd"),
  "clip-rule": oneOf("nonzero", "evenodd"),
  "stroke-width": length,
  "stroke-linecap": oneOf("butt", "round", "square"),
  "stroke-linejoin": oneOf("miter", "round", "bevel", "arcs", "miter-clip"),
  "stroke-miterlimit": num,
  "stroke-dasharray": (v) => (v.trim() === "none" ? "none" : numList(v)),
  "stroke-dashoffset": length,
  transform,
  "clip-path": iri,
  mask: iri,
  visibility: oneOf("visible", "hidden"),
  display: oneOf("inline", "none"),
  "vector-effect": oneOf("none", "non-scaling-stroke"),
  "shape-rendering": oneOf("auto", "optimizeSpeed", "crispEdges", "geometricPrecision"),
  "paint-order": paintOrder,
};

const TEXT_ATTRS: Record<string, Check> = {
  x: numList,
  y: numList,
  dx: numList,
  dy: numList,
  "font-family": fontFamily,
  "font-size": length,
  "font-weight": fontWeight,
  "font-style": oneOf("normal", "italic", "oblique"),
  "text-anchor": oneOf("start", "middle", "end"),
  "dominant-baseline": oneOf("auto", "middle", "central", "hanging", "alphabetic", "ideographic", "mathematical", "text-top", "text-bottom", "text-after-edge", "text-before-edge"),
  "letter-spacing": length,
};

const GRADIENT_COMMON: Record<string, Check> = {
  gradientUnits: oneOf("userSpaceOnUse", "objectBoundingBox"),
  gradientTransform: transform,
  spreadMethod: oneOf("pad", "reflect", "repeat"),
  href,
};

/** Elements kept, each with the attributes it may carry beyond PRESENTATION. */
const ELEMENTS: Record<string, Record<string, Check>> = {
  svg: { x: length, y: length, width: length, height: length, viewBox: numList, preserveAspectRatio: preserveAspect },
  g: {},
  defs: {},
  path: { d: pathData },
  rect: { x: length, y: length, width: length, height: length, rx: length, ry: length },
  circle: { cx: length, cy: length, r: length },
  ellipse: { cx: length, cy: length, rx: length, ry: length },
  line: { x1: length, y1: length, x2: length, y2: length },
  polyline: { points: numList },
  polygon: { points: numList },
  linearGradient: { ...GRADIENT_COMMON, x1: length, y1: length, x2: length, y2: length },
  radialGradient: { ...GRADIENT_COMMON, cx: length, cy: length, r: length, fx: length, fy: length, fr: length },
  stop: { offset: opacity, "stop-color": (v) => colour(v), "stop-opacity": opacity },
  clipPath: { clipPathUnits: oneOf("userSpaceOnUse", "objectBoundingBox") },
  mask: { x: length, y: length, width: length, height: length, maskUnits: oneOf("userSpaceOnUse", "objectBoundingBox"), maskContentUnits: oneOf("userSpaceOnUse", "objectBoundingBox") },
  text: TEXT_ATTRS,
  tspan: TEXT_ATTRS,
  use: { href, x: length, y: length, width: length, height: length },
};

const DRAWABLE = new Set(["path", "rect", "circle", "ellipse", "line", "polyline", "polygon", "text", "use"]);
const TEXT_ELEMENTS = new Set(["text", "tspan"]);
const MASKING = new Set(["mask", "clipPath"]);

/** Properties a `style` attribute or sheet may set (the CSS name equals the attribute name). */
const STYLE_PROPERTIES = new Set([...Object.keys(PRESENTATION).filter((k) => k !== "id" && k !== "transform"), "stop-color", "stop-opacity", "font-family", "font-size", "font-weight", "font-style", "text-anchor", "dominant-baseline", "letter-spacing"]);

/** Own-property lookups only, so names such as `constructor` or `__proto__` never resolve to a prototype member. */
function own<T>(table: Record<string, T>, key: string): T | undefined {
  return Object.hasOwn(table, key) ? table[key] : undefined;
}

function checkerFor(element: string, attr: string): Check | undefined {
  const forElement = own(ELEMENTS, element);
  return (forElement ? own(forElement, attr) : undefined) ?? own(PRESENTATION, attr);
}

// ---------------------------------------------------------------------------------------------------------------------
// Style sheets and style attributes, read as data
// ---------------------------------------------------------------------------------------------------------------------

type Declarations = Map<string, string>;

const IMPORTANT_RE = /!important\s*$/i;
const DECL_BANNED_RE = /\\|url\((?!\s*#)|expression|javascript:|@/i;
const CLASS_SELECTOR_RE = /^\.[A-Za-z_][\w-]*$/;
const ID_SELECTOR_RE = /^#[A-Za-z_][\w.-]*$/;
const ELEMENT_SELECTOR_RE = /^[A-Za-z]\w*$/;

function parseDeclarations(text: string, removed: Removed): Declarations {
  const out: Declarations = new Map();
  for (const part of text.split(";")) {
    const colon = part.indexOf(":");
    if (colon < 0) continue;
    const prop = part.slice(0, colon).trim().toLowerCase();
    const rawValue = part.slice(colon + 1);
    if (!prop || !rawValue.trim()) continue;
    if (rawValue.length > SVG_MAX_VALUE_CHARS + 16) {
      removed.add(`style:${prop}`);
      continue;
    }
    const value = rawValue.replace(IMPORTANT_RE, "").trim();
    if (!STYLE_PROPERTIES.has(prop) || DECL_BANNED_RE.test(value)) {
      removed.add(`style:${prop}`);
      continue;
    }
    out.set(prop, value);
  }
  return out;
}

interface SheetRule {
  kind: "element" | "class" | "id";
  key: string;
  specificity: number;
  order: number;
  decls: Declarations;
}

/** Removes `/* … *\/` comments with indexOf (a lazy regex rescans the rest of the sheet from every unclosed `/*`). */
function stripCssComments(css: string): string {
  let out = "";
  let i = 0;
  for (;;) {
    const start = css.indexOf("/*", i);
    if (start < 0) return out + css.slice(i);
    out += css.slice(i, start);
    const end = css.indexOf("*/", start + 2);
    if (end < 0) return out;
    i = end + 2;
  }
}

/** The rules of one sheet in document order (`order` continues the caller's counter across sheets); unsorted. */
function parseSheet(css: string, removed: Removed, counter: { order: number }): SheetRule[] {
  const text = stripCssComments(css);
  if (text.includes("@") || text.includes("\\")) {
    removed.add("style:sheet-with-at-rules");
    return [];
  }
  const rules: SheetRule[] = [];
  for (const chunk of text.split("}")) {
    const brace = chunk.indexOf("{");
    if (brace < 0) continue;
    const selectors = chunk.slice(0, brace).split(",").map((s) => s.trim());
    const decls = parseDeclarations(chunk.slice(brace + 1), removed);
    if (!decls.size) continue;
    for (const sel of selectors) {
      let rule: SheetRule | null = null;
      if (sel.length > 128) rule = null;
      else if (CLASS_SELECTOR_RE.test(sel)) rule = { kind: "class", key: sel.slice(1), specificity: 10, order: counter.order++, decls };
      else if (ID_SELECTOR_RE.test(sel)) rule = { kind: "id", key: sel.slice(1), specificity: 100, order: counter.order++, decls };
      else if (ELEMENT_SELECTOR_RE.test(sel)) rule = { kind: "element", key: sel, specificity: 1, order: counter.order++, decls };
      if (rule) rules.push(rule);
      else if (sel) removed.add("style:selector");
      if (rules.length > SVG_MAX_STYLE_RULES) {
        removed.add("style:sheet-too-large");
        return [];
      }
    }
  }
  return rules;
}

function collectSheets(el: XElement, out: string[]): void {
  for (const c of el.children) {
    if ("text" in c) continue;
    if (c.name === "style") out.push(c.children.map((t) => ("text" in t ? t.text : "")).join(""));
    else collectSheets(c, out);
  }
}

// ---------------------------------------------------------------------------------------------------------------------
// Sanitising
// ---------------------------------------------------------------------------------------------------------------------

interface OutElement {
  name: string;
  attrs: [string, string][];
  children: (OutElement | string)[];
}

interface Walk {
  removed: Removed;
  sheet: SheetRule[];
  ids: Set<string>;
  uses: number;
}

function applyStyles(el: XElement, w: Walk): Map<string, string> {
  const values = new Map<string, string>();
  for (const [name, value] of el.attrs) values.set(name, value);
  if (w.sheet.length) {
    const classes = new Set((el.attrs.get("class") ?? "").slice(0, 1024).split(WHITESPACE_RUN_RE).filter(Boolean));
    const elId = el.attrs.get("id");
    for (const rule of w.sheet) {
      const hit = rule.kind === "element" ? rule.key === el.name : rule.kind === "class" ? classes.has(rule.key) : rule.key === elId;
      if (hit) for (const [k, v] of rule.decls) values.set(k, v);
    }
  }
  const inline = el.attrs.get("style");
  if (inline) for (const [k, v] of parseDeclarations(inline, w.removed)) values.set(k, v);
  values.delete("style");
  values.delete("class");
  return values;
}

function sanitiseElement(el: XElement, w: Walk, insideMask: boolean): OutElement | null {
  const allowed = own(ELEMENTS, el.name);
  if (!allowed) {
    w.removed.add(`element:${el.name}`);
    return null;
  }
  if (el.name === "use") {
    w.uses += 1;
    if (w.uses > SVG_MAX_USE) {
      w.removed.add("element:use-over-limit");
      return null;
    }
  }
  const attrs: [string, string][] = [];
  for (const [rawName, rawValue] of applyStyles(el, w)) {
    // xlink:href is read as href; every other prefixed name (xml:, sodipodi:, inkscape:, xmlns:) is dropped.
    const name = rawName === "xlink:href" ? "href" : rawName;
    if (name === "xmlns" || name.startsWith("xmlns:")) continue;
    const check = name.includes(":") ? undefined : checkerFor(el.name, name);
    if (!check) {
      w.removed.add(`attribute:${rawName}`);
      continue;
    }
    // Length first: no grammar ever sees a value longer than the cap.
    if (rawValue.length > (LONG_VALUE_ATTRS.has(name) ? SVG_MAX_GEOMETRY_CHARS : SVG_MAX_VALUE_CHARS)) {
      w.removed.add(`value:${name}`);
      continue;
    }
    // A mask or clip path inside a mask or clip path multiplies the work of drawing it.
    if (insideMask && (name === "mask" || name === "clip-path")) {
      w.removed.add(`reference:${name}-inside-mask`);
      continue;
    }
    const value = check(rawValue);
    if (value === null) {
      w.removed.add(name === "href" ? "href:not-internal" : `value:${name}`);
      continue;
    }
    if (!attrs.some(([n]) => n === name)) attrs.push([name, value]);
  }
  if (el.name === "use" && !attrs.some(([n]) => n === "href")) {
    w.removed.add("element:use-without-internal-href");
    return null;
  }
  const idAttr = attrs.find(([n]) => n === "id");
  if (idAttr) w.ids.add(idAttr[1]);

  const childInsideMask = insideMask || MASKING.has(el.name);
  const children: (OutElement | string)[] = [];
  for (const c of el.children) {
    if ("text" in c) {
      if (TEXT_ELEMENTS.has(el.name)) {
        const t = c.text.slice(0, 1024).replace(WHITESPACE_RUN_RE, " ");
        if (t.trim()) children.push(t.slice(0, 200));
      }
      continue;
    }
    if (c.name === "style") continue; // already read into the sheet
    if (TEXT_ELEMENTS.has(el.name) && c.name !== "tspan") {
      w.removed.add(`element:${c.name}`);
      continue;
    }
    const out = sanitiseElement(c, w, childInsideMask);
    if (out) children.push(out);
  }
  return { name: el.name, attrs, children };
}

/** The id an attribute points at (`url(#id)` in paint, mask and clip-path values; `#id` in href), or null. */
function referencedId(name: string, value: string): string | null {
  if (name === "href") return value.startsWith("#") ? value.slice(1) : null;
  const open = value.indexOf("url(#");
  if (open < 0) return null;
  const close = value.indexOf(")", open);
  return close < 0 ? null : value.slice(open + 5, close);
}

/** Removes references to ids that do not exist in the output. */
function resolveReferences(el: OutElement, ids: Set<string>, removed: Removed): boolean {
  el.attrs = el.attrs.filter(([name, value]) => {
    const ref = referencedId(name, value);
    if (ref !== null && !ids.has(ref)) {
      removed.add(`reference:${name}`);
      return false;
    }
    return true;
  });
  if (el.name === "use" && !el.attrs.some(([n]) => n === "href")) return false;
  el.children = el.children.filter((c) => typeof c === "string" || resolveReferences(c, ids, removed));
  return true;
}

/**
 * The size of what a browser draws: 1 per element, plus its children, plus a full copy of every element it references
 * (`use`, gradients' href, masks, clip paths, paint servers). Memoised per element, so it costs one pass; a reference
 * cycle is refused; counting stops just past the cap.
 */
function renderCost(root: OutElement): number | "cycle" {
  const byId = new Map<string, OutElement>();
  const index = (el: OutElement) => {
    const idAttr = el.attrs.find(([n]) => n === "id");
    if (idAttr && !byId.has(idAttr[1])) byId.set(idAttr[1], el);
    for (const c of el.children) if (typeof c !== "string") index(c);
  };
  index(root);
  const cap = SVG_MAX_RENDER_COST + 1;
  const memo = new Map<OutElement, number>();
  const visiting = new Set<OutElement>();
  const state = { cycle: false };
  const cost = (el: OutElement): number => {
    const known = memo.get(el);
    if (known !== undefined) return known;
    if (visiting.has(el)) {
      state.cycle = true;
      return cap;
    }
    // A reference chain deeper than this is a cost problem whatever it draws.
    if (visiting.size > 1000) return cap;
    visiting.add(el);
    let total = 1;
    for (const [name, value] of el.attrs) {
      if (total >= cap || state.cycle) break;
      const ref = referencedId(name, value);
      const target = ref === null ? undefined : byId.get(ref);
      if (target) total += cost(target);
    }
    for (const c of el.children) {
      if (total >= cap || state.cycle) break;
      if (typeof c !== "string") total += cost(c);
    }
    visiting.delete(el);
    const bounded = Math.min(total, cap);
    memo.set(el, bounded);
    return bounded;
  };
  const total = cost(root);
  return state.cycle ? "cycle" : total;
}

/** The attributes without which a shape draws nothing. */
const REQUIRED_GEOMETRY: Record<string, string[]> = { path: ["d"], polygon: ["points"], polyline: ["points"], rect: ["width", "height"], circle: ["r"], ellipse: ["rx", "ry"], use: ["href"] };

function draws(el: OutElement): boolean {
  if (!DRAWABLE.has(el.name)) return false;
  if (el.name === "text") return el.children.length > 0;
  const required = own(REQUIRED_GEOMETRY, el.name) ?? [];
  return required.every((a) => el.attrs.some(([n]) => n === a));
}

function countDrawable(el: OutElement): number {
  let n = draws(el) ? 1 : 0;
  // Shapes inside defs, clip paths and masks only draw when referenced; count them for `use` only.
  if (el.name === "defs" || el.name === "clipPath" || el.name === "mask" || el.name === "linearGradient" || el.name === "radialGradient") return 0;
  for (const c of el.children) if (typeof c !== "string") n += countDrawable(c);
  return n;
}

const HEX_IN_VALUE_RE = /#[0-9a-f]{3,8}\b/;

function collectColours(el: OutElement, counts: Map<string, number>): void {
  for (const [name, value] of el.attrs) {
    if (name !== "fill" && name !== "stroke" && name !== "stop-color") continue;
    const hex = HEX_IN_VALUE_RE.exec(value)?.[0];
    if (!hex) continue;
    const full = hex.length === 4 ? `#${hex[1]}${hex[1]}${hex[2]}${hex[2]}${hex[3]}${hex[3]}` : hex.slice(0, 7);
    counts.set(full, (counts.get(full) ?? 0) + (name === "stroke" ? 1 : 2));
  }
  for (const c of el.children) if (typeof c !== "string") collectColours(c, counts);
}

const escapeText = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const escapeAttr = (s: string) => escapeText(s).replace(/"/g, "&quot;");

function serialise(el: OutElement): string {
  const attrs = el.attrs.map(([n, v]) => ` ${n}="${escapeAttr(v)}"`).join("");
  if (!el.children.length) return `<${el.name}${attrs}/>`;
  return `<${el.name}${attrs}>${el.children.map((c) => (typeof c === "string" ? escapeText(c) : serialise(c))).join("")}</${el.name}>`;
}

const round = (n: number) => Math.round(n * 1000) / 1000;

/**
 * Sanitise untrusted SVG markup into a self-contained document that is safe to store and to show through `<img>`.
 * Fails closed: anything the reader does not understand (a DTD, an unknown entity, unbalanced tags) rejects the input.
 */
export function sanitiseSvg(input: string, options: SvgSanitiseOptions = {}): SvgSanitiseResult {
  const maxInput = options.maxInputChars ?? SVG_MAX_INPUT_CHARS;
  const maxOutput = options.maxOutputChars ?? 96 * 1024;
  if (typeof input !== "string" || !input.trim()) return { ok: false, reason: "The file is empty." };
  if (input.length > maxInput) return { ok: false, reason: `The SVG is larger than ${Math.round(maxInput / 1024)} KB.` };
  let root: XElement;
  try {
    root = parseXml(input.charCodeAt(0) === 0xfeff ? input.slice(1) : input);
  } catch (err) {
    return { ok: false, reason: `Not a valid SVG: ${(err as Error).message}.` };
  }
  if (root.name !== "svg") return { ok: false, reason: "Not an SVG: the root element must be <svg>." };
  const ns = root.attrs.get("xmlns");
  if (ns !== undefined && ns !== SVG_NAMESPACE) return { ok: false, reason: "Not an SVG: the root element is in another namespace." };

  const removed = new Removed();
  const sheets: string[] = [];
  collectSheets(root, sheets);
  if (sheets.length) removed.add("element:style");
  let sheet: SheetRule[] = [];
  const counter = { order: 0 };
  for (const s of sheets) {
    sheet = sheet.concat(parseSheet(s, removed, counter));
    if (sheet.length > SVG_MAX_STYLE_RULES) {
      removed.add("style:sheet-too-large");
      sheet = [];
      break;
    }
  }
  // Applied in this order, so a more specific rule, or a later one of the same specificity, wins.
  sheet.sort((a, b) => a.specificity - b.specificity || a.order - b.order);
  const w: Walk = { removed, sheet, ids: new Set(), uses: 0 };
  const out = sanitiseElement(root, w, false);
  if (!out) return { ok: false, reason: "Not an SVG." };
  resolveReferences(out, w.ids, removed);
  const cost = renderCost(out);
  if (cost === "cycle") return { ok: false, reason: "The SVG refers to itself in a loop, so it cannot be drawn." };
  if (cost > SVG_MAX_RENDER_COST) return { ok: false, reason: "The SVG repeats its parts too many times to draw quickly (through use, masks or clip paths). Export a simpler mark or a PNG." };

  // The root's coordinate system: its viewBox, or its pixel size.
  const rootAttrs = new Map(out.attrs);
  const vbParts = (rootAttrs.get("viewBox") ?? "").split(/[\s,]+/).filter(Boolean).map(Number);
  let viewBox: [number, number, number, number] | null = vbParts.length === 4 && vbParts.every(Number.isFinite) && vbParts[2]! > 0 && vbParts[3]! > 0 ? [vbParts[0]!, vbParts[1]!, vbParts[2]!, vbParts[3]!] : null;
  if (!viewBox) {
    const width = parseRootSize(rootAttrs.get("width"));
    const height = parseRootSize(rootAttrs.get("height"));
    if (width && height) viewBox = [0, 0, width, height];
  }
  if (!viewBox) return { ok: false, reason: "The SVG needs a viewBox (or a width and a height) so it can be scaled." };
  const ratio = viewBox[2] / viewBox[3];
  if (ratio > 4 || ratio < 0.25) return { ok: false, reason: "The logo is too wide or too tall; use a mark that fits a square." };
  const width = ratio >= 1 ? SVG_INTRINSIC_PX : Math.max(1, Math.round(SVG_INTRINSIC_PX * ratio));
  const height = ratio >= 1 ? Math.max(1, Math.round(SVG_INTRINSIC_PX / ratio)) : SVG_INTRINSIC_PX;
  const keep = out.attrs.filter(([n]) => !["viewBox", "width", "height", "x", "y"].includes(n));
  out.attrs = [["xmlns", SVG_NAMESPACE], ["viewBox", viewBox.map(round).join(" ")], ["width", String(width)], ["height", String(height)], ...keep];

  const shapes = countDrawable(out);
  if (shapes === 0) return { ok: false, reason: "Nothing drawable is left in the SVG after removing unsupported content." };
  const svg = serialise(out);
  if (svg.length > maxOutput) return { ok: false, reason: `The SVG is too complex: ${Math.round(svg.length / 1024)} KB after cleaning (the limit is ${Math.round(maxOutput / 1024)} KB). Export a simpler mark or a PNG.` };
  const counts = new Map<string, number>();
  collectColours(out, counts);
  const colours = [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([c]) => c);
  return { ok: true, svg, width, height, viewBox, removed: removed.list(), removedCounts: removed.countsByKind(), colours, shapes, renderCost: cost };
}
