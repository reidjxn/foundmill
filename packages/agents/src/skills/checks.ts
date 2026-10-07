/**
 * Deterministic checks (BUILD §11.10 "deterministic checks first (tests pass, schema valid, policy respected), then Opus
 * grader"). Pure functions over the agent's output plus what the sandbox observed, so the training runner and `evals/`
 * share one implementation and a grader can never override a failed check (BUILD §12.5).
 */
import { ENTITY_MARKUP_RE } from "@foundmill/shared";
import { type DeterministicCheck, type DeterministicCheckKind } from "../types";

export interface CheckContext {
  /** The agent's final text output (for schema tasks: the JSON text). */
  output: string;
  /** Parsed JSON when the task asked for a schema and the model layer validated it; undefined when it did not parse. */
  json?: unknown;
  /** Result of the task's acceptance tests in the sandbox, when any ran. */
  testsPassed?: boolean;
  /** Policy outcomes the gateway recorded during the session: any `deny` is a violation. */
  policyViolations?: readonly string[];
  /** Tool calls the session made (connector.tool), for no_tool_calls. */
  toolCalls?: readonly string[];
  /** Entity ids the manifest allowed; when given, every [[ent:id|…]] in the output must be one of them. */
  manifestIds?: ReadonlySet<string> | readonly string[];
  /** Source record ids available to the task; when given, cites_source_ids requires at least one of them verbatim. */
  sourceIds?: readonly string[];
}

export interface CheckResult {
  kind: DeterministicCheckKind;
  passed: boolean;
  detail?: string;
}

/** Record-id shapes agents cite: `att_77`, `inc_9`, `qte_201`, `rep_12`, `src-2026-01`, UUIDs. */
export const RECORD_ID_RE = /\b(?:[a-z]{2,10}[_-][0-9a-z][0-9a-z_-]{0,23}|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\b/i;

export function countWords(text: string): number {
  return text.trim().length === 0 ? 0 : text.trim().split(/\s+/).length;
}

function terms(params: Record<string, unknown>): string[] {
  const t = params.terms;
  return Array.isArray(t) ? t.filter((x): x is string => typeof x === "string") : [];
}

function containsTerm(haystack: string, term: string): boolean {
  return haystack.toLowerCase().includes(term.toLowerCase());
}

export function runDeterministicCheck(check: DeterministicCheck, ctx: CheckContext): CheckResult {
  const params = check.params ?? {};
  switch (check.kind) {
    case "json_schema_valid": {
      if (ctx.json !== undefined) return { kind: check.kind, passed: true };
      try {
        JSON.parse(ctx.output);
        return { kind: check.kind, passed: params.schemaRef ? false : true, detail: params.schemaRef ? "output parsed as JSON but was not validated against the schema" : undefined };
      } catch {
        return { kind: check.kind, passed: false, detail: "output is not valid JSON" };
      }
    }
    case "tests_pass":
      return { kind: check.kind, passed: ctx.testsPassed === true, detail: ctx.testsPassed === undefined ? "no test run recorded" : undefined };
    case "policy_respected": {
      const violations = ctx.policyViolations ?? [];
      return { kind: check.kind, passed: violations.length === 0, detail: violations.length ? violations.join("; ") : undefined };
    }
    case "entity_links_valid": {
      const allowed = ctx.manifestIds instanceof Set ? ctx.manifestIds : ctx.manifestIds ? new Set(ctx.manifestIds) : undefined;
      const bad: string[] = [];
      for (const m of ctx.output.matchAll(new RegExp(ENTITY_MARKUP_RE.source, "g"))) {
        const id = m[1]!;
        if (allowed && !allowed.has(id)) bad.push(id);
      }
      // A half-written mention ("[[ent:" without the closing "]]") is malformed markup.
      const malformed = (ctx.output.match(/\[\[ent:/g) ?? []).length !== (ctx.output.match(new RegExp(ENTITY_MARKUP_RE.source, "g")) ?? []).length;
      if (malformed) bad.push("(malformed markup)");
      return { kind: check.kind, passed: bad.length === 0, detail: bad.length ? `unknown or malformed links: ${bad.join(", ")}` : undefined };
    }
    case "word_count": {
      const n = countWords(ctx.output);
      const min = typeof params.min === "number" ? params.min : 0;
      const max = typeof params.max === "number" ? params.max : Number.POSITIVE_INFINITY;
      return { kind: check.kind, passed: n >= min && n <= max, detail: `${n} words (expected ${min}-${Number.isFinite(max) ? max : "∞"})` };
    }
    case "contains_all": {
      const missing = terms(params).filter((t) => !containsTerm(ctx.output, t));
      return { kind: check.kind, passed: missing.length === 0, detail: missing.length ? `missing: ${missing.join(", ")}` : undefined };
    }
    case "contains_none": {
      const present = terms(params).filter((t) => containsTerm(ctx.output, t));
      return { kind: check.kind, passed: present.length === 0, detail: present.length ? `forbidden: ${present.join(", ")}` : undefined };
    }
    case "no_tool_calls": {
      const calls = ctx.toolCalls ?? [];
      return { kind: check.kind, passed: calls.length === 0, detail: calls.length ? `called: ${calls.join(", ")}` : undefined };
    }
    case "cites_source_ids": {
      if (ctx.sourceIds && ctx.sourceIds.length > 0) {
        const cited = ctx.sourceIds.filter((id) => ctx.output.includes(id));
        return { kind: check.kind, passed: cited.length > 0, detail: cited.length ? `cites ${cited.join(", ")}` : "no provided source id cited" };
      }
      return { kind: check.kind, passed: RECORD_ID_RE.test(ctx.output), detail: RECORD_ID_RE.test(ctx.output) ? undefined : "no record id found" };
    }
    default: {
      const never: never = check.kind;
      return { kind: never, passed: false, detail: `unknown check kind ${String(never)}` };
    }
  }
}

export function runDeterministicChecks(checks: readonly DeterministicCheck[], ctx: CheckContext): CheckResult[] {
  return checks.map((c) => runDeterministicCheck(c, ctx));
}

/** Deterministic results are authoritative: a failed check caps the task score at 0 (BUILD §12.5). */
export function allChecksPassed(results: readonly CheckResult[]): boolean {
  return results.every((r) => r.passed);
}
