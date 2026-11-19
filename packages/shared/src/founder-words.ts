/**
 * The founder-language boundary (founder, 2026-11-01): what the team says about its own machinery, in the words a founder
 * uses. Agents, the planner and the platform name tasks and events in engineering terms ("Rebase agent/… onto main",
 * "Fix hydration mismatch", "Open a PR for the deploy contract"); nothing a founder reads may carry them.
 *
 * Two layers share this map:
 *   - `founderPhrase` rewrites a technical sentence deterministically (the mock model route, the api's fallback when the
 *     composer is away, and the last resort when the model's title breaks a rule);
 *   - `founderTitleProblems` is the rule book a model-written title is checked against before it is stored, and the
 *     Composer eval runs it over every runtime founder-facing string (evals/src/founder-strings.ts).
 *
 * The replace tier of `PLAIN_LANGUAGE_TIERS` is the floor; the words here are the engineering vocabulary the brief named,
 * plus the ones the Nov 1 Inbox showed ("deploy contract", "guards", "orchestrator"). A title has no room to define a word,
 * so the code-hosting words of the define tier ("pull request", "branch", "sandbox") are out of titles too
 * (`TITLE_BANNED_TERM_IDS`); the business's own defined words (runway, roadmap, cap table) stay, since the screens define them.
 */
import { PLAIN_LANGUAGE_TIERS, TERMS, type TermId } from "./terms";

/**
 * The define-tier words a title may not carry: the code-hosting words, which a founder's title has no room to define
 * and never needs ("Pull request #41" is "Sam's change"). The business words of the define tier (runway, roadmap,
 * specification, cap table) are the founder's own vocabulary, defined on every screen that shows them, and stay.
 */
export const TITLE_BANNED_TERM_IDS = ["pull_request", "branch", "sandbox", "task_graph", "acceptance", "hard_gate"] as const satisfies readonly TermId[];

/** Engineering phrase → founder phrase. Longer keys first so "pull request" wins over "request". */
export const FOUNDER_WORDS: ReadonlyArray<readonly [technical: string, founder: string]> = [
  ["hydration mismatch", "a display bug"],
  ["hydration error", "a display bug"],
  ["hydration", "a display bug"],
  ["deploy contract", "the rules for how the team releases"],
  ["deployment contract", "the rules for how the team releases"],
  ["deploy guards", "the rules for how the team releases"],
  ["deploy guard", "the rules for how the team releases"],
  ["release guards", "the rules for how the team releases"],
  ["pull requests", "finished changes"],
  ["pull request", "a finished change"],
  ["merge conflicts", "clashes with the newest version"],
  ["merge conflict", "a clash with the newest version"],
  ["merged", "put live"],
  ["merging", "putting live"],
  ["merge", "put live"],
  ["rebased", "brought up to date with the newest version"],
  ["rebasing", "bringing up to date with the newest version"],
  ["rebase", "bring up to date with the newest version"],
  ["CI pipeline", "the quality checks"],
  ["CI checks", "the quality checks"],
  ["CI run", "the quality checks"],
  ["CI", "the quality checks"],
  // Tests are "quality checks" to the founder (Nov 7, 2026): one plain phrase, used by every approval and status line.
  ["acceptance tests", "quality checks"],
  ["automatic tests", "quality checks"],
  ["test suite", "quality checks"],
  ["test memory", "the checking setup"],
  ["sandboxes", "practice copies"],
  ["sandbox", "a practice copy"],
  ["test copies", "practice copies"],
  ["test copy", "a practice copy"],
  ["orchestrator", "the system that runs the team"],
  ["branches", "the agents' working copies"],
  ["branch", "the agent's working copy"],
  ["main branch", "the live product"],
  ["default branch", "the live product"],
  ["onto main", "with the live product"],
  ["into main", "into the live product"],
  ["to main", "to the live product"],
  ["on main", "in the live product"],
  ["repository", "the code"],
  ["repo", "the code"],
  ["refactor", "tidy up"],
  ["endpoint", "connection point"],
  ["webhook", "automatic notice"],
  ["API", "connection"],
  ["SQL", "the database"],
  ["schema", "the data layout"],
  ["migration", "a change to the data layout"],
  ["lint", "the style check"],
  ["linter", "the style check"],
  ["typecheck", "the quality checks"],
  ["unit tests", "the quality checks"],
  ["e2e", "the quality checks"],
  // The words of the Nov 6, 2026 Inbox ("Audit current environment values on all services", "enforce founder-only
  // handler for merges", "Real Railway deploy provider") that the map did not catch.
  ["environment values", "settings"],
  ["environment variables", "settings"],
  ["env vars", "settings"],
  ["connectors", "connections"],
  ["connector", "connection"],
  ["handler", "rule"],
  ["deployments", "releases"],
  ["deployment", "release"],
  ["deploys", "releases"],
  ["deploy", "release"],
  ["pipeline", "process"],
  ["infrastructure", "the servers"],
  ["boot logs", "start-up records"],
  ["latency", "speed"],
  ["flaky", "unreliable"],
  ["regression", "something that stopped working"],
  ["hotfix", "quick fix"],
] as const;

