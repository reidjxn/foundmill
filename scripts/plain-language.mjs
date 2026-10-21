#!/usr/bin/env node
// Plain-language linter (docs/UX_AUDIT_AND_PLAN.md §8.2, §8.3; CLAUDE.md "Product vocabulary"). Fails the build
// (exit 1, `file:line:term:tier` per hit) when jargon reaches text a founder reads without being defined there.
//
// Three tiers. The first two come from packages/shared/src/terms.ts PLAIN_LANGUAGE_TIERS, the one definitions source
// the UI, the Composer and this script share (the file is transpiled with the TypeScript compiler API at run time, so
// the list is never copied here):
//
//  replace  ICP, CPA, CAC, COGS, RLS, Cedar, named query, exhibit, request_human_action, concurrency, time box,
//           counterparty, webhook, OAuth, BYOK, unit economics, hunk, triage. Fails on sight: say the plain thing.
//  define   The display word of every TERMS entry (runway, burn, MRR, cycle, pull request, Estimate, ...). Allowed when
//           the same file defines the word, decided statically per file (each screen is one component file or module
//           pack):
//             (a) it wraps the word in <Term …>, Term( or useTerm( (the term's id as a string, or the word as the
//                 Term's children);
//             (b) the word sits in a hint / definition / tooltip / help / caption / footer / plain prop (or inside an
//                 InfoTip, DefinitionCard, Tooltip or HoverCard), or any string in the file is itself a definition
//                 (the word followed by a colon, "is", "are" or "means");
//             (c) the line, or the line above, carries `plain-allow`;
//             (d) the file mounts an <Explainer …> (the screen defines its terms in prose).
//  leak     Developer notes that shipped as copy: "Mock citation", "replace with", "See note.", "TODO", "FIXME",
//           "lorem ipsum". Always a hit.
//
// Matching is by whole word, plural-tolerant, case-insensitive except for all-caps acronyms (SAFE the agreement, not
// "safe"). Overlapping matches keep the longest ("Runway horizon" is one hit, not two). Allowances for the obvious false
// friends (ALLOWANCES): "business model" and "revenue model", "Live sessions" and a sign-in session, a bank branch,
// merging CRM records, an insurance or privacy policy, a web form, "lead" as a verb, a person's health, "fit" as a verb,
// "tested" and "proven" as adjectives, customer ratings.
//
// Scope: the same idea of "user-facing" as scripts/banned-terms.mjs, whose extractor this script reuses: string
// literals, template literals and JSX text in VOCAB_CODE_ROOTS (apps/web, packages/dugout, packages/widgets,
// packages/modules, packages/agents/src with its archetypes, templates and prompts, apps/composer, packages/journey,
// packages/models with its mock completions, the demo seed, gateway and policy reasons, sandbox recordings and connector
// fixtures), the text of SVG files and Cedar `@reason` annotations. Identifiers are never hits: object keys, enum
// members, literal types, class lists, data-* / id / href attributes, logger arguments, single identifier-like tokens.
// Tests, e2e specs and Storybook stories and MDX are excluded by path. Markdown is read only under a root you name
// (`node scripts/plain-language.mjs docs/DESIGN.md`): the developer documents are not product copy, and
// docs/ARCHITECTURE.md has to say RLS and Cedar. Agent prose at run time is covered by the Composer eval (§7.19).
//
// Usage:
//   node scripts/plain-language.mjs                               scan the default roots, exit 1 on hits
//   node scripts/plain-language.mjs apps/web packages/modules     limit the scan to the given roots (files or directories)
//   node scripts/plain-language.mjs --sweep                       also write docs/PLAIN_LANGUAGE_SWEEP.md (hits by package)
//   node scripts/plain-language.mjs --sweep path.md --json hits.json
//   node scripts/plain-language.mjs --summary                     counts only, no per-hit lines
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  REPO_ROOT,
  VOCAB_CODE_ROOTS,
  extractCodePieces,
  findTermHits,
  lineHasAllowMarker,
  listScanFiles,
  mdTable,
  packageOf,
  proseLines,
  splitWords,
} from "./banned-terms.mjs";

const require = createRequire(import.meta.url);
const ts = require("typescript");

/** The definitions source; PLAIN_LANGUAGE_TIERS and TERMS are read from it at run time. */
const TERMS_FILE = "packages/shared/src/terms.ts";
const DEFAULT_SWEEP = "docs/PLAIN_LANGUAGE_SWEEP.md";
const ALLOW_MARKER = /plain-allow/;

/** The banned-terms roots plus the three places the plan names explicitly (already inside them; listed so a later narrowing of VOCAB_CODE_ROOTS keeps them). */
const PLAIN_CODE_ROOTS = [
  ...new Set([...VOCAB_CODE_ROOTS, "packages/agents/src/archetypes.ts", "packages/agents/src/templates", "packages/models/src/mock"]),
];
/** Stories, MDX docs and this script's own report quote jargon on purpose. */
const EXCLUDED_FILE = /\.stories\.[cm]?[jt]sx?$|\.mdx$|(^|\/)PLAIN_LANGUAGE_SWEEP\.md$/;

