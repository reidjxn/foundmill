/**
 * Club rules enforcement (BUILD §9.2, §12.1, AC-11.10.4).
 *
 * - `buildSystemPrompt` ALWAYS prepends the rendered club rules block to an agent's instructions. The rules are never
 *   stored in `instructions`, so no training diff can remove them.
 * - `detectClubRuleViolation` inspects an instructions diff (added lines) for text that tries to contradict a rule. The
 *   runtime flags such drafts; because the block is prepended regardless, the rule still applies even if a draft slips through.
 */
import { type AgentInstructions } from "./types";
import { CLUB_RULES, type ClubRule, clubRulesPrompt } from "./prompts/club-rules";

// ---------------------------------------------------------------------------------------------------------------------
// System prompt assembly
// ---------------------------------------------------------------------------------------------------------------------

export interface BuildSystemPromptInput {
  businessName: string;
  appName: string;
  /** Anything with structured instructions: an AgentTemplate or an AgentVersionSpec. */
  template: { instructions: AgentInstructions; description?: string };
  /** Optional business brief (BUILD §9.7), appended after the instructions so the rules + instructions prefix stays cacheable. */
  brief?: string;
  /** Glossary renames (customers → clients, ...), rendered as a short block. */
  glossary?: Record<string, string>;
}

export const CLUB_RULES_HEADER = "## Club rules";
export const INSTRUCTIONS_HEADER = "## Your instructions";

/** Render the structured instructions as the markdown block the runtime sends after the club rules. */
export function renderInstructions(instructions: AgentInstructions): string {
  const list = (items: readonly string[], ordered = false) => items.map((s, i) => `${ordered ? `${i + 1}.` : "-"} ${s}`).join("\n");
  const parts = [
    `Role: ${instructions.role}`,
    `Goals:\n${list(instructions.goals)}`,
    `Rules:\n${list(instructions.rules)}`,
    `Playbook:\n${list(instructions.playbook, true)}`,
    `Tone: ${instructions.tone}`,
  ];
  if (instructions.examples.length > 0) {
    parts.push(
      `Examples:\n${instructions.examples.map((e, i) => `Example ${i + 1}\nInput: ${e.input}\nOutput: ${e.output}`).join("\n\n")}`,
    );
  }
  return parts.join("\n\n");
}

/**
 * Build the full system prompt for an agent call. The club rules block is always first and is rendered from the fixed
 * template, never from the instructions, so an instructions draft cannot alter it.
 */
export function buildSystemPrompt(input: BuildSystemPromptInput): string {
  const rules = clubRulesPrompt.render({ business_name: input.businessName, APP_NAME: input.appName });
  const sections: string[] = [`${CLUB_RULES_HEADER}\n${rules}`];
  if (input.template.description) sections.push(`## What you do\n${input.template.description}`);
  sections.push(`${INSTRUCTIONS_HEADER}\n${renderInstructions(input.template.instructions)}`);
  if (input.glossary && Object.keys(input.glossary).length > 0) {
    const lines = Object.entries(input.glossary)
      .map(([from, to]) => `- say "${to}" instead of "${from}"`)
      .join("\n");
    sections.push(`## Glossary\n${lines}`);
  }
  if (input.brief) sections.push(`## Business brief\n${input.brief}`);
  return sections.join("\n\n");
}

/** True when a system prompt starts with the club rules block (used by the runtime as a last-line assertion). */
export function hasClubRulesPrefix(systemPrompt: string): boolean {
  const first = CLUB_RULES[0]!;
  return systemPrompt.startsWith(CLUB_RULES_HEADER) && systemPrompt.includes(`1. ${first.text}`);
}

// ---------------------------------------------------------------------------------------------------------------------
// Violation detection (AC-11.10.4)
// ---------------------------------------------------------------------------------------------------------------------

export interface InstructionsDiff {
  /** Lines added by the draft (the only lines that can introduce a contradiction). */
  added: string[];
  /** Lines removed by the draft; recorded for the audit trail but never a violation on their own. */
  removed: string[];
}

