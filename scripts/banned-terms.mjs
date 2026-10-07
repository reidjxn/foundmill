#!/usr/bin/env node
// Two scans, both fail the build (exit 1) on a hit:
//
//  1. BRAND — product code never mentions Football Manager / Sports Interactive / SEGA (BUILD §2.4, §18).
//     Every line of every source file under apps, packages, evals, e2e.
//
//  2. VOCAB — football-only words never reach anything a user can read (CLAUDE.md "Product vocabulary",
//     docs/DECISIONS.md 2026-10-07 "Vocabulary: no football terms that cannot also be said of AI agents").
//     Scope: string literals, template literals and JSX text in apps/web, packages/dugout, packages/widgets,
//     packages/modules, packages/agents/src/{prompts,templates}, apps/composer (plus .md/.mdx there), and the prose
//     of docs/DESIGN.md and docs/ARCHITECTURE.md. Identifiers are not scanned: import paths, object keys, enum
//     members, literal types, CSS custom properties, class-name strings, data-* / className / id / href attributes,
//     console/log arguments, and any single token that looks like an identifier (snake_case, kebab-case, camelCase,
//     paths, lowercase words such as enum values). Tests, e2e specs and stories' test fixtures are excluded by path.
//     A source line (or the line above it) containing `vocab-allow` is skipped: use it for a sentence that names a
//     banned word on purpose (for example a glossary entry that says what replaced it), never to hide copy.
//
// Usage:
//   node scripts/banned-terms.mjs                          both scans, report file:line:term, exit 1 on hits
//   node scripts/banned-terms.mjs --vocab packages/dugout  vocab scan limited to the given roots (any number)
//   node scripts/banned-terms.mjs --brand-only             brand scan only
//   node scripts/banned-terms.mjs --sweep docs/VOCAB_SWEEP.md   also write the vocab hits grouped by package
//   node scripts/banned-terms.mjs --json hits.json         also write every hit as JSON
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, extname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const ts = require("typescript");

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SKIP_DIRS = new Set([
  "node_modules",
  ".next",
  "dist",
  "storybook-static",
  "coverage",
  ".turbo",
  "test-results",
  "playwright-report",
  ".pglite",
]);

// ---------------------------------------------------------------------------------------------------------------
// 1. Brand scan (unchanged behaviour)
// ---------------------------------------------------------------------------------------------------------------
const BRAND_ROOTS = ["apps", "packages", "evals", "e2e"];
const BRAND_BANNED = [
  /football\s*manager/i,
  /sports\s*interactive/i,
  /\bSEGA\b/,
  /\bFM2[0-9]\b/,
  /\bFM\s?21\b/,
];
const BRAND_EXT = /\.(tsx?|jsx?|mjs|cjs|css|md|json|cedar|sql|html)$/;

function brandScan() {
  const hits = [];
  function walk(dir) {
    for (const name of readdirSync(dir)) {
      if (SKIP_DIRS.has(name)) continue;
      const p = join(dir, name);
      const st = statSync(p);
      if (st.isDirectory()) walk(p);
      else if (BRAND_EXT.test(name)) {
        const text = readFileSync(p, "utf8");
        text.split("\n").forEach((line, i) => {
          for (const re of BRAND_BANNED) {
            if (re.test(line))
              hits.push({
                scan: "brand",
                file: rel(p),
                line: i + 1,
                term: re.source,
                snippet: line.trim().slice(0, 120),
              });
          }
        });
      }
    }
  }
  for (const r of BRAND_ROOTS) {
    const abs = join(REPO_ROOT, r);
    if (existsSync(abs)) walk(abs);
  }
  return hits;
}

// ---------------------------------------------------------------------------------------------------------------
// 2. Vocabulary scan
// ---------------------------------------------------------------------------------------------------------------
const VOCAB_CODE_ROOTS = [
  "apps/web",
  "packages/dugout",
  "packages/widgets",
  "packages/modules",
  "packages/agents/src/prompts",
  "packages/agents/src/templates",
  "apps/composer",
];
const VOCAB_DOC_FILES = ["docs/DESIGN.md", "docs/ARCHITECTURE.md"];
// Developer-facing or historical documents that quote the old words on purpose.
const VOCAB_SKIP_FILES =
  /^(CLAUDE\.md|BUILD\.md|BUILD_RUNBOOK\.md|DECISIONS\.md|PROGRESS\.md|NEEDED_DEPS\.md|VOCAB_SWEEP\.md|WAVE\d+_REPORTS\.md)$/;
