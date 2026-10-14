#!/usr/bin/env node
// US English guard (founder, 2026-10-10: "switch the whole product to US English and US dates"). Fails the build
// (exit 1, file:line per hit) on:
//
//  1. SPELLING: a British spelling in text a person reads. Same user-facing scope and the same idea of "user-facing"
//     as scripts/banned-terms.mjs (its VOCAB_CODE_ROOTS and VOCAB_DOC_FILES), plus the agent prose, seed copy and
//     service messages that the banned-terms scan does not cover (EXTRA_ROOTS). Only string literals, template
//     literals and JSX text in prose positions are read; identifiers are never hits: object keys, enum members,
//     literal types, CSS custom properties (`--kit-primary`), class names, data-* / id / href attributes, logger
//     arguments, single tokens that look like identifiers (`cancelled`, `brand_colours`, `deptColourToken`). The list
//     is curated (FAMILIES below: -our, -ise/-isation, -yse, -re, -ogue, doubled -l-, single words such as licence,
//     whilst and learnt, and the founder's product words: Vacation, Payroll) and every entry is matched on word
//     boundaries, so camelCase and snake_case identifiers that embed a British stem never match.
//  2. DATES: day-first dates and 24-hour clock times in that same text ("7 Oct", "Wed 7 Oct", "21st October",
//     "14:30"), and, anywhere in product code (every string literal under apps/ and packages/, user-facing or not),
//     en-GB locales and day-first or 24-hour date-fns patterns ("d MMM yyyy", "EEE d MMM", "HH:mm"). US dates read
//     "Oct 7, 2026", "Wed, Oct 7", "3:45 PM".
//
// Business facts stay: a UK business keeps GBP, VAT and "Ltd", and a proper noun keeps its own spelling (ALLOW).
// A line (or the line above it) carrying `us-english-allow` is skipped: for a sentence that quotes a British form on
// purpose (a glossary entry, an enum key quoted in a prompt example), never to hide copy. Tests, e2e specs, `__fixtures__` (connector mock fixtures are scanned: they are mock outputs people read),
// test helpers (`testing/`) and .d.ts files are excluded by path, as in banned-terms.
//
// The opt-in date formats (founder, 2026-10-11: a signed-in person may choose day-first or ISO dates and a 24-hour
// clock in Settings › Preferences) are spelled in one place: the preference mapping, DATE_PREFERENCE_FILE. Between its
// `us-english-date-preferences: begin` and `... end` markers, and nowhere else, day-first and 24-hour date-fns patterns
// are allowed; spelling and dates written in text are still read there. The marker in any other file, or a block left
// open, is itself a hit, so the allowance cannot spread.
//
// Usage:
//   node scripts/us-english.mjs                    full scan, file:line:kind per hit, exit 1 on hits
//   node scripts/us-english.mjs apps/web docs/X.md  spelling + date scan limited to the given roots (files or dirs)
//   node scripts/us-english.mjs --fix apps/api      rewrite spelling hits in place (dates and locales are reported only)
//   node scripts/us-english.mjs --json hits.json    also write every hit as JSON
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, extname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

import { VOCAB_CODE_ROOTS, VOCAB_DOC_FILES, looksLikeClassList, looksLikeIdentifier } from "./banned-terms.mjs";

const require = createRequire(import.meta.url);
const ts = require("typescript");

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SKIP_DIRS = new Set(["node_modules", ".next", "dist", "storybook-static", "coverage", ".turbo", "test-results", "playwright-report", ".pglite"]);

/** User-facing text the banned-terms scan does not read: agent prose and skills, house rules, seed copy, service messages, evals. */
const EXTRA_ROOTS = [
  "packages/agents/src",
  "packages/db/src/seed",
  "apps/api/src",
  "apps/orchestrator/src",
  "apps/gateway/src",
  "apps/stream/src",
  "apps/ingest/src",
  // Connector tool descriptions and errors reach the Tools tab and agent logs; event docs describe what the founder did.
  "packages/connectors/src",
  "packages/events/src",
  // Repo validation errors reach the founder as toasts; mock session recordings play in Live sessions; the linker and
  // policy prompts are agent prose; collab and social messages reach the editor and the network screens.
  "packages/db/src/repos",
  "packages/entity-linker/src",
  "packages/sandbox/src",
  "packages/policy/src",
  "apps/collab/src",
  "apps/social/src",
  "evals",
];
const SPELLING_ROOTS = [...new Set([...VOCAB_CODE_ROOTS, ...EXTRA_ROOTS])];
/** Every string in product code is checked for en-GB locales and day-first / 24-hour date-fns patterns. */
const LOCALE_ROOTS = ["apps", "packages"];

const TEST_PATH = /(^|\/)(__tests__|e2e|test|tests|testing|__fixtures__|__mocks__)(\/|$)|\.(test|spec)\.[cm]?[jt]sx?$|\.d\.ts$/;
const CODE_EXT = /\.(tsx?|jsx?|mjs|cjs|mts|cts)$/;
const PROSE_EXT = /\.(md|mdx)$/;
// Developer-facing or historical documents that quote British forms on purpose (and the build plan, written before the switch).
const SKIP_FILES = /^(CLAUDE\.md|BUILD\.md|BUILD_RUNBOOK\.md|DECISIONS\.md|PROGRESS\.md|NEEDED_DEPS\.md|VOCAB_SWEEP\.md|WAVE\d+_REPORTS\.md)$/;
const ALLOW_MARKER = /us-english-allow/;
/** The preference mapping, the only file whose marked block may spell the opt-in day-first and 24-hour patterns. */
const DATE_PREFERENCE_FILE = "packages/dugout/src/lib/date-preferences.ts";
const DATE_PREFERENCE_MARKER = /us-english-date-preferences:\s*(begin|end)\b/;

