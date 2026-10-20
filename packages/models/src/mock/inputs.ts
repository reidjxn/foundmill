/**
 * Mock input conventions.
 *
 * Mock generators must "read the actual input so mock mode feels real". Callers build prompts however their template
 * dictates (packages/agents), so the mock does not parse prompt prose; it looks for JSON embedded in the messages
 * (fenced ```json blocks or bare objects/arrays) and reads well-known keys from it with tolerant naming
 * (`named_queries`, `namedQueries`, `NamedQueries` all work; nested under `inputs`/`input`/`context`/`data` also works).
 * Prose-only prompts still get sensible output: every generator has defaults and falls back to the text itself.
 */
import { CHANNEL_META, type ChannelKey } from "@foundmill/shared";
import { type Rng, isUuidLike, uuidFromSeed } from "../hash";
import type { RouteKey } from "../routing";
import type { ChatMessage, CompleteRequest } from "../types";

export interface ManifestEntry {
  id: string;
  kind: string;
  name: string;
  aliases: string[];
  role?: string;
  department_id?: string;
  channel?: string;
  raw?: Record<string, unknown>;
}

export interface MockContext {
  route: RouteKey;
  system: string;
  messages: readonly ChatMessage[];
  /** All user messages joined. */
  userText: string;
  lastUser: string;
  /** System + every message, for keyword searches. */
  allText: string;
  /** Merged JSON objects discovered in the prompt (later messages override earlier ones). */
  data: Record<string, unknown>;
  manifest: ManifestEntry[];
  /** Top-level property names of the caller's object schema, when one was passed (lets readers extract exactly those). */
  schemaKeys: string[];
  hash: string;
  rng: Rng;
  get<T = unknown>(...keys: string[]): T | undefined;
  getArray<T = unknown>(...keys: string[]): T[];
  getString(...keys: string[]): string | undefined;
  getNumber(...keys: string[]): number | undefined;
  getBoolean(...keys: string[]): boolean | undefined;
  getRecord(...keys: string[]): Record<string, unknown> | undefined;
}

const CONTAINER_KEYS = ["inputs", "input", "context", "data", "payload", "variables", "vars"];