const TEST_PATH =
  /(^|\/)(__tests__|e2e|test|tests|__fixtures__|__mocks__)(\/|$)|\.(test|spec)\.[cm]?[jt]sx?$|\.d\.ts$/;
const CODE_EXT = /\.(tsx?|jsx?|mjs|cjs|mts|cts)$/;
const PROSE_EXT = /\.(md|mdx)$/;
const ALLOW_MARKER = /vocab-allow/;

/**
 * Each term: a display name, the regex (global, case-insensitive) and `allow` regexes. A match is ignored when an
 * allow regex matches a span that contains it (the employment sense of "full-time", "holiday season", ...).
 */
const EMPLOYMENT_NOUN =
  "(?:employee|employees|employment|staff|hire|hires|hiring|job|jobs|role|roles|work|worker|workers|position|positions|contract|contracts|contractor|contractors|equivalent|equivalents|basis|founder|founders|co-?founder|co-?founders|member|members|team|salary|salaried|salaries|engineer|engineers|developer|developers|designer|designers|headcount|people|person|CEO|CTO|hours|schedule|commitment|pay|wage|wages|income|employ|employed)";
const VOCAB_TERMS = [
  { term: "Match Day", re: /\bmatch[\s-]?days?\b/gi },
  { term: "kick-off", re: /\bkick[\s-]?offs?\b/gi },
  { term: "team sheet", re: /\bteam[\s-]?sheets?\b/gi },
  {
    term: "full time",
    re: /\bfull[\s-]?time\b/gi,
    allow: [
      new RegExp(`\\bfull[\\s-]?time\\s+${EMPLOYMENT_NOUN}\\b`, "gi"),
      /\b(?:part[\s-]?time\s*(?:or|and|\/|,|to)\s*full[\s-]?time|full[\s-]?time\s*(?:or|and|\/|,|to)\s*part[\s-]?time)\b/gi,
      /\b(?:work(?:s|ing|ed)?|go(?:es|ing)?|went|gone|join(?:s|ed|ing)?|commit(?:s|ted|ting)?|employed|hired|hire|stay(?:s|ing|ed)?|be|is|are|was|were|become|became|becoming|on it|focus(?:ed|ing)?|focuses|quit|left|leave|leaving)\s+(?:(?:on|to)\s+(?:it|this|the\s+business)\s+)?full[\s-]?time\b/gi,
    ],
    // The employment sense is often a bare label ("Full time") whose meaning sits in the surrounding line.
    allowContext: [
      /\b(?:hours?|per\s+week|a\s+week|weekly|part[\s-]?time|employment|employee|FTE|salary|salaried|payroll|availability|commitment|time_commitment|hoursPerWeek)\b/i,
    ],
  },
  { term: "player of the match", re: /\bplayer of the match\b/gi },
  { term: "goal moment", re: /\bgoal[\s-]?moments?\b/gi },
  { term: "half-time", re: /\bhalf[\s-]?time\b/gi },
  {
    term: "pitch (the board)",
    re: /\bthe\s+pitch\b|\bpitch\s+(?:markings|lines|side|map|view|layout|board|graphic|surface|stripes)\b/gi,
    allow: [
      /\bthe\s+pitch\s+(?:deck|decks|meeting|email|call|session|competition|contest|event|day|night|itself\s+to|to\s+(?:investors|customers|buyers|a\b|an\b|the\b|your\b|our\b)|for\s+(?:investors|customers|funding|money|the\s+round))/gi,
      /\bthe\s+pitch\s+(?:holds|held|lands|landed|works|worked|resonat\w+|convinc\w+|wins|won|fails|failed|fell|falls|flopped|needs|needed|was|is|went|goes)\b/gi, // a sales pitch doing something
      /\b(?:elevator|sales|investor|business|product|startup|funding|cold|outreach|email|phone)\s+pitch\b/gi,
    ],
    allowContext: [
      /\b(?:deck|investor|investors|buyer|buyers|buying|sales|prospect|prospects|procurement|demo|objection|objections|retailer|retailers)\b/i,
    ],
  },
  { term: "trophy", re: /\btroph(?:y|ies)\b/gi },
  { term: "league table", re: /\bleague\s+tables?\b/gi },
  {
    term: "injured / injury",
    re: /\binjur(?:ed|y|ies)\b/gi,
    allow: [
      /\b(?:personal|bodily|workplace|work-related|physical|serious)\s+injur(?:y|ies)\b/gi,
      /\binjur(?:y|ies)\s+(?:claims?|lawsuits?|liability|insurance|compensation|law)\b/gi,
    ],
    allowContext: [
      /\b(?:insurance|insurer|liability|indemnif\w+|negligence|tort|lawsuit|claimant|policyholder)\b/i,
    ],
  },
  { term: "kit colours / kit mode / kit bar", re: /\bkit[\s-](?:colou?rs?|mode|bar)\b/gi },
  {
    term: "season",
    re: /\bseasons?\b/gi,
    allow: [
      /\b(?:holiday|holidays|tax|peak|busy|slow|quiet|low|high|off|shopping|sales|festive|wedding|summer|winter|spring|autumn|fall|growing|harvest|tourist|christmas|back-to-school|gift|gifting|hiring|budget|budgeting|conference|fundraising|planting|flu|allergy|rainy|dry|monsoon|ski|beach|cruise|travel|graduation|prom|school|exam|election|awards)[\s-]+seasons?\b/gi,
      /\bseasons?\s+(?:of\s+the\s+year|of\s+giving)\b/gi,
    ],
  },
];

