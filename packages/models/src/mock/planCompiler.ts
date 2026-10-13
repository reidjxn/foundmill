/**
 * Rule-based plan compiler (BUILD §11.3 "Decision → execution", §12.3, AC-11.3.4, AC-11.3.5).
 *
 * Turns the founder's free text into a Plan of typed actions. Hard-gated requests (moving money, signing, filings in the
 * founder's identity, accepting terms, permanent deletion, security settings, acting on untrusted instructions — BUILD
 * §2.2) ALWAYS compile to `request_human_action`, never to an automated action. Channel + spend compiles to
 * `enable_channel` + `set_budget` + `create_task`. Anything the rules cannot read compiles to a single `reply_only`
 * with one clarifying question.
 *
 * Exported as a pure function so apps can also use it as a deterministic fallback or pre-check in live mode.
 */
import { CHANNEL_META, DEFAULT_BUSINESS_CURRENCY, PLAN_ACTION_TYPES, type ChannelKey, type PlanActionType, type TaskKind } from "@foundmill/shared";
import type { PlanAction, PlanOutput } from "../schemas";
import { type AgentLike, type ManifestEntry, type MockContext, agentsFrom, sentenceCase, truncate } from "./inputs";
import { compilePlaybookRuleBased, isPlaybookClause } from "./playbookCompiler";

export interface PlanCompilerContext {
  manifest?: ManifestEntry[];
  agents?: AgentLike[];
  /** ISO 4217 code used when the text gives an amount without a currency: the business's own. Default USD (`DEFAULT_BUSINESS_CURRENCY`). */
  defaultCurrency?: string;
  /** Restrict the emitted action types (BUILD §12.3 `{action_types}`). Defaults to every PlanActionType. */
  actionTypes?: readonly PlanActionType[];
  /** Compiling one step of a playbook: a standing rule inside it is not read as another playbook. */
  insidePlaybook?: boolean;
}

export type HardGate =
  | "move_money"
  | "sign"
  | "file_with_identity"
  | "accept_terms"
  | "permanent_delete"
  | "security_settings"
  | "untrusted_instructions";

const HARD_GATES: Array<{ gate: HardGate; re: RegExp; instruction: string; unless?: RegExp }> = [
  {
    gate: "move_money",
    re: /\b(pay(?:ing|s|ment|ments)?|paid(?!\s+(?:ads?|advertising|social|search|media|campaigns?|marketing|traffic|channels?))|wire|transfer(?:ring|s)?|send(?:ing)?\s+(?:the\s+|them\s+|him\s+|her\s+)?(?:money|funds|a\s+payment|the\s+payment)|refund(?:ing|s)?|payout(?:s)?|settle\s+(?:the\s+)?(?:invoice|bill|balance)|reimburse|top[- ]?up|buy(?:ing)?\s+(?:shares|stock|securities|crypto|bitcoin|options)|purchas(?:e|ing)\s+(?:shares|stock|securities)|trade\s+(?:shares|stock|crypto))\b/i,
    instruction: "Moving money is a hard gate. Review the amount and payee, then make the payment yourself from your own account or provider dashboard.",
  },
  {
    gate: "sign",
    // "sign"/"signs"/"signing" as the act; not "signed" (an adjective: "the signed contract") and not "sign up/off/in".
    re: /\b(?:sign|signs|signing)(?!\s*(?:up|off|in)\b)\b|\b(?:signature|e-?sign|docusign|countersign|execute\s+the\s+(?:contract|agreement|nda|io|insertion\s+order))\b/i,
    instruction: "Signing is a hard gate. The document is prepared for you; review it and sign with your own identity.",
  },
  {
    gate: "file_with_identity",
    re: /\b(?:file|submit|lodge)\b[^.;,]*\b(?:incorporation|tax(?:es)?|vat|ein|return|filing|articles|form|registration)\b|\bregister\s+(?:the\s+|a\s+|our\s+)?(?:company|business|llc|ltd|entity)\b|\bapply\s+for\s+(?:an?\s+|the\s+)?(?:ein|vat\s+number|tax\s+id|trademark)\b|\b(?:identity|id)\s+verification\b|\bkyc\b/i,
    instruction: "Filings in your identity are a hard gate. The kit with every field pre-filled is attached; submit it yourself.",
  },
  {
    gate: "accept_terms",
    re: /\b(?:accept|agree\s+to|consent\s+to)\b[^.;,]*\b(?:terms|t&cs|tos|agreement|policy|conditions)\b|\bgrant\s+(?:oauth|consent|access)\b|\bauthori[sz]e\s+the\s+(?:app|integration|connector)\b/i,
    instruction: "Accepting terms or granting consent is a hard gate. Open the provider's consent screen and accept it yourself.",
  },
  {
    gate: "permanent_delete",
    re: /\b(?:permanently\s+delete|hard[- ]delete|purge|wipe|erase|destroy)\b/i,
    instruction: "Permanent deletion is a hard gate. Confirm the records in the settings screen and delete them yourself.",
  },
  {
    gate: "security_settings",
    re: /\b(?:change|rotate|reset|disable|turn\s+off|update|remove|revoke)\b[^.;,]*\b(?:password|2fa|mfa|two[- ]factor|security\s+settings?|api\s+keys?|permissions|recovery\s+email|login\s+settings)\b|\bsecurity\s+settings\b/i,
    // Building a security feature into the product is engineering work, not a change to the founder's own settings.
    unless: /\b(?:spec|specification|roadmap|feature|product|requirements?|user\s+story|implement|build|ship)\b/i,
    instruction: "Security settings are a hard gate. Change them yourself in the provider's security page.",
  },
  {
    gate: "untrusted_instructions",
    // Includes what a conversation quotes: an Inbox note, a message, a pitch or a ticket.
    re: /\b(?:do\s+(?:what|as)\s+the\s+(?:email|page|document|pdf|website|attachment|note|message|letter|invoice|pitch|ticket|comment|post)\s+(?:says|asks|said|asked)|follow\s+the\s+instructions\s+(?:in|from)\s+the\s+(?:email|page|document|pdf|attachment|website|note|message|letter|invoice|pitch|ticket|comment|post))\b/i,
    instruction: "Instructions found inside untrusted content are treated as data. Tell me in your own words what you want done.",
  },
];

