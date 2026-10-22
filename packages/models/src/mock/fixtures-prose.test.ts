/**
 * Every mock fixture string a founder could read follows the voice guide (docs/UX_AUDIT_AND_PLAN.md §7.19, E2, E4, E5):
 * no developer notes ("Mock citation — replace with …", "See note."), no plumbing (named query, exhibit, policy caps,
 * request_human_action), none of the replace-tier jargon (ICP, CPA, concurrency, time box, triage), and the old
 * mechanism-first sentences gone. The scan reads the mock sources themselves, so a sentence the generators only emit
 * for a rare input is caught too; identifiers (strings without a space) and comments are not prose and are skipped.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const MOCK_DIR = __dirname;

/** The phrases no fixture string may carry (whole words; the acronyms are case-sensitive). */
export const FORBIDDEN_IN_FIXTURES: readonly RegExp[] = [
  /Mock citation/i,
  /\breplace with\b/i,
  /\bSee note\./,
  /\bnamed quer(?:y|ies)\b/i,
  /\bexhibits?\b/i,
  /\bpolicy caps?\b/i,
  /\brequest_human_action\b/,
  /\bICP\b/,
  /\bCPA\b/,
  /\bconcurrency\b/i,
  /\btime box(?:ed|es)?\b/i,
  /\btriage[sd]?\b/i,
  /\bmock research\b/i,
  /\bin (?:mock|live) mode\b/i,
  /BUILD §/,
  /House rules are untouched/,
  /differ in cost and reversibility/,
  /outside the current policy caps/,
];

/**
 * The string and template literals of a TypeScript source, read with a small tokenizer that knows comments, the three
 * quote kinds, template substitutions and the common regex-literal positions. Template literals yield their literal
 * spans (the text between substitutions), which is where the prose lives.
 */