// JSX attributes / object keys whose values are not read by users.
const STRUCTURAL_NAMES = new Set([
  "className",
  "class",
  "id",
  "key",
  "href",
  "src",
  "srcSet",
  "to",
  "htmlFor",
  "for",
  "role",
  "type",
  "name",
  "rel",
  "target",
  "style",
  "variant",
  "size",
  "tone",
  "align",
  "as",
  "slot",
  "lang",
  "dir",
  "method",
  "action",
  "autoComplete",
  "inputMode",
  "testId",
  "testid",
  "icon",
  "component",
  "path",
  "route",
  "url",
  "pathname",
  "query",
  "param",
  "params",
  "slug",
  "kind",
  "status",
  "state",
  "mode",
  "level",
  "stage",
  "phase",
  "sort",
  "sortBy",
  "orderBy",
  "field",
  "column",
  "columnId",
  "accessor",
  "accessorKey",
  "channel",
  "event",
  "eventType",
  "topic",
  "model",
  "modelId",
  "scope",
  "permission",
  "tool",
  "tools",
  "fill",
  "stroke",
  "d",
  "viewBox",
  "points",
  "transform",
  "clipPath",
  "mask",
  "filter",
  "font",
  "fontFamily",
  "cursor",
  "pointerEvents",
  "display",
  "position",
  "overflow",
  "gridArea",
  "gridColumn",
  "gridRow",
  "zIndex",
  "color",
  "background",
  "backgroundColor",
  "borderColor",
  "format",
  "locale",
  "currency",
  "unit",
  "pattern",
  "regex",
  "selector",
  "tag",
  "tagName",
  "dataKey",
]);
// JSX attributes / object keys whose values are prose even when they are a single word.
const PROSE_NAMES = new Set([
  "title",
  "label",
  "description",
  "placeholder",
  "alt",
  "aria-label",
  "aria-description",
  "aria-roledescription",
  "aria-valuetext",
  "hint",
  "help",
  "helpText",
  "helperText",
  "tooltip",
  "heading",
  "subheading",
  "subtitle",
  "caption",
  "emptyText",
  "emptyTitle",
  "emptyDescription",
  "emptyMessage",
  "message",
  "text",
  "content",
  "summary",
  "body",
  "copy",
  "headline",
  "lead",
  "detail",
  "details",
  "prompt",
  "question",
  "answer",
  "reason",
  "note",
  "notes",
  "cta",
  "ctaLabel",
  "buttonLabel",
  "confirmLabel",
  "cancelLabel",
  "okLabel",
  "successMessage",
  "errorMessage",
  "warning",
  "explanation",
  "displayName",
  "shortLabel",
  "longLabel",
  "legend",
  "unitLabel",
  "footer",
  "header",
  "kicker",
  "eyebrow",
  "tagline",
]);
const CLASS_UTILS = new Set([
  "cn",
  "clsx",
  "classnames",
  "classNames",
  "cva",
  "tv",
  "twMerge",
  "twJoin",
  "cx",
]);
const LOG_OBJECTS = new Set(["console", "log", "logger", "debug"]);
const LOG_METHODS = new Set([
  "debug",
  "trace",
  "info",
  "warn",
  "error",
  "log",
  "fatal",
  "silly",
  "verbose",
]);

function rel(p) {
  return relative(REPO_ROOT, p).split(sep).join("/");
}

