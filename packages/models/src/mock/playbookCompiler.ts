/**
 * Rule-based playbook compiler (BUILD §11.13, AC-11.13.4): "When a lead replies positively, draft a reply and book a call;
 * I approve the first message." → a trigger (an event), steps (typed plan actions), approvals and stop conditions, in the
 * one shape packages/shared defines (`CreatePlaybookParams`). Deterministic and offline; the plan compiler's model route
 * is asked for the same shape and the result is validated against the same schema.
 */
import { CreatePlaybookParams, MAX_PLAYBOOK_STEPS, type PlaybookApproval, type PlaybookStep, type PlaybookTrigger } from "@foundmill/shared";
import type { PlanAction } from "../schemas";

/** A standing rule: "every time", "whenever", "each time", "from now on" always; "when" / "once" only with a known event. */
export const STANDING_LEAD_IN = /^(?:from\s+now\s+on,?\s*)?(?:every\s+time|each\s+time|whenever|when|once|as\s+soon\s+as|if)\s+/i;
const ALWAYS_STANDING = /\b(?:every\s+time|whenever|each\s+time|automatically\s+when|playbook|from\s+now\s+on|always\s+(?:do|send|create|run))\b/i;

interface EventRule {
  re: RegExp;
  trigger: (m: RegExpExecArray, phrase: string) => PlaybookTrigger;
}

const EVENT_RULES: EventRule[] = [
  {
    re: /\b(?:lead|prospect|contact)s?\s+(?:replies|reply|replied|responds|responded|answers|writes\s+back)\b/i,
    trigger: (_m, phrase) => {
      const where: Record<string, string | boolean> = {};
      if (/\b(?:positive(?:ly)?|interested|favou?rabl[ey])\b/i.test(phrase)) where.sentiment = "positive";
      else if (/\bnegative(?:ly)?\b/i.test(phrase)) where.sentiment = "negative";
      else if (/\bunsubscrib/i.test(phrase)) where.sentiment = "unsubscribe";
      if (/\b(?:asks?|requests?|wants?)\s+(?:for\s+)?(?:a\s+)?(?:meeting|call|demo)\b/i.test(phrase)) where.requestsMeeting = true;
      return { event: "lead.replied", ...(Object.keys(where).length > 0 ? { where } : {}) };
    },
  },
  { re: /\b(?:new\s+)?(?:signup|sign-up|sign\s+up|signs\s+up|registers?|registration)\b/i, trigger: () => ({ event: "signup.created" }) },
  {
    re: /\b(?:pays|paid|payment|first\s+payment|subscribes|subscription\s+starts|buys|purchases|checks?\s+out)\b/i,
    trigger: (_m, phrase) => ({ event: "payment.received", ...(/\bfirst\b/i.test(phrase) ? { where: { firstPayment: true } } : {}) }),
  },
  { re: /\b(?:customer|client)s?\s+(?:converts?|is\s+won|are\s+won|won)\b|\bwe\s+win\s+a\s+customer\b/i, trigger: () => ({ event: "customer.converted" }) },
  { re: /\brunway\s+(?:drops?|falls?|goes?\s+(?:below|under)|crosses?|gets?\s+(?:short|low))\b/i, trigger: () => ({ event: "runway.threshold_crossed", where: { direction: "below" } }) },
  { re: /\b(?:a\s+)?task\s+(?:is\s+)?(?:completes?|completed|finishes|finished|is\s+done)\b/i, trigger: () => ({ event: "task.completed" }) },
  { re: /\b(?:a\s+)?task\s+(?:is\s+)?(?:blocked|gets\s+blocked)\b/i, trigger: () => ({ event: "task.blocked" }) },
  { re: /\b(?:pull\s+request|pr)\s+(?:is\s+)?merged\b/i, trigger: () => ({ event: "pr.merged" }) },
  { re: /\bdeploy(?:ment)?\s+(?:succeeds|succeeded|goes\s+(?:out|live))\b/i, trigger: () => ({ event: "deploy.succeeded" }) },
  { re: /\bcampaign\s+(?:launches|is\s+launched|goes\s+live)\b/i, trigger: () => ({ event: "campaign.launched" }) },
  { re: /\bcredential\s+(?:is\s+)?(?:about\s+to\s+expire|expiring|expires)\b/i, trigger: () => ({ event: "credential.expiring" }) },
  { re: /\bfiling\s+(?:is\s+)?due\b/i, trigger: () => ({ event: "filing.due" }) },
  { re: /\bcontract\s+(?:is\s+)?signed\b/i, trigger: () => ({ event: "contract.signed" }) },
  { re: /\b(?:a\s+)?(?:connection\s+request|someone\s+asks\s+to\s+connect)\b/i, trigger: () => ({ event: "connection.requested" }) },
  { re: /\b(?:a\s+)?(?:message|email)\s+(?:arrives|comes\s+in|is\s+received)\b/i, trigger: () => ({ event: "message.received" }) },
];

/** The event a trigger phrase names, or null. */
export function detectTrigger(phrase: string): PlaybookTrigger | null {
  for (const rule of EVENT_RULES) {
    const m = rule.re.exec(phrase);
    if (m) return rule.trigger(m, phrase);
  }
  return null;
}

/** True when a clause is a standing rule that names an event ("when a lead replies…"), or says it is one outright. */
export function isPlaybookClause(clause: string): boolean {
  if (ALWAYS_STANDING.test(clause)) return true;
  const lead = STANDING_LEAD_IN.exec(clause.trim());
  if (!lead) return false;
  const rest = clause.trim().slice(lead[0].length);
  return detectTrigger(rest.split(/,|\s+then\s+|:/i)[0] ?? rest) !== null;
}

