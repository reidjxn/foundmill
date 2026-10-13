/**
 * Versioned prompt templates with typed variables (BUILD §12 "Store each as a versioned template with variables").
 *
 * A template is immutable data: `key`, `version`, `route`, a Zod object describing its variables and a `text` with
 * `{variable}` placeholders. `definePrompt()` refuses a text whose placeholders and declared variables differ, and
 * `render()` validates the variables, refuses a placeholder left without a value and substitutes every placeholder, so a
 * typo in a template or a missing variable fails loudly instead of reaching a model. Values are inserted verbatim.
 */
import { z } from "zod";
import { type RouteKey } from "../types";

/** Matches `{name}` placeholders. Names are identifiers (letters, digits, underscore). JSON braces such as `{schema}` in
 *  prose are still placeholders, so templates that need literal braces write them as `{{` / `}}`. */
const PLACEHOLDER_RE = /\{([A-Za-z_][A-Za-z0-9_]*)\}/g;

export interface PromptTemplateInit<TShape extends z.ZodRawShape> {
  key: string;
  version: number;
  route: RouteKey;
  /** One line on what the template is for; shown in the agent builder and evals. */
  description: string;
  variables: z.ZodObject<TShape>;
  text: string;
}

export interface PromptTemplate<TShape extends z.ZodRawShape = z.ZodRawShape> {
  readonly key: string;
  readonly version: number;
  readonly route: RouteKey;
  readonly description: string;
  readonly variables: z.ZodObject<TShape>;
  readonly text: string;
  /** Placeholder names present in `text`, in first-appearance order. */
  readonly placeholders: readonly string[];
  /** Validate `vars`, substitute every placeholder and return the finished prompt. Throws on invalid or missing input. */
  render(vars: z.input<z.ZodObject<TShape>>): string;
}

export class PromptRenderError extends Error {
  constructor(
    message: string,
    readonly templateKey: string,
    readonly issues: readonly string[] = [],
  ) {
    super(message);
    this.name = "PromptRenderError";
  }
}

/** Extract placeholder names from a template text (ignores escaped `{{`/`}}`). */
export function extractPlaceholders(text: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  const unescaped = text.replace(/\{\{|\}\}/g, " ");
  for (const m of unescaped.matchAll(PLACEHOLDER_RE)) {
    const name = m[1] as string;
    if (!seen.has(name)) {
      seen.add(name);
      out.push(name);
    }
  }
  return out;
}

/** Format a variable value for insertion. Arrays become comma lists; objects become compact JSON; others stringify. */
export function formatVariable(value: unknown): string {
  if (value === null || value === undefined) return "null";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean" || typeof value === "bigint") return String(value);
  if (Array.isArray(value)) {
    if (value.every((v) => typeof v === "string" || typeof v === "number" || typeof v === "boolean")) return value.join(", ");
    return JSON.stringify(value);
  }
  if (value instanceof Date) return value.toISOString();
  return JSON.stringify(value);
}

export function definePrompt<TShape extends z.ZodRawShape>(init: PromptTemplateInit<TShape>): PromptTemplate<TShape> {
  const placeholders = extractPlaceholders(init.text);
  const declared = new Set(Object.keys(init.variables.shape));
  const undeclared = placeholders.filter((p) => !declared.has(p));
  if (undeclared.length > 0) {
    throw new Error(`Prompt "${init.key}" v${init.version} uses undeclared placeholders: ${undeclared.join(", ")}`);
  }
  const unused = [...declared].filter((d) => !placeholders.includes(d));
  if (unused.length > 0) {
    throw new Error(`Prompt "${init.key}" v${init.version} declares variables that never appear in the text: ${unused.join(", ")}`);
  }

  const render = (vars: z.input<z.ZodObject<TShape>>): string => {
    const parsed = init.variables.safeParse(vars);
    if (!parsed.success) {
      const issues = parsed.error.issues.map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`);
      throw new PromptRenderError(`Invalid variables for prompt "${init.key}" v${init.version}: ${issues.join("; ")}`, init.key, issues);
    }
    const values = parsed.data as Record<string, unknown>;
    // Missing values are checked against the template's own placeholders, never by scanning the substituted text: a value
    // is inserted verbatim, so a business named "Acme {Labs}" renders as written instead of failing every call (audit CML-06).
    const missing = placeholders.filter((name) => values[name] === undefined);
    if (missing.length > 0) {
      throw new PromptRenderError(`Prompt "${init.key}" v${init.version} is missing variables: ${missing.join(", ")}`, init.key, missing);
    }
    // Split on escaped braces exactly as `extractPlaceholders` reads them, substitute the placeholders of each piece and
    // join the pieces with single braces. Inserted values are never matched again.
    return init.text
      .split(/(\{\{|\}\})/)
      .map((piece) => (piece === "{{" ? "{" : piece === "}}" ? "}" : piece.replace(PLACEHOLDER_RE, (_m, name: string) => formatVariable(values[name]))))
      .join("");
  };

  return Object.freeze({
    key: init.key,
    version: init.version,
    route: init.route,
    description: init.description,
    variables: init.variables,
    text: init.text,
    placeholders: Object.freeze(placeholders),
    render,
  });
}

/** Convenience for templates that take no variables. */
export const NoVariables = z.object({});