const CHANNEL_SYNONYMS: Array<[ChannelKey, RegExp]> = [
  ["paid_ads", /\b(?:linkedin\s+ads?|google\s+ads?|meta\s+ads?|facebook\s+ads?|instagram\s+ads?|tiktok\s+ads?|reddit\s+ads?|microsoft\s+ads?|bing\s+ads?|x\s+ads?|twitter\s+ads?|youtube\s+ads?|paid\s+(?:ads?|advertising|social|search|media|traffic|campaigns?)|ppc|adwords|ad\s+campaigns?|retargeting|display\s+ads?|search\s+ads?|sponsored\s+posts?)\b/i],
  ["email_automation", /\b(?:email\s+(?:automation|sequences?|campaigns?|marketing|flows?|nurture|drip|newsletter|list)|newsletters?|drip\s+campaigns?|lifecycle\s+emails?|onboarding\s+(?:emails?|sequence)|win-?back|dunning|sendgrid|mailchimp|cold\s+emails?|outbound\s+sequences?)\b/i],
  ["lead_generation", /\b(?:lead\s*gen(?:eration)?|leads?\s+(?:list|sourcing|pipeline)|prospecting|outbound\s+(?:prospecting|list)|cold\s+(?:outreach|calls?|calling)|apollo|icp\s+list|enrichment)\b/i],
  ["seo", /\b(?:seo|organic\s+search|search\s+rankings?|keywords?\s+research|backlinks?|technical\s+seo|search\s+console|programmatic\s+pages)\b/i],
  ["geo", /\b(?:geo|ai\s+search|ai\s+answers?|llms?\.txt|answer\s+share|chatgpt\s+visibility|perplexity|generative\s+engine)\b/i],
  ["content", /\b(?:content(?:\s+marketing)?|blog(?:s|ging|\s+posts?)?|articles?|guides?|e-?books?|whitepapers?|case\s+stud(?:y|ies)|youtube\s+videos?|video\s+content)\b/i],
  ["social", /\b(?:social(?:\s+media)?|instagram|tiktok|linkedin\s+(?:posts?|page|presence)|twitter|threads|pinterest|youtube\s+channel|facebook\s+page|posting\s+schedule)\b/i],
  ["influencer", /\b(?:influencers?|creators?|kols?|seeding\s+(?:campaign|program(?:me)?))\b/i],
  ["affiliate", /\b(?:affiliates?|referral\s+program(?:me)?|partner\s+program(?:me)?|commissions?)\b/i],
  ["direct_mail", /\b(?:direct\s+mail|postcards?|mailers?|letter\s+campaign|lob)\b/i],
  ["print", /\b(?:print(?:\s+ads?|\s+advertising)?|magazines?|newspapers?|flyers?|brochures?|leaflets?)\b/i],
  ["broadcast", /\b(?:broadcast|radio|podcast\s+ads?|tv|ctv|streaming\s+audio|spotify\s+ads?|television)\b/i],
  ["outdoor", /\b(?:outdoor|billboards?|ooh|dooh|transit\s+ads?|posters?|out-of-home)\b/i],
  ["pr", /\b(?:pr|press(?:\s+release)?|journalists?|media\s+coverage|publicity|trustpilot|review\s+campaign|press\s+kit)\b/i],
  ["events", /\b(?:events?|conferences?|trade\s+shows?|webinars?|meetups?|pop-?ups?|sponsorships?|exhibitions?)\b/i],
];