// ---------------------------------------------------------------------------------------------------------------
// The curated spelling list. Each family is a regex (word-bounded, case-insensitive) and a function that gives the US
// form of one match, so a hit can say what to write instead and `--fix` can rewrite it with the same capitalization.
// ---------------------------------------------------------------------------------------------------------------
const OUR_STEMS = [
  "colour", "behaviour", "favour", "honour", "labour", "neighbour", "rumour", "humour", "harbour", "flavour", "endeavour",
  "savour", "armour", "odour", "vigour", "rigour", "candour", "splendour", "clamour", "demeanour", "tumour", "parlour",
  "vapour", "saviour", "ardour", "valour", "fervour",
];
const OUR_RE = new RegExp(
  `\\b(?:dis|multi|water|tri|bi|un|mis|re|de|over)?(?:${OUR_STEMS.join("|")})(?:s|ed|ing|ful|fully|fulness|less|able|ably|al|ally|ite|ites|itism|er|ers|ist|ists|way|ways|hood|hoods|y|ise|ised|ising|ize|ized|izing)?\\b`,
  "gi",
);

// -ise / -isation verbs and nouns whose US form is -ize / -ization. Stems only; the "is" and an ending are required, so
// nouns such as "emphasis", "hypothesis", "synthesis" and words that end in -ise in US English too ("promise",
// "exercise", "enterprise", "advertise", "expertise", "otherwise") never match.
const IZE_STEMS = [
  "organ", "reorgan", "real", "recogn", "summar", "priorit", "repriorit", "depriorit", "optim", "author", "custom", "final",
  "minim", "maxim", "normal", "denormal", "util", "standard", "categor", "recategor", "subcategor", "capital", "apolog",
  "critic", "special", "personal", "visual", "synchron", "initial", "serial", "deserial", "sanit", "memor", "mobil",
  "monet", "local", "central", "decentral", "general", "stabil", "destabil", "neutral", "character", "item", "incentiv",
  "harmon", "energ", "revolution", "modern", "public", "scrutin", "sympath", "theor", "popular", "patron", "jeopard",
  "equal", "digit", "token", "random", "parameter", "anonym", "pseudonym", "rational", "trivial", "material", "global",
  "symbol", "legitim", "penal", "revital", "subsid", "steril", "terror", "union", "urban", "victim", "familiar",
  "democrat", "dramat", "econom", "epitom", "galvan", "human", "dehuman", "ideal", "immun", "international", "italic",
  "liberal", "marginal", "metabol", "moistur", "national", "natural", "ostrac", "oxid", "polar", "pressur", "privat",
  "radical", "social", "stigmat", "tantal", "vapor", "agon", "antagon", "brutal", "cannibal", "colon", "commercial",
  "computer", "criminal", "crystall", "demon", "demoral", "fantas", "formal", "hypnot", "immortal", "magnet",
  "memorial", "monopol", "motor", "plagiar", "regular", "romantic", "sensational", "styl", "systemat", "tender",
  "verbal", "vital", "product", "virtual", "canonical", "annual", "amort", "container", "vector", "contextual",
  "conceptual", "operational", "professional", "sensit", "desensit", "actual", "evangel", "fertil", "fossil", "glamor",
  "hospital", "mechan", "mesmer", "militar", "satir", "zero", "memo", "parallel", "emphas", "hypothes", "synthes",
  "civil", "legal", "vocal", "idol", "accessor", "atom", "compartmental", "modular", "plural", "secular", "unit",
  "vandal", "western", "winter", "weather", "sermon", "ellips", "unrecogn", "unauthor", "uncategor",
  "unsummar", "unorgan", "unreal", "unoptim", "unpriorit", "external", "internal", "industrial", "commodit",
];
const IZE_RE = new RegExp(
  `\\b(${IZE_STEMS.join("|")})i(s)(e|es|ed|ing|er|ers|ation|ations|ational|able|ability)\\b`,
  "gi",
);
// -yse verbs: analyse, paralyse, catalyse ("analyses" is left alone: it is also the plural of "analysis").
const YSE_RE = /\b(anal|paral|catal|breathal)y(s)(e|ed|er|ers|ing)\b/gi;

// -re nouns whose US form is -er.
const RE_STEMS = ["cent", "epicent", "met", "kilomet", "centimet", "millimet", "lit", "millilit", "theat", "fib", "calib", "somb", "spect", "lust", "meag", "sab"];
const RE_RE = new RegExp(`\\b(${RE_STEMS.join("|")})(re)(s|d)?\\b`, "gi");
const CENTRE_EXTRA_RE = /\b(centre)(piece|pieces|point|points|line|lines|fold)\b|\bcentring\b/gi;

// Doubled -l- before a suffix (US English keeps one): travelled, cancelled (not "cancellation"), labelled, modelling.
const LL_STEMS = [
  "travel", "cancel", "label", "relabel", "mislabel", "unlabel", "model", "remodel", "level", "fuel", "refuel", "signal",
  "total", "channel", "counsel", "marvel", "dial", "unravel", "rival", "unrival", "tunnel", "quarrel", "shovel",
  "grovel", "yodel", "snorkel", "initial", "pencil", "equal", "duel", "funnel", "bevel", "chisel", "jewel", "libel",
  "panel", "pummel", "revel", "swivel", "tassel", "towel",
];
const LL_RE = new RegExp(`\\b(${LL_STEMS.join("|")})l(ed|ing|er|ers|or|ors|ous|ery)\\b`, "gi");

