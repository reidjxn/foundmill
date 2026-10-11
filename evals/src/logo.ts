/**
 * Logo designer eval (packages/agents `logo_designer`, route `logoDesigner`, Opus). A set of marks passes when
 *   1. the model returned exactly the requested number of marks, each distinct;
 *   2. every mark is valid SVG after the api's sanitiser (`sanitiseSvg`) and still draws a tile and a symbol;
 *   3. no mark is a forbidden shape, checked heuristically: banned words in its name, concept or ids (shield, badge,
 *      star, ball, ...), a star polygon (8–24 vertices alternating between two radii), a shield silhouette (flat top
 *      corners, pointed bottom centre, taller than wide) or a ball pattern (a circle with three or more pentagons or
 *      hexagons).
 * `runLogoEval` drives the real prompt through a model client (live in `pnpm evals`; the unit suite feeds it the mock).
 * `runLogoMarksEval` drives the path the api uses: four parallel `logo_mark` calls, one per direction.
 */
import { prompts } from "@foundmill/agents";
import { LogoDesignOutput, type ModelClient } from "@foundmill/models";
import { sanitiseSvg } from "@foundmill/shared/logo";

export interface LogoBrief {
  id: string;
  business_name: string;
  pitch: string;
  archetype: string;
  primary: string;
  secondary: string;
  count: number;
}

export const LOGO_BRIEFS: readonly LogoBrief[] = [
  { id: "ledgerly", business_name: "Ledgerly", pitch: "Bookkeeping that closes itself for freelancers in the EU.", archetype: "B2B SaaS", primary: "#1f6f5f", secondary: "#e8c56b", count: 4 },
  { id: "northwind", business_name: "Northwind Skincare", pitch: "Fragrance-free skincare for people with sensitive skin, sold direct.", archetype: "DTC physical product", primary: "#2b6cb0", secondary: "#f5b841", count: 4 },
  // A sporty brief on purpose: the marks must still avoid sports imagery.
  { id: "fivea", business_name: "Five-a-side Finder", pitch: "An app that fills empty spots in amateur football games tonight.", archetype: "Consumer app", primary: "#14532d", secondary: "#facc15", count: 4 },
];

export interface MarkCheck {
  name: string;
  valid: boolean;
  shapes: number;
  removed: string[];
  forbidden: string[];
}

export interface LogoSetCheck {
  passed: boolean;
  count: number;
  requested: number;
  distinct: boolean;
  marks: MarkCheck[];
  problems: string[];
}

const BANNED_WORDS = /\b(shields?|crests?|badges?|emblems?|heraldic|heraldry|coat of arms|escutcheons?|stars?|balls?|football|soccer|trophy|trophies|laurels?|wreaths?|pennants?|mascots?|jerseys?)\b/i;

type Pt = [number, number];

function numbers(s: string): number[] {
  return (s.match(/[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?/g) ?? []).map(Number);
}

function pairs(nums: number[]): Pt[] {
  const out: Pt[] = [];
  for (let i = 0; i + 1 < nums.length; i += 2) out.push([nums[i]!, nums[i + 1]!]);
  return out;
}

/** Endpoints of a path's segments (curve control points left out), absolute coordinates. */
export function pathVertices(d: string): Pt[] {
  const out: Pt[] = [];
  let x = 0;
  let y = 0;
  let sx = 0;
  let sy = 0;
  const re = /([MmLlHhVvCcSsQqTtAaZz])([^MmLlHhVvCcSsQqTtAaZz]*)/g;
  for (const m of d.matchAll(re)) {
    const cmd = m[1]!;
    const n = numbers(m[2] ?? "");
    const rel = cmd === cmd.toLowerCase();
    const step: Record<string, number> = { m: 2, l: 2, h: 1, v: 1, c: 6, s: 4, q: 4, t: 2, a: 7, z: 0 };
    const size = step[cmd.toLowerCase()]!;
    if (size === 0) {
      x = sx;
      y = sy;
      continue;
    }
    for (let i = 0; i + size <= n.length; i += size) {
      const seg = n.slice(i, i + size);
      const lower = cmd.toLowerCase();
      if (lower === "h") x = rel ? x + seg[0]! : seg[0]!;
      else if (lower === "v") y = rel ? y + seg[0]! : seg[0]!;
      else {
        const ex = seg[size - 2]!;
        const ey = seg[size - 1]!;
        x = rel ? x + ex : ex;
        y = rel ? y + ey : ey;
      }
      if (lower === "m" && i === 0) {
        sx = x;
        sy = y;
      }
      out.push([x, y]);
    }
  }
  return out;
}

function shapesOf(svg: string): { polygons: Pt[][]; circles: number } {
  const polygons: Pt[][] = [];
  for (const m of svg.matchAll(/<(?:polygon|polyline)\b[^>]*\bpoints="([^"]*)"/g)) polygons.push(pairs(numbers(m[1]!)));
  for (const m of svg.matchAll(/<path\b[^>]*\bd="([^"]*)"/g)) {
    // Each subpath on its own.
    for (const sub of m[1]!.split(/(?=[Mm])/)) {
      const v = pathVertices(sub);
      if (v.length >= 3) polygons.push(v);
    }
  }
  const circles = (svg.match(/<(?:circle|ellipse)\b/g) ?? []).length;
  return { polygons, circles };
}