/** A single token that is an identifier, path, selector, enum value or constant rather than copy. */
function looksLikeIdentifier(raw) {
  const t = raw.trim();
  if (!t) return true;
  if (/\s/.test(t)) return false; // whitespace → a phrase: scan it
  if (/^[A-Z][a-z]+(?:-[a-z]+)*[.!?:…]?$/.test(t)) return false; // "Trophies", "Injured", "Kick-off", "Season.": a label
  return true; // snake_case, kebab-case, camelCase, PascalCase, paths, urls, selectors, lowercase enum values, CONSTANTS
}

/** "flex items-center gap-2 kit-bar": a utility-class list (at least half the tokens carry - : / or [), not copy. */
function looksLikeClassList(raw) {
  const tokens = raw.trim().split(/\s+/).filter(Boolean);
  if (tokens.length < 2) return false;
  if (!tokens.every((t) => /^[a-z0-9:[\]()/.%#!*&>~_-]+$/.test(t))) return false;
  const utility = tokens.filter((t) => /[-:/[]/.test(t)).length;
  return utility * 2 >= tokens.length;
}

/** "MatchdayStage" → "Matchday Stage" so Storybook titles and PascalCase display names are read as words. */
function splitWords(s) {
  return s.replace(/([a-z0-9])([A-Z])/g, "$1 $2").replace(/[/_.-]+/g, " ");
}

/** Term matches in `text` that no `allow` span covers; `allowContext` is left for the caller, who knows the source line. */
function findTermHits(text) {
  const out = [];
  for (const { term, re, allow = [], allowContext = [] } of VOCAB_TERMS) {
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(text))) {
      const start = m.index;
      const end = start + m[0].length;
      let allowed = false;
      for (const a of allow) {
        a.lastIndex = 0;
        let am;
        while ((am = a.exec(text))) {
          if (am.index <= start && am.index + am[0].length >= end) {
            allowed = true;
            break;
          }
          if (am[0].length === 0) a.lastIndex++;
        }
        if (allowed) break;
      }
      if (!allowed) out.push({ term, start, end, match: m[0], allowContext });
      if (m[0].length === 0) re.lastIndex++;
    }
  }
  return out;
}

function lineHasAllowMarker(lines, lineIdx) {
  return ALLOW_MARKER.test(lines[lineIdx] ?? "") || ALLOW_MARKER.test(lines[lineIdx - 1] ?? "");
}

/** The source line (and its neighbours) carries a word that fixes the non-football sense of the term. */
function contextAllows(hit, lines, lineIdx) {
  if (!hit.allowContext.length) return false;
  const context = `${lines[lineIdx - 1] ?? ""}\n${lines[lineIdx] ?? ""}\n${lines[lineIdx + 1] ?? ""}`;
  return hit.allowContext.some((re) => re.test(context));
}

// ----- code files (TypeScript compiler API) -----

function scriptKindFor(file) {
  const ext = extname(file);
  if (ext === ".tsx") return ts.ScriptKind.TSX;
  if (ext === ".jsx") return ts.ScriptKind.JSX;
  if (ext === ".js" || ext === ".mjs" || ext === ".cjs") return ts.ScriptKind.JS;
  return ts.ScriptKind.TS;
}

function nameText(nameNode) {
  if (!nameNode) return "";
  if (ts.isIdentifier(nameNode) || ts.isPrivateIdentifier(nameNode)) return nameNode.text;
  if (
    ts.isStringLiteral(nameNode) ||
    ts.isNumericLiteral(nameNode) ||
    ts.isNoSubstitutionTemplateLiteral(nameNode)
  )
    return nameNode.text;
  if (ts.isJsxNamespacedName(nameNode)) return `${nameNode.namespace.text}:${nameNode.name.text}`;
  return "";
}

function calleeIsClassUtil(call) {
  const e = call.expression;
  if (ts.isIdentifier(e)) return CLASS_UTILS.has(e.text);
  if (ts.isPropertyAccessExpression(e)) return CLASS_UTILS.has(e.name.text);
  return false;
}

function calleeIsLogger(call) {
  const e = call.expression;
  if (!ts.isPropertyAccessExpression(e)) return false;
  const obj = e.expression;
  const objName = ts.isIdentifier(obj)
    ? obj.text
    : ts.isPropertyAccessExpression(obj)
      ? obj.name.text
      : "";
  return LOG_OBJECTS.has(objName) && LOG_METHODS.has(e.name.text);
}

/**
 * Classify a string-ish node: "skip" (identifier context), "prose" (always copy) or "maybe" (apply the token test).
 * Walks up through parentheses, `as`/`satisfies`, conditionals, binary `+`/`??`/`||`, arrays and template spans so a
 * string that ends up in a prose slot is treated as prose and one inside cn()/className is skipped.
 */
function classify(node, file) {
  const isStory = /\.stories\.[jt]sx?$/.test(file);
  let child = node;
  let parent = node.parent;
  let verdict = "maybe";
  while (parent) {
    if (
      ts.isImportDeclaration(parent) ||
      ts.isExportDeclaration(parent) ||
      ts.isExternalModuleReference(parent) ||
      ts.isImportTypeNode(parent)
    )
      return "skip";
    if (ts.isCallExpression(parent)) {
      const e = parent.expression;
      if (e.kind === ts.SyntaxKind.ImportKeyword || (ts.isIdentifier(e) && e.text === "require"))
        return "skip";
      if (calleeIsClassUtil(parent) || calleeIsLogger(parent)) return "skip";
    }
    if (ts.isLiteralTypeNode(parent) || ts.isTypeNode(parent)) return "skip";
    if (ts.isEnumMember(parent)) return "skip";
    if (ts.isElementAccessExpression(parent) && parent.argumentExpression === child) return "skip";
    if (ts.isComputedPropertyName(parent)) return "skip";
    if (
      (ts.isPropertyAssignment(parent) ||
        ts.isPropertySignature(parent) ||
        ts.isPropertyDeclaration(parent) ||
        ts.isMethodDeclaration(parent) ||
        ts.isMethodSignature(parent) ||
        ts.isGetAccessor(parent) ||
        ts.isSetAccessor(parent) ||
        ts.isEnumMember(parent)) &&
      parent.name === child
    )
      return "skip";
    if (ts.isPropertyAssignment(parent) && parent.initializer === child) {
      const key = nameText(parent.name);
      if (STRUCTURAL_NAMES.has(key)) return "skip";
      if (PROSE_NAMES.has(key)) return isStory && key === "title" ? "story-title" : "prose";
      return verdict;
    }
    if (ts.isJsxAttribute(parent)) {
      const key = nameText(parent.name);
      if (key.startsWith("data-") || STRUCTURAL_NAMES.has(key)) return "skip";
      if (
        /^aria-(?:describedby|labelledby|controls|owns|activedescendant|flowto|details|errormessage)$/.test(
          key,
        )
      )
        return "skip";
      if (PROSE_NAMES.has(key)) return "prose";
      return verdict;
    }
    if (
      ts.isJsxExpression(parent) &&
      parent.parent &&
      (ts.isJsxElement(parent.parent) || ts.isJsxFragment(parent.parent))
    ) {
      // {"Injured"} is copy; {`/b/${id}/trophies`} is a path, so templates still get the token test.
      return ts.isTemplateExpression(node) || ts.isNoSubstitutionTemplateLiteral(node)
        ? verdict
        : "prose";
    }
    if (ts.isJsxElement(parent) || ts.isJsxFragment(parent)) return "prose";
    if (ts.isTemplateSpan(parent) || ts.isTemplateExpression(parent)) return verdict; // an expression inside `${}`: decide by content
    const passThrough =
      ts.isParenthesizedExpression(parent) ||
      ts.isAsExpression(parent) ||
      ts.isSatisfiesExpression(parent) ||
      ts.isConditionalExpression(parent) ||
      ts.isArrayLiteralExpression(parent) ||
      ts.isSpreadElement(parent) ||
      ts.isNonNullExpression(parent) ||
      ts.isJsxExpression(parent) ||
      (ts.isBinaryExpression(parent) &&
        [
          ts.SyntaxKind.PlusToken,
          ts.SyntaxKind.QuestionQuestionToken,
          ts.SyntaxKind.BarBarToken,
          ts.SyntaxKind.AmpersandAmpersandToken,
        ].includes(parent.operatorToken.kind));
    if (ts.isBinaryExpression(parent) && !passThrough) return "skip"; // `status === "injured"`, `x !== "match_day"`
    if (ts.isCaseClause(parent) && parent.expression === child) return "skip";
    if (!passThrough) {
      // Variable initialisers, return values, call arguments, object literals inside arrays, etc.: decide by content.
      if (ts.isCallExpression(parent) || ts.isNewExpression(parent)) return verdict;
      if (ts.isObjectLiteralExpression(parent)) {
        child = parent;
        parent = parent.parent;
        continue;
      }
      return verdict;
    }
    child = parent;
    parent = parent.parent;
  }
  return verdict;
}

/** Literal pieces of a string-ish node as { text, pos } in source coordinates (raw text, escapes untouched). */
function piecesOf(node, sf) {
  const raw = node.getText(sf);
  const start = node.getStart(sf);
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node))
    return [{ text: raw.slice(1, -1), pos: start + 1 }];
  if (ts.isJsxText(node)) return [{ text: raw, pos: start }];
  if (ts.isTemplateExpression(node)) {
    const out = [];
    const head = node.head.getText(sf);
    out.push({ text: head.slice(1, -2), pos: node.head.getStart(sf) + 1 });
    for (const span of node.templateSpans) {
      const lit = span.literal.getText(sf);
      const isTail = ts.isTemplateTail(span.literal);
      out.push({ text: lit.slice(1, isTail ? -1 : -2), pos: span.literal.getStart(sf) + 1 });
    }
    return out;
  }
  return [];
}