const CURRENCY_SYMBOLS: Record<string, string> = { "€": "EUR", $: "USD", "£": "GBP" };
const CURRENCY_WORDS: Record<string, string> = {
  eur: "EUR", euro: "EUR", euros: "EUR", usd: "USD", dollar: "USD", dollars: "USD", bucks: "USD", gbp: "GBP", pound: "GBP", pounds: "GBP", quid: "GBP",
  sek: "SEK", kr: "SEK", kronor: "SEK", chf: "CHF", francs: "CHF", dkk: "DKK", nok: "NOK",
};

export interface DetectedAmount {
  amountMinor: number;
  currency: string;
  cap: boolean;
  period: "one_off" | "daily" | "weekly" | "monthly" | "quarterly" | "yearly";
  text: string;
}

/** Verbs that address a person; capitalised or lowercase so a sentence can start with them. */
const MESSAGE_VERB = "(?:[Ee]mail|[Mm]essage|[Rr]eply(?:\\s+to)?|[Rr]espond\\s+to|[Ww]rite\\s+(?:back\\s+)?to|[Tt]ell|[Tt]hank|[Ff]ollow\\s+up\\s+with|[Rr]each\\s+out\\s+to|[Gg]et\\s+back\\s+to)";
/** A recipient: a known role word or a capitalised name of one or two words. */
const RECIPIENT = "(?:the\\s+)?(customers?|suppliers?|investors?|him|her|them|team|board|leads?|everyone|[A-Z][\\w-]+(?:\\s+[A-Z][\\w-]+)?)";
const SEND_MESSAGE_RE = new RegExp(`\\b${MESSAGE_VERB}\\s+(?:to\\s+)?${RECIPIENT}`);

const INTENT = {
  enable: /\b(?:spend|run|launch|start|try|test|turn\s+on|enable|invest|kick\s+off|put\s+[^.;,]*?\b(?:into|on|behind)|double\s+down|scale|ramp\s+up|go\s+(?:big|hard)\s+on|experiment\s+with|set\s+up|open\s+up|activate)\b/i,
  disable: /\b(?:pause|stop|turn\s+off|disable|kill|cancel|halt|switch\s+off|wind\s+down|cut|shut\s+down|suspend)\b/i,
  hire: /\b(?:hire|recruit|onboard\s+(?:an?\s+)?(?:new\s+)?agent|add\s+(?:an?\s+|another\s+)?(?:agent|engineer|specialist|designer|writer|researcher|analyst)|bring\s+in\s+(?:an?\s+)?(?:agent|engineer|specialist))\b/i,
  train: /\b(?:train|coach|retrain|run\s+training|improve\s+[^.;,]*\bskills?)\b/i,
  setModel: /\b(?:switch|upgrade|downgrade|move|change|put)\b[^.;,]*\b(?:opus|sonnet|haiku|model)\b/i,
  updateSpec: /\b(?:update|change|edit|revise|rewrite|add\s+to|amend)\b[^.;,]*\b(?:spec|specification|requirements?|prd|acceptance\s+criteria)\b/i,
  updateRoadmap: /\b(?:update|move|push|pull|reprioriti[sz]e|bump|delay|bring\s+forward|reschedule|deprioriti[sz]e)\b[^.;,]*\b(?:roadmap|milestone|release|launch\s+date|sprint|timeline)\b/i,
  sendMessage: SEND_MESSAGE_RE,
  schedule: /\b(?:schedule|book|set\s+up|arrange|organi[sz]e)\b[^.;,]*\b(?:call|meeting|demo|chat|interview|session|catch-?up)\b/i,
  approveSpend: /\b(?:approve|ok|okay|go\s+ahead\s+with|green-?light|sign\s+off\s+on|authorise\s+the\s+spend)\b[^.;,]*\b(?:spend|budget|purchase\s+order|po|quote|cost|invoice\s+for\s+approval)\b|\b(?:approve|approved)\b/i,
  createTask: /\b(?:build|write|draft|prepare|research|investigate|look\s+into|ship|fix|implement|design|create|set\s+up|make|put\s+together|analy[sz]e|compare|review|audit|benchmark|source|find|explore|map|document|plan|prototype|test|launch|run|spend|target|reach|get|grow|double|improve|optimi[sz]e|ask)\b/i,
  question: /\?\s*$|^\s*(?:should|could|would|can|is|are|do|does|what|why|how|when|which|who|any\s+thoughts)\b/i,
};

