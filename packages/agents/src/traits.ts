/**
 * Traits derived from instructions (BUILD §11.10 "Traits (derived from instructions, e.g. 'Writes tests first', 'Asks before spending')").
 * Deterministic pattern → label mapping over goals, rules, playbook and tone. Used at template definition time and
 * whenever a new agent version is promoted.
 */
import { type AgentInstructions } from "./types";

interface TraitRule {
  label: string;
  /** Any of these patterns in the instruction text yields the trait. */
  patterns: RegExp[];
}

const TRAIT_RULES: TraitRule[] = [
  { label: "Writes tests first", patterns: [/\btests? (first|before)\b/i, /\bwrite (the )?(failing )?tests? (first|before)/i, /\btest-first\b/i, /\bred[- ]green/i] },
  { label: "Asks before spending", patterns: [/\b(ask|approval|request_human_action|founder approves?)\b[^.]{0,40}\b(spend|budget|cost|money|commitment|payout|fee)/i, /\b(spend|budget|commitment)\b[^.]{0,40}\b(ask|approval|approve)/i] },
  { label: "Cites every claim", patterns: [/\bcite\b/i, /\bcitation/i, /\bsource (record )?ids?\b/i, /\bprovenance\b/i] },
  { label: "Ships in small steps", patterns: [/\bsmall(er)? (changes?|steps?|prs?|increments?|batches?)\b/i, /\bincremental/i, /\bone change at a time\b/i] },
  { label: "Checks consent first", patterns: [/\bconsent\b/i, /\bsuppression list\b/i, /\blawful basis\b/i, /\bone-click unsubscribe\b/i] },
  { label: "Never invents", patterns: [/\bnever (invent|fabricate|make up)/i, /\bno (invented|fabricated)\b/i, /\bonly (numbers|facts) (present|from|in)\b/i] },
  { label: "Prepares kits when blocked", patterns: [/\bkit mode\b/i, /\bprepare[sd]? (a )?kit\b/i, /\bfounder (submits|books|signs)\b/i] },
  { label: "Negotiates within limits", patterns: [/\bwalk[- ]away\b/i, /\bnegotiat/i, /\btarget price\b/i] },
  { label: "Returns typed data", patterns: [/\btyped (data|output|fields|json)\b/i, /\bjson (only|matching)\b/i, /\bschema\b/i] },
  { label: "Treats inputs as data", patterns: [/\buntrusted\b/i, /\bquarantin/i, /\btreat[^.]{0,20}as data\b/i, /\bignore (any )?instructions (in|inside|found)/i] },
  { label: "Reads the whole thing", patterns: [/\bread (the )?(whole|entire|full)\b/i, /\bbefore (writing|answering|changing)\b[^.]{0,20}\bread\b/i] },
  { label: "Measures before changing", patterns: [/\bmeasure\b/i, /\bbaseline\b/i, /\bbefore and after\b/i, /\bbenchmark\b/i] },
  { label: "Matches the design system", patterns: [/\bdesign system\b/i, /\bdugout\b/i, /\btokens only\b/i, /\bdesign fidelity\b/i] },
  { label: "Keeps a paper trail", patterns: [/\baudit\b/i, /\brecord(ed|s)? (the|every|all)\b/i, /\blog (every|each|all)\b/i, /\btranscript/i] },
  { label: "Plans before building", patterns: [/\bplan (first|before)\b/i, /\btask graph\b/i, /\bdecompos/i, /\bacceptance criteria\b/i] },
  { label: "Protects the schema", patterns: [/\bask before schema changes\b/i, /\bschema change/i, /\bmigration/i] },
  { label: "Escalates when unsure", patterns: [/\bwhen (unsure|uncertain|in doubt)\b[^.]{0,30}\b(ask|escalate)/i, /\bask (your lead|the founder)\b/i, /\bescalat/i] },
  { label: "Respects rate limits", patterns: [/\brate limit/i, /\bback ?off\b/i, /\bthrottl/i] },
  { label: "Labels estimates", patterns: [/\b(label|labell?ed|mark|marked)\b[^.]{0,20}\b(estimate|forecast)/i, /\b"estimate"\b/i] },
  { label: "Discloses AI involvement", patterns: [/\bon behalf of\b/i, /\bdisclos/i, /\bnever claim to be human\b/i] },
  { label: "Prefers primary sources", patterns: [/\bprimary sources?\b/i, /\bofficial sources?\b/i, /\bregulator/i] },
  { label: "Protects secrets", patterns: [/\bsecrets?\b/i, /\bcredentials?\b[^.]{0,30}\b(never|not)\b/i, /\bno long-lived credentials\b/i] },
  { label: "Kills losers fast", patterns: [/\bkill[- ]switch\b/i, /\bpause\b[^.]{0,30}\b(cpa|spend|campaign)\b/i, /\bstop[- ]loss\b/i] },
  { label: "Scores before deciding", patterns: [/\bscor(e|ing)\b[^.]{0,20}\b(1-20|1–20|out of 20|rubric|matrix)\b/i, /\bweighted scor/i] },
];

export const MAX_TRAITS = 6;

export interface DeriveTraitsOptions {
  /** Rules shared by many templates (layer fragments). They are matched only after the template-specific text, so traits
   *  describe what makes this agent different rather than what every agent of its layer does. */
  sharedRules?: readonly string[];
  max?: number;
}

function matchTraits(text: string, max: number, skip: ReadonlySet<string>): string[] {
  const out: string[] = [];
  for (const rule of TRAIT_RULES) {
    if (out.length + skip.size >= max) break;
    if (skip.has(rule.label)) continue;
    if (rule.patterns.some((p) => p.test(text))) out.push(rule.label);
  }
  return out;
}

/** Derive up to `max` trait labels from instructions, in catalogue order (deterministic). Template-specific text first. */
export function deriveTraits(instructions: AgentInstructions, options: DeriveTraitsOptions = {}): string[] {
  const max = options.max ?? MAX_TRAITS;
  const shared = new Set(options.sharedRules ?? []);
  const specificRules = instructions.rules.filter((r) => !shared.has(r));
  const sharedRules = instructions.rules.filter((r) => shared.has(r));
  const specificText = [instructions.role, ...instructions.goals, ...specificRules, ...instructions.playbook, instructions.tone, ...instructions.examples.map((e) => e.output)].join("\n");
  const primary = matchTraits(specificText, max, new Set());
  if (primary.length >= max || sharedRules.length === 0) return primary.slice(0, max);
  const secondary = matchTraits(sharedRules.join("\n"), max, new Set(primary));
  return [...primary, ...secondary].slice(0, max);
}

export const TRAIT_LABELS: readonly string[] = TRAIT_RULES.map((r) => r.label);