export function proseStringsOf(source: string): string[] {
  const out: string[] = [];
  const n = source.length;
  let i = 0;
  // What came before a `/` decides whether it opens a regex literal or divides.
  let lastSignificant = "";
  const regexCanStart = () => lastSignificant === "" || /[(,=:[!&|?{};+\-*%<>~^]$/.test(lastSignificant) || /\b(?:return|typeof|case|in|of|new|delete|void|throw)$/.test(lastSignificant);
  const push = (s: string) => {
    if (s.trim()) out.push(s);
  };
  const readTemplate = (): void => {
    // At the opening backtick.
    i++;
    let span = "";
    while (i < n) {
      const ch = source[i]!;
      if (ch === "\\") {
        span += source.slice(i, i + 2);
        i += 2;
        continue;
      }
      if (ch === "`") {
        push(span);
        i++;
        return;
      }
      if (ch === "$" && source[i + 1] === "{") {
        push(span);
        span = "";
        i += 2;
        let depth = 1;
        // The substitution is code: strings and templates inside it are read in turn.
        while (i < n && depth > 0) {
          const c = source[i]!;
          if (c === "`") {
            readTemplate();
            continue;
          }
          if (c === '"' || c === "'") {
            readQuoted(c);
            continue;
          }
          if (c === "{") depth++;
          else if (c === "}") depth--;
          if (depth > 0) i++;
        }
        i++; // the closing brace
        continue;
      }
      span += ch;
      i++;
    }
  };
  const readQuoted = (quote: string): void => {
    i++;
    let s = "";
    while (i < n) {
      const ch = source[i]!;
      if (ch === "\\") {
        s += source.slice(i, i + 2);
        i += 2;
        continue;
      }
      if (ch === quote) {
        i++;
        push(s);
        return;
      }
      if (ch === "\n") return; // an unterminated string is not ours to judge
      s += ch;
      i++;
    }
  };
  while (i < n) {
    const ch = source[i]!;
    const next = source[i + 1];
    if (ch === "/" && next === "/") {
      const end = source.indexOf("\n", i);
      i = end === -1 ? n : end;
      continue;
    }
    if (ch === "/" && next === "*") {
      const end = source.indexOf("*/", i + 2);
      i = end === -1 ? n : end + 2;
      continue;
    }
    if (ch === "`") {
      readTemplate();
      lastSignificant = "`";
      continue;
    }
    if (ch === '"' || ch === "'") {
      readQuoted(ch);
      lastSignificant = ch;
      continue;
    }
    if (ch === "/" && regexCanStart()) {
      // A regex literal: skip to its unescaped closing slash (a class may hold a slash).
      i++;
      let inClass = false;
      while (i < n) {
        const c = source[i]!;
        if (c === "\\") {
          i += 2;
          continue;
        }
        if (c === "[") inClass = true;
        else if (c === "]") inClass = false;
        else if (c === "/" && !inClass) break;
        else if (c === "\n") break;
        i++;
      }
      i++;
      while (i < n && /[a-z]/.test(source[i]!)) i++; // flags
      lastSignificant = "/regex/";
      continue;
    }
    if (!/\s/.test(ch)) {
      // Keep enough of the preceding code to tell a divide from a regex.
      const m = /[A-Za-z_$][A-Za-z0-9_$]*$/.exec(lastSignificant);
      lastSignificant = /[A-Za-z0-9_$]/.test(ch) ? (m ? lastSignificant : "") + ch : ch;
    }
    i++;
  }
  return out;
}

/** Prose: at least two words. Bare identifiers, keys, ids and slugs are left to the type checker. */
const isProse = (s: string) => /\S\s+\S/.test(s.trim());

const FIXTURE_FILES = readdirSync(MOCK_DIR)
  .filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts") && !f.endsWith(".test-helpers.ts"))
  .sort();

describe("mock fixture prose (UX plan §7.19, E2, E4, E5)", () => {
  it("reads strings, template spans and nothing else from a source", () => {
    const sample = [
      'const a = "Mock citation — replace with x"; // a comment: named query',
      "/* exhibit in a block comment */",
      "const re = /\\bexhibit\\b/i; const b = x / y / z;",
      "const t = `Hello ${name}, the ${kind === 'chart' ? \"chart\" : `table ${n}`} below is live`;",
      "const k = 'request_human_action';",
    ].join("\n");
    const strings = proseStringsOf(sample);
    expect(strings).toContain("Mock citation — replace with x");
    expect(strings).toContain("Hello ");
    expect(strings).toContain(" below is live");
    expect(strings).toContain("chart");
    expect(strings).toContain("table ");
    expect(strings).toContain("request_human_action");
    expect(strings.some((s) => /comment/.test(s))).toBe(false);
    expect(strings.some((s) => /\\bexhibit/.test(s))).toBe(false);
    expect(strings.some((s) => /[xyz] \/ /.test(s))).toBe(false);
  });

  it("covers every mock generator", () => {
    expect(FIXTURE_FILES).toEqual(expect.arrayContaining(["inboxComposer.ts", "chiefOfStaff.ts", "coach.ts", "ideation.ts", "jurisdictionRecommender.ts", "worker.ts", "codeReview.ts", "index.ts"]));
  });

  it.each(FIXTURE_FILES)("%s carries no developer note, plumbing or replace-tier jargon in any prose string", (file) => {
    const source = readFileSync(join(MOCK_DIR, file), "utf8");
    const hits: string[] = [];
    for (const s of proseStringsOf(source)) {
      if (!isProse(s)) continue;
      for (const re of FORBIDDEN_IN_FIXTURES) if (re.test(s)) hits.push(`${re}: "${s.trim().slice(0, 120)}"`);
    }
    expect(hits).toEqual([]);
  });

  it("the Coach says every rule still applies, in those words", () => {
    const source = readFileSync(join(MOCK_DIR, "coach.ts"), "utf8");
    expect(source).toContain("Every rule still applies.");
  });
});