const TASK_KIND_HINTS: Array<[TaskKind, RegExp]> = [
  ["legal", /\b(?:contract|legal|terms|privacy|gdpr|compliance|trademark|nda|policy)\b/i],
  ["finance", /\b(?:runway|budget\s+model|forecast|p&l|cash\s*flow|invoice|pricing|cap\s+table|burn|bookkeeping)\b/i],
  ["code", /\b(?:bug|feature|api|endpoint|deploy|build|implement|fix|refactor|migration|frontend|backend|landing\s+page|website|app|integration|test(?:s|ing)?)\b/i],
  ["research", /\b(?:research|investigate|look\s+into|compare|benchmark|analy[sz]e|study|survey|interview|explore|map)\b/i],
  ["specialist", /\b(?:supplier|sourcing|formulation|packaging|manufactur|rfq|sample|logistics|freight|certification|quality)\b/i],
  ["channel", /\b(?:campaign|ads?|audience|channel|outreach|newsletter|content|seo|social|leads?)\b/i],
];

export function detectHardGates(text: string): Array<{ gate: HardGate; match: string; instruction: string }> {
  const out: Array<{ gate: HardGate; match: string; instruction: string }> = [];
  for (const g of HARD_GATES) {
    if (g.unless && g.unless.test(text)) continue;
    const m = g.re.exec(text);
    if (m) out.push({ gate: g.gate, match: m[0], instruction: g.instruction });
  }
  return out;
}

export function detectChannels(text: string): Array<{ channel: ChannelKey; match: string }> {
  const out: Array<{ channel: ChannelKey; match: string }> = [];
  const seen = new Set<ChannelKey>();
  for (const [channel, re] of CHANNEL_SYNONYMS) {
    const m = re.exec(text);
    if (m && !seen.has(channel)) {
      seen.add(channel);
      out.push({ channel, match: m[0] });
    }
  }
  return out;
}

/** `defaultCurrency`: the business's own, for an amount written without a symbol or a currency word. */
export function detectAmounts(text: string, defaultCurrency = DEFAULT_BUSINESS_CURRENCY): DetectedAmount[] {
  const out: DetectedAmount[] = [];
  const seen = new Set<number>();
  const push = (value: number, currency: string, index: number, raw: string) => {
    if (!Number.isFinite(value) || seen.has(index)) return;
    seen.add(index);
    const after = text.slice(index, index + raw.length + 60);
    const before = text.slice(Math.max(0, index - 40), index);
    out.push({
      amountMinor: Math.round(value * 100),
      currency,
      cap: /\b(?:up\s+to|max(?:imum)?|no\s+more\s+than|at\s+most|cap(?:ped)?|ceiling|limit(?:ed)?|not\s+(?:to\s+)?exceed(?:ing)?)\b/i.test(before),
      period: detectPeriod(after) ?? detectPeriod(before) ?? "one_off",
      text: raw,
    });
  };
  const scale = (s: string | undefined) => (s ? (s.toLowerCase() === "k" ? 1000 : 1_000_000) : 1);
  const num = (s: string) => Number.parseFloat(s.replace(/,/g, ""));
  for (const m of text.matchAll(/([€$£])\s?(\d[\d,]*(?:\.\d+)?)\s?([kKmM])?\b/g)) {
    push(num(m[2] as string) * scale(m[3]), CURRENCY_SYMBOLS[m[1] as string] ?? defaultCurrency, m.index ?? 0, m[0]);
  }
  for (const m of text.matchAll(/\b(\d[\d,]*(?:\.\d+)?)\s?([kKmM])?\s?(eur|euros?|usd|dollars?|bucks|gbp|pounds?|quid|sek|kr|kronor|chf|francs|dkk|nok)\b/gi)) {
    push(num(m[1] as string) * scale(m[2]), CURRENCY_WORDS[(m[3] as string).toLowerCase()] ?? defaultCurrency, m.index ?? 0, m[0]);
  }
  for (const m of text.matchAll(/\b(eur|usd|gbp|sek|chf|dkk|nok)\s?(\d[\d,]*(?:\.\d+)?)\s?([kKmM])?\b/gi)) {
    push(num(m[2] as string) * scale(m[3]), (m[1] as string).toUpperCase(), m.index ?? 0, m[0]);
  }
  return out.sort((a, b) => text.indexOf(a.text) - text.indexOf(b.text));
}