// Single words and short phrases with their US forms. Matching is case-insensitive; the US form takes the match's case.
const WORDS = {
  // -ogue
  catalogue: "catalog", catalogues: "catalogs", catalogued: "cataloged", cataloguing: "cataloging", analogue: "analog", analogues: "analogs",
  // -l / -ll
  enrol: "enroll", enrols: "enrolls", enrolment: "enrollment", enrolments: "enrollments", fulfil: "fulfill", fulfils: "fulfills",
  fulfilment: "fulfillment", fulfilments: "fulfillments", instil: "instill", instils: "instills", distil: "distill", distils: "distills",
  skilful: "skillful", skilfully: "skillfully", wilful: "willful", wilfully: "willfully", instalment: "installment",
  instalments: "installments", woollen: "woolen", jewellery: "jewelry",
  // -ence / -ise nouns and verbs
  licence: "license", licences: "licenses", defence: "defense", defences: "defenses", offence: "offense", offences: "offenses",
  pretence: "pretense", programme: "program", programmes: "programs", practise: "practice", practised: "practiced",
  practises: "practices", practising: "practicing",
  // vowels and clusters
  grey: "gray", greys: "grays", greyed: "grayed", greying: "graying", greyish: "grayish", greyer: "grayer", greyscale: "grayscale",
  judgement: "judgment", judgements: "judgments", judgemental: "judgmental", acknowledgement: "acknowledgment",
  acknowledgements: "acknowledgments", ageing: "aging", cheque: "check", cheques: "checks", chequebook: "checkbook", tyre: "tire",
  tyres: "tires", aluminium: "aluminum", storey: "story", storeys: "stories", mould: "mold", moulds: "molds", moulded: "molded",
  mouldy: "moldy", smoulder: "smolder", moustache: "mustache", pyjamas: "pajamas", sceptic: "skeptic", sceptics: "skeptics",
  sceptical: "skeptical", sceptically: "skeptically", scepticism: "skepticism", artefact: "artifact", artefacts: "artifacts",
  cosy: "cozy", cosier: "cozier", cosiest: "coziest", maths: "math", speciality: "specialty", specialities: "specialties",
  orientated: "oriented", focussed: "focused", focussing: "focusing", focusses: "focuses", benefitted: "benefited",
  benefitting: "benefiting", anticlockwise: "counterclockwise", enquiry: "inquiry", enquiries: "inquiries", enquire: "inquire",
  enquired: "inquired", enquiring: "inquiring", aeroplane: "airplane", aeroplanes: "airplanes", sulphur: "sulfur", kerb: "curb",
  plough: "plow", ploughed: "plowed", paediatric: "pediatric", paediatrician: "pediatrician", anaemia: "anemia",
  anaemic: "anemic", oestrogen: "estrogen", encyclopaedia: "encyclopedia", manoeuvre: "maneuver", manoeuvres: "maneuvers",
  manoeuvred: "maneuvered", manoeuvring: "maneuvering", draughty: "drafty",
  // irregular past tenses US English writes regularly
  whilst: "while", amongst: "among", learnt: "learned", unlearnt: "unlearned", spelt: "spelled", misspelt: "misspelled",
  spoilt: "spoiled", leant: "leaned", spilt: "spilled",
  // vocabulary
  fortnight: "two weeks", fortnights: "two-week periods", fortnightly: "every two weeks", "per cent": "percent",
  "bank holiday": "public holiday", "bank holidays": "public holidays", "on holiday": "on vacation",
  "holiday mode": "vacation mode", "from holiday": "from vacation", "wage bill": "payroll", postcode: "postal code",
  postcodes: "postal codes",
};
const WORD_KEYS = Object.keys(WORDS).filter((k) => WORDS[k]);
const WORDS_RE = new RegExp(`\\b(?:${WORD_KEYS.sort((a, b) => b.length - a.length).map((k) => k.replace(/ /g, "\\s+")).join("|")})\\b`, "gi");

/** The US form of `us` written with the capitalization of `match` (all caps, Title, or lower). */
function withCase(match, us) {
  if (match.length > 1 && match === match.toUpperCase() && /[A-Z]/.test(match)) return us.toUpperCase();
  if (match[0] === match[0].toUpperCase() && match[0] !== match[0].toLowerCase()) return us.charAt(0).toUpperCase() + us.slice(1);
  return us;
}

// The founder's away mode is "Vacation" in US English (founder, 2026-10-10); enum keys and slugs keep `holiday`. A
// holiday that is a date on the calendar (public, national, bank, the holiday season, holiday sales) is not the mode.
const HOLIDAY_RE =
  /(?<!\b(?:public|national|federal|religious|bank|school)\s)\bholiday\b(?!\s+(?:season|seasons|sale|sales|gift|gifts|shopping|calendar|weekend|weekends|period|periods|campaign|campaigns|promotion|promotions|rush|card|cards|party|parties|hours|closure|closures|trading|demand|peak)\b)/gi;

