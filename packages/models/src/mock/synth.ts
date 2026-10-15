/**
 * Schema-driven fallback for the mock client.
 *
 * When a caller passes a schema the handcrafted generator does not know about (or produces something that fails the
 * caller's stricter schema), the mock still has to return valid JSON. This walks the JSON Schema that zod v4 derives
 * from the caller's Zod schema (`z.toJSONSchema`) and synthesises a plausible value for every property, seeded by the
 * input hash so it is deterministic. It respects enums, consts, min/max for numbers, minLength/maxLength, minItems/
 * maxItems, nullable unions, `$ref`s into `$defs`, and common string formats (uuid, date-time, date, email, uri).
 */
import { z } from "zod";
import { type Rng, uuidFromSeed } from "../hash";

export type JsonSchema = Record<string, unknown>;

export interface SynthOptions {
  /** Seed words used to make strings look like they belong to the request (e.g. keywords from the prompt). */
  hints?: readonly string[];
  /** Fixed timestamp for date-time fields (keeps output deterministic). */
  now?: string;
  maxDepth?: number;
}

const FIXED_NOW = "2026-10-05T09:00:00.000Z";

export function synthesizeFromZod(schema: z.ZodType, rng: Rng, opts: SynthOptions = {}): unknown {
  let json: JsonSchema;
  try {
    json = z.toJSONSchema(schema, { unrepresentable: "any" }) as JsonSchema;
  } catch (error) {
    throw new Error(`Mock synthesizer: schema cannot be converted to JSON Schema (${(error as Error).message})`, { cause: error });
  }
  return synthesizeFromJsonSchema(json, rng, opts);
}

export function synthesizeFromJsonSchema(schema: JsonSchema, rng: Rng, opts: SynthOptions = {}): unknown {
  const root = schema;
  const defs = { ...((schema.$defs as Record<string, JsonSchema> | undefined) ?? {}), ...((schema.definitions as Record<string, JsonSchema> | undefined) ?? {}) };
  const maxDepth = opts.maxDepth ?? 8;
  const hints = opts.hints && opts.hints.length > 0 ? opts.hints : ["mock"];
  const now = opts.now ?? FIXED_NOW;

  const resolveRef = (ref: string): JsonSchema | undefined => {
    if (ref === "#" || ref === "#/") return root;
    const m = /^#\/(\$defs|definitions)\/(.+)$/.exec(ref);
    if (m) return defs[decodeURIComponent(m[2] as string)];
    return undefined;
  };

  const visit = (node: JsonSchema | boolean | undefined, path: string, depth: number): unknown => {
    if (node === undefined || node === true) return hintString(path, hints, rng, 1, 40);
    if (node === false) return null;
    if (typeof node.$ref === "string") {
      const target = resolveRef(node.$ref);
      if (!target || depth > maxDepth) return null;
      return visit(target, path, depth + 1);
    }
    if ("const" in node) return node.const;
    if (Array.isArray(node.enum) && node.enum.length > 0) return rng.pick(node.enum as unknown[]);
    if (Array.isArray(node.anyOf) && node.anyOf.length > 0) return visit(pickBranch(node.anyOf as JsonSchema[], rng), path, depth + 1);
    if (Array.isArray(node.oneOf) && node.oneOf.length > 0) return visit(pickBranch(node.oneOf as JsonSchema[], rng), path, depth + 1);
    if (Array.isArray(node.allOf) && node.allOf.length > 0) {
      const merged = (node.allOf as JsonSchema[]).reduce<JsonSchema>((acc, part) => mergeSchemas(acc, typeof part.$ref === "string" ? (resolveRef(part.$ref) ?? {}) : part), { ...node, allOf: undefined });
      delete merged.allOf;
      return visit(merged, path, depth + 1);
    }

    const type = pickType(node.type);
    switch (type) {
      case "null":
        return null;
      case "boolean":
        return rng.chance(0.6);
      case "integer":
        return synthNumber(node, rng, true);
      case "number":
        return synthNumber(node, rng, false);
      case "string":
        return synthString(node, path, hints, rng, now);
      case "array": {
        const minItems = toInt(node.minItems) ?? 0;
        const maxItems = toInt(node.maxItems);
        const target = Math.max(minItems, Math.min(maxItems ?? Number.POSITIVE_INFINITY, minItems === 0 ? 2 : minItems + 1));
        const count = depth > maxDepth ? minItems : target;
        const items = (Array.isArray(node.items) ? (node.items[0] as JsonSchema | undefined) : (node.items as JsonSchema | boolean | undefined)) ?? (node.prefixItems as JsonSchema[] | undefined);
        const out: unknown[] = [];
        for (let i = 0; i < count; i++) out.push(visit(Array.isArray(items) ? items[i] : items, `${path}[${i}]`, depth + 1));
        return out;
      }
      case "object": {
        const out: Record<string, unknown> = {};
        const props = (node.properties as Record<string, JsonSchema> | undefined) ?? {};
        const required = new Set(Array.isArray(node.required) ? (node.required as string[]) : []);
        for (const [key, sub] of Object.entries(props)) {
          const include = required.has(key) || depth <= 1 || rng.chance(0.7);
          if (!include) continue;
          out[key] = visit(sub, key, depth + 1);
        }
        const additional = node.additionalProperties;
        if (Object.keys(props).length === 0 && additional && typeof additional === "object") {
          const n = Math.max(toInt(node.minProperties) ?? 0, 2);
          for (let i = 0; i < n; i++) out[`${hints[i % hints.length] as string}_${i + 1}`] = visit(additional as JsonSchema, `${path}.value`, depth + 1);
        }
        return out;
      }
      default:
        return hintString(path, hints, rng, 1, 40);
    }
  };

  return visit(schema, "root", 0);
}