function detectPeriod(s: string): DetectedAmount["period"] | undefined {
  if (/\b(?:per|a|each|every)\s+day\b|\bdaily\b/i.test(s)) return "daily";
  if (/\b(?:per|a|each|every)\s+week\b|\bweekly\b|\/\s*wk\b|\/\s*week\b/i.test(s)) return "weekly";
  if (/\b(?:per|a|each|every)\s+month\b|\bmonthly\b|\/\s*mo(?:nth)?\b/i.test(s)) return "monthly";
  if (/\b(?:per|a|each|every)\s+quarter\b|\bquarterly\b/i.test(s)) return "quarterly";
  if (/\b(?:per|a|each|every)\s+year\b|\b(?:annually|yearly)\b/i.test(s)) return "yearly";
  if (/\b(?:total|one[- ]off|in\s+total|once|next\s+(?:week|month|quarter)|this\s+(?:week|month|quarter))\b/i.test(s)) return "one_off";
  return undefined;
}

export function detectAudience(text: string): string | undefined {
  const m = /\b(?:targeting|aimed\s+at|target|to\s+reach|for)\s+((?:[A-Za-z][\w&/-]*\s?){1,6}?)(?=\s+(?:next|this|in|by|over|during|starting|with|using|on|at|from|per|and|,|\.|;|$)|$)/.exec(text);
  if (!m) return undefined;
  const audience = (m[1] as string).trim().replace(/\s+(?:next|this|in|by|over)$/i, "");
  if (!audience || /^(?:the|a|an|me|us|it)$/i.test(audience) || audience.split(/\s+/).length > 6) return undefined;
  return audience;
}

export function detectTimeframe(text: string): string | undefined {
  const m = /\b((?:next|this|by|within|over\s+the\s+next|starting|before|until)\s+(?:the\s+)?(?:week|month|quarter|year|monday|tuesday|wednesday|thursday|friday|saturday|sunday|weekend|end\s+of\s+\w+|\w+\s+days?|\w+\s+weeks?|\w+\s+months?|q[1-4]))\b/i.exec(text);
  return m ? (m[1] as string).trim() : undefined;
}

export function inferTaskKind(text: string): TaskKind {
  for (const [kind, re] of TASK_KIND_HINTS) if (re.test(text)) return kind;
  return "ops";
}

export function splitClauses(text: string): string[] {
  const rough = text
    .replace(/\s+/g, " ")
    .split(/\s*(?:;|\.\s+|\bthen\b|\bafterwards\b|\balso\b|\band\s+also\b)\s*/i)
    .map((c) => c.trim())
    .filter(Boolean);
  const out: string[] = [];
  const verbStart = /^(?:pay|sign|file|submit|register|stop|pause|launch|start|enable|disable|hire|train|send|email|schedule|book|run|spend|put|switch|upgrade|downgrade|update|approve|create|build|write|draft|delete|purge|change|rotate|reset|accept|agree|transfer|wire|refund|cancel|kill)\b/i;
  for (const clause of rough) {
    const parts = clause.split(/\s*,?\s+and\s+/i);
    let current = parts[0] ?? "";
    for (const part of parts.slice(1)) {
      if (verbStart.test(part)) {
        out.push(current);
        current = part;
      } else current = `${current} and ${part}`;
    }
    out.push(current);
  }
  return out.filter((c) => c.trim().length > 0);
}