const FAMILIES = [
  { kind: "spelling", re: OUR_RE, us: (m) => m.replace(/(o)u(r)/i, "$1$2") },
  { kind: "spelling", re: IZE_RE, us: (m) => m.replace(IZE_RE_ONE, (_, stem, s, end) => `${stem}i${s === "S" ? "Z" : "z"}${end}`) },
  { kind: "spelling", re: YSE_RE, us: (m) => m.replace(YSE_RE_ONE, (_, stem, s, end) => `${stem}y${s === "S" ? "Z" : "z"}${end}`) },
  {
    kind: "spelling",
    re: RE_RE,
    us: (m) =>
      m.replace(RE_RE_ONE, (_, stem, re, end) => {
        const er = re === "RE" ? "ER" : "er";
        return `${stem}${er}${end === "d" ? "ed" : end === "D" ? "ED" : (end ?? "")}`;
      }),
  },
  { kind: "spelling", re: CENTRE_EXTRA_RE, us: (m) => (/^centring$/i.test(m) ? withCase(m, "centering") : m.replace(/(cent)(re)/i, (_, c, re) => `${c}${re === "RE" ? "ER" : "er"}`)) },
  { kind: "spelling", re: LL_RE, us: (m) => (/^jewellery$/i.test(m) ? withCase(m, "jewelry") : m.replace(LL_RE_ONE, (_, stem, end) => `${stem}${end}`)) },
  { kind: "spelling", re: WORDS_RE, us: (m) => withCase(m, WORDS[m.toLowerCase().replace(/\s+/g, " ")] ?? m) },
  { kind: "spelling", re: HOLIDAY_RE, us: (m) => withCase(m, "vacation") },
];
const IZE_RE_ONE = new RegExp(IZE_RE.source, "i");
const YSE_RE_ONE = new RegExp(YSE_RE.source, "i");
const RE_RE_ONE = new RegExp(RE_RE.source, "i");
const LL_RE_ONE = new RegExp(LL_RE.source, "i");

// ---------------------------------------------------------------------------------------------------------------
// Dates and times in text: day-first dates, ordinal dates and unambiguous 24-hour clock times.
// ---------------------------------------------------------------------------------------------------------------
const MONTH = "(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|June?|July?|Aug(?:ust)?|Sep(?:t(?:ember)?)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)";
const DATE_TEXT = [
  // Not after a month name, so "Aug 13  Aug 27" (month-first, in a row) is not read as "13 Aug".
  { kind: "date", what: "day-first date (write Oct 7, 2026)", re: new RegExp(`(?<!${MONTH}\\.?,?\\s{1,3})\\b(?:[12]\\d|3[01]|0?[1-9])(?:st|nd|rd|th)?(?:\\s+of)?\\s+${MONTH}\\b(?!-)`, "g") },
  { kind: "date", what: "day-first numeric date (write 10/21/2026 or Oct 21, 2026)", re: /\b(?:1[3-9]|2\d|3[01])\/(?:0?[1-9]|1[0-2])\/(?:\d{4}|\d{2})\b/g },
  { kind: "time", what: "24-hour time (write 3:45 PM)", re: /(?<![\d:.])(?:0\d|1[3-9]|2[0-3]):[0-5]\d(?!\s?[AaPp]\.?[Mm]\b)(?![\d:])(?!\s+aspect\b)/g },
];

// ---------------------------------------------------------------------------------------------------------------
// Proper nouns and business facts that keep their own spelling (a UK business keeps GBP, VAT and Ltd; an institution
// keeps its name). A match inside one of these spans is not a hit.
// ---------------------------------------------------------------------------------------------------------------
const ALLOW = [
  /\bNational Cyber Security Centre\b/g,
  /\bOpen Government Licen[cs]e\b/g,
  /\bLabour Party\b/g,
  /\bEarl Grey\b/g,
  /\bHarbour\b/g, // Harbour Payments / HarbourPay, a fictional UK company in the demo data and evals
  /\bBank Holidays? \(England\b/g,
  /\bCompanies House\b/g,
  /\bInformation Commissioner'?s Office\b/g,
  /\bCentre for [A-Z][a-z]+/g,
  /\b(?:Data Protection|Consumer Rights|Companies|Finance|Employment Rights) Act \d{4}\b/g,
];

// ---------------------------------------------------------------------------------------------------------------
// Classification of string-ish nodes (mirrors scripts/banned-terms.mjs `classify`: the two scans must agree on what
// a person reads). Kept here rather than imported because banned-terms exports only its finished scans.
// ---------------------------------------------------------------------------------------------------------------
const STRUCTURAL_NAMES = new Set([
  "className", "class", "id", "key", "href", "src", "srcSet", "to", "htmlFor", "for", "role", "type", "name", "rel",
  "target", "style", "variant", "size", "tone", "align", "as", "slot", "lang", "dir", "method", "action", "autoComplete",
  "inputMode", "testId", "testid", "icon", "component", "path", "route", "url", "pathname", "query", "param", "params",
  "slug", "kind", "status", "state", "mode", "level", "stage", "phase", "sort", "sortBy", "orderBy", "field", "column",
  "columnId", "accessor", "accessorKey", "channel", "event", "eventType", "topic", "model", "modelId", "scope",
  "permission", "tool", "tools", "fill", "stroke", "d", "viewBox", "points", "transform", "clipPath", "mask", "filter",
  "font", "fontFamily", "cursor", "pointerEvents", "display", "position", "overflow", "gridArea", "gridColumn", "gridRow",
  "zIndex", "color", "background", "backgroundColor", "borderColor", "format", "locale", "currency", "unit", "pattern",
  "regex", "selector", "tag", "tagName", "dataKey",
]);
const PROSE_NAMES = new Set([
  "title", "label", "description", "placeholder", "alt", "aria-label", "aria-description", "aria-roledescription",
  "aria-valuetext", "hint", "help", "helpText", "helperText", "tooltip", "heading", "subheading", "subtitle", "caption",
  "emptyText", "emptyTitle", "emptyDescription", "emptyMessage", "message", "text", "content", "summary", "body", "copy",
  "headline", "lead", "detail", "details", "prompt", "question", "answer", "reason", "note", "notes", "cta", "ctaLabel",
  "buttonLabel", "confirmLabel", "cancelLabel", "okLabel", "successMessage", "errorMessage", "warning", "explanation",
  "displayName", "shortLabel", "longLabel", "legend", "unitLabel", "footer", "header", "kicker", "eyebrow", "tagline",
]);
/** In agent templates and the skill catalog, these structural-looking keys hold copy (agent name, role, voice tone, skill name). */
const AGENT_PROSE_KEYS = new Set(["name", "role", "tone"]);
const AGENT_PROSE_FILE = /\/packages\/agents\/src\/(?:templates|skills)\//;
const CLASS_UTILS = new Set(["cn", "clsx", "classnames", "classNames", "cva", "tv", "twMerge", "twJoin", "cx"]);
const LOG_OBJECTS = new Set(["console", "log", "logger", "debug"]);
const LOG_METHODS = new Set(["debug", "trace", "info", "warn", "error", "log", "fatal", "silly", "verbose"]);

function rel(p) {
  return relative(REPO_ROOT, p).split(sep).join("/");
}

function scriptKindFor(file) {
  const ext = extname(file);
  if (ext === ".tsx") return ts.ScriptKind.TSX;
  if (ext === ".jsx") return ts.ScriptKind.JSX;
  if (ext === ".js" || ext === ".mjs" || ext === ".cjs") return ts.ScriptKind.JS;
  return ts.ScriptKind.TS;
}

function nameText(n) {
  if (!n) return "";
  if (ts.isIdentifier(n) || ts.isPrivateIdentifier(n)) return n.text;
  if (ts.isStringLiteral(n) || ts.isNumericLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n)) return n.text;
  if (ts.isJsxNamespacedName(n)) return `${n.namespace.text}:${n.name.text}`;
  return "";
}