export interface ClubRuleViolation {
  ruleId: ClubRule["id"];
  ruleSlug: string;
  /** The offending added line, trimmed. */
  line: string;
  reason: string;
}

export interface ClubRuleViolationReport {
  flagged: boolean;
  violations: ClubRuleViolation[];
}

/** Flatten structured instructions into comparable lines (one per field entry) so diffs are field-order independent. */
export function flattenInstructions(instructions: AgentInstructions): string[] {
  return [
    `role: ${instructions.role}`,
    ...instructions.goals.map((g) => `goal: ${g}`),
    ...instructions.rules.map((r) => `rule: ${r}`),
    ...instructions.playbook.map((p) => `playbook: ${p}`),
    `tone: ${instructions.tone}`,
    ...instructions.examples.map((e) => `example: ${e.input} => ${e.output}`),
  ];
}

/** Compute the added/removed lines between two instruction sets. */
export function diffInstructions(before: AgentInstructions, after: AgentInstructions): InstructionsDiff {
  const a = flattenInstructions(before);
  const b = flattenInstructions(after);
  const aSet = new Set(a);
  const bSet = new Set(b);
  return { added: b.filter((l) => !aSet.has(l)), removed: a.filter((l) => !bSet.has(l)) };
}

/** Accepts a structured diff, a before/after pair, a unified-diff string or a plain list of added lines. */
export type InstructionsDiffInput =
  | InstructionsDiff
  | { before: AgentInstructions; after: AgentInstructions }
  | string
  | string[];

function normaliseDiff(input: InstructionsDiffInput): InstructionsDiff {
  if (typeof input === "string") {
    const added: string[] = [];
    const removed: string[] = [];
    for (const raw of input.split(/\r?\n/)) {
      if (raw.startsWith("+++") || raw.startsWith("---") || raw.startsWith("@@")) continue;
      if (raw.startsWith("+")) added.push(raw.slice(1));
      else if (raw.startsWith("-")) removed.push(raw.slice(1));
    }
    // A plain block of text without diff markers is treated as all-added.
    if (added.length === 0 && removed.length === 0) return { added: input.split(/\r?\n/).filter((l) => l.trim().length > 0), removed: [] };
    return { added, removed };
  }
  if (Array.isArray(input)) return { added: input, removed: [] };
  if ("before" in input && "after" in input) return diffInstructions(input.before, input.after);
  return input;
}

