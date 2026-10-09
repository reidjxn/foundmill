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
 * - Attributes: presentation and geometry only, each value checked against a grammar (numbers, path data, transform
 *   functions, colours, enumerations). No event handlers, no `style` URLs, no class names.
 * - References: `href` only as an internal `#id` (on `use` and gradients); `fill`, `stroke`, `clip-path` and `mask`
 *   accept `url(#id)` only, and only when that id exists in the output. External, `javascript:` and `data:` references
 *   are removed.
 * - `style` attributes and `<style>` sheets are read as data: simple element, class and id rules whose declarations
 *   pass the same grammars become presentation attributes; everything else in them (at-rules, `url(…)`, complex
 *   selectors) is ignored.
 *
 * Pure (no DOM, no Node APIs) so the API, the evals and tests share it.
 */

export const SVG_NAMESPACE = "http://www.w3.org/2000/svg";

/** Raw markup accepted for sanitising (an exported logo with metadata can be large; the output must fit LOGO_MAX_BYTES). */
export const SVG_MAX_INPUT_CHARS = 2 * 1024 * 1024;
export const SVG_MAX_ELEMENTS = 4000;
export const SVG_MAX_DEPTH = 48;
export const SVG_MAX_USE = 100;
/** Intrinsic size written on the sanitised root: the longer side, in px. */
export const SVG_INTRINSIC_PX = 512;

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
      /** What was taken out, as `kind:name` (for tests and the audit record). */
      removed: string[];
      /** Hex colours used by fills, strokes and gradient stops, most used first (brand colour suggestions). */
      colours: string[];
      /** Drawable elements left in the output. */
      shapes: number;
    }
  | { ok: false; reason: string };

class SvgParseError extends Error {}

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
const ENTITY_RE = /&(#x[0-9a-fA-F]{1,6}|#[0-9]{1,7}|[A-Za-z][A-Za-z0-9]*);?/g;
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
    if (!Object.hasOwn(PREDEFINED, body)) throw new SvgParseError(`entity &${body}; is not allowed`);
    return PREDEFINED[body]!;
  });
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
      if (!open || open.name !== name) fail(`mismatched end tag </${name}>`);
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
      while (j < n && /\s/.test(src[j]!)) j++;
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
      while (j < n && /\s/.test(src[j]!)) j++;
      if (src[j] !== "=") fail(`attribute ${attrName} has no value`);
      j++;
      while (j < n && /\s/.test(src[j]!)) j++;
      const quote = src[j];
      if (quote !== '"' && quote !== "'") fail(`attribute ${attrName} is not quoted`);
      const close = indexOrFail(quote!, j + 1, "attribute value");
      const raw = src.slice(j + 1, close);
      if (raw.includes("<")) fail("'<' inside an attribute value");
      if (attrs.has(attrName)) fail(`duplicate attribute ${attrName}`);
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
  if (stack.length) fail(`unclosed <${stack[stack.length - 1]!.name}>`);
  if (!root) fail("no root element");
  return root!;
}

// ---------------------------------------------------------------------------------------------------------------------
// Value grammars
// ---------------------------------------------------------------------------------------------------------------------

type Check = (v: string) => string | null;