function calleeIs(call, set) {
  const e = call.expression;
  if (ts.isIdentifier(e)) return set.has(e.text);
  if (ts.isPropertyAccessExpression(e)) return set.has(e.name.text);
  return false;
}

function calleeIsLogger(call) {
  const e = call.expression;
  if (!ts.isPropertyAccessExpression(e)) return false;
  const obj = e.expression;
  const objName = ts.isIdentifier(obj) ? obj.text : ts.isPropertyAccessExpression(obj) ? obj.name.text : "";
  return LOG_OBJECTS.has(objName) && LOG_METHODS.has(e.name.text);
}

/** "skip" (identifier context), "prose" (always copy) or "maybe" (copy unless it looks like one identifier). */
function classify(node) {
  let child = node;
  let parent = node.parent;
  while (parent) {
    if (ts.isImportDeclaration(parent) || ts.isExportDeclaration(parent) || ts.isExternalModuleReference(parent) || ts.isImportTypeNode(parent)) return "skip";
    if (ts.isCallExpression(parent)) {
      const e = parent.expression;
      if (e.kind === ts.SyntaxKind.ImportKeyword || (ts.isIdentifier(e) && e.text === "require")) return "skip";
      if (calleeIs(parent, CLASS_UTILS) || calleeIsLogger(parent)) return "skip";
    }
    if (ts.isLiteralTypeNode(parent) || ts.isTypeNode(parent)) return "skip";
    if (ts.isEnumMember(parent)) return "skip";
    if (ts.isElementAccessExpression(parent) && parent.argumentExpression === child) return "skip";
    if (ts.isComputedPropertyName(parent)) return "skip";
    if (
      (ts.isPropertyAssignment(parent) || ts.isPropertySignature(parent) || ts.isPropertyDeclaration(parent) || ts.isMethodDeclaration(parent) || ts.isMethodSignature(parent) || ts.isGetAccessor(parent) || ts.isSetAccessor(parent)) &&
      parent.name === child
    )
      return "skip";
    if (ts.isPropertyAssignment(parent) && parent.initializer === child) {
      const key = nameText(parent.name);
      // An agent template's or a skill's `name`, `role` and `tone` are what the founder reads on the profile card.
      if (AGENT_PROSE_KEYS.has(key) && AGENT_PROSE_FILE.test(node.getSourceFile().fileName.split(sep).join("/"))) return "prose";
      if (STRUCTURAL_NAMES.has(key)) return "skip";
      if (PROSE_NAMES.has(key)) return "prose";
      return "maybe";
    }
    if (ts.isJsxAttribute(parent)) {
      const key = nameText(parent.name);
      if (key.startsWith("data-") || STRUCTURAL_NAMES.has(key)) return "skip";
      if (/^aria-(?:describedby|labelledby|controls|owns|activedescendant|flowto|details|errormessage)$/.test(key)) return "skip";
      if (PROSE_NAMES.has(key)) return "prose";
      return "maybe";
    }
    if (ts.isJsxExpression(parent) && parent.parent && (ts.isJsxElement(parent.parent) || ts.isJsxFragment(parent.parent))) {
      return ts.isTemplateExpression(node) || ts.isNoSubstitutionTemplateLiteral(node) ? "maybe" : "prose";
    }
    if (ts.isJsxElement(parent) || ts.isJsxFragment(parent)) return "prose";
    if (ts.isTemplateSpan(parent) || ts.isTemplateExpression(parent)) return "maybe";
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
        [ts.SyntaxKind.PlusToken, ts.SyntaxKind.QuestionQuestionToken, ts.SyntaxKind.BarBarToken, ts.SyntaxKind.AmpersandAmpersandToken].includes(parent.operatorToken.kind));
    // `errors.kit = "Both brand colors ..."`: the right side of an assignment is a value like any other.
    if (ts.isBinaryExpression(parent) && parent.operatorToken.kind === ts.SyntaxKind.EqualsToken && parent.right === child) return "maybe";
    if (ts.isBinaryExpression(parent) && !passThrough) return "skip"; // `status === "cancelled"`
    if (ts.isCaseClause(parent) && parent.expression === child) return "skip";
    if (!passThrough) {
      if (ts.isObjectLiteralExpression(parent)) {
        child = parent;
        parent = parent.parent;
        continue;
      }
      return "maybe";
    }
    child = parent;
    parent = parent.parent;
  }
  return "maybe";
}