/** Object keys and JSX attributes whose value defines a word (condition b), plus the TermDefinition and Explainer fields. */
const DEFINITION_KEYS = new Set([
  "hint",
  "definition",
  "tooltip",
  "help",
  "helpText",
  "helperText",
  "caption",
  "footer",
  "plain",
  "short",
  "long",
  "word",
  "purpose",
  "action",
  "watchFor",
]);
/** JSX elements whose text defines a word (condition b), and Term itself (condition a). */
const DEFINITION_ELEMENTS = new Set(["Term", "InfoTip", "DefinitionCard", "Explainer", "Tooltip", "TooltipContent", "HoverCard", "HoverCardContent"]);

// ---------------------------------------------------------------------------------------------------------------
// Tiers
// ---------------------------------------------------------------------------------------------------------------

/**
 * Loads packages/shared/src/terms.ts (and the files it imports relatively) by transpiling each to CommonJS with the
 * TypeScript compiler API, so the tiers are read from the source of truth without a build step.
 */
function loadTiers(entry = join(REPO_ROOT, TERMS_FILE)) {
  const cache = new Map();
  function load(file) {
    if (cache.has(file)) return cache.get(file).exports;
    const { outputText } = ts.transpileModule(readFileSync(file, "utf8"), {
      fileName: file,
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
    });
    const mod = { exports: {} };
    cache.set(file, mod);
    const req = (spec) => {
      if (!spec.startsWith(".")) return createRequire(file)(spec);
      const base = resolve(dirname(file), spec);
      for (const cand of [base, `${base}.ts`, `${base}.tsx`, join(base, "index.ts")])
        if (existsSync(cand) && statSync(cand).isFile()) return load(cand);
      throw new Error(`plain-language: cannot resolve ${spec} from ${file}`);
    };
    new Function("require", "module", "exports", "__filename", "__dirname", outputText)(req, mod, mod.exports, file, dirname(file));
    return mod.exports;
  }
  const { PLAIN_LANGUAGE_TIERS, TERMS } = load(entry);
  if (!PLAIN_LANGUAGE_TIERS?.replace || !PLAIN_LANGUAGE_TIERS?.define)
    throw new Error(`plain-language: ${TERMS_FILE} exports no PLAIN_LANGUAGE_TIERS { replace, define }`);
  return { tiers: PLAIN_LANGUAGE_TIERS, terms: TERMS ?? {} };
}

/** "SAFE", "P&L", "ICP": no lowercase letter at all, so the match is case-sensitive. */
function isAcronym(word) {
  return /[A-Z]/.test(word) && !/[a-z]/.test(word);
}

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** A whole-word, plural-tolerant pattern source for a word or phrase: "named query" → named[\s-]+quer(?:y|ies). */
function termPattern(word) {
  const tokens = word.trim().split(/\s+/);
  const parts = tokens.map((t, i) => {
    if (i < tokens.length - 1) return escapeRe(t);
    if (isAcronym(t)) return `${escapeRe(t)}s?`;
    if (/[^aeiou]y$/i.test(t)) return `${escapeRe(t.slice(0, -1))}(?:y|ies)`;
    if (/(?:ch|sh|ss|x|z)$/i.test(t)) return `${escapeRe(t)}(?:es)?`;
    if (/[^s]s$/i.test(t) && t.length > 3) return `${escapeRe(t.slice(0, -1))}s?`; // "tokens", "credits": the singular too
    return `${escapeRe(t)}s?`;
  });
  return `\\b${parts.join("[\\s-]+")}(?:'s)?\\b`;
}

function termRegex(word, flags = "") {
  return new RegExp(termPattern(word), `${flags}${isAcronym(word.replace(/\s+/g, "")) ? "" : "i"}`);
}

/**
 * The obvious false friends, keyed by the tier word in lower case. `allow`: a match inside one of these spans is not
 * the term. `context`: a string that also contains one of these words is about something else (a skincare line's
 * "skin health", not an agent's).
 */