const NUM = "[+-]?(?:\\d+\\.?\\d*|\\.\\d+)(?:[eE][+-]?\\d+)?";
const NUM_RE = new RegExp(`^${NUM}$`);
const LENGTH_RE = new RegExp(`^${NUM}(?:px|%|em|ex|pt)?$`);
const NUM_LIST_RE = /^[\d\s,.eE+-]+$/;
const PATH_RE = /^[\d\s,.eE+\-MmZzLlHhVvCcSsQqTtAa]*$/;
const TRANSFORM_RE = /^(?:\s*(?:matrix|translate|scale|rotate|skewX|skewY)\s*\(\s*[\d\s,.eE+-]*\)\s*,?)*\s*$/;
const ID_RE = /^[A-Za-z_][A-Za-z0-9_.-]{0,63}$/;
const HEX_RE = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/;
const FUNC_COLOUR_RE = /^(?:rgb|rgba|hsl|hsla)\(\s*[\d\s,.%+-]+(?:\/\s*[\d.%]+\s*)?\)$/;
const NAMED_COLOUR_RE = /^[a-zA-Z]{3,24}$/;
const IRI_RE = /^url\(\s*#([A-Za-z_][A-Za-z0-9_.-]{0,63})\s*\)$/;
const PAINT_IRI_RE = /^url\(\s*#([A-Za-z_][A-Za-z0-9_.-]{0,63})\s*\)(?:\s+(.+))?$/;
const FONT_FAMILY_RE = /^[A-Za-z0-9 ,'"-]{1,120}$/;
const MAX_VALUE = 64 * 1024;

const len = (v: string) => (v.length <= MAX_VALUE ? v : null);
const num: Check = (v) => (NUM_RE.test(v.trim()) ? v.trim() : null);
const length: Check = (v) => (LENGTH_RE.test(v.trim()) ? v.trim() : null);
const numList: Check = (v) => (len(v) !== null && NUM_LIST_RE.test(v) ? v.trim().replace(/\s+/g, " ") : null);
const pathData: Check = (v) => (len(v) !== null && PATH_RE.test(v) && /[Mm]/.test(v) ? v.trim().replace(/\s+/g, " ") : null);
const transform: Check = (v) => (v.length <= 2048 && TRANSFORM_RE.test(v) ? v.trim().replace(/\s+/g, " ") : null);
const id: Check = (v) => (ID_RE.test(v) ? v : null);
const oneOf =
  (...allowed: string[]): Check =>
  (v) =>
    allowed.includes(v.trim()) ? v.trim() : null;
const opacity: Check = (v) => {
  const t = v.trim();
  return NUM_RE.test(t) || /^\d+(?:\.\d+)?%$/.test(t) ? t : null;
};
const fontFamily: Check = (v) => (FONT_FAMILY_RE.test(v.trim()) && !/url|expression|javascript/i.test(v) ? v.trim() : null);
const fontWeight = oneOf("normal", "bold", "bolder", "lighter", "100", "200", "300", "400", "500", "600", "700", "800", "900");
const preserveAspect: Check = (v) => (/^(?:none|x(?:Min|Mid|Max)Y(?:Min|Mid|Max))(?:\s+(?:meet|slice))?$/.test(v.trim()) ? v.trim() : null);

function colour(v: string): string | null {
  const t = v.trim();
  if (t === "none" || t === "currentColor" || t === "transparent") return t;
  if (HEX_RE.test(t)) return t.toLowerCase();
  if (FUNC_COLOUR_RE.test(t)) return t.replace(/\s+/g, " ");
  if (NAMED_COLOUR_RE.test(t) && !/^(?:url|expression|javascript|inherit)$/i.test(t)) return t;
  return null;
}
const paint: Check = (v) => {
  const t = v.trim();
  const ref = PAINT_IRI_RE.exec(t);
  if (ref) {
    const fallback = ref[2] ? colour(ref[2]) : "";
    if (fallback === null) return null;
    return `url(#${ref[1]})${fallback ? ` ${fallback}` : ""}`;
  }
  return colour(t);
};
const iri: Check = (v) => {
  const t = v.trim();
  if (t === "none") return t;
  const ref = IRI_RE.exec(t);
  return ref ? `url(#${ref[1]})` : null;
};
const href: Check = (v) => {
  const t = v.trim();
  return /^#[A-Za-z_][A-Za-z0-9_.-]{0,63}$/.test(t) ? t : null;
};

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
  "paint-order": (v) => (/^(?:normal|(?:fill|stroke|markers)(?:\s+(?:fill|stroke|markers)){0,2})$/.test(v.trim()) ? v.trim() : null),
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

function parseDeclarations(text: string, removed: Set<string>): Declarations {
  const out: Declarations = new Map();
  for (const part of text.split(";")) {
    const colon = part.indexOf(":");
    if (colon < 0) continue;
    const prop = part.slice(0, colon).trim().toLowerCase();
    const value = part
      .slice(colon + 1)
      .replace(/!important\s*$/i, "")
      .trim();
    if (!prop || !value) continue;
    if (!STYLE_PROPERTIES.has(prop) || /\\|url\((?!\s*#)|expression|javascript:|@/i.test(value)) {
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

function parseSheet(css: string, removed: Set<string>): SheetRule[] {
  const text = css.replace(/\/\*[\s\S]*?\*\//g, "");
  if (text.includes("@") || /\\/.test(text)) {
    removed.add("style:sheet-with-at-rules");
    return [];
  }
  const rules: SheetRule[] = [];
  let order = 0;
  for (const chunk of text.split("}")) {
    const brace = chunk.indexOf("{");
    if (brace < 0) continue;
    const selectors = chunk.slice(0, brace).split(",").map((s) => s.trim());
    const decls = parseDeclarations(chunk.slice(brace + 1), removed);
    if (!decls.size) continue;
    for (const sel of selectors) {
      let rule: SheetRule | null = null;
      if (/^\.[A-Za-z_][\w-]*$/.test(sel)) rule = { kind: "class", key: sel.slice(1), specificity: 10, order: order++, decls };
      else if (/^#[A-Za-z_][\w.-]*$/.test(sel)) rule = { kind: "id", key: sel.slice(1), specificity: 100, order: order++, decls };
      else if (/^[A-Za-z][\w]*$/.test(sel)) rule = { kind: "element", key: sel, specificity: 1, order: order++, decls };
      if (rule) rules.push(rule);
      else if (sel) removed.add("style:selector");
    }
  }
  return rules.sort((a, b) => a.specificity - b.specificity || a.order - b.order);
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
  removed: Set<string>;
  sheet: SheetRule[];
  ids: Set<string>;
  uses: number;
}

function applyStyles(el: XElement, w: Walk): Map<string, string> {
  const values = new Map<string, string>();
  for (const [name, value] of el.attrs) values.set(name, value);
  const classes = (el.attrs.get("class") ?? "").split(/\s+/).filter(Boolean);
  const elId = el.attrs.get("id");
  for (const rule of w.sheet) {
    const hit = rule.kind === "element" ? rule.key === el.name : rule.kind === "class" ? classes.includes(rule.key) : rule.key === elId;
    if (hit) for (const [k, v] of rule.decls) values.set(k, v);
  }
  const inline = el.attrs.get("style");
  if (inline) for (const [k, v] of parseDeclarations(inline, w.removed)) values.set(k, v);
  values.delete("style");
  values.delete("class");
  return values;
}

function sanitiseElement(el: XElement, w: Walk, depth: number): OutElement | null {
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

  const children: (OutElement | string)[] = [];
  for (const c of el.children) {
    if ("text" in c) {
      if (TEXT_ELEMENTS.has(el.name)) {
        const t = c.text.replace(/\s+/g, " ");
        if (t.trim()) children.push(t.slice(0, 200));
      }
      continue;
    }
    if (c.name === "style") continue; // already read into the sheet
    if (TEXT_ELEMENTS.has(el.name) && c.name !== "tspan") {
      w.removed.add(`element:${c.name}`);
      continue;
    }
    const out = sanitiseElement(c, w, depth + 1);
    if (out) children.push(out);
  }
  return { name: el.name, attrs, children };
}

/** Removes references to ids that do not exist in the output; returns the drawable count. */
function resolveReferences(el: OutElement, ids: Set<string>, removed: Set<string>): boolean {
  el.attrs = el.attrs.filter(([name, value]) => {
    const ref = /url\(#([^)]+)\)/.exec(value) ?? (name === "href" ? /^#(.+)$/.exec(value) : null);
    if (ref && !ids.has(ref[1]!)) {
      removed.add(`reference:${name}`);
      return false;
    }
    return true;
  });
  if (el.name === "use" && !el.attrs.some(([n]) => n === "href")) return false;
  el.children = el.children.filter((c) => typeof c === "string" || resolveReferences(c, ids, removed));
  return true;
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

function collectColours(el: OutElement, counts: Map<string, number>): void {
  for (const [name, value] of el.attrs) {
    if (name !== "fill" && name !== "stroke" && name !== "stop-color") continue;
    const hex = /#[0-9a-f]{3,8}\b/.exec(value)?.[0];
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

function parseLength(v: string | undefined): number | null {
  if (!v) return null;
  const m = /^([+]?(?:\d+\.?\d*|\.\d+))(?:px)?$/.exec(v.trim());
  if (!m) return null;
  const n = Number(m[1]);
  return Number.isFinite(n) && n > 0 ? n : null;
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
    root = parseXml(input.replace(/^\uFEFF/, ""));
  } catch (err) {
    return { ok: false, reason: `Not a valid SVG: ${(err as Error).message}.` };
  }
  if (root.name !== "svg") return { ok: false, reason: "Not an SVG: the root element must be <svg>." };
  const ns = root.attrs.get("xmlns");
  if (ns !== undefined && ns !== SVG_NAMESPACE) return { ok: false, reason: "Not an SVG: the root element is in another namespace." };

  const removed = new Set<string>();
  const sheets: string[] = [];
  collectSheets(root, sheets);
  if (sheets.length) removed.add("element:style");
  const w: Walk = { removed, sheet: sheets.flatMap((s) => parseSheet(s, removed)), ids: new Set(), uses: 0 };
  const out = sanitiseElement(root, w, 0);
  if (!out) return { ok: false, reason: "Not an SVG." };
  resolveReferences(out, w.ids, removed);

  // The root's coordinate system: its viewBox, or its pixel size.
  const rootAttrs = new Map(out.attrs);
  const vbParts = (rootAttrs.get("viewBox") ?? "").split(/[\s,]+/).filter(Boolean).map(Number);
  let viewBox: [number, number, number, number] | null = vbParts.length === 4 && vbParts.every(Number.isFinite) && vbParts[2]! > 0 && vbParts[3]! > 0 ? [vbParts[0]!, vbParts[1]!, vbParts[2]!, vbParts[3]!] : null;
  if (!viewBox) {
    const width = parseLength(rootAttrs.get("width"));
    const height = parseLength(rootAttrs.get("height"));
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
  return { ok: true, svg, width, height, viewBox, removed: [...removed].sort(), colours, shapes };
}