/** `{ reason: "cancelled" }`: the string is the whole value of a `reason` property. */
function isStoredReason(node) {
  const p = node.parent;
  return Boolean(p && ts.isPropertyAssignment(p) && p.initializer === node && nameText(p.name) === "reason");
}

/** Literal pieces of a string-ish node as { text, pos } in source coordinates (raw text, escapes untouched). */
function piecesOf(node, sf) {
  const raw = node.getText(sf);
  const start = node.getStart(sf);
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return [{ text: raw.slice(1, -1), pos: start + 1 }];
  if (ts.isJsxText(node)) return [{ text: raw, pos: start }];
  if (ts.isTemplateExpression(node)) {
    const out = [{ text: node.head.getText(sf).slice(1, -2), pos: node.head.getStart(sf) + 1 }];
    for (const span of node.templateSpans) {
      const lit = span.literal.getText(sf);
      out.push({ text: lit.slice(1, ts.isTemplateTail(span.literal) ? -1 : -2), pos: span.literal.getStart(sf) + 1 });
    }
    return out;
  }
  return [];
}

// ---------------------------------------------------------------------------------------------------------------
// Matching
// ---------------------------------------------------------------------------------------------------------------
function allowedSpan(text, start, end) {
  for (const a of ALLOW) {
    a.lastIndex = 0;
    let m;
    while ((m = a.exec(text))) {
      if (m.index <= start && m.index + m[0].length >= end) return true;
      if (m[0].length === 0) a.lastIndex++;
    }
  }
  return false;
}

/** The match is part of a path, file name or token written inside copy ("catalogue.ts", "/b/x/colours", "--colour-x"). */
function insideToken(text, start, end) {
  const before = text[start - 1] ?? "";
  const after = text.slice(end, end + 6);
  if ("/_.@#$".includes(before) && before !== "") return true;
  if (before === "-" && text[start - 2] === "-") return true;
  return /^(?:_|\/\w|\.(?:tsx?|mjs|cjs|jsx?|json|md|mdx|css|sql)\b)/.test(after);
}

/** Spelling hits in a piece of user-facing text: { kind, start, end, match, us }. */
function findSpellingHits(text) {
  const out = [];
  const taken = [];
  for (const fam of FAMILIES) {
    fam.re.lastIndex = 0;
    let m;
    while ((m = fam.re.exec(text))) {
      const start = m.index;
      const end = start + m[0].length;
      if (m[0].length === 0) {
        fam.re.lastIndex++;
        continue;
      }
      if (taken.some(([s, e]) => start < e && end > s)) continue;
      if (allowedSpan(text, start, end) || insideToken(text, start, end)) continue;
      const us = fam.us(m[0]);
      if (us === m[0]) continue;
      taken.push([start, end]);
      out.push({ kind: fam.kind, start, end, match: m[0], us });
    }
  }
  return out.sort((a, b) => a.start - b.start);
}

/** Day-first dates and 24-hour times in a piece of user-facing text. */
function findDateHits(text) {
  const out = [];
  for (const d of DATE_TEXT) {
    d.re.lastIndex = 0;
    let m;
    while ((m = d.re.exec(text))) {
      if (allowedSpan(text, m.index, m.index + m[0].length)) continue;
      out.push({ kind: d.kind, start: m.index, end: m.index + m[0].length, match: m[0], us: d.what });
    }
  }
  return out;
}