function scanCodeFile(abs, hits) {
  const text = readFileSync(abs, "utf8");
  const file = rel(abs);
  const lines = text.split("\n");
  const sf = ts.createSourceFile(abs, text, ts.ScriptTarget.Latest, true, scriptKindFor(abs));
  const seen = new Set();

  function record(piece, offset, hit) {
    const { line } = sf.getLineAndCharacterOfPosition(piece.pos + offset);
    if (lineHasAllowMarker(lines, line) || contextAllows(hit, lines, line)) return;
    const key = `${line}:${hit.term}:${offset}`;
    if (seen.has(key)) return;
    seen.add(key);
    hits.push({
      scan: "vocab",
      file,
      line: line + 1,
      term: hit.term,
      match: hit.match,
      snippet: (lines[line] ?? "").trim().slice(0, 140),
    });
  }

  function check(node) {
    const verdict = classify(node, file);
    if (verdict === "skip") return;
    const pieces = piecesOf(node, sf);
    if (pieces.length === 0) return;
    if (ts.isJsxText(node) && node.containsOnlyTriviaWhiteSpaces) return;
    if (verdict === "maybe") {
      // Placeholders joined as a neutral word so `${n} trophies` reads as a phrase and `/b/${id}/trophies` as a path.
      const joined = pieces.map((p) => p.text).join("X");
      if (looksLikeIdentifier(joined) || looksLikeClassList(joined)) return;
    }
    for (const piece of pieces) {
      const haystack = verdict === "story-title" ? splitWords(piece.text) : piece.text;
      for (const h of findTermHits(haystack)) {
        // splitWords only inserts/replaces characters one for one except camel splits; the line is still right.
        const offset = verdict === "story-title" ? 0 : h.start;
        record(piece, offset, h);
      }
    }
  }

  function visit(node) {
    if (
      ts.isStringLiteral(node) ||
      ts.isNoSubstitutionTemplateLiteral(node) ||
      ts.isTemplateExpression(node) ||
      ts.isJsxText(node)
    ) {
      check(node);
      if (ts.isTemplateExpression(node)) node.templateSpans.forEach((s) => visit(s.expression));
      return;
    }
    ts.forEachChild(node, visit);
  }
  visit(sf);
}

