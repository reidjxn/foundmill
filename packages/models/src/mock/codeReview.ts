/**
 * Mock Review agent (BUILD §11.6). Reads the unified diff in the prompt and raises deterministic findings for the
 * patterns the platform forbids or frowns on (raw db calls outside repos, process.env outside env.ts, secrets, eval,
 * debug logging, explicit any, money-moving or signing calls in agent code, no tests in a large change).
 */
import type { Severity } from "@foundmill/shared";
import type { CodeReviewOutput } from "../schemas";
import type { MockContext } from "./inputs";

interface AddedLine {
  file: string;
  line: number | null;
  text: string;
}

interface Rule {
  re: RegExp;
  severity: Severity;
  title: string;
  detail: string;
  suggestion: string | null;
  /** Skip when the file path matches. */
  unless?: RegExp;
}

const RULES: Rule[] = [
  { re: /\b(?:db|tx|database|serviceDb)\.(?:select|insert|update|delete|execute|selectDistinct)\(/, unless: /packages\/db\/(?:src\/(?:repos|seed|seeds|migrate|testing|schema)|migrations)\/|\.test\.|__tests__/, severity: "critical", title: "Raw database query outside packages/db repos", detail: "Service code reaches the database only through the data functions in packages/db that take businessId first, so one business can never read another's rows.", suggestion: "Move the query into packages/db/src/repos/<area>.ts and call repos.<area>.<fn>(db, businessId, ...)." },
  { re: /\beval\(|new Function\(/, severity: "critical", title: "Dynamic code execution", detail: "eval/new Function on data the agent did not author is an injection vector.", suggestion: "Parse the input with Zod and act on the typed result." },
  { re: /sk-ant-[A-Za-z0-9_-]{8,}|AKIA[0-9A-Z]{16}|-----BEGIN (?:RSA |EC )?PRIVATE KEY|xox[baprs]-[A-Za-z0-9-]{10,}/, severity: "critical", title: "Secret committed in source", detail: "Credentials live in the encrypted credentials table or the environment, never in the code.", suggestion: "Remove the value, rotate the credential, read it through loadEnv() or the gateway." },
  { re: /(?:console\.|logger\.|log\.)(?:log|info|debug|warn|error)\([^)]*\b(?:apiKey|api_key|password|secret|token|authorization)\b/i, severity: "critical", title: "Secret may be logged", detail: "Logging a key, password or other secret breaks the rule that secrets never reach the logs.", suggestion: "Log an identifier or a redacted fingerprint instead; the shared logger redacts known keys but not arbitrary strings." },
  { re: /\b(?:stripe\.(?:transfers|payouts)\.create|payouts?\.create|transfers?\.create|\.sign(?:Document|Contract)?\(|acceptTerms\(|grantConsent\()/, severity: "critical", title: "Agent code path moves money, signs or accepts terms", detail: "Moving money, signing and accepting terms are always the founder's; no code path owned by an agent may run them.", suggestion: "Hand the step to the founder as a task with exact instructions and the kit they need, instead of running it." },
  { re: /process\.env\./, unless: /packages\/shared\/src\/env\.ts|\.config\.|\.test\.|scripts\//, severity: "normal", title: "process.env read outside env.ts", detail: "Environment is parsed once with Zod in packages/shared/src/env.ts (ARCHITECTURE §3).", suggestion: "Use loadEnv() and add the variable to the Env schema." },
  { re: /:\s*any\b|\bas any\b|<any>/, unless: /\.test\./, severity: "normal", title: "Explicit any weakens the type contract", detail: "The product is typed end to end; any hides the shape other packages depend on.", suggestion: "Use unknown plus a Zod parse, or the exact SDK/shared type." },
  { re: /\.innerHTML\s*=|dangerouslySetInnerHTML/, severity: "normal", title: "Unescaped HTML rendering", detail: "Agent-written or third-party content must render through EntityLink / Markdown with sanitization.", suggestion: "Render through the design system's Markdown component." },
  { re: /\bconsole\.log\(/, unless: /scripts\/|\.test\./, severity: "low", title: "Debug logging left in", detail: "console.log is disallowed by the lint config outside scripts.", suggestion: "Remove it or use the structured logger at debug level." },
  { re: /\b(?:TODO|FIXME|XXX|HACK)\b/, severity: "low", title: "Unfinished placeholder left in the code", detail: "The spec gives enough to implement this; a stub marked for later does not meet the quality bar.", suggestion: "Implement it or open a task that says what counts as done." },
  { re: /catch\s*(?:\([^)]*\))?\s*\{\s*\}/, severity: "low", title: "Empty catch block", detail: "Swallowing errors hides failures from health monitoring.", suggestion: "Log at warn level with the error, or rethrow a typed error." },
  { re: /setTimeout\([^,]*,\s*\d{5,}\)/, severity: "low", title: "Long fixed timer", detail: "Long sleeps in services stall the worker; Temporal timers or the rate limiter should own waits.", suggestion: "Use a Temporal sleep in workflows or the RateLimiter in services." },
];

export function generateCodeReview(ctx: MockContext): CodeReviewOutput {
  const diff = ctx.getString("diff", "patch", "unified_diff", "changes") ?? nestedDiff(ctx) ?? (/^(?:diff --git|\+\+\+ b\/|@@ )/m.test(ctx.lastUser) ? ctx.lastUser : undefined);
  const added = diff ? parseDiff(diff) : (ctx.getString("code", "snippet", "file") ?? ctx.lastUser).split("\n").map((text, i) => ({ file: ctx.getString("filename", "path") ?? "snippet.ts", line: i + 1, text }));
  const files = new Set(added.map((a) => a.file));
  const findings: CodeReviewOutput["findings"] = [];
  const seen = new Set<string>();

  for (const a of added) {
    for (const rule of RULES) {
      if (rule.unless && rule.unless.test(a.file)) continue;
      if (!rule.re.test(a.text)) continue;
      const key = `${rule.title}:${a.file}:${a.line ?? "?"}`;
      if (seen.has(key)) continue;
      seen.add(key);
      findings.push({ severity: rule.severity, file: a.file, line: a.line, title: rule.title, detail: rule.detail, suggestion: rule.suggestion });
    }
  }

  const hasTests = [...files].some((f) => /\.(?:test|spec)\.[cm]?[jt]sx?$|__tests__\//.test(f));
  const sourceFiles = [...files].filter((f) => !/\.(?:md|json|yaml|yml|css|svg|lock)$/.test(f));
  if (!hasTests && added.length > 40 && sourceFiles.length > 0) {
    findings.push({
      severity: "normal",
      file: sourceFiles[0] as string,
      line: null,
      title: "No tests in a non-trivial change",
      detail: `${added.length} lines added across ${sourceFiles.length} source file${sourceFiles.length === 1 ? "" : "s"} with no test file touched. Definition of done requires tests that assert behavior.`,
      suggestion: "Add unit tests next to the module (and a Playwright spec if a screen changed).",
    });
  }

  const order: Record<Severity, number> = { critical: 0, normal: 1, low: 2 };
  findings.sort((x, y) => order[x.severity] - order[y.severity] || x.file.localeCompare(y.file) || (x.line ?? 0) - (y.line ?? 0));

  const critical = findings.filter((f) => f.severity === "critical").length;
  const normal = findings.filter((f) => f.severity === "normal").length;
  const verdict: CodeReviewOutput["verdict"] = critical > 0 || normal >= 3 ? "request_changes" : findings.length > 0 ? "comment" : "approve";
  const summary =
    verdict === "approve"
      ? `Reviewed ${files.size} file${files.size === 1 ? "" : "s"} (${added.length} added lines): no findings against the platform rules. Approve.`
      : `Reviewed ${files.size} file${files.size === 1 ? "" : "s"} (${added.length} added lines): ${critical} critical, ${normal} normal, ${findings.length - critical - normal} low. ${verdict === "request_changes" ? "Changes requested before merge." : "Comments only; safe to merge once addressed or acknowledged."}`;

  return { verdict, summary, findings };
}

function nestedDiff(ctx: MockContext): string | undefined {
  const pr = ctx.getRecord("pr", "pull_request", "change");
  const v = pr?.diff ?? pr?.patch;
  return typeof v === "string" ? v : undefined;
}

export function parseDiff(diff: string): AddedLine[] {
  const out: AddedLine[] = [];
  let file = "unknown";
  let newLine: number | null = null;
  for (const raw of diff.split("\n")) {
    const git = /^diff --git a\/(.+?) b\/(.+)$/.exec(raw);
    if (git) {
      file = git[2] as string;
      newLine = null;
      continue;
    }
    const plus = /^\+\+\+ (?:b\/)?(.+)$/.exec(raw);
    if (plus) {
      if ((plus[1] as string) !== "/dev/null") file = (plus[1] as string).trim();
      continue;
    }
    if (/^--- /.test(raw)) continue;
    const hunk = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(raw);
    if (hunk) {
      newLine = Number.parseInt(hunk[1] as string, 10);
      continue;
    }
    if (raw.startsWith("+")) {
      out.push({ file, line: newLine, text: raw.slice(1) });
      if (newLine !== null) newLine++;
    } else if (raw.startsWith("-")) {
      // removed line: new-file line number unchanged
    } else if (newLine !== null) {
      newLine++;
    }
  }
  return out;
}