const APPROVAL_CLAUSE = /(?:^|[;,.]\s*|\s+and\s+)(?:i\s+(?:will\s+|'ll\s+|want\s+to\s+|need\s+to\s+)?approve|with\s+my\s+approval|after\s+i\s+approve|ask\s+me\s+(?:first|before)|needs?\s+my\s+approval|let\s+me\s+approve|i\s+review)([^;.]*)/i;

const sentenceCase = (s: string): string => {
  const t = s.trim().replace(/\s+/g, " ");
  return t ? `${t[0]!.toUpperCase()}${t.slice(1)}` : t;
};

export interface PlaybookCompileOptions {
  /** Compile one step clause into the plan actions it means (the plan compiler's rule engine, without playbooks). */
  compileStep: (clause: string) => PlanAction[];
  /** Clause splitter shared with the plan compiler. */
  splitSteps: (text: string) => string[];
}

export type PlaybookCompileResult = { ok: true; params: CreatePlaybookParams; summary: string } | { ok: false; question: string };

/** Compile one playbook sentence. `ok: false` carries the one question to ask when the trigger or the steps are unclear. */
export function compilePlaybookRuleBased(text: string, opts: PlaybookCompileOptions): PlaybookCompileResult {
  const original = text.replace(/\s+/g, " ").trim();
  let body = original;

  // Approvals: "I approve the first message" belongs to a step, not a step of its own.
  const approvalWords: string[] = [];
  for (let guard = 0; guard < 3; guard++) {
    const m = APPROVAL_CLAUSE.exec(body);
    if (!m) break;
    approvalWords.push(m[1] ?? "");
    body = `${body.slice(0, m.index)}${body.slice(m.index + m[0].length)}`.replace(/\s+/g, " ").trim();
  }

  // Stop conditions: "at most 5 times", "stop after 10 runs".
  const stop: CreatePlaybookParams["stop"] = {};
  const stopMatch = /[;,]?\s*(?:(?:at\s+most|up\s+to|no\s+more\s+than|max(?:imum)?(?:\s+of)?)\s+(\d+)\s+(?:times|runs)|stop\s+after\s+(\d+)\s+(?:times|runs))/i.exec(body);
  if (stopMatch) {
    stop.max_runs = Number(stopMatch[1] ?? stopMatch[2]);
    body = `${body.slice(0, stopMatch.index)}${body.slice(stopMatch.index + stopMatch[0].length)}`.trim();
  }

  const lead = STANDING_LEAD_IN.exec(body);
  const afterLead = lead ? body.slice(lead[0].length) : body.replace(/^.*?\b(?:playbook|from\s+now\s+on)\b[:,]?\s*/i, "");
  const cut = /,\s*|\s+then\s+|:\s*/i.exec(afterLead);
  const triggerPhrase = (cut ? afterLead.slice(0, cut.index) : afterLead).trim();
  let stepsText = cut ? afterLead.slice(cut.index + cut[0].length).trim() : "";
  const trigger = detectTrigger(triggerPhrase) ?? detectTrigger(afterLead);
  if (!trigger) {
    return { ok: false, question: "Which event should start this playbook? For example: a lead replies, someone signs up, a payment arrives, or runway drops." };
  }
  if (!stepsText) stepsText = afterLead.replace(triggerPhrase, "").replace(/^[,;:\s]+/, "").trim();
  stepsText = stepsText.replace(/[\s.!;,]+$/, "");

  const steps: PlaybookStep[] = [];
  for (const clause of opts.splitSteps(stepsText)) {
    for (const action of opts.compileStep(clause)) {
      if (action.type === "reply_only" || action.type === "create_playbook") continue;
      steps.push({ action: { type: action.type, params: action.params, ...(action.agent_id ? { agent_id: action.agent_id } : {}) }, label: sentenceCase(clause).replace(/[.!]+$/, "").slice(0, 160) });
    }
  }
  if (steps.length === 0) return { ok: false, question: "What should the team do when that happens? For example: draft a reply and book a call." };
  if (steps.length > MAX_PLAYBOOK_STEPS) steps.length = MAX_PLAYBOOK_STEPS;

  // Which step each approval names: the one that sends words to a person ("the first message"), else the first step.
  const approvals: PlaybookApproval[] = approvalWords.map((words) => {
    const sends = steps.findIndex((s) => s.action.type === "send_message");
    const drafts = steps.findIndex((s) => /\b(?:reply|message|email|draft)\b/i.test(s.label ?? ""));
    const named = /\b(?:message|reply|email)\b/i.test(words);
    return { step: named ? (sends >= 0 ? sends : drafts >= 0 ? drafts : 0) : 0, scope: /\bfirst\b/i.test(words) ? "first_run" : "every_run", note: sentenceCase(`I approve${words}`).replace(/[.!]+$/, "").slice(0, 200) };
  });

  const params = CreatePlaybookParams.parse({
    source_text: original.slice(0, 2000),
    name: sentenceCase(`${lead ? lead[0].trim() + " " : ""}${triggerPhrase}`.replace(/^(?:every time|each time|whenever|once|as soon as|if)\b/i, "When")).slice(0, 80),
    trigger,
    steps,
    approvals,
    stop,
  });
  return { ok: true, params, summary: `Create a playbook (off until you enable it): ${params.name}.` };
}