// ----- prose files (Markdown / MDX) -----

function scanProseFile(abs, hits) {
  const text = readFileSync(abs, "utf8");
  const file = rel(abs);
  const lines = text.split("\n");
  let inFence = false;
  lines.forEach((line, i) => {
    const fence = /^\s*(```|~~~)/.test(line);
    if (fence) {
      inFence = !inFence;
      return;
    }
    if (inFence) return;
    if (/^\s*(import|export)\s.*from\s+["']/.test(line)) return; // MDX imports
    if (lineHasAllowMarker(lines, i)) return;
    const prose = line
      .replace(/`[^`]*`/g, " ") // inline code: identifiers, tokens, routes
      .replace(/\]\([^)]*\)/g, "]") // link and image targets
      .replace(/<!--[\s\S]*?-->/g, " ")
      .replace(/<\/?[A-Za-z][^>]*>/g, " "); // raw HTML / MDX tags (their attributes are not prose)
    for (const h of findTermHits(prose)) {
      if (contextAllows(h, lines, i)) continue;
      hits.push({
        scan: "vocab",
        file,
        line: i + 1,
        term: h.term,
        match: h.match,
        snippet: line.trim().slice(0, 140),
      });
    }
  });
}

function vocabScan(roots) {
  const hits = [];
  const docFiles = new Set(VOCAB_DOC_FILES.map((f) => join(REPO_ROOT, f)));
  function walk(dir) {
    for (const name of readdirSync(dir)) {
      if (SKIP_DIRS.has(name)) continue;
      const p = join(dir, name);
      const st = statSync(p);
      if (st.isDirectory()) {
        if (!TEST_PATH.test(`${rel(p)}/`)) walk(p);
        continue;
      }
      scanFile(p);
    }
  }
  function scanFile(p) {
    const r = rel(p);
    const base = r.split("/").pop();
    if (VOCAB_SKIP_FILES.test(base)) return;
    if (CODE_EXT.test(base)) {
      if (TEST_PATH.test(r)) return;
      scanCodeFile(p, hits);
    } else if (PROSE_EXT.test(base)) {
      scanProseFile(p, hits);
    }
  }
  for (const r of roots) {
    const abs = resolve(REPO_ROOT, r);
    if (!existsSync(abs)) continue;
    if (statSync(abs).isDirectory()) walk(abs);
    else scanFile(abs);
  }
  if (roots === VOCAB_CODE_ROOTS)
    for (const f of docFiles) if (existsSync(f)) scanProseFile(f, hits);
  return hits;
}