/** snake_case / camelCase / PascalCase / kebab-case / spaced variants of a key. */
export function keyVariants(key: string): string[] {
  const parts = key
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .replace(/[-\s]+/g, "_")
    .toLowerCase()
    .split("_")
    .filter(Boolean);
  if (parts.length === 0) return [key];
  const snake = parts.join("_");
  const camel = parts.map((p, i) => (i === 0 ? p : p.charAt(0).toUpperCase() + p.slice(1))).join("");
  const pascal = parts.map((p) => p.charAt(0).toUpperCase() + p.slice(1)).join("");
  const kebab = parts.join("-");
  const spaced = parts.join(" ");
  return Array.from(new Set([key, snake, camel, pascal, kebab, spaced]));
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

/** Tolerant lookup of the first matching key (any variant), searching the object then one level of container keys. */
export function lookup(obj: unknown, keys: readonly string[]): unknown {
  if (!isRecord(obj)) return undefined;
  for (const key of keys) {
    for (const variant of keyVariants(key)) {
      if (variant in obj && obj[variant] !== undefined) return obj[variant];
    }
  }
  for (const container of CONTAINER_KEYS) {
    const inner = obj[container];
    if (isRecord(inner)) {
      const found = lookup(inner, keys);
      if (found !== undefined) return found;
    }
  }
  return undefined;
}

/** Find every JSON object/array embedded in `text`: fenced ```json blocks first, then balanced bare blocks. */
export function extractJsonValues(text: string): unknown[] {
  const out: unknown[] = [];
  if (!text) return out;
  const fence = /```(?:json|JSON)?\s*([\s\S]*?)```/g;
  const consumed: Array<[number, number]> = [];
  for (const m of text.matchAll(fence)) {
    const body = (m[1] ?? "").trim();
    const parsed = tryParse(body);
    if (parsed !== undefined) {
      out.push(parsed);
      consumed.push([m.index ?? 0, (m.index ?? 0) + m[0].length]);
    }
  }
  // Bare balanced blocks outside fences.
  let i = 0;
  while (i < text.length) {
    const ch = text[i];
    if ((ch === "{" || ch === "[") && !consumed.some(([a, b]) => i >= a && i < b)) {
      const end = findBalancedEnd(text, i);
      if (end > i) {
        const parsed = tryParse(text.slice(i, end + 1));
        if (parsed !== undefined && typeof parsed === "object") {
          out.push(parsed);
          i = end + 1;
          continue;
        }
      }
    }
    i++;
  }
  return out;
}

function findBalancedEnd(text: string, start: number): number {
  const open = text[start];
  const close = open === "{" ? "}" : "]";
  let depth = 0;
  let inString = false;
  let escape = false;
  for (let i = start; i < text.length; i++) {
    const c = text[i];
    if (inString) {
      if (escape) escape = false;
      else if (c === "\\") escape = true;
      else if (c === '"') inString = false;
      continue;
    }
    if (c === '"') inString = true;
    else if (c === "{" || c === "[") depth++;
    else if (c === "}" || c === "]") {
      depth--;
      if (depth === 0) return c === close ? i : -1;
    }
  }
  return -1;
}

function tryParse(s: string): unknown {
  if (!s) return undefined;
  try {
    return JSON.parse(s);
  } catch {
    return undefined;
  }
}

/** Normalise a manifest-like array (`{id, kind, name|display_name, aliases}`) into `ManifestEntry[]`. */
export function normaliseManifest(raw: unknown): ManifestEntry[] {
  const list = Array.isArray(raw) ? raw : isRecord(raw) && Array.isArray(raw.entities) ? raw.entities : [];
  const out: ManifestEntry[] = [];
  for (const item of list) {
    if (!isRecord(item)) continue;
    const id = item.id ?? item.entity_id ?? item.entityId;
    const name = item.name ?? item.display_name ?? item.displayName ?? item.title;
    if (typeof id !== "string" || typeof name !== "string" || !name.trim()) continue;
    const aliasesRaw = item.aliases;
    const aliases = Array.isArray(aliasesRaw) ? aliasesRaw.filter((a): a is string => typeof a === "string") : [];
    out.push({
      id,
      kind: typeof item.kind === "string" ? item.kind : "organisation",
      name: name.trim(),
      aliases,
      role: typeof item.role === "string" ? item.role : undefined,
      department_id: typeof item.department_id === "string" ? item.department_id : typeof item.departmentId === "string" ? item.departmentId : undefined,
      channel: typeof item.channel === "string" ? item.channel : typeof item.channel_key === "string" ? item.channel_key : undefined,
      raw: item,
    });
  }
  return out;
}

export function buildMockContext(req: CompleteRequest, hash: string, rng: Rng, schemaKeys: string[] = []): MockContext {
  const system = Array.isArray(req.system) ? req.system.join("\n\n") : typeof req.system === "string" ? req.system : "";
  const userMessages = req.messages.filter((m) => m.role === "user");
  const userText = userMessages.map((m) => m.content).join("\n\n");
  const lastUser = userMessages.length > 0 ? (userMessages[userMessages.length - 1] as ChatMessage).content : "";
  const allText = [system, ...req.messages.map((m) => m.content)].filter(Boolean).join("\n\n");

  const data: Record<string, unknown> = {};
  for (const source of [system, ...req.messages.map((m) => m.content)]) {
    for (const value of extractJsonValues(source)) {
      if (isRecord(value)) Object.assign(data, value);
      else if (Array.isArray(value) && !("_items" in data)) data._items = value;
    }
  }

  const manifest = normaliseManifest(lookup(data, ["manifest", "entity_manifest", "entities"]));

  const get = <T,>(...keys: string[]): T | undefined => lookup(data, keys) as T | undefined;
  const ctx: MockContext = {
    route: req.route,
    system,
    messages: req.messages,
    userText,
    lastUser,
    allText,
    data,
    manifest,
    schemaKeys,
    hash,
    rng,
    get,
    getArray<T>(...keys: string[]): T[] {
      const v = get<unknown>(...keys);
      return Array.isArray(v) ? (v as T[]) : [];
    },
    getString(...keys) {
      const v = get<unknown>(...keys);
      return typeof v === "string" ? v : typeof v === "number" ? String(v) : undefined;
    },
    getNumber(...keys) {
      const v = get<unknown>(...keys);
      if (typeof v === "number" && Number.isFinite(v)) return v;
      if (typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v))) return Number(v);
      return undefined;
    },
    getBoolean(...keys) {
      const v = get<unknown>(...keys);
      return typeof v === "boolean" ? v : undefined;
    },
    getRecord(...keys) {
      const v = get<unknown>(...keys);
      return isRecord(v) ? v : undefined;
    },
  };
  return ctx;
}

// ---------------------------------------------------------------------------------------------------------------------
// Text helpers
// ---------------------------------------------------------------------------------------------------------------------

export const STOPWORDS = new Set(
  (
    "a an the and or but if then else of for to in on at by with from as is are was were be been being it its this that these those " +
    "i you he she we they me him her us them my your our their what which who whom when where why how all any both each few more most " +
    "other some such no nor not only own same so than too very can will just should would could do does did doing have has had having " +
    "about into over after before between under again further once here there up down out off above below during without within along " +
    "want wants wanted need needs like make build create start new business company idea ideas product products app apps please help " +
    "something anything everything thing things way ways get got going go also lot lots really very much many kind sort " +
    // An empty brief reaches the agent as "Surprise me within my constraints" (the studio's control reads "Draft 6–12
    // ideas for me" then): an instruction, not a theme, so never a concept's name or angle.
    "surprise surprises surprising constraint constraints"
  ).split(/\s+/),
);