/** 8–24 vertices whose distance to the centroid alternates between two clearly different radii. */
export function isStar(points: Pt[]): boolean {
  const pts = points.length > 3 && points[0]![0] === points.at(-1)![0] && points[0]![1] === points.at(-1)![1] ? points.slice(0, -1) : points;
  if (pts.length < 8 || pts.length > 24 || pts.length % 2 !== 0) return false;
  const cx = pts.reduce((s, p) => s + p[0], 0) / pts.length;
  const cy = pts.reduce((s, p) => s + p[1], 0) / pts.length;
  const r = pts.map((p) => Math.hypot(p[0] - cx, p[1] - cy));
  const even = r.filter((_, i) => i % 2 === 0);
  const odd = r.filter((_, i) => i % 2 === 1);
  const mean = (a: number[]) => a.reduce((s, v) => s + v, 0) / a.length;
  const spread = (a: number[]) => Math.sqrt(mean(a.map((v) => (v - mean(a)) ** 2))) / (mean(a) || 1);
  const [inner, outer] = [Math.min(mean(even), mean(odd)), Math.max(mean(even), mean(odd))];
  return outer > 0 && inner / outer < 0.75 && spread(even) < 0.15 && spread(odd) < 0.15;
}

/** A flat-topped silhouette with its two top corners, sides, and one pointed bottom vertex near the centre. */
export function isShield(points: Pt[]): boolean {
  if (points.length < 4) return false;
  const xs = points.map((p) => p[0]);
  const ys = points.map((p) => p[1]);
  const [minX, maxX, minY, maxY] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
  const w = maxX - minX;
  const h = maxY - minY;
  if (w <= 0 || h < 0.9 * w || h > 1.8 * w) return false;
  const top = points.filter((p) => p[1] <= minY + 0.15 * h);
  const topLeft = top.some((p) => p[0] <= minX + 0.2 * w);
  const topRight = top.some((p) => p[0] >= maxX - 0.2 * w);
  const bottom = points.filter((p) => p[1] >= maxY - 0.1 * h);
  const centre = (minX + maxX) / 2;
  const pointed = bottom.length > 0 && bottom.every((p) => Math.abs(p[0] - centre) <= 0.15 * w);
  return topLeft && topRight && pointed;
}

/** Every reason a mark reads as a forbidden shape (empty when it does not). */
export function forbiddenShapes(svg: string, text = ""): string[] {
  const reasons: string[] = [];
  const word = BANNED_WORDS.exec(`${text} ${(svg.match(/\bid="([^"]*)"/g) ?? []).join(" ")}`);
  if (word) reasons.push(`word: ${word[1]!.toLowerCase()}`);
  const { polygons, circles } = shapesOf(svg);
  if (polygons.some(isStar)) reasons.push("shape: star");
  if (polygons.some(isShield)) reasons.push("shape: shield");
  const pentagons = polygons.filter((p) => p.length === 5 || p.length === 6).length;
  if (circles > 0 && pentagons >= 3) reasons.push("shape: ball");
  return reasons;
}