export function compilePlanRuleBased(text: string, ctx: PlanCompilerContext = {}): PlanOutput {
  const allowed = new Set<PlanActionType>(ctx.actionTypes ?? PLAN_ACTION_TYPES);
  const defaultCurrency = (ctx.defaultCurrency ?? DEFAULT_BUSINESS_CURRENCY).toUpperCase();
  const agents = ctx.agents ?? (ctx.manifest ?? []).filter((e) => e.kind === "agent").map<AgentLike>((e) => ({ id: e.id, name: e.name, role: e.role ?? "", department_id: e.department_id, channel: e.channel }));
  const actions: PlanAction[] = [];
  const summary: string[] = [];
  const cleaned = text.replace(/\s+/g, " ").trim();

  const add = (type: PlanActionType, params: Record<string, unknown>, agentId: string | null, line: string) => {
    if (!allowed.has(type)) return;
    actions.push({ type, params, agent_id: agentId });
    summary.push(line);
  };

  if (!cleaned) {
    add("reply_only", { question: "I did not catch any instruction. What would you like the team to do next?" }, null, "Ask one clarifying question.");
    return { summary: summary.join(" "), actions };
  }

  const enabledChannels = new Set<ChannelKey>();
  // A standing rule ("When a lead replies positively, draft a reply and book a call; I approve the first message.") is
  // compiled as one sentence into a playbook; everything else is read clause by clause.
  const segments = ctx.insidePlaybook ? [{ text: cleaned, playbook: false }] : cleaned.split(/(?<=[.!?])\s+(?=[A-Z])/).flatMap((sentence) => (isPlaybookClause(sentence) ? [{ text: sentence, playbook: true }] : splitClauses(sentence).map((c) => ({ text: c, playbook: false }))));
  for (const { text: clause, playbook } of segments) {
    const gates = detectHardGates(clause);
    if (gates.length > 0) {
      for (const g of gates) {
        add(
          "request_human_action",
          { gate: g.gate, matched: g.match, instructions: g.instruction, request: sentenceCase(clause), original_text: clause },
          null,
          `Ask you to handle "${truncate(clause, 60)}" yourself (${g.gate.replace(/_/g, " ")} is a hard gate).`,
        );
      }
      continue; // never compile anything automated out of a gated clause
    }

    // A standing trigger ("whenever", "every time", "when a lead replies") is a playbook, not a one-off action.
    if (playbook) {
      const compiled = compilePlaybookRuleBased(clause, {
        splitSteps: splitClauses,
        compileStep: (step) => compilePlanRuleBased(step, { ...ctx, agents, insidePlaybook: true }).actions,
      });
      if (compiled.ok) add("create_playbook", compiled.params, null, compiled.summary);
      else add("reply_only", { question: compiled.question }, null, "Ask which event starts the playbook.");
      continue;
    }

    const channels = detectChannels(clause);
    const amounts = detectAmounts(clause, defaultCurrency);
    const audience = detectAudience(clause);
    const timeframe = detectTimeframe(clause);
    const isDisable = INTENT.disable.test(clause) && !INTENT.enable.test(clause.replace(INTENT.disable, ""));
    const isSendMessage = INTENT.sendMessage.test(clause) && !/\b(?:email|newsletter)\s+(?:automation|sequence|campaign|marketing|list|flow)/i.test(clause);
    const messageChannels = isSendMessage ? channels.filter((c) => c.channel !== "email_automation") : channels;

    if (messageChannels.length > 0 && isDisable) {
      for (const c of messageChannels) {
        add("disable_channel", { channel: c.channel, reason: sentenceCase(clause), matched: c.match }, pickAgent(agents, { channel: c.channel }), `Disable ${CHANNEL_META[c.channel].label}.`);
      }
      continue;
    }

    if (messageChannels.length > 0 && !isSendMessage) {
      for (const c of messageChannels) {
        const agentId = pickAgent(agents, { channel: c.channel });
        const label = CHANNEL_META[c.channel].label;
        if (!enabledChannels.has(c.channel)) {
          enabledChannels.add(c.channel);
          add("enable_channel", { channel: c.channel, matched: c.match }, agentId, `Enable ${label}.`);
        }
        const amount = amounts[0];
        if (amount) {
          add(
            "set_budget",
            { channel: c.channel, amount_minor: amount.amountMinor, currency: amount.currency, period: amount.period, cap: amount.cap, timeframe: timeframe ?? null },
            agentId,
            `Set a ${amount.cap ? "cap" : "budget"} of ${formatAmount(amount)} (${amount.period.replace("_", "-")}${timeframe ? `, ${timeframe}` : ""}) for ${label}.`,
          );
        }
        add(
          "create_task",
          {
            kind: "channel" satisfies TaskKind,
            title: truncate(sentenceCase(clause), 80),
            goal: sentenceCase(clause),
            channel: c.channel,
            audience: audience ?? null,
            timeframe: timeframe ?? null,
            budget_minor: amount?.amountMinor ?? null,
            currency: amount?.currency ?? null,
          },
          agentId,
          `Create a ${label} task${audience ? ` targeting ${audience}` : ""}${timeframe ? ` for ${timeframe}` : ""}.`,
        );
      }
      continue;
    }

    let handled = false;
    if (INTENT.hire.test(clause)) {
      const role = /\b(?:hire|recruit|add|bring\s+in)\s+(?:an?\s+|another\s+|a\s+new\s+)?([\w-]+(?:\s+[\w-]+)?)/i.exec(clause)?.[1] ?? "specialist";
      add("hire_agent", { role: role.trim(), brief: sentenceCase(clause) }, null, `Hire a ${role.trim()} agent.`);
      handled = true;
    }
    if (INTENT.setModel.test(clause)) {
      const model = /\b(opus|sonnet|haiku)\b/i.exec(clause)?.[1]?.toLowerCase() ?? (/\bupgrade\b/i.test(clause) ? "opus" : /\bdowngrade\b/i.test(clause) ? "sonnet" : null);
      const agentId = pickAgentByName(agents, clause);
      add("set_agent_model", { model_key: model, agent_id: agentId, scope: /\ball\b/i.test(clause) ? "all" : "agent" }, agentId, `Set the model to ${model ?? "the requested tier"}${agentId ? "" : " for the named agents"}.`);
      handled = true;
    }
    if (INTENT.train.test(clause) && !handled) {
      const agentId = pickAgentByName(agents, clause);
      const focus = /\b(?:on|in|for)\s+([\w\s-]+?)(?:\s+skills?)?(?:[.;,]|$)/i.exec(clause)?.[1]?.trim();
      add("train_agent", { agent_id: agentId, focus: focus ?? null, brief: sentenceCase(clause) }, agentId, `Run a training session${focus ? ` focused on ${focus}` : ""}.`);
      handled = true;
    }
    if (INTENT.updateSpec.test(clause)) {
      add("update_spec", { change: sentenceCase(clause) }, pickAgent(agents, { kind: "research" }), `Draft a spec change proposal: ${truncate(clause, 60)}.`);
      handled = true;
    }
    if (INTENT.updateRoadmap.test(clause)) {
      add("update_roadmap", { change: sentenceCase(clause) }, null, `Update the roadmap: ${truncate(clause, 60)}.`);
      handled = true;
    }
    if (isSendMessage) {
      const recipient = SEND_MESSAGE_RE.exec(clause)?.[1] ?? "the contact";
      add("send_message", { recipient, intent: sentenceCase(clause), requires_disclosure: true }, pickAgent(agents, { kind: "channel" }), `Draft a message to ${recipient} for your approval.`);
      handled = true;
    }
    if (INTENT.schedule.test(clause)) {
      const withWhom = /\bwith\s+((?:[A-Z][\w-]+\s?){1,3}|the\s+\w+|\w+)/.exec(clause)?.[1]?.trim() ?? null;
      add("schedule_meeting", { with: withWhom, topic: sentenceCase(clause), timeframe: timeframe ?? null }, null, `Schedule a meeting${withWhom ? ` with ${withWhom}` : ""}.`);
      handled = true;
    }
    if (INTENT.approveSpend.test(clause) && !handled) {
      const amount = amounts[0];
      add("approve_spend", { amount_minor: amount?.amountMinor ?? null, currency: amount?.currency ?? null, what: sentenceCase(clause) }, null, `Approve the spend${amount ? ` of ${formatAmount(amount)}` : ""}.`);
      handled = true;
    }
    if (!handled && amounts.length > 0) {
      const amount = amounts[0] as DetectedAmount;
      const dept = /\b(marketing|distribution|engineering|development|product|finance|legal|team|ops|operations)\b/i.exec(clause)?.[1]?.toLowerCase() ?? null;
      add("set_budget", { scope: dept ? "department" : "business", department: dept, amount_minor: amount.amountMinor, currency: amount.currency, period: amount.period, cap: amount.cap, timeframe: timeframe ?? null }, null, `Set a ${amount.cap ? "cap" : "budget"} of ${formatAmount(amount)} (${amount.period.replace("_", "-")})${dept ? ` for ${dept}` : ""}.`);
      handled = true;
      if (INTENT.createTask.test(clause.replace(/\bspend\b/gi, ""))) {
        const kind = inferTaskKind(clause);
        add("create_task", { kind, title: truncate(sentenceCase(clause), 80), goal: sentenceCase(clause), audience: audience ?? null, timeframe: timeframe ?? null, budget_minor: amount.amountMinor, currency: amount.currency }, pickAgent(agents, { kind }), `Create a ${kind} task: ${truncate(clause, 50)}.`);
      }
    }
    if (!handled && INTENT.createTask.test(clause) && !INTENT.question.test(clause)) {
      const kind = inferTaskKind(clause);
      add("create_task", { kind, title: truncate(sentenceCase(clause), 80), goal: sentenceCase(clause), audience: audience ?? null, timeframe: timeframe ?? null }, pickAgent(agents, { kind }), `Create a ${kind} task: ${truncate(clause, 50)}.`);
    }
  }

  if (actions.length === 0) {
    const question = INTENT.question.test(cleaned)
      ? `That reads as a question rather than an instruction. Do you want me to act on "${truncate(cleaned, 80)}", and if so which department should own it?`
      : `I want to make sure I understand "${truncate(cleaned, 80)}". Which channel or department should own this, and is there a budget or deadline attached?`;
    add("reply_only", { question, original_text: cleaned }, null, "Ask one clarifying question before doing anything.");
  }
  return { summary: summary.join(" "), actions };
}