const NEGATION = /\b(never|do not|don't|dont|must not|mustn't|shall not|should not|shouldn't|cannot|can't|not allowed|not permitted|forbidden|prohibited|refuse|avoid|without ever|no circumstances|is not ok|is not okay|instead of)\b/i;
const PERMISSION =
  /\b(you may|you can|you're allowed|you are allowed|allowed to|permitted to|it is ok|it's ok|it is okay|it's okay|it is fine|fine to|feel free|go ahead|should|always|directly|yourself|on your own|without asking|without approval|without the founder|without a human|when (needed|necessary|helpful|useful|convenient|asked)|if (needed|necessary|helpful|useful|convenient|asked)|whenever)\b/i;

interface ActionPattern {
  ruleId: ClubRule["id"];
  /** Matches the forbidden action. */
  action: RegExp;
  /** When true the pattern is a violation on its own (it already encodes the contradiction), negation does not excuse it. */
  selfContained?: boolean;
  reason: string;
}

/** Phrases that attack the rule set as a whole (any rule). */
const META_OVERRIDES: { re: RegExp; reason: string }[] = [
  {
    re: /\b(ignore|override|overrule|disable|bypass|skip|suspend|lift|drop|remove|forget|disregard|set aside|turn off|relax|waive)\b[^.]{0,40}\b(club rules?|fixed rules?|hard[- ]gates?|system (rules|block|prompt)|rules? (1|2|3|4|5|6|7|one|two|three|four|five|six|seven)\b|the rules? above|previous (rules|instructions)|safety rules)/i,
    reason: "tries to switch off the club rules",
  },
  {
    re: /\b(club rules?|fixed rules?|hard[- ]gates?|rules? (1|2|3|4|5|6|7|one|two|three|four|five|six|seven))\b[^.]{0,30}\b(does not apply|do not apply|doesn't apply|don't apply|no longer appl|are suspended|is suspended|are optional|is optional|are lifted|is lifted|can be ignored|may be ignored|are waived|is waived)/i,
    reason: "declares a club rule inapplicable",
  },
  {
    re: /\b(these|your|the) (instructions|rules) (take precedence over|override|supersede|outrank|beat)\b[^.]{0,30}\b(club rules?|fixed rules?|system|hard[- ]gates?)/i,
    reason: "claims precedence over the club rules",
  },
  {
    re: /\b(except|apart from|other than)\b[^.]{0,20}\b(club )?rule (1|2|3|4|5|6|7)\b/i,
    reason: "carves out an exception to a numbered club rule",
  },
];

const ACTION_PATTERNS: ActionPattern[] = [
  // Rule 1 — hard gates
  {
    ruleId: 1,
    action: /\b(move|transfer|wire|send|pay|pay out|release|spend)\b[^.]{0,25}\b(money|funds|payment|payments|invoice|invoices|payout|payouts|the balance|deposit)\b/i,
    reason: "permits moving money",
  },
  { ruleId: 1, action: /\b(buy|sell|trade|purchase)\b[^.]{0,20}\b(shares|stock|stocks|securities|crypto|tokens|options)\b/i, reason: "permits trading" },
  {
    ruleId: 1,
    action: /\b(sign|e-sign|esign|execute|countersign|put your signature on|docusign)\b[^.]{0,25}\b(contract|contracts|agreement|agreements|document|documents|filing|filings|insertion order|io|anything|on behalf of the founder|for the founder)\b/i,
    reason: "permits signing",
  },
  { ruleId: 1, action: /\b(accept|agree to|click (accept|agree|i agree) on|consent to|grant)\b[^.]{0,20}\b(terms|tos|t&cs|conditions|privacy policy|oauth|consent screens?|permissions? screens?)\b/i, reason: "permits accepting terms or granting consent" },
  {
    ruleId: 1,
    action: /\b(submit|file|complete|finish)\b[^.]{0,30}\b(incorporation|tax id|ein|vat registration|identity verification|kyc|filing|filings|with the founder's identity|as the founder)\b/i,
    reason: "permits filing with the founder's identity",
  },
  { ruleId: 1, action: /\b(permanently|hard)[- ]?(delete|erase|purge|wipe)\b|\b(delete|erase|purge|wipe)\b[^.]{0,20}\bpermanently\b|\bempty the (trash|bin)\b/i, reason: "permits permanent deletion" },
  { ruleId: 1, action: /\b(change|modify|edit|update|disable|turn off|alter|rotate)\b[^.]{0,20}\b(security settings?|2fa|mfa|two-factor|password policy|firewall|access controls?|permissions? settings?)\b/i, reason: "permits changing security settings" },
  {
    ruleId: 1,
    action: /\b(no need to|don't|do not|never|skip|avoid|stop)\b[^.]{0,15}\b(create|creating|raise|raising|file|filing|emit|emitting)\b[^.]{0,10}\brequest_human_action\b/i,
    selfContained: true,
    reason: "removes the request_human_action escalation for hard gates",
  },
  // Rule 2 — untrusted content
  {
    ruleId: 2,
    action: /\b(follow|obey|act on|act upon|execute|carry out|comply with|apply|trust|honour|honor)\b[^.]{0,20}\b(instructions?|directions?|commands?|requests?)\b[^.]{0,20}\b(in|inside|within|from|found in|contained in|embedded in)\b[^.]{0,20}\b(web ?pages?|websites?|emails?|e-mails?|messages?|documents?|pdfs?|attachments?|tool outputs?|tool results?|search results?|untrusted|third[- ]part(y|ies)|content)\b/i,
    reason: "permits acting on instructions found in untrusted content",
  },
  {
    ruleId: 2,
    action: /\b(treat|regard|consider)\b[^.]{0,20}\b(web ?pages?|emails?|documents?|tool outputs?|untrusted content|third[- ]party content|inbound (mail|email|messages?))\b[^.]{0,20}\b(as|like)\b[^.]{0,10}\b(instructions?|commands?|orders?|directives?|trusted)\b/i,
    reason: "treats untrusted content as instructions",
  },
  {
    ruleId: 2,
    action: /\b(if|when)\b[^.]{0,15}\b(an? )?(email|web ?page|document|pdf|message|supplier|sender|page)\b[^.]{0,20}\b(tells|asks|instructs|says|requests)\b[^.]{0,20}\b(you to|to)\b[^.]{0,30}\b(do it|comply|follow it|do so|carry it out|obey)\b/i,
    reason: "defers to instructions from untrusted senders",
  },
  // Rule 3 — never claim to be human
  {
    ruleId: 3,
    action: /\b(claim|pretend|say|state|imply|suggest|insist|confirm|tell (them|people|customers|the recipient))\b[^.]{0,25}\b(you are|you're|to be|being|that you are|i am|i'm)\b[^.]{0,10}\b(a )?(human|person|real person|member of staff|colleague|employee|not an? (ai|agent|bot))\b/i,
    reason: "permits claiming to be human",
  },
  {
    ruleId: 3,
    action: /\b(don't|do not|never|avoid|stop|refrain from|no need to)\b[^.]{0,15}\b(disclose|mention|reveal|say|admit|state|tell|acknowledge|identify)\b[^.]{0,30}\b(ai|an? agent|a bot|automated|artificial|not human|on behalf of)\b/i,
    selfContained: true,
    reason: "hides that the agent is an AI or that messages are sent on behalf of the business",
  },
  {
    ruleId: 3,
    action: /\b(use|adopt|sign (with|as)|write under|pose as)\b[^.]{0,20}\b(a human name|a human persona|a fake name|a real person's name|the founder's name as if|as if you were the founder)\b/i,
    reason: "impersonates a human",
  },
  // Rule 4 — no invention
  {
    ruleId: 4,
    action: /\b(invent|make up|fabricate|create|write|add|include|insert|generate|embellish|exaggerate)\b[^.]{0,20}\b(testimonials?|reviews?|quotes?|customer stories|case studies|statistics|numbers|figures|facts|competing offers?|competitor (quotes?|prices?)|urgency|deadlines?|scarcity|social proof)\b/i,
    reason: "permits inventing facts, quotes, testimonials, offers or urgency",
  },
  {
    ruleId: 4,
    action: /\b(no need to|don't|do not|never|skip|avoid|stop|without)\b[^.]{0,15}\b(cite|citing|cites|reference|referencing|link|linking|include|including|attach|attaching)\b[^.]{0,15}\b(sources?|source (record )?ids?|record ids?|evidence|citations?|provenance)\b/i,
    selfContained: true,
    reason: "drops the requirement to cite a source record id",
  },
  {
    ruleId: 4,
    action: /\b(claims?|statements?|numbers?|figures?)\b[^.]{0,20}\b(do not|don't|need not|needn't|no longer)\b[^.]{0,10}\b(need|require|have)\b[^.]{0,10}\b(a )?(source|citation|evidence|record)\b/i,
    selfContained: true,
    reason: "drops the requirement to cite a source record id",
  },
  {
    ruleId: 4,
    action: /\b(say|tell|write|mention|imply|suggest)\b[^.]{0,30}\b(only (a few|\d+) (left|remaining|seats?|spots?)|offer (ends|expires) (today|tonight|soon)|limited time|last chance|other (customers|buyers|companies) (are|have) (buying|signed|chosen))\b/i,
    reason: "manufactures urgency or scarcity",
  },
  // Rule 5 — no evasion
  { ruleId: 5, action: /\b(solve|bypass|complete|defeat|crack|get (past|around|through)|work around|circumvent|beat|pass)\b[^.]{0,15}\b(captchas?|recaptcha|hcaptcha|bot[- ]checks?|bot[- ]detection|turnstile)\b/i, reason: "permits CAPTCHA solving" },
  {
    ruleId: 5,
    action: /\b(evade|bypass|get (around|past)|circumvent|sneak past|work around|avoid|skirt|defeat)\b[^.]{0,15}\b(logins?|log-ins?|login walls?|paywalls?|sign[- ]in walls?|rate limits?|blocks?|access restrictions|authentication)\b/i,
    reason: "permits login or paywall evasion",
  },
  {
    ruleId: 5,
    action: /\b(scrape|crawl|harvest|extract|download)\b[^.]{0,40}\b(regardless of|even if|even when|despite|against|ignoring|without regard to|whatever)\b[^.]{0,20}\b(terms|tos|robots\.txt|robots|site rules|their rules|the rules)\b/i,
    reason: "permits scraping against a site's terms",
  },
  { ruleId: 5, action: /\b(ignore|disregard|skip|bypass|override)\b[^.]{0,10}\b(robots\.txt|robots file|the site's terms|terms of service|terms of use|rate limits?)\b/i, selfContained: true, reason: "ignores robots.txt or site terms" },
  { ruleId: 5, action: /\b(use|rotate|spin up|create)\b[^.]{0,15}\b(fake|burner|throwaway|multiple|sock[- ]?puppet)\b[^.]{0,10}\b(accounts?|identities|profiles?)\b/i, reason: "permits sock puppets or fake accounts" },
  // Rule 6 — suppression list and marketing law
  {
    ruleId: 6,
    action: /\b(ignore|skip|bypass|disregard|override|don't check|do not check|no need to check|don't consult|do not consult|without checking|regardless of)\b[^.]{0,15}\b(the )?(suppression list|suppression|do[- ]not[- ]contact|unsubscribe list|unsubscribes?|opt[- ]outs?|consent (status|records?)|marketing[- ]law|gdpr|can[- ]spam|pecr|tcpa)\b/i,
    selfContained: true,
    reason: "ignores the suppression list or marketing-law rules",
  },
  {
    ruleId: 6,
    action: /\b(email|contact|message|call|text|sms)\b[^.]{0,30}\b(unsubscribed|opted[- ]out|suppressed|on the suppression list|who asked not to be contacted|without (consent|an unsubscribe link|a lawful basis|prior consent))\b/i,
    reason: "contacts suppressed recipients or skips consent",
  },
  {
    ruleId: 6,
    action: /\b(remove|drop|omit|hide|skip|leave out|no)\b[^.]{0,15}\b(the )?(unsubscribe (link|footer|option)|opt[- ]out link|sender (identity|address)|physical address|one-click unsubscribe)\b/i,
    reason: "removes mandatory unsubscribe or sender identity",
  },
  { ruleId: 6, action: /\bcold[- ]email\b[^.]{0,30}\b(eu|uk|european|consumers?|individuals?|b2c)\b|\b(eu|uk|european)\b[^.]{0,10}\bconsumers?\b[^.]{0,20}\bcold[- ](email|outreach|sms)\b/i, reason: "permits cold email to EU/UK consumers" },
  // Rule 7 — ask when unsure
  {
    ruleId: 7,
    action: /\b(don't|do not|never|avoid|stop|no need to|without)\b[^.]{0,10}\b(ask|asking|check with|checking with|consult|consulting|escalate|escalating to|bother|bothering|interrupt|interrupting|wait for|waiting for)\b[^.]{0,15}\b(the )?(founder|lead|your lead|a human|humans|anyone|approval|permission|confirmation)\b/i,
    selfContained: true,
    reason: "forbids asking the lead or founder",
  },
  { ruleId: 7, action: /\b(when|if)\b[^.]{0,10}\b(unsure|uncertain|in doubt|unclear|ambiguous)\b[^.]{0,20}\b(guess|make (an |your best )?assumption|assume|pick one|decide yourself|just proceed|proceed anyway|carry on|improvise|use your best guess)\b/i, selfContained: true, reason: "replaces asking with guessing" },
  { ruleId: 7, action: /\b(guess|assume|improvise|make something up)\b[^.]{0,20}\b(rather than|instead of|before)\b[^.]{0,10}\b(ask|asking|checking|escalating)\b/i, selfContained: true, reason: "replaces asking with guessing" },
];

function splitSentences(line: string): string[] {
  return line
    .split(/(?<=[.!?;])\s+|\n/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

/** Strip the "rule:"/"goal:" prefix that flattenInstructions adds so patterns see the natural sentence. */
function stripFieldPrefix(line: string): string {
  return line.replace(/^(role|goal|rule|playbook|tone|example):\s*/i, "");
}

/**
 * Detect added lines that attempt to contradict a club rule (AC-11.10.4). Heuristic by design: it flags for human review and
 * the Coach eval; the runtime still prepends the club rules so a missed phrasing has no effect either.
 */
export function detectClubRuleViolation(input: InstructionsDiffInput): ClubRuleViolationReport {
  const diff = normaliseDiff(input);
  const violations: ClubRuleViolation[] = [];
  const seen = new Set<string>();
  const push = (v: ClubRuleViolation) => {
    const k = `${v.ruleId}|${v.line}`;
    if (!seen.has(k)) {
      seen.add(k);
      violations.push(v);
    }
  };

  for (const rawLine of diff.added) {
    const line = stripFieldPrefix(rawLine).trim();
    if (!line) continue;
    for (const sentence of splitSentences(line)) {
      for (const meta of META_OVERRIDES) {
        if (meta.re.test(sentence)) {
          // Which rule? If a number is named, use it, else attribute to rule 1 as the broadest hard gate.
          const num = /rules? (1|2|3|4|5|6|7|one|two|three|four|five|six|seven)\b/i.exec(sentence)?.[1]?.toLowerCase();
          const words: Record<string, ClubRule["id"]> = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7 };
          const ruleId = (num ? (words[num] ?? (Number(num) as ClubRule["id"])) : 1) as ClubRule["id"];
          const rule = CLUB_RULES.find((r) => r.id === ruleId)!;
          push({ ruleId, ruleSlug: rule.slug, line, reason: meta.reason });
        }
      }
      for (const p of ACTION_PATTERNS) {
        const m = p.action.exec(sentence);
        if (!m) continue;
        const rule = CLUB_RULES.find((r) => r.id === p.ruleId)!;
        if (p.selfContained) {
          push({ ruleId: p.ruleId, ruleSlug: rule.slug, line, reason: p.reason });
          continue;
        }
        const before = sentence.slice(0, m.index);
        const negatedBefore = NEGATION.test(before);
        // "Never X" / "Do not X" / "X is forbidden" → compliant restatement, not a violation.
        const negatedAfter = /\b(is|are)\s+(forbidden|prohibited|not allowed|never allowed|out of bounds|a hard gate)\b/i.test(sentence.slice(m.index));
        if (negatedBefore || negatedAfter) continue;
        // An "unless"/"if" clause right after the negation re-opens the door ("never sign unless the amount is small").
        const permits = PERMISSION.test(sentence) || /^(you )?(may|can|should|will|must|always)\b/i.test(sentence) || /^[a-z]+\b/i.test(sentence);
        if (permits) push({ ruleId: p.ruleId, ruleSlug: rule.slug, line, reason: p.reason });
      }
      // Negated prohibition with a carve-out: "Never move money unless …" / "Do not sign except when …".
      const carveOut = /\b(never|do not|don't|must not)\b[^.]{0,60}\b(unless|except (when|if|for)|but you may|but you can|apart from when|other than when)\b/i.exec(sentence);
      if (carveOut) {
        for (const p of ACTION_PATTERNS) {
          if (p.selfContained) continue;
          if (p.action.test(sentence)) {
            const rule = CLUB_RULES.find((r) => r.id === p.ruleId)!;
            push({ ruleId: p.ruleId, ruleSlug: rule.slug, line, reason: `${p.reason} through a carve-out` });
          }
        }
      }
    }
  }
  return { flagged: violations.length > 0, violations };
}