// ---------------------------------------------------------------------------------------------------------------
// Reporting
// ---------------------------------------------------------------------------------------------------------------
function packageOf(file) {
  const parts = file.split("/");
  if (parts[0] === "apps" || parts[0] === "packages") return `${parts[0]}/${parts[1]}`;
  return parts[0];
}

function writeSweep(path, hits, roots) {
  const byPkg = new Map();
  for (const h of hits) {
    if (!byPkg.has(packageOf(h.file))) byPkg.set(packageOf(h.file), []);
    byPkg.get(packageOf(h.file)).push(h);
  }
  const termCounts = new Map();
  for (const h of hits) termCounts.set(h.term, (termCounts.get(h.term) ?? 0) + 1);
  const date = new Date().toISOString().slice(0, 10);
  const out = [];
  out.push("# Vocabulary sweep — football-only terms still in user-facing text");
  out.push("");
  out.push(
    `Generated ${date} by \`node scripts/banned-terms.mjs --sweep docs/VOCAB_SWEEP.md\` (CLAUDE.md "Product vocabulary"). ` +
      "This file is regenerated, not edited: fix the copy in the package, rerun the script, and the row disappears. " +
      "Every hit is a string literal, template literal, JSX text or doc sentence a user can read; identifiers, enum keys, CSS tokens, import paths, class names, tests and fixtures are not scanned.",
  );
  out.push("");
  out.push(
    `Scope: ${roots.join(", ")}${roots === VOCAB_CODE_ROOTS ? `, ${VOCAB_DOC_FILES.join(", ")}` : ""}.`,
  );
  out.push("");
  out.push(
    `**${hits.length} hit(s) in ${byPkg.size} package(s).** CI (\`banned-terms\` job) fails while this number is above zero.`,
  );
  out.push("");
  const replacement = {
    "Match Day": "Customer Update (the event is a win)",
    "kick-off": "First touch",
    "team sheet": "Who was involved",
    "full time": "Debrief",
    "player of the match": "Standout agent",
    "goal moment": "Win moment",
    "half-time": "(drop; describe the moment)",
    "pitch (the board)": "Board",
    trophy: "Milestone(s)",
    "league table": "Leaderboard",
    "injured / injury": 'Down (with "expected back")',
    "kit colours / kit mode / kit bar": "Brand colours / offline tracking / top bar",
    season: "Chapter",
  };
  out.push(
    ...mdTable(
      ["Term", "Replace with", "Hits"],
      VOCAB_TERMS.map((t) => [
        t.term,
        replacement[t.term] ?? "",
        String(termCounts.get(t.term) ?? 0),
      ]),
    ),
  );
  out.push("");
  for (const [pkg, list] of [...byPkg.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    out.push(`## ${pkg} (${list.length})`);
    out.push("");
    const rows = list
      .sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line)
      .map((h) => [
        `\`${h.file}:${h.line}\``,
        h.term,
        h.snippet.replace(/\|/g, "\\|").replace(/`/g, "'"),
      ]);
    out.push(...mdTable(["File:line", "Term", "Text"], rows));
    out.push("");
  }
  out.push("## How to read a hit");
  out.push("");
  out.push("- `file:line:term` is printed by the script; the table above adds the source line.");
  out.push(
    "- Internal identifiers (`matchday_level`, `--kit-primary`, `team_sheet`, `routes.trophies`) are never hits; only the display label beside them is.",
  );
  out.push(
    "- A sentence that must name an old word on purpose (a glossary entry, a redirect notice) gets `vocab-allow` in a comment on the same or the previous line. Do not use it to hide copy.",
  );
  out.push(
    '- The employment sense of "full-time" ("full-time employee", "went full-time", a label on a line that mentions hours or part-time), business seasons ("holiday season", "tax season"), "seasonality", "elevator pitch" / "pitch deck" / "the pitch holds" and "personal injury" are allowed by the scanner.',
  );
  out.push(
    "- Storybook `title:` values are read as words (`Shell/KitBar` reads as Kit Bar), because CLAUDE.md counts Storybook titles as user-facing; the component identifier itself may keep its name.",
  );
  out.push(
    "- Agent prompts and templates count: what an agent is told to say, it says. A template that still says kit mode produces agent prose that says kit mode.",
  );
  out.push("");
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, out.join("\n"));
}

/** A GitHub-flavoured table padded the way Prettier formats it, so the generated file passes `format:check`. */
function mdTable(header, rows) {
  const all = [header, ...rows];
  const widths = header.map((_, i) => Math.max(3, ...all.map((r) => [...r[i]].length)));
  const line = (cells) =>
    `| ${cells.map((c, i) => c + " ".repeat(widths[i] - [...c].length)).join(" | ")} |`;
  return [line(header), `| ${widths.map((w) => "-".repeat(w)).join(" | ")} |`, ...rows.map(line)];
}

function main(argv) {
  const args = [...argv];
  let brandOnly = false;
  let vocabOnly = false;
  let sweepPath = null;
  let jsonPath = null;
  const roots = [];
  while (args.length) {
    const a = args.shift();
    if (a === "--brand-only") brandOnly = true;
    else if (a === "--vocab" || a === "--vocab-only") vocabOnly = true;
    else if (a === "--sweep") sweepPath = resolve(REPO_ROOT, args.shift() ?? "docs/VOCAB_SWEEP.md");
    else if (a === "--json") jsonPath = resolve(REPO_ROOT, args.shift() ?? "banned-terms.json");
    else if (a.startsWith("-")) {
      console.error(`unknown flag ${a}`);
      process.exit(2);
    } else roots.push(a);
  }
  const vocabRoots = roots.length ? roots : VOCAB_CODE_ROOTS;
  const brandHits = vocabOnly ? [] : brandScan();
  const vocabHits = brandOnly ? [] : vocabScan(vocabRoots);

  const print = (line) => process.stdout.write(`${line}\n`);
  for (const h of brandHits) print(`${h.file}:${h.line}: brand: ${h.snippet}`);
  for (const h of vocabHits) print(`${h.file}:${h.line}:${h.term}: ${h.snippet}`);

  if (sweepPath) {
    writeSweep(sweepPath, vocabHits, vocabRoots);
    print(`\nSweep written to ${rel(sweepPath)}`);
  }
  if (jsonPath)
    writeFileSync(jsonPath, JSON.stringify({ brand: brandHits, vocab: vocabHits }, null, 2));

  const total = brandHits.length + vocabHits.length;
  if (total) {
    const byPkg = new Map();
    for (const h of vocabHits)
      byPkg.set(packageOf(h.file), (byPkg.get(packageOf(h.file)) ?? 0) + 1);
    const summary = [...byPkg.entries()].map(([p, n]) => `${p} ${n}`).join(", ");
    console.error(
      `\n${brandHits.length} brand hit(s), ${vocabHits.length} vocabulary hit(s)${summary ? ` (${summary})` : ""}.`,
    );
    process.exit(1);
  }
  print(
    brandOnly
      ? "No banned terms found."
      : vocabOnly
        ? "No football-only vocabulary in user-facing text."
        : "No banned terms found; no football-only vocabulary in user-facing text.",
  );
}

export {
  brandScan,
  vocabScan,
  scanCodeFile,
  scanProseFile,
  findTermHits,
  looksLikeIdentifier,
  looksLikeClassList,
  VOCAB_TERMS,
  VOCAB_CODE_ROOTS,
  VOCAB_DOC_FILES,
  writeSweep,
};

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  main(process.argv.slice(2));