function formatAmount(a: DetectedAmount): string {
  const symbol = ({ EUR: "€", USD: "$", GBP: "£" } as Record<string, string>)[a.currency];
  const major = a.amountMinor / 100;
  const n = Number.isInteger(major) ? String(major) : major.toFixed(2);
  return symbol ? `${symbol}${n}` : `${n} ${a.currency}`;
}

function pickAgent(agents: AgentLike[], want: { channel?: ChannelKey; kind?: TaskKind }): string | null {
  if (agents.length === 0) return null;
  if (want.channel) {
    const label = CHANNEL_META[want.channel].label.toLowerCase();
    const words = [want.channel.replace(/_/g, " "), label, ...label.split(/\s+/).filter((w) => w.length > 3)];
    const direct = agents.find((a) => a.channel === want.channel);
    if (direct) return direct.id;
    const byRole = agents.find((a) => words.some((w) => `${a.role} ${a.name}`.toLowerCase().includes(w)));
    if (byRole) return byRole.id;
    const strategist = agents.find((a) => /distribution|growth|marketing|strategist/i.test(`${a.role} ${a.name}`));
    if (strategist) return strategist.id;
  }
  if (want.kind) {
    const re: Record<TaskKind, RegExp> = {
      code: /engineer|developer|frontend|backend|coding|infra|qa/i,
      research: /research|analyst|product/i,
      channel: /distribution|growth|marketing|channel|strategist/i,
      specialist: /specialist|sourcing|formulation|logistics|quality|packaging/i,
      legal: /legal|counsel|compliance/i,
      finance: /finance|cfo|accountant|controller/i,
      ops: /operations|ops|chief of staff|assistant/i,
    };
    const found = agents.find((a) => re[want.kind as TaskKind].test(`${a.role} ${a.name}`));
    if (found) return found.id;
  }
  return null;
}

function pickAgentByName(agents: AgentLike[], text: string): string | null {
  const lower = text.toLowerCase();
  const found = agents.find((a) => a.name && lower.includes(a.name.toLowerCase()));
  return found ? found.id : null;
}

/** Mock route entry point: reads the founder's reply and the manifest from the prompt. */
export function generatePlanCompiler(ctx: MockContext): PlanOutput {
  const text = ctx.getString("reply", "free_text", "founder_reply", "text", "instruction", "message") ?? ctx.lastUser;
  const business = ctx.getRecord("business");
  const defaultCurrency = ctx.getString("currency", "default_currency") ?? (business && typeof business.currency === "string" ? business.currency : undefined);
  const actionTypesRaw = ctx.getArray<string>("action_types", "actionTypes");
  const actionTypes = actionTypesRaw.filter((t): t is PlanActionType => (PLAN_ACTION_TYPES as readonly string[]).includes(t));
  return compilePlanRuleBased(text, {
    manifest: ctx.manifest,
    agents: agentsFrom(ctx),
    defaultCurrency,
    actionTypes: actionTypes.length > 0 ? actionTypes : undefined,
  });
}