export function checkLogoSet(output: unknown, requested: number): LogoSetCheck {
  const parsed = LogoDesignOutput.safeParse(output);
  if (!parsed.success) return { passed: false, count: 0, requested, distinct: false, marks: [], problems: [`not the schema: ${parsed.error.issues.map((i) => i.message).join("; ")}`] };
  const problems: string[] = [];
  const marks: MarkCheck[] = parsed.data.marks.map((m) => {
    const clean = sanitiseSvg(m.svg);
    const forbidden = forbiddenShapes(m.svg, `${m.name} ${m.concept}`);
    const check: MarkCheck = { name: m.name, valid: clean.ok, shapes: clean.ok ? clean.shapes : 0, removed: clean.ok ? clean.removed : [], forbidden };
    if (!clean.ok) problems.push(`${m.name}: invalid after sanitizing (${clean.reason})`);
    else if (clean.shapes < 2) problems.push(`${m.name}: draws ${clean.shapes} shape(s); a tile and a symbol need two`);
    if (forbidden.length) problems.push(`${m.name}: ${forbidden.join(", ")}`);
    return check;
  });
  const count = marks.length;
  if (count !== requested) problems.push(`asked for ${requested} marks, got ${count}`);
  const cleaned = parsed.data.marks.map((m) => {
    const c = sanitiseSvg(m.svg);
    return c.ok ? c.svg : m.svg;
  });
  const distinct = new Set(cleaned).size === cleaned.length;
  if (!distinct) problems.push("two marks are the same");
  return { passed: problems.length === 0, count, requested, distinct, marks, problems };
}

export interface LogoEvalResult {
  briefId: string;
  check: LogoSetCheck;
  costMinor: number;
  error?: string;
}

/**
 * Runs one brief the way the api does (audit P6): one `logo_mark` call per direction, all at once, then checks the four
 * marks as one set (count, distinct, valid, no forbidden shape). Never throws; a failed call counts as a missing mark.
 */
export async function runLogoMarksEval(brief: LogoBrief, client: ModelClient): Promise<LogoEvalResult> {
  const directions = prompts.logoDirectionsFor(brief.count);
  const base = { business_name: brief.business_name, pitch: brief.pitch, archetype: brief.archetype, brand_colours: { primary: brief.primary, secondary: brief.secondary }, round: 0 };
  const settled = await Promise.allSettled(
    directions.map((direction) => client.complete({ ...prompts.buildLogoMarkRequest(base, direction), schema: LogoDesignOutput, scope: `eval:logo:${brief.id}:${direction.key}` })),
  );
  const marks = settled.flatMap((s) => (s.status === "fulfilled" ? s.value.json.marks.slice(0, 1) : []));
  const errors = settled.flatMap((s, i) => (s.status === "rejected" ? [`${directions[i]!.label}: ${s.reason instanceof Error ? s.reason.message : String(s.reason)}`] : []));
  const costMinor = settled.reduce((n, s) => n + (s.status === "fulfilled" ? s.value.cost.costMinorInt : 0), 0);
  return { briefId: brief.id, check: checkLogoSet({ marks }, brief.count), costMinor, ...(errors.length ? { error: errors.join("; ") } : {}) };
}

/** Runs one brief through the real prompt and checks the set. Never throws. */
export async function runLogoEval(brief: LogoBrief, client: ModelClient): Promise<LogoEvalResult> {
  try {
    const system = prompts.logoDesignerPrompt.render({ count: brief.count });
    const result = await client.complete({
      route: "logoDesigner",
      system,
      messages: [{ role: "user", content: "```json\n" + JSON.stringify({ business_name: brief.business_name, pitch: brief.pitch, archetype: brief.archetype, brand_colours: { primary: brief.primary, secondary: brief.secondary }, count: brief.count, round: 0 }) + "\n```" }],
      schema: LogoDesignOutput,
      maxTokens: 8_000,
      scope: `eval:logo:${brief.id}`,
    });
    return { briefId: brief.id, check: checkLogoSet(result.json, brief.count), costMinor: result.cost.costMinorInt };
  } catch (err) {
    return { briefId: brief.id, check: { passed: false, count: 0, requested: brief.count, distinct: false, marks: [], problems: ["call failed"] }, costMinor: 0, error: err instanceof Error ? err.message : String(err) };
  }
}