export const words = (text: string): string[] => text.split(/\s+/).map((w) => w.trim()).filter(Boolean);
export const wordCount = (text: string): number => words(text).length;

/** Digit tokens in `text` (1,200.50 → "1,200.50", also records the bare "1200.50"/"1200" forms). */
export function numbersIn(text: string): Set<string> {
  const out = new Set<string>();
  for (const m of text.matchAll(/\d+(?:,\d{3})*(?:\.\d+)?/g)) {
    const raw = m[0];
    out.add(raw);
    out.add(raw.replace(/,/g, ""));
    out.add(raw.replace(/,/g, "").replace(/\.0+$/, ""));
  }
  return out;
}

/** Frequency-ordered keywords (lowercased, stopwords and short tokens removed). */
export function keywords(text: string, max = 8): string[] {
  const counts = new Map<string, number>();
  const order: string[] = [];
  for (const raw of text.toLowerCase().split(/[^a-z0-9][^a-z0-9]*|\s+/)) {
    const w = raw.replace(/[^a-z0-9-]/g, "");
    if (w.length < 4 || STOPWORDS.has(w) || /^\d+$/.test(w)) continue;
    if (!counts.has(w)) order.push(w);
    counts.set(w, (counts.get(w) ?? 0) + 1);
  }
  return order.sort((a, b) => (counts.get(b) ?? 0) - (counts.get(a) ?? 0) || order.indexOf(a) - order.indexOf(b)).slice(0, max);
}

export const titleCase = (s: string): string => s.replace(/(^|[\s-_])([a-z])/g, (_, sep: string, ch: string) => sep + ch.toUpperCase());
export const sentenceCase = (s: string): string => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);
export const truncate = (s: string, max: number): string => (s.length <= max ? s : `${s.slice(0, Math.max(0, max - 1)).trimEnd()}…`);
export const humaniseKey = (s: string): string => s.replace(/[._-]+/g, " ").replace(/([a-z])([A-Z])/g, "$1 $2").toLowerCase();

/** Entity mention markup (BUILD §2.1 rule 3). */
export const ent = (e: ManifestEntry): string => `[[ent:${e.id}|${e.name}]]`;

/** Format minor units without inventing precision: €500 for 50000, €4.20 for 420. */
export function formatMoneyMinor(amountMinor: number, currency: string): string {
  const symbol = ({ EUR: "€", USD: "$", GBP: "£" } as Record<string, string>)[currency.toUpperCase()];
  const major = amountMinor / 100;
  const text = Number.isInteger(major) ? String(major) : major.toFixed(2);
  return symbol ? `${symbol}${text}` : `${text} ${currency.toUpperCase()}`;
}

/** Channel label from the shared vocabulary. */
export const channelLabel = (key: ChannelKey): string => CHANNEL_META[key].label;

/** A uuid for mock output: the input id when it is already a uuid, otherwise a deterministic uuid derived from it. */
export const asUuid = (id: string | undefined, seed: string): string => (id && isUuidLike(id) ? id : uuidFromSeed(`${seed}:${id ?? ""}`));

export interface AgentLike {
  id: string;
  name: string;
  role: string;
  department_id?: string;
  channel?: string;
  status?: string;
}

/** Agents known to the prompt: manifest entries of kind `agent` plus any `agents` array. */
export function agentsFrom(ctx: MockContext): AgentLike[] {
  const out = new Map<string, AgentLike>();
  for (const e of ctx.manifest) {
    if (e.kind === "agent") out.set(e.id, { id: e.id, name: e.name, role: e.role ?? "", department_id: e.department_id, channel: e.channel });
  }
  for (const a of ctx.getArray<Record<string, unknown>>("agents", "squad", "team")) {
    if (!isRecord(a)) continue;
    const id = typeof a.id === "string" ? a.id : typeof a.agent_id === "string" ? a.agent_id : undefined;
    if (!id) continue;
    out.set(id, {
      id,
      name: typeof a.name === "string" ? a.name : `Agent ${id.slice(0, 6)}`,
      role: typeof a.role === "string" ? a.role : typeof a.agent_type === "string" ? a.agent_type : "",
      department_id: typeof a.department_id === "string" ? a.department_id : typeof a.departmentId === "string" ? a.departmentId : undefined,
      channel: typeof a.channel === "string" ? a.channel : typeof a.channel_key === "string" ? a.channel_key : undefined,
      status: typeof a.status === "string" ? a.status : undefined,
    });
  }
  return [...out.values()];
}

export { isRecord };