/** en-GB locales and day-first / 24-hour date-fns patterns in any code string. */
function findLocaleHits(text) {
  const out = [];
  const push = (m, what) => out.push({ kind: "locale", start: m.index, end: m.index + m[0].length, match: m[0], us: what });
  let m;
  const locale = /\ben[-_]GB\b/gi;
  while ((m = locale.exec(text))) push(m, 'en-US ("Oct 7, 2026")');
  const dayFirst = /(?<![A-Za-z'])(?:E{1,4},?\s+)?d{1,2}o?[\s/.-]+M{1,4}(?![A-Za-z])/g;
  while ((m = dayFirst.exec(text))) push(m, 'a month-first pattern ("MMM d, yyyy", "EEE, MMM d")');
  const machine = /yyyy-MM-dd|'T'/.test(text);
  const hours24 = /(?<![A-Za-z'])HH?:mm(?![A-Za-z])/g;
  if (!machine) while ((m = hours24.exec(text))) push(m, 'a 12-hour pattern ("h:mm a")');
  return out;
}

function lineHasAllowMarker(lines, i) {
  return ALLOW_MARKER.test(lines[i] ?? "") || ALLOW_MARKER.test(lines[i - 1] ?? "");
}

/**
 * The lines (0-based) inside the preference mapping's marked block, where locale hits are allowed, and the markers that
 * allow nothing: any marker outside DATE_PREFERENCE_FILE, an `end` without a `begin`, a `begin` inside a block or one
 * never closed.
 */
function datePreferenceBlock(lines, abs) {
  const inMapping = abs.replace(/\\/g, "/").endsWith(`/${DATE_PREFERENCE_FILE}`);
  const allowed = new Set();
  const stray = [];
  let open = -1;
  lines.forEach((line, i) => {
    const m = DATE_PREFERENCE_MARKER.exec(line);
    if (!m) {
      if (open >= 0) allowed.add(i);
      return;
    }
    if (!inMapping) return stray.push(i);
    if (m[1] === "begin") {
      if (open >= 0) stray.push(i);
      else open = i;
      return;
    }
    if (open < 0) return stray.push(i);
    open = -1;
  });
  if (open >= 0) {
    // Never closed: allow nothing after it.
    for (let i = open + 1; i < lines.length; i++) allowed.delete(i);
    stray.push(open);
  }
  return { allowed, stray };
}

// ---------------------------------------------------------------------------------------------------------------
// File scans
// ---------------------------------------------------------------------------------------------------------------
/**
 * Scan one code file. `spelling` turns on the user-facing checks (spelling, dates in text); the locale check runs on
 * every string. Hits carry their absolute offset so `--fix` can rewrite them.
 */
function scanCodeFile(abs, hits, { spelling = true, locale = true } = {}) {
  const text = readFileSync(abs, "utf8");
  const file = rel(abs);
  const lines = text.split("\n");
  const sf = ts.createSourceFile(abs, text, ts.ScriptTarget.Latest, true, scriptKindFor(abs));
  const preferences = datePreferenceBlock(lines, abs);
  for (const i of preferences.stray) {
    hits.push({ file, abs, line: i + 1, offset: 0, kind: "locale", match: "us-english-date-preferences", us: `a closed block in ${DATE_PREFERENCE_FILE} only`, snippet: (lines[i] ?? "").trim().slice(0, 140) });
  }

  function record(pos, h) {
    const { line } = sf.getLineAndCharacterOfPosition(pos);
    if (lineHasAllowMarker(lines, line)) return;
    if (h.kind === "locale" && preferences.allowed.has(line)) return;
    hits.push({ file, abs, line: line + 1, offset: pos, kind: h.kind, match: h.match, us: h.us, snippet: (lines[line] ?? "").trim().slice(0, 140) });
  }

  function check(node) {
    const pieces = piecesOf(node, sf);
    if (pieces.length === 0) return;
    if (locale) for (const p of pieces) for (const h of findLocaleHits(p.text)) record(p.pos + h.start, h);
    if (!spelling) return;
    if (ts.isJsxText(node) && node.containsOnlyTriviaWhiteSpaces) return;
    const verdict = classify(node);
    if (verdict === "skip") return;
    // A lone lowercase token under `reason:` is a stored stop reason (`reason: "cancelled"`), not a sentence. Every other
    // prose slot is read even for one word (`caption: "annualised"` is copy).
    if (isStoredReason(node) && /^[a-z][a-z0-9]*(?:_[a-z0-9]+)*$/.test(pieces[0].text)) return;
    // SQL, CSS and GraphQL tagged templates carry stored values and selectors, not copy.
    if (ts.isTaggedTemplateExpression(node.parent) && /^(?:sql|css|gql|graphql)$/i.test(node.parent.tag.getText(sf).split(".").pop())) return;
    if (verdict === "maybe") {
      const joined = pieces.map((p) => p.text).join("X");
      if (looksLikeIdentifier(joined) || looksLikeClassList(joined)) return;
    }
    for (const p of pieces) {
      for (const h of findSpellingHits(p.text)) record(p.pos + h.start, h);
      for (const h of findDateHits(p.text)) record(p.pos + h.start, h);
    }
  }

  function visitIntlOptions(node) {
    // { hour12: false } / { hourCycle: "h23" }: a 24-hour clock in Intl options.
    if (ts.isPropertyAssignment(node)) {
      const key = nameText(node.name);
      if (key === "hour12" && node.initializer.kind === ts.SyntaxKind.FalseKeyword) record(node.getStart(sf), { kind: "locale", match: "hour12: false", us: "a 12-hour clock" });
      if (key === "hourCycle" && ts.isStringLiteral(node.initializer) && /^h2[34]$/.test(node.initializer.text)) record(node.getStart(sf), { kind: "locale", match: `hourCycle: "${node.initializer.text}"`, us: "a 12-hour clock" });
    }
  }

  function visit(node) {
    if (locale) visitIntlOptions(node);
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node) || ts.isTemplateExpression(node) || ts.isJsxText(node)) {
      check(node);
      if (ts.isTemplateExpression(node)) node.templateSpans.forEach((s) => visit(s.expression));
      return;
    }
    ts.forEachChild(node, visit);
  }
  visit(sf);
}

/** Markdown prose: everything outside code fences, inline code, link targets and HTML tags. */
function scanProseFile(abs, hits) {
  const text = readFileSync(abs, "utf8");
  const file = rel(abs);
  const lines = text.split("\n");
  let inFence = false;
  let offset = 0;
  lines.forEach((line, i) => {
    const lineStart = offset;
    offset += line.length + 1;
    if (/^\s*(```|~~~)/.test(line)) {
      inFence = !inFence;
      return;
    }
    if (inFence) return;
    if (/^\s*(import|export)\s.*from\s+["']/.test(line)) return;
    if (lineHasAllowMarker(lines, i)) return;
    // Blank out (same length) what is not prose, so offsets stay true for --fix.
    const blank = (s) => " ".repeat(s.length);
    const prose = line
      .replace(/`[^`]*`/g, blank)
      .replace(/\]\([^)]*\)/g, (s) => `]${blank(s.slice(1))}`)
      .replace(/<!--[\s\S]*?-->/g, blank)
      .replace(/<\/?[A-Za-z][^>]*>/g, blank)
      .replace(/https?:\/\/\S+/g, blank);
    for (const h of [...findSpellingHits(prose), ...findDateHits(prose)]) {
      hits.push({ file, abs, line: i + 1, offset: lineStart + h.start, kind: h.kind, match: h.match, us: h.us, snippet: line.trim().slice(0, 140) });
    }
  });
}

function walkFiles(root, onFile) {
  const abs = resolve(REPO_ROOT, root);
  if (!existsSync(abs)) return;
  if (!statSync(abs).isDirectory()) return onFile(abs);
  (function walk(dir) {
    for (const name of readdirSync(dir)) {
      if (SKIP_DIRS.has(name)) continue;
      const p = join(dir, name);
      if (statSync(p).isDirectory()) {
        if (!TEST_PATH.test(`${rel(p)}/`)) walk(p);
      } else onFile(p);
    }
  })(abs);
}

/** Spelling and dates in user-facing text under `roots`; en-GB locales and date patterns in code under `localeRoots`. */
function scan({ roots = SPELLING_ROOTS, docs = VOCAB_DOC_FILES, localeRoots = LOCALE_ROOTS } = {}) {
  const hits = [];
  const seen = new Set();
  const spellingFiles = new Set();
  const onSpelling = (p) => {
    const r = rel(p);
    const base = r.split("/").pop();
    if (SKIP_FILES.test(base) || TEST_PATH.test(r) || seen.has(p)) return;
    if (CODE_EXT.test(base)) {
      seen.add(p);
      spellingFiles.add(p);
      scanCodeFile(p, hits, { spelling: true, locale: true });
    } else if (PROSE_EXT.test(base)) {
      seen.add(p);
      scanProseFile(p, hits);
    }
  };
  for (const r of roots) walkFiles(r, onSpelling);
  for (const d of docs) {
    const p = resolve(REPO_ROOT, d);
    if (existsSync(p) && !seen.has(p)) {
      seen.add(p);
      scanProseFile(p, hits);
    }
  }
  for (const r of localeRoots)
    walkFiles(r, (p) => {
      const rp = rel(p);
      if (spellingFiles.has(p) || !CODE_EXT.test(p) || TEST_PATH.test(rp)) return;
      spellingFiles.add(p);
      scanCodeFile(p, hits, { spelling: false, locale: true });
    });
  return hits.sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line);
}

/** Rewrite every spelling hit in place (from the end of each file so earlier offsets stay true). Returns the count. */
function fix(hits) {
  const byFile = new Map();
  for (const h of hits) {
    if (h.kind !== "spelling") continue;
    if (!byFile.has(h.abs)) byFile.set(h.abs, []);
    byFile.get(h.abs).push(h);
  }
  let n = 0;
  for (const [abs, list] of byFile) {
    let text = readFileSync(abs, "utf8");
    for (const h of list.sort((a, b) => b.offset - a.offset)) {
      if (text.slice(h.offset, h.offset + h.match.length) !== h.match) continue;
      text = text.slice(0, h.offset) + h.us + text.slice(h.offset + h.match.length);
      n++;
    }
    writeFileSync(abs, text);
  }
  return n;
}

function main(argv) {
  const args = [...argv];
  let doFix = false;
  let jsonPath = null;
  const roots = [];
  while (args.length) {
    const a = args.shift();
    if (a === "--fix") doFix = true;
    else if (a === "--json") jsonPath = resolve(REPO_ROOT, args.shift() ?? "us-english.json");
    else if (a.startsWith("-")) {
      console.error(`unknown flag ${a}`);
      process.exit(2);
    } else roots.push(a);
  }
  const hits = roots.length ? scan({ roots, docs: [], localeRoots: [] }) : scan();
  if (doFix) {
    const n = fix(hits);
    process.stdout.write(`Rewrote ${n} spelling hit(s).\n`);
    const rest = roots.length ? scan({ roots, docs: [], localeRoots: [] }) : scan();
    report(rest, jsonPath);
    return;
  }
  report(hits, jsonPath);
}

function report(hits, jsonPath) {
  for (const h of hits) process.stdout.write(`${h.file}:${h.line}:${h.kind}: "${h.match}" -> ${h.kind === "spelling" ? `"${h.us}"` : h.us}: ${h.snippet}\n`);
  if (jsonPath) writeFileSync(jsonPath, JSON.stringify(hits.map(({ file, line, kind, match, us, snippet }) => ({ file, line, kind, match, us, snippet })), null, 2));
  if (hits.length) {
    const byKind = new Map();
    for (const h of hits) byKind.set(h.kind, (byKind.get(h.kind) ?? 0) + 1);
    console.error(`\n${hits.length} US English hit(s): ${[...byKind].map(([k, n]) => `${k} ${n}`).join(", ")}. Write US spelling and US dates (CLAUDE.md "Product vocabulary").`);
    process.exit(1);
  }
  process.stdout.write("US English and US dates throughout the user-facing text.\n");
}

export { findSpellingHits, findDateHits, findLocaleHits, scanCodeFile, scanProseFile, scan, fix, SPELLING_ROOTS, LOCALE_ROOTS, EXTRA_ROOTS, DATE_PREFERENCE_FILE };

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main(process.argv.slice(2));