function pickBranch(branches: JsonSchema[], rng: Rng): JsonSchema {
  const nonNull = branches.filter((b) => b.type !== "null");
  return nonNull.length > 0 ? (rng.chance(0.85) ? (nonNull[0] as JsonSchema) : rng.pick(nonNull)) : (branches[0] as JsonSchema);
}

function mergeSchemas(a: JsonSchema, b: JsonSchema): JsonSchema {
  const out: JsonSchema = { ...a, ...b };
  if (a.properties || b.properties) out.properties = { ...((a.properties as object) ?? {}), ...((b.properties as object) ?? {}) };
  if (Array.isArray(a.required) || Array.isArray(b.required)) out.required = Array.from(new Set([...((a.required as string[]) ?? []), ...((b.required as string[]) ?? [])]));
  return out;
}

function pickType(type: unknown): string {
  if (typeof type === "string") return type;
  if (Array.isArray(type)) {
    const nonNull = (type as string[]).filter((t) => t !== "null");
    return (nonNull[0] ?? "null") as string;
  }
  return "object";
}

const toInt = (v: unknown): number | undefined => (typeof v === "number" && Number.isFinite(v) ? Math.trunc(v) : undefined);
const toNum = (v: unknown): number | undefined => (typeof v === "number" && Number.isFinite(v) ? v : undefined);

function synthNumber(node: JsonSchema, rng: Rng, integer: boolean): number {
  const exMin = toNum(node.exclusiveMinimum);
  const exMax = toNum(node.exclusiveMaximum);
  // Zod 4 puts the safe-integer range (±2^53 − 1) on every `.int()`; that is "no bound declared", not a range to draw from.
  const declared = (v: number | undefined) => (v !== undefined && Math.abs(v) >= Number.MAX_SAFE_INTEGER ? undefined : v);
  const declaredMin = declared(toNum(node.minimum) ?? (exMin !== undefined ? exMin + (integer ? 1 : 0.01) : undefined));
  const declaredMax = declared(toNum(node.maximum) ?? (exMax !== undefined ? exMax - (integer ? 1 : 0.01) : undefined));
  let lo: number;
  let hi: number;
  if (declaredMin === undefined && declaredMax === undefined) {
    lo = integer ? 1 : 0;
    hi = integer ? 20 : 1;
  } else if (declaredMin === undefined) {
    hi = declaredMax as number;
    lo = Math.min(0, hi);
  } else if (declaredMax === undefined) {
    lo = declaredMin;
    hi = lo + (integer ? 20 : 1);
  } else {
    lo = declaredMin;
    hi = Math.max(declaredMin, declaredMax);
  }
  const multipleOf = toNum(node.multipleOf);
  if (integer) {
    let v = rng.int(Math.ceil(lo), Math.floor(hi));
    if (multipleOf) v = Math.round(v / multipleOf) * multipleOf;
    return Math.min(Math.floor(hi), Math.max(Math.ceil(lo), v));
  }
  let v = lo + rng.next() * (hi - lo);
  if (multipleOf) v = Math.round(v / multipleOf) * multipleOf;
  return Math.round(Math.min(hi, Math.max(lo, v)) * 100) / 100;
}

function synthString(node: JsonSchema, path: string, hints: readonly string[], rng: Rng, now: string): string {
  const format = typeof node.format === "string" ? node.format : undefined;
  const lower = path.toLowerCase();
  if (format === "uuid" || /(^|_)(id|uuid)$/.test(lower) || /_id$/.test(lower)) return uuidFromSeed(`${path}:${rng.int(0, 1_000_000)}`);
  if (format === "date-time" || /(_at|timestamp|datetime)$/.test(lower)) return now;
  if (format === "date") return now.slice(0, 10);
  if (format === "time") return now.slice(11, 19);
  if (format === "email" || lower.includes("email")) return `${(hints[0] as string).replace(/[^a-z0-9]/gi, "").toLowerCase() || "mock"}@example.invalid`;
  if (format === "uri" || format === "url" || lower.includes("url") || lower.includes("link")) return `https://mock.invalid/${(hints[0] as string).replace(/[^a-z0-9]/gi, "-").toLowerCase()}`;
  if (format === "ipv4") return "192.0.2.1";
  if (format === "hostname") return "mock.invalid";
  if (format === "duration") return "PT1H";
  const min = toInt(node.minLength) ?? 1;
  const max = toInt(node.maxLength) ?? Math.max(min, 80);
  return hintString(path, hints, rng, min, max);
}

/** A readable string of length within [min, max] built from hints and the property name. */
export function hintString(path: string, hints: readonly string[], rng: Rng, min: number, max: number): string {
  const label = path.replace(/\[\d+\]/g, "").split(".").pop() ?? "value";
  const nice = label.replace(/[_-]+/g, " ").replace(/([a-z])([A-Z])/g, "$1 $2").toLowerCase();
  const pool = [...hints];
  let text = `Mock ${nice} about ${rng.pick(pool)}`;
  while (text.length < min) text += ` ${rng.pick(pool)}`;
  if (text.length > max) text = text.slice(0, max).trimEnd();
  if (text.length < min) text = text.padEnd(min, "x");
  return text || "mock";
}