const ALLOWANCES = {
  model: {
    allow: [
      /\b(?:business|revenue|pricing|subscription|operating|financial|commercial|licensing|delivery|service|staffing|ownership|cost|funding|mental|role|data|domain|threat|3d|wire|wireframe|working|spreadsheet|unit)\s+models?\b/i,
      /\bmodels?\s+(?:of|for)\s+(?:the\s+|this\s+|your\s+|a\s+)?business\b/i,
      /\b(?:to|will|would|can|could|should|let's|we|you|they)\s+model\b/i, // the verb
    ],
  },
  session: {
    allow: [
      /\blive\s+sessions?\b/i,
      /\b(?:sign-?in|signed-?in|log-?in|logged-?in|browser|user|auth|authentication|practice|coaching|working|strategy|planning|discovery|feedback|interview|demo|onboarding|q&a|photo|recording|therapy|study|class|workshop|hands-on|support|sales|pitch|brainstorm|brainstorming|whiteboard|office-hours|office\s+hours|mentoring|advisory|board|jam)\s+sessions?\b/i,
      /\bsessions?\s+(?:expired|expires|expiry|has\s+expired|timed\s+out|time-?out|cookie|cookies|token|tokens|id)\b/i,
      /\bsessions?\s+with\s+(?:a\s+|an\s+|the\s+|your\s+|our\s+|their\s+)?(?:customer|customers|prospect|prospects|user|users|client|clients|buyer|buyers|founder|founders|investor|investors|lawyer|accountant|advisor|adviser|mentor|coach|team|partner|partners)\b/i,
    ],
  },
  branch: {
    allow: [
      /\bbank(?:'s|s)?\s+branch(?:es)?\b/i,
      /\bbranch(?:es)?\s+(?:of|at)\s+(?:a|an|the|your|our|their|its)\s+(?:\w+\s+)?bank\b/i,
      /\bbranch(?:es)?\s+(?:code|codes|address|addresses|office|offices|manager|managers|network|opening\s+hours|visit|visits)\b/i,
      /\b(?:local|retail|high[\s-]street|nearest|physical|store|shop|new|second|first|flagship)\s+branch(?:es)?\b/i,
    ],
  },
  merge: {
    // Not in the tiers today; kept so the CRM sense passes if "merge" is ever added.
    allow: [/\bmerg\w*\s+(?:the\s+|these\s+|two\s+|both\s+|duplicate\s+|duplicated\s+)?(?:crm\s+|contact|contacts|people|person|company|companies|duplicate|duplicates|record|records|entries|lead|leads|account|accounts)\b/i],
  },
  policy: {
    allow: [
      /\binsurance\s+polic(?:y|ies)\b/i,
      /\bpolic(?:y|ies)\s+(?:number|numbers|holder|holders|premium|premiums|document|documents|renewal|cover|coverage|excess|limit|limits|wording|schedule|page|pages|url|link|links|text)\b/i,
      /\b(?:privacy|cookie|cookies|refund|refunds|return|returns|cancellation|cancelation|shipping|delivery|acceptable[\s-]use|data[\s-]retention|retention|security|password|content|moderation|community|expense|expenses|travel|leave|hr|remote[\s-]work|public|government|tax|monetary|fiscal|company|internal|written|legal|terms\s+and|warranty|fair[\s-]use|complaints?|whistleblowing|anti-?bribery|environmental|sustainability|accessibility|health\s+and\s+safety)\s+polic(?:y|ies)\b/i,
    ],
  },
  form: {
    allow: [
      /\b(?:web|sign-?up|signup|contact|lead|intake|order|checkout|booking|application|registration|enquiry|inquiry|feedback|waitlist|wait-list|onboarding|profile|entry|submission|survey|consent|tax|customs|claim|claims|paper|online|printed|google|typeform|hubspot|embedded|embed|html|this|that|the|a|an|each|every|your|our|my|their|its|new|empty|blank|long|short|simple|same|whole|entire|full|first|next|previous|above|below|following)\s+forms?\b/i,
      /\bforms?\s+(?:field|fields|submission|submissions|submit|submits|submitted|builder|validation|data|entry|entries|error|errors|value|values|input|inputs|control|controls|label|labels|page|pages|url|handler|library|state|step|steps|section|sections|element|elements|below|above|is\s+(?:saved|submitted|sent|complete|incomplete|invalid|valid))\b/i,
      /\b(?:fill(?:s|ed|ing)?\s+(?:in|out)|submit(?:s|ted|ting)?|complete(?:s|d|ing)?|send(?:s|ing)?|sign(?:s|ed|ing)?|return(?:s|ed|ing)?|open(?:s|ed|ing)?|close(?:s|d|ing)?|save(?:s|d|ing)?|reset(?:s|ting)?|clear(?:s|ed|ing)?|leave(?:s)?|left|validate(?:s|d)?)\s+(?:the|this|that|a|an|your|each|every|out\s+the)\s+forms?\b/i,
      /\b(?:in\s+(?:the|any|some|a|its|this|that|what|another|every|each|written|digital|physical|its\s+current|its\s+simplest|one|no)\s+form|forms?\s+of|form\s+factor|free[\s-]forms?|long[\s-]form|short[\s-]form|form\s+(?:and|or)\s+function|(?:take|takes|taking|took|taken)\s+the\s+form|forms?\s+(?:a|an|the|part)\b)\b/i,
      /\b(?:to|will|would|can|could|should|may|might|must|shall|help|helps|helped|helping|they|we|you|that|which|who|and)\s+form\b/i, // the verb
    ],
  },
  lead: {
    allow: [
      /\bleads?\s+(?:to|into|through|by|with|on|off|up|them|him|her|us|you|me|here|there|nowhere|somewhere|anywhere|directly|straight|back|away|from|toward|towards)\b/i,
      /\b(?:to|will|would|can|could|should|may|might|must|shall|let|help|helps|helped|helping|who|and\s+then|then)\s+leads?\b/i,
      /\bleads?\s+(?:the|a|an|this|that|your|our|their|its|each|every)\s+(?:way|team|teams|cycle|cycles|work|department|departments|conversation|conversations|call|calls|discussion|discussions|meeting|meetings|review|reviews|charge|effort|efforts|push|project|projects|session|sessions|build|builds|launch|launches|response|rollout|search|hunt|investigation|planning|plan|cleanup|clean-up|training|workshop|workshops|round|rounds|negotiation|negotiations|interview|interviews|engineers|agents|hiring|change|changes|migration|redesign|rewrite|development|design|research|writing|sprint|sprints|pack|field|market|category)\b/i,
      /\blead[\s-](?:times?|free|paint|pipe|pipes|pencil)\b/i,
    ],
  },
  health: {
    allow: [
      /\b(?:your|my|his|her|their|own|physical|mental|personal|public|human|patient|patients'?|employee|employees'?|founder's|founders'|people's|worker|workers'?|child|children's|family|sexual|reproductive|digital|financial|gut|heart|bone|eye|dental|oral|skin|hair|animal|pet|plant|soil|women's|men's|brain|sleep|hormone|hormonal|metabolic|immune|cardiovascular|global|population|community|rural|urban|occupational|environmental)\s+health\b/i,
      /\bhealth\s+(?:care|cover|coverage|insurance|insurer|insurers|condition|conditions|service|services|and\s+safety|and\s+wellness|and\s+wellbeing|and\s+well-being|and\s+fitness|and\s+beauty|record|records|data|information|professional|professionals|provider|providers|practitioner|practitioners|worker|workers|app|apps|tech|sector|industry|ministry|department|authority|authorities|benefit|benefits|plan|plans|check|checks|checkup|check-up|screening|screenings|issue|issues|problem|problems|risk|risks|outcome|outcomes|advice|claim|claims|supplement|supplements|product|products|brand|brands|food|foods|drink|drinks|store|stores|club|clubs|coach|coaching|regulator|regulators|regulation|regulations|warning|warnings|label|labels|system|systems|goals?|journey|needs?|concerns?|history|questionnaire|survey)\b/i,
    ],
    context: [
      /\b(?:healthcare|wellbeing|wellness|well-being|clinic|clinics|clinical|hospital|hospitals|doctor|doctors|nurse|nurses|medical|medicine|patient|patients|diet|dietary|nutrition|nutritional|fitness|gym|supplement|supplements|skincare|moisturizer|serum|serums|vitamin|vitamins|symptom|symptoms|therapy|therapist|pharma|pharmacy|hipaa|nhs|fda|medically)\b/i,
    ],
  },
  fit: {
    allow: [
      /\bfits?\s+(?:in|into|inside|for|to|on|with|within|around|together|well|better|best|nicely|neatly|here|there|the|a|an|your|our|their|its|my|this|that|these|those|everything|all|both|more|most|comfortably|easily|neatly|under|inside|through|between|onto)\b/i,
      /\b(?:product[\s-]market|market|job|role|cultural|culture|team|hand|slim|loose|tight|snug|perfect|exact|good|great|poor|bad|right|wrong|better|best|natural|close|closer|closest|strong|weak|obvious|clear|real)\s+fit\b/i,
      /\bfit\s+for\s+purpose\b/i,
      /\b(?:to|will|would|can|could|should|may|might|must|that|which|who|and|they|we|you|it|I|not|doesn't|don't|won't|didn't|still|also|all|everything|nothing)\s+fit\b/i, // the verb
      /\bkeep(?:s|ing)?\s+fit\b/i,
    ],
  },
  tested: {
    allow: [
      /\b(?:is|are|was|were|be|been|being|get|gets|got|have|has|had|not|yet|well|fully|thoroughly|properly|hand|battle|user|unit|load|stress|beta|clinically|dermatologically|lab|independently|never|already|once|then|and|or|rigorously|field|market|time|road|pressure|untested|a|the)[\s-]+tested\b/i,
      /\btested\s+(?:on|in|with|by|against|for|before|after|at|across|and|or|to|the|a|an|it|them|this|that|under|through|twice|once|again|locally|live|end-to-end)\b/i,
    ],
  },
  proven: {
    allow: [
      /\b(?:a|an|the|is|are|was|were|been|be|being|has|have|had|not|yet|well|battle|time|field|market|clinically|scientifically|commercially|un|already|now|once|and|or|track\s+record\s+of)[\s-]+proven\b/i,
      /\bproven\s+(?:to|that|by|in|with|on|track|record|approach|approaches|method|methods|model|models|way|ways|playbook|playbooks|demand|wrong|right|itself|themselves|effective|ability|results?|formula|formulas|recipe|recipes|tactic|tactics|channel|channels|strategy|strategies|process|processes|technique|techniques|path|paths|technology|technologies|product|products|concept|concepts|case|cases|business|businesses|market|markets|team|teams|founder|founders|partner|partners|supplier|suppliers|vendor|vendors|performer|performers|winner|winners)\b/i,
    ],
  },
  rating: {
    allow: [
      /\b(?:customer|customers'|user|users'|app|product|review|reviews|star|five-star|5-star|four-star|4-star|google|trustpilot|amazon|yelp|credit|energy|age|content|parental|esrb|pegi|seller|driver|host|guest|buyer|supplier|vendor|restaurant|hotel|film|movie|book|employer|glassdoor|nps|satisfaction|safety|efficiency|ip|power|voltage|load|weight|fire|water)\s+ratings?\b/i,
      /\bratings?\s+(?:and|or|&)\s+reviews?\b/i,
      /\breviews?\s+(?:and|or|&)\s+ratings?\b/i,
      /\bratings?\s+on\s+(?:google|amazon|trustpilot|yelp|the\s+app\s+store|google\s+play|play\s+store)\b/i,
    ],
  },
};

/** Developer notes that must never ship as copy. */
const LEAK_TERMS = [
  { term: "Mock citation", tier: "leak", re: /\bMock citation\b/gi },
  { term: "replace with", tier: "leak", re: /\breplace with\b/gi },
  { term: "See note.", tier: "leak", re: /\bSee note\.?(?=\s|$)/g },
  { term: "TODO", tier: "leak", re: /\bTODO\b/g },
  { term: "FIXME", tier: "leak", re: /\bFIXME\b/g },
  { term: "lorem ipsum", tier: "leak", re: /\blorem ipsum\b/gi },
];

/**
 * The term list `findTermHits` matches: one entry per tier word, `{ term, tier, id, word, re, allow, context }`.
 * `id` is the TERMS id behind a define-tier word (null for a word the map does not hold), used by condition (a).
 */
function buildTerms({ tiers, terms }) {
  const idsByWord = new Map();
  for (const [id, def] of Object.entries(terms ?? {})) {
    const w = String(def?.word ?? "").toLowerCase();
    if (!w) continue;
    if (!idsByWord.has(w)) idsByWord.set(w, []);
    idsByWord.get(w).push(def.id ?? id);
  }
  const entry = (word, tier) => {
    const lower = word.toLowerCase();
    const extra = ALLOWANCES[lower] ?? {};
    return {
      term: word,
      tier,
      word,
      ids: idsByWord.get(lower) ?? [],
      re: termRegex(word, "g"),
      test: termRegex(word),
      definition: new RegExp(`${termPattern(word)}\\s*(?::|—|–|(?:is|are|means)\\b)`, isAcronym(word.replace(/\s+/g, "")) ? "" : "i"),
      // findTermHits walks allow spans with exec(), which needs the global flag.
      allow: (extra.allow ?? []).map((re) => (re.global ? re : new RegExp(re.source, `${re.flags}g`))),
      allowContext: extra.context ?? [],
    };
  };
  const out = [];
  const seen = new Set();
  for (const tier of ["replace", "define"])
    for (const word of tiers[tier]) {
      const key = `${tier}:${word.toLowerCase()}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(entry(String(word), tier));
    }
  return [...out, ...LEAK_TERMS];
}

// ---------------------------------------------------------------------------------------------------------------
// Scanning
// ---------------------------------------------------------------------------------------------------------------

/** Overlapping matches keep the longest span ("Runway horizon" is one hit); equal spans keep the first. */
function longestOnly(hits) {
  const sorted = [...hits].sort((a, b) => a.start - b.start || b.end - a.end);
  const kept = [];
  for (const h of sorted) {
    if (kept.some((k) => k.start <= h.start && k.end >= h.end)) continue;
    kept.push(h);
  }
  return kept;
}

/** Pieces joined so a regex can run once per file; the separator is neither whitespace nor a word character, so "runway" at the end of one string and ":" at the start of the next never read as a definition. */
const PIECE_SEPARATOR = "\n\u0001\n";

/** One case-insensitive regex over every term: a piece it does not match holds no hit, so the per-term loop is skipped. */
const prefilters = new WeakMap();
function prefilterFor(terms) {
  if (!prefilters.has(terms)) prefilters.set(terms, new RegExp(terms.map((t) => t.re.source).join("|"), "i"));
  return prefilters.get(terms);
}

/** What a file already defines (conditions a, b, d), computed once from its text and pieces. */
function fileContext(text, pieces, terms) {
  const usesTerm = /<Term\b|\bTerm\(|\buseTerm\(/.test(text);
  const hasExplainer = /<Explainer\b/.test(text);
  const termWraps = usesTerm ? [...text.matchAll(/<Term\b[^>]*>([\s\S]*?)<\/Term>/g)].map((m) => m[1]).join(PIECE_SEPARATOR) : "";
  const slots = pieces
    .filter((p) => DEFINITION_KEYS.has(p.key) || DEFINITION_ELEMENTS.has(p.element))
    .map((p) => p.text)
    .join(PIECE_SEPARATOR);
  const everything = pieces.map((p) => p.text).join(PIECE_SEPARATOR);
  const defined = new Map();
  for (const t of terms) {
    if (t.tier !== "define" || !t.test.test(everything)) continue; // a word no piece holds can be neither a hit nor defined
    let how = null;
    if (usesTerm) {
      if (t.ids.some((id) => new RegExp(`["'\`]${escapeRe(id)}["'\`]`).test(text))) how = "Term";
      else if (t.test.test(termWraps)) how = "Term";
    }
    if (!how && t.test.test(slots)) how = "definition prop";
    if (!how && t.definition.test(everything)) how = "definition sentence";
    if (how) defined.set(t.term, how);
  }
  return { hasExplainer, defined };
}

/**
 * Runs the term list over string pieces of one file. `pieces`: { text, pos }; `lineOf(piece, offset)` gives the
 * 0-based line of a match; `ctx` from `fileContext`. Returns { hits, silenced } (silenced: replace-tier hits a
 * `plain-allow` marker hid, which Gate 2 wants at zero).
 */
function scanPieces({ file, lines, pieces, lineOf, ctx, terms, hits, silenced }) {
  const seen = new Set();
  const prefilter = prefilterFor(terms);
  const byTerm = new Map(terms.map((t) => [t.term, t]));
  for (const piece of pieces) {
    const haystack = piece.verdict === "story-title" ? splitWords(piece.text) : piece.text;
    if (!prefilter.test(haystack)) continue;
    const found = longestOnly(
      findTermHits(haystack, terms).filter((h) => !h.allowContext.some((re) => re.test(haystack))),
    );
    for (const h of found) {
      const t = byTerm.get(h.term);
      const offset = piece.verdict === "story-title" ? 0 : h.start;
      const line = lineOf(piece, offset);
      const key = `${line}:${h.term}:${offset}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const record = {
        file,
        line: line + 1,
        term: h.term,
        tier: t.tier,
        match: h.match,
        snippet: (lines[line] ?? "").trim().slice(0, 140),
      };
      if (lineHasAllowMarker(lines, line, ALLOW_MARKER)) {
        if (t.tier === "replace") silenced.push(record);
        continue;
      }
      if (t.tier === "define") {
        if (ctx.hasExplainer) continue;
        if (ctx.defined.has(h.term)) continue;
        if (t.definition.test(piece.text)) continue;
      }
      hits.push(record);
    }
  }
}

function scanCode(abs, terms, hits, silenced) {
  const { file, lines, sf, pieces } = extractCodePieces(abs);
  const ctx = fileContext(lines.join("\n"), pieces, terms);
  scanPieces({
    file,
    lines,
    pieces,
    lineOf: (piece, offset) => sf.getLineAndCharacterOfPosition(piece.pos + offset).line,
    ctx,
    terms,
    hits,
    silenced,
  });
}

function scanProse(abs, terms, hits, silenced) {
  const text = readFileSync(abs, "utf8");
  const { lines, prose } = proseLines(text);
  const pieces = prose.map((p) => ({ text: p.text, pos: p.index, key: null, element: null, verdict: "prose" }));
  const ctx = fileContext("", pieces, terms); // no Term or Explainer in prose: only a definition sentence defines
  scanPieces({ file: relOf(abs), lines, pieces, lineOf: (piece) => piece.pos, ctx, terms, hits, silenced });
}

const SVG_ENTITIES = { "&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": '"', "&apos;": "'", "&#39;": "'" };

function scanSvg(abs, terms, hits, silenced) {
  const text = readFileSync(abs, "utf8");
  const lines = text.split("\n");
  const pieces = [];
  const clean = (s) => s.replace(/<[^>]*>/g, " ").replace(/&(?:amp|lt|gt|quot|apos|#39);/g, (e) => SVG_ENTITIES[e]);
  for (const m of text.matchAll(/<(text|tspan|title|desc)\b[^>]*>([\s\S]*?)<\/\1>/gi))
    pieces.push({ text: clean(m[2]), pos: m.index + m[0].indexOf(">") + 1, key: null, element: m[1], verdict: "prose" });
  for (const m of text.matchAll(/\baria-(?:label|description)\s*=\s*"([^"]*)"/gi))
    pieces.push({ text: clean(m[1]), pos: m.index + m[0].indexOf('"') + 1, key: "aria-label", element: null, verdict: "prose" });
  const ctx = fileContext("", pieces, terms);
  const lineOf = (piece) => text.slice(0, piece.pos).split("\n").length - 1;
  scanPieces({ file: relOf(abs), lines, pieces, lineOf, ctx, terms, hits, silenced });
}

function scanCedar(abs, terms, hits, silenced) {
  const text = readFileSync(abs, "utf8");
  const lines = text.split("\n");
  const pieces = [];
  lines.forEach((line, i) => {
    for (const m of line.matchAll(/@(?:reason|description|label)\s*\(\s*"((?:[^"\\]|\\.)*)"\s*\)/g))
      pieces.push({ text: m[1], pos: i, key: "reason", element: null, verdict: "prose" });
  });
  const ctx = fileContext("", pieces, terms);
  scanPieces({ file: relOf(abs), lines, pieces, lineOf: (piece) => piece.pos, ctx, terms, hits, silenced });
}

function relOf(abs) {
  return resolve(abs).startsWith(REPO_ROOT) ? resolve(abs).slice(REPO_ROOT.length + 1).split("\\").join("/") : abs;
}

const SCANNERS = { code: scanCode, prose: scanProse, svg: scanSvg, cedar: scanCedar };

/**
 * The scan: `{ hits, silenced, errors, files }`. Markdown is read only when `roots` were named by the caller; a file the
 * parser cannot read is reported in `errors` and never stops the run.
 */
function plainScan(roots = PLAIN_CODE_ROOTS, options = {}) {
  const terms = options.terms ?? buildTerms(loadTiers());
  const explicit = roots !== PLAIN_CODE_ROOTS;
  const hits = [];
  const silenced = [];
  const errors = [];
  let files = 0;
  for (const f of listScanFiles(roots)) {
    if (EXCLUDED_FILE.test(f.file)) continue;
    if (f.kind === "prose" && !explicit) continue;
    files += 1;
    try {
      SCANNERS[f.kind](f.abs, terms, hits, silenced);
    } catch (err) {
      errors.push({ file: f.file, error: err?.message ?? String(err) });
    }
  }
  return { hits, silenced, errors, files, terms };
}

// ---------------------------------------------------------------------------------------------------------------
// Reporting
// ---------------------------------------------------------------------------------------------------------------

const TIERS = ["replace", "define", "leak"];

function countBy(list, keyOf) {
  const m = new Map();
  for (const x of list) m.set(keyOf(x), (m.get(keyOf(x)) ?? 0) + 1);
  return m;
}

function tierCounts(list) {
  const c = countBy(list, (h) => h.tier);
  return Object.fromEntries(TIERS.map((t) => [t, c.get(t) ?? 0]));
}

function writeSweep(path, { hits, silenced, errors, files, terms }, roots) {
  const date = new Date().toISOString().slice(0, 10);
  const byPkg = new Map();
  for (const h of hits) {
    const p = packageOf(h.file);
    if (!byPkg.has(p)) byPkg.set(p, []);
    byPkg.get(p).push(h);
  }
  const totals = tierCounts(hits);
  const out = [];
  out.push("# Plain-language sweep — jargon still undefined in user-facing text");
  out.push("");
  out.push(
    `Generated ${date} by \`node scripts/plain-language.mjs --sweep ${relOf(path)}\` (docs/UX_AUDIT_AND_PLAN.md §8.2, §8.3). ` +
      "This file is regenerated, not edited: reword the copy or define the term in the package, rerun the script, and the row disappears. " +
      "Every hit is a string literal, template literal, JSX text, SVG text or Cedar reason a founder can read; identifiers, enum keys, class lists, import paths, tests, stories and fixtures are not scanned.",
  );
  out.push("");
  out.push(`Scope: ${roots.join(", ")} (${files} files).`);
  out.push("");
  out.push(
    `**${hits.length} hit(s) in ${byPkg.size} package(s): ${totals.replace} replace, ${totals.define} define, ${totals.leak} leak.** ` +
      "CI (`plain-language` job) reports these without failing until the package sweep lands; from then on it fails while the number is above zero. " +
      `Gate 2 also wants no \`plain-allow\` on a replace-tier term: ${silenced.length} silenced today.` +
      (errors.length ? ` ${errors.length} file(s) could not be parsed (listed at the end).` : ""),
  );
  out.push("");
  out.push("## Tiers");
  out.push("");
  out.push("- **replace** fails on sight: say the plain thing (Appendix E of the plan has the replacement for each word).");
  out.push(
    "- **define** passes when the same file wraps the word in `Term` (its id as a string, or the word as the children), holds it in a `hint` / `definition` / `tooltip` / `help` / `caption` / `footer` / `plain` prop or inside an `InfoTip`, writes a definition sentence (the word followed by a colon, \"is\", \"are\" or \"means\"), or mounts an `Explainer`. Guidance-off rendering changes nothing here: the definition exists in the file either way.",
  );
  out.push("- **leak** is a developer note that shipped as copy (\"Mock citation\", \"replace with\", \"See note.\", \"TODO\"). Delete or rewrite it.");
  out.push("");
  out.push("## By package");
  out.push("");
  const pkgRows = [...byPkg.entries()]
    .sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0]))
    .map(([pkg, list]) => {
      const c = tierCounts(list);
      return [pkg, String(c.replace), String(c.define), String(c.leak), String(list.length), String(new Set(list.map((h) => h.file)).size)];
    });
  out.push(...mdTable(["Package", "Replace", "Define", "Leak", "Total", "Files"], pkgRows));
  out.push("");
  out.push("## By term");
  out.push("");
  const byTerm = new Map();
  for (const h of hits) {
    if (!byTerm.has(h.term)) byTerm.set(h.term, []);
    byTerm.get(h.term).push(h);
  }
  const tierOf = new Map(terms.map((t) => [t.term, t.tier]));
  const termRows = [...byTerm.entries()]
    .sort((a, b) => TIERS.indexOf(tierOf.get(a[0])) - TIERS.indexOf(tierOf.get(b[0])) || b[1].length - a[1].length || a[0].localeCompare(b[0]))
    .map(([term, list]) => {
      const pkgs = countBy(list, (h) => packageOf(h.file));
      const top = [...pkgs.entries()]
        .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
        .slice(0, 4)
        .map(([p, n]) => `${p} ${n}`)
        .join(", ");
      return [term, tierOf.get(term) ?? "", String(list.length), String(new Set(list.map((h) => h.file)).size), top];
    });
  out.push(...mdTable(["Term", "Tier", "Hits", "Files", "Most in"], termRows));
  out.push("");
  const cell = (s) => s.replace(/\|/g, "\\|").replace(/`/g, "'");
  for (const [pkg, list] of [...byPkg.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    const c = tierCounts(list);
    out.push(`## ${pkg} (${list.length}: ${c.replace} replace, ${c.define} define, ${c.leak} leak)`);
    out.push("");
    const sorted = [...list].sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line);
    const onSight = sorted.filter((h) => h.tier !== "define");
    if (onSight.length) {
      out.push("### Replace and leak: reword on sight");
      out.push("");
      out.push(
        ...mdTable(
          ["File:line", "Term", "Tier", "Text"],
          onSight.map((h) => [`\`${h.file}:${h.line}\``, h.term, h.tier, cell(h.snippet)]),
        ),
      );
      out.push("");
    }
    const define = sorted.filter((h) => h.tier === "define");
    if (define.length) {
      out.push("### Define: wrap the word in `Term`, define it in a hint or an explainer, or say the plain thing");
      out.push("");
      const grouped = new Map();
      for (const h of define) {
        const k = `${h.file}\u0000${h.term}`;
        if (!grouped.has(k)) grouped.set(k, []);
        grouped.get(k).push(h);
      }
      const rows = [...grouped.values()].map((g) => {
        const nums = g.map((h) => h.line);
        const shown = nums.slice(0, 12).join(", ") + (nums.length > 12 ? ` (+${nums.length - 12} more)` : "");
        return [`\`${g[0].file}\``, g[0].term, String(g.length), shown, cell(g[0].snippet)];
      });
      out.push(...mdTable(["File", "Term", "Hits", "Lines", "First text"], rows));
      out.push("");
    }
  }
  if (silenced.length) {
    out.push("## Replace-tier terms silenced by `plain-allow` (Gate 2 wants none)");
    out.push("");
    out.push(...mdTable(["File:line", "Term", "Text"], silenced.map((h) => [`\`${h.file}:${h.line}\``, h.term, cell(h.snippet)])));
    out.push("");
  }
  if (errors.length) {
    out.push("## Files the scanner could not read");
    out.push("");
    out.push(...mdTable(["File", "Error"], errors.map((e) => [`\`${e.file}\``, cell(e.error.slice(0, 140))])));
    out.push("");
  }
  out.push("## How to read a hit");
  out.push("");
  out.push("- `file:line:term:tier` is printed by the script; the tables above add the source line, and group define-tier hits by file and term because one definition clears them all.");
  out.push("- Internal identifiers (`acquisition_cost`, `--kit-primary`, `routes.pipeline`, `model: \"...\"`) are never hits; only the copy beside them is.");
  out.push("- A sentence that must name a word on purpose gets `plain-allow` in a comment on the same or the previous line. Never on a replace-tier word (Gate 2), and never to hide copy.");
  out.push(
    '- Allowed false friends: "business model" and "revenue model", "Live sessions" and a sign-in session, a bank branch, an insurance or privacy policy, a web form, "lead" as a verb, a person\'s health, "fit" as a verb, "tested" and "proven" as adjectives, customer ratings.',
  );
  out.push("- Agent templates, archetype task titles and option labels, and the mock completions count: what an agent is told to say, it says, and the mock is what the founder reads on the golden path.");
  out.push("- Markdown is read only under a root you name; the developer documents are not product copy.");
  out.push("");
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, out.join("\n"));
}