/** The technical side of the map, as whole-word patterns (case-insensitive except for the acronyms). */
const TECHNICAL_PATTERNS: ReadonlyArray<readonly [RegExp, string]> = FOUNDER_WORDS.map(([technical, founder]) => {
  // Whole words only, in any case: a tool key's "merge pr" is the acronym too, and "ci" inside "pricing" is not.
  const escaped = technical.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\s+/g, "\\s+");
  return [new RegExp(`(?<![A-Za-z0-9_])${escaped}(?![A-Za-z0-9_])`, "gi"), founder] as const;
});

/**
 * The engine's own numbers (Builder view, founder, Nov 8, 2026): a cycle or round number, a test tally, a token count,
 * a pull request number and an ETA say how the platform runs the team, which a founder does not read. They are caught in
 * prose and titles like the map's words, and `founderPhrase` rewrites them: "Cycle 3" is "a round of work", "105 tests
 * passed" is "the quality checks passed", "12,400 tokens" is "some AI usage", "PR #41" is "a finished change".
 */
type EngineRewrite = string | ((match: string, ...groups: string[]) => string);
const ENGINE_PATTERNS: ReadonlyArray<readonly [RegExp, EngineRewrite]> = [
  [/(?<![A-Za-z0-9_])(?:cycle|round(?: of work)?)\s+#?\d+(?![A-Za-z0-9_])/gi, "a round of work"],
  [/(?<![A-Za-z0-9_])PRs?\s*#\d+(?![A-Za-z0-9_])/gi, "a finished change"],
  [
    /(?<![A-Za-z0-9_.,])\d[\d,]*\s+(?:of\s+\d[\d,]*\s+)?(?:acceptance\s+|automatic\s+|unit\s+)?tests?\s+(passed|passing|failing|failed)(?![A-Za-z0-9_])/gi,
    (_m: string, verb: string) => {
      const v = verb.toLowerCase();
      return v === "passed" ? "the quality checks passed" : v === "passing" ? "the quality checks are passing" : v === "failing" ? "some quality checks are failing" : "some quality checks failed";
    },
  ],
  [/(?<![A-Za-z0-9_.,])\d[\d,.]*\s*[KkMm]?\s+tokens(?![A-Za-z0-9_])/g, "some AI usage"],
  [/(?<![A-Za-z0-9_])ETA(?![A-Za-z0-9_])/g, "expected finish"],
];

/** The engine patterns as one-shot matchers for the checks (no `g`, so `exec` never carries a lastIndex). */
const ENGINE_MATCHERS: ReadonlyArray<RegExp> = ENGINE_PATTERNS.map(([re]) => new RegExp(re.source, re.flags.replace("g", "")));

/** The engine's numbers in founder words, nothing else touched (the first step of `founderPhrase`). */
export function withoutEngineNumbers(text: string): string {
  let out = text;
  for (const [re, founder] of ENGINE_PATTERNS) out = typeof founder === "string" ? out.replace(re, founder) : out.replace(re, founder);
  return out;
}

/** Identifiers nobody reads: uuids, short hashes, branch paths, `#123`, code in backticks, file paths and dotted names. */
const IDENTIFIER_PATTERNS: ReadonlyArray<RegExp> = [
  /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i,
  /(?<![A-Za-z0-9])[0-9a-f]{7,40}(?![A-Za-z0-9])/,
  /\b[a-z0-9_-]+\/[a-z0-9_./-]+/i,
  /#\d+/,
  /`[^`]*`/,
  /\b\w+\.(?:ts|tsx|js|mjs|json|sql|md|yml|yaml|css)\b/i,
  /\b[a-z]+[A-Z][A-Za-z]+\b/,
  /\b[a-z0-9]+_[a-z0-9_]+\b/i,
];

export const FOUNDER_TITLE_MAX_WORDS = 10;

/** The founder phrase for one technical phrase, when the map holds it (exact, case-insensitive). */
export function founderWord(technical: string): string | null {
  const key = technical.trim().toLowerCase();
  const hit = FOUNDER_WORDS.find(([t]) => t.toLowerCase() === key);
  return hit ? hit[1] : null;
}

/**
 * The map alone, applied longest-first to a phrase, nothing else touched: for a tool's words in an approval's subject
 * ("run migration" → "run a change to the data layout"), where case and identifiers are the caller's to keep.
 */
export function founderWords(text: string): string {
  let out = text;
  for (const [re, founder] of TECHNICAL_PATTERNS) out = out.replace(re, founder);
  return out.replace(/\b(the|a|an)\s+(the|a|an)\b/gi, "$1").replace(/\s+/g, " ").trim();
}

/**
 * A technical sentence in the founder's words, deterministically: the map applied longest-first, identifiers dropped,
 * the leftovers tidied (double spaces, a stray "the the", sentence case, no trailing punctuation). It is a rewrite, not
 * an understanding: "Rebase agent/0863 onto main" reads "Bring up to date with the newest version with the live product",
 * which is honest and clumsy; the model route writes the good one, and this is what stands when it cannot.
 */
export function founderPhrase(text: string): string {
  // The engine's numbers first, so "PR #41" reads "a finished change" before "#41" is dropped as an identifier.
  let out = withoutEngineNumbers(text);
  // Identifiers first, so a branch path never turns into "the agent's working copy/0863…": a task branch is the agent's
  // working copy, a page path ("/pricing") is that page, any other path or hash is dropped.
  out = out.replace(/\b(agent|feature|fix|chore|release|hotfix)\/[A-Za-z0-9_./-]+/g, "the agent's working copy");
  out = out.replace(/(?<![A-Za-z0-9])\/([a-z0-9-]+)(?:\/[A-Za-z0-9_.-]+)*/g, (_m, page: string) => `the ${page} page`);
  out = out.replace(/\b[a-z0-9_-]+\/[A-Za-z0-9_./-]+/g, "");
  out = out.replace(IDENTIFIER_PATTERNS[0]!, "").replace(/(?<![A-Za-z0-9])[0-9a-f]{7,40}(?![A-Za-z0-9])/g, "").replace(/#\d+/g, "").replace(/`[^`]*`/g, "");
  for (const [re, founder] of TECHNICAL_PATTERNS) out = out.replace(re, founder);
  out = out
    .replace(/\b(the|a|an)\s+(the|a|an)\b/gi, "$1")
    .replace(/\s+/g, " ")
    .replace(/\s+([,.;:])/g, "$1")
    .replace(/[.!?:;,\s]+$/, "")
    // A dropped path leaves its preposition hanging ("… the automatic tests in").
    .replace(/\s+(?:in|on|for|to|with|of|at|from|and|or|into|onto)$/i, "")
    .trim();
  if (!out) return "";
  return out.charAt(0).toUpperCase() + out.slice(1);
}

export interface FounderTitleProblem {
  /** What rule the title breaks. */
  rule: "empty" | "too_long" | "technical_word" | "jargon" | "identifier" | "punctuation" | "case";
  /** The offending text, when there is one. */
  text?: string;
}

/**
 * Why a title is not yet a founder's title: empty, over ten words, an engineering word from the map, a replace- or
 * define-tier term, an identifier, trailing punctuation, or a lower-case start. An empty list means it passes.
 */
export function founderTitleProblems(title: string): FounderTitleProblem[] {
  const problems: FounderTitleProblem[] = [];
  const trimmed = title.trim();
  if (!trimmed) return [{ rule: "empty" }];
  const words = trimmed.split(/\s+/);
  if (words.length > FOUNDER_TITLE_MAX_WORDS) problems.push({ rule: "too_long", text: `${words.length} words` });
  for (const re of [...TECHNICAL_PATTERNS.map(([p]) => new RegExp(p.source, p.flags.replace("g", ""))), ...ENGINE_MATCHERS]) {
    const m = re.exec(trimmed);
    if (m) problems.push({ rule: "technical_word", text: m[0] });
  }
  for (const term of [...PLAIN_LANGUAGE_TIERS.replace, ...TITLE_BANNED_TERM_IDS.map((id) => TERMS[id].word)]) {
    const caseSensitive = /[A-Z]/.test(term.slice(1));
    const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\s+/g, "\\s+");
    const m = new RegExp(`(?<![A-Za-z0-9_])${escaped}(?![A-Za-z0-9_])`, caseSensitive ? "" : "i").exec(trimmed);
    if (m) problems.push({ rule: "jargon", text: m[0] });
  }
  for (const re of IDENTIFIER_PATTERNS) {
    const m = re.exec(trimmed);
    if (m) {
      problems.push({ rule: "identifier", text: m[0] });
      break;
    }
  }
  if (/[.!?:;,]$/.test(trimmed)) problems.push({ rule: "punctuation", text: trimmed.slice(-1) });
  if (/^[a-z]/.test(trimmed)) problems.push({ rule: "case", text: trimmed.slice(0, 1) });
  // One entry per rule and text.
  const seen = new Set<string>();
  return problems.filter((p) => {
    const key = `${p.rule}:${(p.text ?? "").toLowerCase()}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/** True when the title passes every rule of `founderTitleProblems`. */
export function isFounderTitle(title: string): boolean {
  return founderTitleProblems(title).length === 0;
}

/**
 * The engineering words in a piece of prose a founder reads (an Inbox note, a Decided panel line, a hand-back reason):
 * the map's technical side, the engine's numbers (a cycle or round number, a test tally, tokens, "PR #41", an ETA), the
 * replace tier and the code-hosting define-tier words, by whole word. Length, case and
 * identifiers are a title's rules, not prose's; this is the check the runtime founder-facing strings are tested with.
 */
export function founderJargonHits(text: string): { term: string; index: number }[] {
  const hits: { term: string; index: number }[] = [];
  const seen = new Set<string>();
  const patterns: RegExp[] = [...TECHNICAL_PATTERNS.map(([re]) => new RegExp(re.source, re.flags.replace("g", ""))), ...ENGINE_MATCHERS];
  for (const term of [...PLAIN_LANGUAGE_TIERS.replace, ...TITLE_BANNED_TERM_IDS.map((id) => TERMS[id].word)]) {
    const caseSensitive = /[A-Z]/.test(term.slice(1));
    const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\s+/g, "\\s+");
    patterns.push(new RegExp(`(?<![A-Za-z0-9_])${escaped}(?![A-Za-z0-9_])`, caseSensitive ? "" : "i"));
  }
  for (const re of patterns) {
    const m = re.exec(text);
    if (!m) continue;
    const key = m[0].toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    hits.push({ term: m[0], index: m.index });
  }
  return hits.sort((a, b) => a.index - b.index);
}

/**
 * The founder title for a technical task title without a model: the deterministic rewrite when it passes every rule
 * (ten words included: a rewrite cut short is a broken sentence, not a title); null when it does not, so the technical
 * title stays and the model route is asked at the next cycle.
 */
export function founderTitleFallback(technical: string): string | null {
  const phrase = founderPhrase(technical);
  return phrase && isFounderTitle(phrase) ? phrase : null;
}

/** The founder's word for a cycle (WP-02 T8). Both views now say "round of work" (founder, 2026-11-17); Builder view differs only in the idle line. */
export function roundWords(builder: boolean): { one: string; a: string; idle: string } {
  return builder ? { one: "round of work", a: "a round of work", idle: "No round of work running" } : { one: "round of work", a: "a round of work", idle: "The team is idle" };
}

/**
 * "project" until the first sale and where the stage is not known (CLAUDE.md, 2026-11-11). Called with no argument
 * until a field carries the first sale (WP-08 passes it).
 */
export function ventureNoun(hadFirstSale?: boolean | null): "project" | "business" {
  return hadFirstSale === true ? "business" : "project";
}