function main(argv) {
  const args = [...argv];
  let sweepPath = null;
  let jsonPath = null;
  let summaryOnly = false;
  const roots = [];
  while (args.length) {
    const a = args.shift();
    if (a === "--sweep") sweepPath = resolve(REPO_ROOT, args[0] && !args[0].startsWith("-") ? args.shift() : DEFAULT_SWEEP);
    else if (a === "--json") jsonPath = resolve(REPO_ROOT, args[0] && !args[0].startsWith("-") ? args.shift() : "plain-language.json");
    else if (a === "--summary") summaryOnly = true;
    else if (a.startsWith("-")) {
      console.error(`unknown flag ${a}`);
      process.exit(2);
    } else roots.push(a);
  }
  const scanRoots = roots.length ? roots : PLAIN_CODE_ROOTS;
  const result = plainScan(scanRoots);
  const { hits, silenced, errors } = result;
  const print = (line) => process.stdout.write(`${line}\n`);
  if (!summaryOnly) for (const h of hits) print(`${h.file}:${h.line}:${h.term}:${h.tier}: ${h.snippet}`);
  for (const e of errors) console.error(`${e.file}: could not be read (${e.error})`);
  if (sweepPath) {
    writeSweep(sweepPath, result, scanRoots);
    print(`Sweep written to ${relOf(sweepPath)}`);
  }
  if (jsonPath) writeFileSync(jsonPath, JSON.stringify({ hits, silenced, errors }, null, 2));

  const totals = tierCounts(hits);
  const byPkg = countBy(hits, (h) => packageOf(h.file));
  const summary = [...byPkg.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([p, n]) => `${p} ${n}`)
    .join(", ");
  if (hits.length) {
    console.error(
      `\n${hits.length} plain-language hit(s): ${totals.replace} replace, ${totals.define} define, ${totals.leak} leak` +
        `${summary ? ` (${summary})` : ""}${silenced.length ? `; ${silenced.length} replace-tier term(s) silenced by plain-allow` : ""}.`,
    );
    process.exit(1);
  }
  print(
    `No undefined jargon in user-facing text${silenced.length ? ` (${silenced.length} replace-tier term(s) silenced by plain-allow)` : ""}.`,
  );
}

export {
  ALLOWANCES,
  DEFINITION_ELEMENTS,
  DEFINITION_KEYS,
  LEAK_TERMS,
  PLAIN_CODE_ROOTS,
  buildTerms,
  fileContext,
  isAcronym,
  loadTiers,
  longestOnly,
  plainScan,
  scanCedar,
  scanCode,
  scanProse,
  scanSvg,
  termPattern,
  termRegex,
  tierCounts,
  writeSweep,
};

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main(process.argv.slice(2));
